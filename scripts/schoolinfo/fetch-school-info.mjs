// 학교알리미 학교정보 팝업(보안문자 없음) → out/school-info.json
//   GET /ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=<uuid> 상단에 설립구분·학교특성(일반고/특성화고…)·학생수(남/여)·교원수·주소가 있다.
//   특성화고처럼 예전 catalog 에 없던 학교의 성별·유형·재적 합계를 여기서 채운다(학년별 재적은 공개용데이터 xlsx 로).
//   node fetch-school-info.mjs [부천시]   # 시군구 이름을 주면 그 지역만
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const BASE = 'https://www.schoolinfo.go.kr';
const DELAY_MS = 500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => (s == null ? null : Number(String(s).replace(/[^\d]/g, '')) || 0);

export function parseInfo(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const pick = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const students = text.match(/학생수\s*:\s*([\d,]+)명\s*\(남\s*([\d,]+)명\s*,\s*여\s*([\d,]+)명\)/);
  const teachers = text.match(/교원수\s*:\s*([\d,]+)명/);
  const male = students ? num(students[2]) : null, female = students ? num(students[3]) : null;
  const gender = students ? (male > 0 && female > 0 ? '남녀공학' : male > 0 ? '남자' : female > 0 ? '여자' : null) : null;
  return {
    fond: pick(/설립구분\s*:\s*(국립|공립|사립)/), schoolType: pick(/학교특성\s*:\s*([가-힣]+고등학교|중학교|[가-힣]+학교)/),
    founded: pick(/설립일자\s*:\s*([\d년월일 ]+)/), address: pick(/주소\s*:\s*(.+?)\s+학생수/),
    students: students ? num(students[1]) : null, male, female, gender, teachers: teachers ? num(teachers[1]) : null,
    homepage: pick(/홈페이지\s*:\s*(\S+)/),
  };
}

async function main() {
  const only = process.argv[2] || null;
  const list = JSON.parse(fs.readFileSync(path.join(here, 'out', 'school-list.json'), 'utf8')).schools.filter((s) => !only || s.sigungu === only || s.sido === only);
  const outFile = path.join(here, 'out', 'school-info.json');
  const info = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  let n = 0;
  for (const s of list) {
    if (info[s.shlIdfCd]) continue;
    try {
      const res = await fetch(`${BASE}/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${s.shlIdfCd}`, { headers: { 'User-Agent': 'Mozilla/5.0 entrance-finder schoolinfo' } });
      // 응답이 euc-kr 이라 text() 로 읽으면 깨진다
      const html = new TextDecoder('euc-kr').decode(await res.arrayBuffer());
      const p = parseInfo(html);
      if (!p.students && !p.schoolType) { console.log(`? ${s.schoolName}: 파싱 실패(${res.status})`); }
      info[s.shlIdfCd] = { ...p, fetchedAt: new Date().toISOString() };
      n++;
      if (n % 25 === 0) { fs.writeFileSync(outFile, JSON.stringify(info), 'utf8'); console.log(`${n}/${list.length} …`); }
    } catch (e) { console.log(`! ${s.schoolName}: ${e.message}`); }
    await sleep(DELAY_MS);
  }
  fs.writeFileSync(outFile, JSON.stringify(info), 'utf8');
  console.log(`학교정보 ${Object.keys(info).length}곳 (이번 ${n}) → ${outFile}`);
}
if (process.argv[1] && /fetch-school-info\.mjs$/.test(process.argv[1])) main().catch((e) => { console.error(e); process.exit(1); });
