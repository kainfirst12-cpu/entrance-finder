// services/vectorStore.js — Supabase pgvector 기반 지식베이스 저장/검색
// documents 테이블(db.js에서 생성)에 청크+임베딩을 저장하고 코사인 유사도로 검색한다.
import OpenAI from 'openai';
import { getPool, vectorEnabled } from './db.js';

const EMBED_MODEL = 'text-embedding-3-small'; // 1536차원 (db.js의 vector(1536)와 일치해야 함)
const EMBED_BATCH = 96;

const KB_TYPES = ['대입정책', '대학별전형', '합격자사례'];

// KB 준비 여부 캐시 (analyze 동기 경로에서 사용)
let kbDocCount = 0;
let kbCountLoaded = false;

export function kbReady() {
  return vectorEnabled() && kbDocCount > 0;
}

function pgVectorLiteral(arr) {
  return '[' + arr.join(',') + ']';
}

// ── OpenAI 임베딩 (배치) ───────────────────────────────
function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 미설정 — 임베딩 불가');
  return new OpenAI({ apiKey });
}

export async function embedTexts(texts) {
  const openai = getOpenAI();
  const out = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = await openai.embeddings.create({ model: EMBED_MODEL, input: batch });
    for (const d of res.data) out.push(d.embedding);
  }
  return out;
}

export async function embedQuery(query) {
  const [emb] = await embedTexts([query]);
  return emb;
}

// ── 텍스트 청킹 (문단 우선, 길이 제한) ─────────────────
export function chunkText(text, { maxChars = 1200, overlap = 150 } = {}) {
  const clean = (text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  // 문단(빈 줄) 단위로 모으되 maxChars를 넘기면 분할
  const paras = clean.split(/\n{2,}/);
  const chunks = [];
  let buf = '';
  const flush = () => { if (buf.trim()) chunks.push(buf.trim()); buf = ''; };

  for (const p of paras) {
    if (p.length > maxChars) {
      flush();
      // 긴 문단은 슬라이딩 윈도우로 분할
      for (let i = 0; i < p.length; i += (maxChars - overlap)) {
        chunks.push(p.slice(i, i + maxChars).trim());
      }
      continue;
    }
    if ((buf + '\n\n' + p).length > maxChars) { flush(); buf = p; }
    else { buf = buf ? buf + '\n\n' + p : p; }
  }
  flush();
  return chunks.filter(Boolean);
}

// ── 인제스트: {type, title, text} 문서들을 청킹+임베딩+저장 ──
// 문서 단위로 처리(메모리 절약 + 진행상황 노출). onProgress({doc,totalDocs,chunks}) 콜백 옵션.
// 반환: 저장된 청크 수
export async function ingestDocuments(docs, onProgress) {
  const pool = getPool();
  if (!vectorEnabled() || !pool) throw new Error('pgvector(documents) 비활성 상태입니다');

  const INSERT_BATCH = 100;
  let inserted = 0;

  for (let d = 0; d < docs.length; d++) {
    const doc = docs[d];
    if (!doc?.type) continue;
    const chunks = chunkText(doc.text);
    if (chunks.length === 0) continue;

    // 이 문서의 청크만 임베딩 (한 번에 전부 메모리에 올리지 않음)
    const embeddings = await embedTexts(chunks);

    for (let i = 0; i < chunks.length; i += INSERT_BATCH) {
      const cs = chunks.slice(i, i + INSERT_BATCH);
      const es = embeddings.slice(i, i + INSERT_BATCH);
      const values = [];
      const params = [];
      cs.forEach((c, j) => {
        const base = j * 5;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::vector, $${base + 5}::jsonb)`);
        params.push(
          doc.type, doc.title || '', c,
          pgVectorLiteral(es[j]),
          JSON.stringify({ filename: doc.title || '', chunk: i + j, ...(doc.metadata || {}) })
        );
      });
      await pool.query(
        `INSERT INTO documents (type, title, content, embedding, metadata) VALUES ${values.join(',')}`,
        params
      );
      inserted += cs.length;
    }

    if (onProgress) {
      try { onProgress({ doc: d + 1, totalDocs: docs.length, chunks: inserted }); } catch {}
    }
  }

  await refreshKbCount();
  return inserted;
}

// ── 검색: type별 상위 k개 (코사인 유사도) ───────────────
export async function searchByType(queryEmbedding, type, k = 6) {
  const pool = getPool();
  if (!vectorEnabled() || !pool) return [];
  const { rows } = await pool.query(
    `SELECT content, title, metadata, 1 - (embedding <=> $1::vector) AS score
     FROM documents
     WHERE type = $2
     ORDER BY embedding <=> $1::vector
     LIMIT $3`,
    [pgVectorLiteral(queryEmbedding), type, k]
  );
  return rows;
}

// ── 카운트 / 상태 ──────────────────────────────────────
export async function countByType() {
  const pool = getPool();
  if (!vectorEnabled() || !pool) return {};
  const { rows } = await pool.query(`SELECT type, COUNT(*)::int AS n FROM documents GROUP BY type`);
  const out = {};
  for (const r of rows) out[r.type] = r.n;
  return out;
}

export async function refreshKbCount() {
  const pool = getPool();
  if (!vectorEnabled() || !pool) { kbDocCount = 0; kbCountLoaded = true; return 0; }
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM documents WHERE type = ANY($1)`, [KB_TYPES]);
    kbDocCount = rows[0]?.n || 0;
  } catch { kbDocCount = 0; }
  kbCountLoaded = true;
  return kbDocCount;
}

export async function clearKnowledge() {
  const pool = getPool();
  if (!vectorEnabled() || !pool) throw new Error('pgvector 비활성 상태입니다');
  await pool.query(`DELETE FROM documents WHERE type = ANY($1)`, [KB_TYPES]);
  await refreshKbCount();
}

export { KB_TYPES };
