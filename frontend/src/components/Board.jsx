import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';

const token = () => localStorage.getItem('ef_token');

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) { const e = new Error('권한/인증 오류'); e.auth = res.status === 401; throw e; }
  return res.json();
}

// 파스텔 칸반 테마 (배경 / 강조색 / 카드 상단 띠)
const COL_THEME = {
  '신규':       { bg: 'rgba(255,255,255,0.05)', accent: '#8a857c', bar: '#d8d3ca' },
  '생기부 분석': { bg: 'rgba(91,134,214,0.16)', accent: '#5b86d6', bar: '#bcd3f5' },
  '보완 중':     { bg: 'rgba(224,153,63,0.16)', accent: '#e0993f', bar: '#f6dbb0' },
  '수행평가':    { bg: 'rgba(144,112,216,0.16)', accent: '#9070d8', bar: 'rgba(139,111,216,0.45)' },
  '완료':       { bg: 'rgba(70,165,113,0.16)', accent: '#46a571', bar: '#bfe6cd' },
};
const theme = (col) => COL_THEME[col] || { bg: 'rgba(255,255,255,0.05)', accent: '#8a857c', bar: '#d8d3ca' };

// 성적 추이 SVG (내신 등급: 낮을수록 좋음 → 위로 갈수록 향상)
function GradeGraph({ grades }) {
  const pts = grades.filter(g => g.gpa != null && g.gpa !== '').map(g => ({ term: g.term, gpa: Number(g.gpa) }));
  if (pts.length === 0) return <div style={{ color: '#6b7d8a', fontSize: 13, padding: '12px 0' }}>성적 데이터를 추가하면 추이 그래프가 표시됩니다.</div>;
  const W = 460, H = 160, padL = 34, padB = 26, padT = 12, padR = 12;
  const xs = (i) => padL + (pts.length === 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (pts.length - 1));
  const gpas = pts.map(p => p.gpa);
  const min = Math.min(...gpas, 1), max = Math.max(...gpas, 9);
  const lo = Math.max(1, Math.floor(min)), hi = Math.min(9, Math.ceil(max));
  const span = Math.max(1, hi - lo);
  // gpa 낮을수록 위(향상). y: gpa=lo → top, gpa=hi → bottom
  const ys = (g) => padT + ((g - lo) / span) * (H - padT - padB);
  const line = pts.map((p, i) => `${xs(i)},${ys(p.gpa)}`).join(' ');
  const improved = pts.length >= 2 && pts[pts.length - 1].gpa < pts[0].gpa;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: '#1c2937', border: '1px solid #e8e6df', borderRadius: 8 }}>
      {[lo, (lo + hi) / 2, hi].map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={ys(v)} x2={W - padR} y2={ys(v)} stroke="#eee" />
          <text x={4} y={ys(v) + 4} fontSize="10" fill="#9b9890">{v}</text>
        </g>
      ))}
      <polyline points={line} fill="none" stroke={improved ? '#34d399' : '#14b8a6'} strokeWidth="2.5" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={xs(i)} cy={ys(p.gpa)} r="4" fill={improved ? '#34d399' : '#14b8a6'} />
          <text x={xs(i)} y={ys(p.gpa) - 9} fontSize="10" fill="#1a1916" textAnchor="middle">{p.gpa}</text>
          <text x={xs(i)} y={H - 8} fontSize="10" fill="#6b6860" textAnchor="middle">{p.term}</text>
        </g>
      ))}
    </svg>
  );
}

export default function Board({ onAuthError }) {
  const role = localStorage.getItem('ef_role') || 'user';
  const isAdmin = role === 'admin';
  const [columns, setColumns] = useState(['신규', '생기부 분석', '보완 중', '수행평가', '완료']);
  const [students, setStudents] = useState([]);
  const [teachers, setTeachers] = useState([]); // [{id,name}]
  const [teacherId, setTeacherId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null); // 선택된 학생
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [dragId, setDragId] = useState(null);
  const [dragOver, setDragOver] = useState(null);

  const handleErr = useCallback((e) => { if (e.auth) onAuthError?.(); else setError(e.message || '오류'); }, [onAuthError]);

  const loadStudents = useCallback(async (tid) => {
    setLoading(true);
    try {
      const q = isAdmin && tid ? `?teacherId=${tid}` : '';
      const d = await api(`/api/board/students${q}`);
      if (d.success) {
        if (d.columns) setColumns(d.columns);
        setStudents(d.students || []);
        setError(d.needTeacher && isAdmin ? '상단에서 선생님을 선택하세요.' : '');
      }
    } catch (e) { handleErr(e); }
    finally { setLoading(false); }
  }, [isAdmin, handleErr]);

  useEffect(() => {
    (async () => {
      if (isAdmin) {
        try {
          const t = await api('/api/board/teachers');
          if (t.success) {
            // 관리자 본인 보드 + 선생님들
            const opts = [];
            if (t.me?.id) opts.push({ id: t.me.id, name: t.me.name || '관리자 (나)' });
            opts.push(...(t.teachers || []));
            setTeachers(opts);
            const startId = t.me?.id || (t.teachers || [])[0]?.id;
            if (startId) { setTeacherId(String(startId)); loadStudents(startId); }
            else { setLoading(false); }
          }
        } catch (e) { handleErr(e); setLoading(false); }
      } else {
        loadStudents();
      }
    })();
  }, [isAdmin, loadStudents, handleErr]);

  const onSelectTeacher = (id) => { setTeacherId(id); loadStudents(id); };

  const refreshDetail = async () => { await loadStudents(isAdmin ? teacherId : undefined); };

  const addStudent = async () => {
    if (!newName.trim()) return;
    try {
      const body = { name: newName.trim(), status: columns[0] };
      if (isAdmin) body.teacherId = Number(teacherId);
      const d = await api('/api/board/students', { method: 'POST', body: JSON.stringify(body) });
      if (d.success) { setStudents(s => [...s, d.student]); setNewName(''); /* 연속 입력 위해 입력창 유지 */ }
      else setError(d.message || '추가 실패');
    } catch (e) { handleErr(e); }
  };

  const moveStudent = async (id, status) => {
    setStudents(list => list.map(s => s.id === id ? { ...s, status } : s));
    try { await api(`/api/board/students/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); }
    catch (e) { handleErr(e); }
  };

  const byColumn = (col) => students.filter(s => s.status === col);
  const canEdit = isAdmin || true; // 선생님은 본인 보드라 항상 편집 가능

  const S = STYLES;
  return (
    <div style={S.page}>
      <div style={S.headerRow}>
        <h2 style={S.h2}>📋 학생 관리 보드</h2>
        {isAdmin && (
          <div style={S.teacherPick}>
            <span style={{ color: '#9db0bd', fontSize: 13 }}>선생님</span>
            <select style={S.select} value={teacherId} onChange={e => onSelectTeacher(e.target.value)}>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name || t.code} ({t.student_count}명)</option>)}
            </select>
            <span style={S.adminTag}>관리자 보기</span>
          </div>
        )}
      </div>

      {error && <div style={S.error}>{error}</div>}
      {loading ? <div style={S.muted}>불러오는 중...</div> : (
        <div style={S.board}>
          {columns.map(col => {
            const th = theme(col);
            const over = dragOver === col;
            return (
              <div key={col}
                style={{ ...S.column, background: th.bg, outline: over ? `2px dashed ${th.accent}` : 'none', outlineOffset: -2 }}
                onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOver !== col) setDragOver(col); }}
                onDragLeave={() => setDragOver(o => (o === col ? null : o))}
                onDrop={e => {
                  e.preventDefault();
                  const id = dragId ?? Number(e.dataTransfer.getData('text/plain'));
                  if (id) moveStudent(id, col);
                  setDragId(null); setDragOver(null);
                }}>
                <div style={{ ...S.colHead, color: th.accent }}>
                  <span style={{ ...S.colDot, background: th.accent }} />
                  {col} <span style={{ ...S.colCount, color: th.accent }}>{byColumn(col).length}</span>
                </div>
                <div style={S.colBody}>
                  {byColumn(col).map(s => {
                    const gs = s.grades?.filter(g => g.gpa != null) || [];
                    const last = gs.slice(-1)[0], first = gs[0];
                    const trend = first && last && Number(last.gpa) < Number(first.gpa) ? '↑' : (first && last && Number(last.gpa) > Number(first.gpa) ? '↓' : '');
                    return (
                      <div key={s.id} style={{ ...S.card, borderTop: `3px solid ${th.bar}` }} draggable
                        onDragStart={e => { setDragId(s.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(s.id)); } catch {} }}
                        onDragEnd={() => { setDragId(null); setDragOver(null); }}
                        onClick={() => setDetail(s)} title="클릭: 상세 / 드래그: 단계 이동">
                        <div style={S.cardName}>{s.name}</div>
                        <div style={S.cardSub}>{[s.grade, s.major].filter(Boolean).join(' · ') || '정보 없음'}</div>
                        <div style={S.cardMeta}>
                          {last && <span style={S.gradeChip}>내신 {Number(last.gpa)} {trend && <b style={{ color: trend === '↑' ? '#34d399' : '#f87171' }}>{trend}</b>}</span>}
                          {s.records?.length > 0 && <span style={S.recChip}>기록 {s.records.length}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {col === columns[0] && (
                    adding ? (
                      <div style={S.addBox}>
                        <input autoFocus style={S.addInput} value={newName} onChange={e => setNewName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') addStudent(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
                          placeholder="학생 이름 (Enter로 연속 추가)" />
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          <button style={S.addConfirm} onClick={addStudent}>추가</button>
                          <button style={S.addCancel} onClick={() => { setAdding(false); setNewName(''); }}>닫기</button>
                        </div>
                      </div>
                    ) : (
                      <button style={S.addBtn} onClick={() => setAdding(true)}>+ 학생 추가</button>
                    )
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detail && (
        <StudentDetail
          student={students.find(s => s.id === detail.id) || detail}
          columns={columns}
          onClose={() => setDetail(null)}
          onChanged={refreshDetail}
          onError={handleErr}
        />
      )}
    </div>
  );
}

function StudentDetail({ student, columns, onClose, onChanged, onError }) {
  const [form, setForm] = useState({
    name: student.name || '', school: student.school || '', grade: student.grade || '',
    major: student.major || '', targetUniv: student.target_univ || '', status: student.status, notes: student.notes || '',
  });
  const [gTerm, setGTerm] = useState(''); const [gGpa, setGGpa] = useState(''); const [gNote, setGNote] = useState('');
  const [rType, setRType] = useState('생기부 분석'); const [rTitle, setRTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const S = STYLES;

  const save = async () => {
    setSaving(true);
    try { await api(`/api/board/students/${student.id}`, { method: 'PATCH', body: JSON.stringify(form) }); await onChanged(); }
    catch (e) { onError(e); } finally { setSaving(false); }
  };
  const del = async () => {
    if (!confirm(`'${student.name}' 학생 카드를 삭제할까요? 성적·기록도 함께 삭제됩니다.`)) return;
    try { await api(`/api/board/students/${student.id}`, { method: 'DELETE' }); await onChanged(); onClose(); }
    catch (e) { onError(e); }
  };
  const addGrade = async () => {
    if (!gTerm.trim()) return;
    try { await api(`/api/board/students/${student.id}/grades`, { method: 'POST', body: JSON.stringify({ term: gTerm, gpa: gGpa, note: gNote }) }); setGTerm(''); setGGpa(''); setGNote(''); await onChanged(); }
    catch (e) { onError(e); }
  };
  const delGrade = async (id) => { try { await api(`/api/board/grades/${id}`, { method: 'DELETE' }); await onChanged(); } catch (e) { onError(e); } };
  const addRecord = async () => {
    if (!rTitle.trim()) return;
    try { await api(`/api/board/students/${student.id}/records`, { method: 'POST', body: JSON.stringify({ type: rType, title: rTitle }) }); setRTitle(''); await onChanged(); }
    catch (e) { onError(e); }
  };
  const delRecord = async (id) => { try { await api(`/api/board/records/${id}`, { method: 'DELETE' }); await onChanged(); } catch (e) { onError(e); } };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.modalHead}>
          <input style={S.titleInput} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <button style={S.closeBtn} onClick={onClose}>×</button>
        </div>

        <div style={S.grid2}>
          <Field label="학교" v={form.school} on={v => setForm(f => ({ ...f, school: v }))} />
          <Field label="학년" v={form.grade} on={v => setForm(f => ({ ...f, grade: v }))} />
          <Field label="희망 전공" v={form.major} on={v => setForm(f => ({ ...f, major: v }))} />
          <Field label="목표 대학" v={form.targetUniv} on={v => setForm(f => ({ ...f, targetUniv: v }))} />
          <div>
            <label style={S.label}>단계</label>
            <select style={S.input} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
              {columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <label style={S.label}>보완점 / 메모</label>
        <textarea style={S.textarea} rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="보완할 점, 상담 메모 등" />

        <div style={S.sectionTitle}>성적 추이 (내신 등급 — 낮을수록 향상)</div>
        <GradeGraph grades={student.grades || []} />
        <div style={S.gradeList}>
          {(student.grades || []).map(g => (
            <div key={g.id} style={S.gradeRow}>
              <span style={{ fontWeight: 600 }}>{g.term}</span>
              <span>내신 {g.gpa != null ? Number(g.gpa) : '-'}</span>
              <span style={{ color: '#9db0bd', flex: 1 }}>{g.note}</span>
              <button style={S.miniDel} onClick={() => delGrade(g.id)}>삭제</button>
            </div>
          ))}
        </div>
        <div style={S.addRow}>
          <input style={{ ...S.input, flex: '0 0 90px' }} value={gTerm} onChange={e => setGTerm(e.target.value)} placeholder="학기(2-1)" />
          <input style={{ ...S.input, flex: '0 0 90px' }} value={gGpa} onChange={e => setGGpa(e.target.value)} placeholder="등급(2.3)" />
          <input style={{ ...S.input, flex: 1 }} value={gNote} onChange={e => setGNote(e.target.value)} placeholder="메모(선택)" />
          <button style={S.addSmall} onClick={addGrade}>+ 성적</button>
        </div>

        <div style={S.sectionTitle}>활동 기록 (분석 · 보완 · 수행평가)</div>
        <div style={S.gradeList}>
          {(student.records || []).map(r => (
            <div key={r.id} style={S.gradeRow}>
              <span style={S.recType}>{r.type}</span>
              <span style={{ flex: 1 }}>{r.title}</span>
              <span style={{ color: '#6b7d8a', fontSize: 12 }}>{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
              <button style={S.miniDel} onClick={() => delRecord(r.id)}>삭제</button>
            </div>
          ))}
        </div>
        <div style={S.addRow}>
          <select style={{ ...S.input, flex: '0 0 130px' }} value={rType} onChange={e => setRType(e.target.value)}>
            <option>생기부 분석</option><option>보완</option><option>수행평가</option><option>상담</option><option>기타</option>
          </select>
          <input style={{ ...S.input, flex: 1 }} value={rTitle} onChange={e => setRTitle(e.target.value)} placeholder="내용 (예: 1차 분석 완료)" />
          <button style={S.addSmall} onClick={addRecord}>+ 기록</button>
        </div>

        <div style={S.modalFooter}>
          <button style={S.delBtn} onClick={del}>학생 삭제</button>
          <button style={S.saveBtn} onClick={save} disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, v, on }) {
  return (
    <div>
      <label style={STYLES.label}>{label}</label>
      <input style={STYLES.input} value={v} onChange={e => on(e.target.value)} />
    </div>
  );
}

const STYLES = {
  page: { padding: '24px 28px', color: '#e8eef3' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 },
  h2: { fontSize: 22, fontWeight: 700, margin: 0 },
  teacherPick: { display: 'flex', alignItems: 'center', gap: 8 },
  select: { padding: '8px 12px', borderRadius: 8, border: '1px solid #d8d5cc', background: '#16212e', color: '#e8eef3', fontSize: 14 },
  adminTag: { background: 'rgba(45,212,191,0.15)', color: '#14b8a6', fontSize: 12, fontWeight: 600, padding: '4px 10px', borderRadius: 20 },
  error: { background: 'rgba(251,191,36,0.14)', border: '1px solid #fcd34d', color: '#fbbf24', padding: '10px 14px', borderRadius: 9, marginBottom: 14, fontSize: 13.5 },
  muted: { color: '#6b7d8a', fontSize: 14, padding: 20 },
  board: { display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 12, alignItems: 'flex-start' },
  column: { flex: '0 0 248px', background: '#131c26', borderRadius: 12, padding: 10, minHeight: 200 },
  colHead: { display: 'flex', alignItems: 'center', gap: 7, fontWeight: 700, fontSize: 14, padding: '4px 6px 10px' },
  colDot: { width: 9, height: 9, borderRadius: '50%', display: 'inline-block' },
  colCount: { marginLeft: 'auto', background: '#16212e', color: '#9db0bd', borderRadius: 10, padding: '1px 8px', fontSize: 12 },
  colBody: { display: 'flex', flexDirection: 'column', gap: 8 },
  card: { background: '#16212e', border: '1px solid #e8e6df', borderRadius: 10, padding: '11px 12px', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  cardName: { fontWeight: 700, fontSize: 14.5, color: '#e8eef3' },
  cardSub: { fontSize: 12.5, color: '#9db0bd', marginTop: 2 },
  cardMeta: { display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  gradeChip: { background: 'rgba(45,212,191,0.15)', color: '#14b8a6', fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 12 },
  recChip: { background: 'rgba(52,211,153,0.14)', color: '#34d399', fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 12 },
  addBtn: { background: 'transparent', border: '1px dashed #c9c6bd', color: '#9db0bd', borderRadius: 9, padding: '9px', cursor: 'pointer', fontSize: 13, marginTop: 2 },
  addBox: { background: '#16212e', border: '1px solid #14b8a6', borderRadius: 9, padding: 8 },
  addInput: { width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #d8d5cc', fontSize: 13.5, boxSizing: 'border-box', outline: 'none' },
  addConfirm: { flex: 1, background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 7, padding: '6px', cursor: 'pointer', fontSize: 13 },
  addCancel: { flex: 1, background: '#131c26', color: '#9db0bd', border: '1px solid #d8d5cc', borderRadius: 7, padding: '6px', cursor: 'pointer', fontSize: 13 },
  // 상세 모달
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: '40px 16px' },
  modal: { background: '#16212e', borderRadius: 16, padding: 24, width: 560, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  modalHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 },
  titleInput: { flex: 1, fontSize: 19, fontWeight: 700, border: 'none', borderBottom: '2px solid #e8e6df', padding: '4px 2px', outline: 'none', color: '#e8eef3' },
  closeBtn: { background: 'transparent', border: 'none', fontSize: 26, color: '#6b7d8a', cursor: 'pointer', lineHeight: 1 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#9db0bd', margin: '8px 0 4px' },
  input: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #d8d5cc', background: '#16212e', color: '#e8eef3', fontSize: 13.5, outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid #d8d5cc', background: '#16212e', color: '#e8eef3', fontSize: 13.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#e8eef3', margin: '20px 0 8px' },
  gradeList: { display: 'flex', flexDirection: 'column', gap: 5, margin: '8px 0' },
  gradeRow: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '5px 8px', background: '#1c2937', borderRadius: 7 },
  recType: { background: 'rgba(45,212,191,0.15)', color: '#14b8a6', fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 10 },
  miniDel: { background: 'transparent', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer' },
  addRow: { display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' },
  addSmall: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  modalFooter: { display: 'flex', justifyContent: 'space-between', marginTop: 22 },
  delBtn: { background: 'rgba(248,113,113,0.14)', color: '#f87171', border: '1px solid #fca5a5', borderRadius: 9, padding: '10px 16px', cursor: 'pointer', fontSize: 13.5 },
  saveBtn: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 24px', fontWeight: 700, cursor: 'pointer', fontSize: 14 },
};
