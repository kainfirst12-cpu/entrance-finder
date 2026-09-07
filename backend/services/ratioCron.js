// services/ratioCron.js — 실시간 경쟁률 자동 수집.
//
// 왜 서버 안에서 도나(별도 크론이 아니라): 원서접수는 1년에 열흘이다. 그 열흘을 위해
// 스케줄러를 따로 두면 다음 해에 아무도 그게 있는 줄 모른다. 서버가 스스로
// **접수 기간인지 보고**, 기간이 아니면 아무 일도 하지 않는다 — 설정을 잊을 자리가 없다.
//
// 얼마나 자주: 평소 30분. 어느 대학이든 마감 3시간 안이면 10분.
// 경쟁률은 마감 직전 몇 시간에 몰려 오르므로 그때만 촘촘히 본다.
import { upsertUnivs, saveUnivUnits, recordRun, listUnivs } from './ratioStore.js';
import { dbEnabled } from './db.js';

// ⚠ 수집기(node-html-parser·iconv-lite 를 쓴다)는 **필요할 때 불러온다.**
// 맨 위에서 import 하면 그 묶음이 하나라도 안 깔린 서버에서 **서버 자체가 못 뜬다**
// (2026-09-07 실제로 Railway 가 502 로 죽었다 — 경쟁률 기능 하나 때문에 앱 전체가 멈추면 안 된다).
// 늦게 부르면 실패해도 이 기능만 조용히 꺼지고 상담·분석은 그대로 돌아간다.
async function scrapers() {
  const [collect, sources] = await Promise.all([
    import('../scrapers/ratio/collect.mjs'),
    import('../scrapers/ratio/sources.mjs'),
  ]);
  return { ...collect, ...sources };
}

const MIN = 60 * 1000;
const BASE_INTERVAL = 30 * MIN;
const RUSH_INTERVAL = 10 * MIN;
const RUSH_WINDOW = 3 * 60 * MIN;       // 마감 3시간 전부터는 촘촘히
const AFTER_CLOSE_GRACE = 2 * 60 * MIN; // 마감 뒤 2시간까지는 최종값을 받으러 더 돈다

let timer = null;
let running = false;
let lastRun = null;
// 한 바퀴 도는 데 몇 분이 걸린다. 부르는 쪽이 기다리지 않고 진행 상황만 물어볼 수 있게 남긴다.
let progress = null;
// 뒤에서 도는 일이 실패하면 아무도 모른다 — 화면이 물어볼 수 있게 마지막 실패를 들고 있는다.
let lastError = null;

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
  if (running) return { skipped: '이미 도는 중', progress };
  running = true;
  const startedAt = new Date().toISOString();
  progress = { startedAt, stage: '주소록 읽는 중', done: 0, total: 0, ok: 0, fail: 0, points: 0 };
  try {
    let loadSources; let collectAll;
    try {
      ({ loadSources, collectAll } = await scrapers());
    } catch (e) {
      // 여기서 걸리면 수집기 묶음이 서버에 없거나 런타임과 안 맞는다는 뜻이다. 원인을 그대로 남긴다.
      throw new Error(`수집기를 불러오지 못했습니다(node-html-parser·iconv-lite 설치 확인): ${e?.message || e}`);
    }
    const list = await loadSources();
    if (!list.length) throw new Error('주소록(sources.json)이 비어 있거나 읽히지 않습니다');
    const win = windowOf(list);
    const now = Date.now();
    if (!force && win && (now < win.from || now > win.to)) {
      progress = null;
      return { skipped: '접수 기간이 아님', window: win };
    }
    // 대학 목록·마감 시각을 **먼저** 넣는다 — 경쟁률을 다 받기 전에도 화면에
    // '어디가 언제 닫는지'는 바로 떠야 한다(그것만으로도 쓸모가 있다).
    await upsertUnivs(list);
    progress = { ...progress, stage: '경쟁률 받는 중', total: list.filter((s2) => s2.ratioUrl).length };

    // 대학 한 곳을 받으면 그 자리에서 넣고 버린다 — 166곳 × 수백 줄을 다 들고 있으면
    // 작은 서버에서는 메모리로 죽는다(그러면 앱 전체가 함께 죽는다).
    const capturedAt = new Date().toISOString();
    let ok = 0; let fail = 0; let points = 0;
    await collectAll({
      concurrency: 3,
      gapMs: 1000,
      onProgress: async (_done, _total, batch) => {
        for (const r of batch) {
          if (!r.ok) { fail += 1; continue; }
          ok += 1;
          try { points += await saveUnivUnits(r.univ, r.units, capturedAt); }
          catch (e) { console.warn('[ratio] 저장 실패', r.univ, e.message); }
          r.units = null;   // 붙들고 있을 이유가 없다
          r.summary = null;
        }
        progress = { ...progress, done: _done, ok, fail, points };
      },
    });
    await recordRun({ startedAt, ok, fail, points });
    lastRun = { startedAt, finishedAt: new Date().toISOString(), ok, fail, points };
    progress = null;
    console.log(`[ratio] 수집 완료 — 성공 ${ok} / 실패 ${fail} · 새 관측 ${points}줄`);
    return lastRun;
  } finally {
    running = false;
  }
}

/** 주소록 새로 받기 — 해마다 주소가 바뀌므로 가끔 다시 받아야 한다. */
export async function refreshSources() {
  const { scrapeSources } = await scrapers();
  const list = await scrapeSources();
  await upsertUnivs(list);
  return list.length;
}

export function ratioStatus() {
  return { running, lastRun, progress, lastError, scheduled: !!timer, cronEnabled: process.env.RATIO_CRON === 'on' };
}

/** 왜 안 되는지 스스로 짚어 본다 — 화면에 '0곳'만 뜨면 원장은 원인을 알 길이 없다. */
export async function selfCheck() {
  const out = { db: dbEnabled() ? 'ok' : 'DATABASE_URL 없음', scrapers: null, sources: null };
  try {
    const { loadSources } = await scrapers();
    out.scrapers = 'ok';
    try {
      const list = await loadSources();
      out.sources = `${list.length}곳`;
    } catch (e) { out.sources = `읽기 실패: ${e?.message || e}`; }
  } catch (e) {
    out.scrapers = `불러오기 실패: ${e?.message || e}`;
    out.sources = '확인 못 함';
  }
  return out;
}

/** 한 바퀴를 뒤에서 돌린다 — 부르는 쪽은 기다리지 않는다.
 *  166곳을 도는 데 몇 분이 걸려서, 한 번의 HTTP 요청 안에 넣으면 브라우저가 먼저 끊는다
 *  (원장 화면에 'Failed to fetch' 로 보였다 — 2026-09-07). */
export function runInBackground(opts = {}) {
  if (running) return { started: false, reason: '이미 도는 중', progress };
  lastError = null;
  runOnce(opts).catch((e) => {
    progress = null;
    lastError = { at: new Date().toISOString(), message: String(e?.message || e) };
    console.warn('[ratio] 수집 실패:', e?.message || e);
  });
  return { started: true };
}

export async function startRatioCron() {
  if (timer) return;
  // 켜는 건 사람이 정한다(RATIO_CRON=on). 스스로 도는 일이 앱을 멈추게 한 적이 있어서,
  // 기본은 꺼짐이다 — 화면의 '지금 한 바퀴'는 이 값과 무관하게 언제나 쓸 수 있다.
  if (process.env.RATIO_CRON !== 'on') {
    console.log('[ratio] 자동 수집 꺼짐 — 켜려면 RATIO_CRON=on (화면의 "지금 한 바퀴"는 그대로 동작)');
    return;
  }
  if (!dbEnabled()) {
    console.log('[ratio] DATABASE_URL 없음 — 자동 수집을 켜지 않는다(수동 실행은 가능)');
    return;
  }
  const tick = async () => {
    try {
      const r = await runOnce();
      if (r?.skipped) console.log('[ratio]', r.skipped);
    } catch (e) {
      // 여기서 새어 나가면 처리되지 않은 거절이 되어 프로세스가 통째로 죽는다.
      console.warn('[ratio] 수집 중 오류:', e?.message || e);
    }
    const list = await scrapers().then((m) => m.loadSources()).catch(() => []);
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
