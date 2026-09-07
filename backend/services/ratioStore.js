// services/ratioStore.js — 실시간 경쟁률 적재·조회.
//
// 적재 규칙 하나만 기억하면 된다: **바뀐 것만 넣는다.**
// 모집단위가 33,000줄인데 한 시간마다 통째로 쌓으면 닷새에 400만 줄이 된다. 그런데 접수
// 초반에는 대부분 그대로다. 직전 값과 지원인원이 같으면 넣지 않는다 — 늘어나는 구간
// (마감 직전)만 촘촘해지고, 그 구간이 정확히 우리가 보고 싶은 곳이다.
import { getPool, dbEnabled } from './db.js';

/** 대학 메타(주소·접수기간·마감시각) 갱신 — 주소록을 새로 받을 때마다. */
export async function upsertUnivs(list) {
  if (!dbEnabled()) return 0;
  const pool = getPool();
  let n = 0;
  for (const s of list) {
    await pool.query(
      `INSERT INTO ef_ratio_univ (univ, region, kind, ratio_url, apply_url, period_start, period_end, opens_at, closes_at, home_url, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (univ) DO UPDATE SET
         region = EXCLUDED.region, kind = EXCLUDED.kind,
         ratio_url = EXCLUDED.ratio_url, apply_url = EXCLUDED.apply_url,
         period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
         home_url  = COALESCE(EXCLUDED.home_url,  ef_ratio_univ.home_url),
         opens_at  = COALESCE(EXCLUDED.opens_at,  ef_ratio_univ.opens_at),
         closes_at = COALESCE(EXCLUDED.closes_at, ef_ratio_univ.closes_at),
         updated_at = now()`,
      [s.univ, s.region || '', s.kind || '', s.ratioUrl || '', s.applyUrl || '',
        s.periodStart || null, s.periodEnd || null, s.opensAt || null, s.closesAt || null, s.homeUrl || null],
    );
    n += 1;
  }
  return n;
}

/** 그 대학의 가장 최근 관측값 — 바뀐 것만 넣기 위한 비교 기준. */
async function latestOf(univ) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (jeonhyeong, unit) jeonhyeong, unit, applicants, ratio
       FROM ef_ratio_point WHERE univ = $1
      ORDER BY jeonhyeong, unit, captured_at DESC`,
    [univ],
  );
  const m = new Map();
  for (const r of rows) m.set(`${r.jeonhyeong} ${r.unit}`, r);
  return m;
}

/**
 * 한 대학의 수집 결과를 넣는다. 직전과 지원인원이 같은 줄은 건너뛴다.
 * @returns 실제로 넣은 줄 수
 */
export async function saveUnivUnits(univ, units, capturedAt) {
  if (!dbEnabled()) return 0;
  const pool = getPool();
  const prev = await latestOf(univ);
  const rows = [];
  for (const u of units) {
    if (u.isTotal) continue;   // 소계·총계는 검산용이라 시계열엔 넣지 않는다
    const key = `${u.jeonhyeong || ''} ${u.unit}`;
    const before = prev.get(key);
    if (before && Number(before.applicants) === Number(u.applicants)) continue;
    rows.push(u);
  }
  if (!rows.length) return 0;

  // 한 번에 넣는다 — 대학마다 수백 줄이라 한 줄씩 보내면 왕복만으로 시간이 다 간다.
  const vals = [];
  const params = [];
  rows.forEach((u, i) => {
    const b = i * 8;
    vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`);
    params.push(univ, u.jeonhyeong || '', u.campus || '', u.unit, u.capacity, u.applicants, u.ratio, capturedAt);
  });
  await pool.query(
    `INSERT INTO ef_ratio_point (univ, jeonhyeong, campus, unit, capacity, applicants, ratio, captured_at)
     VALUES ${vals.join(',')}`,
    params,
  );
  return rows.length;
}

export async function recordRun({ startedAt, ok, fail, points, note = '' }) {
  if (!dbEnabled()) return;
  await getPool().query(
    `INSERT INTO ef_ratio_run (started_at, ok_count, fail_count, point_count, note) VALUES ($1,$2,$3,$4,$5)`,
    [startedAt, ok, fail, points, note],
  );
}

// 조회 ────────────────────────────────────────────────

/** 대학 목록 + 마지막으로 값이 바뀐 시각 */
export async function listUnivs() {
  if (!dbEnabled()) return [];
  // 상관 서브쿼리 대신 조인 — 뜻은 같고, 계획도 더 낫다(대학 166줄 × 관측 수백만 줄).
  const { rows } = await getPool().query(
    `SELECT u.*, s.last_seen
       FROM ef_ratio_univ u
       LEFT JOIN (SELECT univ, max(captured_at) AS last_seen FROM ef_ratio_point GROUP BY univ) s
              ON s.univ = u.univ
      ORDER BY u.closes_at NULLS LAST, u.univ`,
  );
  return rows;
}

/** 한 대학의 지금 값(모집단위별 최신) */
export async function currentOf(univ) {
  if (!dbEnabled()) return [];
  const { rows } = await getPool().query(
    `SELECT DISTINCT ON (jeonhyeong, unit) jeonhyeong, campus, unit, capacity, applicants, ratio, captured_at
       FROM ef_ratio_point WHERE univ = $1
      ORDER BY jeonhyeong, unit, captured_at DESC`,
    [univ],
  );
  return rows;
}

/** 한 모집단위의 시간별 흐름 — 마감 직전 곡선을 그리는 데 쓴다 */
export async function seriesOf(univ, jeonhyeong, unit) {
  if (!dbEnabled()) return [];
  const { rows } = await getPool().query(
    `SELECT captured_at, capacity, applicants, ratio
       FROM ef_ratio_point
      WHERE univ = $1 AND jeonhyeong = $2 AND unit = $3
      ORDER BY captured_at`,
    [univ, jeonhyeong, unit],
  );
  return rows;
}
