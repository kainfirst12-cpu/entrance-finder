// services/boardStore.js — 학생 관리 칸반 보드 데이터
import { getPool, dbEnabled } from './db.js';

export const BOARD_COLUMNS = ['신규', '생기부 분석', '보완 중', '수행평가', '완료'];

// 선생님(소유자) 학생 목록 + 성적/기록 임베드
export async function listStudents(ownerId) {
  if (!dbEnabled() || !ownerId) return [];
  const pool = getPool();
  const { rows: students } = await pool.query(
    `SELECT * FROM ef_students WHERE owner_id = $1 ORDER BY status, position, id`, [ownerId]
  );
  if (students.length === 0) return [];
  const ids = students.map(s => s.id);
  const [{ rows: grades }, { rows: records }, { rows: files }] = await Promise.all([
    pool.query(`SELECT * FROM ef_grades WHERE student_id = ANY($1) ORDER BY term, id`, [ids]),
    pool.query(`SELECT id, student_id, type, title, detail, content, created_at FROM ef_records WHERE student_id = ANY($1) ORDER BY created_at DESC`, [ids]),
    pool.query(`SELECT id, student_id, name, mime, size, kind, created_at FROM ef_files WHERE student_id = ANY($1) ORDER BY created_at DESC`, [ids]),
  ]);
  const gByS = {}, rByS = {}, fByS = {};
  for (const g of grades) (gByS[g.student_id] ||= []).push(g);
  for (const r of records) (rByS[r.student_id] ||= []).push(r);
  for (const f of files) (fByS[f.student_id] ||= []).push(f);
  return students.map(s => ({ ...s, grades: gByS[s.id] || [], records: rByS[s.id] || [], files: fByS[s.id] || [] }));
}

// 이름으로 찾아 없으면 생성, 있으면 빈 필드만 보완 (자동 연동용)
export async function upsertStudentByName(ownerId, f = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM ef_students WHERE owner_id = $1 AND name = $2 ORDER BY id LIMIT 1`,
    [ownerId, f.name || '이름없음']
  );
  let student = rows[0];
  if (!student) {
    return createStudent(ownerId, f);
  }
  const upd = {};
  const pairs = { school: 'school', grade: 'grade', major: 'major', targetUniv: 'target_univ' };
  for (const [k, col] of Object.entries(pairs)) {
    if ((!student[col] || student[col] === '') && f[k]) upd[k] = f[k];
  }
  if (Object.keys(upd).length) await updateStudent(student.id, upd);
  return student;
}

export async function getStudentOwner(id) {
  if (!dbEnabled()) return null;
  const { rows } = await getPool().query(`SELECT owner_id FROM ef_students WHERE id = $1`, [id]);
  return rows[0]?.owner_id ?? null;
}

export async function createStudent(ownerId, f = {}) {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO ef_students (owner_id, name, school, grade, major, target_univ, status, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [ownerId, f.name || '이름없음', f.school || '', f.grade || '', f.major || '', f.targetUniv || '', f.status || '신규', f.notes || '']
  );
  return { ...rows[0], grades: [], records: [] };
}

export async function updateStudent(id, f = {}) {
  const pool = getPool();
  const fields = [], vals = [];
  const map = { name: 'name', school: 'school', grade: 'grade', major: 'major', targetUniv: 'target_univ', status: 'status', position: 'position', notes: 'notes' };
  for (const [k, col] of Object.entries(map)) {
    if (f[k] !== undefined) { vals.push(f[k]); fields.push(`${col} = $${vals.length}`); }
  }
  if (fields.length === 0) return;
  vals.push(id);
  await pool.query(`UPDATE ef_students SET ${fields.join(', ')}, updated_at = now() WHERE id = $${vals.length}`, vals);
}

export async function deleteStudent(id) {
  await getPool().query(`DELETE FROM ef_students WHERE id = $1`, [id]);
}

export async function addGrade(studentId, { term, gpa, note }) {
  const { rows } = await getPool().query(
    `INSERT INTO ef_grades (student_id, term, gpa, note) VALUES ($1,$2,$3,$4) RETURNING *`,
    [studentId, term || '', gpa === '' || gpa == null ? null : Number(gpa), note || '']
  );
  return rows[0];
}

export async function deleteGrade(id) {
  await getPool().query(`DELETE FROM ef_grades WHERE id = $1`, [id]);
}

export async function addRecord(studentId, { type, title, detail, content }) {
  const { rows } = await getPool().query(
    `INSERT INTO ef_records (student_id, type, title, detail, content) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [studentId, type || '기록', title || '', detail || '', content || '']
  );
  return rows[0];
}

export async function deleteRecord(id) {
  await getPool().query(`DELETE FROM ef_records WHERE id = $1`, [id]);
}

// ── 학생 첨부파일 ──────────────────────────────────────
export async function addFile(studentId, { name, mime, size, kind, data }) {
  const { rows } = await getPool().query(
    `INSERT INTO ef_files (student_id, name, mime, size, kind, data) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, student_id, name, mime, size, kind, created_at`,
    [studentId, name || 'file', mime || 'application/octet-stream', size || 0, kind || '', data]
  );
  return rows[0];
}
export async function getFile(id) {
  const { rows } = await getPool().query(`SELECT name, mime, data FROM ef_files WHERE id = $1`, [id]);
  return rows[0] || null;
}
export async function deleteFile(id) {
  await getPool().query(`DELETE FROM ef_files WHERE id = $1`, [id]);
}
export async function getFileStudentOwner(fileId) {
  const { rows } = await getPool().query(
    `SELECT s.owner_id FROM ef_files f JOIN ef_students s ON s.id = f.student_id WHERE f.id = $1`, [fileId]);
  return rows[0]?.owner_id ?? null;
}

// 관리자: 선생님(이용자 코드) 목록 + 학생 수
export async function listTeachers() {
  if (!dbEnabled()) return [];
  const { rows } = await getPool().query(`
    SELECT u.id, u.name, u.code, u.active,
      COALESCE(c.n, 0) AS student_count
    FROM app_users u
    LEFT JOIN (SELECT owner_id, COUNT(*) AS n FROM ef_students GROUP BY owner_id) c ON c.owner_id = u.id
    WHERE u.role = 'user'
    ORDER BY u.created_at DESC
  `);
  return rows;
}

// 성적 학생이 특정 선생님 소유인지(또는 grade/record의 학생 소유자) 확인용
export async function getGradeOwner(gradeId) {
  const { rows } = await getPool().query(
    `SELECT s.owner_id FROM ef_grades g JOIN ef_students s ON s.id = g.student_id WHERE g.id = $1`, [gradeId]);
  return rows[0]?.owner_id ?? null;
}
export async function getRecordOwner(recordId) {
  const { rows } = await getPool().query(
    `SELECT s.owner_id FROM ef_records r JOIN ef_students s ON s.id = r.student_id WHERE r.id = $1`, [recordId]);
  return rows[0]?.owner_id ?? null;
}
