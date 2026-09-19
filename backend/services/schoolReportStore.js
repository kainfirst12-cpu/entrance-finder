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
}

const COLS = 'id, owner_id, kind, title, school_ids, school_names, focus, created_at, updated_at';

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
    `INSERT INTO ef_school_reports (owner_id, kind, title, school_ids, school_names, focus, content, snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [ownerId, f.kind === 'compare' ? 'compare' : 'school', String(f.title || '학교 입시 해설').slice(0, 200),
     JSON.stringify(Array.isArray(f.schoolIds) ? f.schoolIds : []), String(f.schoolNames || '').slice(0, 500),
     String(f.focus || '').slice(0, 2000), String(f.content || ''), JSON.stringify(f.snapshot || {})],
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
