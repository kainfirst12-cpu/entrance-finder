// services/interviewStore.js — 면접 전략 리포트 보관 + 대학 전형 사실 조회
//
// 리포트 본문(data)은 AI가 만든 구조화 JSON이다. 화면(frontend/src/interviewReport.js)이
// 이 JSON을 A4 가로 HTML로 그린다 — HTML을 저장하지 않는 이유는, 디자인을 고칠 때
// 옛 리포트까지 같이 새 디자인으로 열리게 하기 위해서다.
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getPool } from './db.js';

const ADIGA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'adiga');

// ── 보관 CRUD (선생님별 분리) ────────────────────────────
export async function listInterviews(ownerId, { q } = {}) {
  const where = ['owner_id = $1'], params = [ownerId];
  if (q) { params.push(`%${q}%`); where.push(`(title ILIKE $${params.length} OR student_name ILIKE $${params.length})`); }
  const { rows } = await getPool().query(
    `SELECT id, student_id, student_name, title, cards, created_at
     FROM ef_interviews WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 300`, params);
  return rows;
}

export async function getInterview(id) {
  const { rows } = await getPool().query(`SELECT * FROM ef_interviews WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function createInterview(ownerId, f = {}) {
  const { rows } = await getPool().query(
    `INSERT INTO ef_interviews (owner_id, student_id, student_name, title, cards, data)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb) RETURNING *`,
    [ownerId, f.studentId ? Number(f.studentId) : null, f.studentName || '', f.title || '면접 전략',
     JSON.stringify(f.cards || []), JSON.stringify(f.data || {})]);
  return rows[0];
}

export async function deleteInterview(id) {
  await getPool().query(`DELETE FROM ef_interviews WHERE id = $1`, [id]);
}

export async function getInterviewOwner(id) {
  const { rows } = await getPool().query(`SELECT owner_id FROM ef_interviews WHERE id = $1`, [id]);
  return rows[0]?.owner_id ?? null;
}

// ── 대학어디가 입시가이드에서 전형 사실 꺼내기 ─────────────
// 사용자가 '숭실대'라고 적어도 목록의 '숭실대학교[본교]'를 찾아야 한다.
// 여대는 '성신여대' ↔ '성신여자대학교' 처럼 줄임이 다르니 둘 다 같은 꼴로 만든다.
function canon(name) {
  return String(name || '')
    .replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').replace(/\s+/g, '')
    .replace(/여자대학교$/, '여대').replace(/대학교$/, '대').replace(/대학$/, '대')
    .replace(/^국립/, '');
}

let _univList = null;
function univList() {
  if (_univList) return _univList;
  try { _univList = JSON.parse(readFileSync(join(ADIGA_DIR, 'univ-list.json'), 'utf8')).universities || []; }
  catch { _univList = []; }
  return _univList;
}

export function findUniv(name) {
  const key = canon(name);
  if (!key || key.length < 2) return null;
  const list = univList();
  // 정확히 같은 것 → 본교 우선 → 앞글자 일치
  const exact = list.filter(u => canon(u.name) === key);
  const pick = (arr) => arr.find(u => /\[본교\]/.test(u.name)) || arr[0] || null;
  if (exact.length) return pick(exact);
  const prefix = list.filter(u => canon(u.name).startsWith(key) || key.startsWith(canon(u.name)));
  return pick(prefix);
}

// 입시가이드 표를 프롬프트에 넣을 수 있는 짧은 글로 편다. 전형명이 주어지면 그 표를 앞에 둔다.
export function univFacts(name, track = '') {
  const u = findUniv(name);
  if (!u) return null;
  const file = join(ADIGA_DIR, 'univ', `${u.unvCd}.json`);
  if (!existsSync(file)) return null;
  let d;
  try { d = JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
  const tables = d.guide?.tables || [];
  const tkey = String(track || '').replace(/\s+/g, '');
  const scored = tables.map(t => {
    const text = t.map(row => row.join(' | ')).join('\n');
    const hit = tkey && text.replace(/\s+/g, '').includes(tkey) ? 2 : (/면접/.test(text) ? 1 : 0);
    return { hit, text };
  }).sort((a, b) => b.hit - a.hit);
  const body = scored.map(s => s.text).join('\n---\n').slice(0, 4000);
  return { unvCd: u.unvCd, name: u.name, year: d.guide?.syr || '', text: body };
}
