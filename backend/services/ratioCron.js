// services/ratioCron.js — 실시간 경쟁률 자동 수집.
//
// 왜 서버 안에서 도나(별도 크론이 아니라): 원서접수는 1년에 열흘이다. 그 열흘을 위해
// 스케줄러를 따로 두면 다음 해에 아무도 그게 있는 줄 모른다. 서버가 스스로
// **접수 기간인지 보고**, 기간이 아니면 아무 일도 하지 않는다 — 설정을 잊을 자리가 없다.
//
// 얼마나 자주: 평소 30분. 어느 대학이든 마감 3시간 안이면 10분.
// 경쟁률은 마감 직전 몇 시간에 몰려 오르므로 그때만 촘촘히 본다.
import { collectAll } from '../scrapers/ratio/collect.mjs';
import { loadSources, scrapeSources } from '../scrapers/ratio/sources.mjs';
import { upsertUnivs, saveUnivUnits, recordRun, listUnivs } from './ratioStore.js';
import { dbEnabled } from './db.js';

const MIN = 60 * 1000;
const BASE_INTERVAL = 30 * MIN;
const RUSH_INTERVAL = 10 * MIN;
const RUSH_WINDOW = 3 * 60 * MIN;       // 마감 3시간 전부터는 촘촘히
const AFTER_CLOSE_GRACE = 2 * 60 * MIN; // 마감 뒤 2시간까지는 최종값을 받으러 더 돈다

let timer = null;
let running = false;
let lastRun = null;

/** 접수 기간 안인가 — 주소록의 시작·마감 시각으로 판단한다. */
function windowOf(list) {
  const opens = list.map((s) => s.opensAt || s.periodStart).filter(Boolean).map((d) => new Date(d).getTime());
  const closes = list.map((s) => s.closesAt).filter(Boolean).map((d) => new Date(d).getTime());
  if (!closes.length) return null;
  return { from: opens.length ? Math.min(...opens) : Math.min(...closes) - 7 * 24 * 60 * MIN, to: Math.max(...closes) + AFTER_CLOSE_GRACE };
}

function nextInterval(list) {
  const now = Date.now();
  const soon = list
    .map((s) => (s.closesAt ? new Date(s.closesAt).getTime() : null))
    .filter((t) => t && t > now && t - now <= RUSH_WINDOW);
  return soon.length ? RUSH_INTERVAL : BASE_INTERVAL;
}

/** 한 바퀴 — 읽어서 DB에 넣는다. 바뀐 줄만 들어간다. */
export async function runOnce({ force = false } = {}) {
  if (running) return { skipped: '이미 도는 중' };
  running = true;
  const startedAt = new Date().toISOString();
  try {
    let list = await loadSources();
    const win = windowOf(list);
    const now = Date.now();
    if (!force && win && (now < win.from || now > win.to)) {
      return { skipped: '접수 기간이 아님', window: win };
    }
    await upsertUnivs(list);

    const snap = await collectAll({ concurrency: 4, gapMs: 800 });
    let ok = 0; let fail = 0; let points = 0;
    for (const r of snap.results) {
      if (!r.ok) { fail += 1; continue; }
      ok += 1;
      try { points += await saveUnivUnits(r.univ, r.units, snap.collectedAt); }
      catch (e) { console.warn('[ratio] 저장 실패', r.univ, e.message); }
    }
    await recordRun({ startedAt, ok, fail, points });
    lastRun = { startedAt, finishedAt: new Date().toISOString(), ok, fail, points };
    console.log(`[ratio] 수집 완료 — 성공 ${ok} / 실패 ${fail} · 새 관측 ${points}줄`);
    return lastRun;
  } finally {
    running = false;
  }
}

/** 주소록 새로 받기 — 해마다 주소가 바뀌므로 가끔 다시 받아야 한다. */
export async function refreshSources() {
  const list = await scrapeSources();
  await upsertUnivs(list);
  return list.length;
}

export function ratioStatus() {
  return { running, lastRun, scheduled: !!timer };
}

export async function startRatioCron() {
  if (timer) return;
  if (!dbEnabled()) {
    console.log('[ratio] DATABASE_URL 없음 — 자동 수집을 켜지 않는다(수동 실행은 가능)');
    return;
  }
  const tick = async () => {
    try {
      const r = await runOnce();
      if (r?.skipped) console.log('[ratio]', r.skipped);
    } catch (e) {
      console.warn('[ratio] 수집 중 오류:', e.message);
    }
    const list = await loadSources().catch(() => []);
    timer = setTimeout(tick, nextInterval(list));
  };
  // 부팅 직후 바로 한 번 돌지 않는다 — 배포가 잦으면 그때마다 175곳을 두드리게 된다.
  timer = setTimeout(tick, 2 * MIN);
  console.log('[ratio] 자동 수집 예약됨(접수 기간에만 실제로 돈다)');
}

export async function upcomingDeadlines() {
  const rows = await listUnivs();
  const now = Date.now();
  return rows.map((r) => ({
    univ: r.univ,
    region: r.region,
    closesAt: r.closes_at,
    opensAt: r.opens_at,
    periodEnd: r.period_end,
    lastSeen: r.last_seen,
    ratioUrl: r.ratio_url,
    // 남은 시간(분) — 지났으면 음수
    minutesLeft: r.closes_at ? Math.round((new Date(r.closes_at).getTime() - now) / MIN) : null,
  }));
}
