import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../apiBase';
import RoadmapView from './RoadmapView';
import VerifyPanel from './VerifyPanel';

const token = () => localStorage.getItem('ef_token');

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  if (res.status === 401) { const e = new Error('세션 만료 — 다시 로그인하세요'); e.auth = true; throw e; }
  return res.json(); // 403 등은 {success:false,message} 그대로 반환 (모달에서 표시)
}

// 오래 걸리는 AI 호출은 SSE(keepalive)로 온다 — success 가 있는 이벤트가 결과, 나머지는 진행 알림
async function postForResult(url, opts, onStage) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    try { return await res.json(); }
    catch { return { success: false, message: `서버 응답 오류 (HTTP ${res.status}) — 서버 업데이트 적용 중일 수 있습니다. 잠시 후 다시 시도해주세요.` }; }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const obj = JSON.parse(line.slice(6));
          if (obj.success !== undefined) result = obj;
          else if (obj.message) onStage?.(obj.message);
        } catch {}
      }
    }
  }
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}

// 설정에 저장된 AI 키 (스캔 PDF OCR·로드맵 생성 등에 쓰인다)
const aiCreds = () => {
  const model = localStorage.getItem('ef_model') || 'claude';
  const group = model.startsWith('gemini') ? 'gemini' : model.startsWith('gpt') || model.startsWith('o') ? 'gpt' : 'claude';
  const keyName = { claude: 'ef_apikey', gemini: 'ef_geminikey', gpt: 'ef_gptkey' }[group];
  return { model, group, apiKey: localStorage.getItem(keyName) };
};

// 이 앱의 분석 결과 JSON(내보내기 파일) → 기록 본문 텍스트
const ANALYSIS_SECTIONS = [
  ['caseMatching', '0단계 · 합격자 사례 매칭 분석'],
  ['academic', '1단계 · 학업역량 종합 분석'],
  ['activity', '2단계 · 비교과 활동 평가'],
  ['career', '3단계 · 진로 역량 및 전공 적합성'],
  ['strategy', '4단계 · 수시 지원 전략'],
  ['roadmap', '5단계 · 핵심 리스크 및 대응 방안'],
  ['recordFeedback', '6단계 · 실행 계획'],
  ['dashboard', '7단계 · 종합 평가 및 권고사항'],
];
function analysisJsonToText(data) {
  const results = data?.results || {};
  const known = ANALYSIS_SECTIONS.filter(([k]) => results[k]).map(([k, label]) => `## ${label}\n${results[k]}`);
  // 스키마가 다른 파일(다른 도구에서 만든 것)도 버리지 않고 키 이름 그대로 담는다
  const extra = Object.entries(results)
    .filter(([k, v]) => v && !ANALYSIS_SECTIONS.some(([kk]) => kk === k))
    .map(([k, v]) => `## ${k}\n${typeof v === 'string' ? v : JSON.stringify(v, null, 1)}`);
  return [...known, ...extra].join('\n\n');
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


// 교차 검증에 함께 넘길 근거 자료. 글만 주면 모델은 트집만 잡는다 — 비출 것을 함께 준다.
function recordVerifyContext(student) {
  if (!student) return '';
  const L = [];
  L.push(`[학생] ${student.name || ''} · ${student.school || '학교 미입력'} · ${student.grade || '학년 미입력'}`
    + ` · 희망 ${student.major || '미입력'} · 목표 ${student.target_univ || '미입력'}`);
  if (student.gpa != null && student.gpa !== '') L.push(`[대표 내신] ${student.gpa}`);
  if ((student.grades || []).length) {
    L.push(`[학기 성적] ${student.grades.map((g) => `${g.term} ${g.gpa ?? '-'}`).join(' · ')}`);
  }
  const others = (student.records || []).filter((x) => x.content).slice(0, 4);
  if (others.length) {
    L.push('[같은 학생의 다른 기록 — 앞뒤가 맞는지 함께 보라]');
    for (const o of others) L.push(`- (${o.type || '기록'}) ${o.title || ''}: ${String(o.content).slice(0, 700)}`);
  }
  return L.join('\n');
}

export default function Board({ onAuthError, onAnalyzeFile }) {
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
                          {(s.files || []).some(f => String(f.kind || '').startsWith('학생업로드')) &&
                            <span style={{ ...S.recChip, background: '#fef3c7', color: '#92400e' }}>📤 학생자료</span>}
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
          onAnalyzeFile={onAnalyzeFile}
        />
      )}
    </div>
  );
}

function StudentDetail({ student, columns, onClose, onChanged, onError, onAnalyzeFile }) {
  const [form, setForm] = useState({
    name: student.name || '', school: student.school || '', grade: student.grade || '',
    major: student.major || '', targetUniv: student.target_univ || '', status: student.status, notes: student.notes || '',
    gpa: student.gpa ?? '',
  });
  const [gTerm, setGTerm] = useState(''); const [gGpa, setGGpa] = useState(''); const [gNote, setGNote] = useState('');
  const [rType, setRType] = useState('생기부 분석'); const [rTitle, setRTitle] = useState(''); const [rContent, setRContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [expandedRec, setExpandedRec] = useState(null);
  const [viewRec, setViewRec] = useState(null); // 큰 화면 본문 뷰어
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef(null);
  // 외부에서 만든 분석 자료 가져오기 (문서/PDF/한글/JSON)
  const [impBusy, setImpBusy] = useState('');
  const [impMsg, setImpMsg] = useState('');
  const recFileRef = useRef(null);
  const recJsonRef = useRef(null);
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
    const had = rContent.trim().length;
    try {
      await call(`/api/board/students/${student.id}/records`, { method: 'POST', body: JSON.stringify({ type: rType, title: rTitle || rType, content: rContent }) });
      setRTitle(''); setRContent(''); setImpMsg('');
      await onChanged();
      setMsg(had
        ? `✓ 기록 저장됨 (${had.toLocaleString()}자) — 입시상담·컨설턴트 브리핑·입결 AI 판정에서 이 학생의 근거로 쓰입니다`
        : '✓ 기록 저장됨');
    }
    catch (e) { fail(e); }
  };
  const delRecord = async (id) => { try { await call(`/api/board/records/${id}`, { method: 'DELETE' }); await onChanged(); } catch (e) { fail(e); } };

  // ── 다른 곳에서 만든 분석 자료 가져오기 ──────────────────
  // 파일(PDF·워드·한글·txt)에서 글자를 뽑아 기록 본문에 채운다. 스캔본은 서버가 AI로 판독한다.
  const importRecordFiles = async (fileList) => {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    setImpBusy('file'); setImpMsg('파일에서 글자를 읽는 중… (스캔본이면 AI 판독이라 몇 분 걸립니다)');
    try {
      const fd = new FormData();
      list.forEach((f) => fd.append('files', f));
      const { model, group, apiKey } = aiCreds();
      const d = await postForResult(`${API_BASE}/api/assessment/extract`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token()}`,
          ...(apiKey ? { 'x-api-key': apiKey, 'x-ai-model': group, 'x-ai-submodel': model } : {}),
        },
        body: fd,
      }, (stage) => setImpMsg(stage));
      if (!d.success) throw new Error(d.message || '추출 실패');
      if (!d.text?.trim()) throw new Error('텍스트를 추출하지 못했습니다 (스캔본이면 설정에 AI 키를 등록해 주세요)');
      setRContent((prev) => (prev ? prev + '\n\n' : '') + d.text);
      if (!rTitle.trim()) setRTitle(list[0].name.replace(/\.[^.]+$/, ''));
      setImpMsg(d.notices?.length ? '⚠ ' + d.notices.join(' / ') : `✓ ${list.length}개 파일에서 ${d.text.length.toLocaleString()}자를 가져왔습니다. 아래 [+ 기록]으로 저장하세요.`);
    } catch (e) { setImpMsg('⚠ ' + e.message); }
    finally { setImpBusy(''); if (recFileRef.current) recFileRef.current.value = ''; }
  };

  // 이 앱에서 내보낸 분석 JSON(또는 유사 구조)을 단계별 본문으로 펼쳐 담는다
  const importRecordJson = async (fileList) => {
    const f = Array.from(fileList || [])[0];
    if (!f) return;
    setImpBusy('json'); setImpMsg('');
    try {
      const data = JSON.parse(await f.text());
      const text = analysisJsonToText(data);
      if (!text.trim()) throw new Error('분석 내용을 찾지 못했습니다 (results 항목이 있는 분석 JSON이어야 합니다)');
      setRContent((prev) => (prev ? prev + '\n\n' : '') + text);
      if (!rTitle.trim()) {
        const who = data?.studentData?.name ? `${data.studentData.name} ` : '';
        setRTitle(`${who}생기부 분석${data?.analyzedModel ? ` (${data.analyzedModel})` : ''}`);
      }
      setImpMsg(`✓ ${text.length.toLocaleString()}자를 가져왔습니다. 아래 [+ 기록]으로 저장하세요.`);
    } catch (e) { setImpMsg('⚠ ' + (e.message || 'JSON을 읽지 못했습니다')); }
    finally { setImpBusy(''); if (recJsonRef.current) recJsonRef.current.value = ''; }
  };

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

  // 학생 셀프 열람 코드
  const issueCode = async () => {
    try { const d = await call(`/api/board/students/${student.id}/code`, { method: 'POST' }); await onChanged(); setMsg(`✓ 열람 코드 발급됨: ${d.code}`); }
    catch (e) { fail(e); }
  };
  const revokeCode = async () => {
    if (!confirm('열람 코드를 해제할까요? 학생이 더 이상 조회할 수 없게 됩니다.')) return;
    try { await call(`/api/board/students/${student.id}/code`, { method: 'DELETE' }); await onChanged(); setMsg('✓ 열람 코드 해제됨'); }
    catch (e) { fail(e); }
  };
  const copyCode = async () => { await navigator.clipboard.writeText(student.student_code); setMsg('✓ 코드 복사됨 — 학생에게 전달하세요'); };
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
          <div>
            <label style={S.label}>대표 내신 (전 교과 환산)</label>
            <input style={S.input} type="number" min="1" max="9" step="0.01" value={form.gpa}
              placeholder="예: 2.69"
              onChange={e => setForm(f => ({ ...f, gpa: e.target.value }))} />
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: '#6b7d8a', margin: '2px 0 6px', lineHeight: 1.6 }}>
          대표 내신은 <b style={{ color: '#9db0bd' }}>입결 콘솔의 배치 판정 기준</b>이 됩니다. 분석할 때 입력한 내신이 자동으로 들어오고, 여기서 고치면 그 값이 우선합니다.
        </div>

        <label style={S.label}>보완점 / 메모</label>
        <textarea style={S.textarea} rows={3} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="보완할 점, 상담 메모 등" />

        <div style={S.sectionTitle}>학생 열람 코드 — 학생이 코드만으로 본인 기록·배치를 봅니다</div>
        <div style={S.addRow}>
          {student.student_code ? (
            <>
              <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: '#34d399', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.4)', borderRadius: 8, padding: '5px 12px', letterSpacing: 1 }}>{student.student_code}</span>
              <button style={S.viewBtn} onClick={copyCode}>복사</button>
              <button style={S.viewBtn} onClick={issueCode}>재발급</button>
              <button style={S.miniDel} onClick={revokeCode}>해제</button>
            </>
          ) : (
            <button style={S.addSmall} onClick={issueCode}>🔑 열람 코드 발급</button>
          )}
          <span style={{ color: '#6b7d8a', fontSize: 12 }}>로그인 화면 '학생 코드로 내 기록 보기'에서 입력</span>
        </div>

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
                {r.content ? <button style={S.viewBtn} onClick={() => setExpandedRec(expandedRec === r.id ? null : r.id)}>{expandedRec === r.id ? '닫기' : '미리 보기'}</button> : null}
                {r.content ? <button style={S.viewBtn} onClick={() => setViewRec(r)}>🔍 크게 보기</button> : null}
                <span style={{ color: '#6b7d8a', fontSize: 12 }}>{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                <button style={S.miniDel} onClick={() => delRecord(r.id)}>삭제</button>
              </div>
              {expandedRec === r.id && r.content && (
                <>
                  <div style={S.recContent} dangerouslySetInnerHTML={{ __html: mdToHtml(r.content) }} />
                  {/* 이 글이 맞는지 다른 회사 모델들에게 — 쓴 모델은 자기 글을 옹호한다 */}
                  <VerifyPanel
                    kind={/입결|배치|판정/.test(r.type || '') ? 'ipgyeol' : /로드맵/.test(r.type || '') ? 'roadmap' : /분석|생기부|세특|수행/.test(r.type || '') ? 'saenggibu' : 'record'}
                    text={`${r.title || ''}

${r.content || ''}`}
                    context={recordVerifyContext(student)} />
                </>
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

        {/* 다른 곳에서 만든 분석을 그대로 이 학생 기록으로 — 저장하면 상담·브리핑·입결 판정의 근거가 된다 */}
        <div style={S.importBox}>
          <div style={S.importHead}>📥 다른 곳에서 한 분석 가져오기</div>
          <div style={S.importDesc}>
            타 기관 컨설팅 리포트, 다른 AI로 돌린 분석, 직접 쓴 진단서를 파일째 넣으면 글자만 뽑아 본문에 채웁니다.
            저장된 기록은 <b style={{ color: '#2dd4bf' }}>입시상담 · 컨설턴트 브리핑 · 입결 콘솔 AI 판정</b>에서 이 학생의 근거로 그대로 쓰입니다.
          </div>
          <div style={S.addRow}>
            <button style={S.addSmall} onClick={() => recFileRef.current?.click()} disabled={!!impBusy}>
              {impBusy === 'file' ? '읽는 중…' : '📎 문서에서 불러오기 (PDF·워드·한글)'}
            </button>
            <input ref={recFileRef} type="file" multiple style={{ display: 'none' }}
              accept=".pdf,.docx,.hwp,.hwpx,.txt,.md" onChange={e => importRecordFiles(e.target.files)} />
            <button style={S.viewBtn} onClick={() => recJsonRef.current?.click()} disabled={!!impBusy}>
              {impBusy === 'json' ? '읽는 중…' : '🗂 분석 JSON 불러오기'}
            </button>
            <input ref={recJsonRef} type="file" style={{ display: 'none' }} accept=".json" onChange={e => importRecordJson(e.target.files)} />
            {rContent && <span style={{ color: '#9db0bd', fontSize: 12 }}>본문 {rContent.length.toLocaleString()}자</span>}
            {rContent && <button style={S.miniDel} onClick={() => { setRContent(''); setImpMsg(''); }}>비우기</button>}
          </div>
          {impMsg && (
            <div style={{ fontSize: 12.5, marginTop: 7, color: impMsg.startsWith('✓') ? '#34d399' : '#fbbf24', lineHeight: 1.6 }}>{impMsg}</div>
          )}
        </div>

        <textarea style={{ ...S.textarea, marginTop: 6 }} rows={rContent ? 6 : 2} value={rContent} onChange={e => setRContent(e.target.value)}
          placeholder="기록 내용/메모를 직접 붙여넣어도 됩니다 (선택)" />

        <RoadmapSection student={student} onError={onError} onChanged={onChanged} />

        <div style={S.sectionTitle}>첨부 파일 (생기부 PDF, 수행평가 결과물 등)</div>
        <div style={S.gradeList}>
          {(student.files || []).length === 0 && <div style={{ color: '#6b7d8a', fontSize: 13 }}>업로드된 파일이 없습니다.</div>}
          {(student.files || []).map(f => {
            const isStudentUpload = String(f.kind || '').startsWith('학생업로드');
            const analyzable = /\.pdf$/i.test(f.name || '') || f.mime === 'application/pdf';
            return (
            <div key={f.id} style={S.gradeRow}>
              {isStudentUpload &&
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#92400e', background: '#fef3c7', borderRadius: 5, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                  📤 {String(f.kind).replace('학생업로드-', '')}
                </span>}
              <span style={{ flex: 1, wordBreak: 'break-all' }}>📎 {f.name}</span>
              <span style={{ color: '#6b7d8a', fontSize: 12 }}>{fmtSize(f.size || 0)}</span>
              {analyzable && onAnalyzeFile &&
                <button style={{ ...S.viewBtn, background: '#4f7cff', color: '#fff', borderColor: '#4f7cff' }}
                  onClick={() => onAnalyzeFile(student, f)} title="이 파일을 생기부로 넣고 AI 분석 시작">🔬 분석</button>}
              <button style={S.viewBtn} onClick={() => downloadFile(f)}>다운로드</button>
              <button style={S.miniDel} onClick={() => delFile(f.id)}>삭제</button>
            </div>
            );
          })}
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

      {/* 기록 본문 큰 화면 뷰어 */}
      {viewRec && (
        <div style={S.viewerOverlay} onClick={(e) => { e.stopPropagation(); setViewRec(null); }}>
          <div style={S.viewerBox} onClick={(e) => e.stopPropagation()}>
            <div style={S.viewerHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={S.recType}>{viewRec.type}</span>
                <b style={{ color: '#e8eef3', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{viewRec.title}</b>
                <span style={{ color: '#6b7d8a', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(viewRec.created_at).toLocaleDateString('ko-KR')}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={S.viewBtn} onClick={() => navigator.clipboard.writeText(viewRec.content)}>복사</button>
                <button style={S.viewBtn} onClick={() => setViewRec(null)}>닫기 ✕</button>
              </div>
            </div>
            <div style={S.viewerBody} dangerouslySetInnerHTML={{ __html: mdToHtml(viewRec.content) }} />
          </div>
        </div>
      )}
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

// ── 생기부 로드맵 ──────────────────────────────────────
// ① 수행평가·탐구보고서 원자료를 통째로 넣으면 AI가 로드맵 보고서를 쓰고
// ② 그것을 학생이 체크할 실행 항목으로 쪼개 저장한다. 이미 만든 로드맵 문서를 올려 항목만 뽑을 수도 있다.
function RoadmapSection({ student, onError, onChanged }) {
  const S = STYLES;
  const [roadmaps, setRoadmaps] = useState([]);
  const [mode, setMode] = useState('generate'); // generate | analyze
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [nextSubjects, setNextSubjects] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [draft, setDraft] = useState(null);
  const [viewBody, setViewBody] = useState(null);
  const [sel, setSel] = useState(() => new Set()); // 첨부 파일 재사용 선택
  const rmFileRef = useRef(null);

  // 학생 첨부 파일 중 텍스트 추출이 되는 형식 — 로드맵을 다시 만들 때 재사용한다
  const attachables = (student.files || []).filter(f => /\.(pdf|docx|hwpx?|txt|md)$/i.test(f.name || ''));
  const rmFmtSize = (b) => b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`;

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/board/students/${student.id}/roadmaps`);
      if (d.success) setRoadmaps(d.roadmaps || []);
      else setMsg('⚠ ' + (d.message || '로드맵 조회 실패'));
    } catch (e) { if (e.auth) onError?.(e); }
  }, [student.id]);
  useEffect(() => { load(); }, [load]);

  const call = async (path, opts) => {
    const d = await api(path, opts);
    if (d && d.success === false) throw new Error(d.message || '처리 실패');
    return d;
  };
  // 목록을 다시 읽는다. 성공 문구는 남기고 이전 오류 문구만 지운다
  // (여기서 무조건 지우면 저장 성공 안내가 사라져 저장이 안 된 줄 알고 또 누르게 된다)
  const act = async (fn) => {
    try { await fn(); await load(); setMsg(m => (m.startsWith('⚠') ? '' : m)); }
    catch (e) { if (e.auth) onError?.(e); else setMsg('⚠ ' + e.message); }
  };

  // 파일 묶음 → 텍스트 추출 (SSE — 스캔 PDF는 서버가 AI로 OCR하므로 오래 걸릴 수 있다)
  // 서버 extract가 요청당 10개 제한이라 10개씩 나눠 부른다
  const extractChunks = async (fileObjs) => {
    const { model, group, apiKey } = aiCreds();
    let all = '';
    const notices = [];
    for (let i = 0; i < fileObjs.length; i += 10) {
      const fd = new FormData();
      fileObjs.slice(i, i + 10).forEach(f => fd.append('files', f));
      const d = await postForResult(`${API_BASE}/api/assessment/extract`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token()}`,
          ...(apiKey ? { 'x-api-key': apiKey, 'x-ai-model': group, 'x-ai-submodel': model } : {}),
        },
        body: fd,
      });
      if (!d.success) throw new Error(d.message || '추출 실패');
      if (d.text?.trim()) all += (all ? '\n\n' : '') + d.text;
      if (d.notices?.length) notices.push(...d.notices);
    }
    return { text: all, notices };
  };

  // 로드맵 원자료를 학생 첨부 파일로도 보관 — 다음에 로드맵을 다시 만들 때 아래 목록에서 골라 재사용
  const keepAsAttachments = async (list) => {
    const existing = student.files || [];
    const fresh = list.filter(f => f.size <= 15 * 1024 * 1024 && !existing.some(e => e.name === f.name && Number(e.size) === f.size));
    if (!fresh.length) return;
    try {
      for (let i = 0; i < fresh.length; i += 10) {
        const fd = new FormData();
        fresh.slice(i, i + 10).forEach(f => fd.append('files', f));
        fd.append('kind', '로드맵자료');
        await fetch(`${API_BASE}/api/board/students/${student.id}/files`, {
          method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
        });
      }
      await onChanged?.();
    } catch { /* 보관 실패는 로드맵 생성 흐름을 막지 않는다 */ }
  };

  const onFiles = async (fileList) => {
    const list = Array.from(fileList || []);
    if (!list.length) return;
    setBusy('extract'); setMsg('파일에서 글자를 읽는 중… (스캔본이면 AI 판독이라 몇 분 걸립니다)');
    try {
      const { text: got, notices } = await extractChunks(list);
      if (!got.trim()) throw new Error('텍스트를 추출하지 못했습니다 (스캔본이면 설정에 AI 키를 등록해 주세요)');
      setText(prev => (prev ? prev + '\n\n' : '') + got);
      setFiles(prev => [...prev, ...list.map(f => f.name)]);
      setMsg(notices.length ? '⚠ ' + notices.join(' / ') : '');
      await keepAsAttachments(list);
    } catch (e) { setMsg('⚠ 추출 오류: ' + e.message); }
    finally { setBusy(''); if (rmFileRef.current) rmFileRef.current.value = ''; }
  };

  // 로드맵 PDF/워드 다운로드 — 서버가 requireAdmin으로 막으므로 관리자 계정만 성공한다
  const isAdmin = localStorage.getItem('ef_role') === 'admin';
  const downloadDoc = async (rm, fmt) => {
    const label = fmt === 'docx' ? '워드 파일' : 'PDF';
    setMsg(`${label}을 만드는 중…`);
    try {
      const res = await fetch(`${API_BASE}/api/roadmap/${rm.id}/${fmt}`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) {
        let m = `${label} 생성 실패`;
        try { m = (await res.json()).message || m; } catch {}
        throw new Error(m);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(rm.title || '생기부 로드맵').replace(/[\\/:*?"<>|]/g, ' ').trim()}.${fmt}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setMsg(`✓ ${label}을 내려받았습니다.`);
    } catch (e) { setMsg('⚠ ' + e.message); }
  };

  // 이미 저장된 로드맵의 문장을 학생 눈높이로 다시 쓰기 (체크 기록·내용은 유지)
  const simplify = async (rm) => {
    if (!confirm(`'${rm.title}'의 전문·요지·항목 설명을 쉬운 문장으로 다시 씁니다.\n할 일 내용과 체크 기록은 그대로 두고 문장만 바뀝니다.\n자료 양에 따라 몇 분 걸릴 수 있습니다.`)) return;
    const { model, group, apiKey } = aiCreds();
    if (!apiKey) { setMsg('⚠ 설정에서 API 키를 먼저 입력해 주세요.'); return; }
    setBusy('simplify'); setMsg('쉬운 문장으로 다시 쓰는 중… (창을 닫지 마세요)');
    try {
      const d = await postForResult(`${API_BASE}/api/roadmap/${rm.id}/simplify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'x-ai-model': group, 'x-ai-submodel': model, Authorization: `Bearer ${token()}` },
      }, (stage) => setMsg(stage));
      if (!d.success) throw new Error(d.message || '처리 실패');
      await load();
      setMsg('✓ 쉬운 문장으로 다시 썼습니다. PDF·워드도 새 문장으로 나옵니다.');
    } catch (e) { setMsg('⚠ ' + e.message); }
    finally { setBusy(''); }
  };

  // 이미 올려둔 첨부 파일을 내려받아 로드맵 재료로 다시 사용
  const loadFromAttachments = async () => {
    const picked = attachables.filter(f => sel.has(f.id));
    if (!picked.length) { setMsg('⚠ 불러올 첨부 파일을 먼저 선택해 주세요.'); return; }
    setBusy('extract'); setMsg(`첨부 파일 ${picked.length}개에서 글자를 읽는 중… (스캔본이면 AI 판독이라 몇 분 걸립니다)`);
    try {
      const fileObjs = [];
      for (const f of picked) {
        const res = await fetch(`${API_BASE}/api/board/files/${f.id}`, { headers: { Authorization: `Bearer ${token()}` } });
        if (!res.ok) throw new Error(`${f.name}: 파일을 내려받지 못했습니다`);
        const blob = await res.blob();
        fileObjs.push(new File([blob], f.name, { type: f.mime || blob.type || 'application/octet-stream' }));
      }
      const { text: got, notices } = await extractChunks(fileObjs);
      if (!got.trim()) throw new Error('텍스트를 추출하지 못했습니다 (스캔본이면 설정에 AI 키를 등록해 주세요)');
      setText(prev => (prev ? prev + '\n\n' : '') + got);
      setFiles(prev => [...prev, ...picked.map(f => f.name)]);
      setSel(new Set());
      setMsg(notices.length
        ? '⚠ ' + notices.join(' / ')
        : `✓ 첨부 파일 ${picked.length}개를 불러왔습니다. 이제 [🤖 로드맵 만들기]를 누르면 이 자료로 새 로드맵을 만듭니다.`);
    } catch (e) { setMsg('⚠ ' + e.message); }
    finally { setBusy(''); }
  };

  // AI 실행 (생성 또는 항목화)
  const run = async () => {
    if (!text.trim()) { setMsg('⚠ 먼저 자료 파일을 올리거나 내용을 붙여넣어 주세요.'); return; }
    const { model, group, apiKey } = aiCreds();
    if (!apiKey) { setMsg('⚠ 설정에서 API 키를 먼저 입력해 주세요.'); return; }

    setBusy(mode); setMsg(mode === 'generate' ? '자료를 읽고 로드맵을 작성하는 중… (자료가 많으면 5분 넘게 걸립니다. 창을 닫지 마세요)' : '로드맵을 항목으로 정리하는 중…');
    try {
      const body = mode === 'generate'
        ? { text, filename: files.join(', '), profile: {
            name: student.name, school: student.school, grade: student.grade,
            major: student.major, targetUniv: student.target_univ,
            nextSubjects, memo: student.notes } }
        : { text, filename: files.join(', ') || `${student.name} 생기부 로드맵` };
      const d = await postForResult(`${API_BASE}/api/roadmap/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'x-ai-model': group, 'x-ai-submodel': model, Authorization: `Bearer ${token()}` },
        body: JSON.stringify(body),
      }, (stage) => setMsg(stage));
      if (!d.success) throw new Error(d.message || '처리 실패');
      setDraft(d.roadmap);
      setMsg(`✓ 실행 항목 ${d.roadmap.items.length}개를 뽑았습니다. 확인 후 저장하세요.`);
    } catch (e) { setMsg('⚠ ' + e.message); }
    finally { setBusy(''); }
  };

  const saveDraft = async () => {
    if (busy === 'save') return; // 두 번 눌러 같은 로드맵이 두 개 생기는 것을 막는다
    const dup = roadmaps.find(r => r.title.trim() === (draft.title || '').trim());
    // 같은 제목이 있으면 교체(기존 삭제)인지 추가 저장인지 고른다 — 저장 자체를 그만두려면 초안의 [취소]를 누르면 된다
    const replaceId = dup && confirm(
      `같은 제목의 로드맵이 이미 있습니다 (항목 ${(dup.items || []).length}개).\n\n` +
      `[확인] 기존 로드맵을 삭제하고 새 로드맵으로 교체 (기존 체크 기록은 사라집니다)\n` +
      `[취소] 기존은 그대로 두고 새 로드맵을 하나 더 저장`) ? dup.id : null;
    setBusy('save');
    try {
      await act(async () => {
        await call(`/api/board/students/${student.id}/roadmaps`, { method: 'POST', body: JSON.stringify(draft) });
        if (replaceId) await call(`/api/roadmap/${replaceId}`, { method: 'DELETE' });
        setDraft(null); setText(''); setFiles([]); setNextSubjects('');
        setMsg(replaceId
          ? '✓ 기존 로드맵을 새 로드맵으로 교체했습니다. 학생이 열람 코드로 들어오면 바로 체크할 수 있습니다.'
          : '✓ 저장되었습니다. 학생이 열람 코드로 들어오면 바로 체크할 수 있습니다.');
      });
    } finally { setBusy(''); }
  };

  return (
    <>
      <div style={S.sectionTitle}>🗺 생기부 로드맵 — 학생이 직접 체크하는 실행 목록</div>
      {msg && <div style={{ fontSize: 12.5, margin: '0 0 9px', color: msg.startsWith('✓') ? '#34d399' : '#fbbf24' }}>{msg}</div>}

      <div style={{ border: '1px dashed #2a3a48', borderRadius: 12, padding: 12, marginBottom: 12, background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {[['generate', '🤖 자료로 로드맵 만들기'], ['analyze', '📄 완성된 로드맵 올리기']].map(([k, label]) => (
            <button key={k} onClick={() => setMode(k)}
              style={{ ...S.viewBtn, ...(mode === k ? { color: '#2dd4bf', border: '1px solid rgba(45,212,191,0.75)', background: 'rgba(45,212,191,0.16)' } : { color: '#9db0bd', border: '1px solid #2a3a48', background: 'transparent' }) }}>{label}</button>
          ))}
        </div>
        <div style={{ color: '#6b7d8a', fontSize: 12, marginBottom: 9, lineHeight: 1.6 }}>
          {mode === 'generate'
            ? '이 학생의 수행평가·탐구보고서·자기평가서를 전부 올리면, AI가 활동 정리 → 진단 → 다음 학기 과목별 설계 → 타임라인까지 로드맵을 쓰고 체크 항목으로 쪼갭니다.'
            : '이미 만들어 둔 로드맵 문서(PDF·DOCX·한글)를 올리면 내용은 그대로 두고 실행 항목만 뽑아 체크리스트로 만듭니다.'}
        </div>

        {attachables.length > 0 && (
          <div style={{ border: '1px solid #2a3a48', borderRadius: 9, padding: '9px 11px', marginBottom: 9, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
              <b style={{ fontSize: 12.5, color: '#9db0bd' }}>📂 이미 올려둔 첨부 파일로 다시 만들기</b>
              <label style={{ fontSize: 12, color: '#2dd4bf', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                <input type="checkbox"
                  checked={attachables.length > 0 && attachables.every(f => sel.has(f.id))}
                  onChange={e => setSel(e.target.checked ? new Set(attachables.map(f => f.id)) : new Set())} />
                전체선택
              </label>
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto' }}>
              {attachables.map(f => (
                <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#cdd9e2', padding: '2.5px 0', cursor: 'pointer' }}>
                  <input type="checkbox" checked={sel.has(f.id)}
                    onChange={e => setSel(prev => { const n = new Set(prev); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n; })} />
                  <span style={{ flex: 1, wordBreak: 'break-all' }}>{f.name}</span>
                  <span style={{ color: '#6b7d8a', fontSize: 11.5, whiteSpace: 'nowrap' }}>{rmFmtSize(f.size || 0)}</span>
                </label>
              ))}
            </div>
            <button style={{ ...S.addSmall, marginTop: 6, opacity: (busy || !sel.size) ? 0.6 : 1 }} onClick={loadFromAttachments} disabled={!!busy || !sel.size}>
              {busy === 'extract' ? '읽는 중…' : `선택한 파일 ${sel.size}개 불러오기`}
            </button>
          </div>
        )}

        <div style={S.addRow}>
          <button style={S.addSmall} onClick={() => rmFileRef.current?.click()} disabled={!!busy}>
            {busy === 'extract' ? '읽는 중…' : '📎 자료 파일 올리기 (여러 개 가능)'}
          </button>
          <input ref={rmFileRef} type="file" multiple style={{ display: 'none' }} accept=".pdf,.docx,.hwp,.hwpx,.txt,.md" onChange={e => onFiles(e.target.files)} />
          {files.length > 0 && <span style={{ color: '#9db0bd', fontSize: 12 }}>{files.length}개 · {text.length.toLocaleString()}자</span>}
          {text && <button style={S.miniDel} onClick={() => { setText(''); setFiles([]); }}>비우기</button>}
        </div>
        {files.length > 0 && <div style={{ color: '#6b7d8a', fontSize: 11.5, margin: '5px 0 0' }}>{files.join(' · ')}</div>}

        <textarea style={{ ...S.textarea, marginTop: 8 }} rows={3} value={text} onChange={e => setText(e.target.value)}
          placeholder={mode === 'generate' ? '자료 내용을 직접 붙여넣어도 됩니다 (여러 과목 산출물을 이어 붙여도 좋습니다)' : '로드맵 문서 내용을 붙여넣어도 됩니다'} />

        {mode === 'generate' && (
          <input style={{ ...S.input, marginTop: 8 }} value={nextSubjects} onChange={e => setNextSubjects(e.target.value)}
            placeholder="다음 학기 수강 과목 (선택 — 예: 공통국어2 · 공통수학2 · 통합과학2 · 과학탐구실험2)" />
        )}

        <div style={{ ...S.addRow, marginTop: 9 }}>
          <button style={{ ...S.addSmall, opacity: busy ? 0.6 : 1 }} onClick={run} disabled={!!busy}>
            {busy === 'generate' ? '🤖 로드맵 작성 중…' : busy === 'analyze' ? '정리 중…' : mode === 'generate' ? '🤖 로드맵 만들기' : '항목 뽑기'}
          </button>
        </div>
      </div>

      {draft && (
        <div style={{ border: '1px solid rgba(45,212,191,0.4)', borderRadius: 12, padding: 13, marginBottom: 12, background: 'rgba(45,212,191,0.06)' }}>
          <label style={S.label}>로드맵 제목</label>
          <input style={S.input} value={draft.title} onChange={e => setDraft(d => ({ ...d, title: e.target.value }))} />
          {draft.summary && (
            <div style={{ marginTop: 9, fontSize: 12.5, color: '#cdd9e2', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{draft.summary}</div>
          )}
          <div style={{ marginTop: 9, fontSize: 12.5, color: '#9db0bd' }}>
            실행 항목 {draft.items.length}개 ·{' '}
            {[...new Set(draft.items.map(i => i.section))].join(' / ')}
            {draft.body ? <button style={{ ...S.viewBtn, marginLeft: 8 }} onClick={() => setViewBody({ title: draft.title, body: draft.body })}>🔍 로드맵 전문 보기</button> : null}
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 8, paddingRight: 4 }}>
            {draft.items.map((it, i) => (
              <div key={i} style={{ fontSize: 12.5, color: '#cdd9e2', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color: '#2dd4bf', fontSize: 11, marginRight: 6 }}>{[it.section, it.subject || it.period].filter(Boolean).join(' · ')}</span>
                {it.title}
              </div>
            ))}
          </div>
          <div style={{ ...S.addRow, marginTop: 10 }}>
            <button style={{ ...S.addSmall, opacity: busy === 'save' ? 0.6 : 1 }} onClick={saveDraft} disabled={busy === 'save'}>
              {busy === 'save' ? '저장 중…' : '저장'}
            </button>
            <button style={S.miniDel} onClick={() => setDraft(null)} disabled={busy === 'save'}>취소</button>
          </div>
        </div>
      )}

      {roadmaps.length === 0 && !draft && (
        <div style={{ color: '#6b7d8a', fontSize: 13, marginBottom: 10 }}>아직 로드맵이 없습니다.</div>
      )}
      <RoadmapView
        verifyContext={recordVerifyContext(student)}
        roadmaps={roadmaps} dark renderMd={mdToHtml}
        onViewBody={(rm) => setViewBody({ title: rm.title, body: rm.body })}
        onToggle={(item) => act(() => call(`/api/roadmap/items/${item.id}`, { method: 'PATCH', body: JSON.stringify({ done: !item.done }) }))}
        onSaveItem={(item, form) => act(() => call(`/api/roadmap/items/${item.id}`, { method: 'PATCH', body: JSON.stringify(form) }))}
        onDeleteItem={(item) => act(() => call(`/api/roadmap/items/${item.id}`, { method: 'DELETE' }))}
        onAddItem={(rm, f) => act(() => call(`/api/roadmap/${rm.id}/items`, { method: 'POST', body: JSON.stringify(f) }))}
        onDeleteRoadmap={(rm) => act(() => call(`/api/roadmap/${rm.id}`, { method: 'DELETE' }))}
        onDownloadPdf={isAdmin ? (rm) => downloadDoc(rm, 'pdf') : undefined}
        onDownloadDocx={isAdmin ? (rm) => downloadDoc(rm, 'docx') : undefined}
        onSimplify={simplify}
      />

      {viewBody && (
        <div style={STYLES.viewerOverlay} onClick={() => setViewBody(null)}>
          <div style={STYLES.viewerBox} onClick={e => e.stopPropagation()}>
            <div style={STYLES.viewerHead}>
              <b style={{ color: '#e8eef3', fontSize: 15 }}>🗺 {viewBody.title}</b>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={STYLES.viewBtn} onClick={() => navigator.clipboard.writeText(viewBody.body)}>복사</button>
                <button style={STYLES.viewBtn} onClick={() => setViewBody(null)}>닫기 ✕</button>
              </div>
            </div>
            <div style={STYLES.viewerBody} dangerouslySetInnerHTML={{ __html: mdToHtml(viewBody.body) }} />
          </div>
        </div>
      )}
    </>
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
  viewerOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 18 },
  viewerBox: { background: '#141f2b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: 'min(1150px, 96vw)', height: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 70px rgba(0,0,0,0.5)' },
  viewerHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '13px 18px', borderBottom: '1px solid rgba(255,255,255,0.09)' },
  viewerBody: { flex: 1, overflowY: 'auto', padding: '18px 26px', color: '#dbe4ec', fontSize: 14.5, lineHeight: 1.85 },
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
  addRow: { display: 'flex', gap: 6, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' },
  importBox: { border: '1px dashed #2a3a48', borderRadius: 10, padding: '10px 12px', marginTop: 8, background: 'rgba(255,255,255,0.02)' },
  importHead: { fontSize: 13, fontWeight: 700, color: '#cdd9e2' },
  importDesc: { fontSize: 12, color: '#6b7d8a', lineHeight: 1.65, margin: '4px 0 2px' },
  addSmall: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 12px', cursor: 'pointer', fontSize: 13, whiteSpace: 'nowrap' },
  modalFooter: { display: 'flex', justifyContent: 'space-between', marginTop: 22 },
  delBtn: { background: 'rgba(248,113,113,0.14)', color: '#f87171', border: '1px solid #fca5a5', borderRadius: 9, padding: '10px 16px', cursor: 'pointer', fontSize: 13.5 },
  saveBtn: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 24px', fontWeight: 700, cursor: 'pointer', fontSize: 14 },
};
