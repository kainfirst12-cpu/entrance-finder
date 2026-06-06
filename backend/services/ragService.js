// services/ragService.js — Supabase pgvector 기반 RAG 지식베이스 검색
// (구버전: GitHub Releases의 vectors.json 다운로드 + 메모리 코사인 계산 → 폐기)
import { embedQuery, searchByType, kbReady, refreshKbCount } from './vectorStore.js';

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

  if (!kbReady()) {
    // 아직 카운트 미로딩일 수 있으니 한 번 갱신 시도
    await refreshKbCount();
    if (!kbReady()) return null; // 호출측에서 Drive 폴백
  }

  const query = buildQuery(studentData);
  console.log(`[RAG] 쿼리: "${query}"`);

  const t0 = Date.now();
  const qEmb = await embedQuery(query);
  console.log(`[RAG] 쿼리 임베딩 (${Date.now() - t0}ms)`);

  const t1 = Date.now();
  const [정책, 전형, 사례] = await Promise.all([
    searchByType(qEmb, '대입정책', topKPerType),
    searchByType(qEmb, '대학별전형', topKPerType),
    searchByType(qEmb, '합격자사례', topKPerType),
  ]);
  console.log(
    `[RAG] pgvector 검색 (${Date.now() - t1}ms) — 사례 top ${사례[0]?.score?.toFixed?.(3) ?? '-'}, 정책 top ${정책[0]?.score?.toFixed?.(3) ?? '-'}`
  );

  const format = (arr) => {
    const blocks = arr.map(
      (h, i) => `[자료 ${i + 1}] (관련도 ${(h.score * 100).toFixed(0)}%) ${h.title || h.metadata?.filename || ''}\n${h.content}`
    );
    let joined = blocks.join('\n\n---\n\n');
    if (joined.length > maxCharsPerType) joined = joined.slice(0, maxCharsPerType);
    return joined;
  };

  return {
    대입정책: format(정책),
    대학별전형: format(전형),
    합격자사례: format(사례),
    _meta: {
      method: 'rag-pgvector',
      query,
      chunksUsed: 정책.length + 전형.length + 사례.length,
    },
  };
}

// analyze 경로에서 동기 체크 — KB 문서가 있으면 RAG 사용
export function ragAvailable() {
  return kbReady();
}
