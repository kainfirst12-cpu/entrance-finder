// services/interviewBank.js — 대학 공식 공개 면접 기출·예상 문항 은행
//
// 출처는 대학이 법에 따라 공개하는 '선행학습 영향평가 자체평가보고서'(울산진로진학지원센터 대입자료실에
// 대학별로 모여 있다)뿐이다. 사설 후기 모음·'상업적 이용 불가' 자료는 넣지 않는다.
// 수집·추출 파이프라인은 저장소 밖(C:\tmp\interview-bank)에 있고, 결과만 data/interview-bank/questions.json 으로 들어온다.
//   { generatedAt, sources: [{ name, year, url }], items: [{ id, u, univ, y, dept, track, type, subj, q, psg, intent, fu, ev, src, pg }] }
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
  return { total: b.items.length, univs: new Set(b.items.map((i) => i.univ)).size, generatedAt: b.generatedAt || null };
}

// 대학 목록(검색 필터용) — 이름·코드·문항 수
export function bankUnivs() {
  const m = new Map();
  for (const it of bank().items) {
    const k = it.univ;
    if (!m.has(k)) m.set(k, { univ: k, unvCd: it.u || null, n: 0 });
    m.get(k).n++;
  }
  return [...m.values()].sort((a, b) => a.univ.localeCompare(b.univ, 'ko'));
}

export function searchBank({ q = '', univ = '', dept = '', type = '', year = '', passageOnly = false, offset = 0, limit = 30 } = {}) {
  let list = bank().items;
  if (univ) {
    const u = findUniv(univ);
    const key = squash(univ);
    list = list.filter((it) => (u && it.u === u.unvCd) || squash(it.univ).includes(key));
  }
  if (type) list = list.filter((it) => it.type === type);
  if (year) list = list.filter((it) => String(it.y) === String(year));
  if (passageOnly) list = list.filter((it) => it.psg);
  if (dept) { const d = squash(dept); list = list.filter((it) => squash(it.dept).includes(d)); }
  if (q) {
    const terms = String(q).split(/\s+/).map(squash).filter(Boolean);
    list = list.filter((it) => { const hay = squash(`${it.q} ${it.psg} ${it.dept} ${it.univ} ${it.subj}`); return terms.every((t) => hay.includes(t)); });
  }
  list = [...list].sort((a, b) => (b.y || 0) - (a.y || 0) || a.univ.localeCompare(b.univ, 'ko'));
  return { total: list.length, items: list.slice(offset, offset + limit).map(view) };
}

// 지원 카드(대학·학과)에 맞는 문항 — 같은 대학 중 학과가 겹치는 것 먼저, 그다음 공통·학과 미상, 최신 학년도 우선.
// 학과가 전혀 다른 문항(예: 의예과 카드에 영문과 문항)은 뒤로 미룬다.
export function bankForCard(univName, dept = '', n = 8) {
  const u = findUniv(univName);
  const key = squash(univName).replace(/(대학교|대학|대)$/, '');
  const items = bank().items.filter((it) => (u && it.u === u.unvCd) || (key.length >= 2 && squash(it.univ).startsWith(key)));
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
