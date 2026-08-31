/**
 * 2027 수시 대학별 지원 시 유의사항(SKYPASS) docx → JSON
 *
 * 왜 필요한가
 *   입결 숫자만으로는 알 수 없는 것들이 이 문서에 있다. 특히 **절반에 가까운 대학이
 *   "그 대학 자체 환산등급으로 봐야 한다"** 고 적혀 있는데, 이걸 모르면 입결 콘솔이
 *   학생의 일반 등급과 그 대학 환산등급을 같은 자로 재서 틀린 판정을 낸다.
 *   그래서 이 문서는 '조회용 자료'가 아니라 **입결을 읽는 법**이고, 판정 파이프라인에 들어간다.
 *
 * 쓰는 법
 *   node backend/scripts/parse-skypass.mjs "<docx 경로>" [출력경로]
 *   기본 출력: backend/data/skypass/2027-notes.json
 *
 * ⚠️ 원본 문서에 "재배포 금지" 문구가 있다. 산출물도 같은 성격이므로 외부 공개용이 아니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');           // backend/
const UNIV_LIST = path.join(ROOT, 'data/adiga/univ-list.json');

// ── docx → 표 행 ────────────────────────────────────────────
// mammoth 는 표를 HTML 로 풀어 주지만 셀 경계가 뭉개진다. 우리가 필요한 건 정확히
// (구분·전형명·모집단위·유의사항) 4칸이라 document.xml 을 직접 읽는다.
function readDocx(file) {
  const xml = new AdmZip(file).readAsText('word/document.xml');
  if (!xml) throw new Error('word/document.xml 을 찾을 수 없습니다 — docx 가 맞습니까?');
  return xml;
}

const stripTags = (s) => s.replace(/<[^>]+>/g, '');
const unescapeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// ⚠ `<w:t[^>]*>` 로 쓰면 <w:tblPrEx>·<w:trPr> 같은 태그까지 잡아 XML 조각이 텍스트로 섞인다.
//   `<w:t` 다음이 공백이거나 바로 닫히는 경우만 진짜 텍스트 노드다.
const textOf = (frag) => unescapeXml(
  [...frag.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(''),
).replace(/\s+/g, ' ').trim();

/** 문서를 위에서 아래로 훑어 (대학 헤더 문단 | 표 행) 순서대로 뽑는다. */
function walk(xml) {
  const out = [];
  // 문단과 표 행을 등장 순서대로. 표 행 안의 문단은 행에 흡수시킨다.
  const re = /<w:tr[ >][\s\S]*?<\/w:tr>|<w:p[ >][\s\S]*?<\/w:p>/g;
  let m;
  let lastRowEnd = 0;
  while ((m = re.exec(xml))) {
    if (m.index < lastRowEnd) continue;              // 표 행 내부의 문단은 건너뛴다
    const chunk = m[0];
    if (chunk.startsWith('<w:tr')) {
      lastRowEnd = m.index + chunk.length;
      const cells = [...chunk.matchAll(/<w:tc[ >][\s\S]*?<\/w:tc>/g)].map((c) => textOf(c[0]));
      out.push({ kind: 'row', cells });
    } else {
      out.push({ kind: 'para', text: textOf(chunk) });
    }
  }
  return out;
}

// ── 대학명 → unvCd ──────────────────────────────────────────
const ALIAS = {
  경상대학교: '경상국립대학교',
  한경대학교: '한경국립대학교',
  안동대학교: '국립경국대학교',
  경국대학교: '국립경국대학교',
  한국산업기술대학교: '한국공학대학교',
  KC대학교: '강서대학교',
  POSTECH: '포항공과대학교',
};
// 어디가(대학어디가)에 아예 없는 학교 — 과학기술원 계열은 그쪽 서비스 대상이 아니다.
// 매칭 실패가 아니라 '원래 없음'이므로 따로 표시해 둔다(나중에 별도 코드가 생기면 여기만 고친다).
const NOT_IN_ADIGA = new Set(['KAIST', 'GIST', 'DGIST', 'UNIST', 'KENTECH']);
// SKYPASS 괄호 캠퍼스 → 어디가 대괄호 캠퍼스
const CAMPUS = {
  '단국대학교|천안': '제2캠퍼스', '상명대학교|천안': '제2캠퍼스', '홍익대학교|세종': '제2캠퍼스',
  '강원대학교|춘천': '본교', '강원대학교|삼척': '제2캠퍼스', '강원대학교|도계': '제3캠퍼스',
  '강원대학교|강릉': '제4캠퍼스', '강원대학교|원주': '본교',
};

function buildMatcher(universities) {
  // name 예: "가야대학교[본교]", "동국대학교(WISE)[분교]"
  const parsed = universities.map((u) => {
    const campus = (u.name.match(/\[(.+?)\]$/) || [, ''])[1];
    const base = u.name.replace(/\[.+?\]$/, '').replace(/\s/g, '');
    return { ...u, base, campus };
  });
  const byBase = new Map();
  for (const u of parsed) {
    if (!byBase.has(u.base)) byBase.set(u.base, []);
    byBase.get(u.base).push(u);
  }
  return function match(rawName) {
    const name = rawName.replace(/\s/g, '');
    if (NOT_IN_ADIGA.has(name)) return { unvCd: null, reason: 'not-in-adiga' };
    // 괄호는 캠퍼스 힌트일 수도, 이름의 일부일 수도 있다(동국대학교(WISE)) — 둘 다 시도한다.
    const hint = (rawName.match(/\((.+?)\)/) || [, ''])[1];
    const bare = name.replace(/\(.+?\)/g, '');
    const candidates = [name, bare, ALIAS[bare], ALIAS[name], `국립${bare}`, `국립${name}`].filter(Boolean);
    for (const c of candidates) {
      const hits = byBase.get(c);
      if (!hits?.length) continue;
      if (hits.length === 1) return { unvCd: hits[0].unvCd, name: hits[0].name };
      const want = CAMPUS[`${bare}|${hint}`];
      const byCampus = want && hits.find((h) => h.campus === want);
      const pick = byCampus || hits.find((h) => h.campus === '본교') || hits[0];
      return { unvCd: pick.unvCd, name: pick.name, ambiguous: !byCampus && !!hint };
    }
    return { unvCd: null, reason: 'no-match' };
  };
}

// ── 유의사항 분류 ───────────────────────────────────────────
// ②단계(카드 배지·판정 보정)에서 종류별로 다르게 다뤄야 하므로 여기서 미리 태그를 단다.
// 가장 중요한 건 scaleWarning — 이게 붙은 대학은 등급 직접 비교 자체가 성립하지 않는다.
const TAGGERS = [
  ['scaleWarning', /(식\s*환산|식\s*등급|식\s*평균|환산등급|환산점수로|등급\s*평균|평균\s*등급|자체\s*환산)/],
  ['schoolMix', /(일반고|특목|자사|외고|과고|영과고|국제고|광자고|전사고|영재)/],
  ['minimum', /최저/],
  ['volatility', /(경쟁률|폭발|대폭|상승|하락|변동|주의)/],
  ['notRecommended', /(추천\s*안|비추|지양|불가능|어려움)/],
  ['fillRate', /충원/],
];
function tagsOf(note) {
  const tags = TAGGERS.filter(([, re]) => re.test(note)).map(([t]) => t);
  if (/\d\.\d/.test(note)) tags.push('cutHint');
  return tags;
}
/** "1.10을 기준으로", "80%컷 2.91" 처럼 적힌 등급 기준선을 참고값으로 뽑는다(판정에 바로 쓰지는 않는다). */
function cutValuesOf(note) {
  return [...note.matchAll(/(\d\.\d{1,2})/g)].map((m) => parseFloat(m[1])).filter((n) => n >= 1 && n <= 9);
}

/** 모집단위 칸 — "A, B, C 외 3개" / "전형 전체" */
function parseUnits(raw) {
  const s = (raw || '').trim();
  if (!s || s === '전형 전체') return { all: true, units: [], more: 0 };
  const more = parseInt((s.match(/외\s*(\d+)\s*개/) || [, '0'])[1], 10);
  const body = s.replace(/외\s*\d+\s*개\s*$/, '');
  // ⚠ 학과 이름 안에도 쉼표가 있다("디자인공학부 (산업디자인공학,미디어디자인공학)").
  //   그냥 split(',') 하면 한 학과가 두 개로 쪼개진다 — 괄호 밖 쉼표에서만 끊는다.
  const units = [];
  let depth = 0, buf = '';
  for (const ch of body) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { units.push(buf.trim()); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) units.push(buf.trim());
  return { all: false, units: units.filter(Boolean), more };
}

// ── 메인 ────────────────────────────────────────────────────
const src = process.argv[2];
if (!src) {
  console.error('사용법: node backend/scripts/parse-skypass.mjs "<docx 경로>" [출력경로]');
  process.exit(1);
}
const outPath = process.argv[3] || path.join(ROOT, 'data/skypass/2027-notes.json');

const universities = JSON.parse(fs.readFileSync(UNIV_LIST, 'utf8')).universities;
const match = buildMatcher(universities);

const items = walk(readDocx(src));
const HEADER = new Set(['구분', '전형명', '모집단위', '지원 시 유의사항']);
// ⚠ 이름 자체에 괄호가 있는 대학이 있다("동국대학교(WISE) (경북) · 5건", "강원대학교(강릉) (강원) · 6건").
//   `(.+?)` 로 짧게 잡으면 **첫 괄호를 지역으로 오인**해 캠퍼스 힌트가 사라지고,
//   그 결과 WISE·강릉 건이 전부 본교에 붙는다. 마지막 괄호가 지역이므로 greedy 로 잡는다.
const UNIV_RE = /^(.+)\s*\(([^()]*)\)\s*·\s*(\d+)\s*건$/;

const byUniv = new Map();
const unmatched = [];
let cur = null;
let rows = 0;

for (const it of items) {
  // 대학 헤더("DGIST (대구) · 2건")는 문단이 아니라 **표의 제목 행**으로 들어 있다
  // (셀 하나짜리 행). 문단으로만 찾으면 하나도 안 잡힌다.
  const headerText = it.kind === 'para'
    ? it.text
    : (it.cells.filter(Boolean).length <= 2 ? it.cells.filter(Boolean).join(' ') : '');
  const m = headerText ? UNIV_RE.exec(headerText) : null;
  if (m) {
    const rawName = m[1].trim();
    const hit = match(rawName);
    cur = {
      rawName, rawNames: [rawName], region: m[2].trim(), declared: parseInt(m[3], 10),
      unvCd: hit.unvCd, adigaName: hit.name || null, notes: [],
    };
    if (!hit.unvCd) unmatched.push({ name: rawName, region: cur.region, count: cur.declared, reason: hit.reason });
    else if (hit.ambiguous) unmatched.push({ name: rawName, region: cur.region, count: cur.declared, reason: 'campus-guess', pickedAs: hit.name });
    const key = hit.unvCd || `x:${rawName}`;
    if (byUniv.has(key)) {
      // 같은 unvCd 로 오는 캠퍼스가 있다(강원대 춘천·원주는 어디가에 본교 하나뿐).
      // 합치되 원문 이름을 모두 남긴다 — 나중에 "어느 캠퍼스 얘기였나"를 되짚을 수 있어야 한다.
      cur = byUniv.get(key);
      if (!cur.rawNames.includes(rawName)) cur.rawNames.push(rawName);
    } else byUniv.set(key, cur);
    continue;
  }
  // 표 행
  if (it.kind !== 'row') continue;
  const cells = it.cells.filter((c) => c !== '');
  if (!cur || cells.length < 4) continue;
  if (cells.some((c) => HEADER.has(c))) continue;          // 표 머리글
  const [track, typeName, unitRaw, ...rest] = cells;
  const note = rest.join(' ').trim();
  if (!note) continue;
  const u = parseUnits(unitRaw);
  cur.notes.push({
    track, typeName,
    unitAll: u.all, units: u.units, unitsMore: u.more, unitRaw,
    note, tags: tagsOf(note), cutValues: cutValuesOf(note),
  });
  rows += 1;
}

const out = {
  source: 'SKYPASS 2027학년도 수시 대학별 지원 시 유의사항',
  notice: '재배포 금지 자료 — 앱 내부 판정·상담용으로만 사용',
  year: 2027,
  generatedAt: new Date().toISOString().slice(0, 10),
  count: rows,
  univCount: byUniv.size,
  byUniv: Object.fromEntries([...byUniv].map(([k, v]) => [k, v])),
  unmatched,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 1), 'utf8');

// ── 요약 ────────────────────────────────────────────────────
const matched = [...byUniv.values()].filter((u) => u.unvCd);
const tagCount = {};
for (const u of byUniv.values()) for (const n of u.notes) for (const t of n.tags) tagCount[t] = (tagCount[t] || 0) + 1;
const scaleUniv = matched.filter((u) => u.notes.some((n) => n.tags.includes('scaleWarning')));
console.log(`유의사항 ${rows}건 · 대학 ${byUniv.size}개`);
console.log(`unvCd 매칭 ${matched.length}개 / 미매칭 ${byUniv.size - matched.length}개`);
console.log('태그:', tagCount);
console.log(`⚠ 자체 환산등급 경고 대학: ${scaleUniv.length}개 (등급 직접 비교 불가)`);
if (unmatched.length) {
  console.log('\n확인 필요:');
  for (const u of unmatched) console.log(`  [${u.reason}] ${u.name} (${u.region}) ${u.count}건${u.pickedAs ? ` → ${u.pickedAs} 로 추정` : ''}`);
}
console.log(`\n→ ${outPath}`);
