// services/roadmapStore.js — 생기부 로드맵(체크리스트) 데이터
// 컨설팅 로드맵 PDF를 AI가 실행 항목으로 쪼갠 뒤, 학생이 직접 달성 체크·수정·삭제한다.
import { getPool } from './db.js';

export const ROADMAP_SECTIONS = ['과목별 설계', '타임라인', '남은 작업', '기타'];

const normSection = (s) => (ROADMAP_SECTIONS.includes(String(s || '').trim()) ? String(s).trim() : '기타');

// 학생의 로드맵 전체 (항목 포함)
export async function listRoadmaps(studentId) {
  const pool = getPool();
  const { rows: maps } = await pool.query(
    `SELECT * FROM ef_roadmaps WHERE student_id = $1 ORDER BY created_at DESC`, [studentId]);
  if (maps.length === 0) return [];
  const { rows: items } = await pool.query(
    `SELECT * FROM ef_roadmap_items WHERE roadmap_id = ANY($1::int[]) ORDER BY position, id`,
    [maps.map(m => m.id)]);
  const byMap = {};
  for (const it of items) (byMap[it.roadmap_id] ||= []).push(it);
  return maps.map(m => ({ ...m, items: byMap[m.id] || [] }));
}

// 로드맵 하나 (항목 + PDF 출력용 학생 기본 정보 포함)
export async function getRoadmap(id) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT r.*, s.name AS student_name, s.school AS student_school, s.grade AS student_grade, s.major AS student_major
       FROM ef_roadmaps r JOIN ef_students s ON s.id = r.student_id WHERE r.id = $1`, [id]);
  if (!rows[0]) return null;
  const { rows: items } = await pool.query(
    `SELECT * FROM ef_roadmap_items WHERE roadmap_id = $1 ORDER BY position, id`, [id]);
  return { ...rows[0], items };
}

export async function createRoadmap(studentId, { title, summary, body, sourceName, items = [] } = {}) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO ef_roadmaps (student_id, title, summary, body, source_name) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [studentId, title || '생기부 로드맵', summary || '', body || '', sourceName || '']);
    const roadmap = rows[0];
    let pos = 0;
    const saved = [];
    for (const it of items) {
      if (!it?.title?.trim()) continue;
      const { rows: ir } = await client.query(
        `INSERT INTO ef_roadmap_items (roadmap_id, section, subject, period, priority, title, detail, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [roadmap.id, normSection(it.section), (it.subject || '').trim(), (it.period || '').trim(),
         (it.priority || '').trim(), it.title.trim(), (it.detail || '').trim(), pos++]);
      saved.push(ir[0]);
    }
    await client.query('COMMIT');
    return { ...roadmap, items: saved };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function updateRoadmap(id, { title, summary, body } = {}) {
  const fields = [], vals = [];
  if (title !== undefined) { vals.push(title); fields.push(`title = $${vals.length}`); }
  if (summary !== undefined) { vals.push(summary); fields.push(`summary = $${vals.length}`); }
  if (body !== undefined) { vals.push(body); fields.push(`body = $${vals.length}`); }
  if (!fields.length) return;
  vals.push(id);
  await getPool().query(`UPDATE ef_roadmaps SET ${fields.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
}

export async function deleteRoadmap(id) {
  await getPool().query(`DELETE FROM ef_roadmaps WHERE id = $1`, [id]);
}

export async function addItem(roadmapId, f = {}) {
  const pool = getPool();
  const { rows: p } = await pool.query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM ef_roadmap_items WHERE roadmap_id = $1`, [roadmapId]);
  const { rows } = await pool.query(
    `INSERT INTO ef_roadmap_items (roadmap_id, section, subject, period, priority, title, detail, note, position)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [roadmapId, normSection(f.section), f.subject || '', f.period || '', f.priority || '',
     (f.title || '').trim() || '새 항목', f.detail || '', f.note || '', p[0].next]);
  await pool.query(`UPDATE ef_roadmaps SET updated_at = now() WHERE id = $1`, [roadmapId]);
  return rows[0];
}

// 학생·선생님 공용 수정 (done 토글, 제목/설명/메모 편집)
export async function updateItem(id, f = {}) {
  const fields = [], vals = [];
  const map = { section: 'section', subject: 'subject', period: 'period', priority: 'priority', title: 'title', detail: 'detail', note: 'note' };
  for (const [k, col] of Object.entries(map)) {
    if (f[k] !== undefined) { vals.push(k === 'section' ? normSection(f[k]) : f[k]); fields.push(`${col} = $${vals.length}`); }
  }
  if (f.done !== undefined) {
    vals.push(!!f.done); fields.push(`done = $${vals.length}`);
    fields.push(`done_at = ${f.done ? 'now()' : 'NULL'}`);
  }
  if (!fields.length) return null;
  vals.push(id);
  const { rows } = await getPool().query(
    `UPDATE ef_roadmap_items SET ${fields.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals);
  return rows[0] || null;
}

export async function deleteItem(id) {
  await getPool().query(`DELETE FROM ef_roadmap_items WHERE id = $1`, [id]);
}

// ── 권한 확인 ─────────────────────────────────────────
// 선생님(소유자) 확인용
export async function getRoadmapOwner(roadmapId) {
  const { rows } = await getPool().query(
    `SELECT s.owner_id FROM ef_roadmaps r JOIN ef_students s ON s.id = r.student_id WHERE r.id = $1`, [roadmapId]);
  return rows[0]?.owner_id ?? null;
}
export async function getItemOwner(itemId) {
  const { rows } = await getPool().query(
    `SELECT s.owner_id FROM ef_roadmap_items i
       JOIN ef_roadmaps r ON r.id = i.roadmap_id
       JOIN ef_students s ON s.id = r.student_id
     WHERE i.id = $1`, [itemId]);
  return rows[0]?.owner_id ?? null;
}
// 학생 열람 코드 확인용 — 이 항목/로드맵이 그 학생의 것인가
export async function getRoadmapStudentId(roadmapId) {
  const { rows } = await getPool().query(`SELECT student_id FROM ef_roadmaps WHERE id = $1`, [roadmapId]);
  return rows[0]?.student_id ?? null;
}
export async function getItemStudentId(itemId) {
  const { rows } = await getPool().query(
    `SELECT r.student_id FROM ef_roadmap_items i JOIN ef_roadmaps r ON r.id = i.roadmap_id WHERE i.id = $1`, [itemId]);
  return rows[0]?.student_id ?? null;
}
