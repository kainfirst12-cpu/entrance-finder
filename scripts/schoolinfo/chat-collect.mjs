// 채팅으로 보안문자 받아 치는 수집기 — 브라우저 없이 Node 만으로 학교알리미 공시항목 44 를 받는다.
//   (세션 컨테이너에서 www.schoolinfo.go.kr 로 나갈 수 있어야 한다. 막혀 있으면 probe 가 그렇게 알려 준다.)
//
//   node chat-collect.mjs probe   <uuid>        공시 팝업+44 fragment 를 받아 out/probe/ 에 저장하고 폼·이미지·입력칸을 훑어 준다
//   node chat-collect.mjs captcha <uuid> <이름>  보안문자 이미지를 out/captcha.png 로 받고 대기 상태를 out/chat-session.json 에 저장
//   node chat-collect.mjs answer  <숫자>         받은 숫자로 제출 → 표가 오면 out/achievement-raw/<id>.json 저장
//   node chat-collect.mjs selftest              표 파싱(rowspan/colspan 펼치기)만 오프라인 점검
//
// 쿠키는 out/chat-session.json 에 들고 다닌다(파일 하나에 쿠키+대기 학교). 응답은 euc-kr.
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = path.join(here, 'out');
const STATE = path.join(OUT, 'chat-session.json');
const BASE = 'https://www.schoolinfo.go.kr';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

const loadState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { cookies: {}, pending: null });
const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 1), 'utf8');

function cookieHeader(st) { return Object.entries(st.cookies).map(([k, v]) => `${k}=${v}`).join('; '); }
function takeCookies(st, res) {
  for (const line of res.headers.getSetCookie?.() || []) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) st.cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
}

// 학교알리미는 euc-kr 로 답한다 — res.text() 로 읽으면 깨진다.
async function req(st, url, { method = 'GET', form = null, referer = null, binary = false } = {}) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };
  if (Object.keys(st.cookies).length) headers.Cookie = cookieHeader(st);
  if (referer) headers.Referer = referer;
  let body;
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=euc-kr'; body = encodeForm(form); }
  const res = await fetch(url.startsWith('http') ? url : BASE + url, { method, headers, body, redirect: 'follow' });
  takeCookies(st, res);
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, type: res.headers.get('content-type') || '', buf, text: binary ? null : new TextDecoder('euc-kr').decode(buf) };
}

// euc-kr 폼 인코딩 — 한글 값(학교명)이 들어가므로 %XX 를 직접 만든다.
function encodeForm(obj) {
  const enc = (s) => {
    const str = String(s ?? '');
    if (/^[\x20-\x7e]*$/.test(str)) return encodeURIComponent(str);
    let out = '';
    for (const ch of str) {
      if (/[A-Za-z0-9\-_.~]/.test(ch)) { out += ch; continue; }
      const b = eucKrBytes(ch);
      out += b ? b.map((x) => '%' + x.toString(16).toUpperCase().padStart(2, '0')).join('') : encodeURIComponent(ch);
    }
    return out;
  };
  return Object.entries(obj).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
}
// 한 글자를 euc-kr 바이트로 — Node 에 euc-kr 인코더가 없어서, 디코더로 역표를 한 번 만들어 쓴다.
let EUC = null;
function eucKrBytes(ch) {
  if (!EUC) {
    EUC = new Map();
    const dec = new TextDecoder('euc-kr');
    for (let hi = 0x81; hi <= 0xfe; hi++) {
      for (let lo = 0x41; lo <= 0xfe; lo++) {
        const s = dec.decode(new Uint8Array([hi, lo]));
        if (s.length === 1 && s !== '�' && !EUC.has(s)) EUC.set(s, [hi, lo]);
      }
    }
  }
  if (ch.charCodeAt(0) < 0x80) return [ch.charCodeAt(0)];
  return EUC.get(ch) || null;
}

const FRAG = '/ei/pp/Pneipp_b44_s0p.do';
const POPUP = (id) => `/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=${id}`;
// captcha-runner.js 가 쓰는 그 파라미터 그대로(공시항목 44 = 교과별 학업성취 사항)
const fragParams = (school, year) => ({
  GS_HANGMOK_CD: '44', GS_HANGMOK_NO: '4-나', GS_HANGMOK_NM: '교과별 학업성취 사항',
  GS_BURYU_CD: 'JG220', JG_BURYU_CD: 'JG040', JG_HANGMOK_CD: '15', JG_GUBUN: '1',
  JG_YEAR2: String(year), HG_NM: school.name, SHL_IDF_CD: school.id, GS_TYPE: 'Y', JG_YEAR: String(year),
  SORT: 'BR', CHOSEN_JG_YEAR: String(year), PRE_JG_YEAR: String(year), LOAD_TYPE: 'single',
});

// ---- HTML 훑기(의존성 없이) ----
const attrs = (tag) => {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
};
const strip = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

export function tables(html) {
  const out = [];
  const re = /<table\b[\s\S]*?<\/table>/gi;
  for (const m of html.matchAll(re)) out.push(m[0]);
  return out;
}

// captcha-runner 의 gridOf 와 같은 일 — rowspan/colspan 을 펼쳐 셀 격자로 만든다.
export function gridOf(tableHtml) {
  const grid = [];
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  rows.forEach((tr, ri) => {
    grid[ri] = grid[ri] || [];
    let ci = 0;
    for (const cm of tr.matchAll(/<(t[dh])\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
      const a = attrs('<x ' + cm[2] + '>');
      const txt = strip(cm[3]);
      const rs = Number(a.rowspan || 1) || 1, cs = Number(a.colspan || 1) || 1;
      while (grid[ri][ci] !== undefined) ci++;
      for (let r = 0; r < rs; r++) { grid[ri + r] = grid[ri + r] || []; for (let c = 0; c < cs; c++) grid[ri + r][ci + c] = txt; }
      ci += cs;
    }
  });
  return grid;
}

// 표 → captcha-runner 가 만들던 레코드와 같은 모양
export function recordFrom(html, school, chasu = null) {
  const grades = {};
  tables(html).forEach((t, k) => {
    const g = gridOf(t);
    const gradeCell = (g[1] || []).find((x) => /^\d학년$/.test(x || ''));
    grades[gradeCell ? parseInt(gradeCell, 10) : 't' + k] = { year: (g[0] || [])[0] || null, rows: g.slice(4).filter((r) => r.length >= 3) };
  });
  return { id: school.id, name: school.name, capturedAt: new Date().toISOString(), chasu, grades };
}

async function cmdProbe(id) {
  const st = loadState();
  const dir = path.join(OUT, 'probe'); fs.mkdirSync(dir, { recursive: true });
  const school = { id, name: (nameOf(id) || '학교') };
  const p1 = await req(st, POPUP(id));
  fs.writeFileSync(path.join(dir, 'popup.html'), p1.text, 'utf8');
  const p2 = await req(st, FRAG, { method: 'POST', form: fragParams(school, new Date().getFullYear()), referer: BASE + POPUP(id) });
  fs.writeFileSync(path.join(dir, 'frag.html'), p2.text, 'utf8');
  saveState(st);
  console.log(`popup ${p1.status} ${p1.buf.length}B · frag ${p2.status} ${p2.buf.length}B · 쿠키 ${Object.keys(st.cookies).join(',') || '없음'}`);
  for (const [label, re] of [['form', /<form\b[^>]*>/gi], ['input', /<input\b[^>]*>/gi], ['img', /<img\b[^>]*>/gi], ['script src', /<script\b[^>]*src=[^>]*>/gi]]) {
    for (const m of p2.text.matchAll(re)) console.log(`  ${label}: ${m[0].slice(0, 200)}`);
  }
  const fns = [...p2.text.matchAll(/function\s+(\w+)\s*\(([^)]*)\)/g)].map((m) => m[1]);
  if (fns.length) console.log('  script 함수:', fns.join(', '));
  console.log('  표', tables(p2.text).length, '개 · 본문 앞머리:', strip(p2.text).slice(0, 160));
}

function nameOf(id) {
  const f = path.join(OUT, 'school-list.json');
  if (!fs.existsSync(f)) return null;
  const { schools } = JSON.parse(fs.readFileSync(f, 'utf8'));
  return schools.find((s) => s.shlIdfCd === id)?.schoolName || null;
}

async function cmdCaptcha(id, name) {
  const st = loadState();
  const school = { id, name: name || nameOf(id) || '학교' };
  const year = new Date().getFullYear();
  await req(st, POPUP(id));
  const frag = await req(st, FRAG, { method: 'POST', form: fragParams(school, year), referer: BASE + POPUP(id) });
  const imgs = [...frag.text.matchAll(/<img\b[^>]*>/gi)].map((m) => attrs(m[0])).filter((a) => /captcha|pass|secur|image/i.test(a.src || '') || /보안/.test(a.alt || ''));
  st.pending = { school, year, fragHtml: null, captchaSrc: imgs[0]?.src || null };
  if (!imgs.length) {
    // 보안문자 없이 바로 표가 오는 경우(공시제외 안내 포함)
    fs.writeFileSync(path.join(OUT, 'probe-frag.html'), frag.text, 'utf8');
    saveState(st);
    console.log('보안문자 이미지 없음 — out/probe-frag.html 확인 (공시제외 안내이거나 구조가 바뀜)');
    return;
  }
  const img = await req(st, imgs[0].src, { referer: BASE + POPUP(id), binary: true });
  const file = path.join(OUT, 'captcha.png');
  fs.writeFileSync(file, img.buf);
  st.pending.inputs = formFields(frag.text);
  saveState(st);
  console.log(`${school.name} 보안문자 → ${file} (${img.buf.length}B, ${img.type})`);
}

function formFields(html) {
  const out = {};
  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (a.name) out[a.name] = a.value ?? '';
  }
  return out;
}

async function cmdAnswer(code) {
  const st = loadState();
  if (!st.pending) { console.error('대기 중인 학교가 없다 — 먼저 captcha 를 돌려라'); process.exit(1); }
  const { school, year, inputs } = st.pending;
  const capKey = Object.keys(inputs || {}).find((k) => /pass|captcha|secur/i.test(k)) || 'passLine44';
  const form = { ...fragParams(school, year), ...inputs, [capKey]: code };
  const res = await req(st, FRAG, { method: 'POST', form, referer: BASE + POPUP(school.id) });
  const txt = strip(res.text);
  if (/공시제외|자료가 없/.test(txt)) { console.log(`공시제외: ${school.name}`); st.pending = null; saveState(st); return; }
  if (!tables(res.text).length || !/학업성취/.test(txt)) {
    fs.writeFileSync(path.join(OUT, 'answer-last.html'), res.text, 'utf8');
    console.log('표가 오지 않았다(보안문자 틀렸거나 구조가 다름) — out/answer-last.html 확인');
    return;
  }
  const chasu = (res.text.match(/id="select_trans_dt"[^>]*value="([^"]*)"/) || [])[1] || null;
  const rec = recordFrom(res.text, school, chasu);
  const rows = Object.values(rec.grades).reduce((n, g) => n + g.rows.length, 0);
  fs.mkdirSync(path.join(OUT, 'achievement-raw'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'achievement-raw', `${school.id}.json`), JSON.stringify(rec), 'utf8');
  st.pending = null; saveState(st);
  console.log(`저장: ${school.name} — 학년 ${Object.keys(rec.grades).join(',')} · 표 ${rows}줄`);
}

function selftest() {
  // achievement-raw 에 쌓인 표와 같은 모양의 HTML 을 만들어 격자 펼치기를 확인한다
  const html = `<table><tr><td colspan="14">2025학년도</td></tr>`
    + `<tr><td rowspan="2">계열(학과)</td><td rowspan="2">과 목</td><td colspan="6">1학년 1학기</td><td colspan="6">2학기</td></tr>`
    + `<tr><td>평균</td><td>A</td><td>B</td><td>C</td><td>D</td><td>E</td><td>평균</td><td>A</td><td>B</td><td>C</td><td>D</td><td>E</td></tr>`
    + `<tr><td colspan="14">&nbsp;</td></tr>`
    + `<tr><td>전체계열 / 전체학과</td><td>공통국어1 (4)</td><td>70.3</td><td>15.6</td><td>21.0</td><td>19.1</td><td>15.2</td><td>29.2</td><td></td><td></td><td></td><td></td><td></td><td></td></tr></table>`;
  const rec = recordFrom(html, { id: 'x', name: '점검고' });
  const g = rec.grades['1'] || rec.grades.t0;
  const row = g.rows[0];
  const ok = g.year === '2025학년도' && row[0] === '전체계열 / 전체학과' && row[1] === '공통국어1 (4)' && row[2] === '70.3' && row[7] === '29.2' && row.length === 14;
  console.log(ok ? 'selftest OK' : 'selftest FAIL: ' + JSON.stringify(g));
  if (!ok) process.exit(1);
}

export { encodeForm, formFields, selftest };

// 직접 실행할 때만 CLI 로 동작한다(다른 스크립트에서 import 해도 안전하게)
if (process.argv[1] && /chat-collect\.mjs$/.test(process.argv[1])) {
  const [cmd, ...rest] = process.argv.slice(2);
  const run = {
    probe: () => cmdProbe(rest[0]),
    captcha: () => cmdCaptcha(rest[0], rest[1]),
    answer: () => cmdAnswer(rest[0]),
    selftest: async () => selftest(),
  }[cmd];
  if (!run) { console.error('사용: node chat-collect.mjs probe|captcha|answer|selftest …'); process.exit(1); }
  run().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
}
