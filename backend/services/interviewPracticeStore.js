// services/interviewPracticeStore.js — 면접 연습 (학생 페이지 🎤)
//
// 연습 문항은 따로 만들지 않는다. 선생님이 '연습 공개'한 면접 전략 리포트(ef_interviews.data)에서
// 문항·꼬리질문·의도·예시 답안을 그대로 꺼낸다. 학생에게는 teacherNote·평가표 매핑처럼
// 선생님용 내용은 내보내지 않는다.
import { getPool } from './db.js';

const arr = (v) => (Array.isArray(v) ? v : []);
const clip = (s, n) => String(s ?? '').slice(0, n);

// 리포트 JSON → 학생 연습 세트 (면접 있는 카드만, 문항과 예시 답안은 같은 순번끼리 짝)
export function practiceSetFromInterview(row) {
  const d = row.data || {};
  const cards = arr(d.cards);
  const sets = arr(d.interviews).map((iv) => {
    const c = cards[iv.cardIndex] || {};
    const answers = arr(iv.answers);
    return {
      cardIndex: iv.cardIndex,
      univ: c.univ || '', dept: c.dept || '', track: c.track || '',
      kind: c.kind || '', style: c.style || '', minutes: c.minutes || null,
      answerSeconds: Number(c.answerSeconds) || 60,
      formula: c.formula || '',
      studentNote: iv.studentNote || '',
      questions: arr(iv.questions).map((q, i) => ({
        qIndex: i,
        q: q.q || '', follow: q.follow || '', followType: q.followType || '',
        intent: answers[i]?.intent || '', sample: answers[i]?.sample || '',
      })).filter((q) => q.q),
    };
  }).filter((s) => s.questions.length);
  return {
    id: row.id, title: row.title, createdAt: row.created_at,
    principle: d.principle || '',
    topics: arr(d.topics).map((t) => t?.title).filter(Boolean),
    cards: sets,
  };
}

// ── 학생 쪽 ──────────────────────────────────────────
export async function listOpenPracticeSets(studentId) {
  const { rows } = await getPool().query(
    `SELECT id, title, data, created_at FROM ef_interviews
     WHERE student_id = $1 AND practice_open ORDER BY created_at DESC LIMIT 20`, [studentId]);
  return rows.map(practiceSetFromInterview).filter((s) => s.cards.length);
}

// 연습 기록을 붙일 리포트가 이 학생에게 공개된 것인지
export async function isOpenInterviewOf(interviewId, studentId) {
  const { rows } = await getPool().query(
    `SELECT 1 FROM ef_interviews WHERE id = $1 AND student_id = $2 AND practice_open`, [interviewId, studentId]);
  return rows.length > 0;
}

export async function countPracticeToday(studentId) {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS n FROM ef_interview_practice
     WHERE student_id = $1 AND created_at > now() - interval '1 day'`, [studentId]);
  return rows[0]?.n ?? 0;
}

export async function addPractice(studentId, f = {}) {
  let analysis = f.analysis && typeof f.analysis === 'object' ? f.analysis : {};
  if (JSON.stringify(analysis).length > 12000) analysis = {};
  const int = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);
  const { rows } = await getPool().query(
    `INSERT INTO ef_interview_practice
       (student_id, interview_id, card_index, q_index, card_label, question, answer, input_mode,
        prep_sec, limit_sec, duration_sec, analysis, follow_up, follow_answer, retry, bank_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16) RETURNING *`,
    [studentId, f.interviewId || null, int(f.cardIndex), int(f.qIndex), clip(f.cardLabel, 200),
     clip(f.question, 2000), clip(f.answer, 4000), f.inputMode === 'voice' ? 'voice' : 'text',
     int(f.prepSec), int(f.limitSec), int(f.durationSec), JSON.stringify(analysis),
     clip(f.followUp, 500), clip(f.followAnswer, 2000), !!f.retry, f.bankId ? clip(f.bankId, 40) : null]);
  return rows[0];
}

export async function listPractice(studentId, limit = 300) {
  const { rows } = await getPool().query(
    `SELECT * FROM ef_interview_practice WHERE student_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [studentId, limit]);
  return rows;
}

export async function getPracticeStudentId(id) {
  const { rows } = await getPool().query(`SELECT student_id FROM ef_interview_practice WHERE id = $1`, [id]);
  return rows[0]?.student_id ?? null;
}

// 학생은 '다시 연습' 표시만, 선생님은 코멘트까지 고친다
export async function updatePractice(id, { retry, teacherComment } = {}) {
  const sets = [], params = [];
  if (typeof retry === 'boolean') { params.push(retry); sets.push(`retry = $${params.length}`); }
  if (typeof teacherComment === 'string') {
    params.push(clip(teacherComment, 2000)); sets.push(`teacher_comment = $${params.length}`, 'commented_at = now()');
  }
  if (!sets.length) return null;
  params.push(id);
  const { rows } = await getPool().query(
    `UPDATE ef_interview_practice SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  return rows[0] || null;
}

export async function deletePractice(id) {
  await getPool().query(`DELETE FROM ef_interview_practice WHERE id = $1`, [id]);
}

// ── 선생님 쪽 ────────────────────────────────────────
// 이 학생에게 연결된 면접 전략 리포트 (공개 여부 토글용)
export async function listStudentInterviews(studentId) {
  const { rows } = await getPool().query(
    `SELECT id, title, cards, practice_open, created_at,
       (SELECT COALESCE(SUM(jsonb_array_length(COALESCE(iv->'questions', '[]'::jsonb))), 0)::int
          FROM jsonb_array_elements(COALESCE(data->'interviews', '[]'::jsonb)) iv) AS question_count
     FROM ef_interviews WHERE student_id = $1 ORDER BY created_at DESC LIMIT 50`, [studentId]);
  return rows;
}

export async function setPracticeOpen(interviewId, studentId, open) {
  const { rowCount } = await getPool().query(
    `UPDATE ef_interviews SET practice_open = $1 WHERE id = $2 AND student_id = $3`, [!!open, interviewId, studentId]);
  return rowCount > 0;
}

// 리포트를 학생에게 배정하면 그 학생 것으로 묶고 연습을 연다(다른 학생 것으로 이미 묶였으면 건드리지 않는다)
export async function linkInterviewToStudent(interviewId, studentId) {
  await getPool().query(
    `UPDATE ef_interviews SET student_id = $1, practice_open = true
     WHERE id = $2 AND (student_id IS NULL OR student_id = $1)`, [studentId, interviewId]);
}
