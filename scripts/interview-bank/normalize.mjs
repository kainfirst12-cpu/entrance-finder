// results.json(배치 결과) → entrance-finder/backend/data/interview-bank/questions.json
import fs from 'fs'; import crypto from 'crypto';
import { findUniv } from 'file:///C:/Users/kainf/entrance-finder/backend/services/interviewStore.js';
const chunks = JSON.parse(fs.readFileSync('chunks.json', 'utf8'));
const man = Object.fromEntries(JSON.parse(fs.readFileSync('manifest.json', 'utf8')).map(x => [x.fileId, x]));
const res = JSON.parse(fs.readFileSync('results.json', 'utf8'));
const OUT = 'C:/Users/kainf/entrance-finder/backend/data/interview-bank/questions.json';

const TYPES = new Set(['제시문 기반', '서류 기반', '인성', 'MMI', '교직적성', '전공적성', '기타']);
const clean = (s, n) => String(s || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
const squash = s => String(s || '').replace(/[^가-힣A-Za-z0-9]/g, '');
const srcIdx = new Map(), sources = [];
const srcOf = (fileId) => {
  if (!srcIdx.has(fileId)) {
    const m = man[fileId];
    const name = m.name.replace(/\.pdf$/i, '').replace(/^\((.*?)\)\s*/, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    srcIdx.set(fileId, sources.length);
    sources.push({ name, year: m.year, url: m.url, post: m.post });
  }
  return srcIdx.get(fileId);
};

let raw = 0, dropped = 0, unmatched = new Map();
const byKey = new Map();
for (const [cid, r] of Object.entries(res)) {
  if (!r.questions) continue;
  const c = chunks[Number(cid.slice(1))];
  const univName = clean(r.university, 60) || c.name;
  const u = findUniv(univName.replace(/\((서울|본교)\)/, ''));
  if (!u) unmatched.set(univName, (unmatched.get(univName) || 0) + 1);
  for (const q of r.questions) {
    raw++;
    const text = clean(q.question, 2500);
    if (squash(text).length < 8) { dropped++; continue; }
    const it = {
      u: u?.unvCd || null, univ: univName, y: Number(c.year) || null,
      dept: clean(q.dept, 120), track: clean(q.track, 120), type: TYPES.has(q.interviewType) ? q.interviewType : '기타',
      subj: clean(q.subject, 80), q: text, psg: clean(q.passage, 3000), intent: clean(q.intent, 200),
      fu: (q.followUps || []).map(x => clean(x, 300)).filter(Boolean).slice(0, 5), ev: clean(q.evalPoints, 400),
      src: srcOf(c.id), pg: Number(q.page) || null,
    };
    // 같은 대학의 같은 질문(해마다 되풀이되는 예상 질문 포함)은 최신 학년도 하나만
    const key = `${it.u || squash(univName)}|${squash(text).slice(0, 160)}`;
    const prev = byKey.get(key);
    const rich = (x) => (x.psg ? 2 : 0) + (x.intent ? 1 : 0) + (x.ev ? 1 : 0) + (x.dept ? 1 : 0);
    if (!prev || it.y > prev.y || (it.y === prev.y && rich(it) > rich(prev))) byKey.set(key, it);
  }
}
const items = [...byKey.values()].map(it => ({ id: 'b' + crypto.createHash('md5').update(`${it.u}|${it.univ}|${it.q}`).digest('hex').slice(0, 10), ...it }));
fs.mkdirSync('C:/Users/kainf/entrance-finder/backend/data/interview-bank', { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), note: '대학 선행학습 영향평가 자체평가보고서(울산진로진학지원센터 대입자료실 게시본)에서 추출한 면접·구술 문항', sources, items }));
const types = {}; items.forEach(i => types[i.type] = (types[i.type] || 0) + 1);
console.log('raw', raw, 'dropped', dropped, 'unique', items.length, 'univs', new Set(items.map(i => i.univ)).size, 'noUnvCd', items.filter(i => !i.u).length);
console.log(types); console.log('unmatched', [...unmatched].slice(0, 30));
console.log('size', (fs.statSync(OUT).size / 1e6).toFixed(1), 'MB');
