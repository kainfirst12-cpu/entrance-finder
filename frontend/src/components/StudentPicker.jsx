import { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';

// 학생 보드(ef_students) 목록에서 학생을 고르는 공용 셀렉터.
// onChange(student|null) — student는 보드의 학생 객체(grades/records 포함).
export default function StudentPicker({ value, onChange, style, placeholder = '학생 선택 안 함' }) {
  const [students, setStudents] = useState([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('ef_token');
    if (!token) { setMsg('로그인이 필요합니다'); return; }
    fetch(`${API_BASE}/api/board/students`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((j) => { if (j.success) setStudents(j.students || []); else setMsg(j.message || '학생 보드를 불러올 수 없습니다'); })
      .catch((e) => setMsg(e.message));
  }, []);

  return (
    <select
      style={style}
      value={value?.id || ''}
      title={msg || '학생 보드와 연결 — 결과가 해당 학생 기록으로 저장됩니다'}
      disabled={!students.length}
      onChange={(e) => onChange?.(students.find((s) => String(s.id) === e.target.value) || null)}
    >
      <option value="">{students.length ? placeholder : (msg || '보드에 학생 없음')}</option>
      {students.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}{s.school ? ` · ${s.school}` : ''}{s.grade ? ` · ${s.grade}` : ''}
        </option>
      ))}
    </select>
  );
}
