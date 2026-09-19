// 정기 갱신(schoolinfo-refresh.yml)에서 "실제로 바뀐 게 있는지" 판정 — fetchedAt 같은 시각만 바뀐 건 변경으로 안 친다.
//   node ci-changed.mjs   → 바뀐 게 있으면 exit 0 + 요약 출력, 없으면 exit 1
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const rel = (f) => path.relative(execSync('git rev-parse --show-toplevel').toString().trim(), path.join(here, 'out', f)).replace(/\\/g, '/');
const head = (f) => { try { return JSON.parse(execSync(`git show HEAD:${rel(f)}`, { maxBuffer: 1 << 28 }).toString()); } catch { return null; } };
const now = (f) => JSON.parse(fs.readFileSync(path.join(here, 'out', f), 'utf8'));

// 학교 목록: 학교 집합·이름·주소·설립
const key = (s) => JSON.stringify([s.shlIdfCd, s.schoolName, s.schoolLevel, s.sido, s.sigungu, s.fond, s.address]);
const la = new Set((head('school-list.json')?.schools || []).map(key)), lb = new Set(now('school-list.json').schools.map(key));
const listAdded = [...lb].filter((k) => !la.has(k)).length, listRemoved = [...la].filter((k) => !lb.has(k)).length;

// 학교정보: fetchedAt 뺀 나머지
const strip = (o) => { const { fetchedAt, ...r } = o || {}; return JSON.stringify(r); };
const ia = head('school-info.json') || {}, ib = now('school-info.json');
let infoChanged = 0;
for (const id of new Set([...Object.keys(ia), ...Object.keys(ib)])) if (strip(ia[id]) !== strip(ib[id])) infoChanged++;

const summary = `학교 목록 +${listAdded}/-${listRemoved} · 학교정보 변경 ${infoChanged}곳`;
console.log(summary);
if (listAdded + listRemoved + infoChanged === 0) process.exit(1);
fs.writeFileSync(path.join(here, 'out', 'ci-summary.txt'), summary, 'utf8');
