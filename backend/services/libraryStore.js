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

// 종류별 한 줄 = { kind, id, owner_id, title, sub, student_name, at, snippet, origin, school_ids }
//   school_ids = 학교 해설의 catalog 학교 id 목록(화면이 학교 목록 파일에서 지역을 찾는 데 쓴다). 다른 종류는 빈 배열.
//   origin = 자동 사본일 때 '진짜 만든 학원' 이름(소유자는 관리자라서 owner_name 만으로는 누가 만든지 모른다)
const UNION = `
  SELECT 'report'::text AS kind, r.id, r.owner_id, r.title,
         COALESCE(r.school_names, '') AS sub, ''::text AS student_name,
         r.updated_at AS at, LEFT(COALESCE(r.content, ''), 180) AS snippet, COALESCE(r.auto_from, '') AS origin,
         COALESCE(r.school_ids, '[]'::jsonb) AS school_ids
    FROM ef_school_reports r
  UNION ALL
  SELECT 'suhaeng', s.id, s.owner_id, s.title,
         CONCAT_WS(' · ', NULLIF(s.school, ''), NULLIF(s.subject, ''), NULLIF(s.topic, '')), COALESCE(s.student_name, ''),
         s.created_at, LEFT(COALESCE(s.content, ''), 180), '', '[]'::jsonb
    FROM ef_suhaeng s
  UNION ALL
  SELECT 'interview', i.id, i.owner_id, i.title,
         '면접 전략', COALESCE(i.student_name, ''),
         i.created_at, '', '', '[]'::jsonb
    FROM ef_interviews i
  UNION ALL
  SELECT 'roadmap', m.id, st.owner_id, m.title,
         COALESCE(m.summary, ''), COALESCE(st.name, ''),
         m.updated_at, LEFT(COALESCE(m.body, ''), 180), '', '[]'::jsonb
    FROM ef_roadmaps m JOIN ef_students st ON st.id = m.student_id
  UNION ALL
  SELECT 'record', c.id, st.owner_id, COALESCE(NULLIF(c.title, ''), NULLIF(c.type, ''), '학생 기록'),
         COALESCE(c.type, ''), COALESCE(st.name, ''),
         c.created_at, LEFT(COALESCE(c.content, ''), 180), '', '[]'::jsonb
    FROM ef_records c JOIN ef_students st ON st.id = c.student_id
`;

export const LIBRARY_KINDS = ['report', 'suhaeng', 'interview', 'roadmap', 'record'];
export const KIND_LABEL = {
  report: '학교 입시 해설', suhaeng: '수행평가 아카이브', interview: '면접 전략',
  roadmap: '생기부 로드맵', record: '학생 기록·분석',
};

/**
 * 목록 — kind·소유자·검색어로 좁힌다. exceptOwner 를 주면 그 소유자(보통 관리자 자신)의 자료는 뺀다.
 * 돌려주는 counts 는 '종류만 뺀 같은 조건'의 종류별 건수다 — 어느 칸에 자료가 있는지 화면에서 바로 보여 주려는 것.
 * hiddenMine 은 exceptOwner 때문에 빠진 내 자료 건수(0건 화면에서 "내 자료를 빼고 보는 중"을 알려 준다).
 */
export async function listLibrary({ kind, ownerId, q, exceptOwner, limit = 200, offset = 0 } = {}) {
  if (!dbEnabled()) return { items: [], total: 0, counts: {}, hiddenMine: 0 };
  // 종류를 뺀 공통 조건(소유자·검색어) — counts 와 목록이 같은 잣대를 쓰게 한다
  const baseWhere = []; const baseParams = [];
  if (ownerId) { baseParams.push(Number(ownerId)); baseWhere.push(`x.owner_id = $${baseParams.length}`); }
  if (q) { baseParams.push(`%${q}%`); const p = `$${baseParams.length}`; baseWhere.push(`(x.title ILIKE ${p} OR x.sub ILIKE ${p} OR x.student_name ILIKE ${p} OR x.snippet ILIKE ${p} OR x.origin ILIKE ${p})`); }

  const where = [...baseWhere]; const params = [...baseParams];
  if (kind && LIBRARY_KINDS.includes(kind)) { params.push(kind); where.push(`x.kind = $${params.length}`); }
  const mineParams = [...params];
  if (exceptOwner) { params.push(Number(exceptOwner)); where.push(`(x.owner_id IS NULL OR x.owner_id <> $${params.length})`); }
  const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pool = getPool();

  const { rows: cnt } = await pool.query(`SELECT COUNT(*)::int AS n FROM (${UNION}) x ${cond}`, params);
  // 종류별 건수 — 목록과 같은 조건(내 자료 제외 포함)에서 종류 제한만 뺀 것
  const cntWhere = [...baseWhere]; const cntParams = [...baseParams];
  if (exceptOwner) { cntParams.push(Number(exceptOwner)); cntWhere.push(`(x.owner_id IS NULL OR x.owner_id <> $${cntParams.length})`); }
  const { rows: byKind } = await pool.query(
    `SELECT x.kind, COUNT(*)::int AS n FROM (${UNION}) x ${cntWhere.length ? `WHERE ${cntWhere.join(' AND ')}` : ''} GROUP BY x.kind`, cntParams);
  const counts = Object.fromEntries(byKind.map((r) => [r.kind, r.n]));

  // 내 자료를 빼고 보는 중이라면, 빠진 게 몇 건인지도 알려 준다
  let hiddenMine = 0;
  if (exceptOwner) {
    mineParams.push(Number(exceptOwner));
    const mineCond = [...where.slice(0, where.length - 1), `x.owner_id = $${mineParams.length}`];
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM (${UNION}) x WHERE ${mineCond.join(' AND ')}`, mineParams);
    hiddenMine = rows[0]?.n ?? 0;
  }

  params.push(Math.min(Number(limit) || 200, 500), Number(offset) || 0);
  const { rows } = await pool.query(
    `SELECT x.*, u.name AS owner_name, u.code AS owner_code, u.role AS owner_role
       FROM (${UNION}) x LEFT JOIN app_users u ON u.id = x.owner_id
       ${cond} ORDER BY x.at DESC NULLS LAST LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  return { items: rows, total: cnt[0]?.n ?? rows.length, counts, hiddenMine };
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
      origin: r.auto_from || '',
      meta: [r.kind === 'compare' ? '비교 해설' : '학교 해설', r.auto_from ? `만든 곳: ${r.auto_from}(자동 사본)` : '', r.school_names, r.focus ? `학생 상황: ${r.focus}` : ''].filter(Boolean) };
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

// ── 고치기·지우기(관리자) ────────────────────────────────
// 자료함은 원래 '읽기 + 복사'만 하는 자리였지만, 원장(관리자)이 남의 코드 자료까지 직접 손볼 수 있어야 한다는 요청으로 열었다(2026-09-22).
// 남의 학원 자료를 그 자리에서 바꾸는 일이라 화면이 한 번 더 확인하고, server.js 가 누가 무엇을 고쳤는지 events 에 남긴다.
//   · 본문이 들어가는 칸은 종류마다 다르다: report/suhaeng/record = content, roadmap = body
//   · 면접 전략(interview)은 본문이 구조화 JSON 이라 제목만 고친다 — 본문은 만든 화면에서 다시 만들어야 한다
const TABLE = { report: 'ef_school_reports', suhaeng: 'ef_suhaeng', interview: 'ef_interviews', roadmap: 'ef_roadmaps', record: 'ef_records' };
const BODY_COL = { report: 'content', suhaeng: 'content', roadmap: 'body', record: 'content' };
const HAS_UPDATED_AT = new Set(['report', 'roadmap']);
export const BODY_EDITABLE = (kind) => !!BODY_COL[kind];

export async function updateLibraryItem(kind, id, { title, markdown } = {}) {
  if (!dbEnabled() || !TABLE[kind]) return null;
  const sets = []; const params = [];
  const add = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (title !== undefined) add('title', String(title).slice(0, 200));
  if (markdown !== undefined && BODY_COL[kind]) add(BODY_COL[kind], String(markdown));
  if (!sets.length) return null;
  if (HAS_UPDATED_AT.has(kind)) sets.push('updated_at = now()');
  params.push(Number(id));
  const { rows } = await getPool().query(`UPDATE ${TABLE[kind]} SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`, params);
  return rows[0] || null;
}

export async function deleteLibraryItem(kind, id) {
  if (!dbEnabled() || !TABLE[kind]) return false;
  const { rowCount } = await getPool().query(`DELETE FROM ${TABLE[kind]} WHERE id = $1`, [Number(id)]);
  return rowCount > 0;
}
