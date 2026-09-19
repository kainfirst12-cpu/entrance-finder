// 브라우저에서 받은 수집 결과를 out/achievement-raw/ 로 넣는다.
//   node ingest-export.mjs <파일…> [--dry]
// 받아들이는 모양(무엇을 붙여넣든 알아서 푼다):
//   • SI.download() 로 받은 파일          { exportedAt, count, records:[ … ] }
//   • SI.all() / SI._state.done 붙여넣기   [ {id,name,grades…}, … ]  (JSON 문자열로 한 번 더 감싸져 있어도 됨)
//   • 실패분                               { failed:[ {id,name,reason} ] } 또는 { done:[…], failed:[…] }
// 하는 일: 레코드 검증 → out/achievement-raw/<id>.json, failed → out/achievement-skipped.json 에 추가(id 중복 제거).
// 표가 아니라 로딩 중 화면을 잡은 레코드(행 없음)는 넣지 않고 따로 알려 준다 — 그 학교는 다시 돌려야 한다.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const RAW = path.join(here, 'out', 'achievement-raw');
const SKIPPED = path.join(here, 'out', 'achievement-skipped.json');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('사용: node ingest-export.mjs <파일…> [--dry]'); process.exit(1); }

const unwrap = (v, depth = 0) => {
  if (typeof v === 'string' && depth < 4) { try { return unwrap(JSON.parse(v), depth + 1); } catch { return v; } }
  return v;
};

function pull(raw) {
  let v = unwrap(raw);
  // javascript_tool 결과 파일: [{type:'text', text:'<JSON>'}]
  if (Array.isArray(v) && v.length && v[0] && typeof v[0].text === 'string') v = unwrap(v[0].text.replace(/\n\n\(captured[\s\S]*$/, ''));
  const records = Array.isArray(v) ? v : (v.records || v.done || []);
  const failed = Array.isArray(v) ? [] : (v.failed || []);
  return { records: records.map((r) => unwrap(r)).filter(Boolean), failed: failed.filter(Boolean) };
}

const rowCount = (rec) => Object.values(rec.grades || {}).reduce((n, g) => n + (g?.rows?.length || 0), 0);

fs.mkdirSync(RAW, { recursive: true });
const saved = [], updated = [], bad = [], newSkips = [];
for (const file of files) {
  const { records, failed } = pull(fs.readFileSync(file, 'utf8'));
  for (const rec of records) {
    if (!rec?.id || !rec?.name) { bad.push({ name: rec?.name || '(이름 없음)', why: 'id/name 없음' }); continue; }
    // 표 머리글 한 줄만 잡힌 것(=보안문자 통과 전 화면)도 거른다
    if (rowCount(rec) < 2) { bad.push({ name: rec.name, why: `표 행 ${rowCount(rec)}줄 — 다시 수집 필요` }); continue; }
    const dest = path.join(RAW, `${rec.id}.json`);
    (fs.existsSync(dest) ? updated : saved).push(rec.name);
    if (!DRY) fs.writeFileSync(dest, JSON.stringify(rec), 'utf8');
  }
  for (const f of failed) if (f.id) newSkips.push({ name: f.name, id: f.id, reason: f.reason || '공시제외' });
}

if (newSkips.length) {
  const cur = fs.existsSync(SKIPPED) ? JSON.parse(fs.readFileSync(SKIPPED, 'utf8')) : { schools: [] };
  const have = new Set(cur.schools.map((s) => s.id));
  const add = newSkips.filter((s) => !have.has(s.id) && (have.add(s.id), true));
  cur.schools.push(...add);
  cur.updatedAt = new Date().toISOString();
  if (!DRY) fs.writeFileSync(SKIPPED, JSON.stringify(cur, null, 1), 'utf8');
  console.log(`공시제외 ${add.length}곳 추가 → out/achievement-skipped.json (총 ${cur.schools.length})`);
}

console.log(`${DRY ? '[미리보기] ' : ''}새로 저장 ${saved.length}곳 · 덮어씀 ${updated.length}곳 · 거름 ${bad.length}곳 · raw 총 ${fs.readdirSync(RAW).filter((f) => f.endsWith('.json')).length}곳`);
if (saved.length) console.log('  저장:', saved.join(', '));
for (const b of bad) console.log(`  거름: ${b.name} — ${b.why}`);
