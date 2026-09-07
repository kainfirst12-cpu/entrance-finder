// 실시간 경쟁률 페이지 한 장 → 표로 정리.
//
// 유웨이·진학 두 대행사가 클래스 이름은 다르지만 **표의 머리글은 같다.**
//   요약: 구분/전형명 · (총)모집인원 · 지원인원 · 경쟁률
//   상세: 대학(캠퍼스) · 모집단위 · 모집인원 · 지원인원 · 경쟁률
// 그래서 클래스가 아니라 **머리글로** 표를 가른다 — 대학 자체 페이지가 섞여 들어와도
// 모양만 같으면 그대로 읽히고, 대행사가 클래스 이름을 바꿔도 안 깨진다.
import * as cheerio from 'cheerio';

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
/** "2,127" → 2127 · 빈 칸이나 '-' 는 null */
const num = (s) => {
  const t = clean(s).replace(/,/g, '');
  if (!t || /^[-–—]$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
/** "7.21 : 1" → 7.21 · 미달이어도 그대로 둔다(0.74 같은 값이 실제로 있다) */
const ratioOf = (s) => {
  const m = clean(s).match(/(\d+(?:\.\d+)?)\s*:\s*1/);
  if (m) return Number(m[1]);
  return num(s);
};

/** 이 표 바로 앞의 '○○ 경쟁률 현황' 제목 — 상세표가 어느 전형인지는 여기에만 적혀 있다. */
function headingFor($, el) {
  const RE = /^(.*?)\s*경쟁률\s*현황$/;
  let node = el;
  for (let up = 0; up < 4 && node; up += 1) {
    const prevs = $(node).prevAll().toArray();          // 가까운 것부터
    for (const p of prevs) {
      const $p = $(p);
      if ($p.is('table') || $p.find('table').length) continue;   // 다른 표의 내용은 제목이 아니다
      const t = clean($p.text());
      const m = t.match(RE);
      if (m && m[1]) return m[1].trim();
    }
    node = $(node).parent().get(0);
  }
  return null;
}

// 마지막 칸의 이름은 대학마다 다르다 — '경쟁률'이 보통이지만 국민대처럼 '지원현황'도 있다.
// 이름으로 거르면 그런 대학이 통째로 빠지므로, 뜻이 같은 이름을 다 받는다.
const RATIO_COL = /경쟁률|경쟁율|지원현황|지원율/;
// 지원자 수 칸도 이름이 갈린다 — '지원인원'(대다수) · '지원자수'/'지원자'(중앙대 등).
const APP_COL = /지원인원|지원자/;

/** 머리글로 표의 성격을 정한다. */
function kindOf(head) {
  const h = head.map(clean);
  const has = (re) => h.some((x) => re.test(x));
  if (!has(APP_COL) || !has(RATIO_COL)) return null;
  if (has(/모집단위/)) return 'unit';
  if (has(/구분|전형/)) return 'summary';
  return null;
}

/** 표 한 장을 줄 배열로. 병합된 앞칸(rowspan)은 윗줄 값을 이어 쓴다. */
function readRows($, table, width) {
  const out = [];
  let carry = [];
  $(table).find('tr').slice(1).each((_, tr) => {
    const cells = $(tr).find('th,td').map((__, c) => clean($(c).text())).get();
    if (!cells.length) return;
    // 칸이 모자라면 앞쪽이 병합된 것 — 윗줄에서 그만큼 가져온다.
    const lack = width - cells.length;
    const row = lack > 0 && carry.length >= lack ? [...carry.slice(0, lack), ...cells] : cells;
    if (row.length < width) return;
    carry = row;
    out.push(row);
  });
  return out;
}

export function parseRatioPage(html) {
  const $ = cheerio.load(html);
  const bodyText = clean($('body').text());

  const summary = [];
  const units = [];

  $('table').each((_, t) => {
    const head = $(t).find('tr').first().find('th,td').map((__, c) => clean($(c).text())).get();
    const kind = kindOf(head);
    if (!kind) return;
    const rows = readRows($, t, head.length);

    // 칸 순서를 1·2·3 으로 박지 않는다 — 대학마다 앞에 계열·대학 칸이 더 붙는다.
    const iCap = head.findIndex((x) => /모집인원/.test(x));
    const iApp = head.findIndex((x) => APP_COL.test(x));
    const iRatio = head.findIndex((x) => RATIO_COL.test(x));

    if (kind === 'summary') {
      for (const r of rows) {
        const name = clean(r[0]);
        if (!name) continue;
        summary.push({
          jeonhyeong: name,
          isTotal: /^(총계|합계|전체|계)$/.test(name),
          capacity: num(r[iCap]),
          applicants: num(r[iApp]),
          ratio: ratioOf(r[iRatio]),
        });
      }
      return;
    }

    const jeonhyeong = headingFor($, t);
    // 머리글에서 '모집단위' 가 몇 번째인지 보고 그 앞을 캠퍼스/단과대로 본다.
    const ui = head.findIndex((x) => /모집단위/.test(x));
    for (const r of rows) {
      const unit = clean(r[ui]);
      if (!unit) continue;
      // 캠퍼스 칸은 모집단위 앞에 오기도 하고 뒤에 오기도 한다(중앙대는 뒤).
      // 이름이 있으면 그 칸을, 없으면 모집단위 바로 앞 칸을 캠퍼스로 본다.
      const iCampus = head.findIndex((x) => /캠퍼스/.test(x));
      units.push({
        jeonhyeong,
        campus: clean(r[iCampus >= 0 ? iCampus : ui - 1]) || null,
        unit,
        // 표 안에 섞여 있는 소계·총계 줄 — 지우지 않고 표시만 해 둔다.
        // 지워 버리면 합이 맞는지 확인할 길이 없고, 남겨 두면 학과별 합계로 검산이 된다.
        isTotal: /^(총계|소계|합계|계)$/.test(unit),
        capacity: num(r[iCap]),
        applicants: num(r[iApp]),
        ratio: ratioOf(r[iRatio]),
      });
    }
  });

  // 이 숫자가 언제 것인지 — 접수 중에는 갱신시각이, 끝난 뒤에는 '최종'이 적혀 있다.
  const asOf = (bodyText.match(/(\d{4}[.\-/]\s?\d{1,2}[.\-/]\s?\d{1,2}[^)\n]{0,20}\d{1,2}\s*:\s*\d{2})/) || [])[1] || null;
  const isFinal = /최종\s*(경쟁률|마감|현황)/.test(bodyText);

  return { asOf, isFinal, summary, units };
}
