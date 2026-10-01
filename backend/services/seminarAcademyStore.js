// services/seminarAcademyStore.js — 설명회 ③ 학원 소개(학원 코드마다 한 벌) + 🔗 공유 링크(슬라이드 스냅숏)
//   학원 소개는 공통본과 같은 슬라이드 데이터(레이아웃 + 사진)라 같은 렌더러로 그린다.
//   공유 링크는 '보낸 순간의 슬라이드'를 그대로 얼려 둔다 — 학부모님이 링크를 열 때 로그인 없이 본다.
import crypto from 'crypto';
import { getPool, dbEnabled } from './db.js';

export async function ensureSeminarAcademyTables() {
  if (!dbEnabled()) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ef_seminar_academy (
      owner_id   INTEGER PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL DEFAULT '우리 학원 소개',
      info       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { phone, address, sns, closing } 마무리 슬라이드 연락처
      slides     JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ef_seminar_shares (
      token      TEXT PRIMARY KEY,
      owner_id   INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      academy    TEXT DEFAULT '',
      slides     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- 그려진 요소 목록 [{title, els}] (SlidePreview 가 그대로 그린다)
      views      INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_ef_seminar_shares_owner ON ef_seminar_shares(owner_id);`);
}

export async function getAcademy(ownerId) {
  const { rows } = await getPool().query(`SELECT * FROM ef_seminar_academy WHERE owner_id = $1`, [ownerId]);
  return rows[0] || null;
}
export async function saveAcademy(ownerId, { title, info, slides }) {
  const { rows } = await getPool().query(
    `INSERT INTO ef_seminar_academy (owner_id, title, info, slides) VALUES ($1, $2, $3::jsonb, $4::jsonb)
     ON CONFLICT (owner_id) DO UPDATE SET title = EXCLUDED.title, info = EXCLUDED.info, slides = EXCLUDED.slides, updated_at = now() RETURNING *`,
    [ownerId, String(title || '우리 학원 소개').slice(0, 200), JSON.stringify(info && typeof info === 'object' ? info : {}), JSON.stringify(Array.isArray(slides) ? slides : [])]);
  return rows[0];
}

export async function createShare(ownerId, { title, academy, slides }) {
  const token = crypto.randomBytes(9).toString('base64url'); // 12자 — 추측 불가
  await getPool().query(`INSERT INTO ef_seminar_shares (token, owner_id, title, academy, slides) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [token, ownerId, String(title || '설명회 자료').slice(0, 200), String(academy || '').slice(0, 100), JSON.stringify(slides)]);
  return token;
}
export async function listShares(ownerId) {
  const { rows } = await getPool().query(`SELECT token, title, views, created_at, jsonb_array_length(slides) AS slide_count FROM ef_seminar_shares WHERE owner_id = $1 ORDER BY created_at DESC`, [ownerId]);
  return rows;
}
export async function readShare(token) {
  const { rows } = await getPool().query(`UPDATE ef_seminar_shares SET views = views + 1 WHERE token = $1 RETURNING token, title, academy, slides, created_at`, [token]);
  return rows[0] || null;
}
export async function deleteShare(ownerId, token) {
  await getPool().query(`DELETE FROM ef_seminar_shares WHERE token = $1 AND owner_id = $2`, [token, ownerId]);
}
