// 학원 코드별 공개 메뉴 — 관리자가 코드마다 정한다(관리자 대시보드). null = 전부 공개.
// key 는 App.jsx 의 view 이름·백엔드 MENU_BY_PATH 와 같다.
export const MENU_ITEMS = [
  { key: 'form', label: '생기부 분석(새 분석·결과)' },
  { key: 'list', label: '학생 목록·관리 보드·로드맵' },
  { key: 'assessment', label: '수행평가 도우미' },
  { key: 'chat', label: '입시 상담' },
  { key: 'admissions', label: '대학 입결 조회' },
  { key: 'univinfo', label: '대학별 입시정보' },
  { key: 'schoolinfo', label: '고교·중학 공시정보' },
  { key: 'ipgyeol', label: '입결 콘솔' },
  { key: 'ratio', label: '실시간 경쟁률' },
  { key: 'suharchive', label: '수행평가 아카이브' },
  // ⚠ optIn: '전체 공개'여도 열리지 않는다 — 관리자가 코드마다 직접 체크해야 한다.
  //   해설 보고서 보관은 서버 DB 용량을 쓰므로(원장 지시 2026-09-21) 기본 잠금. 생성·수정·Word/PDF 내려받기는 그대로 된다.
  // 면접 전략 — 원래 관리자 전용. 관리자가 고른 원장님 코드에만 연다(2026-09-26).
  { key: 'interview', label: '면접 전략(선택한 코드만, 기본 잠금)', optIn: true },
  { key: 'schoolreports', label: '입시 해설 보고서 보관함(서버 저장 — 용량 사용, 기본 잠금)', optIn: true },
];
export const OPT_IN_MENUS = MENU_ITEMS.filter((m) => m.optIn).map((m) => m.key);
// view 이름 → 메뉴 key (같은 메뉴에 딸린 화면들)
const VIEW_MENU = { form: 'form', analyzing: 'form', result: 'form', list: 'list', board: 'list', interview: 'interview' };
export function menuOfView(view) { return VIEW_MENU[view] || view; }

export function readMenus() {
  try { const raw = localStorage.getItem('ef_menus'); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
/** 관리자거나 menus 가 null 이면 전부, 배열이면 그 안의 것만 */
export function menuAllowed(menus, role, view) {
  if (role === 'admin') return true;
  const key = menuOfView(view);
  if (['dashboard', 'settings', 'admin'].includes(key)) return true;
  if (OPT_IN_MENUS.includes(key)) return Array.isArray(menus) && menus.includes(key); // 직접 체크한 코드만
  return !Array.isArray(menus) || menus.includes(key);
}
