// 설명회 자료 — 학교별 성취도 분석(결정론). AI 없이도 항상 같은 결과가 나온다.
//
// 2025학년도(고교학점제)부터 학교알리미 공시에 표준편차가 빠졌다 → 작년 설명회 자료처럼
// A~E 에 점수(A=5 … E=1)를 매겨 분포에서 '상대 표준편차'를 계산한다(실제 표준편차가 아님 — 슬라이드에도 밝힌다).
// 비교 기준은 '고른 학교들끼리'다. 같은 학교도 어떤 학교들과 함께 고르느냐에 따라 분류가 달라질 수 있다.

export const SUBJECTS = [
  { key: '국어', label: '국어', test: (b) => b.family === '국어' },
  { key: '수학', label: '수학', test: (b) => b.family === '수학' },
  { key: '영어', label: '영어', test: (b) => b.family === '영어' },
  { key: '한국사', label: '한국사', test: (b) => /^한국사/.test(b.subject) },
  { key: '통합사회', label: '통합사회', test: (b) => /^통합사회/.test(b.subject) },
  { key: '통합과학', label: '통합과학', test: (b) => /^통합과학/.test(b.subject) },
];
const SUBJECT_KEYS = SUBJECTS.map((s) => s.key);
const LETTERS = ['a', 'b', 'c', 'd', 'e'];
const SCORE = { a: 5, b: 4, c: 3, d: 2, e: 1 };

// 종합고·특성화고의 '과목 [일반계 / 전체학과]' 줄 — 전체계열 > 일반계 > 나머지 (SchoolInfo pickBand 와 같은 규칙)
const trackRank = (subject) => (!/\[/.test(subject) ? 0 : /일반계/.test(subject) ? 1 : 2);
const yearNum = (y) => parseInt(String(y || ''), 10) || 0;
const round1 = (v) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
function sdOf(xs) { if (xs.length < 2) return 0; const m = avg(xs); return Math.sqrt(avg(xs.map((x) => (x - m) ** 2))); }

export const shortName = (name) => String(name || '')
  .replace(/여자고등학교$/, '여고').replace(/고등학교$/, '고')
  .replace(/여자중학교$/, '여중').replace(/중학교$/, '중');

/** 한 학교의 1학년 핵심 과목 성적표. semester: 'avg' | 1 | 2 */
export function subjectTable(bands, { grade = 1, semester = 'avg', year = null } = {}) {
  const pool = (bands || []).filter((b) => b.grade === grade && b.a !== null && b.a !== undefined && b.e !== null && b.e !== undefined);
  // 학교마다 갱신 시점이 달라 '그 학교의' 최신 학년도를 쓴다(전국 최신과 비교 금지)
  const useYear = year || pool.filter((b) => SUBJECTS.some((s) => s.test(b))).map((b) => b.year).sort((x, y) => yearNum(y) - yearNum(x))[0] || null;
  const rows = {};
  for (const s of SUBJECTS) {
    let list = pool.filter((b) => s.test(b) && (!useYear || b.year === useYear));
    if (!list.length) continue;
    const best = Math.min(...list.map((b) => trackRank(b.subject)));
    list = list.filter((b) => trackRank(b.subject) === best);
    const sems = [...new Set(list.map((b) => b.semester))].sort();
    let pick = list;
    if (semester !== 'avg') { pick = list.filter((b) => b.semester === semester); if (!pick.length) continue; }
    const m = { key: s.key, label: s.label, subjects: [...new Set(pick.map((b) => b.subject))], semesters: [...new Set(pick.map((b) => b.semester))].sort(), available: sems };
    m.mean = round1(avg(pick.map((b) => Number(b.mean)).filter((v) => !Number.isNaN(v))));
    for (const L of LETTERS) m[L] = round1(avg(pick.map((b) => Number(b[L]) || 0)));
    const tot = LETTERS.reduce((t, L) => t + (m[L] || 0), 0) || 100;
    const p = Object.fromEntries(LETTERS.map((L) => [L, (m[L] || 0) / tot]));
    m.level = LETTERS.reduce((t, L) => t + p[L] * SCORE[L], 0);                       // 1~5, 클수록 상위권이 많다
    m.rsd = Math.sqrt(LETTERS.reduce((t, L) => t + p[L] * (SCORE[L] - m.level) ** 2, 0)); // 상대 표준편차(점수 1~5 기준)
    m.top = round1((m.a || 0) + (m.b || 0));
    m.low = round1((m.d || 0) + (m.e || 0));
    rows[s.key] = m;
  }
  return { year: useYear, rows };
}

// 분포 모양 — 작년 자료의 '안정형·하위권 집중·양극화·상위권 중심' 표현을 규칙으로
function shapeOf(m) {
  if (m.a >= 28 && m.e >= 28) return { tag: '양극화', text: '상위권과 하위권이 함께 두꺼움 → 중위권이 얇은 양극화' };
  if (m.low >= 50) return { tag: '하위권 집중', text: `하위권(D·E) ${Math.round(m.low)}% → 기초 학력 격차가 큼` };
  if (m.top >= 50 && m.e < 20) return { tag: '상위권 중심', text: `A·B ${Math.round(m.top)}% → 상위권 중심, 높은 성취 유지가 관건` };
  if (m.e >= 35) return { tag: '하위권 두꺼움', text: `E 비율 ${Math.round(m.e)}% → 하위층이 넓어 체감 난도가 높음` };
  if (m.c >= 24) return { tag: '중위권 두꺼움', text: '중위권(C)이 두꺼움 → 실수 하나로 등급이 갈리는 구간' };
  if (m.spreadZ >= 0.5) return { tag: '넓게 퍼짐', text: '상·하위가 넓게 퍼짐 → 학생 간 실력 차이가 큰 편' };
  if (m.spreadZ <= -0.5) return { tag: '가운데 몰림', text: '가운데로 몰린 분포 → 1~2점 차로 등급이 갈림' };
  return { tag: '고른 분포', text: '뚜렷한 쏠림 없이 고르게 분포' };
}
const levelWord = (z) => (z >= 0.5 ? '높고' : z <= -0.5 ? '낮고' : '중간,');
const spreadWord = (z) => (z >= 0.5 ? '편차 큼' : z <= -0.5 ? '편차 작음' : '편차 보통');

/**
 * 고른 학교들을 서로 비교해 과목별 해설·학교 유형을 만든다.
 * schools = [{ id, schoolName, bands }]
 */
export function analyzeSchools(schools, opts = {}) {
  const items = schools.map((s) => {
    const t = subjectTable(s.bands, opts);
    return { id: String(s.id), name: s.schoolName, short: shortName(s.schoolName), type: s.schoolType, gender: s.gender, sigungu: s.sigungu, enrollment: s.enrollment, year: t.year, rows: t.rows };
  });
  const usable = items.filter((it) => ['국어', '수학', '영어'].some((k) => it.rows[k]));

  // 과목별 집단 기준(평균·흩어짐)
  const group = {};
  for (const k of SUBJECT_KEYS) {
    const lv = usable.map((it) => it.rows[k]?.level).filter((v) => v !== undefined);
    const rs = usable.map((it) => it.rows[k]?.rsd).filter((v) => v !== undefined);
    group[k] = { level: avg(lv), levelSd: sdOf(lv) || 0.0001, rsd: avg(rs), rsdSd: sdOf(rs) || 0.0001, n: lv.length };
  }
  for (const it of usable) {
    for (const k of SUBJECT_KEYS) {
      const m = it.rows[k]; if (!m) continue;
      const g = group[k];
      m.z = g.n >= 2 ? (m.level - g.level) / g.levelSd : 0;
      m.spreadZ = g.n >= 2 ? (m.rsd - g.rsd) / g.rsdSd : 0;
      const shape = shapeOf(m); // spreadZ 를 쓰므로 위에서 먼저 계산
      m.shape = shape.tag;
      m.note = `평균 ${levelWord(m.z)} ${spreadWord(m.spreadZ)} → ${shape.text.split('→ ').pop()}`;
    }
    const get = (k) => it.rows[k]?.z ?? null;
    const pick = (ks) => { const v = ks.map(get).filter((x) => x !== null); return v.length ? avg(v) : null; };
    it.index = {
      국어: get('국어'), 수학: get('수학'), 영어: get('영어'),
      탐구: pick(['통합사회', '통합과학']), 사회: pick(['통합사회', '한국사']), 과학: get('통합과학'),
      전체: pick(SUBJECT_KEYS),
    };
    it.levelAll = avg(SUBJECT_KEYS.map((k) => it.rows[k]?.level).filter((v) => v !== undefined));
    it.spreadAll = avg(SUBJECT_KEYS.map((k) => it.rows[k]?.spreadZ).filter((v) => v !== undefined));
  }

  // 성취도 층(상·중·하) — 고른 학교 안에서 3등분
  const ranked = [...usable].sort((x, y) => (y.index.전체 ?? -9) - (x.index.전체 ?? -9));
  const n = ranked.length;
  ranked.forEach((it, i) => { it.tier = n < 3 ? 'mid' : i < Math.round(n / 3) ? 'top' : i >= n - Math.round(n / 3) ? 'low' : 'mid'; });

  // 과목별 강세 — 과목마다 상위 1/3(1~6곳, z>0 만). 한 학교가 여러 과목에 들어갈 수 있다(작년 자료와 같음).
  const strong = {};
  const quota = Math.min(6, Math.max(1, Math.round(n / 3))); // 작년 자료처럼 과목마다 4~6곳
  for (const k of ['국어', '수학', '영어', '탐구', '사회']) {
    let list = usable.filter((it) => it.index[k] !== null && it.index[k] > 0);
    if (k === '사회') list = list.filter((it) => (it.index.사회 ?? 0) - Math.max(it.index.수학 ?? 0, it.index.과학 ?? 0) > 0.3); // 수학·과학보다 사회 쪽이 뚜렷이 강한 곳
    strong[k] = list.sort((x, y) => y.index[k] - x.index[k]).slice(0, quota).map((it) => it.id);
  }

  // 학교 한 줄 유형 — "상위권 안정 / 수리·탐구형 / 편차 작음"
  for (const it of usable) {
    const fam = [['언어', avg([it.index.국어, it.index.영어].filter((v) => v !== null))], ['수리', it.index.수학], ['탐구', it.index.탐구], ['사회', it.index.사회]]
      .filter(([, v]) => v !== null && v !== undefined && v > 0.2).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([w]) => w);
    const tierWord = { top: '상위권 안정', mid: '중위권 성장형', low: '기초 보완형' }[it.tier];
    const spread = it.spreadAll >= 0.5 ? '실력 격차 큼' : it.spreadAll <= -0.5 ? '고른 분포' : null;
    it.typeLine = [tierWord, fam.length ? `${fam.join('·')}형` : '균형형', spread].filter(Boolean).join(' / ');
    it.famWords = fam;
    // 작년 자료 하단 두 줄처럼 — 강점 과목 + 보완할 과목
    const zs = ['국어', '수학', '영어', '통합사회', '통합과학'].map((k) => [k, it.rows[k]?.z]).filter(([, z]) => z !== undefined);
    const best = [...zs].sort((x, y) => y[1] - x[1])[0];
    const worst = [...zs].sort((x, y) => x[1] - y[1])[0];
    it.message = {
      strong: best && best[1] > 0.2 ? best[0].replace('통합', '') : null,
      weak: worst && worst[1] < -0.2 ? worst[0].replace('통합', '') : null,
    };
  }
  return { items, usable, group, strong, tiers: { top: ranked.filter((x) => x.tier === 'top'), mid: ranked.filter((x) => x.tier === 'mid'), low: ranked.filter((x) => x.tier === 'low') } };
}

/** AI 해설 요청용 요약(숫자만) — 서버 프롬프트에 그대로 들어간다 */
export function factsForAI(analysis) {
  return analysis.usable.map((it) => ({
    id: it.id, name: it.name, year: it.year, type: it.typeLine, tier: it.tier,
    subjects: Object.values(it.rows).map((m) => ({
      subject: m.label, mean: m.mean, A: m.a, B: m.b, C: m.c, D: m.d, E: m.e,
      relativeLevel: m.z === undefined ? null : round1(m.z), relativeSpread: m.spreadZ === undefined ? null : round1(m.spreadZ), shape: m.shape,
    })),
  }));
}
