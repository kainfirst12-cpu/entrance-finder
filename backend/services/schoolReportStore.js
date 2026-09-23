// services/schoolReportStore.js — 고교·중학 공시정보 '입시 해설 보고서' 보관 (학교 1곳 해설 / 비교함 해설)
//   화면(SchoolInfo.jsx)에서 AI 가 만든 마크다운을 원장이 고쳐 저장하고, Word/PDF 로 내려받는다. 선생님(소유자)별 분리.
import { getPool, dbEnabled } from './db.js';

export async function ensureSchoolReportTable() {
  if (!dbEnabled()) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ef_school_reports (
      id           SERIAL PRIMARY KEY,
      owner_id     INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
      kind         TEXT NOT NULL DEFAULT 'school',   -- school(1곳) | compare(비교)
      title        TEXT NOT NULL,
      school_ids   JSONB DEFAULT '[]'::jsonb,        -- catalog school.id 목록
      school_names TEXT DEFAULT '',                  -- 검색용 "부천고등학교, 중산고등학교"
      focus        TEXT DEFAULT '',                  -- 생성 때 넣은 학생 상황 메모
      content      TEXT DEFAULT '',                  -- 마크다운 본문(수정본)
      snapshot     JSONB DEFAULT '{}'::jsonb,        -- 생성 때 쓴 수치 요약(재생성·출처 확인용)
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ef_school_reports_owner ON ef_school_reports(owner_id);`);
  // 학부모 전송 이력 — 나만의 패파(academy-video) 로 보낸 기록 [{studentName, audience, reportId, at}]
  await pool.query(`ALTER TABLE ef_school_reports ADD COLUMN IF NOT EXISTS sent JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  // 자동 사본이면 '진짜 만든 곳'(학원 이름) — 보관함이 잠긴 학원이 만든 해설을 관리자 앞으로 한 벌 떠 둘 때 채운다.
  // 소유자(owner_id)는 관리자이므로, 이 칸이 없으면 누가 만든 자료인지 알 수 없다.
  await pool.query(`ALTER TABLE ef_school_reports ADD COLUMN IF NOT EXISTS auto_from TEXT DEFAULT NULL;`);
  // 🏫 학교별 정리(관리자 전체 자료함) — 검토 상태 new(미검토) | reviewed(검토 완료) | rep(대표본)
  //   school_key = 정렬한 학교 id 를 ',' 로 이은 것. 같은 학교(비교면 같은 학교 묶음)의 해설끼리 대표본을 하나만 둔다.
  await pool.query(`ALTER TABLE ef_school_reports ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'new';`);
  await pool.query(`ALTER TABLE ef_school_reports ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NULL;`);
  await pool.query(`ALTER TABLE ef_school_reports ADD COLUMN IF NOT EXISTS school_key TEXT DEFAULT NULL;`);
  await pool.query(`
    UPDATE ef_school_reports r SET school_key = COALESCE((
      SELECT string_agg(DISTINCT v, ',' ORDER BY v) FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(r.school_ids) = 'array' THEN r.school_ids ELSE '[]'::jsonb END) v), '')
     WHERE r.school_key IS NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ef_school_reports_key ON ef_school_reports(school_key, review_status);`);
}

export const REVIEW_STATUSES = ['new', 'reviewed', 'rep'];
export const schoolKey = (ids) => [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))].sort().join(',');

const COLS = 'id, owner_id, kind, title, school_ids, school_names, focus, auto_from, created_at, updated_at';

export async function listSchoolReports(ownerId, { q } = {}) {
  if (!dbEnabled() || !ownerId) return [];
  const where = ['owner_id = $1']; const params = [ownerId];
  if (q) { params.push(`%${q}%`); where.push(`(title ILIKE $${params.length} OR school_names ILIKE $${params.length})`); }
  const { rows } = await getPool().query(`SELECT ${COLS} FROM ef_school_reports WHERE ${where.join(' AND ')} ORDER BY updated_at DESC`, params);
  return rows;
}
export async function getSchoolReport(id) {
  const { rows } = await getPool().query(`SELECT * FROM ef_school_reports WHERE id = $1`, [id]);
  return rows[0] || null;
}
export async function getSchoolReportOwner(id) {
  const { rows } = await getPool().query(`SELECT owner_id FROM ef_school_reports WHERE id = $1`, [id]);
  return rows[0]?.owner_id ?? null;
}
export async function createSchoolReport(ownerId, f = {}) {
  const { rows } = await getPool().query(
    `INSERT INTO ef_school_reports (owner_id, kind, title, school_ids, school_names, focus, content, snapshot, auto_from, school_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [ownerId, f.kind === 'compare' ? 'compare' : 'school', String(f.title || '학교 입시 해설').slice(0, 200),
     JSON.stringify(Array.isArray(f.schoolIds) ? f.schoolIds : []), String(f.schoolNames || '').slice(0, 500),
     String(f.focus || '').slice(0, 2000), String(f.content || ''), JSON.stringify(f.snapshot || {}),
     f.autoFrom ? String(f.autoFrom).slice(0, 120) : null, schoolKey(f.schoolIds)],
  );
  return rows[0];
}
export async function updateSchoolReport(id, f = {}) {
  const sets = []; const params = [];
  const add = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (f.title !== undefined) add('title', String(f.title).slice(0, 200));
  if (f.content !== undefined) add('content', String(f.content));
  if (f.focus !== undefined) add('focus', String(f.focus).slice(0, 2000));
  if (!sets.length) return getSchoolReport(id);
  add('updated_at', new Date());
  params.push(id);
  const { rows } = await getPool().query(`UPDATE ef_school_reports SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  return rows[0] || null;
}
export async function appendSchoolReportSent(id, entry) {
  const { rows } = await getPool().query(
    `UPDATE ef_school_reports SET sent = COALESCE(sent, '[]'::jsonb) || $2::jsonb, updated_at = now() WHERE id = $1 RETURNING sent`,
    [id, JSON.stringify([entry])],
  );
  return rows[0]?.sent || [];
}
export async function deleteSchoolReport(id) {
  await getPool().query(`DELETE FROM ef_school_reports WHERE id = $1`, [id]);
}

// ══ 🏫 학교별 정리 · 검토 · 대표본 ══════════════════════════════════════

// 해설에 쓴 공시 학년도(가장 최근) — snapshot.facts 의 '2025학년도' 같은 표기에서 뽑는다. 새 공시가 나오면 화면이 '옛 수치'로 표시한다.
const DATA_YEAR_SQL = `(SELECT MAX(m[1]) FROM regexp_matches(COALESCE(r.snapshot->>'facts', ''), '([0-9]{4})학년도', 'g') AS m)`;

/** 관리자 학교별 보기 — 본문 없이 가볍게 전부. 학교로 묶는 건 화면이 school_ids 로 한다. */
export async function listForCuration() {
  if (!dbEnabled()) return [];
  const { rows } = await getPool().query(
    `SELECT r.id, r.owner_id, r.kind, r.title, r.school_ids, r.school_names, r.auto_from, r.review_status, r.reviewed_at,
            r.created_at, r.updated_at, COALESCE(r.school_key, '') AS school_key,
            (COALESCE(r.focus, '') <> '') AS has_focus, ${DATA_YEAR_SQL} AS data_year,
            u.name AS owner_name, u.role AS owner_role
       FROM ef_school_reports r LEFT JOIN app_users u ON u.id = r.owner_id
      ORDER BY r.updated_at DESC`);
  return rows;
}

/** 검토 상태 바꾸기. 대표본(rep)은 같은 학교 키에 하나만 — 이전 대표본은 '검토 완료'로 내린다. */
export async function setReviewStatus(id, status) {
  if (!REVIEW_STATUSES.includes(status)) throw new Error('알 수 없는 상태입니다');
  const pool = getPool();
  const { rows: cur } = await pool.query(`SELECT id, COALESCE(school_key, '') AS school_key FROM ef_school_reports WHERE id = $1`, [id]);
  if (!cur[0]) return null;
  if (status === 'rep' && !cur[0].school_key) throw new Error('학교 정보가 없는 해설(옛 복사본)은 대표본으로 정할 수 없습니다 — 공시정보 화면에서 다시 만든 해설을 써 주세요');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (status === 'rep') {
      await client.query(`UPDATE ef_school_reports SET review_status = 'reviewed' WHERE school_key = $1 AND review_status = 'rep' AND id <> $2`, [cur[0].school_key, id]);
    }
    const { rows } = await client.query(
      `UPDATE ef_school_reports SET review_status = $2, reviewed_at = CASE WHEN $2 = 'new' THEN NULL ELSE now() END
        WHERE id = $1 RETURNING id, review_status, reviewed_at, school_key`, [id, status]);
    await client.query('COMMIT');
    return rows[0];
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
}

/** 같은 학교(묶음)의 대표본 — 학원이 해설을 새로 만들기 전에 '이미 검토된 해설'로 보여 준다. 만든 곳·학생 메모는 내보내지 않는다. */
export async function findRep(ids) {
  const key = schoolKey(ids);
  if (!dbEnabled() || !key) return null;
  const { rows } = await getPool().query(
    `SELECT r.id, r.kind, r.title, r.content, r.school_ids, r.school_names, r.snapshot->'data' AS data, r.reviewed_at, ${DATA_YEAR_SQL} AS data_year
       FROM ef_school_reports r WHERE r.school_key = $1 AND r.review_status = 'rep' ORDER BY r.reviewed_at DESC NULLS LAST LIMIT 1`, [key]);
  return rows[0] || null;
}

// 학교 이름 비교용 — '부천고', '부천고등학교', '부천 고교' 를 같게 본다(고·중은 남겨 '대영고'와 '대영중'은 가른다)
const coreName = (n) => String(n || '').replace(/\s+/g, '').replace(/(고등학교|고교)$/, '고').replace(/중학교$/, '중');

// 대표본 본문에서 상담에 쓸 부분만(결론·지표·유리/불리·전략) 추린다 — 차트용 표·유의사항은 뺀다
function briefOf(content, max = 2600) {
  const keep = /^(한눈에 보기|이런 학생에게 유리합니다|이런 학생에게 불리합니다|입시 전략 제안)/;
  const out = []; let on = false;
  for (const line of String(content || '').split('\n')) {
    const h = line.match(/^##\s+(.+)/);
    if (h) on = keep.test(h[1].trim());
    if (on) out.push(line);
  }
  const text = (out.length ? out.join('\n') : String(content || '')).trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 학생의 재학 학교 대표본(학교 1곳 해설) — 생기부 분석·브리핑·상담 프롬프트에 붙인다.
 * 이름이 같은 다른 지역 학교의 대표본이 둘 이상이면 어느 학교인지 몰라 붙이지 않는다(틀린 학교 이야기가 더 해롭다).
 */
export async function repBriefForSchool(schoolName) {
  const core = coreName(schoolName);
  if (!dbEnabled() || core.length < 3) return '';
  const { rows } = await getPool().query(
    `SELECT r.school_key, r.school_names, r.content, ${DATA_YEAR_SQL} AS data_year
       FROM ef_school_reports r
      WHERE r.review_status = 'rep' AND r.kind = 'school' AND r.school_key <> '' AND position(',' in r.school_key) = 0`);
  const hits = rows.filter((x) => coreName(x.school_names) === core);
  if (hits.length !== 1) return '';
  const h = hits[0];
  return `[재학 학교 해설 — 원장이 검토한 대표본 · ${h.school_names}${h.data_year ? ` · ${h.data_year}학년도 공시 기준` : ''}]
${briefOf(h.content)}
→ 내신 경쟁 강도·과목 선택·전형 유불리를 판단할 때 이 학교 환경을 반영하라. 학교 공시 수치는 학교 전체 이야기이지 이 학생 개인의 성적이 아니다.`;
}

/** 상담 에이전트 search_knowledge 용 — 질문에 든 학교 이름이 걸린 대표본(비교 해설 포함) */
export async function searchRepBriefs(words, limit = 3) {
  const cores = [...new Set((words || []).map(coreName).filter((w) => w.length >= 3 && /[고중]$/.test(w)))].slice(0, 6);
  if (!dbEnabled() || !cores.length) return [];
  const { rows } = await getPool().query(
    `SELECT r.title, r.school_names, r.content, ${DATA_YEAR_SQL} AS data_year FROM ef_school_reports r
      WHERE r.review_status = 'rep' AND r.school_key <> ''`);
  return rows
    .map((x) => ({ ...x, hits: x.school_names.split(/\s*,\s*/).filter((n) => cores.includes(coreName(n))).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit)
    .map((x) => ({ 종류: '학교해설', 제목: `${x.title}${x.data_year ? ` (${x.data_year}학년도 공시)` : ''}`, 관련도: null, 내용: briefOf(x.content, 1800) }));
}
