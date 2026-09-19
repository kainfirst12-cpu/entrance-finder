// 학교알리미 학교 목록(중·고) 전수 수집 → out/school-list.json
// 인증·보안문자 없이 되는 부분. 학교별 공시 페이지(pneiss_a03_s0)가 쓰는 JSON 엔드포인트를 그대로 부른다.
//   시군구 목록: POST /ei/ss/pneiss_a03_s0_sigungu_json.do  {SIDO_CODE}
//   학교 목록:   POST /ei/ss/pneiss_a03_s0_school_json.do   {HG_JONGRYU_GB, SIDO_CODE, GUGUN_CODE}
// 결과 한 줄 = 학교 하나: SHL_IDF_CD(공시 페이지 UUID — 성취도 수집의 키), SHL_CD(J1000xxxxx), 학교명, 주소, 설립, 학교종류 코드.
//
//   node fetch-school-list.mjs            # 중학교(03)+고등학교(04) 전국
//   node fetch-school-list.mjs 04 4100000000   # 고등학교, 경기도만
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://www.schoolinfo.go.kr';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), 'out');
const DELAY_MS = 400;

// 시도 코드 — 학교알리미 화면의 level2 라디오 값. 2026 기준 16개(전남·광주 통합, 강원·전북 특별자치도).
export const SIDO = {
  '1100000000': '서울특별시', '1200000000': '전남광주통합특별시', '2600000000': '부산광역시', '2700000000': '대구광역시',
  '2800000000': '인천광역시', '3000000000': '대전광역시', '3100000000': '울산광역시', '3611000000': '세종특별자치시',
  '4100000000': '경기도', '4300000000': '충청북도', '4400000000': '충청남도', '4700000000': '경상북도',
  '4800000000': '경상남도', '5000000000': '제주특별자치도', '5100000000': '강원특별자치도', '5200000000': '전북특별자치도',
};
export const LEVEL = { '03': '중학교', '04': '고등학교' };
// FNDN_SC_CD 설립구분 — 학교알리미 학교정보 팝업과 대조(1 국립, 2 공립, 3 사립)
export const FOND = { '1': '국립', '2': '공립', '3': '사립' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function postJson(url, form) {
  const res = await fetch(BASE + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0 entrance-finder schoolinfo' },
    body: new URLSearchParams(form),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

async function main() {
  const [, , onlyLevel, onlySido] = process.argv;
  const levels = onlyLevel ? [onlyLevel] : Object.keys(LEVEL);
  const sidos = onlySido ? [onlySido] : Object.keys(SIDO);
  fs.mkdirSync(OUT, { recursive: true });
  const outFile = path.join(OUT, 'school-list.json');
  const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { schools: [] };
  const byId = new Map(prev.schools.map((s) => [s.shlIdfCd, s]));
  let requests = 0;

  for (const sido of sidos) {
    // 세종은 시군구 단계가 없다(화면 JS: sidoCode 36xx → GUGUN_CODE '')
    let guguns = [{ ADDR_CD_ID: '', ADRCD_ID_LAST_NM: '' }];
    if (!sido.startsWith('36')) {
      guguns = await postJson('/ei/ss/pneiss_a03_s0_sigungu_json.do', { SIDO_CODE: sido });
      requests++; await sleep(DELAY_MS);
      // "고양시" 와 "고양시 덕양구" 가 같이 오면 상위(시)만 쓴다 — 학교 목록은 상위 코드로 다 나온다.
      const codes = new Set(guguns.map((g) => g.ADDR_CD_ID));
      guguns = guguns.filter((g) => !g.ADRCD_ID_LAST_NM.includes(' ') || ![...codes].some((c) => c !== g.ADDR_CD_ID && g.ADDR_CD_ID.startsWith(c.slice(0, 4))));
    }
    for (const level of levels) {
      let n = 0;
      for (const g of guguns) {
        const list = await postJson('/ei/ss/pneiss_a03_s0_school_json.do', { HG_JONGRYU_GB: level, SIDO_CODE: sido, GUGUN_CODE: g.ADDR_CD_ID });
        requests++; await sleep(DELAY_MS);
        for (const s of list) {
          byId.set(s.SHL_IDF_CD, {
            shlIdfCd: s.SHL_IDF_CD, shlCd: s.SHL_CD, schoolName: s.SHL_NM, schoolLevel: LEVEL[level],
            sido: SIDO[sido], sigungu: g.ADRCD_ID_LAST_NM || SIDO[sido], sigunguCode: g.ADDR_CD_ID || sido,
            fond: FOND[s.FNDN_SC_CD] ?? null, hshKndScCd: s.HSH_KND_SC_CD ?? null, // 고교 종류 코드(일반/특성화/특목/자율)는 성취도 페이지의 학교정보로 보정
            address: s.SHL_ROAD_NM_ADDR || s.ADDR_CN || null, homepage: s.HMPG_ADDR || null, tel: s.USER_TELNO || null,
          });
          n++;
        }
      }
      console.log(`${SIDO[sido]} ${LEVEL[level]} ${n}곳`);
    }
    fs.writeFileSync(outFile, JSON.stringify({ fetchedAt: new Date().toISOString(), schools: [...byId.values()] }, null, 1), 'utf8');
  }
  console.log(`총 ${byId.size}곳 · 요청 ${requests}건 → ${outFile}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
