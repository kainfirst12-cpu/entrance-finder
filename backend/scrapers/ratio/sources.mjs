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
import * as cheerio from 'cheerio';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const UWAY_INDEX = 'https://info.uway.com/power/?isApply=1';
export const JINHAK_INDEX = 'https://apply.jinhakapply.com/SmartRatio';
export const SOURCES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sources.json');

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** '가톨릭관동대학교 U' 처럼 뒤에 붙는 단독·모집군 표시를 떼어 이름만 남긴다 */
const univName = (s) => clean(s).replace(/\s*[UMㅤ]$/u, '').replace(/\s*(가|나|다|산)군?$/, '').trim();

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
  const $ = cheerio.load(html);
  const out = [];
  $('tr').each((_, tr) => {
    const tds = $(tr).find('td');
    if (tds.length < 6) return;
    const cells = tds.map((__, c) => clean($(c).text())).get();
    const status = cells[0];
    const category = cells[1];                       // '4년제 수시' 등
    const region = cells[2];
    const rawName = cells[4];
    const univ = univName(rawName);
    if (!univ) return;
    const { start, end } = period(cells[5]);
    const ratioUrl = $(tr).find('a').filter((__, a) => /경쟁률/.test($(a).text())).attr('href') || null;
    const applyUrl = $(tr).find('a').first().attr('href') || null;
    out.push({
      univ,
      region: region || null,
      category,
      status,
      periodStart: start,
      periodEnd: end,
      ratioUrl,
      applyUrl: /uwayapply\.com/.test(applyUrl || '') ? applyUrl : null,
      kind: ratioUrl ? hostKind(ratioUrl) : 'own',
      uwaySolo: /\bU$/.test(clean(rawName)),
    });
  });
  return out;
}

/** ② 진학 스마트경쟁률 — 진학 대학의 '원서 안내' 주소(정확한 마감 시각이 거기 있다) */
async function fromJinhak() {
  const { html } = await fetchHtml(JINHAK_INDEX, { timeoutMs: 30000 });
  const $ = cheerio.load(html);
  const out = [];
  $('li').each((_, li) => {
    const $li = $(li);
    const rate = $li.find('a.rate').attr('data-link') || null;
    const notice = $li.find('a.apply').attr('data-link') || null;
    if (!rate && !notice) return;
    const univ = univName($li.find('a.title span').first().text());
    if (!univ) return;
    const { start, end } = period($li.find('.date').text());
    out.push({ univ, ratioUrl: rate, noticeUrl: notice, periodStart: start, periodEnd: end, status: clean($li.find('a.apply').text()) });
  });
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
