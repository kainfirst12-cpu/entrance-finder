// 대학 → 실시간 경쟁률 페이지 + 원서접수 기간 주소록.
//
// ⚠ 해마다 주소가 바뀐다. 2027학년도 가톨릭대는 Ratio1003038*1*.html 인데 2026학년도는
//   Ratio1003031*1*.html 이었다. 그래서 **주소를 코드에 박지 않고 매번 목록에서 받아 온다.**
//   (처음엔 이투스 안내 페이지에서 받았는데 그 페이지가 지난 사이클에 멈춰 있어서,
//    그대로 뒀다면 작년 숫자를 올해 내내 수집할 뻔했다 — 2026-09-07 확인)
//
// 어디서 받나:
//  ① 유웨이 파워경쟁률(info.uway.com/power) — **한 장에 전부 있다.** 대학·지역·접수기간과
//     경쟁률 주소가 유웨이든 진학이든 가리지 않고 실려 있다. 이게 1순위.
//  ② 진학 스마트경쟁률(apply.jinhakapply.com/SmartRatio) — 진학 대학의 '원서 안내' 주소를
//     준다. 정확한 마감 '시각'은 그 안내 페이지에만 있어서 필요하다(①은 날짜까지만).
import { fetchHtml } from './fetchHtml.mjs';
// 목록 페이지는 DOM 파서를 쓰지 않는다.
// 유웨이 목록(info.uway.com/power)은 표 markup 이 닫히지 않은 옛날 HTML 이라,
// 관대한 파서(cheerio/parse5)만 172줄을 복원하고 가벼운 파서는 표를 아예 못 찾는다(0줄).
// 그렇다고 cheerio 로 돌아갈 수는 없다 — 배포 서버의 낮은 Node 에서 "File is not defined" 로
// 수집기가 통째로 죽는다. 목록은 모양이 단순하니 태그를 직접 훑는다.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function unTag(h) {
  return String(h || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, e) => ENTITIES[e.toLowerCase()])
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}
/** 표의 줄들 — 칸(td/th)과 링크(href·글자)만 뽑는다. `</tr>` 가 없어도 다음 `<tr` 앞에서 끊긴다. */
function tableRows(html) {
  return String(html).split(/<tr\b/i).slice(1).map((chunk) => {
    const body = chunk.split(/<\/tr>/i)[0];
    const cells = [...body.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)(?=<\/t[dh]>|<t[dh]\b|$)/gi)].map((m) => unTag(m[1]));
    // 링크 글자는 `</a>` 로 끊지 않는다 — 이 페이지는 대학 링크의 닫는 태그가 빠져 있어서,
    // `</a>` 까지 삼키면 한 줄의 링크가 전부 하나로 뭉쳐 '경쟁률 보기'를 못 가려낸다.
    const links = [...body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)(?=<a\b|<\/a>|$)/gi)]
      .map((m) => ({ href: m[1], text: unTag(m[2]) }));
    return { cells, links };
  });
}
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UWAY_INDEX = 'https://info.uway.com/power/?isApply=1';
export const JINHAK_INDEX = 'https://apply.jinhakapply.com/SmartRatio';
export const SOURCES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sources.json');

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** '가톨릭관동대학교 U' 처럼 뒤에 붙는 단독·모집군 표시를 떼어 이름만 남긴다 */
const univName = (s) => clean(s).replace(/\s*[UMㅤ]$/u, '').replace(/\s*(가|나|다|산)군?$/, '').trim();

/** 유웨이가 한 겹 감싸 둔 주소를 푼다.
 *  목록에 `ratio.uwayapply.com/power/?ratioURL=<진짜주소>&...` 로 실려 오는 대학이 있는데(23곳),
 *  그 겉장에는 표가 없어서 그대로 읽으면 전부 '표를 찾지 못함'이 된다 —
 *  고려대(서울)가 그래서 계속 비어 있었다. */
export function unwrapRatioUrl(url) {
  if (!url) return url;
  const m = String(url).match(/[?&]ratioURL=([^&]+)/i);
  if (!m) return url;
  let inner = decodeURIComponent(m[1]);
  if (inner.startsWith('//')) inner = `http:${inner}`;
  return /^https?:\/\//i.test(inner) ? inner : url;
}

export function hostKind(url) {
  if (/ratio\.uwayapply\.com/i.test(url)) return 'uway';
  if (/addon\.jinhakapply\.com/i.test(url)) return 'jinhak';
  return 'own';   // 대학이 직접 띄우는 페이지 — 모양이 제각각이라 자동 수집 대상이 아니다
}

/** '2026.09.07 ~ 2026.09.11' → { start:'2026-09-07', end:'2026-09-11' } */
function period(text) {
  const m = clean(text).match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s*~\s*(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return { start: null, end: null };
  const p = (y, mo, d) => `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return { start: p(m[1], m[2], m[3]), end: p(m[4], m[5], m[6]) };
}

/** ① 유웨이 파워경쟁률 — 대학·지역·접수기간·경쟁률 주소(양쪽 대행사 모두) */
async function fromUway() {
  const { html } = await fetchHtml(UWAY_INDEX, { timeoutMs: 30000 });
  const out = [];
  for (const { cells, links } of tableRows(html)) {
    if (cells.length < 6) continue;
    const rawName = cells[4];
    const univ = univName(rawName);
    if (!univ) continue;
    const { start, end } = period(cells[5]);
    // '준비중' 은 링크가 javascript:void(0) 로 온다 — 주소가 아니므로 없는 것으로 본다.
    const isUrl = (h) => /^https?:\/\//i.test(h || '');
    const rawRatio = links.find((a2) => /경쟁률/.test(a2.text))?.href || null;
    const ratioUrl = isUrl(rawRatio) ? unwrapRatioUrl(rawRatio) : null;
    const applyUrl = links[0]?.href || null;
    // 자동으로 못 가져오는 대학이라도 **어디서 보는지는 알려줘야 한다** — 대학 쪽 주소를 남긴다.
    const homeUrl = isUrl(applyUrl) ? applyUrl : null;
    out.push({
      univ,
      region: cells[2] || null,
      category: cells[1],                              // '4년제 수시' 등
      status: cells[0],
      periodStart: start,
      periodEnd: end,
      ratioUrl,
      applyUrl: /uwayapply[.]com/.test(applyUrl || '') ? applyUrl : null,
      homeUrl,
      kind: ratioUrl ? hostKind(ratioUrl) : 'own',
      uwaySolo: /[ ]U$/.test(clean(rawName)),
    });
  }
  return out;
}

/** ② 진학 스마트경쟁률 — 진학 대학의 '원서 안내' 주소(정확한 마감 시각이 거기 있다) */
async function fromJinhak() {
  const { html } = await fetchHtml(JINHAK_INDEX, { timeoutMs: 30000 });
  const out = [];
  // 이 목록은 브라우저에서 그려진다(서버 응답엔 줄이 없다). 그래도 언젠가 서버가 그려 주면
  // 바로 쓰이도록 남겨 둔다 — 진학 대학의 '원서 안내' 주소가 여기에만 있다.
  for (const chunk of String(html).split(/<li\b/i).slice(1)) {
    const body = chunk.split(/<\/li>/i)[0];
    const rate = (body.match(/class="[^"]*\brate\b[^"]*"[^>]*data-link="([^"]+)"/i) || [])[1] || null;
    const notice = (body.match(/class="[^"]*\bapply\b[^"]*"[^>]*data-link="([^"]+)"/i) || [])[1] || null;
    if (!rate && !notice) continue;
    const univ = univName(unTag((body.match(/class="title"[^>]*>([\s\S]*?)<\/a>/i) || [])[1]));
    if (!univ) continue;
    const { start, end } = period(unTag((body.match(/class="date"[^>]*>([\s\S]*?)<\//i) || [])[1]));
    out.push({ univ, ratioUrl: rate, noticeUrl: notice, periodStart: start, periodEnd: end, status: '' });
  }
  return out;
}

export async function scrapeSources() {
  const [uw, jh] = await Promise.all([fromUway(), fromJinhak().catch(() => [])]);
  const byName = new Map();
  for (const r of uw) {
    // 같은 대학이 수시·정시로 여러 줄일 수 있다 — 지금은 수시만 본다.
    if (r.category && !/수시/.test(r.category)) continue;
    if (!byName.has(r.univ)) byName.set(r.univ, r);
  }
  // 진학 목록으로 보강 — 유웨이 목록에 없거나 주소가 빠진 대학을 채우고, 안내 주소를 붙인다.
  for (const j of jh) {
    const cur = byName.get(j.univ);
    if (!cur) {
      byName.set(j.univ, {
        univ: j.univ, region: null, category: '4년제 수시', status: j.status,
        periodStart: j.periodStart, periodEnd: j.periodEnd,
        ratioUrl: j.ratioUrl, applyUrl: null, noticeUrl: j.noticeUrl,
        kind: j.ratioUrl ? hostKind(j.ratioUrl) : 'own', uwaySolo: false,
      });
      continue;
    }
    cur.noticeUrl = j.noticeUrl || cur.noticeUrl || null;
    if (!cur.ratioUrl && j.ratioUrl) { cur.ratioUrl = j.ratioUrl; cur.kind = hostKind(j.ratioUrl); }
    cur.periodStart = cur.periodStart || j.periodStart;
    cur.periodEnd = cur.periodEnd || j.periodEnd;
  }
  return [...byName.values()].sort((a, b) => a.univ.localeCompare(b.univ, 'ko'));
}

export async function loadSources() {
  const raw = JSON.parse(await fs.readFile(SOURCES_FILE, 'utf8'));
  return raw.list || [];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = await scrapeSources();
  const byKind = list.reduce((m, s) => ({ ...m, [s.kind]: (m[s.kind] || 0) + 1 }), {});
  const ends = [...new Set(list.map((s) => s.periodEnd).filter(Boolean))].sort();
  await fs.writeFile(SOURCES_FILE, JSON.stringify({ fetchedAt: new Date().toISOString(), list }, null, 2), 'utf8');
  console.log(`대학 ${list.length}곳 →`, byKind);
  console.log('마감일 분포:', ends.join(', '));
  console.log('안내주소 있는 곳:', list.filter((s) => s.noticeUrl).length, '· 접수주소 있는 곳:', list.filter((s) => s.applyUrl).length);
  console.log('저장:', SOURCES_FILE);
}
