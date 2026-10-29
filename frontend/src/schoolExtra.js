// 학교알리미 학교별 공시 추가 항목 — 졸업생 진로(3개년) · 학교 현황(학급당·수업교원 1인당 학생수) · 전출입·학업중단 · 기간제 교사 비율 · 동아리.
// 파일은 scripts/schoolinfo/build-extra.mjs 가 만든 /data/school-extra.json.gz (키 = catalog 의 shlIdfCd). 없으면(옛 배포) 조용히 숨긴다.
import { fetchGzJson } from './schoolCatalog';

let p = null;
export function loadExtra() {
  if (!p) p = fetchGzJson('/data/school-extra.json.gz').catch(() => { p = null; return null; });
  return p;
}

/** 학교 한 곳의 추가 항목 (없으면 null) */
export const extraOf = (ex, s) => (ex && s?.shlIdfCd ? ex.schools?.[s.shlIdfCd] || null : null);

/** '2025-11' → '2025.2 졸업' (11월 공시 = 그 해 2월 졸업생) */
export const gradLabel = (y) => (y ? `${String(y).slice(0, 4)}.2 졸업` : '');

const avg = (xs) => { const v = xs.filter((x) => typeof x === 'number'); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };

/** 고교 진로 요약 — 최근 해 + 3개년 평균. 중학교는 진학 고교 유형 */
export function careerSummary(x, level) {
  const c = x?.career;
  if (!c?.length) return null;
  const last = c[0];
  if (level === '고등학교') {
    return {
      last, years: c.length, voc: !!last.voc,
      univ3: avg(c.map((r) => r.univ)), etc3: avg(c.map((r) => r.etc)), college3: avg(c.map((r) => r.college)),
      univTrend: c.length >= 2 && typeof c[0].univ === 'number' && typeof c[c.length - 1].univ === 'number' ? Math.round((c[0].univ - c[c.length - 1].univ) * 10) / 10 : null,
    };
  }
  const sel = (r) => [r.science, r.foreign, r.arts, r.jasa].reduce((a, b) => a + (b || 0), 0);
  return { last, years: c.length, select: Math.round(sel(last) * 10) / 10, select3: avg(c.map(sel)), general3: avg(c.map((r) => r.general)) };
}

/** 지역 평균(시군구·시도·전국) — i: 0 시군구, 1 시도, 2 전국 */
export function areaAvg(ex, s, i) {
  const x = extraOf(ex, s);
  const name = x?.area?.[i];
  return name ? { name, ...(ex.areas?.[`${s.schoolLevel}|${name}`] || {}) } : null;
}

// 학교 위치 — scripts/schoolinfo/build-locations.mjs (공공데이터포털 전국초중등학교위치표준데이터). { [shlIdfCd]: [위도, 경도] }
let lp = null;
export function loadLocations() {
  if (!lp) lp = fetchGzJson('/data/school-locations.json.gz').catch(() => { lp = null; return null; });
  return lp;
}
/** 두 좌표 사이 직선거리(km) — 실제 통학 거리·시간은 길·교통에 따라 더 길다 */
export function distanceKm(a, b) {
  if (!a || !b) return null;
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** 정렬용 값 */
export const SORT_GETTERS = {
  'univ-desc': (x) => careerSummary(x, '고등학교')?.last?.univ ?? null,
  'univ3-desc': (x) => careerSummary(x, '고등학교')?.univ3 ?? null,
  'etc-desc': (x) => careerSummary(x, '고등학교')?.last?.etc ?? null,
  'perclass-asc': (x) => x?.status?.perClass ?? null,
  'perteacher-asc': (x) => x?.status?.perTeacher ?? null,
  'select-desc': (x) => careerSummary(x, '중학교')?.select ?? null,
};

// 서울 고입 안내 — 원장 지식베이스 '고1 입시스타터팩'(서울생활권 5권·자사 국제 외고_서울·고교 유형별 진학 경로)을 옮긴 것.
// /data/seoul-high-guide.json : { assignment, areas{생활권}, schools{학교명}, paths }. 서울 고교에만 붙는다.
let gp = null;
export function loadSeoulGuide() {
  if (!gp) gp = fetchGzJson('/data/seoul-high-guide.json').catch(() => { gp = null; return null; });
  return gp;
}
const shortHigh = (n) => String(n || '').replace(/\s+/g, '').replace(/고등학교$/, '고');
/** 학교 한 곳의 서울 고입 안내 → { school, area } (서울 고교가 아니거나 자료에 없으면 null) */
export function seoulGuideOf(g, s) {
  if (!g || s?.sido !== '서울특별시' || s.schoolLevel !== '고등학교') return null;
  const key = Object.keys(g.schools || {}).find((k) => k === s.schoolName) || Object.keys(g.schools || {}).find((k) => shortHigh(k) === shortHigh(s.schoolName));
  const school = key ? g.schools[key] : null;
  const areaName = school?.area || Object.keys(g.areas || {}).find((a) => (g.areas[a].gus || []).includes(s.sigungu));
  const area = areaName ? { name: areaName, ...g.areas[areaName] } : null;
  if (!school && !area) return null;
  return { school, area };
}
