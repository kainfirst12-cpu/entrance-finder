// services/libraryStore.js — 🗄 전체 자료함(관리자 전용)
//
// 학원 코드마다 따로 쌓이는 자료(보고서·아카이브·면접·로드맵·학생 기록)를 한 목록으로 모아 본다.
// 원장(관리자)이 "다른 학원들이 무엇을 만들고 있는지" 확인하고, 쓸 만한 것은 자기 보관함으로 옮기거나
// 파일로 따로 저장하기 위한 자리다. 쓰기는 하지 않는다 — 남의 자료는 읽고 '복사'만 한다(원본은 그대로).
//
//   kind = report(학교 입시 해설) | suhaeng(수행평가 아카이브) | interview(면접 전략)
//          | roadmap(생기부 로드맵) | record(학생 기록·분석)
//
// 학생 이름 등 개인정보가 그대로 보이므로 열람·복사는 events 에 남긴다(server.js 에서 logEvent).
import { getPool, dbEnabled } from './db.js';

// 종류별 한 줄 = { kind, id, owner_id, title, sub, student_name, at, snippet }
const UNION = `
  SELECT 'report'::text AS kind, r.id, r.owner_id, r.title,
         COALESCE(r.school_names, '') AS sub, ''::text AS student_name,
         r.updated_at AS at, LEFT(COALESCE(r.content, ''), 180) AS snippet
    FROM ef_school_reports r
  UNION ALL
  SELECT 'suhaeng', s.id, s.owner_id, s.title,
         CONCAT_WS(' · ', NULLIF(s.school, ''), NULLIF(s.subject, ''), NULLIF(s.topic, '')), COALESCE(s.student_name, ''),
         s.created_at, LEFT(COALESCE(s.content, ''), 180)
    FROM ef_suhaeng s
  UNION ALL
  SELECT 'interview', i.id, i.owner_id, i.title,
         '면접 전략', COALESCE(i.student_name, ''),
         i.created_at, ''
    FROM ef_interviews i
  UNION ALL
  SELECT 'roadmap', m.id, st.owner_id, m.title,
         COALESCE(m.summary, ''), COALESCE(st.name, ''),
         m.updated_at, LEFT(COALESCE(m.body, ''), 180)
    FROM ef_roadmaps m JOIN ef_students st ON st.id = m.student_id
  UNION ALL
  SELECT 'record', c.id, st.owner_id, COALESCE(NULLIF(c.title, ''), NULLIF(c.type, ''), '학생 기록'),
         COALESCE(c.type, ''), COALESCE(st.name, ''),
         c.created_at, LEFT(COALESCE(c.content, ''), 180)
    FROM ef_records c JOIN ef_students st ON st.id = c.student_id
`;

export const LIBRARY_KINDS = ['report', 'suhaeng', 'interview', 'roadmap', 'record'];
export const KIND_LABEL = {
  report: '학교 입시 해설', suhaeng: '수행평가 아카이브', interview: '면접 전략',
  roadmap: '생기부 로드맵', record: '학생 기록·분석',
};

/** 목록 — kind·소유자·검색어로 좁힌다. exceptOwner 를 주면 그 소유자(보통 관리자 자신)의 자료는 뺀다. */
export async function listLibrary({ kind, ownerId, q, exceptOwner, limit = 200, offset = 0 } = {}) {
  if (!dbEnabled()) return { items: [], total: 0 };
  const where = []; const params = [];
  if (kind && LIBRARY_KINDS.includes(kind)) { params.push(kind); where.push(`x.kind = $${params.length}`); }
  if (ownerId) { params.push(Number(ownerId)); where.push(`x.owner_id = $${params.length}`); }
  if (exceptOwner) { params.push(Number(exceptOwner)); where.push(`(x.owner_id IS NULL OR x.owner_id <> $${params.length})`); }
  if (q) { params.push(`%${q}%`); const p = `$${params.length}`; where.push(`(x.title ILIKE ${p} OR x.sub ILIKE ${p} OR x.student_name ILIKE ${p} OR x.snippet ILIKE ${p})`); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();
  const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM (${UNION}) x ${cond}`, params);
  params.push(Math.min(Number(limit) || 200, 500), Number(offset) || 0);
  const { rows } = await pool.query(
    `SELECT x.*, u.name AS owner_name, u.code AS owner_code, u.role AS owner_role
       FROM (${UNION}) x LEFT JOIN app_users u ON u.id = x.owner_id
       ${cond} ORDER BY x.at DESC NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { items: rows, total: cnt[0]?.n ?? rows.length };
}

/** 어느 학원이 무엇을 얼마나 쌓았는지 — 목록 위 요약(자료 있는 코드만) */
export async function libraryOwners() {
  if (!dbEnabled()) return [];
  const { rows } = await getPool().query(
    `SELECT x.owner_id, u.name AS owner_name, u.code AS owner_code, u.role AS owner_role,
            COUNT(*)::int AS n, MAX(x.at) AS last_at
       FROM (${UNION}) x LEFT JOIN app_users u ON u.id = x.owner_id
      GROUP BY x.owner_id, u.name, u.code, u.role ORDER BY n DESC`);
  return rows;
}

// ⚠ 'report' AS kind 같은 별칭을 붙이면 안 된다 — ef_school_reports.kind(해설 종류)·ef_suhaeng.kind(자료 유형)를
//   같은 이름으로 덮어써서 복사본의 종류가 틀어진다(비교 해설이 학교 해설로 바뀜). 종류는 호출 인자로 이미 안다.
const ONE = {
  report: `SELECT r.* FROM ef_school_reports r WHERE r.id = $1`,
  suhaeng: `SELECT s.* FROM ef_suhaeng s WHERE s.id = $1`,
  interview: `SELECT i.* FROM ef_interviews i WHERE i.id = $1`,
  roadmap: `SELECT m.*, st.owner_id, st.name AS student_name FROM ef_roadmaps m JOIN ef_students st ON st.id = m.student_id WHERE m.id = $1`,
  record: `SELECT c.*, st.owner_id, st.name AS student_name FROM ef_records c JOIN ef_students st ON st.id = c.student_id WHERE c.id = $1`,
};

/** 한 건 원본 — 종류마다 칼럼이 다르므로 화면·복사에서 쓸 공통 모양({ kind, id, ownerId, title, markdown, data, meta })으로 맞춰 돌려준다 */
export async function getLibraryItem(kind, id) {
  if (!dbEnabled() || !ONE[kind]) return null;
  const { rows } = await getPool().query(ONE[kind], [Number(id)]);
  const r = rows[0];
  if (!r) return null;
  const { rows: own } = await getPool().query(`SELECT name, code, role FROM app_users WHERE id = $1`, [r.owner_id]);
  const owner = own[0] || null;
  const base = { kind, id: r.id, ownerId: r.owner_id, ownerName: owner?.name || '(주인 없음)', ownerCode: owner?.code || '', raw: r };
  if (kind === 'report') {
    return { ...base, title: r.title, markdown: r.content || '', data: r.snapshot?.data || null, at: r.updated_at,
      meta: [r.kind === 'compare' ? '비교 해설' : '학교 해설', r.school_names, r.focus ? `학생 상황: ${r.focus}` : ''].filter(Boolean) };
  }
  if (kind === 'suhaeng') {
    return { ...base, title: r.title, markdown: r.content || '', data: null, at: r.created_at,
      meta: [r.school, r.subject, r.topic, r.grade, r.kind, r.student_name ? `학생: ${r.student_name}` : '', r.source_name].filter(Boolean) };
  }
  if (kind === 'interview') {
    // 본문은 JSON(면접 전략 구조) — 화면은 마크다운으로 바꿔 보여 준다(server.js 의 interviewMarkdown)
    return { ...base, title: r.title, markdown: '', data: r.data || {}, cards: r.cards || [], at: r.created_at,
      meta: [r.student_name ? `학생: ${r.student_name}` : '', `지원 카드 ${Array.isArray(r.cards) ? r.cards.length : 0}개`].filter(Boolean) };
  }
  if (kind === 'roadmap') {
    return { ...base, title: r.title, markdown: r.body || '', data: null, at: r.updated_at,
      meta: [r.student_name ? `학생: ${r.student_name}` : '', r.summary, r.source_name].filter(Boolean) };
  }
  return { ...base, title: r.title || r.type || '학생 기록', markdown: r.content || r.detail || '', data: null, at: r.created_at,
    meta: [r.student_name ? `학생: ${r.student_name}` : '', r.type, r.detail && r.content ? r.detail : ''].filter(Boolean) };
}
