import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../apiBase';

const token = () => localStorage.getItem('ef_token');

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) { const e = new Error('세션 만료 — 다시 로그인하세요'); e.auth = true; throw e; }
  return res.json(); // 403 등은 {success:false,message} 그대로 반환 (모달에서 표시)
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

// 마크다운(분석/수행평가 본문) → HTML (다크용: 제목/굵게/표/목록/구분선)
function mdToHtml(md) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b style="color:#e8eef3">$1</b>');
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    if (t === '---' || /^[-=]{3,}$/.test(t)) { html += '<hr style="border:none;border-top:1px solid #2a3a48;margin:10px 0"/>'; i++; continue; }
    if (t.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i]); i++; }
      const rows = block.filter(l => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l) || !l.includes('-'));
      html += '<table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:12.5px">';
      rows.forEach((r, ri) => {
        const cells = r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        html += '<tr>' + cells.map(c => {
          const tag = ri === 0 ? 'th' : 'td';
          const st = ri === 0 ? 'background:rgba(45,212,191,0.12);color:#7ff0e3' : 'color:#cdd9e2';
          return `<${tag} style="border:1px solid #2a3a48;padding:5px 8px;text-align:left;${st}">${inline(c)}</${tag}>`;
        }).join('') + '</tr>';
      });
      html += '</table>';
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const sz = [0, 17, 15.5, 14, 13][h[1].length] || 14; html += `<div style="font-weight:700;color:#2dd4bf;font-size:${sz}px;margin:12px 0 5px">${inline(h[2])}</div>`; i++; continue; }
    const stepH = t.match(/^\[(\d+단계)\]\s*(.*)$/);
    if (stepH) { html += `<div style="font-weight:700;color:#2dd4bf;font-size:15px;margin:14px 0 6px">[${stepH[1]}] ${inline(stepH[2])}</div>`; i++; continue; }
    const b = t.match(/^[-*]\s+(.*)$/);
    if (b) { html += `<div style="margin:2px 0 2px 12px;color:#cdd9e2">• ${inline(b[1])}</div>`; i++; continue; }
    const num = t.match(/^(\d+\.)\s+(.*)$/);
    if (num) { html += `<div style="margin:2px 0 2px 12px;color:#cdd9e2">${num[1]} ${inline(num[2])}</div>`; i++; continue; }
    html += `<p style="margin:5px 0;color:#cdd9e2">${inline(t)}</p>`;
    i++;
  }
  return html;
}

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
  const [rType, setRType] = useState('생기부 분석'); const [rTitle, setRTitle] = useState(''); const [rContent, setRContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedRec, setExpandedRec] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);
  const S = STYLES;

  // 응답 success까지 검사 (실패 시 throw)
  const call = async (path, opts) => {
    const d = await api(path, opts);
    if (d && d.success === false) throw new Error(d.message || '처리 실패');
    return d;
  };
  const fail = (e) => { if (e.auth) onError(e); setMsg('⚠ ' + (e.message || '오류')); };

  const save = async () => {
    setSaving(true); setMsg('');
    try { await call(`/api/board/students/${student.id}`, { method: 'PATCH', body: JSON.stringify(form) }); await onChanged(); setMsg('✓ 저장됨'); }
    catch (e) { fail(e); } finally { setSaving(false); }
  };
  const del = async () => {
    if (!confirm(`'${student.name}' 학생 카드를 삭제할까요? 성적·기록도 함께 삭제됩니다.`)) return;
    try { await call(`/api/board/students/${student.id}`, { method: 'DELETE' }); await onChanged(); onClose(); }
    catch (e) { fail(e); }
  };
  const addGrade = async () => {
    if (!gTerm.trim()) { setMsg('학기를 입력하세요 (예: 2-1)'); return; }
    setMsg('');
    try { await call(`/api/board/students/${student.id}/grades`, { method: 'POST', body: JSON.stringify({ term: gTerm, gpa: gGpa, note: gNote }) }); setGTerm(''); setGGpa(''); setGNote(''); await onChanged(); }
    catch (e) { fail(e); }
  };
  const delGrade = async (id) => { try { await call(`/api/board/grades/${id}`, { method: 'DELETE' }); await onChanged(); } catch (e) { fail(e); } };
  const addRecord = async () => {
    if (!rTitle.trim() && !rContent.trim()) { setMsg('제목 또는 내용을 입력하세요'); return; }
    setMsg('');
    try { await call(`/api/board/students/${student.id}/records`, { method: 'POST', body: JSON.stringify({ type: rType, title: rTitle || rType, content: rContent }) }); setRTitle(''); setRContent(''); await onChanged(); }
    catch (e) { fail(e); }
  };
  const delRecord = async (id) => { try { await call(`/api/board/records/${id}`, { method: 'DELETE' }); await onChanged(); } catch (e) { fail(e); } };

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true); setMsg('');
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      const res = await fetch(`${API_BASE}/api/board/students/${student.id}/files`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || '업로드 실패');
      await onChanged(); setMsg('✓ 파일 업로드됨');
    } catch (e) { fail(e); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const downloadFile = async (f) => {
    try {
      const res = await fetch(`${API_BASE}/api/board/files/${f.id}`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) return onError(new Error('다운로드 실패'));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { onError(e); }
  };
  const delFile = async (id) => { try { await api(`/api/board/files/${id}`, { method: 'DELETE' }); await onChanged(); } catch (e) { onError(e); } };
  const fmtSize = (b) => b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.modalHead}>
          <input style={S.titleInput} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <button style={S.closeBtn} onClick={onClose}>×</button>
        </div>
        {msg && <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 13, background: msg.startsWith('✓') ? 'rgba(52,211,153,0.14)' : 'rgba(248,113,113,0.14)', color: msg.startsWith('✓') ? '#34d399' : '#f87171', border: `1px solid ${msg.startsWith('✓') ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'}` }}>{msg}</div>}

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

        <div style={S.sectionTitle}>생기부 분석 · 수행평가 · 활동 기록</div>
        <div style={S.gradeList}>
          {(student.records || []).length === 0 && <div style={{ color: '#6b7d8a', fontSize: 13 }}>아직 기록이 없습니다. 분석/수행평가를 하면 자동으로 쌓이고, 아래에서 직접 추가할 수도 있습니다.</div>}
          {(student.records || []).map(r => (
            <div key={r.id}>
              <div style={S.gradeRow}>
                <span style={S.recType}>{r.type}</span>
                <span style={{ flex: 1 }}>{r.title}</span>
                {r.content ? <button style={S.viewBtn} onClick={() => setExpandedRec(expandedRec === r.id ? null : r.id)}>{expandedRec === r.id ? '닫기' : '내용 보기'}</button> : null}
                <span style={{ color: '#6b7d8a', fontSize: 12 }}>{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                <button style={S.miniDel} onClick={() => delRecord(r.id)}>삭제</button>
              </div>
              {expandedRec === r.id && r.content && (
                <div style={S.recContent} dangerouslySetInnerHTML={{ __html: mdToHtml(r.content) }} />
              )}
            </div>
          ))}
        </div>
        <div style={S.addRow}>
          <select style={{ ...S.input, flex: '0 0 120px' }} value={rType} onChange={e => setRType(e.target.value)}>
            <option>생기부 분석</option><option>보완</option><option>수행평가</option><option>상담</option><option>기타</option>
          </select>
          <input style={{ ...S.input, flex: 1 }} value={rTitle} onChange={e => setRTitle(e.target.value)} placeholder="제목 (예: 1차 분석 요약)" />
          <button style={S.addSmall} onClick={addRecord}>+ 기록</button>
        </div>
        <textarea style={{ ...S.textarea, marginTop: 6 }} rows={2} value={rContent} onChange={e => setRContent(e.target.value)} placeholder="기록 내용/메모를 붙여넣어 보관 (선택)" />

        <div style={S.sectionTitle}>첨부 파일 (생기부 PDF, 수행평가 결과물 등)</div>
        <div style={S.gradeList}>
          {(student.files || []).length === 0 && <div style={{ color: '#6b7d8a', fontSize: 13 }}>업로드된 파일이 없습니다.</div>}
          {(student.files || []).map(f => (
            <div key={f.id} style={S.gradeRow}>
              <span style={{ flex: 1 }}>📎 {f.name}</span>
              <span style={{ color: '#6b7d8a', fontSize: 12 }}>{fmtSize(f.size || 0)}</span>
              <button style={S.viewBtn} onClick={() => downloadFile(f)}>다운로드</button>
              <button style={S.miniDel} onClick={() => delFile(f.id)}>삭제</button>
            </div>
          ))}
        </div>
        <div style={S.addRow}>
          <button style={S.addSmall} onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? '업로드 중...' : '📎 파일 첨부'}</button>
          <input ref={fileRef} type="file" multiple style={{ display: 'none' }} onChange={e => uploadFiles(e.target.files)} />
          <span style={{ color: '#6b7d8a', fontSize: 12 }}>여러 개 가능 · 1개당 15MB 이하</span>
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
  addInput: { width: '100%', padding: '7px 9px', borderRadius: 7, border: '1px solid #3a4a58', background: '#0e1620', color: '#e8eef3', fontSize: 13.5, boxSizing: 'border-box', outline: 'none' },
  addConfirm: { flex: 1, background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 7, padding: '6px', cursor: 'pointer', fontSize: 13 },
  addCancel: { flex: 1, background: '#131c26', color: '#9db0bd', border: '1px solid #d8d5cc', borderRadius: 7, padding: '6px', cursor: 'pointer', fontSize: 13 },
  // 상세 모달
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: '40px 16px' },
  modal: { background: '#16212e', borderRadius: 16, padding: 24, width: 560, maxWidth: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' },
  modalHead: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 },
  titleInput: { flex: 1, fontSize: 19, fontWeight: 700, border: 'none', borderBottom: '2px solid #2a3a48', padding: '4px 2px', outline: 'none', color: '#e8eef3', background: 'transparent' },
  closeBtn: { background: 'transparent', border: 'none', fontSize: 26, color: '#6b7d8a', cursor: 'pointer', lineHeight: 1 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 },
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#9db0bd', margin: '8px 0 4px' },
  input: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #d8d5cc', background: '#16212e', color: '#e8eef3', fontSize: 13.5, outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '9px 11px', borderRadius: 8, border: '1px solid #d8d5cc', background: '#16212e', color: '#e8eef3', fontSize: 13.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#e8eef3', margin: '20px 0 8px' },
  gradeList: { display: 'flex', flexDirection: 'column', gap: 5, margin: '8px 0' },
  gradeRow: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '5px 8px', background: '#1c2937', borderRadius: 7 },
  recType: { background: 'rgba(45,212,191,0.15)', color: '#2dd4bf', fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' },
  miniDel: { background: 'transparent', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer' },
  viewBtn: { background: 'rgba(45,212,191,0.12)', border: '1px solid rgba(45,212,191,0.4)', color: '#2dd4bf', fontSize: 11.5, cursor: 'pointer', borderRadius: 6, padding: '3px 9px', whiteSpace: 'nowrap' },
  recContent: { background: '#0e1620', border: '1px solid #2a3a48', borderRadius: 8, padding: '12px 16px', margin: '4px 0 8px', fontSize: 13, lineHeight: 1.65, color: '#cdd9e2', maxHeight: 420, overflowY: 'auto' },
  addRow: { display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' },
  addSmall: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  modalFooter: { display: 'flex', justifyContent: 'space-between', marginTop: 22 },
  delBtn: { background: 'rgba(248,113,113,0.14)', color: '#f87171', border: '1px solid #fca5a5', borderRadius: 9, padding: '10px 16px', cursor: 'pointer', fontSize: 13.5 },
  saveBtn: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 24px', fontWeight: 700, cursor: 'pointer', fontSize: 14 },
};
