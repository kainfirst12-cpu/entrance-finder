// 학교 목록 파일(/data/school-catalog.json.gz) 읽기 — 공시정보 화면(SchoolInfo)과 전체 자료함(AdminLibrary)이 함께 쓴다.

export const CATALOG_URL = '/data/school-catalog.json.gz';

export async function fetchGzJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Vercel 은 .gz 를 그대로 내려준다(Content-Encoding 없음) → 브라우저 내장 DecompressionStream 으로 푼다.
  // 이미 풀린 JSON 이 오는 환경(로컬 dev 서버 등)도 있어 gzip 매직바이트로 구분한다.
  let text;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    text = await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
  } else {
    text = new TextDecoder().decode(buf);
  }
  return JSON.parse(text);
}

const SIDO_SHORT = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전',
  울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원특별자치도: '강원', 강원도: '강원',
  충청북도: '충북', 충청남도: '충남', 전북특별자치도: '전북', 전라북도: '전북', 전라남도: '전남', 전남광주통합특별시: '전남광주',
  경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주',
};
// '경기 안산시' 처럼 짧게. 세종처럼 시군구가 없으면 시도만.
export const regionLabel = (s) => [SIDO_SHORT[s.sido] || s.sido || '', s.sigungu || ''].filter(Boolean).join(' ');

// 학교 id → 지역, 학교 이름 → 지역(이름이 전국에 하나뿐일 때만) — 한 번 읽으면 페이지 안에서 재사용
let regionIndexP = null;
export function loadRegionIndex() {
  if (!regionIndexP) {
    regionIndexP = fetchGzJson(CATALOG_URL).then((cat) => {
      const byId = new Map(); const byName = new Map();
      for (const s of cat.schools || []) {
        const r = regionLabel(s);
        if (!r) continue;
        byId.set(String(s.id), r);
        byName.set(s.schoolName, byName.has(s.schoolName) && byName.get(s.schoolName) !== r ? null : r);
      }
      return { byId, byName };
    }).catch((e) => { regionIndexP = null; throw e; });
  }
  return regionIndexP;
}
