// services/db.js — Postgres 기반 사용자 코드 / 세션 / 사용량 추적
// DATABASE_URL 이 없으면 자동으로 비활성화되며, 이 경우 로그인은 환경변수 코드(ADMIN_CODE/APP_PASSWORD)로만 동작한다.
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

let pool = null;
let ready = false;

export function dbEnabled() {
  return ready && !!pool;
}

// ── 초기화 (부팅 시 1회) ──────────────────────────────
export async function initDb() {
  if (!process.env.DATABASE_URL) {
    console.warn('[DB] DATABASE_URL 없음 — 코드 관리/사용량 추적 비활성화 (로그인은 환경변수 코드로 동작)');
    return;
  }
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30000,
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_users (
        id         SERIAL PRIMARY KEY,
        code       TEXT UNIQUE NOT NULL,
        name       TEXT NOT NULL DEFAULT '',
        role       TEXT NOT NULL DEFAULT 'user',
        active     BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id           SERIAL PRIMARY KEY,
        user_id      INTEGER REFERENCES app_users(id) ON DELETE CASCADE,
        jti          TEXT UNIQUE NOT NULL,
        ip           TEXT,
        user_agent   TEXT,
        geo          TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
        type       TEXT NOT NULL,
        detail     TEXT,
        ip         TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_lastseen ON sessions(last_seen_at);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, created_at);`);

    ready = true;
    console.log('[DB] Postgres 연결 및 스키마 준비 완료');
  } catch (e) {
    console.error('[DB] 초기화 실패 — 추적 기능 비활성화로 계속 진행:', e.message);
    pool = null;
    ready = false;
  }
}

// ── 코드 생성 ────────────────────────────────────────
export function generateCode(len = 8) {
  // 혼동 쉬운 문자(0,O,1,I,l) 제외
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

// ── 사용자 코드 CRUD ──────────────────────────────────
export async function findActiveUserByCode(code) {
  if (!dbEnabled() || !code) return null;
  const { rows } = await pool.query(
    `SELECT id, code, name, role, active FROM app_users WHERE code = $1 AND active = true LIMIT 1`,
    [code]
  );
  return rows[0] || null;
}

export async function createUserCode(name) {
  if (!dbEnabled()) throw new Error('DB 비활성화 상태입니다');
  // 코드 중복 방지 재시도
  for (let i = 0; i < 5; i++) {
    const code = generateCode(8);
    try {
      const { rows } = await pool.query(
        `INSERT INTO app_users (code, name, role) VALUES ($1, $2, 'user') RETURNING id, code, name, role, active, created_at`,
        [code, name || '']
      );
      return rows[0];
    } catch (e) {
      if (e.code === '23505') continue; // unique 충돌 → 재생성
      throw e;
    }
  }
  throw new Error('코드 생성 실패 (중복)');
}

export async function setUserActive(id, active) {
  if (!dbEnabled()) throw new Error('DB 비활성화 상태입니다');
  await pool.query(`UPDATE app_users SET active = $2 WHERE id = $1`, [id, !!active]);
}

export async function deleteUser(id) {
  if (!dbEnabled()) throw new Error('DB 비활성화 상태입니다');
  await pool.query(`DELETE FROM app_users WHERE id = $1`, [id]);
}

// 사용자 목록 + 사용량 통계 (분석 횟수, 마지막 접속, 현재 접속 여부)
export async function listUsersWithStats() {
  if (!dbEnabled()) return [];
  const { rows } = await pool.query(`
    SELECT
      u.id, u.code, u.name, u.role, u.active, u.created_at,
      COALESCE(a.analyze_count, 0)  AS analyze_count,
      COALESCE(e.event_count, 0)    AS event_count,
      s.last_seen_at,
      (s.last_seen_at > now() - interval '3 minutes') AS online
    FROM app_users u
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS analyze_count FROM events WHERE type = 'analyze' GROUP BY user_id
    ) a ON a.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS event_count FROM events GROUP BY user_id
    ) e ON e.user_id = u.id
    LEFT JOIN (
      SELECT DISTINCT ON (user_id) user_id, last_seen_at FROM sessions ORDER BY user_id, last_seen_at DESC
    ) s ON s.user_id = u.id
    ORDER BY u.created_at DESC
  `);
  return rows;
}

// 현재 접속 중인 사용자 (최근 3분 내 하트비트)
export async function listActiveSessions() {
  if (!dbEnabled()) return [];
  const { rows } = await pool.query(`
    SELECT
      s.id, s.ip, s.geo, s.user_agent, s.created_at, s.last_seen_at,
      u.name, u.code,
      EXTRACT(EPOCH FROM (s.last_seen_at - s.created_at))::int AS duration_sec
    FROM sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.last_seen_at > now() - interval '3 minutes'
    ORDER BY s.last_seen_at DESC
  `);
  return rows;
}

// 최근 접속/사용 로그
export async function listRecentLogs(limit = 100) {
  if (!dbEnabled()) return [];
  const { rows } = await pool.query(`
    SELECT e.id, e.type, e.detail, e.ip, e.created_at, u.name, u.code
    FROM events e
    LEFT JOIN app_users u ON u.id = e.user_id
    ORDER BY e.created_at DESC
    LIMIT $1
  `, [Math.min(limit, 500)]);
  return rows;
}

// ── 세션 / 이벤트 기록 ────────────────────────────────
export async function createSession({ userId, jti, ip, userAgent, geo }) {
  if (!dbEnabled() || !userId) return;
  try {
    await pool.query(
      `INSERT INTO sessions (user_id, jti, ip, user_agent, geo) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (jti) DO UPDATE SET last_seen_at = now()`,
      [userId, jti, ip || null, (userAgent || '').slice(0, 300), geo || null]
    );
  } catch (e) {
    console.warn('[DB] createSession 실패:', e.message);
  }
}

export async function touchSession(jti) {
  if (!dbEnabled() || !jti) return;
  try {
    await pool.query(`UPDATE sessions SET last_seen_at = now() WHERE jti = $1`, [jti]);
  } catch (e) {
    console.warn('[DB] touchSession 실패:', e.message);
  }
}

export async function logEvent({ userId, type, detail, ip }) {
  if (!dbEnabled()) return;
  try {
    await pool.query(
      `INSERT INTO events (user_id, type, detail, ip) VALUES ($1,$2,$3,$4)`,
      [userId || null, type, (detail || '').slice(0, 500), ip || null]
    );
  } catch (e) {
    console.warn('[DB] logEvent 실패:', e.message);
  }
}

// ── IP 위치 조회 (ip-api.com 무료, 키 불필요) ──────────
export async function lookupGeo(ip) {
  if (!ip) return null;
  // 사설/로컬 IP는 스킵
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1|localhost)/.test(ip)) {
    return '로컬/사설망';
  }
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,regionName,city&lang=ko`,
      { signal: controller.signal }
    );
    clearTimeout(t);
    const data = await res.json();
    if (data.status === 'success') {
      return [data.country, data.regionName, data.city].filter(Boolean).join(' ') || null;
    }
  } catch (e) {
    console.warn('[DB] geo 조회 실패:', e.message);
  }
  return null;
}
