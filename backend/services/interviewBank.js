// services/interviewBank.js — 대학 공식 공개 대학별고사(면접·논술) 기출 은행
//
// 출처는 대학이 법에 따라 공개하는 '선행학습 영향평가 자체평가보고서'(울산진로진학지원센터 대입자료실에
// 대학별로 모여 있다)뿐이다. 사설 후기 모음·'상업적 이용 불가' 자료는 넣지 않는다.
// 수집·추출 파이프라인은 저장소 밖(C:\tmp\interview-bank)에 있고, 결과만 data/interview-bank/questions.json 으로 들어온다.
//   { generatedAt, sources: [{ name, year, url }], items: [{ id, u, univ, y, dept, track, type, subj, q, psg, intent, fu, ev, src, pg,
//       k?: '논술'(없으면 면접), ef?: 논술 계열, cur?: [{ s: 과목, c: 성취기준 코드, t: 성취기준 문장 }], un?: [교과서 단원], tb?: [{ t: 도서명, p: 출판사, pg: 쪽 }] }] }
// 논술 문항·교육과정 근거(cur·un·tb)는 2026-11-10 문항카드 추출(scripts/interview-bank/merge-cards.mjs)로 들어왔다.
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { findUniv } from './interviewStore.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'interview-bank', 'questions.json');

let _bank = null;
function bank() {
  if (_bank) return _bank;
  try { _bank = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { items: [], sources: [] }; }
  catch { _bank = { items: [], sources: [] }; }
  _bank.items = _bank.items || []; _bank.sources = _bank.sources || [];
  return _bank;
}

const kindOf = (it) => (it.k === '논술' ? '논술' : '면접');
const ofKind = (list, kind) => (kind === '논술' || kind === '면접' ? list.filter((it) => kindOf(it) === kind) : list);
const squash = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const words = (s) => (String(s || '').match(/[가-힣A-Za-z]{2,}/g) || []).map((w) => w.replace(/(학과|학부|전공|계열|대학)$/, '')).filter((w) => w.length >= 2);

// 화면·API 로 내보낼 모양 (출처 이름·링크를 풀어 준다)
function view(it) {
  const s = bank().sources[it.src] || {};
  return { ...it, source: { name: s.name || '', year: s.year || '', url: s.url || '', page: it.pg || null } };
}

export function getBankItem(id) {
  const it = bank().items.find((x) => x.id === id);
  return it ? view(it) : null;
}

export function bankStats() {
  const b = bank();
  const per = (kind) => { const l = ofKind(b.items, kind); return { total: l.length, univs: new Set(l.map((i) => i.univ)).size }; };
  return { total: b.items.length, univs: new Set(b.items.map((i) => i.univ)).size, generatedAt: b.generatedAt || null,
    interview: per('면접'), essay: per('논술'), withBasis: b.items.filter((i) => i.cur?.length).length };
}

// 대학 목록(검색 필터용) — 이름·코드·문항 수
export function bankUnivs(kind = '') {
  const m = new Map();
  for (const it of ofKind(bank().items, kind)) {
    const k = it.univ;
    if (!m.has(k)) m.set(k, { univ: k, unvCd: it.u || null, n: 0 });
    m.get(k).n++;
  }
  return [...m.values()].sort((a, b) => a.univ.localeCompare(b.univ, 'ko'));
}

export function searchBank({ q = '', univ = '', dept = '', type = '', year = '', kind = '', subject = '', passageOnly = false, basisOnly = false, offset = 0, limit = 30 } = {}) {
  let list = ofKind(bank().items, kind);
  if (univ) {
    const u = findUniv(univ);
    const key = squash(univ);
    list = list.filter((it) => (u && it.u === u.unvCd) || squash(it.univ).includes(key));
  }
  if (type) list = list.filter((it) => it.type === type);
  if (year) list = list.filter((it) => String(it.y) === String(year));
  if (passageOnly) list = list.filter((it) => it.psg);
  if (basisOnly) list = list.filter((it) => it.cur?.length);
  if (subject) { const sj = squash(subject); list = list.filter((it) => (it.cur || []).some((c) => squash(c.s).includes(sj)) || (it.un || []).some((x) => squash(x).includes(sj))); }
  if (dept) { const d = squash(dept); list = list.filter((it) => squash(it.dept).includes(d)); }
  if (q) {
    const terms = String(q).split(/\s+/).map(squash).filter(Boolean);
    list = list.filter((it) => { const hay = squash(`${it.q} ${it.psg} ${it.dept} ${it.univ} ${it.subj} ${(it.cur || []).map((c) => `${c.s}${c.c}`).join(' ')} ${(it.un || []).join(' ')}`); return terms.every((t) => hay.includes(t)); });
  }
  list = [...list].sort((a, b) => (b.y || 0) - (a.y || 0) || a.univ.localeCompare(b.univ, 'ko'));
  return { total: list.length, items: list.slice(offset, offset + limit).map(view) };
}

// 지원 카드(대학·학과)에 맞는 문항 — 같은 대학 중 학과가 겹치는 것 먼저, 그다음 공통·학과 미상, 최신 학년도 우선.
// 학과가 전혀 다른 문항(예: 의예과 카드에 영문과 문항)은 뒤로 미룬다.
export function bankForCard(univName, dept = '', n = 8) {
  const u = findUniv(univName);
  const key = squash(univName).replace(/(대학교|대학|대)$/, '');
  const items = ofKind(bank().items, '면접').filter((it) => (u && it.u === u.unvCd) || (key.length >= 2 && squash(it.univ).startsWith(key)));
  if (!items.length) return [];
  const dw = words(dept);
  const score = (it) => {
    const iw = words(it.dept);
    const overlap = dw.filter((w) => iw.some((x) => x.includes(w) || w.includes(x))).length;
    const common = !it.dept || /공통|전체|전 ?모집단위|모든/.test(it.dept) ? 1 : 0;
    return overlap * 10 + common * 3 + (Number(it.y) || 0) / 10000;
  };
  return items.map((it) => ({ it, s: score(it) })).sort((a, b) => b.s - a.s).slice(0, n).map((x) => view(x.it));
}

// 면접 전략 프롬프트에 넣을 짧은 글
export function bankPromptBlock(univName, dept, n = 8) {
  const list = bankForCard(univName, dept, n);
  if (!list.length) return '';
  return `[이 대학이 공식 공개한 면접 기출·예상 문항 — 선행학습 영향평가 보고서]\n` + list.map((it, i) =>
    `${i + 1}. (${it.y}학년도·${it.type}${it.dept ? `·${it.dept}` : ''}) ${it.q.slice(0, 220)}${it.intent ? ` — 의도: ${it.intent.slice(0, 80)}` : ''}`).join('\n');
}

// 📖 복습할 교과 단원 — 고른 대학(·학과·종류)의 문항카드 «관련 성취기준»을 과목별로 모아 많이 나온 순으로.
// 성취기준 코드·문장, 교과서 단원, 교과서 출처는 보고서 원문 그대로이고, 각 항목에 근거 문항 수를 단다.
export function bankReview({ univ = '', dept = '', kind = '' } = {}) {
  let list = ofKind(bank().items, kind).filter((it) => it.cur?.length || it.un?.length || it.tb?.length);
  if (univ) {
    const u = findUniv(univ); const key = squash(univ);
    list = list.filter((it) => (u && it.u === u.unvCd) || squash(it.univ).includes(key));
  }
  if (dept) { const d = squash(dept); const dl = list.filter((it) => squash(it.dept).includes(d)); if (dl.length) list = dl; }
  const subjects = new Map();
  const subj = (name) => {
    const k = String(name || '기타').trim() || '기타';
    if (!subjects.has(k)) subjects.set(k, { subject: k, n: 0, qids: new Set(), standards: new Map(), units: new Map(), textbooks: new Map() });
    return subjects.get(k);
  };
  for (const it of list) {
    const seen = new Set();
    for (const c of it.cur || []) {
      const g = subj(c.s); if (!seen.has(g.subject)) { g.qids.add(it.id); seen.add(g.subject); }
      const key = c.c || c.t.slice(0, 40);
      const st = g.standards.get(key) || { code: c.c, text: c.t, n: 0, univs: new Set() };
      st.n++; st.univs.add(it.univ); g.standards.set(key, st);
    }
    for (const un of it.un || []) {
      const [s0, ...rest] = un.split(/\s*·\s*/); const g = subj(rest.length ? s0 : (it.cur?.[0]?.s || '기타'));
      if (!seen.has(g.subject)) { g.qids.add(it.id); seen.add(g.subject); }
      const name = rest.length ? rest.join(' · ') : un; g.units.set(name, (g.units.get(name) || 0) + 1);
    }
    // 교과서는 도서명이 과목명과 맞는 과목에(예: 『물리학Ⅰ』 → 물리학Ⅰ), 못 찾으면 그 문항의 첫 과목에
    const subjNames = [...new Set((it.cur || []).map((c) => c.s).filter(Boolean))];
    for (const t of it.tb || []) {
      const tt = squash(t.t);
      const name = subjNames.find((s) => tt === squash(s)) || subjNames.find((s) => tt.includes(squash(s)) || squash(s).includes(tt)) || subjNames[0];
      if (!name) continue;
      const g = subj(name); const k = `${t.t}|${t.p}`;
      const x = g.textbooks.get(k) || { title: t.t, publisher: t.p, pages: new Set(), n: 0 }; x.n++; if (t.pg) x.pages.add(t.pg); g.textbooks.set(k, x);
    }
  }
  const out = [...subjects.values()].map((g) => ({
    subject: g.subject, questions: g.qids.size,
    standards: [...g.standards.values()].sort((a, b) => b.n - a.n).slice(0, 40).map((s) => ({ code: s.code, text: s.text, n: s.n, univs: [...s.univs].slice(0, 6) })),
    units: [...g.units].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([name, n]) => ({ name, n })),
    textbooks: [...g.textbooks.values()].sort((a, b) => b.n - a.n).slice(0, 12).map((t) => ({ title: t.title, publisher: t.publisher, pages: [...t.pages].slice(0, 6), n: t.n })),
  })).filter((g) => g.questions).sort((a, b) => b.questions - a.questions);
  return { questions: list.length, univs: new Set(list.map((it) => it.univ)).size, subjects: out };
}
