// 설명회 자료 MCP — 입시파인더(entrance-finder) 📽️ 설명회 자료 만들기를 Claude Code·Cowork 에서.
//
// 분석·슬라이드·PPT 엔진은 웹과 같은 파일(frontend/src/seminar/*.js)을 그대로 묶어 넣는다(build.mjs) — 결과물이 웹과 똑같다.
// 데이터:
//   · 학교 성취도 = 입시파인더 공개 정적 파일(school-catalog·school-bands, 하루 캐시)
//   · 공통본·학원 소개·담당 학교 묶음·공유 링크 = 입시파인더 서버 API (학원 코드로 로그인, 웹과 같은 메뉴 잠금)
// 학원 코드는 사용자 폴더 ~/.seminar-deck/config.json 에만 둔다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { analyzeSchools, factsForAI, SUBJECTS, shortName } from '../../../frontend/src/seminar/analysis.js';
import { buildSlides, numberSlides, buildTitleSlide, buildContents, buildClosing } from '../../../frontend/src/seminar/deckModel.js';
import { buildCommonSlides, renderCommonSlide } from '../../../frontend/src/seminar/commonSlides.js';
import { downloadPptx } from '../../../frontend/src/seminar/pptx.js';

const VERSION = '0.1.0';
const API = (process.env.EF_API || 'https://entrance-finder-production.up.railway.app').replace(/\/+$/, '');
const WEB = (process.env.EF_WEB || 'https://entrance-finder.vercel.app').replace(/\/+$/, '');
const HOME = path.join(os.homedir(), '.seminar-deck');
const CONFIG = path.join(HOME, 'config.json');
const CACHE = path.join(HOME, 'cache');
const DEFAULT_OUT = path.join(os.homedir(), 'Documents', '설명회자료');
fs.mkdirSync(CACHE, { recursive: true });

// ── 설정(학원 코드·브랜드) ─────────────────────────────────────────────
const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch { return {}; } };
const writeConfig = (c) => { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2), 'utf8'); };

// ── 입시파인더 API ─────────────────────────────────────────────────────
let session = null; // { token, role, name }
async function login(code) {
  const res = await fetch(`${API}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, password: code }) });
  const j = await res.json().catch(() => ({}));
  if (!j.success || !j.token) throw new Error(j.message || '학원 코드가 맞지 않습니다');
  session = { token: j.token, role: j.role, name: j.name };
  return session;
}
async function ensureSession() {
  if (session) return session;
  const code = process.env.EF_CODE || readConfig().code;
  if (!code) throw new Error('아직 학원 코드가 없습니다. seminar_login 에 입시파인더 학원 코드를 넣어 주세요.');
  return login(code);
}
async function api(p, { method = 'GET', body } = {}, retry = true) {
  const s = await ensureSession();
  const res = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${s.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && retry) { session = null; return api(p, { method, body }, false); }
  const j = await res.json().catch(() => ({ success: false, message: `서버 응답 오류 (HTTP ${res.status})` }));
  if (res.status === 403) throw new Error(j.message || '이 학원 코드에는 설명회 메뉴가 열려 있지 않습니다. 입시파인더 관리자에게 열어 달라고 하세요.');
  if (!j.success) throw new Error(j.message || `요청 실패 (HTTP ${res.status})`);
  return j;
}
async function seminarAllowed() {
  const s = await ensureSession();
  if (s.role === 'admin') return true;
  const r = await api('/api/me/menus');
  return Array.isArray(r.menus) && r.menus.includes('seminar'); // optIn 메뉴 — 직접 열어 준 코드만
}

// ── 학교 데이터(공개 정적 파일, 하루 캐시) ─────────────────────────────
async function gzJson(rel) {
  const file = path.join(CACHE, rel.replace(/[\\/]/g, '__'));
  try { const st = fs.statSync(file); if (Date.now() - st.mtimeMs < 24 * 3600e3) return JSON.parse(zlib.gunzipSync(fs.readFileSync(file))); } catch { /* 없음 */ }
  const res = await fetch(`${WEB}/data/${rel}`);
  if (!res.ok) throw new Error(`학교 데이터를 받지 못했습니다 (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? buf : zlib.gzipSync(buf);
  fs.writeFileSync(file, raw);
  return JSON.parse(zlib.gunzipSync(raw));
}
let catalogP = null;
const catalog = () => (catalogP ||= gzJson('school-catalog.json.gz').then((c) => (c.schools || []).filter((s) => s.schoolLevel === '고등학교')).catch((e) => { catalogP = null; throw e; }));
const region = (s) => [s.sido, s.sigungu].filter(Boolean).join(' ');
async function withBands(list) {
  const files = {};
  for (const f of [...new Set(list.map((s) => s.bandsFile).filter(Boolean))]) files[f] = await gzJson(f);
  return list.map((s) => ({ ...s, bands: (s.bandsFile && files[s.bandsFile]?.[s.id]) || s.bands || [] }));
}
// 이름(줄임말 OK)·지역으로 찾기 — 같은 이름이 여러 곳이면 region 으로 좁힌다
async function matchNames(names, regionHint) {
  const cat = await catalog();
  const found = [], missing = [], ambiguous = [];
  for (const raw of names || []) {
    const n = String(raw).trim().replace(/\s+/g, '');
    if (!n) continue;
    let list = cat.filter((s) => s.schoolName === n || shortName(s.schoolName) === n || s.schoolName === `${n}등학교`);
    if (regionHint) list = list.filter((s) => region(s).includes(regionHint));
    if (list.length === 1) found.push(list[0]);
    else if (!list.length) missing.push(raw);
    else ambiguous.push({ name: raw, candidates: list.slice(0, 6).map((s) => `${s.schoolName}(${region(s)}) id=${s.id}`) });
  }
  return { found, missing, ambiguous };
}
async function schoolsByIds(ids) {
  const cat = await catalog();
  const byId = new Map(cat.map((s) => [String(s.id), s]));
  const list = (ids || []).map((id) => byId.get(String(id))).filter(Boolean);
  if (!list.length) throw new Error('학교를 찾지 못했습니다. find_schools 로 id 를 확인하세요.');
  return list;
}

// ── 덱 만들기(웹 DeckBuilder 와 같은 순서) ─────────────────────────────
const DEFAULT_OPTS = { part: 1, title: '일반고 선택의 기준', region: '', startPage: 1, semester: 'avg', includeCover: true, includeCommon: false, commonChapters: null,
  includeTitle: true, coverKicker: '대학입시, 미리 알고 준비하자!', coverTitle: '', coverPlace: '', coverDate: '', includeContents: true, includeAcademy: false, includeClosing: true };

// 로고 가로:세로 — PNG/JPEG 머리에서 크기만 읽는다(이미지 라이브러리 없이)
function imageRatio(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return buf.readUInt32BE(16) / buf.readUInt32BE(20);
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return buf.readUInt16BE(i + 7) / buf.readUInt16BE(i + 5);
      i += 2 + len;
    }
  }
  return 1;
}
function readBrand() {
  const c = readConfig();
  const b = { name: c.brandName || '', sub: '' };
  if (c.logoPath) {
    try {
      const buf = fs.readFileSync(c.logoPath);
      const ext = path.extname(c.logoPath).slice(1).toLowerCase().replace('jpg', 'jpeg');
      b.logo = `data:image/${ext || 'png'};base64,${buf.toString('base64')}`;
      b.logoRatio = c.logoRatio || 1;
    } catch { /* 로고 파일 없음 */ }
  }
  return b;
}

async function composeDeck({ deckId, schoolIds, options = {}, notes = {}, title }) {
  let deck = { title: title || '설명회 자료', school_ids: schoolIds || [], options: {}, notes: notes || {} };
  if (deckId) {
    const r = await api(`/api/seminar/decks/${deckId}`);
    deck = { title: title || r.item.title, school_ids: schoolIds?.length ? schoolIds : r.item.school_ids, options: r.item.options || {}, notes: { ...(r.item.notes || {}), ...(notes || {}) } };
  }
  const opts = { ...DEFAULT_OPTS, ...deck.options, ...options };
  const schools = deck.school_ids?.length ? await withBands(await schoolsByIds(deck.school_ids)) : [];
  const analysis = schools.length ? analyzeSchools(schools, { semester: opts.semester === 'avg' ? 'avg' : Number(opts.semester) }) : null;
  const regions = [...new Set(schools.map((s) => s.sigungu || s.sido))];
  const autoRegion = regions.length === 1 ? regions[0].replace(/시$|군$|구$/, '') : regions.length ? '우리 지역' : '';

  let common = null, academy = null;
  if (opts.includeCommon) { const r = await api('/api/seminar/common/published'); common = r.item; if (!common) throw new Error('발행된 공통본이 없습니다. include_common 을 빼거나 관리자가 공통본을 발행해야 합니다.'); }
  if (opts.includeAcademy || opts.includeClosing) { const r = await api('/api/seminar/academy').catch(() => null); academy = r?.item || null; }

  const commonChNums = common ? [...new Set(common.slides.map((s) => Number(s.chapter)))].sort((a, b) => a - b) : [];
  const chs = Array.isArray(opts.commonChapters) ? opts.commonChapters : commonChNums;
  if (common && Number(opts.part) <= Math.max(0, ...chs) && !options.part) opts.part = Math.max(...chs) + 1;
  const commonSlides = common ? buildCommonSlides({ ...common, slides: common.slides.filter((s) => chs.includes(Number(s.chapter))) }) : [];
  const school = analysis ? buildSlides({ ...opts, region: opts.region || autoRegion, notes: deck.notes }, analysis) : [];
  const academyPart = Number(opts.part) + 1;
  const acad = opts.includeAcademy && academy ? (academy.slides || []).map((s) => ({ key: `academy:${s.id}`, title: `학원 소개 · ${s.heading || s.data?.title || ''}`, els: renderCommonSlide({ ...s, chapter: academyPart }, { [academyPart]: academy.title }) })) : [];
  const brand = readBrand();
  if (!brand.name && academy?.title) brand.name = academy.title.replace(/\s*소개$/, '');
  const parts = [
    ...(commonSlides.length ? chs.map((c) => ({ no: c, title: common.chapters?.[c] || '' })) : []),
    ...(school.length ? [{ no: opts.part, title: opts.title }] : []),
    ...(acad.length ? [{ no: academyPart, title: academy.title }] : []),
  ];
  const head = [...(opts.includeTitle ? [buildTitleSlide(opts, brand)] : []), ...(opts.includeContents && parts.length > 1 ? [buildContents(parts)] : [])];
  const tail = opts.includeClosing && (school.length || acad.length || commonSlides.length) ? buildClosing(academy?.info || {}, brand, opts) : [];
  const slides = numberSlides([...head, ...commonSlides, ...school, ...acad, ...tail], opts.startPage);
  return { deck, opts, slides, analysis, brand, parts };
}

// ── MCP ────────────────────────────────────────────────────────────────
const server = new McpServer({ name: 'seminar-deck', version: VERSION }, {
  instructions: `[설명회 자료 MCP — 입시파인더 📽️ 설명회 자료 만들기]
흐름: seminar_status → (코드 없으면 seminar_login) → 담당 학교 고르기(find_schools · region_schools) → analyze_schools 로 분석 확인 →
(선택) 학교마다 해설 문구를 직접 써서 notes 로 → save_deck 으로 웹에 저장 → build_pptx 로 PPT 파일 → (선택) share_link 로 학부모님 공유 링크.
규칙: 숫자·분류는 analyze_schools 결과 그대로(바꾸지 말 것). notes 문구는 그 수치에 근거해서만, 학교를 깎아내리지 말고(하위권 많으면 '기초 보완이 중요'), 과장·보장 금지, 학부모님 호칭.
슬라이드 순서: 표지 → 목차 → ① 제도 설명 공통본(include_common) → ② 학교별 분석 → ③ 학원 소개(include_academy) → Q&A·감사.
이 학원 코드에 설명회 메뉴가 안 열려 있으면 403 이 난다 — 입시파인더 관리자(원장)에게 열어 달라고 안내한다.`,
});
const out = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ ...out({ ok: false, error: e instanceof Error ? e.message : String(e) }), isError: true });
const tool = (name, desc, schema, fn) => server.tool(name, desc, schema, async (args) => { try { return out(await fn(args || {})); } catch (e) { return fail(e); } });

const optsSchema = z.object({
  part: z.number().optional().describe('학교별 분석 파트 번호(공통본을 넣으면 자동으로 공통본 다음 번호)'),
  title: z.string().optional().describe('학교별 분석 파트 제목(기본: 일반고 선택의 기준)'),
  region: z.string().optional().describe('지역 이름(기본: 학교들의 시군구)'),
  startPage: z.number().optional(), semester: z.union([z.literal('avg'), z.literal(1), z.literal(2)]).optional().describe("'avg'=1·2학기 평균"),
  includeCover: z.boolean().optional().describe('학교별 파트 표지'),
  includeTitle: z.boolean().optional(), coverKicker: z.string().optional(), coverTitle: z.string().optional(), coverPlace: z.string().optional(), coverDate: z.string().optional(),
  includeContents: z.boolean().optional(), includeCommon: z.boolean().optional().describe('① 제도 설명 공통본(발행본) 넣기'),
  commonChapters: z.array(z.number()).optional(), includeAcademy: z.boolean().optional().describe('③ 우리 학원 소개 넣기'), includeClosing: z.boolean().optional(),
}).partial();
const noteSchema = z.record(z.string(), z.object({
  subjects: z.record(z.string(), z.string()).optional().describe('과목별 한 줄(국어·수학·영어·한국사·통합사회·통합과학)'),
  strong: z.string().nullable().optional(), weak: z.string().nullable().optional(), typeLine: z.string().optional(),
})).describe('학교 id → 슬라이드 문구(없으면 규칙 문구)');

tool('seminar_status', '로그인·메뉴 상태, 발행된 공통본, 학원 소개, 저장된 설명회 자료 목록, 브랜드·저장 폴더를 확인한다. 작업 시작 전에 먼저 부른다.', {}, async () => {
  const c = readConfig();
  if (!process.env.EF_CODE && !c.code) return { loggedIn: false, next: 'seminar_login 에 입시파인더 학원 코드를 넣어 주세요.' };
  const s = await ensureSession();
  const allowed = await seminarAllowed();
  if (!allowed) return { loggedIn: true, name: s.name, seminarMenu: false, next: '이 학원 코드에는 설명회 메뉴가 열려 있지 않습니다. 입시파인더 관리자에게 열어 달라고 하세요.' };
  const [decks, common, academy] = await Promise.all([api('/api/seminar/decks'), api('/api/seminar/common/published'), api('/api/seminar/academy').catch(() => null)]);
  return {
    loggedIn: true, name: s.name, role: s.role, seminarMenu: true,
    publishedCommon: common.item ? `${common.item.title} (${common.item.slides.length}장)` : '없음',
    academy: academy?.item ? `${academy.item.title} (${(academy.item.slides || []).length}장${academy.seeded ? ', 아직 저장 전 처음 모양' : ''})` : '없음',
    savedDecks: (decks.items || []).map((d) => ({ id: d.id, title: d.title, schools: (d.school_ids || []).length })),
    brand: { name: c.brandName || '(없음 — set_brand)', logo: c.logoPath || '(없음)' },
    outputFolder: c.outDir || DEFAULT_OUT, web: WEB,
  };
});

tool('seminar_login', '입시파인더 학원 코드로 로그인하고 이 컴퓨터에 저장한다(~/.seminar-deck/config.json).', { code: z.string().describe('입시파인더 학원 코드') }, async ({ code }) => {
  const s = await login(code.trim());
  writeConfig({ ...readConfig(), code: code.trim() });
  const allowed = await seminarAllowed();
  return { ok: true, name: s.name, role: s.role, seminarMenu: allowed, note: allowed ? '설명회 자료를 만들 수 있습니다.' : '로그인은 됐지만 설명회 메뉴가 아직 안 열렸습니다. 입시파인더 관리자에게 요청하세요.' };
});

tool('set_brand', '표지·감사 슬라이드에 들어갈 학원 이름·로고, PPT 저장 폴더를 정한다(이 컴퓨터에 저장).', {
  name: z.string().optional(), logo_path: z.string().optional().describe('로고 이미지 파일 경로(png/jpg)'), out_dir: z.string().optional().describe('PPT 저장 폴더'),
}, async ({ name, logo_path, out_dir }) => {
  const c = readConfig();
  if (name !== undefined) c.brandName = name;
  if (logo_path) { if (!fs.existsSync(logo_path)) throw new Error(`로고 파일이 없습니다: ${logo_path}`); c.logoPath = path.resolve(logo_path); c.logoRatio = imageRatio(fs.readFileSync(c.logoPath)) || 1; }
  if (out_dir) c.outDir = path.resolve(out_dir);
  writeConfig(c);
  return { ok: true, brandName: c.brandName, logoPath: c.logoPath, outDir: c.outDir || DEFAULT_OUT };
});

tool('find_schools', '고등학교를 이름(줄임말 OK: 부천여고·상동고)으로 찾는다. 여러 지역에 같은 이름이 있으면 region 으로 좁힌다.', {
  names: z.array(z.string()), region: z.string().optional().describe('예: 부천, 경기도 부천시'),
}, async ({ names, region: rh }) => {
  const { found, missing, ambiguous } = await matchNames(names, rh);
  return { found: found.map((s) => ({ id: s.id, name: s.schoolName, region: region(s), type: s.schoolType })), missing, ambiguous };
});

tool('region_schools', '한 지역의 고등학교 목록(기본 일반고). 담당 지역 전체를 넣을 때.', {
  sido: z.string().describe('예: 경기도'), sigungu: z.string().optional().describe('예: 부천시'), type: z.string().optional().describe("기본 '일반고등학교', 'all' = 전부"),
}, async ({ sido, sigungu, type }) => {
  const cat = await catalog();
  const list = cat.filter((s) => (s.sido || '').includes(sido) && (!sigungu || (s.sigungu || '').includes(sigungu)) && (type === 'all' || s.schoolType === (type || '일반고등학교')));
  return { count: list.length, schools: list.map((s) => ({ id: s.id, name: s.schoolName, region: region(s), type: s.schoolType })) };
});

tool('analyze_schools', '고른 학교들의 1학년 성취도(A~E)를 서로 비교 분석한다 — 학교마다 최신 공시 학년도, 과목별 평균·분포·규칙 해설, 유형 한 줄, 강점·보완 과목, 성취도 층, 과목별 강세 학교. 해설 문구(notes)를 쓰기 전에 본다.', {
  school_ids: z.array(z.string()), semester: z.union([z.literal('avg'), z.literal(1), z.literal(2)]).optional(),
}, async ({ school_ids, semester }) => {
  const schools = await withBands(await schoolsByIds(school_ids));
  const a = analyzeSchools(schools, { semester: semester === undefined || semester === 'avg' ? 'avg' : Number(semester) });
  const nameOf = (id) => a.usable.find((x) => x.id === id)?.short;
  return {
    schools: a.usable.map((it) => ({
      id: it.id, name: it.name, year: it.year, tier: { top: '상위권', mid: '중위권', low: '기초 보완' }[it.tier], typeLine: it.typeLine,
      strong: it.message.strong, weak: it.message.weak,
      subjects: SUBJECTS.filter((x) => it.rows[x.key]).map((x) => { const m = it.rows[x.key]; return { subject: x.key, mean: m.mean, A: m.a, B: m.b, C: m.c, D: m.d, E: m.e, ruleNote: m.note }; }),
    })),
    skipped: a.items.filter((x) => !a.usable.includes(x)).map((x) => `${x.name}(성취도 공시 없음)`),
    strongBySubject: Object.fromEntries(Object.entries(a.strong).map(([k, ids]) => [k, ids.map(nameOf)])),
    factsForNotes: factsForAI(a),
  };
});

tool('list_decks', '입시파인더에 저장된 설명회 자료(담당 학교 묶음) 목록.', {}, async () => {
  const r = await api('/api/seminar/decks');
  return (r.items || []).map((d) => ({ id: d.id, title: d.title, schools: (d.school_ids || []).length, updated: d.updated_at }));
});
tool('get_deck', '저장된 설명회 자료 하나(담당 학교 id·설정·문구).', { id: z.number() }, async ({ id }) => {
  const r = await api(`/api/seminar/decks/${id}`);
  const cat = await catalog(); const byId = new Map(cat.map((s) => [String(s.id), s]));
  return { ...r.item, schools: (r.item.school_ids || []).map((x) => byId.get(String(x))?.schoolName || x) };
});
tool('save_deck', '설명회 자료를 입시파인더에 저장한다(웹 화면에서도 같은 자료로 열린다). id 가 있으면 고치고, 없으면 새로 만든다.', {
  id: z.number().optional(), title: z.string(), school_ids: z.array(z.string()), options: optsSchema.optional(), notes: noteSchema.optional(),
}, async ({ id, title, school_ids, options, notes }) => {
  let base = { options: {}, notes: {} };
  if (id) base = (await api(`/api/seminar/decks/${id}`)).item;
  const body = { title, school_ids, options: { ...DEFAULT_OPTS, ...(base.options || {}), ...(options || {}) }, notes: { ...(base.notes || {}), ...(notes || {}) } };
  const r = id ? await api(`/api/seminar/decks/${id}`, { method: 'PUT', body }) : await api('/api/seminar/decks', { method: 'POST', body });
  return { ok: true, id: r.item.id, title: r.item.title, web: `${WEB} → 📽️ 설명회 자료 만들기 → 저장된 자료` };
});

tool('build_pptx', '설명회 PPT 파일을 만든다(표·차트는 파워포인트에서 고칠 수 있는 진짜 표·차트). deck_id(저장된 자료) 또는 school_ids 로. 파일 경로와 슬라이드 목록을 돌려준다.', {
  deck_id: z.number().optional(), school_ids: z.array(z.string()).optional(), title: z.string().optional(),
  options: optsSchema.optional(), notes: noteSchema.optional(), out_dir: z.string().optional(), file_name: z.string().optional(),
}, async ({ deck_id, school_ids, title, options, notes, out_dir, file_name }) => {
  if (!(await seminarAllowed())) throw new Error('이 학원 코드에는 설명회 메뉴가 열려 있지 않습니다.');
  const { deck, slides, parts } = await composeDeck({ deckId: deck_id, schoolIds: school_ids, options, notes, title });
  if (!slides.length) throw new Error('만들 슬라이드가 없습니다 — 담당 학교를 넣거나 include_common / include_academy 를 켜세요.');
  const dir = path.resolve(out_dir || readConfig().outDir || DEFAULT_OUT);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${(file_name || deck.title || '설명회 자료').replace(/[\\/:*?"<>|]/g, '_').replace(/\.pptx$/i, '')}.pptx`;
  const full = path.join(dir, name);
  const cwd = process.cwd();
  try { process.chdir(dir); await downloadPptx(slides, { fileName: name, title: deck.title }); } finally { process.chdir(cwd); }
  return { ok: true, file: full, slides: slides.length, parts, outline: slides.map((s, i) => `${i + 1}. ${s.title}`) };
});

tool('share_link', '학부모님께 보낼 공유 링크를 만든다 — 그 순간의 슬라이드를 로그인 없이 휴대폰에서 볼 수 있다. build_pptx 와 같은 인자.', {
  deck_id: z.number().optional(), school_ids: z.array(z.string()).optional(), title: z.string().optional(), options: optsSchema.optional(), notes: noteSchema.optional(),
}, async ({ deck_id, school_ids, title, options, notes }) => {
  const { deck, slides, brand } = await composeDeck({ deckId: deck_id, schoolIds: school_ids, options, notes, title });
  if (!slides.length) throw new Error('공유할 슬라이드가 없습니다.');
  const r = await api('/api/seminar/shares', { method: 'POST', body: { title: deck.title, academy: brand.name, slides: slides.map(({ title: t, els }) => ({ title: t, els })) } });
  return { ok: true, url: `${WEB}/deck/${r.token}`, slides: slides.length };
});

await server.connect(new StdioServerTransport());
