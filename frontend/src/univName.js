// univName.js — 본캠 / 지역캠(분교·제N캠퍼스) 구분 표기
//
// 어디가 원본은 캠퍼스를 이름 뒤 대괄호로만 구분한다.
//   '중앙대학교[본교]' · '중앙대학교[제2캠퍼스]' · '고려대학교(세종)[분교]' · '한양대학교(ERICA)[분교]'
// 화면에서 이 대괄호를 통째로 지우면(예전 방식) '중앙대학교'가 두 줄 생겨,
// 목록·카드·리포트 어디서도 본캠과 지역캠을 구분할 수 없다 — 상담에서 가장 위험한 혼동이다.
//   → 본교는 지우고, 그 밖의 캠퍼스는 이름 옆에 남긴다. 캠퍼스명을 지어내지 않고 원본 표기만 쓴다.

const CAMPUS_RE = /^(.*?)(?:\(([^)]+)\))?\[([^\]]+)\]$/;

/** '고려대학교(세종)[분교]' → { base:'고려대학교', alias:'세종', mark:'분교', kind:'branch', num:0 } */
export function parseUniv(name) {
  const raw = String(name || '').trim();
  const m = raw.match(CAMPUS_RE);
  if (!m) return { raw, base: raw, alias: '', mark: '', kind: 'main', num: 0 };
  const base = (m[1] || '').trim();
  const alias = (m[2] || '').trim();
  const mark = (m[3] || '').trim();
  const numM = mark.match(/^제\s*(\d+)\s*캠퍼스$/);
  const kind = mark === '본교' ? 'main' : numM ? 'second' : mark === '분교' ? 'branch' : 'branch';
  return { raw, base, alias, mark, kind, num: numM ? Number(numM[1]) : 0 };
}

/** 본캠 여부 — 분교·제2캠퍼스는 false */
export function isMainCampus(name) {
  return parseUniv(name).kind === 'main';
}

/** 화면·리포트에 쓰는 이름. 본교는 대학명만, 그 밖에는 캠퍼스를 붙인다. */
export function univLabel(name) {
  const u = parseUniv(name);
  if (u.kind === 'main') return u.base;
  if (u.alias) return `${u.base}(${u.alias})`;
  if (u.kind === 'second') return `${u.base} 제${u.num}캠`;
  return `${u.base} 분교`;
}

/** 이름 옆 배지 문구 — 본캠은 배지를 달지 않으므로 빈 문자열 */
export function campusBadge(name) {
  const u = parseUniv(name);
  if (u.kind === 'main') return '';
  if (u.kind === 'second') return `제${u.num}캠퍼스`;
  return u.alias ? `${u.alias} 분교` : '분교';
}

/** 캠퍼스 필터용 구분값 */
export const campusOf = (name) => (isMainCampus(name) ? 'main' : 'branch');

/** 대학명 → 같은 대학끼리 묶고 본캠을 먼저 (목록에서 본캠·지역캠이 흩어지지 않게) */
export function sortByCampus(list, nameOf = (x) => x.name) {
  return [...list].sort((a, b) => {
    const ua = parseUniv(nameOf(a));
    const ub = parseUniv(nameOf(b));
    if (ua.base !== ub.base) return ua.base.localeCompare(ub.base, 'ko');
    if (ua.kind !== ub.kind) return ua.kind === 'main' ? -1 : 1;
    return ua.num - ub.num;
  });
}
