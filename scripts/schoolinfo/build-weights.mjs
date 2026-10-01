// 성적의 무게 — 학교별 1학년 핵심 과목 A 비율의 '전국 위치'(일반고 기준 백분위)를 미리 계산해 둔다.
//   node scripts/schoolinfo/build-weights.mjs   → frontend/public/data/school-weights.json.gz
// 입력은 이미 배포되는 catalog·school-bands 파일이라, build-catalog 다음에 한 번 돌리면 된다(새 공시 반영 때 같이).
//
// 전국 위치 = 비교 집단(일반고 + 자율형 공립고) 가운데 A 비율이 이 학교 '이하'인 학교의 비율(0~100).
//   낮을수록 A 가 드물다 → 같은 A 라도 무겁게 읽히고, 받기는 어렵다. 높을수록 A 는 쉽지만 변별력이 약하다.
// 특목·자사고·특성화고도 같은 일반고 척도로 위치를 매긴다(학생 집단이 달라 같은 줄에서 비교하지는 않는다 — 화면에서 층을 나눈다).
// 과목 고르기는 설명회 분석과 같은 규칙(frontend/src/seminar/analysis.js subjectTable, 1·2학기 평균, 학교마다 최신 학년도).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { subjectTable } from '../../frontend/src/seminar/analysis.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(root, 'frontend/public/data');
const gz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DATA, f))));

const cat = gz('school-catalog.json.gz');
const highs = cat.schools.filter((s) => s.schoolLevel === '고등학교');
const bandFiles = {};
for (const f of [...new Set(highs.map((s) => s.bandsFile).filter(Boolean))]) bandFiles[f] = gz(f);

const KEYS = ['국어', '수학', '영어', '통합사회', '통합과학'];
const isRef = (s) => s.schoolType === '일반고등학교' || (s.schoolType === '자율고등학교' && s.fond === '공립');

const rows = {};
for (const s of highs) {
  const bands = (s.bandsFile && bandFiles[s.bandsFile]?.[s.id]) || s.bands || [];
  const t = subjectTable(bands, { semester: 'avg' });
  const r = {};
  for (const k of KEYS) { const m = t.rows[k]; if (m) r[k] = { a: m.a, mean: m.mean, top: m.top, low: m.low }; }
  if (Object.keys(r).length) rows[s.id] = { year: t.year, ...r };
}
// 과목별 기준 분포(일반고 + 자율형 공립고) → 백분위
const ref = {};
for (const k of KEYS) ref[k] = highs.filter(isRef).map((s) => rows[s.id]?.[k]?.a).filter((v) => typeof v === 'number').sort((x, y) => x - y);
const rankPct = (arr, v) => {
  let lo = 0, hi = arr.length; // v 이하 개수(upper bound)
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] <= v) lo = mid + 1; else hi = mid; }
  return arr.length ? Math.round((lo / arr.length) * 100) : null;
};
for (const id of Object.keys(rows)) for (const k of KEYS) if (rows[id][k]) rows[id][k].pct = rankPct(ref[k], rows[id][k].a);

const out = {
  generatedAt: new Date().toISOString(),
  basis: '1학년 핵심 과목 · 학교별 최신 공시 학년도 · 1·2학기 평균 A 비율',
  refGroup: '일반고 + 자율형 공립고',
  refCount: Object.fromEntries(KEYS.map((k) => [k, ref[k].length])),
  subjects: KEYS,
  schools: rows,
};
const file = path.join(DATA, 'school-weights.json.gz');
fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(out)));
console.log(`school-weights.json.gz — ${Object.keys(rows).length}곳, 기준 집단 ${JSON.stringify(out.refCount)}, ${(fs.statSync(file).size / 1024).toFixed(0)}KB`);
