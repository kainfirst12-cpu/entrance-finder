// services/ragService.js — 벡터 기반 RAG 지식베이스 검색
// 로컬 개발: ipsi-finder의 vectors.json 공유
// 프로덕션 (Railway): GitHub Releases에서 다운로드 → /tmp에 캐시
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import OpenAI from 'openai';

const LOCAL_VECTORS_PATH =
  'C:/Users/kainf/OneDrive/바탕 화면/ipsi-finder/data/vectors.json';
const PRODUCTION_CACHE_PATH = path.join(tmpdir(), 'ipsi-finder-vectors.json');
const DEFAULT_VECTORS_URL =
  'https://github.com/kainfirst12-cpu/entrance-finder/releases/download/v1.0-vectors/vectors.json';
const EMBED_MODEL = 'text-embedding-3-small';

let vectorsCache = null;
let resolvedPath = null;

// vectors.json 경로 결정: 로컬 파일 우선, 없으면 Drive에서 다운로드
async function ensureVectorsFile() {
  if (resolvedPath) return resolvedPath;

  // 1. 환경변수로 지정된 경로
  const envPath = process.env.VECTORS_PATH;
  if (envPath && fs.existsSync(envPath)) {
    console.log(`[RAG] 로컬 벡터 사용 (env): ${envPath}`);
    resolvedPath = envPath;
    return envPath;
  }

  // 2. 로컬 개발 경로
  if (fs.existsSync(LOCAL_VECTORS_PATH)) {
    console.log(`[RAG] 로컬 벡터 사용: ${LOCAL_VECTORS_PATH}`);
    resolvedPath = LOCAL_VECTORS_PATH;
    return LOCAL_VECTORS_PATH;
  }

  // 3. 프로덕션 캐시 (Railway /tmp)
  if (fs.existsSync(PRODUCTION_CACHE_PATH)) {
    console.log(`[RAG] 캐시된 벡터 사용: ${PRODUCTION_CACHE_PATH}`);
    resolvedPath = PRODUCTION_CACHE_PATH;
    return PRODUCTION_CACHE_PATH;
  }

  // 4. URL에서 다운로드 (기본: GitHub Releases)
  const url = process.env.VECTORS_URL || DEFAULT_VECTORS_URL;
  console.log(`[RAG] URL에서 벡터 다운로드 중... ${url}`);
  const t0 = Date.now();
  await downloadFromUrl(url, PRODUCTION_CACHE_PATH);
  const sizeMB = (fs.statSync(PRODUCTION_CACHE_PATH).size / 1024 / 1024).toFixed(1);
  console.log(
    `[RAG] 다운로드 완료: ${PRODUCTION_CACHE_PATH} (${sizeMB}MB, ${Date.now() - t0}ms)`
  );
  resolvedPath = PRODUCTION_CACHE_PATH;
  return PRODUCTION_CACHE_PATH;
}

async function downloadFromUrl(url, destPath) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`벡터 다운로드 실패 ${res.status}: ${url}`);
  }
  const { Readable } = await import('stream');
  const { pipeline } = await import('stream/promises');
  const ws = fs.createWriteStream(destPath);
  await pipeline(Readable.fromWeb(res.body), ws);
}

async function loadVectors() {
  if (vectorsCache) return vectorsCache;
  const filePath = await ensureVectorsFile();
  console.log(`[RAG] JSON 파싱 중: ${filePath}`);
  const start = Date.now();
  vectorsCache = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  console.log(`[RAG] 벡터 ${vectorsCache.length}개 로드 (${Date.now() - start}ms)`);
  return vectorsCache;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

async function embedQuery(query) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 없음 — RAG 비활성');
  const openai = new OpenAI({ apiKey });
  const res = await openai.embeddings.create({
    model: EMBED_MODEL,
    input: query,
  });
  return res.data[0].embedding;
}

function buildQuery(studentData) {
  const parts = [];
  if (studentData.major) parts.push(`희망전공 ${studentData.major}`);
  if (studentData.targetUniv) parts.push(`목표대학 ${studentData.targetUniv}`);
  if (studentData.gpa) parts.push(`내신 ${studentData.gpa}등급`);
  if (studentData.mockExam) parts.push(`모의고사 ${studentData.mockExam}`);
  if (studentData.awards) parts.push(`수상 ${studentData.awards}`);
  if (studentData.club) parts.push(`동아리 ${studentData.club}`);
  return parts.join(' · ') || `${studentData.name || ''} 학생 분석`.trim();
}

export async function loadKnowledgeBaseRAG(studentData, opts = {}) {
  const { topKPerType = 6, maxCharsPerType = 18000 } = opts;

  const vectors = await loadVectors();
  if (vectors.length === 0) {
    return {
      대입정책: '(RAG 벡터 비어있음)',
      대학별전형: '',
      합격자사례: '',
    };
  }

  const query = buildQuery(studentData);
  console.log(`[RAG] 쿼리: "${query}"`);

  const t0 = Date.now();
  const qEmb = await embedQuery(query);
  console.log(`[RAG] 쿼리 임베딩 (${Date.now() - t0}ms)`);

  const t1 = Date.now();
  const byType = { 합격자사례: [], 대입정책: [], 대학별전형: [] };
  for (const v of vectors) {
    const t = v.metadata.type;
    if (!byType[t]) continue;
    const score = cosineSim(qEmb, v.embedding);
    byType[t].push({ score, text: v.text, source: v.metadata.source, filename: v.metadata.filename });
  }
  for (const t of Object.keys(byType)) {
    byType[t].sort((a, b) => b.score - a.score);
    byType[t] = byType[t].slice(0, topKPerType);
  }
  console.log(
    `[RAG] 유사도 매칭 (${Date.now() - t1}ms) — 합격자사례 top ${byType.합격자사례[0]?.score.toFixed(3)}, 대입정책 top ${byType.대입정책[0]?.score.toFixed(3)}`
  );

  const format = (arr) => {
    const blocks = arr.map(
      (h, i) =>
        `[자료 ${i + 1}] (관련도 ${(h.score * 100).toFixed(0)}%) ${h.filename}\n${h.text}`
    );
    let joined = blocks.join('\n\n---\n\n');
    if (joined.length > maxCharsPerType) joined = joined.slice(0, maxCharsPerType);
    return joined;
  };

  return {
    대입정책: format(byType.대입정책),
    대학별전형: format(byType.대학별전형),
    합격자사례: format(byType.합격자사례),
    _meta: {
      method: 'rag',
      query,
      chunksUsed: byType.대입정책.length + byType.대학별전형.length + byType.합격자사례.length,
    },
  };
}

// health check - 로컬 또는 URL 다운로드 가능한지
export function ragAvailable() {
  if (fs.existsSync(LOCAL_VECTORS_PATH)) return true;
  if (fs.existsSync(PRODUCTION_CACHE_PATH)) return true;
  if (process.env.VECTORS_PATH && fs.existsSync(process.env.VECTORS_PATH)) return true;
  return true; // URL 다운로드 항상 가능 (기본값이 GitHub Releases)
}
