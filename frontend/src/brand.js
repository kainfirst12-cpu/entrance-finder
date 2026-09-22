// 학원 브랜드(설정 → 브랜드) — 서버가 만드는 PDF·Word 의 머리말·꼬리말·로고에 쓴다.
// 설정은 브라우저(localStorage)에만 있으니 서버로 문서를 만들어 달라고 할 때마다 같이 보낸다.
//   POST 요청: body.brand = readBrand()           (로고 data URL 포함, 500KB 이하)
//   GET  요청: headers['x-brand'] = brandHeader()   (헤더는 크기 제한이 있어 로고 없이 이름만)
export const BRAND_DEFAULT = { name: 'PATHFINDER EDU', sub: '패스파인더 에듀', reportTitle: 'PATHFINDER REPORT' };

export function readBrand({ logo = true } = {}) {
  const get = (k, d) => { try { const v = localStorage.getItem(k); return v && v.trim() ? v.trim() : d; } catch { return d; } };
  const b = { name: get('ef_brand_name', BRAND_DEFAULT.name), sub: get('ef_brand_sub', BRAND_DEFAULT.sub), reportTitle: get('ef_report_title', BRAND_DEFAULT.reportTitle) };
  if (logo) { const l = get('ef_logo', ''); if (l.startsWith('data:image/')) b.logo = l; }
  return b;
}

// 한글이 들어가므로 UTF-8 → base64 로 감싼다(HTTP 헤더는 ASCII 만 안전)
export function brandHeader() {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(readBrand({ logo: false }))))); } catch { return ''; }
}
