// 수집 묶음(export) → 학교당 원본 파일
//   node scripts/schoolinfo/ingest-export.mjs <묶음 폴더 또는 파일…> --to achievement-raw-20263
// 묶음 = { exportedAt, chasu, count, records:[{id,name,capturedAt,chasu,grades}], failed:[] } (다른 PC·세션 수집분)
// '공시없음' 묶음({ schools:[{id,name,reason}] })은 out/achievement-skipped-<차수>.json 으로 모은다.
// 차수마다 폴더를 따로 둔다 — 3차(2026학년도 1학기)가 1차(2025학년도 1·2학기)를 대체하지 않기 때문(둘 다 build-catalog 가 합친다).
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const args = process.argv.slice(2);
const toIdx = args.indexOf('--to');
const to = toIdx >= 0 ? args.splice(toIdx, 2)[1] : 'achievement-raw';
const dest = path.join(here, 'out', to);
fs.mkdirSync(dest, { recursive: true });
const safe = (id) => String(id).replace(/[:\\/*?"<>|]/g, '_'); // 일부 id 에 ':' (윈도 파일명 불가)

const files = args.flatMap((a) => (fs.statSync(a).isDirectory() ? fs.readdirSync(a).filter((f) => f.endsWith('.json')).map((f) => path.join(a, f)) : [a]));
let wrote = 0, skippedNoData = 0;
const noData = [];
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (Array.isArray(j.schools) && !j.records) { noData.push(...j.schools); continue; }
  for (const r of j.records || []) {
    const hasNum = Object.values(r.grades || {}).some((g) => (g.rows || []).slice(1).some((row) => row.some((c) => /\d/.test(String(c || '')))));
    if (!hasNum) { skippedNoData++; continue; }
    fs.writeFileSync(path.join(dest, `${safe(r.id)}.json`), JSON.stringify({ id: r.id, name: r.name, capturedAt: r.capturedAt, chasu: r.chasu || j.chasu, grades: r.grades }));
    wrote++;
  }
}
if (noData.length) fs.writeFileSync(path.join(here, 'out', `achievement-skipped-${to.replace(/^achievement-raw-?/, '') || 'base'}.json`), JSON.stringify(noData, null, 1));
console.log(`${files.length}개 묶음 → out/${to}/ ${wrote}곳 (숫자 없는 레코드 ${skippedNoData}, 공시없음 ${noData.length})`);
