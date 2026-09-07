// 대학 → 실시간 경쟁률 페이지 주소 목록을 만든다.
//
// 왜 이투스 페이지에서 긁나: 실시간 경쟁률은 **원서접수 대행사**(유웨이·진학)가 쥐고 있는데,
// 유웨이 주소는 `ratio.uwayapply.com/<암호토큰>` 이라 규칙이 없다. 대학마다 토큰이 다르고
// 어디에도 목록이 없다. 이투스가 그 토큰을 대학명과 함께 한 장에 모아 두었으므로,
// **주소록만** 여기서 한 번 받아 두고 그 뒤로는 대행사에 직접 묻는다(이투스를 매번 안 거친다).
//
// 진학은 `RatioV1/RatioH/Ratio<대학코드>.html` 로 규칙적이라 토큰이 필요 없다.
import { fetchHtml } from './fetchHtml.mjs';
import * as cheerio from 'cheerio';

export const INDEX_URL = 'https://www.etoos.com/report/pass/scoreanalysis/competition.asp';

/** 주소의 성격을 가른다 — 파서를 고르는 기준이 된다. */
export function hostKind(url) {
  if (/ratio\.uwayapply\.com/i.test(url)) return 'uway';
  if (/addon\.jinhakapply\.com/i.test(url)) return 'jinhak';
  return 'own';   // 대학 자체 페이지 — 모양이 제각각이라 자동 수집 대상이 아니다
}

export async function scrapeSources() {
  const { html } = await fetchHtml(INDEX_URL, { timeoutMs: 30000 });
  const $ = cheerio.load(html);

  // 지역 표(왼쪽 지역 / 오른쪽 대학 목록) 구조라, 링크마다 가장 가까운 tr 의 첫 칸을 지역으로 본다.
  const out = [];
  const seen = new Set();
  $('a[href]').each((_, el) => {
    const a = $(el);
    const href = (a.attr('href') || '').trim();
    const name = a.text().replace(/\s+/g, ' ').trim();
    if (!name || name.length > 14) return;
    if (!/^https?:\/\//i.test(href)) return;
    const kind = hostKind(href);
    // 이투스 자기 사이트 링크(회사소개·제휴 등)는 대학이 아니다
    if (/etoos\.com|ftc\.go\.kr|naver\.com|youtube\.com|instagram\.com/i.test(href)) return;
    const key = `${name}|${href}`;
    if (seen.has(key)) return;
    seen.add(key);
    const region = a.closest('tr').find('th,td').first().text().replace(/\s+/g, ' ').trim();
    out.push({ univ: name, region: region && region !== name ? region : null, url: href, kind });
  });
  return out;
}

// 직접 실행하면 sources.json 을 새로 쓴다: node scrapers/ratio/sources.mjs
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SOURCES_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sources.json');

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fs = await import('node:fs/promises');
  const list = await scrapeSources();
  const byKind = list.reduce((m, s) => ({ ...m, [s.kind]: (m[s.kind] || 0) + 1 }), {});
  await fs.writeFile(SOURCES_FILE, JSON.stringify({ fetchedAt: new Date().toISOString(), list }, null, 2), 'utf8');
  console.log(`대학 ${list.length}곳 →`, byKind);
  console.log('저장:', SOURCES_FILE);
}
