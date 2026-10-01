// 설명회 자료 — 분석 결과 → 슬라이드 목록(요소 좌표는 인치, 16:9 = 10 × 5.625).
// 같은 목록을 화면 미리보기(SlidePreview)와 PPT(pptx.js)가 그대로 그린다 — 미리보기와 내려받은 파일이 어긋나지 않게.
//
// 요소:
//   { t:'text', x,y,w,h, runs:[{text, b, color, size, br}], size, color, b, align, valign, fill, line, inset }
//   { t:'shape', shape:'rect'|'roundRect'|'triangle'|'trapezoid'|'offpage'|'poly', x,y,w,h, fill, line, pts:[[fx,fy]…](poly, 상자 안 비율) }
//   { t:'line', x,y,w, color, dash }
//   { t:'table', x,y,w, colW:[], rowH, size, rows:[[{text, fill, color, b, align}]] }
//   { t:'bars', x,y,w,h, categories:[], series:[{name, color, values:[]}] }   ← 100% 누적 가로 막대(PPT 에선 진짜 차트)
// 디자인은 2025 고입설명회 자료(흰 바탕·큰 번호 제목·초록 강조·우측 상단 쪽번호)를 따른다.

import { SUBJECTS } from './analysis.js';

export const W = 10, H = 5.625;
export const FONT = 'Malgun Gothic';
export const C = {
  ink: '111111', sub: '555555', dim: '8A8A8A', line: 'D9D9D9',
  green: '00B765', greenLight: 'C8F0D5', greenDeep: '00A35A', orange: 'F08A24',
  head: 'F3F4F6', badge: 'E5E5E5',
};
// 성취도 A~E 색 — 입시파인더 공시정보 화면과 같은 계열(초록 → 빨강)
export const BAND = { a: '16A34A', b: '4ADE80', c: 'FACC15', d: 'FB923C', e: 'EF4444' };

const fmt = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(1));
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
export const t = (text, o = {}) => ({ text, ...o });
// 받침 있으면 '은', 없으면 '는'
const eunNeun = (w) => { const c = String(w).charCodeAt(String(w).length - 1); return c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 ? '은' : '는'; };

// 공통 머리 — "7 . 일반고 선택의 기준: 과목별 분류"
export function header(part, title) {
  return {
    t: 'text', x: 0.35, y: 0.18, w: 8.6, h: 0.75, valign: 'middle',
    runs: [t(String(part), { size: 40, b: true }), t(' . ', { size: 22, b: true }), t(title, { size: 22, b: true })],
  };
}
export function pageBadge(n) {
  return [
    { t: 'shape', shape: 'offpage', x: 9.35, y: 0, w: 0.5, h: 0.6, fill: C.badge },
    { t: 'text', x: 9.35, y: 0.06, w: 0.5, h: 0.3, runs: [t(String(n), { size: 9, color: C.sub })], align: 'center' },
  ];
}

/**
 * deck = { title, part, region, startPage, semester, includeCover, notes:{ [schoolId]: {subjects:{국어:'…'}, strong, weak, typeLine} } }
 * analysis = analyzeSchools(...) 결과
 */
export function buildSlides(deck, analysis) {
  const part = deck.part || 1;
  const sec = deck.title || '일반고 선택의 기준';
  const region = deck.region || '우리 지역';
  const notes = deck.notes || {};
  const schools = analysis.usable;
  const years = [...new Set(schools.map((s) => s.year).filter(Boolean))].sort();
  const yearLabel = years.length ? years.join('·') : '';
  // 학교마다 최신 학년도를 쓰므로(3차 공시면 올해 1학기만) 실제로 들어간 학기로 적는다
  const usedSems = [...new Set(schools.flatMap((s) => Object.values(s.rows).flatMap((m) => m.semesters || [])))].sort();
  const semLabel = deck.semester === 1 ? '1학기' : deck.semester === 2 ? '2학기' : usedSems.length === 1 ? `${usedSems[0]}학기` : '1·2학기 평균';
  const slides = [];
  const add = (key, title, els) => slides.push({ key, title, els });

  // ── 표지 ──
  if (deck.includeCover !== false) {
    add('cover', '파트 표지', [
      { t: 'text', x: 0.6, y: 1.55, w: 8.8, h: 0.5, runs: [t(`PART. ${String(part).padStart(2, '0')}`, { size: 18, b: true, color: C.green })] },
      { t: 'text', x: 0.6, y: 2.05, w: 8.8, h: 1.0, runs: [t(sec, { size: 40, b: true })] },
      { t: 'line', x: 0.6, y: 3.2, w: 1.2, color: C.green },
      { t: 'text', x: 0.6, y: 3.35, w: 8.8, h: 0.5, runs: [t(`${region} 고등학교 ${schools.length}곳 · 학교알리미 ${yearLabel} 성취도 공시 기준`, { size: 13, color: C.sub })] },
    ]);
  }

  // ── 도입 ──
  add('intro', '도입', [
    header(part, sec),
    // 학교 아이콘(도형) — 작년 자료의 깃발 달린 학교
    { t: 'shape', shape: 'triangle', x: 4.15, y: 1.25, w: 1.7, h: 0.6, fill: C.ink },
    { t: 'shape', shape: 'rect', x: 4.35, y: 1.85, w: 1.3, h: 0.95, fill: C.ink },
    { t: 'shape', shape: 'roundRect', x: 4.85, y: 2.3, w: 0.3, h: 0.5, fill: 'FFFFFF' },
    { t: 'shape', shape: 'rect', x: 4.98, y: 0.85, w: 0.04, h: 0.45, fill: C.ink },
    { t: 'shape', shape: 'rect', x: 5.02, y: 0.85, w: 0.3, h: 0.18, fill: C.ink },
    { t: 'shape', shape: 'rect', x: 4.0, y: 2.8, w: 2.0, h: 0.06, fill: C.ink },
    { t: 'text', x: 0.5, y: 3.15, w: 9, h: 0.35, align: 'center', runs: [t('진학 전, 학교별 성취도 분포를 알아보고 고등학교를 선택하는 것이 유리하겠죠?', { size: 12, color: C.sub })] },
    { t: 'text', x: 0.5, y: 3.5, w: 9, h: 0.6, align: 'center', runs: [t(`${region} 관내 `, { size: 24, b: true }), t('학교별 성취도와 특징', { size: 24, b: true, color: C.green }), t('을 알아보겠습니다!', { size: 24, b: true })] },
  ]);

  // ── 상대 표준편차 설명 ──
  add('method', '읽는 법', [
    header(part, sec),
    { t: 'text', x: 0.6, y: 1.25, w: 8.8, h: 1.2, align: 'center', runs: [
      t('2025학년도 고교학점제부터는', { size: 18, b: true, br: true }),
      t('학교알리미 공시에 ', { size: 18, b: true }), t('‘표준편차’', { size: 18, b: true, color: C.green }), t(' 공시가', { size: 18, b: true, br: true }),
      t('포함되어 있지 않아 정확한 난이도 구별은 어렵습니다.', { size: 18, b: true }),
    ] },
    { t: 'text', x: 0.6, y: 2.65, w: 8.8, h: 0.9, align: 'center', runs: [
      t('따라서 A~E 성취도에 점수를 매겨, 학교별 과목의', { size: 15, br: true }),
      t('‘상대 표준편차’', { size: 15, b: true, color: C.green }), t('로 분포와 난이도를 설명하겠습니다!', { size: 15 }),
    ] },
    { t: 'table', x: 2.5, y: 3.7, w: 5, colW: [1, 1, 1, 1, 1], rowH: 0.32, size: 11, rows: [
      ['A', 'B', 'C', 'D', 'E'].map((L) => ({ text: L, fill: BAND[L.toLowerCase()], color: L === 'C' ? C.ink : 'FFFFFF', b: true, align: 'center' })),
      ['5점', '4점', '3점', '2점', '1점'].map((x) => ({ text: x, align: 'center' })),
    ] },
    { t: 'text', x: 0.6, y: 4.65, w: 8.8, h: 0.5, align: 'center', runs: [t(`※ 실제 표준편차가 아닌 A~E 점수로 계산한 상대 지표이며, 함께 비교한 ${schools.length}개 학교 안에서의 상대 위치입니다. (${semLabel})`, { size: 10, color: C.dim })] },
  ]);

  // ── 학교별 상세 ──
  for (const s of schools) {
    const n = notes[s.id] || {};
    const subj = SUBJECTS.filter((x) => s.rows[x.key]);
    const head = [t('과목'), t('평균'), t('A'), t('B'), t('C'), t('D'), t('E')].map((c) => ({ ...c, fill: C.head, b: true, align: 'center' }));
    const rows = subj.map((x) => {
      const m = s.rows[x.key];
      const name = m.subjects.length > 1 ? `${x.label}` : m.subjects[0];
      return [{ text: name, align: 'center' }, { text: fmt(m.mean), align: 'center', b: true }, ...['a', 'b', 'c', 'd', 'e'].map((L) => ({ text: fmt(m[L]), align: 'center' }))];
    });
    const noteRows = subj.map((x) => [
      { text: x.label, fill: C.greenLight, b: true, align: 'center' },
      { text: (n.subjects && n.subjects[x.key]) || s.rows[x.key].note },
    ]);
    const strong = n.strong ?? s.message.strong;
    const weak = n.weak ?? s.message.weak;
    const msg = [];
    if (strong) msg.push(t(`${strong}에 강점이 있는`, { size: 16, b: true, color: C.green }), t(' 학생에게 유리하며,', { size: 16, br: true }));
    if (weak) msg.push(t(`${weak}${eunNeun(weak)} `, { size: 16 }), t('개인적 보완 계획', { size: 16, b: true }), t('이 필요!', { size: 16 }));
    if (!msg.length) msg.push(t('과목 간 차이가 크지 않은 ', { size: 16 }), t('균형형 학교', { size: 16, b: true, color: C.green }), t('입니다.', { size: 16 }));
    add(`school:${s.id}`, s.short, [
      header(part, sec),
      { t: 'text', x: 0.35, y: 1.0, w: 5.4, h: 0.35, runs: [t(`${s.year || ''} ${semLabel} · 1학년 과목별 성취도 비율`, { size: 12, b: true })] },
      { t: 'text', x: 0.35, y: 1.32, w: 5.4, h: 0.35, runs: [t(s.name, { size: 16, b: true, color: C.greenDeep })] },
      { t: 'table', x: 0.35, y: 1.72, w: 5.3, colW: [1.35, 0.65, 0.66, 0.66, 0.66, 0.66, 0.66], rowH: 0.36, size: 10, rows: [head, ...rows] },
      { t: 'text', x: 0.35, y: 5.15, w: 6, h: 0.3, runs: [t(`[출처] 학교알리미 공시정보 '${s.name}' ${s.year || ''} 1학년 과목별 성취도 비율`, { size: 8, color: C.dim })] },
      { t: 'text', x: 5.95, y: 1.0, w: 3.75, h: 0.45, runs: [t(`전반적인 경향성 (${s.short})`, { size: 15, b: true })] },
      { t: 'table', x: 5.95, y: 1.5, w: 3.75, colW: [0.85, 2.9], rowH: 0.42, size: 8.5, rows: noteRows },
      { t: 'text', x: 5.95, y: 4.15, w: 3.75, h: 0.9, valign: 'top', runs: msg.map((r) => ({ ...r, size: 13 })) },
    ]);
  }

  // ── 과목별 비교(100% 누적 막대) ──
  const cmpSubjects = ['국어', '수학', '영어', '통합사회', '통합과학'];
  for (const k of cmpSubjects) {
    const list = schools.filter((s) => s.rows[k]).sort((x, y) => y.rows[k].level - x.rows[k].level);
    if (list.length < 2) continue;
    const pages = chunk(list, 12);
    pages.forEach((pg, i) => {
      add(`cmp:${k}:${i}`, `${k} 비교${pages.length > 1 ? ` ${i + 1}` : ''}`, [
        header(part, `${sec}: ${k} 성취도 비교`),
        { t: 'text', x: 0.35, y: 0.95, w: 9.3, h: 0.35, runs: [t(`A·B 비율이 높은 학교부터 · ${semLabel} · 막대 = A~E 비율(%)`, { size: 11, color: C.sub })] },
        { t: 'bars', x: 0.35, y: 1.3, w: 9.3, h: 4.0, categories: pg.map((s) => s.short),
          series: ['a', 'b', 'c', 'd', 'e'].map((L) => ({ name: L.toUpperCase(), color: BAND[L], values: pg.map((s) => s.rows[k][L] || 0) })) },
      ]);
    });
  }

  // ── 과목별 분류(국·수·영) ──
  const namesOf = (ids) => ids.map((id) => schools.find((s) => s.id === id)?.short).filter(Boolean);
  const col = (x, persona, q, ids, why) => [
    { t: 'text', x, y: 1.05, w: 3.0, h: 0.6, align: 'center', runs: [t(persona, { size: 10, color: C.sub })] },
    { t: 'text', x, y: 1.75, w: 3.0, h: 0.45, align: 'center', runs: [t(q, { size: 16, b: true })] },
    { t: 'text', x, y: 2.3, w: 3.0, h: 1.3, align: 'center', valign: 'top', runs: [t(namesOf(ids).join(', ') || '해당 학교 없음', { size: 15 })] },
    { t: 'text', x, y: 3.55, w: 3.0, h: 1.0, align: 'center', valign: 'top', runs: [t(why, { size: 11, color: C.green })] },
  ];
  add('cls:core', '과목별 분류', [
    header(part, `${sec}: 과목별 분류`),
    ...col(0.25, '난 책도 많이 읽고, 문해력·독해력도 좋아!', '국어 과목에 강하다면?', analysis.strong.국어, '국어 상·중위권이 두꺼워 국어가 전체 성적을 견인하기 좋음'),
    ...col(3.5, '논리적으로 생각하고 문제 해결하는 데 흥미가 있어!', '수학 과목에 강하다면?', analysis.strong.수학, '수학 상위권 비율이 높아 수학 강점 학생에게 유리'),
    ...col(6.75, '영어 듣기·독해를 좋아하고 언어 과목에 자신 있어!', '영어 과목에 강하다면?', analysis.strong.영어, '영어 분포가 상위권 중심, 언어 감각이 있는 학생이 높은 성취 유지에 유리'),
  ]);
  add('cls:inq', '탐구 분류', [
    header(part, `${sec}: 과목별 분류`),
    ...col(1.4, '난 분석적이고, 개념적인 원리들을 공부하는 걸 좋아해!', '탐구 전반에 강하다면?', analysis.strong.탐구, '통합사회·통합과학 성취가 높아 탐구 중심 학생에게 유리한 학교'),
    ...col(5.6, '개념 원리는 좋지만, 수학·과학보다는 사회가 편해!', '‘사회’ 영역에 강하다면?', analysis.strong.사회, '수학·과학보다 사회·한국사 성취가 뚜렷이 높은 학교'),
  ]);

  // ── 성취도별 분류(피라미드) ──
  const tier = (k) => analysis.tiers[k].map((s) => s.short).join(', ') || '—';
  // 하나의 삼각형을 세 칸으로 자른다(칸 사이 흰 틈) — 칸마다 따로 그린 도형은 빗변이 어긋나 보였다(원장 지적 2026-10-01).
  const PY = { cx: 2.2, top: 1.0, bottom: 5.0, half: 2.0, gap: 0.08 };
  const hw = (y) => (PY.half * (y - PY.top)) / (PY.bottom - PY.top);
  const cuts = [PY.top, 2.33, 3.66, PY.bottom];
  const band = (i, fill) => {
    const y0 = cuts[i] + (i ? PY.gap / 2 : 0), y1 = cuts[i + 1] - (i < 2 ? PY.gap / 2 : 0);
    const w0 = hw(y0), w1 = hw(y1);
    const x = PY.cx - w1, w = 2 * w1, h = y1 - y0;
    // 점은 도형 상자 안의 비율(0~1)
    const pts = i === 0 ? [[0.5, 0], [1, 1], [0, 1]] : [[(w1 - w0) / w, 0], [(w1 + w0) / w, 0], [1, 1], [0, 1]];
    return { t: 'shape', shape: 'poly', x, y: y0, w, h, pts, fill };
  };
  const tierText = (i, head, sub, k, note) => ({ t: 'text', x: 4.55, y: cuts[i] + 0.08, w: 5.15, h: cuts[i + 1] - cuts[i] - 0.12, valign: 'top', runs: [
    t(head, { size: 14, b: true }), t(` ${sub}`, { size: 11, b: true, color: C.sub, br: true }),
    t(tier(k), { size: 12, br: true }), t(note, { size: 11, color: C.green }),
  ] });
  add('cls:tier', '성취도별 분류', [
    header(part, `${sec}: 성취도별 분류`),
    band(0, C.greenLight), band(1, C.green), band(2, C.ink),
    { t: 'line', x: PY.cx + hw(cuts[1]) + 0.15, y: cuts[1], w: 9.6 - (PY.cx + hw(cuts[1]) + 0.15), color: C.line, dash: true },
    { t: 'line', x: PY.cx + hw(cuts[2]) + 0.15, y: cuts[2], w: 9.6 - (PY.cx + hw(cuts[2]) + 0.15), color: C.line, dash: true },
    tierText(0, '상위권', '(꾸준한 학습, 안정적인 성취 지향)', 'top', '평균 성취가 높고 고르게 분포 → ‘실력 유지형 환경’'),
    tierText(1, '중위권', '(상위권으로의 도약을 원함)', 'mid', '성취도 편차가 있어 노력에 따른 성적 상승이 가능한 학교'),
    tierText(2, '기초 보완', '(기초를 다지는 것이 무엇보다 중요)', 'low', '학생 간 성취도 격차가 크고 하위권 비율이 높음'),
    { t: 'text', x: 0.35, y: 5.15, w: 9.3, h: 0.3, runs: [t(`※ 함께 비교한 ${schools.length}개 학교를 6개 과목 상대 성취로 3등분한 결과입니다.`, { size: 8, color: C.dim })] },
  ]);

  // ── 학교별 한 줄 분류 ──
  const typed = schools.map((s) => ({ s, line: (notes[s.id] && notes[s.id].typeLine) || s.typeLine }));
  const pages = chunk(typed, 14);
  pages.forEach((pg, i) => {
    const half = Math.ceil(pg.length / 2);
    const tbl = (list, x) => ({ t: 'table', x, y: 1.05, w: 4.4, colW: [1.1, 3.3], rowH: 0.36, size: 10.5,
      rows: list.map(({ s, line }) => [{ text: s.short, fill: C.greenLight, align: 'center' }, { text: line }]) });
    const els = [header(part, `${sec}: 학교별 분류`), tbl(pg.slice(0, half), 0.4)];
    if (pg.length > half) els.push(tbl(pg.slice(half), 5.2));
    if (i === pages.length - 1) {
      const groups = {};
      for (const { s } of typed) { const k = s.famWords.length ? `${s.famWords.join('·')}형 강세` : '균형형'; (groups[k] = groups[k] || []).push(s.short); }
      const bullets = Object.entries(groups).sort((a, b) => b[1].length - a[1].length).slice(0, 4);
      const yb = 1.05 + Math.max(half, 1) * 0.36 + 0.25;
      if (yb < 4.6) els.push({ t: 'text', x: 0.5, y: yb, w: 9, h: 5.4 - yb, valign: 'top', runs: bullets.flatMap(([k, v], j) => [t(`•  ${k}: `, { size: 12, b: true }), t(v.join(', '), { size: 12, br: j < bullets.length - 1 })]) });
    }
    add(`cls:type:${i}`, `학교별 분류${pages.length > 1 ? ` ${i + 1}` : ''}`, els);
  });

  return slides;
}

/** 쪽번호 — ① 공통본 + ② 학교별을 이어 붙인 뒤 한 번에 매긴다 */
export function numberSlides(slides, start = 1) {
  return slides.map((sl, i) => ({ ...sl, els: [...sl.els, ...pageBadge((Number(start) || 1) + i)] }));
}

// ── 맨 앞 표지 · 목차 · 마무리(Q&A·감사·연락처) — 작년 1·2·110~116쪽 모양 ──
// brand = { name, sub, logo? }  (설정 → 브랜드, frontend/src/brand.js readBrand)
function logoEls(brand, x, y, h) {
  if (!brand?.logo) return [];
  return [{ t: 'image', x, y, w: h * (brand.logoRatio || 1), h, src: brand.logo }];
}
export function buildTitleSlide(o, brand) {
  return {
    key: 'title', title: '표지', els: [
      ...logoEls(brand, 0.5, 0.35, 0.6),
      { t: 'text', x: 0.5, y: 1.35, w: 9, h: 0.5, align: 'center', runs: [t(o.coverKicker || '대학입시, 미리 알고 준비하자!', { size: 18, b: true, color: C.green })] },
      { t: 'text', x: 0.5, y: 1.9, w: 9, h: 1.2, align: 'center', runs: [t(o.coverTitle || '고입 · 대입 설명회', { size: 40, b: true })] },
      { t: 'line', x: 4.4, y: 3.25, w: 1.2, color: C.green },
      { t: 'text', x: 0.5, y: 3.45, w: 9, h: 0.9, align: 'center', runs: [
        t([o.coverPlace, o.coverDate].filter(Boolean).join('  ·  ') || ' ', { size: 15, color: C.sub, br: true }),
        t(brand?.name || '', { size: 15, b: true, color: C.ink })] },
    ],
  };
}
export function buildContents(parts) {
  // parts = [{ no, title }]
  const half = Math.ceil(parts.length / 2);
  const col = (list, x) => ({ t: 'text', x, y: 1.5, w: 4.3, h: 3.6, valign: 'top', runs: list.flatMap((p, i) => [
    t(`Part. ${String(p.no).padStart(2, '0')}  `, { size: 14, b: true, color: C.green }), t(p.title, { size: 16, b: true, br: i < list.length - 1 }), ...(i < list.length - 1 ? [t(' ', { size: 10, br: true })] : [])]) });
  return { key: 'contents', title: '목차', els: [
    { t: 'text', x: 0.5, y: 0.45, w: 9, h: 0.8, runs: [t('CONTENTS', { size: 34, b: true })] },
    { t: 'line', x: 0.5, y: 1.25, w: 1.2, color: C.green },
    col(parts.slice(0, half), 0.6), ...(parts.length > half ? [col(parts.slice(half), 5.2)] : []),
  ] };
}
export function buildClosing(info = {}, brand, o = {}) {
  const contact = [info.phone && `☎  ${info.phone}`, info.address && `📍  ${info.address}`, info.sns && `💬  ${info.sns}`].filter(Boolean);
  return [
    { key: 'qna', title: 'Q&A', els: [
      { t: 'text', x: 0.5, y: 1.6, w: 9, h: 1.2, align: 'center', runs: [t('Q&A', { size: 60, b: true, color: C.green })] },
      { t: 'text', x: 0.5, y: 2.9, w: 9, h: 0.6, align: 'center', runs: [t('사전 질문과 현장 질문', { size: 18, color: C.sub })] },
    ] },
    { key: 'thanks', title: '감사 인사', els: [
      ...logoEls(brand, 4.6, 0.55, 0.8),
      { t: 'text', x: 0.5, y: 1.45, w: 9, h: 1.3, align: 'center', runs: [t('참석하여 자리를 빛내주셔서', { size: 26, b: true, br: true }), t('진심으로 감사드립니다.', { size: 26, b: true, color: C.green })] },
      { t: 'text', x: 0.5, y: 2.85, w: 9, h: 0.45, align: 'center', runs: [t(info.closing || '', { size: 13, color: C.sub })] },
      { t: 'text', x: 0.5, y: 3.4, w: 9, h: 1.4, align: 'center', valign: 'top', runs: [
        t(brand?.name || '', { size: 16, b: true, br: contact.length > 0 }),
        ...contact.map((c, i) => t(c, { size: 14, color: C.ink, br: i < contact.length - 1 }))] },
      { t: 'text', x: 0.5, y: 4.95, w: 9, h: 0.35, align: 'center', runs: [t(o.coverTitle || '', { size: 10, color: C.dim })] },
    ] },
  ];
}
