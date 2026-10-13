// 학교 위치(위도·경도) — 공공데이터포털 「전국초중등학교위치표준데이터」(한국교육시설안전원, 이용 제한 없음)
//   원본 받기: data.go.kr/data/15021148/standard.do 의 다운로드가 부르는 JSON 을 그대로 받는다(10,000줄씩).
//     Q='colNmList=SCHOOL_ID&colNmList=SCHOOL_NM&colNmList=SCHOOL_SE&colNmList=OPER_STTUS&colNmList=RDNMADR&colNmList=LNMADR&colNmList=LATITUDE&colNmList=LONGITUDE&colNmList=REFERENCE_DATE&totalCount=12004&svcTableNm=tn_pubr_public_elesch_mskul_lc_svc&perPage=10000'
//     curl "https://www.data.go.kr/download/standard.json?publicDataPk=15021148&$Q&page=1" -o out/location/page1.json   (page=2 도. page=0 은 빈 배열)
//   node build-locations.mjs → frontend/public/data/school-locations.json.gz  { [shlIdfCd]: [위도, 경도] }
//   ⚠ 학교ID 체계가 학교알리미 코드와 달라 학교급+학교명(+시도·도로명 주소)으로 맞춘다. 폐교·분교·이름 바뀐 곳 일부는 빠진다.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dir = path.join(here, 'out', 'location');
const rows = fs.readdirSync(dir).filter((f) => /^page\d+\.json$/.test(f)).flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
  .filter((r) => r.SCHOOL_SE !== '초등학교' && r.OPER_STTUS === '운영' && Number(r.LATITUDE) && Number(r.LONGITUDE));
const list = JSON.parse(fs.readFileSync(path.join(here, 'out', 'school-list.json'), 'utf8')).schools;

const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/\(.*?\)/g, '');
const addr = (s) => String(s || '').replace(/\s+/g, '').replace(/\(.*$/, '');
const byName = new Map(), byAddr = new Map();
for (const r of rows) {
  const k = `${r.SCHOOL_SE}|${norm(r.SCHOOL_NM)}`;
  byName.set(k, [...(byName.get(k) || []), r]);
  if (r.RDNMADR) byAddr.set(`${r.SCHOOL_SE}|${addr(r.RDNMADR)}`, r);
}
const out = {};
let byN = 0, byA = 0;
const miss = [];
for (const s of list) {
  const c = byName.get(`${s.schoolLevel}|${norm(s.schoolName)}`) || [];
  // 같은 이름이 여러 시도에 있으면 시도(주소 앞머리)로 가른다
  let r = c.length === 1 ? c[0] : c.find((x) => addr(x.RDNMADR) === addr(s.address)) || c.find((x) => String(x.RDNMADR || '').startsWith(s.sido) && String(x.RDNMADR || '').includes(s.sigungu));
  if (r) byN++;
  else if ((r = byAddr.get(`${s.schoolLevel}|${addr(s.address)}`))) byA++;
  if (!r) { miss.push(`${s.sido} ${s.schoolName}`); continue; }
  out[s.shlIdfCd] = [Math.round(Number(r.LATITUDE) * 1e5) / 1e5, Math.round(Number(r.LONGITUDE) * 1e5) / 1e5];
}
const ref = rows.map((r) => r.REFERENCE_DATE).sort().pop();
const file = path.resolve(here, '..', '..', 'frontend', 'public', 'data', 'school-locations.json.gz');
fs.writeFileSync(file, zlib.gzipSync(JSON.stringify({ source: '공공데이터포털 전국초중등학교위치표준데이터(한국교육시설안전원)', referenceDate: ref, schools: out }), { level: 9 }));
console.log(`위치 ${Object.keys(out).length}/${list.length}곳 (이름 ${byN} · 주소 ${byA}) · 못 맞춘 곳 ${miss.length} → ${file} (${(fs.statSync(file).size / 1024).toFixed(0)}KB)`);
if (miss.length) console.log('예:', miss.slice(0, 12).join(', '));
