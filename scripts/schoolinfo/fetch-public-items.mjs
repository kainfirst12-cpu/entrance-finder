// 학교알리미 학교별 공시 팝업(보안문자 없음) → out/public-items.json
//   졸업생 진로(13-다, 최근 3개 공시) · 학교 현황(3-가-1: 학급당·수업교원 1인당 학생수 + 시군구·시도·전국 평균)
//   · 전출입·학업중단(3-나) · 직위별 교원(6-가: 기간제 교사 비율) · 동아리(15-나)
//   POST /ei/pp/Pneipp_bXX_s0p.do (쿠키 불필요, 파라미터는 전부 보내야 함 — 빠지면 ERROR 페이지)
//   node fetch-public-items.mjs [시도|시군구] [--refresh] [--level=고등학교|중학교]
//   중단돼도 이어받는다(이미 받은 학교는 건너뜀, 50곳마다 저장). 동시 4개.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const BASE = 'https://www.schoolinfo.go.kr';
const CONCURRENCY = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ITEMS = {
  career: { u: 'b06', GS_HANGMOK_CD: '06', GS_HANGMOK_NO: '13-다', GS_BURYU_CD: 'JG040', JG_BURYU_CD: 'JG130', JG_HANGMOK_CD: '52' },
  status: { u: 'b01', GS_HANGMOK_CD: '01', GS_HANGMOK_NO: '3-가-1', GS_BURYU_CD: 'JG010', JG_BURYU_CD: 'JG030', JG_HANGMOK_CD: '62' },
  moves: { u: 'b04', GS_HANGMOK_CD: '04', GS_HANGMOK_NO: '3-나', GS_BURYU_CD: 'JG020', JG_BURYU_CD: 'JG030', JG_HANGMOK_CD: '10' },
  staff: { u: 'b08', GS_HANGMOK_CD: '08', GS_HANGMOK_NO: '6-가', GS_BURYU_CD: 'JG050', JG_BURYU_CD: 'JG060', JG_HANGMOK_CD: '22' },
  voc: { u: 'b64', GS_HANGMOK_CD: '64', GS_HANGMOK_NO: '13-라', GS_BURYU_CD: 'JG040', JG_BURYU_CD: 'JG130', JG_HANGMOK_CD: '53' },
  clubs: { u: 'b19', GS_HANGMOK_CD: '19', GS_HANGMOK_NO: '15-나', GS_BURYU_CD: 'JG130', JG_BURYU_CD: 'JG150', JG_HANGMOK_CD: '56' },
};
const CAREER_YEARS = [2025, 2024, 2023]; // 11월(4차) 공시 — 그 해 2월 졸업생
const NOW = 2026; // 5월(2차) 공시 항목

export function decode(buf) {
  const u = new TextDecoder('utf-8').decode(buf);
  return u.includes('�') ? new TextDecoder('euc-kr').decode(buf) : u;
}
export function tables(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((t) => ({
    cap: ((t[0].match(/<caption[^>]*>([\s\S]*?)<\/caption>/) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    rows: [...t[0].matchAll(/<tr[\s\S]*?<\/tr>/g)].map((r) => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/g)].map((c) => c[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())),
  }));
}
const n = (v) => { if (v == null) return null; const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const label = (r) => String(r[0] || '').replace(/\s+/g, '');
const findTable = (ts, re) => ts.find((t) => re.test(t.cap));
const findRow = (t, re) => t?.rows.find((r) => re.test(label(r)));
function shownYear(html) {
  const m = html.match(/<option[^>]*selected[^>]*>([^<]*)</);
  const y = m && m[1].match(/(\d{4})년\s*(\d{2})월/);
  return y ? `${y[1]}-${y[2]}` : null;
}

// ── 파서 ──
export function parseCareer(html, level) {
  const t = findTable(tables(html), /졸업자 진로 현황/);
  const tot = findRow(t, /^합계$/);
  if (!tot) return null;
  const v = tot.slice(1).map(n);
  if (level === '고등학교') {
    // 졸업자 | 진학: 전문대 · 대학교 · 국외(전문대·대학교·소계) · 진학계 | 취업 | 기타
    const [grad, college, univ, , , abroad, adv, job, etc] = v;
    if (!grad) return null;
    return { grad, college, univ, abroad, adv, job, etc };
  }
  // 중학교: 졸업자 | 일반고 · 특성화고 · 과학고 · 외고국제고 · 예고체고 · 마이스터고 · 특목소계 · 자사고 · 자공고 · 자율소계 · 기타 · 진학계 | 취업 | 대안교육 | 무직·미상
  const [grad, general, vocational, science, foreign, arts, meister, , jasa, jagong, , other, adv, job, alt, unknown] = v;
  if (!grad) return null;
  return { grad, general, vocational, science, foreign, arts, meister, jasa, jagong, other, adv, job, alt, unknown };
}
// 특성화고·마이스터고는 13-다 대신 13-라(취업 등 진로) 를 공시한다. 합계 줄 = 졸업자 · 전문대 · 대학교 · 진학계 · 취업자 · 취업률 · 입대 · 제외인정 · 미취업
export function parseVocCareer(html) {
  const ts = tables(html).filter((t) => /취업 등 진로현황/.test(t.cap));
  const tot = ts[0] && findRow(ts[0], /^합계$/);
  if (!tot) return null;
  const [grad, college, univ, adv, job, jobRate, army, exempt, unemployed] = tot.slice(1).map(n);
  if (!grad) return null;
  const avg = ts[1] ? ts[1].rows.filter((r) => r.length === 2 && !/구분/.test(label(r))).map((r) => ({ area: r[0], jobRate: n(r[1]) })) : undefined;
  return { voc: true, grad, college, univ, abroad: 0, adv, job, jobRate, army, exempt, etc: (army || 0) + (exempt || 0) + (unemployed || 0), unemployed, avg };
}
export function parseStatus(html) {
  const ts = tables(html);
  const t = findTable(ts, /학급 수, 학생 수 및 교원/);
  if (!t) return null;
  const per = findRow(t, /^학급당학생수$/);
  const out = { perClass: per ? n(per[per.length - 1]) : null, perClassGrade: per ? per.slice(1, 4).map(n) : null };
  const cls = findRow(t, /^학급수$/);
  if (cls && cls.length >= 10 && n(cls[1]) !== null) {
    // 중학교 꼴: 학급수 줄 = 1·2·3학년 · 특수 · 순회 · 계 · 교원수 · 수업교원수 · 1인당 / 학생수 줄 = … · 계
    const stu = findRow(t, /^학생수$/);
    Object.assign(out, { classes: n(cls[6]), students: stu ? n(stu[6]) : null, teachers: n(cls[7]), classTeachers: n(cls[8]), perTeacher: n(cls[9]) });
  } else {
    // 고등학교 꼴: 학과 줄 = 학과 · (학급수·학생수)×5 · 계(학급·학생) · 교원수 · 수업교원수 · 1인당 (교원은 첫 학과 줄에만)
    const total = findRow(t, /^계$/);
    const firstDept = t.rows.find((r) => r.length >= 16);
    Object.assign(out, {
      classes: total ? n(total[11]) : null, students: total ? n(total[12]) : null,
      teachers: firstDept ? n(firstDept[13]) : null, classTeachers: firstDept ? n(firstDept[14]) : null, perTeacher: firstDept ? n(firstDept[15]) : null,
    });
  }
  const avg = findTable(ts, /지역\/시도별 평균|지역별 학급당/);
  const rows = avg ? avg.rows.filter((r) => r.length >= 5 && !/구분/.test(label(r))) : [];
  if (rows.length) out.avg = rows.map((r) => ({ area: r[0], perClass: [n(r[1]), n(r[2]), n(r[3])], perTeacher: n(r[4]) }));
  return out;
}
export function parseMoves(html) {
  const ts = tables(html);
  const t = findTable(ts, /전출입 및 학업중단/);
  const tot = findRow(t, /^총계$/);
  const head = t?.rows.find((r) => r.some((c) => /전\s*입/.test(c)));
  if (!tot || !head) return null;
  const col = (re) => { const i = head.findIndex((c) => re.test(c.replace(/\s+/g, ''))); return i < 0 ? null : n(tot[i]); };
  // 고교는 '학업중단' 한 칸, 중학교는 유예·면제·정원외 학적관리 합이 학업중단
  const drop = col(/^학업중단$/) ?? ['유예', '면제', '정원외'].reduce((sum, k) => sum + (col(new RegExp('^' + k)) || 0), 0);
  const out = { year: (t.rows[0]?.[0] || '').match(/\d{4}/)?.[0] || null, in: col(/^전입$/), out: col(/^전출$/), dropout: drop, base: col(/^전년도/), dropoutRate: col(/학업중단율/) };
  const cmp = findTable(ts, /지역별 전입 전출/);
  if (cmp) out.avg = cmp.rows.filter((r) => r.length >= 4 && !/구분/.test(label(r))).map((r) => ({ area: r[0], inRate: n(r[1]), outRate: n(r[2]), dropoutRate: n(r[3]) }));
  return out;
}
export function parseStaff(html) {
  const t = findTable(tables(html), /직위별 교원 현황/);
  if (!t) return null;
  const head = t.rows.find((r) => r.some((c) => /기간제/.test(c)));
  const tot = findRow(t, /^합계/);
  if (!head || !tot) return null;
  const idx = (re) => head.findIndex((c) => re.test(c.replace(/\s+/g, '')));
  // 머리줄 첫 칸이 '구분'이라 값 줄과 칸 위치가 같다
  const temp = n(tot[idx(/기간제/)]), lecturer = n(tot[idx(/^강사$/)]), total = n(tot[idx(/총계/)]);
  if (!total) return null;
  return { total, temp, lecturer, tempRatio: total ? Math.round((temp / total) * 1000) / 10 : null };
}
export function parseClubs(html) {
  const ts = tables(html);
  const t = findTable(ts, /동아리 운영 현황/);
  const row = t?.rows.find((r) => /\d{4}학년도/.test(r[0]));
  if (!row) return null;
  return { year: row[0].match(/\d{4}/)[0], clubs: n(row[1]), members: n(row[2]), selfClubs: n(row[6]), selfMembers: n(row[7]) };
}

async function post(item, id, year) {
  const it = ITEMS[item];
  const body = new URLSearchParams({
    GS_HANGMOK_CD: it.GS_HANGMOK_CD, GS_HANGMOK_NO: it.GS_HANGMOK_NO, GS_BURYU_CD: it.GS_BURYU_CD, JG_BURYU_CD: it.JG_BURYU_CD,
    JG_HANGMOK_CD: it.JG_HANGMOK_CD, JG_GUBUN: '1', JG_YEAR2: String(year), SHL_IDF_CD: id, GS_TYPE: 'Y', JG_YEAR: String(year),
    SORT: 'BR', CHOSEN_JG_YEAR: String(year), PRE_JG_YEAR: String(year), LOAD_TYPE: 'single',
  });
  for (let tryNo = 0; tryNo < 3; tryNo++) {
    try {
      const res = await fetch(`${BASE}/ei/pp/Pneipp_${it.u}_s0p.do`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = decode(Buffer.from(await res.arrayBuffer()));
      if (/<title>ERROR<\/title>/.test(html)) return null;
      return html;
    } catch (e) {
      if (tryNo === 2) throw e;
      await sleep(1500 * (tryNo + 1));
    }
  }
  return null;
}

export async function fetchSchool(s) {
  const rec = { name: s.schoolName, level: s.schoolLevel, fetchedAt: new Date().toISOString() };
  rec.career = [];
  for (const y of CAREER_YEARS) {
    const h = await post('career', s.shlIdfCd, y);
    const c = h && parseCareer(h, s.schoolLevel);
    if (c) { const shown = shownYear(h); if (!rec.career.some((x) => x.shown === shown)) rec.career.push({ year: y, shown, ...c }); }
  }
  if (!rec.career.length && s.schoolLevel === '고등학교') await fillVoc(s, rec);
  const h1 = await post('status', s.shlIdfCd, NOW); rec.status = h1 ? parseStatus(h1) : null;
  const h2 = await post('moves', s.shlIdfCd, NOW); rec.moves = h2 ? parseMoves(h2) : null;
  const h3 = await post('staff', s.shlIdfCd, NOW); rec.staff = h3 ? parseStaff(h3) : null;
  const h4 = await post('clubs', s.shlIdfCd, NOW); rec.clubs = h4 ? parseClubs(h4) : null;
  return rec;
}

async function fillVoc(s, rec) {
  rec.career = [];
  for (const y of CAREER_YEARS) {
    const h = await post('voc', s.shlIdfCd, y);
    const c = h && parseVocCareer(h);
    if (c) { const shown = shownYear(h); if (!rec.career.some((x) => x.shown === shown)) rec.career.push({ year: y, shown, ...c }); }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const lv = (args.find((a) => a.startsWith('--level=')) || '').slice(8) || null;
  const only = args.find((a) => !a.startsWith('--')) || null;
  const list = JSON.parse(fs.readFileSync(path.join(here, 'out', 'school-list.json'), 'utf8')).schools
    .filter((s) => s.shlIdfCd && (!only || s.sigungu === only || s.sido === only) && (!lv || s.schoolLevel === lv))
    .sort((a, b) => (a.schoolLevel === b.schoolLevel ? 0 : a.schoolLevel === '고등학교' ? -1 : 1)); // 고교 먼저
  const outFile = path.join(here, 'out', 'public-items.json');
  const data = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : {};
  if (args.includes('--voc')) {
    // 이미 받은 고교 중 진로(13-다)가 비어 있는 곳만 13-라 로 다시 — 특성화고·마이스터고
    const voc = list.filter((s) => s.schoolLevel === '고등학교' && data[s.shlIdfCd] && !data[s.shlIdfCd].career?.length);
    console.log(`13-라 대상 ${voc.length}곳`);
    let k = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (k < voc.length) { const s = voc[k++]; try { await fillVoc(s, data[s.shlIdfCd]); } catch (e) { console.log('실패', s.schoolName, e.message); } } }));
    fs.writeFileSync(outFile, JSON.stringify(data));
    console.log(`끝: 13-라 채움 ${voc.filter((s) => data[s.shlIdfCd].career.length).length}곳`);
    return;
  }
  const todo = list.filter((s) => refresh || !data[s.shlIdfCd]);
  console.log(`대상 ${list.length}곳 · 받을 것 ${todo.length}곳`);
  let done = 0, fail = 0, i = 0;
  const save = () => fs.writeFileSync(outFile, JSON.stringify(data));
  async function worker() {
    while (i < todo.length) {
      const s = todo[i++];
      try { data[s.shlIdfCd] = await fetchSchool(s); done++; } catch (e) { fail++; console.log('실패', s.schoolName, e.message); }
      if ((done + fail) % 50 === 0) { save(); console.log(`${done + fail}/${todo.length} (실패 ${fail}) — ${s.sido} ${s.schoolName}`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  save();
  console.log(`끝: ${done}곳 저장, 실패 ${fail}곳 → ${outFile}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) main();
