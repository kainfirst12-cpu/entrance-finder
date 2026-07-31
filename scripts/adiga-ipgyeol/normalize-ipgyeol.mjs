// 입결 콘솔용 데이터 빌드:
//   ① out/ipgyeol-raw/*.json  — 어디가 신규 서비스 스크랩(2026 결과)
//   ② susi-2021-2025.xlsx     — 어디가 발표자료 취합본(2021~2025 수시입결)
// → backend/data/adiga/ipgyeol/<unvCd>.json + ipgyeol-index.json
// 엔트리 키: unvCd | 학과 | 전형구분(교과/종합/논술/실기) | 정규화 전형명
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from "fs";
import XLSX from "xlsx";

const RAW = "out/ipgyeol-raw";
const XLSX_FILE = "susi-2021-2025.xlsx";
const BK = "C:/Users/kainf/entrance-finder/backend/data/adiga";
const DEST = `${BK}/ipgyeol`;
if (existsSync(DEST)) rmSync(DEST, { recursive: true });
mkdirSync(DEST, { recursive: true });

const univList = JSON.parse(readFileSync(`${BK}/univ-list.json`, "utf8")).universities;
const adiga = univList.map((u) => {
  const m = u.name.match(/^(.+?)\[(.+)\]$/);
  return { unvCd: u.unvCd, base: m ? m[1] : u.name, campus: m ? m[2] : "본교", region: u.region, name: u.name };
});

const num = (s) => {
  const t = String(s ?? "").replace(/,/g, "").replace(/[Xx]$/, "").trim(); // 2021 자료의 마스킹(X) 제거
  if (!t || t === "-" || /미제출|비공개|해당없음|없음/.test(t)) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
};
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
// 전형명 정규화: "학생부교과(학생부우수자)"·"학생부우수자전형" → "학생부우수자"
const normType = (s) => clean(s)
  .replace(/^학생부\s*(교과|종합)\s*[\(\[]?/, "").replace(/[\)\]]$/, "")
  .replace(/전형$/, "").replace(/\s/g, "").toLowerCase();

// ── 대학명 → unvCd 매핑 ─────────────────────────────
const ALIAS = { // 개명·통합 대학
  "안동대학교": "국립경국대학교", "경북도립대학교": "국립경국대학교",
  "한국산업기술대학교": "한국공학대학교", "경남과학기술대학교": "경상국립대학교",
  "KC대학교": "강서대학교", "경주대학교": "신경주대학교", "신경대학교": "화성의과학대학교",
  "아세아연합신학대학교": "아신대학교", "꽃동네대학교": "가톨릭꽃동네대학교", "한경대학교": "한경국립대학교",
};
function matchFull(full) { // "가야대학교(김해)(본교)" → unvCd
  let base = full.replace(/\(.+?\)/g, "").replace(/\s/g, "").trim();
  const parens = [...full.matchAll(/\((.+?)\)/g)].map((m) => m[1]);
  if (ALIAS[base]) base = ALIAS[base];
  let cands = adiga.filter((a) => a.base === base);
  if (!cands.length) cands = adiga.filter((a) => a.base === "국립" + base);
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0].unvCd;
  const campusHint = parens.find((p) => /본교|캠퍼스|분교/.test(p));
  if (campusHint) {
    const c = cands.find((a) => a.campus === campusHint || a.campus.includes(campusHint.replace(/캠퍼스/, "")));
    if (c) return c.unvCd;
  }
  return (cands.find((a) => a.campus === "본교") || cands[0]).unvCd;
}
// 축약명 캠퍼스 힌트 → 정식 캠퍼스
const SHORT_CAMPUS = {
  "건국대(서울)": "건국대학교(본교)", "건국대(글로컬)": "건국대학교(분교)",
  "고려대(서울)": "고려대학교(본교)", "고려대(세종)": "고려대학교(분교)",
  "단국대(죽전)": "단국대학교(본교)", "단국대(천안)": "단국대학교(제2캠퍼스)",
  "동국대(서울)": "동국대학교(본교)", "동국대(경주)": "동국대학교(분교)", "동국대(WISE)": "동국대학교(분교)", "동국대(바이오)": "동국대학교(본교)",
  "연세대(서울)": "연세대학교(본교)", "연세대(미래)": "연세대학교(분교)",
  "한양대(서울)": "한양대학교(본교)", "한양대(ERICA)": "한양대학교(분교)",
  "한국외대(서울)": "한국외국어대학교(본교)", "한국외대(글로벌)": "한국외국어대학교(본교)",
  "홍익대(서울)": "홍익대학교(본교)", "홍익대(세종)": "홍익대학교(제2캠퍼스)",
  "상명대(서울)": "상명대학교(본교)", "상명대(천안)": "상명대학교(제2캠퍼스)",
  "강원대(춘천)": "강원대학교(본교)", "강원대(삼척)": "강원대학교(제2캠퍼스)", "강원대(도계)": "강원대학교(제2캠퍼스)", "강원대(삼척도계)": "강원대학교(제2캠퍼스)",
  "신한대(의정부)": "신한대학교(본교)", "신한대(동두천)": "신한대학교(제2캠퍼스)",
  "인천가톨릭대(강화)": "인천가톨릭대학교(본교)",
  "강서대(구 KC대)": "강서대학교(본교)", "KC대": "강서대학교(본교)",
  "서울과기대": "서울과학기술대학교(본교)", "경인교대": "경인교육대학교(본교)",
  "전주교대": "전주교육대학교(본교)", "공주교대": "공주교육대학교(본교)", "광주교대": "광주교육대학교(본교)",
  "대구교대": "대구교육대학교(본교)", "부산교대": "부산교육대학교(본교)", "서울교대": "서울교육대학교(본교)",
  "진주교대": "진주교육대학교(본교)", "청주교대": "청주교육대학교(본교)", "춘천교대": "춘천교육대학교(본교)",
  "한국기술교대": "한국기술교육대학교(본교)", "금오공대": "국립금오공과대학교(본교)", "포항공대": "포항공과대학교(본교)",
  "차의과대": "차의과학대학교(본교)", "추계예대": "추계예술대학교(본교)", "예원예대": "예원예술대학교(본교)",
  "감리교신대": "감리교신학대학교(본교)", "장로회신대": "장로회신학대학교(본교)", "서울신대": "서울신학대학교(본교)",
  "대전신대": "대전신학대학교(본교)", "호남신대": "호남신학대학교(본교)", "한국침례신대": "한국침례신학대학교(본교)",
  "부산외대": "부산외국어대학교(본교)", "한국외대": "한국외국어대학교(본교)", "한국체대": "한국체육대학교(본교)",
  "덕성여대": "덕성여자대학교(본교)", "동덕여대": "동덕여자대학교(본교)", "서울여대": "서울여자대학교(본교)",
  "성신여대": "성신여자대학교(본교)", "숙명여대": "숙명여자대학교(본교)", "이화여대": "이화여자대학교(본교)", "광주여대": "광주여자대학교(본교)",
};

// 2023 시트에서 축약명→정식명 사전 구축
const wb = XLSX.readFile(XLSX_FILE);
const shortToFull = new Map();
{
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets["2023 수시입결"], { header: 1, defval: "" });
  for (const r of aoa.slice(4)) {
    const full = clean(r[0]), short = clean(r[1]);
    if (full && short && !shortToFull.has(short)) shortToFull.set(short, full);
  }
}
const shortCache = new Map();
function matchShort(short) {
  if (shortCache.has(short)) return shortCache.get(short);
  let cd = null;
  if (SHORT_CAMPUS[short]) cd = matchFull(SHORT_CAMPUS[short]);
  if (!cd && shortToFull.has(short)) cd = matchFull(shortToFull.get(short));
  if (!cd) { // "가야대" → "가야대학교"
    const guess = short.replace(/\(.+?\)/g, "").trim().replace(/대$/, "대학교");
    cd = matchFull(guess + (short.match(/\((.+?)\)/)?.[0] || ""));
  }
  shortCache.set(short, cd);
  return cd;
}

// ── 엔트리 수집 ─────────────────────────────────────
// entries: Map<unvCd, Map<entryKey, entry>>
const byUniv = new Map();
function getEntry(unvCd, dept, track, typeName) {
  if (!byUniv.has(unvCd)) byUniv.set(unvCd, new Map());
  const m = byUniv.get(unvCd);
  const key = `${dept}|${track}|${normType(typeName)}`;
  if (!m.has(key)) m.set(key, { dept, track, typeName, years: {} });
  const e = m.get(key);
  // 최신 표기의 전형명 우선(스크랩 2026 표기가 나중에 들어와 덮어씀)
  return e;
}

// ① 엑셀 2021~2025
const SHEETS = {
  "2025 수시입결": { name: 0, track: 1, type: 2, dept: 3, recruit: 4, rate: 5, fill: 6, s50: 7, s70: 8, total: 9, g50: 11, g70: 12 },
  "2024 수시입결": { name: 1, track: 2, type: 3, dept: 4, recruit: 5, rate: 6, fill: 7, s50: 8, s70: 9, total: 10, g50: 11, g70: 12 },
  "2023 수시입결": { name: 1, track: 2, type: 3, dept: 4, recruit: 5, rate: 6, fill: 7, s50: 8, s70: 9, total: 10, g50: 11, g70: 12 },
  "2022 수시입결": { name: 0, track: 1, type: 2, dept: 3, recruit: 4, rate: 5, fill: 6, s50: 7, s70: 8, total: 9, g50: 10, g70: 11 },
  "2021 수시입결": { name: 0, track: 1, type: 2, dept: 3, recruit: 4, rate: 5, fill: 6, s50: null, s70: 7, total: 8, g50: 9, g70: 10 },
};
const unmatched = new Map();
for (const [sheetName, c] of Object.entries(SHEETS)) {
  const year = sheetName.slice(0, 4);
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
  for (const r of aoa.slice(4)) {
    const short = clean(r[c.name]);
    const track = clean(r[c.track]);
    const dept = clean(r[c.dept]);
    const typeName = clean(r[c.type]);
    if (!short || !dept || !track) continue;
    const unvCd = matchShort(short);
    if (!unvCd) { unmatched.set(short, (unmatched.get(short) || 0) + 1); continue; }
    const total = num(r[c.total]);
    const s70 = c.s70 != null ? num(r[c.s70]) : null;
    const e = getEntry(unvCd, dept, track, typeName);
    if (!e.years[year]) e.years[year] = {
      recruit: num(r[c.recruit]), rate: num(r[c.rate]), fill: num(r[c.fill]),
      score50: c.s50 != null ? num(r[c.s50]) : null, score70: s70, scoreTotal: total,
      grade50: num(r[c.g50]), grade70: num(r[c.g70]),
      pct70: s70 != null && total ? Math.round((s70 / total) * 1000) / 10 : null,
    };
  }
}

// ② 어디가 스크랩(2026) — 컬럼: 0모집시기 1전형유형 2전형명 3학과 4최초 5이월 6최종 7경쟁률 8충원 9~13환산점수 14총점 15~19환산등급
for (const file of readdirSync(RAW).filter((f) => f.endsWith(".json"))) {
  const raw = JSON.parse(readFileSync(`${RAW}/${file}`, "utf8"));
  for (const [syr, types] of Object.entries(raw.years || {})) {
    for (const { label, tables } of Object.values(types)) {
      for (const grid of tables) {
        const headerRows = grid.filter((row) => row.some((cell) => /학과명|모집단위/.test(cell))).length;
        for (const row of grid.slice(headerRows)) {
          if (row.length < 9) continue;
          const period = clean(row[0]), typeName = clean(row[2]), dept = clean(row[3]);
          if (period !== "수시" || !dept || /학과명|모집단위/.test(dept)) continue;
          const total = num(row[14]), s70 = num(row[10]);
          const e = getEntry(raw.unvCd, dept, label, typeName);
          e.typeName = typeName; // 최신 표기 우선
          e.years[syr] = {
            recruit: num(row[6]), recruitFirst: num(row[4]), carry: num(row[5]),
            rate: num(row[7]), fill: num(row[8]),
            score50: num(row[9]), score70: s70, scoreTotal: total,
            grade50: num(row[15]), grade70: num(row[16]),
            pct70: s70 != null && total ? Math.round((s70 / total) * 1000) / 10 : null,
          };
        }
      }
    }
  }
}

// ── 수능최저(전형안내에서) ──────────────────────────
function extractSunung(unvCd) {
  const f = `${BK}/univ/${unvCd}.json`;
  if (!existsSync(f)) return [];
  let g; try { g = JSON.parse(readFileSync(f, "utf8")); } catch { return []; }
  const out = [];
  for (const table of g.guide?.tables || []) {
    let track = "";
    for (const row of table) {
      if (row[0] === "전형명") track = clean(row.slice(1).join(" ")).slice(0, 80);
      if (/수능최저학력기준/.test(row[0] || "")) {
        const text = clean(row.slice(1).join(" "));
        if (text) out.push({ track, text: text.slice(0, 300) });
      }
    }
  }
  return out;
}

// ── 저장 ────────────────────────────────────────────
const univMeta = new Map(univList.map((u) => [u.unvCd, u]));
const index = [];
for (const [unvCd, m] of byUniv) {
  const meta = univMeta.get(unvCd);
  if (!meta) continue;
  const entries = [...m.values()].filter((e) => Object.keys(e.years).length > 0);
  if (!entries.length) continue;
  entries.sort((a, b) => a.dept.localeCompare(b.dept, "ko") || a.typeName.localeCompare(b.typeName, "ko"));
  const years = new Set(); entries.forEach((e) => Object.keys(e.years).forEach((y) => years.add(y)));
  writeFileSync(`${DEST}/${unvCd}.json`, JSON.stringify({
    unvCd, name: meta.name, region: meta.region,
    source: "대학어디가(한국대학교육협의회) adiga.kr 공식 입시결과", years: [...years].sort(),
    sunung: extractSunung(unvCd), entries,
  }));
  index.push({ unvCd, name: meta.name, region: meta.region,
    deptCount: new Set(entries.map((e) => e.dept)).size, entryCount: entries.length, years: [...years].sort() });
}
index.sort((a, b) => a.name.localeCompare(b.name, "ko"));
writeFileSync(`${BK}/ipgyeol-index.json`, JSON.stringify({
  count: index.length, source: "대학어디가(한국대학교육협의회) adiga.kr 공식 입시결과",
  built: "2026-07-31", universities: index,
}));
console.log(`대학 ${index.length}개 저장. 미매칭 대학명:`, [...unmatched.entries()].map(([k, v]) => `${k}(${v})`).join(", ") || "없음");
