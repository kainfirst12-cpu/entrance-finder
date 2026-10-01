// services/seminarStore.js — 🎤 설명회 자료 만들기: 담당 학교·옵션·해설 문구 보관(선생님별)
//   슬라이드는 저장하지 않는다 — 화면이 열 때마다 최신 학교알리미 데이터로 다시 그린다(새 공시가 들어오면 숫자가 저절로 바뀐다).
import { getPool, dbEnabled } from './db.js';

export async function ensureSeminarTable() {
  if (!dbEnabled()) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS ef_seminar_decks (
      id          SERIAL PRIMARY KEY,
      owner_id    INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
      title       TEXT NOT NULL DEFAULT '설명회 자료',
      school_ids  JSONB NOT NULL DEFAULT '[]'::jsonb,   -- catalog school.id 목록(담당 학교)
      options     JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { part, title, region, startPage, semester, includeCover }
      notes       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { [schoolId]: { subjects:{국어:'…'}, strong, weak, typeLine } } AI·직접 수정 문구
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await getPool().query(`CREATE INDEX IF NOT EXISTS idx_ef_seminar_decks_owner ON ef_seminar_decks(owner_id);`);
}

const clean = (body = {}) => ({
  title: String(body.title || '설명회 자료').slice(0, 200),
  school_ids: JSON.stringify((Array.isArray(body.school_ids) ? body.school_ids : []).map(String).slice(0, 200)),
  options: JSON.stringify(body.options && typeof body.options === 'object' ? body.options : {}),
  notes: JSON.stringify(body.notes && typeof body.notes === 'object' ? body.notes : {}),
});

export async function listSeminarDecks(ownerId) {
  const { rows } = await getPool().query(
    `SELECT id, title, school_ids, options, updated_at FROM ef_seminar_decks WHERE owner_id = $1 ORDER BY updated_at DESC`, [ownerId]);
  return rows;
}
export async function getSeminarDeck(id) {
  const { rows } = await getPool().query(`SELECT * FROM ef_seminar_decks WHERE id = $1`, [id]);
  return rows[0] || null;
}
export async function createSeminarDeck(ownerId, body) {
  const c = clean(body);
  const { rows } = await getPool().query(
    `INSERT INTO ef_seminar_decks (owner_id, title, school_ids, options, notes) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb) RETURNING *`,
    [ownerId, c.title, c.school_ids, c.options, c.notes]);
  return rows[0];
}
export async function updateSeminarDeck(id, body) {
  const c = clean(body);
  const { rows } = await getPool().query(
    `UPDATE ef_seminar_decks SET title = $2, school_ids = $3::jsonb, options = $4::jsonb, notes = $5::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, c.title, c.school_ids, c.options, c.notes]);
  return rows[0] || null;
}
export async function deleteSeminarDeck(id) {
  await getPool().query(`DELETE FROM ef_seminar_decks WHERE id = $1`, [id]);
}
