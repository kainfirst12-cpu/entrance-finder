// out/*.json(구독 에이전트가 문항카드에서 뽑은 논술·면접 문항) → questions.json 에 합친다 (2026-11-10)
//  - 논술 문항은 k:'논술' 로 새로 넣는다.
//  - 면접 문항은 기존 문항과 같으면 근거(성취기준·교과서·채점)만 덧붙이고, 없던 것이면 새로 넣는다.
//  - 질문 없이 근거만 뽑힌 조각(question:'')은 같은 대학·같은 종류·같은 문항 번호의 질문에 붙인다.
// 사용: C:\tmp\interview-bank 에서  node <이 파일>
import fs from 'fs'; import crypto from 'crypto';
import { findUniv } from 'file:///C:/Users/kainf/entrance-finder/backend/services/interviewStore.js';

const OUT = 'C:/Users/kainf/entrance-finder/backend/data/interview-bank/questions.json';
const man = Object.fromEntries(JSON.parse(fs.readFileSync('manifest.json', 'utf8')).map((x) => [x.fileId, x]));
const jobs = Object.fromEntries(JSON.parse(fs.readFileSync('jobs.json', 'utf8')).map((j) => [j.job.replace(/\.txt$/, ''), j]));
// 늘 10월 면접 추출본(questions.base.json, 작업 폴더 보관)에서 시작해 몇 번 돌려도 같은 결과
if (!fs.existsSync('questions.base.json')) fs.copyFileSync(OUT, 'questions.base.json');
const bank = JSON.parse(fs.readFileSync('questions.base.json', 'utf8'));

const clean = (s, n) => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const squash = (s) => String(s || '').replace(/[^가-힣A-Za-z0-9]/g, '');
const ROMAN = { 'Ⅰ': 1, 'Ⅱ': 2, 'Ⅲ': 3, 'Ⅳ': 4, 'Ⅴ': 5, 'Ⅵ': 6, 'Ⅶ': 7, 'Ⅷ': 8, 'Ⅸ': 9, 'Ⅹ': 10 };
// 문항 번호 핵심: 마지막 숫자(로마 숫자 포함) + 계열 단서
function qkey(qno, dept) {
  let s = String(qno || '').replace(/[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]/g, (m) => ` ${ROMAN[m]} `)
    .replace(/\b(IX|IV|V?I{1,3}|X)\b/g, (m) => ` ${({ I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 })[m]} `);
  const nums = s.match(/\d+(-\d+)?/g) || [];
  const field = (/(의예|의학|의대)/.test(s + dept) && '의') || (/자연|수리|과학|이공/.test(s + dept) && '자') || (/인문|사회|경영|체육/.test(s + dept) && '인') || '';
  const slot = (/오전/.test(s) && '오전') || (/오후/.test(s) && '오후') || '';
  return `${field}|${slot}|${nums[nums.length - 1] || ''}`;
}

// 출처 표
const srcIdx = new Map(bank.sources.map((s, i) => [s.url, i]));
const srcOf = (fileId) => {
  const m = man[fileId];
  if (!srcIdx.has(m.url)) {
    const name = m.name.replace(/\.pdf$/i, '').replace(/^\((.*?)\)\s*/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    srcIdx.set(m.url, bank.sources.length);
    bank.sources.push({ name, year: m.year, url: m.url, post: m.post });
  }
  return srcIdx.get(m.url);
};

const cur = (q) => (q.curriculum || []).map((c) => ({ s: clean(c.subject, 40), c: clean(c.code, 40), t: clean(c.standard, 200) })).filter((c) => c.s || c.c || c.t).slice(0, 12);
const tbs = (q) => (q.textbooks || []).map((t) => ({ t: clean(t.title, 60), p: clean(t.publisher, 40), pg: clean(t.pages, 30) })).filter((t) => t.t).slice(0, 8);
const uns = (q) => (q.units || []).map((u) => clean(u, 80)).filter(Boolean).slice(0, 10);
const uniq = (arr, key) => { const seen = new Set(); return arr.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

// 기존 면접 문항 찾기용
const byQ = new Map(bank.items.map((it) => [`${it.u || squash(it.univ)}|${squash(it.q).slice(0, 160)}`, it]));

let added = { 논술: 0, 면접: 0 }, enriched = 0, orphan = 0, attached = 0, files = 0, kept = 0;
const fresh = [];   // 이번에 새로 만든 항목(근거 조각 붙이기 대상)
const pieces = [];  // 질문 없는 근거 조각
for (const f of fs.readdirSync('out').filter((x) => x.endsWith('.json')).sort()) {
  const job = jobs[f.replace(/\.json$/, '')]; if (!job) { console.warn('작업 표에 없음', f); continue; }
  let d; try { d = JSON.parse(fs.readFileSync(`out/${f}`, 'utf8')); } catch { console.warn('JSON 오류', f); continue; }
  files++;
  const univName = clean(d.university, 60) || job.univ;
  const u = findUniv(univName.replace(/\((서울|본교)\)/, ''));
  for (const q of d.questions || []) {
    const kind = q.kind === '논술' ? '논술' : '면접';
    const base = { kind, univ: univName, u: u?.unvCd || null, y: Number(job.year) || null, src: srcOf(job.fileId), pg: Number(q.page) || null,
      dept: clean(q.dept, 120), qno: clean(q.qno, 80), track: clean(q.track, 120), qk: qkey(q.qno, q.dept), cur: cur(q), un: uns(q), tb: tbs(q), ev: clean(q.evalPoints, 700), intent: clean(q.intent, 240) };
    const text = clean(q.question, 2500);
    if (squash(text).length < 8) { pieces.push(base); continue; }
    const key = `${base.u || squash(univName)}|${squash(text).slice(0, 160)}`;
    const prev = byQ.get(key);
    if (prev) { // 같은 문항 — 근거 덧붙이기
      prev.cur = uniq([...(prev.cur || []), ...base.cur], (c) => c.c || c.t); prev.un = uniq([...(prev.un || []), ...base.un], (x) => x);
      prev.tb = uniq([...(prev.tb || []), ...base.tb], (t) => t.t + t.p);
      if (base.ev.length > (prev.ev || '').length) prev.ev = base.ev;
      if (!prev.intent && base.intent) prev.intent = base.intent;
      prev._qk = base.qk; enriched++; continue;
    }
    const it = {
      u: base.u, univ: univName, y: base.y, dept: base.dept, track: clean(q.track, 120),
      type: kind === '논술' ? '논술' : (['제시문 기반', '서류 기반', '인성', 'MMI', '교직적성', '전공적성'].includes(q.interviewType) ? q.interviewType : '기타'),
      subj: clean(q.subject, 80), q: text, psg: clean(q.passage, 6000), intent: base.intent,
      fu: (q.followUps || []).map((x) => clean(x, 300)).filter(Boolean).slice(0, 5), ev: base.ev, src: base.src, pg: base.pg,
      ...(kind === '논술' ? { k: '논술', ef: q.essayField && q.essayField !== '해당없음' ? q.essayField : '' } : {}),
      ...(base.cur.length ? { cur: base.cur } : {}), ...(base.un.length ? { un: base.un } : {}), ...(base.tb.length ? { tb: base.tb } : {}),
      _qk: base.qk,
    };
    it.id = 'b' + crypto.createHash('md5').update(`${it.u}|${it.univ}|${it.q}`).digest('hex').slice(0, 10);
    byQ.set(key, it); bank.items.push(it); fresh.push(it); added[kind]++;
  }
}
// 근거 조각 → 같은 대학·학년도·종류·문항 번호의 질문(가까운 쪽 우선)
for (const p of pieces) {
  if (!p.cur.length && !p.ev && !p.tb.length) { orphan++; continue; }
  const cands = bank.items.filter((it) => it._qk === p.qk && (it.k === '논술') === (p.kind === '논술') && it.y === p.y && ((p.u && it.u === p.u) || it.univ === p.univ));
  if (!p.qk.split('|')[2] || !cands.length) {
    // 질문 원문을 싣지 않은 보고서(문항은 별책) — 근거(성취기준)가 있으면 «원문은 PDF 참고» 문항으로 살린다
    if (p.cur.length && p.qno) {
      const it = { u: p.u, univ: p.univ, y: p.y, dept: p.dept, track: p.track, type: p.kind === '논술' ? '논술' : '기타', subj: '',
        q: `${p.qno} (문항 원문은 보고서 원문 PDF 참고)`, noq: 1, psg: '', intent: p.intent, fu: [], ev: p.ev, src: p.src, pg: p.pg,
        ...(p.kind === '논술' ? { k: '논술', ef: '' } : {}), cur: p.cur, un: p.un, tb: p.tb, _qk: p.qk };
      it.id = 'b' + crypto.createHash('md5').update(`${it.u}|${it.univ}|${it.y}|${it.q}`).digest('hex').slice(0, 10);
      const dup = bank.items.find((x) => x.id === it.id);
      if (dup) { dup.cur = uniq([...(dup.cur || []), ...p.cur], (c) => c.c || c.t); if (p.ev.length > (dup.ev || '').length) dup.ev = p.ev; }
      else { bank.items.push(it); kept++; }
      continue;
    }
    orphan++; continue;
  }
  const it = cands.sort((a, b) => Math.abs((a.pg || 0) - (p.pg || 0)) - Math.abs((b.pg || 0) - (p.pg || 0)))[0];
  it.cur = uniq([...(it.cur || []), ...p.cur], (c) => c.c || c.t); it.un = uniq([...(it.un || []), ...p.un], (x) => x);
  it.tb = uniq([...(it.tb || []), ...p.tb], (t) => t.t + t.p);
  if (p.ev.length > (it.ev || '').length) it.ev = p.ev;
  if (!it.intent && p.intent) it.intent = p.intent;
  attached++;
}
for (const it of bank.items) { delete it._qk; for (const k of ['cur', 'un', 'tb']) if (Array.isArray(it[k]) && !it[k].length) delete it[k]; }
bank.generatedAt = new Date().toISOString();
bank.note = '대학 선행학습 영향평가 자체평가보고서(울산진로진학지원센터 대입자료실 게시본)에서 추출한 면접·구술 문항과 논술 문항(문항카드의 교육과정 근거 포함)';
fs.writeFileSync(OUT, JSON.stringify(bank));
const nons = bank.items.filter((i) => i.k === '논술');
console.log('files', files, 'added', added, 'enriched', enriched, 'pieces', pieces.length, 'attached', attached, 'kept(원문 없음)', kept, 'orphan', orphan);
console.log('total', bank.items.length, '논술', nons.length, '논술 대학', new Set(nons.map((i) => i.univ)).size,
  '근거 붙은 문항', bank.items.filter((i) => i.cur?.length).length, 'size', (fs.statSync(OUT).size / 1e6).toFixed(1), 'MB');
