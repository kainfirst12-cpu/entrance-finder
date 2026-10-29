// 설명회 자료 — «내신 시험 분석» 장. 뽀개기 FINAL(시험지 분석)의 «🎤 설명회 자료로 보내기» JSON(final-seminar-chapter)을
// 고입설명회 양식 슬라이드로 그린다. 숫자는 FINAL 이 센 그대로(AI 없음) — 받는 모양은 pogegi-lite-web src/lib/seminar-chapter.ts.
// 미리보기(SlidePreview)·PPT(pptx.js)·공유 링크가 deckModel 의 요소를 그대로 쓰므로 여기서도 같은 요소만 쓴다.
// (원장 결정 2026-10-30: FINAL 은 PPT 를 따로 만들지 않고 이 덱에 장으로 들어온다)
import { C, t, header } from './deckModel.js';

const SRC = { 교과서: '3B82F6', 모의고사: 'EF4444', 부교재: '10B981', EBS: 'F97316', 외부지문: 'EAB308', 기타: '9CA3AF' };
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const short = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
const label = (e) => [e.school, e.grade, e.examName].filter(Boolean).join(' ');
const num = (v) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function isExamChapter(x) {
  return !!x && x._type === 'final-seminar-chapter' && Array.isArray(x.exams);
}

/** 한 줄씩 «•» 목록 — 글이 길면 칸 안에서 줄어든다(pptx fit:shrink) */
const list = (items, x, y, w, h, size = 12) => ({
  t: 'text', x, y, w, h, valign: 'top',
  runs: items.flatMap((s, i) => [t(`•  ${s}`, { size, br: i < items.length - 1 }), ...(i < items.length - 1 ? [t(' ', { size: 4, br: true })] : [])]),
});
const tile = (x, y, w, head, value) => [
  { t: 'shape', shape: 'roundRect', x, y, w, h: 0.78, fill: C.greenLight },
  { t: 'text', x: x + 0.1, y: y + 0.05, w: w - 0.2, h: 0.28, runs: [t(head, { size: 10, color: C.sub })] },
  { t: 'text', x: x + 0.1, y: y + 0.32, w: w - 0.2, h: 0.4, runs: [t(value, { size: 18, b: true })] },
];
/** 가로 막대(값/최댓값) + 오른쪽 값 — 막대 차트 대신 도형으로(미리보기와 PPT 가 같게) */
const hbars = (rows, x, y, w, max, fmt) => rows.flatMap((r, i) => {
  const yy = y + i * 0.42, lw = 1.9, bw = Math.max(0.05, ((w - lw - 0.7) * r.value) / (max || 1));
  return [
    { t: 'text', x, y: yy, w: lw, h: 0.34, align: 'right', runs: [t(short(r.label, 16), { size: 10 })] },
    { t: 'shape', shape: 'rect', x: x + lw + 0.1, y: yy + 0.07, w: bw, h: 0.22, fill: r.color || C.green },
    { t: 'text', x: x + lw + 0.15 + bw, y: yy, w: 0.7, h: 0.34, runs: [t(fmt(r.value), { size: 10, b: true })] },
  ];
});

/**
 * ch = final-seminar-chapter · o = { part, title(장 이름), academy(학원 이름) }
 * → [{ key, title, els }] — numberSlides 가 쪽 번호를 붙인다.
 */
export function buildExamSlides(ch, o = {}) {
  if (!isExamChapter(ch) || !ch.exams.length) return [];
  const part = o.part || 1;
  const sec = o.title || '내신 시험 분석';
  const exams = ch.exams;
  const schools = [...new Set(exams.map((e) => e.school))];
  const slides = [];
  const add = (key, title, els) => slides.push({ key: `exam:${key}`, title, els });

  // ── 파트 표지 ──
  add('cover', '파트 표지', [
    { t: 'text', x: 0.6, y: 1.55, w: 8.8, h: 0.5, runs: [t(`PART. ${String(part).padStart(2, '0')}`, { size: 18, b: true, color: C.green })] },
    { t: 'text', x: 0.6, y: 2.05, w: 8.8, h: 1.0, runs: [t(sec, { size: 40, b: true })] },
    { t: 'line', x: 0.6, y: 3.2, w: 1.2, color: C.green },
    { t: 'text', x: 0.6, y: 3.35, w: 8.8, h: 0.5, runs: [t(`${schools.length}개 학교 · 시험 ${exams.length}회 · 학교 시험지 문항 분석 기준`, { size: 13, color: C.sub })] },
  ]);

  // ── 분석한 시험 한눈에 ──
  const head = ['학교', '학년', '시험', '과목', '문항', '평균 난이도', '킬러', '평균 점수'].map((x) => ({ text: x, fill: C.head, b: true, align: 'center' }));
  chunk(exams, 9).forEach((pg, i, all) => {
    add(`overview:${i}`, `시험 한눈에${all.length > 1 ? ` ${i + 1}` : ''}`, [
      header(part, `${sec}: 분석한 시험`),
      { t: 'table', x: 0.35, y: 1.1, w: 9.3, colW: [1.7, 0.75, 1.75, 1.5, 0.7, 1.1, 0.7, 1.1], rowH: 0.38, size: 10.5, rows: [head, ...pg.map((e) => [
        { text: e.school, align: 'center', b: true }, { text: num(e.grade), align: 'center' }, { text: num(e.examName), align: 'center' }, { text: num(e.subject), align: 'center' },
        { text: `${e.questions}`, align: 'center' }, { text: `${e.avgDifficulty} / 5`, align: 'center' }, { text: `${e.killerCount}`, align: 'center' },
        { text: e.averageScore ? `${e.averageScore}점` : '—', align: 'center' },
      ])] },
    ]);
  });

  // ── 우리 동네 경향(시험 2회 이상) ──
  if (exams.length >= 2) {
    const diff = [...exams].sort((a, b) => b.avgDifficulty - a.avgDifficulty).slice(0, 9).map((e) => ({ label: label(e), value: e.avgDifficulty }));
    const types = (ch.areaTypes || []).slice(0, 8);
    add('area', '우리 동네 경향', [
      header(part, `${sec}: 우리 동네 경향`),
      { t: 'text', x: 0.35, y: 1.0, w: 4.8, h: 0.35, runs: [t('시험별 평균 난이도', { size: 14, b: true }), t('  (5점 만점, 높을수록 어려움)', { size: 10, color: C.sub })] },
      ...hbars(diff, 0.35, 1.45, 4.9, 5, (v) => `${v}`),
      { t: 'text', x: 5.55, y: 1.0, w: 4.1, h: 0.35, runs: [t('많이 나온 유형', { size: 14, b: true })] },
      { t: 'table', x: 5.55, y: 1.45, w: 4.1, colW: [3.1, 1.0], rowH: 0.36, size: 10.5, rows: [
        [{ text: '유형', fill: C.head, b: true, align: 'center' }, { text: '문항 수', fill: C.head, b: true, align: 'center' }],
        ...types.map((x) => [{ text: short(x.type, 26) }, { text: `${x.count}`, align: 'center', b: true }]),
      ] },
    ]);
  }

  // ── 학교·시험별 ──
  for (const [k, e] of exams.entries()) {
    const src = (e.sources || []).filter((s) => s.count > 0);
    const right = [];
    let y = 2.2;
    if (src.length) {
      right.push(
        { t: 'text', x: 0.35, y, w: 4.4, h: 0.3, runs: [t('출처 비중', { size: 12, b: true })] },
        { t: 'bars', x: 0.35, y: y + 0.3, w: 4.4, h: 0.9, categories: ['출처'], series: src.map((s) => ({ name: s.source, color: SRC[s.source] || '9CA3AF', values: [s.pct || 0] })) },
      );
      y += 1.35;
    }
    const tw = 4.6;
    add(`exam:${k}`, `${e.school} ${e.examName}`.trim(), [
      header(part, `${sec}: ${e.school}`),
      { t: 'text', x: 0.35, y: 0.95, w: 9.3, h: 0.35, runs: [t(`${[e.grade, e.examName, e.subject].filter(Boolean).join(' · ')}${e.examDate ? ` · ${e.examDate}` : ''}`, { size: 13, b: true, color: C.greenDeep })] },
      ...tile(0.35, 1.35, 2.2, '문항 수', `${e.questions}문항${e.essays ? ` (서술 ${e.essays})` : ''}`),
      ...tile(2.7, 1.35, 2.2, '평균 난이도', `${e.avgDifficulty} / 5`),
      ...tile(5.05, 1.35, 2.2, '킬러 문항', `${e.killerCount}문항`),
      ...tile(7.4, 1.35, 2.25, e.basePts !== null && e.basePts !== undefined ? '기본 확보 점수' : '평균 점수', e.basePts !== null && e.basePts !== undefined ? `${e.basePts}점` : e.averageScore ? `${e.averageScore}점` : '—'),
      ...right,
      ...(e.types?.length ? [
        { t: 'text', x: 0.35, y, w: 4.4, h: 0.3, runs: [t('많이 나온 유형', { size: 12, b: true })] },
        { t: 'text', x: 0.35, y: y + 0.3, w: 4.4, h: 5.3 - y - 0.3, valign: 'top', runs: e.types.flatMap((x, i) => [t(`${short(x.type, 22)}  `, { size: 11 }), t(`${x.count}문항`, { size: 11, b: true, color: C.green, br: i < e.types.length - 1 })]) },
      ] : []),
      { t: 'text', x: 5.05, y: 2.2, w: tw, h: 0.3, runs: [t('출제 경향', { size: 12, b: true, color: C.greenDeep })] },
      list(e.trends?.length ? e.trends : ['(출제 경향을 적어 주세요)'], 5.05, 2.5, tw, 1.35, 11),
      { t: 'text', x: 5.05, y: 3.9, w: tw, h: 0.3, runs: [t('점수 차이를 만든 문항', { size: 12, b: true, color: C.greenDeep })] },
      list(e.killers?.length ? e.killers : ['—'], 5.05, 4.2, tw, 1.15, 11),
    ]);
  }

  // ── 학교 출제 경향(같은 학교 2회 이상) ──
  for (const [k, s] of (ch.schools || []).entries()) {
    add(`school:${k}`, `${s.school} 출제 경향`, [
      header(part, `${sec}: ${s.school} 출제 경향`),
      { t: 'text', x: 0.35, y: 0.95, w: 9.3, h: 0.35, runs: [t(`최근 ${s.totalExams}회 시험 누적 · 평균 난이도 ${s.avgDifficulty} / 5`, { size: 13, b: true, color: C.greenDeep })] },
      { t: 'text', x: 0.35, y: 1.4, w: 4.6, h: 0.3, runs: [t('이 학교만의 특징', { size: 13, b: true })] },
      list(s.signatures?.length ? s.signatures : ['(특징을 적어 주세요)'], 0.35, 1.75, 4.6, 3.5, 12),
      { t: 'table', x: 5.25, y: 1.4, w: 4.4, colW: [2.6, 0.95, 0.85], rowH: 0.36, size: 10, rows: [
        ['유형', '출제 회차', '회당'].map((x) => ({ text: x, fill: C.head, b: true, align: 'center' })),
        ...(s.types || []).map((x) => [{ text: short(x.type, 22) }, { text: `${x.appeared}/${s.totalExams}회`, align: 'center' }, { text: `${x.avgPerExam}`, align: 'center' }]),
      ] },
    ]);
  }

  // ── 학원 자료 적중 ──
  const hits = exams.filter((e) => e.hit);
  if (hits.length) {
    add('hit', '학원 자료 적중', [
      header(part, `${sec}: 우리 학원 자료 적중`),
      { t: 'text', x: 0.35, y: 1.0, w: 9.3, h: 0.35, runs: [t('시험 문항 중 우리 학원 교재·자료에서 같은 유형·지문으로 다룬 비율', { size: 12, color: C.sub })] },
      ...hbars(hits.slice(0, 9).map((e) => ({ label: label(e), value: e.hit.pct })), 0.35, 1.5, 6.2, 100, (v) => `${v}%`),
      list(hits.slice(0, 9).map((e) => `${short(label(e), 18)}: ${e.hit.total}문항 중 ${e.hit.matched}문항`), 6.7, 1.5, 3.0, 3.8, 10),
    ]);
  }

  // ── 대비 전략 ──
  add('plan', '대비 전략', [
    header(part, `${sec}: ${o.academy || ch.academy ? `${o.academy || ch.academy}의 ` : ''}대비 전략`),
    list((ch.plan || []).length ? ch.plan : ['(학원의 대비 전략을 적어 주세요)'], 0.6, 1.2, 8.8, 4.1, 15),
  ]);
  return slides;
}
