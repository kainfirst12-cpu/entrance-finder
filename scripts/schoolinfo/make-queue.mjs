// 남은 수집 큐 만들기 — out/school-list.json − out/achievement-raw/ − out/achievement-skipped.json
//   node make-queue.mjs [--sido 경기도] [--level 고등학교] [--sigungu 김포시] [--chunk 130] [--year 2026]
// 내보내는 것:
//   out/queue-<지역>.json        큐 전체 [{id, name, sigungu}] — SI.start(...) 에 그대로 넣는 모양
//   out/collect-<지역>-<n>.js    붙여넣기 한 방 파일 = captcha-runner.js + SI.start(<그 덩이>, <year>)
//     크롬에서 아무 학교 공시 팝업(Pneiss_b01_s0.do?SHL_IDF_CD=…)을 열고 콘솔에 파일 내용을 붙여넣으면 바로 시작한다.
//     덩이로 나누는 이유는 콘솔 붙여넣기 한도와 localStorage 용량(학교당 1~2KB) 때문. 한 덩이 끝나면 다음 파일.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = path.join(here, 'out');
const args = process.argv.slice(2);
const opt = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

const SIDO = opt('--sido', '경기도');
const LEVEL = opt('--level', '고등학교');
const SIGUNGU = opt('--sigungu');
const CHUNK = Number(opt('--chunk', '130'));
const YEAR = Number(opt('--year', String(new Date().getFullYear())));

const { schools } = JSON.parse(fs.readFileSync(path.join(OUT, 'school-list.json'), 'utf8'));
const doneIds = new Set(fs.existsSync(path.join(OUT, 'achievement-raw'))
  ? fs.readdirSync(path.join(OUT, 'achievement-raw')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''))
  : []);
const skippedFile = path.join(OUT, 'achievement-skipped.json');
const skippedIds = new Set(fs.existsSync(skippedFile) ? JSON.parse(fs.readFileSync(skippedFile, 'utf8')).schools.map((s) => s.id) : []);

const target = schools.filter((s) => s.sido === SIDO && s.schoolLevel === LEVEL && (!SIGUNGU || s.sigungu === SIGUNGU));
const left = target
  .filter((s) => !doneIds.has(s.shlIdfCd) && !skippedIds.has(s.shlIdfCd))
  .sort((a, b) => (a.sigungu || '').localeCompare(b.sigungu || '', 'ko') || a.schoolName.localeCompare(b.schoolName, 'ko'))
  .map((s) => ({ id: s.shlIdfCd, name: s.schoolName, sigungu: s.sigungu }));

const slug = [SIDO, SIGUNGU, LEVEL].filter(Boolean).join('-');
fs.writeFileSync(path.join(OUT, `queue-${slug}.json`), JSON.stringify(left, null, 1), 'utf8');

const runner = fs.readFileSync(path.join(here, 'captcha-runner.js'), 'utf8');
const files = [];
for (let i = 0, n = 1; i < left.length; i += CHUNK, n += 1) {
  const part = left.slice(i, i + CHUNK).map(({ id, name }) => ({ id, name }));
  const file = `collect-${slug}-${n}.js`;
  fs.writeFileSync(path.join(OUT, file),
    `// ${slug} ${i + 1}~${i + part.length}번째 (${part[0].name} … ${part[part.length - 1].name})\n`
    + `// 1) 이 주소를 크롬에서 연다: https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${part[0].id}\n`
    + `// 2) F12 콘솔에 이 파일 전체를 붙여넣으면 첫 학교 보안문자 칸이 뜬다 — 숫자 치고 Enter 를 ${part.length}번 반복.\n`
    + `// 3) 끝나면 콘솔에서 SI.download() → 내려받은 JSON 을 node ingest-export.mjs <파일> 로 넣는다.\n`
    + `${runner}\nSI.start(${JSON.stringify(part)}, ${YEAR});\n`, 'utf8');
  files.push({ file, count: part.length, from: part[0].name, to: part[part.length - 1].name });
}

console.log(`${SIDO} ${SIGUNGU || ''} ${LEVEL} ${target.length}곳 · 수집됨 ${target.filter((s) => doneIds.has(s.shlIdfCd)).length} · 공시제외 ${target.filter((s) => skippedIds.has(s.shlIdfCd)).length} · 남음 ${left.length}`);
console.log(`→ out/queue-${slug}.json`);
for (const f of files) console.log(`→ out/${f.file}  ${f.count}곳  ${f.from} … ${f.to}`);
