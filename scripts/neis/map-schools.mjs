// 학교알리미 catalog 고등학교 ↔ 나이스 학교 코드(ATPT_OFCDC_SC_CODE + SD_SCHUL_CODE) 짝짓기
//   node scripts/neis/map-schools.mjs  → scripts/neis/out/neis-map.json
// 인증키: 환경변수 NEIS_KEY 또는 ~/.neis/key.txt (저장소에 넣지 않는다)
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KEY = process.env.NEIS_KEY || fs.readFileSync(path.join(os.homedir(), '.neis', 'key.txt'), 'utf8').trim();
const OUT = path.join(root, 'scripts/neis/out'); fs.mkdirSync(OUT, { recursive: true });
const OFFICES = ['B10', 'C10', 'D10', 'E10', 'F10', 'G10', 'H10', 'I10', 'J10', 'K10', 'M10', 'N10', 'P10', 'Q10', 'R10', 'S10', 'T10'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* 재시도 */ }
    await sleep(1500 * (i + 1));
  }
  throw new Error(`실패: ${url.replace(KEY, '***')}`);
}
const neis = [];
for (const o of OFFICES) {
  for (let p = 1; p < 20; p++) {
    const j = await get(`https://open.neis.go.kr/hub/schoolInfo?KEY=${KEY}&Type=json&pIndex=${p}&pSize=1000&ATPT_OFCDC_SC_CODE=${o}&SCHUL_KND_SC_NM=${encodeURIComponent('고등학교')}`);
    const rows = j.schoolInfo?.[1]?.row || [];
    neis.push(...rows);
    if (rows.length < 1000) break;
    await sleep(150);
  }
  process.stdout.write(`${o} `);
}
console.log(`\n나이스 고등학교 ${neis.length}곳`);
const norm = (s) => String(s || '').replace(/\s+/g, '');
const cat = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'frontend/public/data/school-catalog.json.gz'))));
const highs = cat.schools.filter((s) => s.schoolLevel === '고등학교');
const byName = new Map();
for (const n of neis) { const k = norm(n.SCHUL_NM); (byName.get(k) || byName.set(k, []).get(k)).push(n); }
const map = {}; let miss = 0, amb = 0;
for (const s of highs) {
  let c = (byName.get(norm(s.schoolName)) || []).filter((n) => n.LCTN_SC_NM === s.sido || (n.ORG_RDNMA || '').startsWith(s.sido));
  if (c.length > 1 && s.sigungu) c = c.filter((n) => (n.ORG_RDNMA || '').includes(s.sigungu)) .concat([]);
  if (c.length === 1) map[s.id] = { atpt: c[0].ATPT_OFCDC_SC_CODE, code: c[0].SD_SCHUL_CODE, name: c[0].SCHUL_NM };
  else if (!c.length) miss++; else amb++;
}
fs.writeFileSync(path.join(OUT, 'neis-map.json'), JSON.stringify(map));
console.log(`짝지음 ${Object.keys(map).length} / ${highs.length} (못 찾음 ${miss}, 여러 곳 ${amb})`);
