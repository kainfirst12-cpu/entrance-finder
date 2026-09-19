// services/schoolReportData.js — 학교 입시 해설 보고서의 '수치 블록'(data)
//
// AI 가 쓰는 본문(마크다운)과 별개로, 표·차트에 쓸 숫자는 여기서 catalog 수치로 결정론적으로 만든다.
// 같은 data 를 PDF(pdfService)·Word(docxService)·화면 미리보기(SchoolReport.jsx)·나만의 패파(MarkdownReportDoc)가
// 같은 모양으로 그린다 — 보고서마다 표가 다르게 생기거나 AI 가 숫자를 잘못 옮기는 일을 막는다.
//
//   data = { v: 1, kind: 'school'|'compare', year, schools: [{
//     id, name, level, chips: [...], stats: { g1, g2, g3, total, seats, classes, teachers, students },
//     core: { '1': { '국어': band, '영어': band, '수학': band }, '2': {...}, '3': {...} },   // band = { subject, sem, mean, a, b, c, d, e }
//     subjects, threeStep,   // 개설 과목 수 · A·B·C 3단계(진로선택·체육예술) 과목 수
//   }] }

const FAMILIES = ['국어', '영어', '수학'];
// 종합고·특성화고는 '과목 [일반계 / 전체학과]' 처럼 계열별 줄만 있는 곳이 있다 → 전체계열 > 일반계 > 나머지 (화면 pickBand 와 같은 규칙)
const trackRank = (subject) => (!/\[/.test(subject) ? 0 : /일반계/.test(subject) ? 1 : 2);

function pickBand(bands, family, grade) {
  const list = bands.filter((b) => b.family === family && b.grade === grade && b.a !== null && b.a !== undefined);
  if (!list.length) return null;
  const b = list.sort((x, y) => trackRank(x.subject) - trackRank(y.subject) || (y.semester || 0) - (x.semester || 0))[0];
  return { subject: b.subject, sem: b.semester, mean: b.mean, a: b.a, b: b.b, c: b.c, d: b.d, e: b.e };
}

export function buildReportData(kind, schools) {
  const out = [];
  const years = new Set();
  for (const s of schools) {
    const bands = Array.isArray(s.bands) ? s.bands : [];
    bands.forEach((b) => b.year && years.add(b.year));
    const e = s.enrollment || {};
    const core = {};
    for (const g of [1, 2, 3]) {
      const row = {};
      for (const f of FAMILIES) { const b = pickBand(bands, f, g); if (b) row[f] = b; }
      if (Object.keys(row).length) core[g] = row;
    }
    const others = bands.filter((b) => !b.family);
    out.push({
      id: s.id, name: s.schoolName, level: s.schoolLevel,
      chips: [s.schoolType, s.fond, s.gender, [s.sido, s.sigungu].filter(Boolean).join(' ')].filter(Boolean),
      stats: {
        g1: e.grade1 ?? null, g2: e.grade2 ?? null, g3: e.grade3 ?? null, total: e.total ?? null,
        seats: s.schoolLevel === '고등학교' && e.grade1 ? Math.round(e.grade1 * 0.1) : null,
        classes: s.edss?.classes ?? null, teachers: s.current?.teachers ?? s.edss?.teachers ?? null, // 학교알리미 학교정보(2026)가 EDSS(2025)보다 최신
        students: s.current?.students ?? null,
      },
      core,
      subjects: new Set(bands.map((b) => b.subject)).size,
      threeStep: new Set(others.filter((b) => b.d === null && b.e === null).map((b) => b.subject)).size,
    });
  }
  return { v: 1, kind: kind === 'compare' && schools.length > 1 ? 'compare' : 'school', year: [...years].sort().pop() || null, schools: out };
}
