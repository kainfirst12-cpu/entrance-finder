// 대학별 **원서 마감 시각** — 날짜가 아니라 시각까지.
//
// 왜 시각이 필요한가: 경쟁률은 마감 직전 몇 시간에 폭발한다. 마감이 17시인 대학과 18시인
// 대학을 같은 시각에 비교하면 아무 뜻이 없다. '마감 D-1 18시' 같은 비교선을 만들려면
// 대학마다 몇 시에 닫는지를 알아야 한다. 목록 페이지는 날짜까지만 준다.
//
// 어디서 캐나 — 대행사마다 다른 곳에 숨어 있다:
//  · 유웨이: 원서접수 사이트가 프레임셋인데 그 frame 주소에 ENDDATE=20260911170000 이 실려 있다.
//  · 진학: '원서 안내' 페이지의 남은시간 타이머가 data-days/hours/minutes/seconds 로 그려진다.
//         지금 시각에 남은 만큼을 더해 마감 시각을 되짚는다(그래서 5분 단위로 반올림한다 —
//         왕복 지연 때문에 초 단위로는 몇 초씩 흔들린다. 실제 마감은 늘 정각·반이다).
import { fetchHtml } from './fetchHtml.mjs';
import { loadSources, SOURCES_FILE } from './sources.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KST = 9 * 3600 * 1000;

/** 'YYYYMMDDHHMMSS'(한국시각) → ISO 문자열 */
function fromUwayStamp(s) {
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) - KST).toISOString();
}

/** 남은 시간을 지금에 더해 마감 시각을 되짚는다. 5분 단위로 맞춘다. */
function fromRemaining({ days, hours, minutes, seconds }) {
  const ms = ((days * 24 + hours) * 60 + minutes) * 60000 + seconds * 1000;
  if (ms <= 0) return null;
  const raw = Date.now() + ms;
  const step = 5 * 60000;
  return new Date(Math.round(raw / step) * step).toISOString();
}

/** 유웨이 — 접수 사이트 프레임 주소에서 STARTDATE/ENDDATE */
export async function uwayDeadline(applyUrl) {
  const { html } = await fetchHtml(applyUrl, { timeoutMs: 20000 });
  const end = (html.match(/ENDDATE=(\d{14})/) || [])[1];
  const start = (html.match(/STARTDATE=(\d{14})/) || [])[1];
  if (!end) return null;
  return { closesAt: fromUwayStamp(end), opensAt: start ? fromUwayStamp(start) : null, via: 'uway-frame' };
}

/** 진학 — 경쟁률 주소에서 안내 페이지 번호를 뽑아 타이머를 읽는다.
 *  Ratio1003038 1 .html → /Notice/1003038/A  (뒤 한 자리는 회차 표시라 뗀다) */
export function jinhakNoticeUrl(ratioUrl) {
  const m = String(ratioUrl || '').match(/Ratio(\d{7})\d?\.html/i);
  return m ? `https://apply.jinhakapply.com/Notice/${m[1]}/A` : null;
}

export async function jinhakDeadline(ratioUrl) {
  const url = jinhakNoticeUrl(ratioUrl);
  if (!url) return null;
  const { html } = await fetchHtml(url, { timeoutMs: 20000 });
  const tag = (html.match(/id="RightQuickMenuControl_sp_applytotime"[^>]*/) || [])[0];
  if (!tag) return null;
  // 정규식은 문자열로 조립하되 역슬래시를 쓰지 않는다 — 템플릿 문자열 안에서 한 겹 먹혀
  // data-days="(-?d+)" 가 되어 아무것도 못 잡았다(그래서 한동안 전부 0으로 읽혔다).
  const g = (k) => { const m = tag.match(new RegExp('data-' + k + '="(-?[0-9]+)"')); return m ? Number(m[1]) : 0; };
  const closesAt = fromRemaining({ days: g('days'), hours: g('hours'), minutes: g('minutes'), seconds: g('seconds') });
  return closesAt ? { closesAt, opensAt: null, via: 'jinhak-timer' } : null;
}

export async function resolveAll({ concurrency = 4, gapMs = 700, onProgress } = {}) {
  const list = await loadSources();
  const out = [];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency);
    const done = await Promise.all(batch.map(async (s) => {
      try {
        if (s.applyUrl && /uwayapply/.test(s.applyUrl)) {
          const d = await uwayDeadline(s.applyUrl);
          if (d) return { univ: s.univ, ...d };
        }
        if (s.kind === 'jinhak' && s.ratioUrl) {
          const d = await jinhakDeadline(s.ratioUrl);
          if (d) return { univ: s.univ, ...d };
        }
      } catch { /* 한 곳이 막혀도 나머지는 계속 */ }
      return { univ: s.univ, closesAt: null, opensAt: null, via: null };
    }));
    out.push(...done);
    if (onProgress) onProgress(out.length, list.length);
    if (i + concurrency < list.length) await sleep(gapMs);
  }
  return out;
}

/** 알아낸 마감 시각을 sources.json 에 적어 넣는다(수집기·화면이 같은 파일을 본다). */
export async function mergeIntoSources(deadlines) {
  const raw = JSON.parse(await fs.readFile(SOURCES_FILE, 'utf8'));
  const byName = new Map(deadlines.map((d) => [d.univ, d]));
  for (const s of raw.list) {
    const d = byName.get(s.univ);
    if (!d) continue;
    s.closesAt = d.closesAt || s.closesAt || null;
    s.opensAt = d.opensAt || s.opensAt || null;
    s.deadlineVia = d.via || s.deadlineVia || null;
  }
  raw.deadlinesAt = new Date().toISOString();
  await fs.writeFile(SOURCES_FILE, JSON.stringify(raw, null, 2), 'utf8');
  return raw.list;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ds = await resolveAll({ onProgress: (n, t) => process.stdout.write(`\r마감시각 확인 ${n}/${t}`) });
  process.stdout.write('\n');
  const list = await mergeIntoSources(ds);
  const got = list.filter((s) => s.closesAt);
  console.log(`마감 시각 확보 ${got.length} / ${list.length}곳`);
  const fmt = (iso) => new Date(new Date(iso).getTime() + KST).toISOString().replace('T', ' ').slice(0, 16);
  const tally = {};
  for (const s of got) { const k = fmt(s.closesAt); tally[k] = (tally[k] || 0) + 1; }
  console.log('마감 시각 분포(한국시각):');
  for (const [k, v] of Object.entries(tally).sort()) console.log(`  ${k}  ${v}곳`);
}
