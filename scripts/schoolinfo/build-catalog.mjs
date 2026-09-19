// catalog 조립 — frontend/public/data/school-catalog.json.gz 를 만든다.
//   기존 catalog(2024학년도 성취도·재적·EDSS, bucheon-schoolinfo 유래) 를 바탕으로
//   ① out/achievement-raw/ (captcha-runner 로 받은 교과별 학업성취) 를 파싱해 해당 학교의 bands 를 최신 학년도로 교체
//   ② out/school-list.json (fetch-school-list) 에만 있고 catalog 에 없는 학교(특성화고 등)는 새 항목으로 추가(재적·EDSS 없음)
//   ③ (선택) 학교알리미 공개용데이터 '학년별·학급별 학생수' xlsx 가 있으면 재적을 그 파일로 갱신
//
//   node build-catalog.mjs [--enrollment <xlsx>] [--out <경로>]
//   의존: xlsx 는 --enrollment 를 줄 때만 필요(npm i xlsx)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { loadAll } from './parse-achievement.mjs';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const ROOT = path.resolve(here, '..', '..');
const CATALOG = path.join(ROOT, 'frontend', 'public', 'data', 'school-catalog.json.gz');
// 바탕은 항상 원본(bucheon-schoolinfo 2024학년도) 이다 — 출력물을 다시 바탕으로 쓰면 잘못 붙은 값이 굳는다
const BASE = path.join(here, 'out', 'base-catalog-2024.json.gz');
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const OUT = opt('--out') || CATALOG;
const ENROLL = opt('--enrollment');

const TYPE_BY_CODE = { '01': '일반고등학교', '02': '특수목적고등학교', '03': '특성화고등학교', '04': '자율고등학교' };
const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/[·ㆍ]/g, '');
// 시군구 이름은 개편으로 바뀐다(인천 서구→서해구 등). 학교명+시도 로 먼저 맞추고, 겹치면 시군구까지 본다.
function keyOf(level, sido, name) { return `${level}|${norm(sido)}|${norm(name)}`; }
function keyOf2(level, sido, sigungu, name) { return `${level}|${norm(sido)}|${norm(sigungu)}|${norm(name)}`; }
// 같은 시도에 같은 이름의 학교가 11쌍 있다(중학교 분교·캠퍼스 등) — 시군구까지 맞는 게 있으면 그걸 우선한다
function findHit(byKey, byKey2, level, sido, sigungu, name) { return byKey2.get(keyOf2(level, sido, sigungu, name)) || byKey.get(keyOf(level, sido, name)) || null; }

function loadCatalog() {
  const raw = fs.readFileSync(fs.existsSync(BASE) ? BASE : CATALOG);
  const txt = raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  return JSON.parse(txt);
}

async function loadEnrollment(file) {
  // 공개용데이터 xlsx: 열 이름이 해마다 조금씩 달라서 '학교명/정보공시 학교코드/1학년…' 을 이름으로 찾는다.
  const XLSX = (await import('xlsx')).default;
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const hi = rows.findIndex((r) => r.some((c) => /학교명/.test(String(c))) && r.some((c) => /1학년/.test(String(c))));
  if (hi < 0) throw new Error('헤더 행을 못 찾음(학교명·1학년 열)');
  const H = rows[hi].map((c) => norm(c));
  const col = (re) => H.findIndex((h) => re.test(h));
  const cName = col(/^학교명$/), cCode = col(/학교코드/), cG1 = col(/^1학년/), cG2 = col(/^2학년/), cG3 = col(/^3학년/), cTot = col(/^계$|^합계$|^총계$/);
  const out = new Map();
  for (const r of rows.slice(hi + 1)) {
    const name = r[cName]; if (!name) continue;
    const n = (i) => (i >= 0 && r[i] !== '' ? Number(String(r[i]).replace(/,/g, '')) : null);
    const e = { grade1: n(cG1), grade2: n(cG2), grade3: n(cG3), total: n(cTot) };
    if (e.total === null && (e.grade1 ?? e.grade2 ?? e.grade3) !== null) e.total = (e.grade1 || 0) + (e.grade2 || 0) + (e.grade3 || 0);
    out.set(String(r[cCode] || '').trim() || norm(name), e);
  }
  return out;
}

async function main() {
  const cat = loadCatalog();
  const byKey = new Map(), byKey2 = new Map();
  for (const s of cat.schools) { byKey.set(keyOf(s.schoolLevel, s.sido, s.schoolName), s); byKey2.set(keyOf2(s.schoolLevel, s.sido, s.sigungu, s.schoolName), s); }
  // 학교코드로는 맞추지 않는다 — catalog 의 S0900xxxxx 와 학교알리미 SHL_CD J1000xxxxx 는 체계가 달라 숫자만 비교하면
  // 다른 시도의 엉뚱한 학교에 붙는다(2026-09-19: 경기항공고가 강원 학교에 붙어 학교정보가 덮였다).

  // ② 학교 목록(있으면) — 새 학교 추가 + 설립/유형 보정
  const listFile = path.join(here, 'out', 'school-list.json');
  const list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, 'utf8')).schools : [];
  const listById = new Map(list.map((s) => [s.shlIdfCd, s]));
  let added = 0;
  for (const s of list) {
    const k = keyOf(s.schoolLevel, s.sido, s.schoolName);
    let hit = findHit(byKey, byKey2, s.schoolLevel, s.sido, s.sigungu, s.schoolName);
    if (hit) { hit.shlIdfCd = s.shlIdfCd; if (!hit.fond && s.fond) hit.fond = s.fond; continue; }
    const entry = {
      id: s.shlCd || s.shlIdfCd, schulCode: s.shlCd || null, shlIdfCd: s.shlIdfCd, schoolName: s.schoolName, schoolLevel: s.schoolLevel,
      sido: s.sido, sigungu: s.sigungu, schoolType: s.schoolLevel === '고등학교' ? (TYPE_BY_CODE[s.hshKndScCd] || '고등학교') : '중학교',
      gender: null, fond: s.fond, enrollment: null, grade1Seats: null, sourceFile: null, bands: [], edss: null, address: s.address || null,
    };
    cat.schools.push(entry); byKey.set(k, entry); byKey2.set(keyOf2(s.schoolLevel, s.sido, s.sigungu, s.schoolName), entry); added++;
  }

  // ②-b 학교정보 팝업(fetch-school-info) — 설립·유형·성별·현재 학생수·교원수. 새로 추가된 학교는 이걸로 빈칸을 채운다.
  const infoFile = path.join(here, 'out', 'school-info.json');
  const info = fs.existsSync(infoFile) ? JSON.parse(fs.readFileSync(infoFile, 'utf8')) : {};
  let infoApplied = 0;
  for (const s of cat.schools) {
    const i = s.shlIdfCd && info[s.shlIdfCd]; if (!i) continue;
    if (i.fond) s.fond = i.fond;
    if (i.schoolType && s.schoolLevel === '고등학교') s.schoolType = i.schoolType;
    if (i.gender) s.gender = i.gender;
    if (i.address) s.address = i.address;
    s.current = { students: i.students, male: i.male, female: i.female, teachers: i.teachers, founded: i.founded, homepage: i.homepage };
    if (!s.enrollment && i.students) s.enrollment = { grade1: null, grade2: null, grade3: null, total: i.students };
    infoApplied++;
  }

  // ① 학업성취 교체
  const rawDir = path.join(here, 'out', 'achievement-raw');
  const parsed = fs.existsSync(rawDir) ? loadAll(rawDir) : [];
  let replaced = 0, missing = [];
  const years = new Set();
  for (const p of parsed) {
    const meta = listById.get(p.id);
    let hit = null;
    if (meta) hit = findHit(byKey, byKey2, meta.schoolLevel, meta.sido, meta.sigungu, meta.schoolName);
    if (!hit) hit = cat.schools.find((s) => s.shlIdfCd === p.id) || cat.schools.find((s) => norm(s.schoolName) === norm(p.name));
    if (!hit) { missing.push(p.name); continue; }
    if (!p.bands.length) continue;
    hit.bands = p.bands; hit.shlIdfCd = p.id; hit.achievementChasu = p.chasu; hit.achievementCapturedAt = p.capturedAt;
    p.bands.forEach((b) => b.year && years.add(b.year));
    replaced++;
  }

  // ③ 재적 갱신(선택)
  let enrollUpdated = 0;
  if (ENROLL) {
    const em = await loadEnrollment(ENROLL);
    for (const s of cat.schools) {
      const e = em.get(String(s.schulCode || '')) || em.get(norm(s.schoolName));
      if (!e) continue;
      s.enrollment = e; s.grade1Seats = e.grade1 ? Math.round(e.grade1 * 0.1) : null; enrollUpdated++;
    }
  }

  // 1등급 자리(1학년 × 10%)는 재적이 바뀌면 다시 계산
  for (const s of cat.schools) if (s.enrollment?.grade1) s.grade1Seats = Math.round(s.enrollment.grade1 * 0.1);

  // 2026년 공시부터는 국·영·수 외 전 과목이 들어와 밴드가 학교당 ~76개(전국 45만 줄, JSON 84MB) 가 된다.
  // 화면의 목록·정렬·비교는 국·영·수만 쓰므로 본 catalog 에는 국·영·수만 남기고, 전 과목 표는 시도×급별 파일로 나눠
  // 상세 모달이 열릴 때만 받는다(frontend/public/data/school-bands/<key>.json.gz = { [school.id]: bands[] }).
  const BANDS_DIR = path.join(path.dirname(OUT), 'school-bands');
  fs.rmSync(BANDS_DIR, { recursive: true, force: true }); fs.mkdirSync(BANDS_DIR, { recursive: true });
  const sidoIdx = [...new Set(cat.schools.map((s) => s.sido))].sort();
  const bandKey = (s) => `${s.schoolLevel === '고등학교' ? 'h' : 'm'}${String(sidoIdx.indexOf(s.sido)).padStart(2, '0')}`;
  const chunks = new Map();
  let fullBands = 0;
  for (const s of cat.schools) {
    if (!s.bands?.length) continue;
    fullBands += s.bands.length;
    const k = bandKey(s);
    if (!chunks.has(k)) chunks.set(k, {});
    chunks.get(k)[s.id] = s.bands;
    s.bandsFile = `school-bands/${k}.json.gz`;
    s.bands = s.bands.filter((b) => b.family);
  }
  for (const [k, obj] of chunks) fs.writeFileSync(path.join(BANDS_DIR, `${k}.json.gz`), zlib.gzipSync(Buffer.from(JSON.stringify(obj), 'utf8'), { level: 9 }));
  cat.bandFiles = { note: '국·영·수 외 전 과목 성취도. school.bandsFile 경로(catalog 와 같은 폴더 기준) 의 { [school.id]: bands[] }', count: chunks.size, bands: fullBands };

  cat.generatedAt = new Date().toISOString();
  cat.achievementUpdate = { schools: replaced, years: [...years].sort(), at: cat.generatedAt };
  const chasus = parsed.map((p) => p.chasu).filter(Boolean).sort();
  if (chasus.length) cat.disclosureYear = Number(chasus[chasus.length - 1].slice(0, 4));
  cat.academicYear = years.size ? `${[...years].sort().reverse()[0]}(갱신 ${replaced}곳)·2024학년도` : cat.academicYear;
  cat.source = '학교알리미 교과별 학업성취(보안문자 도우미 수집) + 공개용데이터 학년별 학생수 + EDSS 개방데이터';

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, zlib.gzipSync(Buffer.from(JSON.stringify(cat), 'utf8'), { level: 9 }));
  // 대시보드의 '새 공시' 배너용 — 2.8MB catalog 를 안 받고도 지금 실린 공시 연도를 알 수 있게 작은 메타 파일을 같이 쓴다
  const meta = { disclosureYear: cat.disclosureYear, academicYear: cat.academicYear, generatedAt: cat.generatedAt, achievementUpdate: cat.achievementUpdate, schools: cat.schools.length };
  fs.writeFileSync(OUT.replace(/\.json\.gz$/, '-meta.json'), JSON.stringify(meta), 'utf8');
  console.log(`전 과목 밴드 ${fullBands}줄 → ${BANDS_DIR} (${chunks.size}개 파일, ${(fs.readdirSync(BANDS_DIR).reduce((a, f) => a + fs.statSync(path.join(BANDS_DIR, f)).size, 0) / 1024).toFixed(0)}KB)`);
  console.log(`학교 ${cat.schools.length}곳 (신규 ${added}, 학교정보 반영 ${infoApplied}) · 성취도 교체 ${replaced}곳 (${[...years].join(',')}) · 재적 갱신 ${enrollUpdated}곳 → ${OUT} ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB`);
  if (missing.length) console.log('catalog 에 못 맞춘 학교:', missing.join(', '));
}
main().catch((e) => { console.error(e); process.exit(1); });
