// out/public-items.json (fetch-public-items.mjs) → frontend/public/data/school-extra.json.gz
//   학교마다(키 = 학교알리미 SHL_IDF_CD, catalog 의 shlIdfCd) 졸업생 진로 3개년 · 학교 현황 · 전출입 · 기간제 비율 · 동아리.
//   지역 평균(시군구·시도·전국)은 학교마다 반복되므로 areas 표로 따로 모은다.
//   node build-extra.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const src = JSON.parse(fs.readFileSync(path.join(here, 'out', 'public-items.json'), 'utf8'));
const list = JSON.parse(fs.readFileSync(path.join(here, 'out', 'school-list.json'), 'utf8')).schools;
const bySid = new Map(list.map((s) => [s.shlIdfCd, s]));

const pct = (a, b) => (a == null || !b ? null : Math.round((a / b) * 1000) / 10);
const areas = {}; // `${level}|${area}` → { perClass:[1,2,3], perTeacher, inRate, outRate, dropoutRate }
const schools = {};
let nCareer = 0;
for (const [sid, r] of Object.entries(src).sort(([a], [b]) => (a < b ? -1 : 1))) { // 키 순서를 고정해 같은 내용 = 같은 파일
  const s = bySid.get(sid);
  const level = r.level || s?.schoolLevel;
  const high = level === '고등학교';
  const o = {};
  // 졸업생 진로 — 최근 공시부터. 고교: 4년제·전문대·국외·취업·기타(재수·미상 등), 중학교: 진학 고교 유형
  const career = (r.career || []).filter((c) => c.grad > 0).sort((x, y) => String(y.shown).localeCompare(String(x.shown)));
  if (career.length) {
    nCareer++;
    o.career = career.map((c) => high
      ? { y: c.shown, grad: c.grad, univ: pct(c.univ, c.grad), college: pct(c.college, c.grad), abroad: pct(c.abroad, c.grad), job: pct(c.job, c.grad), etc: pct(c.etc, c.grad), ...(c.voc ? { voc: true, jobRate: c.jobRate } : {}) }
      : {
        y: c.shown, grad: c.grad, general: pct(c.general, c.grad), vocational: pct(c.vocational, c.grad),
        science: pct(c.science, c.grad), foreign: pct(c.foreign, c.grad), arts: pct(c.arts, c.grad), meister: pct(c.meister, c.grad),
        jasa: pct(c.jasa, c.grad), jagong: pct(c.jagong, c.grad), other: pct(c.other, c.grad), none: pct((c.job || 0) + (c.alt || 0) + (c.unknown || 0), c.grad),
      });
  }
  const st = r.status;
  if (st && (st.perClass != null || st.perTeacher != null)) o.status = { perClass: st.perClass, perClassGrade: st.perClassGrade, perTeacher: st.perTeacher, classes: st.classes, students: st.students, teachers: st.teachers, classTeachers: st.classTeachers };
  const mv = r.moves;
  if (mv && mv.base) o.moves = { y: mv.year, in: mv.in, out: mv.out, dropout: mv.dropout, base: mv.base, inRate: pct(mv.in, mv.base), outRate: pct(mv.out, mv.base), dropoutRate: mv.dropoutRate };
  if (r.staff?.total) o.staff = { total: r.staff.total, temp: r.staff.temp, lecturer: r.staff.lecturer, tempRatio: r.staff.tempRatio };
  if (r.clubs && r.clubs.clubs != null) o.clubs = { y: r.clubs.year, clubs: r.clubs.clubs, members: r.clubs.members, self: r.clubs.selfClubs, selfMembers: r.clubs.selfMembers };
  // 지역 평균 — 첫 줄 = 학교 소재 시군구, 둘째 = 시도, 셋째 = 전국
  const area = [];
  (st?.avg || []).forEach((a, i) => {
    const k = `${level}|${a.area}`;
    areas[k] = { ...(areas[k] || {}), perClass: a.perClass, perTeacher: a.perTeacher };
    area[i] = a.area;
  });
  (mv?.avg || []).forEach((a, i) => {
    const k = `${level}|${a.area}`;
    areas[k] = { ...(areas[k] || {}), inRate: a.inRate, outRate: a.outRate, dropoutRate: a.dropoutRate };
    if (!area[i]) area[i] = a.area;
  });
  if (area.length) o.area = area;
  if (Object.keys(o).length) schools[sid] = o;
}

// generatedAt 은 넣지 않는다 — 내용이 같으면 파일이 같아야 정기 갱신(CI)이 '바뀐 게 없다'고 판정한다
const out = { source: '학교알리미 학교별 공시(졸업생 진로 13-다·13-라 · 학교 현황 3-가-1 · 전출입 3-나 · 직위별 교원 6-가 · 동아리 15-나)', areas, schools };
const file = path.resolve(here, '..', '..', 'frontend', 'public', 'data', 'school-extra.json.gz');
fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(out), { level: 9 }));
console.log(`학교 ${Object.keys(schools).length}곳(진로 ${nCareer}곳) · 지역 평균 ${Object.keys(areas).length}개 → ${file} (${(fs.statSync(file).size / 1024).toFixed(0)}KB)`);
