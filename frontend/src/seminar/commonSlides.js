// 설명회 ① 제도 설명(공통본) — 슬라이드 데이터 → 요소 목록(deckModel 과 같은 요소·좌표계, 같은 디자인).
//
// 공통본 슬라이드 = { id, chapter, layout, heading, data, source }
//   section   { title }
//   statement { kicker?, lines:[] }
//   qa        { q, a:[] }
//   cards     { cards:[{title, body}] }
//   bullets   { lead?, items:[], note? }
//   table     { columns:[], rows:[[]], note? }
//   compare   { left:{title, items:[]}, right:{title, items:[]} }
//   figure    { caption, note? }   — 그림·차트 자리(파워포인트에서 직접 붙인다)
//   image     { src?, w?, h?, caption?, note? }        — 사진 한 장(src = 줄인 JPEG data URL, w·h = 원래 픽셀 비율)
//   imageText { src?, w?, h?, lead?, items:[] }        — 왼쪽 사진 + 오른쪽 설명(학원 소개에 많이 쓴다)
// 글자 안의 **굵게** 는 초록 굵은 글씨로 그린다.

import { C, t, header } from './deckModel.js';

export const LAYOUTS = ['section', 'statement', 'qa', 'cards', 'bullets', 'table', 'compare', 'figure', 'image', 'imageText'];
export const LAYOUT_LABEL = { section: '장 표지', statement: '강조 문장', qa: '질문·답', cards: '카드', bullets: '목록', table: '표', compare: '좌우 비교', figure: '그림 자리', image: '사진', imageText: '사진 + 설명' };

// "**굵게**" → runs
export function rich(text, base = {}) {
  const out = [];
  String(text ?? '').split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (!part) return;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) out.push(t(part.slice(2, -2), { ...base, b: true, color: C.green }));
    else out.push(t(part.replace(/\*\*/g, ''), base)); // 짝 없는 ** 는 지운다(줄을 넘긴 강조 등)
  });
  return out.length ? out : [t('', base)];
}
const plain = (s) => String(s ?? '').replace(/\*\*/g, '');

// 글자 수로 글씨 크기 고르기 — PPT 는 열 때 자동 축소를 하지 않아서 넘치지 않게 미리 계산한다.
// 한글 한 글자 폭 ≈ 글씨 크기의 0.85배(띄어쓰기·문장부호가 좁다 — PowerPoint 실측), 줄 높이 ≈ 1.38배.
function fitSize(paras, w, h, sizes) {
  for (const size of sizes) {
    const perLine = Math.max(1, Math.floor(w / ((size / 72) * 0.85)));
    const lines = paras.reduce((n, p) => n + Math.max(1, Math.ceil(plain(p).length / perLine)), 0);
    if (lines * (size / 72) * 1.38 <= h) return size;
  }
  return sizes[sizes.length - 1];
}
// 문단 목록 → runs (문단 사이 줄바꿈)
function paraRuns(paras, base, { gap = false } = {}) {
  const runs = [];
  paras.forEach((p, i) => {
    const r = rich(p, base);
    if (i < paras.length - 1) { r[r.length - 1] = { ...r[r.length - 1], br: true }; if (gap) r.push(t(' ', { ...base, size: base.size * 0.5, br: true })); }
    runs.push(...r);
  });
  return runs;
}

function sourceEl(src) {
  return src ? [{ t: 'text', x: 0.35, y: 5.18, w: 8.9, h: 0.3, runs: [t(`[출처] ${src}`, { size: 8, color: C.dim })] }] : [];
}
// 사진을 상자 안에 비율 유지(contain)로 — 원래 픽셀 w·h 가 있어야 한다. 사진이 없으면 '사진 자리' 상자.
function imageEls(d, x, y, w, h) {
  if (!d.src) {
    return [
      { t: 'shape', shape: 'rect', x, y, w, h, fill: 'F7F7F7', line: C.dim },
      { t: 'text', x, y, w, h, align: 'center', runs: [t('사진 자리', { size: 16, b: true, color: C.dim, br: true }), t('학원 소개 편집에서 사진을 올리세요', { size: 10, color: C.dim })] },
    ];
  }
  const r = d.w && d.h ? d.w / d.h : w / h;
  let iw = w, ih = w / r;
  if (ih > h) { ih = h; iw = h * r; }
  return [{ t: 'image', x: x + (w - iw) / 2, y: y + (h - ih) / 2, w: iw, h: ih, src: d.src }];
}

function headingEl(text, y = 0.98) {
  return text ? [{ t: 'text', x: 0.35, y, w: 9.2, h: 0.42, runs: rich(text, { size: 16, b: true }) }] : [];
}

/**
 * 공통본 판(version) → 슬라이드 목록 [{ key, title, els }]
 * version = { chapters:{1:'…'}, slides:[…] }, opts.numbering = 장 번호를 다시 매길지(삭제된 장이 있으면 1,2,3… 로)
 */
export function buildCommonSlides(version, { only = null } = {}) {
  const chapters = version?.chapters || {};
  const list = (version?.slides || []).filter((s) => !s.removed && (!only || only.includes(s.id)));
  return list.map((s) => ({ key: `common:${s.id}`, title: `${s.chapter}. ${s.heading || plain(s.data?.title) || LAYOUT_LABEL[s.layout] || ''}`.trim(), els: renderCommonSlide(s, chapters) }));
}

export function renderCommonSlide(s, chapters = {}) {
  const d = s.data || {};
  const chTitle = chapters[s.chapter] || '';
  const els = [];
  if (s.layout === 'section') {
    els.push(
      { t: 'text', x: 0.8, y: 1.45, w: 8.4, h: 0.5, runs: [t(`PART. ${String(s.chapter).padStart(2, '0')}`, { size: 18, b: true, color: C.green })] },
      { t: 'text', x: 0.8, y: 1.95, w: 8.4, h: 1.3, valign: 'top', runs: rich(d.title || chTitle, { size: 38, b: true }) },
      { t: 'line', x: 0.8, y: 3.35, w: 1.2, color: C.green },
    );
    return els;
  }
  els.push(header(s.chapter, chTitle));

  if (s.layout === 'statement') {
    els.push(...headingEl(s.heading));
    const lines = d.lines || [];
    const top = s.heading ? 1.55 : 1.2;
    if (d.kicker) els.push({ t: 'text', x: 0.6, y: top, w: 8.8, h: 0.4, align: 'center', runs: [t(d.kicker, { size: 14, b: true, color: C.green })] });
    const y0 = top + (d.kicker ? 0.5 : 0.1), h = 5.0 - y0;
    const size = fitSize(lines, 8.8, h, [26, 24, 22, 20, 18, 16, 14, 12]);
    els.push({ t: 'text', x: 0.6, y: y0, w: 8.8, h, align: 'center', runs: paraRuns(lines, { size, b: size >= 18 }) });
  } else if (s.layout === 'qa') {
    els.push(...headingEl(s.heading));
    const top = s.heading ? 1.5 : 1.1;
    els.push(
      { t: 'text', x: 0.4, y: top, w: 0.7, h: 0.6, runs: [t('Q.', { size: 28, b: true, color: C.green })] },
      { t: 'text', x: 1.1, y: top, w: 8.5, h: 0.75, runs: rich(d.q, { size: fitSize([d.q], 8.5, 0.75, [20, 18, 16, 14]), b: true }) },
      { t: 'shape', shape: 'rect', x: 0.4, y: top + 0.9, w: 9.2, h: 0.02, fill: C.line },
      { t: 'text', x: 0.4, y: top + 1.05, w: 0.7, h: 0.6, valign: 'top', runs: [t('A.', { size: 28, b: true, color: C.orange })] },
    );
    const a = d.a || [];
    const h = 5.05 - (top + 1.1);
    const size = fitSize(a, 8.4, h - 0.15 * a.length, [20, 18, 17, 16, 15, 14, 13, 12, 11]);
    els.push({ t: 'text', x: 1.1, y: top + 1.1, w: 8.4, h, valign: 'top', runs: paraRuns(a, { size }, { gap: true }) });
  } else if (s.layout === 'cards') {
    els.push(...headingEl(s.heading));
    const cards = (d.cards || []).slice(0, 6);
    const cols = cards.length <= 3 ? cards.length : cards.length === 4 ? 2 : 3;
    const rows = Math.ceil(cards.length / cols) || 1;
    const x0 = 0.4, y0 = 1.55, W2 = 9.2, H2 = 3.55, gx = 0.2, gy = 0.2;
    const cw = (W2 - gx * (cols - 1)) / cols, chh = (H2 - gy * (rows - 1)) / rows;
    const bodySize = Math.min(...cards.map((c) => fitSize([c.body], cw - 0.3, chh - 0.6, [16, 15, 14, 13, 12, 11, 10])), 16);
    cards.forEach((c, i) => {
      const x = x0 + (i % cols) * (cw + gx), y = y0 + Math.floor(i / cols) * (chh + gy);
      els.push(
        { t: 'shape', shape: 'rect', x, y, w: cw, h: chh, fill: 'FFFFFF', line: C.line },
        { t: 'shape', shape: 'rect', x, y, w: 0.07, h: chh, fill: C.green },
        { t: 'text', x: x + 0.2, y: y + 0.08, w: cw - 0.3, h: 0.42, runs: rich(c.title, { size: 14, b: true }) },
        { t: 'text', x: x + 0.2, y: y + 0.5, w: cw - 0.3, h: chh - 0.58, valign: 'top', runs: rich(c.body, { size: bodySize, color: C.sub }) },
      );
    });
  } else if (s.layout === 'bullets') {
    els.push(...headingEl(s.heading));
    let y = 1.55;
    if (d.lead) { els.push({ t: 'text', x: 0.5, y, w: 9, h: 0.45, runs: rich(d.lead, { size: 14, color: C.sub }) }); y += 0.55; }
    const items = (d.items || []).map((x) => `•  ${x}`);
    const h = (d.note ? 4.45 : 5.05) - y;
    const size = fitSize(items, 8.8, h - 0.12 * items.length, [22, 20, 18, 17, 16, 15, 14, 13, 12, 11]);
    els.push({ t: 'text', x: 0.6, y, w: 8.8, h, valign: 'top', runs: paraRuns(items, { size }, { gap: true }) });
    if (d.note) els.push({ t: 'text', x: 0.5, y: 4.5, w: 9, h: 0.6, runs: rich(d.note, { size: 13, b: true, color: C.green }) });
  } else if (s.layout === 'table') {
    els.push(...headingEl(s.heading));
    const cols = d.columns || [];
    const rows = d.rows || [];
    const n = Math.max(cols.length, 1);
    // 첫 열은 좁게, 나머지는 글자 수에 비례
    const lens = cols.map((c, i) => Math.max(plain(c).length, ...rows.map((r) => plain(r[i]).length)));
    const totalW = 8.8;
    const raw = lens.map((l, i) => Math.max(i === 0 ? 1.1 : 0.9, Math.min(l, 40)));
    const sum = raw.reduce((a, b) => a + b, 0) || 1;
    const colW = raw.map((r) => (r / sum) * totalW);
    const rowH = Math.min(0.48, (d.note ? 2.9 : 3.4) / (rows.length + 1));
    const size = rowH < 0.34 ? 11 : rowH < 0.42 ? 13 : 14;
    els.push({ t: 'table', x: 0.6, y: 1.6, w: totalW, colW, rowH, size, rows: [
      cols.map((c) => ({ text: plain(c), fill: C.greenLight, b: true, align: 'center' })),
      ...rows.map((r) => Array.from({ length: n }, (_, i) => ({ text: plain(r[i] ?? ''), align: i === 0 || plain(r[i] ?? '').length < 12 ? 'center' : 'left', b: i === 0 }))),
    ] });
    if (d.note) els.push({ t: 'text', x: 0.6, y: 1.75 + rowH * (rows.length + 1), w: 8.8, h: 0.6, valign: 'top', runs: rich(d.note, { size: 13, b: true }) });
  } else if (s.layout === 'compare') {
    els.push(...headingEl(s.heading));
    const col = (side, x) => {
      const items = (side?.items || []).map((v) => `•  ${v}`);
      const size = fitSize(items, 4.1, 2.8 - 0.1 * items.length, [18, 17, 16, 15, 14, 13, 12, 11, 10]);
      return [
        { t: 'shape', shape: 'rect', x, y: 1.6, w: 4.4, h: 0.5, fill: C.green },
        { t: 'text', x, y: 1.6, w: 4.4, h: 0.5, align: 'center', runs: [t(plain(side?.title), { size: 16, b: true, color: 'FFFFFF' })] },
        { t: 'shape', shape: 'rect', x, y: 2.1, w: 4.4, h: 3.0, fill: 'FFFFFF', line: C.line },
        { t: 'text', x: x + 0.15, y: 2.2, w: 4.1, h: 2.85, valign: 'top', runs: paraRuns(items, { size }, { gap: true }) },
      ];
    };
    els.push(...col(d.left, 0.4), ...col(d.right, 5.2));
  } else if (s.layout === 'figure') {
    els.push(...headingEl(s.heading));
    els.push(
      { t: 'shape', shape: 'rect', x: 1.2, y: 1.6, w: 7.6, h: 3.0, fill: 'F7F7F7', line: C.dim },
      { t: 'text', x: 1.2, y: 1.6, w: 7.6, h: 3.0, align: 'center', runs: [t('그림 자리', { size: 18, b: true, color: C.dim, br: true }), t(plain(d.caption), { size: 12, color: C.dim })] },
    );
    if (d.note) els.push({ t: 'text', x: 0.6, y: 4.7, w: 8.8, h: 0.45, align: 'center', runs: rich(d.note, { size: 13, b: true }) });
  } else if (s.layout === 'image') {
    els.push(...headingEl(s.heading));
    const hasCap = d.caption || d.note;
    els.push(...imageEls(d, 0.6, 1.55, 8.8, hasCap ? 3.15 : 3.55));
    if (hasCap) els.push({ t: 'text', x: 0.6, y: 4.75, w: 8.8, h: 0.4, align: 'center', runs: rich([d.caption, d.note].filter(Boolean).join(' — '), { size: 12, color: C.sub }) });
  } else if (s.layout === 'imageText') {
    els.push(...headingEl(s.heading));
    els.push(...imageEls(d, 0.4, 1.55, 4.6, 3.5));
    let y = 1.6;
    if (d.lead) { els.push({ t: 'text', x: 5.25, y, w: 4.35, h: 0.6, valign: 'top', runs: rich(d.lead, { size: 13, color: C.sub }) }); y += 0.7; }
    const items = (d.items || []).map((v) => `•  ${v}`);
    const h = 5.05 - y;
    const size = fitSize(items, 4.3, h - 0.12 * items.length, [18, 16, 15, 14, 13, 12, 11]);
    els.push({ t: 'text', x: 5.25, y, w: 4.35, h, valign: 'top', runs: paraRuns(items, { size }, { gap: true }) });
  }
  els.push(...sourceEl(s.source));
  return els;
}
