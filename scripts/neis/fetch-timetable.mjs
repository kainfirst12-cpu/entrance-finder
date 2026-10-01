// 학교별 2026 2·3학년 실제 수업 과목(나이스 고등학교시간표 hisTimetable) 모으기 — 이어받기 지원
//   node scripts/neis/fetch-timetable.mjs [--only 경기도]  → scripts/neis/out/tt/<schoolId>.json
// 학기마다 휴일 없는 주 2개씩. 과목명만 모으고(반·교시는 버림) 창체·휴업·행사 줄은 뺀다.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const KEY = process.env.NEIS_KEY || fs.readFileSync(path.join(os.homedir(), '.neis', 'key.txt'), 'utf8').trim();
const OUT = path.join(root, 'scripts/neis/out/tt'); fs.mkdirSync(OUT, { recursive: true });
const map = JSON.parse(fs.readFileSync(path.join(root, 'scripts/neis/out/neis-map.json'), 'utf8'));
const cat = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root, 'frontend/public/data/school-catalog.json.gz'))));
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const schools = cat.schools.filter((s) => map[s.id] && (!only || s.sido === only || s.sigungu === only));
const WEEKS = [
  { sem: 1, from: '20260406', to: '20260410' }, { sem: 1, from: '20260608', to: '20260612' },
  { sem: 2, from: '20260907', to: '20260911' }, { sem: 2, from: '20260914', to: '20260918' },
];
const SKIP = /^(자율|자치|동아리|진로활동|봉사|창의적|창체)|휴업|방학|공휴일|추석|설날|연휴|개교기념|재량|시험|고사|평가|체험학습|수련|축제|행사|졸업|입학|대체|현장|학예|체육대회|원격|토요|기타/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 5; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch { /* 재시도 */ }
    await sleep(2000 * (i + 1));
  }
  return null;
}
let done = 0, skipped = 0, failed = 0;
async function one(s) {
  const file = path.join(OUT, `${String(s.id).replace(/[:\/*?"<>|]/g, '_')}.json`); // 일부 id 에 ':' (윈도 파일명 불가)
  if (fs.existsSync(file)) { skipped++; return; }
  const m = map[s.id]; const res = { id: s.id, neis: m, g2: { 1: {}, 2: {} }, g3: { 1: {}, 2: {} }, rows: 0 };
  for (const g of [2, 3]) for (const w of WEEKS) {
    let p = 1;
    while (p < 5) {
      const j = await get(`https://open.neis.go.kr/hub/hisTimetable?KEY=${KEY}&Type=json&pIndex=${p}&pSize=1000&ATPT_OFCDC_SC_CODE=${m.atpt}&SD_SCHUL_CODE=${m.code}&AY=2026&SEM=${w.sem}&GRADE=${g}&TI_FROM_YMD=${w.from}&TI_TO_YMD=${w.to}`);
      if (!j) { failed++; return; }
      const rows = j.hisTimetable?.[1]?.row || [];
      for (const r of rows) {
        const t = String(r.ITRT_CNTNT || '').replace(/^\[[^\]]*\]\s*/, '').trim();
        if (!t || SKIP.test(t)) continue;
        const bag = res[`g${g}`][w.sem]; bag[t] = (bag[t] || 0) + 1;
      }
      res.rows += rows.length;
      if (rows.length < 1000) break;
      p++;
    }
  }
  fs.writeFileSync(file, JSON.stringify(res));
  done++;
}
const queue = [...schools]; const CONC = 4;
const t0 = Date.now();
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) { await one(queue.shift()); await sleep(120); if ((done + skipped) % 100 === 0) console.log(`${done + skipped}/${schools.length} (새로 ${done}, 실패 ${failed}) ${((Date.now() - t0) / 60000).toFixed(1)}분`); } }));
console.log(`끝 — 새로 ${done}, 이미 ${skipped}, 실패 ${failed} / ${schools.length}`);
