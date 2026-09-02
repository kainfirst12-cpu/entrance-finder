// services/ipgyeolSearch.js — 전 대학 입결 통합 검색 (입결 콘솔 AI 검색용)
//
// 왜 별도 인덱스인가:
//   /api/ipgyeol/:unvCd 는 "대학 하나"를 통째로 내려주는 구조라, "수도권 간호학과 중 3등급대"처럼
//   대학을 가로지르는 질문에 답할 수 없다. 그렇다고 27MB 원본을 AI에게 통째로 줄 수도 없다.
//   → AI는 "자연어 → 필터 JSON" 변환만 맡고, 실제 검색은 이 모듈이 결정적으로 수행한다.
//     (AI가 숫자를 지어내는 일이 원천적으로 불가능한 구조)
import { readFileSync, readdirSync } from 'fs';
import { fieldOf, FIELDS } from './deptField.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ADIGA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'adiga');
const IPG_DIR = join(ADIGA_DIR, 'ipgyeol');

export const REGIONS = ['서울', '경기', '인천', '강원', '대전', '세종', '충남', '충북',
  '광주', '전남', '전북', '대구', '경북', '부산', '울산', '경남', '제주'];
export const TRACKS = ['교과', '종합', '논술', '실기'];
export { FIELDS, FIELD_LABEL } from './deptField.js';
const CAPITAL = ['서울', '경기', '인천'];

// 캠퍼스 구분 — 어디가 원본은 이름 뒤 대괄호로만 본캠/지역캠을 구분한다.
//   '중앙대학교[본교]' vs '중앙대학교[제2캠퍼스]', '고려대학교(세종)[분교]'
// 이 구분을 검색 단계에서 갖고 있지 않으면 "본캠만" 같은 조건을 아예 걸 수 없고,
// 결과 목록에서 같은 대학의 본캠·지역캠이 뒤섞여 나온다.
export function campusOf(name) {
  const m = String(name || '').match(/\[([^\]]+)\]$/);
  return !m || m[1] === '본교' ? 'main' : 'branch';
}
export function baseUnivName(name) {
  return String(name || '').replace(/\s*(?:\([^)]*\))?\s*\[[^\]]*\]$/, '').trim();
}

// 표시용 이름 — 본교는 대괄호만 떼고, 지역캠은 캠퍼스를 남긴다.
//   '중앙대학교[본교]' → '중앙대학교'   '중앙대학교[제2캠퍼스]' → '중앙대학교 제2캠'
//   '고려대학교(세종)[분교]' → '고려대학교(세종)'
// (예전처럼 대괄호를 통째로 지우면 두 학교가 같은 이름이 되어 AI 요약·리포트에서 구분이 사라진다)
export function univLabel(name) {
  const raw = String(name || '').trim();
  const m = raw.match(/^(.*?)(?:\(([^)]+)\))?\[([^\]]+)\]$/);
  if (!m) return raw;
  const [, base, alias, mark] = m;
  if (mark === '본교') return base.trim();
  if (alias) return `${base.trim()}(${alias})`;
  const num = mark.match(/^제\s*(\d+)\s*캠퍼스$/);
  return num ? `${base.trim()} 제${num[1]}캠` : `${base.trim()} ${mark}`;
}

// 압축 인덱스: 전 대학 학과×전형 71,000여 건을 필터링에 필요한 필드만 담아 상주시킨다.
// 카드 렌더에 필요한 전체 연도 상세(환산점수 등)는 상위 N건이 정해진 뒤 원본에서 다시 읽는다.
let INDEX = null;   // [{ u, d, t, tn, f(계열), y: { '2026': [g70, rate, fill, recruit] } }]
let UNIVS = null;   // unvCd → { name, region, campus, base, sunung: [{track, text}] }

const nfc = (s) => String(s || '').normalize('NFC');

export function buildIndex() {
  if (INDEX) return;
  const t0 = Date.now();
  const idx = [];
  const univs = new Map();
  for (const f of readdirSync(IPG_DIR)) {
    if (!f.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(readFileSync(join(IPG_DIR, f), 'utf8')); } catch { continue; }
    univs.set(j.unvCd, {
      name: j.name, region: j.region || '', sunung: j.sunung || [],
      campus: campusOf(j.name), base: baseUnivName(j.name),
    });
    for (const e of j.entries || []) {
      const y = {};
      for (const [yr, d] of Object.entries(e.years || {})) {
        // 경쟁률·모집인원 0은 실제 값이 아니라 미기재다. 그대로 두면 '경쟁률 낮은 순'이 빈칸으로 뒤덮인다.
        y[yr] = [d.grade70 ?? null, d.rate > 0 ? d.rate : null, d.fill ?? null, d.recruit > 0 ? d.recruit : null];
      }
      idx.push({ u: j.unvCd, d: e.dept, t: e.track, tn: e.typeName, f: fieldOf(e.dept), y });
    }
  }
  INDEX = idx;
  UNIVS = univs;
  console.log(`[ipgyeol-search] 인덱스 준비 완료 — ${idx.length.toLocaleString()}건 / ${univs.size}개 대학 (${Date.now() - t0}ms)`);
}

// 원본 파일 소량 캐시 (상위 결과의 상세 연도 데이터 복원용)
const fileCache = new Map();
function loadUniv(unvCd) {
  if (fileCache.has(unvCd)) return fileCache.get(unvCd);
  let j = null;
  try { j = JSON.parse(readFileSync(join(IPG_DIR, `${unvCd}.json`), 'utf8')); } catch {}
  if (fileCache.size >= 12) fileCache.delete(fileCache.keys().next().value);
  fileCache.set(unvCd, j);
  return j;
}

// 기준연도 이하 최신값 + 직전 비교값
function pickLatest(y, baseYear) {
  const ys = Object.keys(y).filter((k) => k <= baseYear).sort();
  if (!ys.length) return null;
  const last = ys[ys.length - 1];
  const [g70, rate, fill, recruit] = y[last];
  let prevG = null;
  for (let i = ys.length - 2; i >= 0; i--) {
    if (y[ys[i]][0] != null) { prevG = y[ys[i]][0]; break; }
  }
  return { year: last, g70, rate, fill, recruit, prevG };
}

export function verdictOf(cut, grade) {
  if (cut == null || grade == null) return null;
  const diff = cut - grade;
  return diff >= 0.35 ? '안정' : diff >= -0.05 ? '적정' : diff >= -0.4 ? '소신' : '위험';
}

// 대학의 수능최저 안내문 중 해당 전형구분 것
function sunungFor(univ, track) {
  return (univ?.sunung || []).find((s) => String(s.track || '').includes(track)) || null;
}

/**
 * 결정적 검색 — AI가 만든 필터를 그대로 적용한다.
 * filter: {
 *   regions[], capitalOnly, campus('main'|'branch'), fields[]('인문'|'자연'|'예체능'),
 *   univKeywords[], deptKeywords[], excludeKeywords[],
 *   tracks[], typeKeywords[], gradeMin, gradeMax, targetGrade, verdicts[],
 *   rateMin, rateMax, recruitMin, trend('easing'|'tightening'), sunung('none'|'required'),
 *   baseYear, sortBy, limit
 * }
 */
export function searchEntries(filter = {}) {
  buildIndex();
  const baseYear = String(filter.baseYear || '2026');
  const limit = Math.min(Math.max(Number(filter.limit) || 24, 1), 60);
  const target = filter.targetGrade == null ? null : Number(filter.targetGrade);

  const regions = new Set([
    ...(filter.regions || []).filter((r) => REGIONS.includes(r)),
    ...(filter.capitalOnly ? CAPITAL : []),
  ]);
  const tracks = new Set((filter.tracks || []).filter((t) => TRACKS.includes(t)));
  const campusPick = filter.campus === 'main' || filter.campus === 'branch' ? filter.campus : null;
  // 계열(문과/이과) — 학과명에서 판별한다. 미분류(자유전공·융합 등)는 어느 계열로도 잡히지 않는다.
  const fields = new Set((filter.fields || []).filter((f) => FIELDS.includes(f)));
  const deptKw = (filter.deptKeywords || []).map(nfc).filter(Boolean);
  const exKw = (filter.excludeKeywords || []).map(nfc).filter(Boolean);
  const typeKw = (filter.typeKeywords || []).map(nfc).filter(Boolean);
  const univKw = (filter.univKeywords || []).map(nfc).filter(Boolean);
  // 판정 필터는 학생 내신이 있어야 의미가 있다. 없으면 조용히 무시(전부 걸러져 0건이 되는 것보다 낫다)
  const verdicts = new Set(target == null ? [] : (filter.verdicts || []));

  const hits = [];
  for (const row of INDEX) {
    const u = UNIVS.get(row.u);
    if (!u) continue;
    if (regions.size && !regions.has(u.region)) continue;
    if (univKw.length && !univKw.some((k) => nfc(u.name).includes(k))) continue;
    // 본캠/지역캠(분교·제N캠퍼스)은 입결이 전혀 다른 학교다. 섞이면 상담에서 그대로 사고가 된다.
    if (campusPick && u.campus !== campusPick) continue;
    if (fields.size && !fields.has(row.f)) continue;
    if (tracks.size && !tracks.has(row.t)) continue;
    if (deptKw.length && !deptKw.some((k) => nfc(row.d).includes(k))) continue;
    if (exKw.length && exKw.some((k) => nfc(row.d).includes(k) || nfc(row.tn).includes(k))) continue;
    if (typeKw.length && !typeKw.some((k) => nfc(row.tn).includes(k))) continue;

    const L = pickLatest(row.y, baseYear);
    if (!L) continue;
    // 기준연도 기준 3개년 밖(오래된 자료만 있는 전형)은 제외 — 지금 지원 판단에 못 쓴다
    if (Number(L.year) < Number(baseYear) - 2) continue;
    if (L.g70 == null) continue;

    if (filter.gradeMin != null && L.g70 < Number(filter.gradeMin)) continue;
    if (filter.gradeMax != null && L.g70 > Number(filter.gradeMax)) continue;
    if (filter.rateMin != null && (L.rate == null || L.rate < Number(filter.rateMin))) continue;
    if (filter.rateMax != null && (L.rate == null || L.rate > Number(filter.rateMax))) continue;
    if (filter.recruitMin != null && (L.recruit == null || L.recruit < Number(filter.recruitMin))) continue;

    const delta = L.prevG != null ? Math.round((L.g70 - L.prevG) * 100) / 100 : null;
    if (filter.trend === 'easing' && !(delta != null && delta >= 0.1)) continue;      // 컷 등급이 높아짐 = 완화
    if (filter.trend === 'tightening' && !(delta != null && delta <= -0.1)) continue; // 컷 등급이 낮아짐 = 상승

    const sn = sunungFor(u, row.t);
    if (filter.sunung === 'none' && sn) continue;
    if (filter.sunung === 'required' && !sn) continue;

    const v = verdictOf(L.g70, target);
    if (verdicts.size && (!v || !verdicts.has(v))) continue;

    hits.push({
      unvCd: row.u, univName: u.name, region: u.region, campus: u.campus,
      dept: row.d, track: row.t, typeName: row.tn, field: row.f,
      cut70: L.g70, cutYear: L.year, rate: L.rate, fill: L.fill, recruit: L.recruit,
      delta, verdict: v,
    });
  }

  let sortBy = filter.sortBy || (target != null ? 'fit' : 'cut');
  if (sortBy === 'fit' && target == null) sortBy = 'cut'; // 기준 등급 없이 '근접순'은 성립하지 않는다
  const cmp = {
    fit: (a, b) => Math.abs(a.cut70 - target) - Math.abs(b.cut70 - target),
    cut: (a, b) => a.cut70 - b.cut70,             // 컷이 낮은(상위권) 순
    easy: (a, b) => b.cut70 - a.cut70,            // 컷이 높은(여유 있는) 순
    rate: (a, b) => (a.rate ?? 1e9) - (b.rate ?? 1e9),
    recruit: (a, b) => (b.recruit ?? -1) - (a.recruit ?? -1),
    trend: (a, b) => (b.delta ?? -1e9) - (a.delta ?? -1e9),
  }[sortBy] || ((a, b) => a.cut70 - b.cut70);
  hits.sort(cmp);

  const total = hits.length;
  const top = hits.slice(0, limit);

  // 상위 결과만 원본에서 전체 연도 상세를 복원해 카드로 만든다
  const results = [];
  for (const h of top) {
    const uj = loadUniv(h.unvCd);
    const entry = (uj?.entries || []).find((e) => e.dept === h.dept && e.track === h.track && e.typeName === h.typeName);
    if (!entry) continue;
    results.push({
      key: `${h.unvCd}|${h.dept}|${h.track}|${h.typeName}`,
      univ: { unvCd: h.unvCd, name: h.univName, region: h.region, campus: h.campus },
      entry: { ...entry, field: h.field },
      sunung: sunungFor(UNIVS.get(h.unvCd), h.track),
      jonghapSiblings: [],
      match: { cut70: h.cut70, cutYear: h.cutYear, rate: h.rate, fill: h.fill, recruit: h.recruit, delta: h.delta, verdict: h.verdict },
    });
  }
  return { total, results };
}

// 인덱스 통계 (관리/디버깅용)
export function indexStats() {
  buildIndex();
  return { entries: INDEX.length, universities: UNIVS.size };
}
