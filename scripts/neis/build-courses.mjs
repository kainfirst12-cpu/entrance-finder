// 시간표로 모은 학교별 과목 → 화면용 파일
//   node scripts/neis/build-courses.mjs → frontend/public/data/school-courses-2026.json.gz
// { year, weeks, schools: { [catalogId]: { g2: [과목…], g3: [과목…], n: 시간표 줄 수 } } }
// 과목명은 시간표 표기 그대로(앞의 '[보강]' 등만 뗌). 특성화고 NCS 능력단위(* 로 시작)는 뺀다 — 과목 비교에 쓰지 않는다.
import fs from 'node:fs'; import path from 'node:path'; import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(root, 'scripts/neis/out/tt');
const schools = {};
let n = 0;
for (const f of fs.readdirSync(DIR)) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const pick = (g) => [...new Set([...Object.keys(j[g][1] || {}), ...Object.keys(j[g][2] || {})])].filter((t) => !t.startsWith('*') && t.length <= 40).sort((a, b) => a.localeCompare(b, 'ko'));
  if (!j.rows) continue;
  schools[j.id] = { g2: pick('g2'), g3: pick('g3'), n: j.rows };
  n++;
}
const out = { year: 2026, source: '나이스 교육정보 개방 포털 고등학교시간표(hisTimetable)', weeks: '1학기 4/6~10·6/8~12, 2학기 9/7~11·9/14~18', builtAt: new Date().toISOString(), schools };
const file = path.join(root, 'frontend/public/data/school-courses-2026.json.gz');
fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(out)));
console.log(`school-courses-2026.json.gz — ${n}곳, ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
