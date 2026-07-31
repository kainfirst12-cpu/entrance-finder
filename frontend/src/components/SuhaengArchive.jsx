import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import StudentPicker from './StudentPicker';

const token = () => localStorage.getItem('ef_token');

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) { const e = new Error('권한/인증'); e.auth = true; throw e; }
  return res.json();
}

// SSE(keepalive) 응답 처리 (assessment와 동일 패턴)
async function postForResult(url, opts) {
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
      if (line.startsWith('data: ')) { try { result = JSON.parse(line.slice(6)); } catch {} }
    }
  }
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}

// 가벼운 마크다운 미리보기 (다크 테마)
function mdPreview(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b style="color:#e8eef3">$1</b>');
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    if (t.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i]); i++; }
      const rows = block.filter(l => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l));
      html += '<table style="border-collapse:collapse;width:100%;margin:8px 0">';
      rows.forEach((r, ri) => {
        const cells = r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        html += '<tr>' + cells.map(c =>
          `<${ri === 0 ? 'th' : 'td'} style="border:1px solid #2a3a48;padding:6px 9px;text-align:left;background:${ri === 0 ? '#243341' : '#1c2937'};color:#e8eef3">${inline(c)}</${ri === 0 ? 'th' : 'td'}>`).join('') + '</tr>';
      });
      html += '</table>';
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { html += `<h${h[1].length + 1} style="margin:14px 0 6px;color:#e8eef3">${inline(h[2])}</h${h[1].length + 1}>`; i++; continue; }
    const b = t.match(/^[-*]\s+(.*)$/);
    if (b) { html += `<div style="margin:2px 0 2px 14px">• ${inline(b[1])}</div>`; i++; continue; }
    html += `<p style="margin:6px 0">${inline(t)}</p>`;
    i++;
  }
  return html;
}

export default function SuhaengArchive({ getActiveKey, selectedModel, aiGroup, onAuthError }) {
  // 업로드·분석
  const [extractedText, setExtractedText] = useState('');
  const [fileName, setFileName] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef(null);

  // 분석 결과 (저장 전 편집)
  const [draft, setDraft] = useState(null); // {title, school, subject, topic, grade, kind, content, sourceName, studentName}

  // 아카이브 목록
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [fSchool, setFSchool] = useState('');
  const [fSubject, setFSubject] = useState('');
  const [listMsg, setListMsg] = useState('');
  const [viewItem, setViewItem] = useState(null); // 상세 모달
  const [assignStudent, setAssignStudent] = useState(null);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (fSchool) params.set('school', fSchool);
    if (fSubject) params.set('subject', fSubject);
    api(`/api/suhaeng?${params}`)
      .then((j) => { if (j.success) { setItems(j.items || []); setListMsg(''); } else setListMsg(j.message || '목록 로드 실패'); })
      .catch((e) => { if (e.auth) onAuthError?.(); else setListMsg(e.message); });
  }, [q, fSchool, fSubject]);

  useEffect(() => { load(); }, [load]);

  const schools = [...new Set(items.map((i) => i.school).filter(Boolean))].sort();
  const subjects = [...new Set(items.map((i) => i.subject).filter(Boolean))].sort();

  // ── 파일 업로드 → 텍스트 추출 ──
  const onFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const hwp = files.filter((f) => /\.hwpx?$/i.test(f.name));
    if (hwp.length) {
      setNotice(`한글 파일(${hwp.map(f => f.name).join(', ')})은 텍스트 추출이 지원되지 않습니다. 한글에서 "PDF로 저장" 후 올려주세요.`);
    }
    const ok = files.filter((f) => !/\.hwpx?$/i.test(f.name));
    if (!ok.length) return;
    setExtracting(true); setError('');
    try {
      const fd = new FormData();
      ok.forEach((f) => fd.append('files', f));
      const res = await fetch(`${API_BASE}/api/assessment/extract`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || '추출 실패');
      if (!d.text?.trim()) throw new Error('텍스트를 추출하지 못했습니다 (스캔본이면 PDF 원본을 확인해주세요)');
      setExtractedText((prev) => (prev ? prev + '\n\n' : '') + d.text);
      setFileName(ok.map((f) => f.name).join(', '));
    } catch (e) { setError('추출 오류: ' + e.message); }
    finally { setExtracting(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  // ── AI 분석 ──
  const analyze = async () => {
    if (!extractedText.trim()) { setError('먼저 파일을 올리거나 내용을 붙여넣어 주세요.'); return; }
    const apiKey = getActiveKey?.();
    if (!apiKey) { setError('선택한 AI의 API 키가 설정에 없습니다.'); return; }
    setAnalyzing(true); setError('');
    try {
      const d = await postForResult(`${API_BASE}/api/suhaeng/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json', 'x-api-key': apiKey,
          'x-ai-model': aiGroup || 'claude', 'x-ai-submodel': selectedModel || 'claude',
          Authorization: `Bearer ${token()}`,
        },
        body: JSON.stringify({ text: extractedText, filename: fileName }),
      });
      if (!d.success) throw new Error(d.message || '분석 실패');
      setDraft({ ...d.meta, content: d.content, sourceName: fileName, studentName: '' });
    } catch (e) { setError('분석 오류: ' + e.message); }
    finally { setAnalyzing(false); }
  };

  // ── 저장 ──
  const saveDraft = async () => {
    if (!draft?.content?.trim()) return;
    try {
      const j = await api('/api/suhaeng', { method: 'POST', body: draft });
      if (!j.success) throw new Error(j.message || '저장 실패');
      setDraft(null); setExtractedText(''); setFileName('');
      setNotice('✓ 아카이브에 저장되었습니다.');
      load();
    } catch (e) { if (e.auth) onAuthError?.(); else setError('저장 오류: ' + e.message); }
  };

  // ── 배정 ──
  const assign = async (item, mode) => {
    if (!assignStudent) { alert('먼저 배정할 학생을 선택해 주세요.'); return; }
    setAssigning(true);
    try {
      const j = await api(`/api/suhaeng/${item.id}/assign`, { method: 'POST', body: { studentId: assignStudent.id, mode } });
      if (!j.success) throw new Error(j.message || '배정 실패');
      alert(`'${assignStudent.name}' 학생에게 ${mode === 'prepare' ? '[미리 준비]로 ' : ''}배정되었습니다.\n학생 보드 카드와 학생 열람 코드 페이지에서 볼 수 있습니다.`);
    } catch (e) { if (e.auth) onAuthError?.(); else alert('배정 오류: ' + e.message); }
    finally { setAssigning(false); }
  };

  const remove = async (item) => {
    if (!confirm(`'${item.title}' 자료를 아카이브에서 삭제할까요?`)) return;
    try {
      const j = await api(`/api/suhaeng/${item.id}`, { method: 'DELETE' });
      if (j.success) { setViewItem(null); load(); }
    } catch (e) { if (e.auth) onAuthError?.(); }
  };

  const openItem = async (row) => {
    try {
      const j = await api(`/api/suhaeng/${row.id}`);
      if (j.success) setViewItem(j.item);
    } catch (e) { if (e.auth) onAuthError?.(); }
  };

  const downloadDocx = async (item) => {
    try {
      const res = await fetch(`${API_BASE}/api/assessment/docx`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ title: item.title, markdown: item.content }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${item.title}.docx`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch {}
  };

  return (
    <div style={S.page}>
      <h2 style={S.h2}>🗂️ 수행평가 아카이브</h2>
      <p style={S.lead}>
        기존에 만들어둔 수행평가 자료(PDF·워드·텍스트)를 올리면 AI가 상세 정리하고, 학교·분야·주제별로 보관합니다.
        보관된 자료는 언제든 다시 열어 다른 학생에게 <b>[미리 준비]</b>로 배정할 수 있습니다. 한글(.hwp)은 PDF로 저장 후 올려주세요.
      </p>

      {error && <div style={S.error}>⚠ {error}</div>}
      {notice && <div style={S.notice}>{notice} <button style={S.dismiss} onClick={() => setNotice('')}>✕</button></div>}

      {/* ① 업로드 & 분석 */}
      <div style={S.card}>
        <div style={S.secTitle}>① 자료 올리고 분석하기</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <button style={S.btn} onClick={() => fileRef.current?.click()} disabled={extracting}>
            {extracting ? '추출 중…' : '📎 파일 올리기 (PDF·docx·txt)'}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.hwp,.hwpx" multiple style={{ display: 'none' }}
            onChange={(e) => onFiles(e.target.files)} />
          {fileName && <span style={S.fileChip}>📄 {fileName}</span>}
          <button style={{ ...S.btn, ...S.btnPrimary }} onClick={analyze} disabled={analyzing || !extractedText.trim()}>
            {analyzing ? 'AI 분석 중…' : '✨ AI로 상세 정리'}
          </button>
        </div>
        <textarea style={S.textarea} rows={5} value={extractedText} onChange={(e) => setExtractedText(e.target.value)}
          placeholder="파일을 올리면 추출된 텍스트가 여기 표시됩니다. 직접 붙여넣어도 됩니다." />
      </div>

      {/* ② 분석 결과 편집·저장 */}
      {draft && (
        <div style={S.card}>
          <div style={S.secTitle}>② 정리 결과 확인 · 분류 후 저장</div>
          <div style={S.grid3}>
            <label style={S.fLabel}>제목<input style={S.input} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <label style={S.fLabel}>학교<input style={S.input} value={draft.school} onChange={(e) => setDraft({ ...draft, school: e.target.value })} placeholder="예: 중동고" /></label>
            <label style={S.fLabel}>분야/과목<input style={S.input} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="예: 통합과학" /></label>
            <label style={S.fLabel}>주제<input style={S.input} value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} /></label>
            <label style={S.fLabel}>학년<input style={S.input} value={draft.grade} onChange={(e) => setDraft({ ...draft, grade: e.target.value })} placeholder="예: 고2" /></label>
            <label style={S.fLabel}>유형<input style={S.input} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })} placeholder="예: 보고서" /></label>
          </div>
          <div style={S.preview} dangerouslySetInnerHTML={{ __html: mdPreview(draft.content) }} />
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button style={{ ...S.btn, ...S.btnPrimary }} onClick={saveDraft}>💾 아카이브에 저장</button>
            <button style={S.btn} onClick={() => setDraft(null)}>버리기</button>
          </div>
        </div>
      )}

      {/* ③ 아카이브 목록 */}
      <div style={S.card}>
        <div style={S.secTitle}>③ 보관된 수행평가 ({items.length}건) — 클릭해서 열람·배정</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input style={{ ...S.input, flex: '0 0 200px' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색 (제목·주제·내용)" />
          <select style={S.input} value={fSchool} onChange={(e) => setFSchool(e.target.value)}>
            <option value="">학교 전체</option>
            {schools.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select style={S.input} value={fSubject} onChange={(e) => setFSubject(e.target.value)}>
            <option value="">분야 전체</option>
            {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: '#9db0bd' }}>배정할 학생:</span>
            <StudentPicker value={assignStudent} onChange={setAssignStudent} style={S.input} />
          </div>
        </div>
        {listMsg && <div style={{ color: '#9db0bd', fontSize: 13, padding: '10px 2px' }}>{listMsg}</div>}
        {!listMsg && !items.length && <div style={{ color: '#9db0bd', fontSize: 13, padding: '10px 2px' }}>아직 보관된 자료가 없습니다. 위에서 자료를 올려 분석·저장해 보세요.</div>}
        <div style={S.list}>
          {items.map((it) => (
            <div key={it.id} style={S.row} onClick={() => openItem(it)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.rowTitle}>{it.title}</div>
                <div style={S.rowMeta}>
                  {it.school && <span style={S.chip}>{it.school}</span>}
                  {it.subject && <span style={{ ...S.chip, color: '#8fb8f0', borderColor: 'rgba(91,134,214,0.5)' }}>{it.subject}</span>}
                  {it.grade && <span style={S.chip}>{it.grade}</span>}
                  {it.kind && <span style={S.chip}>{it.kind}</span>}
                  <span style={{ color: '#6b7d8a' }}>{it.topic}</span>
                </div>
              </div>
              <span style={{ color: '#6b7d8a', fontSize: 12, whiteSpace: 'nowrap' }}>{String(it.created_at).slice(0, 10)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 상세 모달 */}
      {viewItem && (
        <div style={S.overlay} onClick={() => setViewItem(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#e8eef3' }}>{viewItem.title}</div>
                <div style={{ ...S.rowMeta, marginTop: 4 }}>
                  {viewItem.school && <span style={S.chip}>{viewItem.school}</span>}
                  {viewItem.subject && <span style={S.chip}>{viewItem.subject}</span>}
                  {viewItem.grade && <span style={S.chip}>{viewItem.grade}</span>}
                  {viewItem.kind && <span style={S.chip}>{viewItem.kind}</span>}
                  <span style={{ color: '#6b7d8a' }}>{viewItem.topic}</span>
                </div>
              </div>
              <button style={S.close} onClick={() => setViewItem(null)}>✕</button>
            </div>
            <div style={{ ...S.preview, maxHeight: '48vh' }} dangerouslySetInnerHTML={{ __html: mdPreview(viewItem.content) }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
              <StudentPicker value={assignStudent} onChange={setAssignStudent} style={S.input} />
              <button style={{ ...S.btn, ...S.btnPrimary }} disabled={assigning} onClick={() => assign(viewItem, 'prepare')}>
                🎯 이 학생에게 [미리 준비] 배정
              </button>
              <button style={S.btn} disabled={assigning} onClick={() => assign(viewItem, 'archive')}>기록으로 배정</button>
              <button style={S.btn} onClick={() => downloadDocx(viewItem)}>Word 다운로드</button>
              <button style={{ ...S.btn, color: '#f87171', borderColor: 'rgba(248,113,113,0.5)' }} onClick={() => remove(viewItem)}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  page: { padding: '24px 28px', maxWidth: 1100 },
  h2: { fontSize: 24, fontWeight: 800, margin: '0 0 4px', color: '#e8eef3' },
  lead: { color: '#9db0bd', fontSize: 13.5, margin: '0 0 16px', lineHeight: 1.6 },
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: '16px 18px', marginBottom: 14 },
  secTitle: { fontSize: 14.5, fontWeight: 800, color: '#e8eef3', marginBottom: 10 },
  btn: { border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#e8eef3', borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnPrimary: { background: '#5b86d6', border: '1px solid #5b86d6', color: '#fff' },
  fileChip: { fontSize: 12, color: '#9db0bd', background: 'rgba(255,255,255,0.06)', borderRadius: 7, padding: '4px 9px' },
  textarea: { width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, color: '#e8eef3', padding: '9px 11px', fontSize: 13, lineHeight: 1.6, resize: 'vertical' },
  input: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#e8eef3', padding: '7px 10px', fontSize: 13 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 10 },
  fLabel: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#9db0bd', fontWeight: 600 },
  preview: { background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, padding: '12px 16px', color: '#cfd8e0', fontSize: 13, lineHeight: 1.7, maxHeight: 320, overflowY: 'auto' },
  list: { display: 'flex', flexDirection: 'column' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderBottom: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer', borderRadius: 8 },
  rowTitle: { fontSize: 14, fontWeight: 700, color: '#e8eef3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowMeta: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 3, flexWrap: 'wrap' },
  chip: { fontSize: 11, fontWeight: 700, color: '#9db0bd', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, padding: '1px 7px' },
  error: { background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#f87171', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12 },
  notice: { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 10 },
  dismiss: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { background: '#16222e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, padding: '20px 22px', maxWidth: 860, width: '100%', maxHeight: '86vh', overflowY: 'auto' },
  close: { border: 'none', background: 'rgba(255,255,255,0.08)', color: '#9db0bd', borderRadius: 8, width: 30, height: 30, cursor: 'pointer' },
};
