import { useEffect, useState } from 'react';
import { API_BASE } from '../apiBase';
import { mdPreview } from '../mdPreview';

// 고교·중학 공시정보 → 입시·진학 관점 해설 보고서
//   - explainSchools(): 학교 1곳 또는 비교함(2~4곳)의 공시 수치를 백엔드 /api/schoolinfo/explain 에 보내 AI 해설(마크다운)을 받는다
//   - ReportEditor: 받은 해설을 고치고(제목·본문), 저장(DB: ef_school_reports)·Word·PDF 다운로드·삭제
//   - SavedReports: 저장된 보고서 목록(검색·열기·삭제)
// 서버 저장은 선생님(로그인 코드)별로 분리된다.

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
// SSE(keepalive) 응답 — 해설 생성은 1~2분 걸려 프록시 타임아웃을 피하려고 서버가 event-stream 으로 준다(수행평가와 같은 패턴)
async function postForResult(url, opts) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    try { return await res.json(); } catch { return { success: false, message: `서버 응답 오류 (HTTP ${res.status})` }; }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) if (line.startsWith('data: ')) { try { result = JSON.parse(line.slice(6)); } catch { /* 부분 청크 */ } }
  }
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}

// catalog 항목에서 AI 에게 보낼 필드만 추린다(전 과목 bands 는 호출 쪽이 미리 채워 넣는다)
function pickSchool(s) {
  const { id, schoolName, schoolLevel, sido, sigungu, schoolType, gender, fond, address, enrollment, edss, current, achievementChasu, bands } = s;
  return { id, schoolName, schoolLevel, sido, sigungu, schoolType, gender, fond, address, enrollment, edss, current, achievementChasu, bands };
}

export async function explainSchools({ kind, schools, focus, apiKey, aiGroup, selectedModel }) {
  if (!apiKey) throw new Error('AI API 키가 없습니다 — 설정에서 키를 넣어 주세요');
  const d = await postForResult(`${API_BASE}/api/schoolinfo/explain`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', 'x-api-key': apiKey, 'x-ai-model': aiGroup || 'claude', 'x-ai-submodel': selectedModel || 'claude' },
    body: JSON.stringify({ kind, focus, schools: schools.map(pickSchool) }),
  });
  if (!d.success) throw new Error(d.message || '해설 생성 실패');
  return {
    id: null, kind: d.kind, title: d.title, content: d.content, focus: focus || '',
    schoolIds: schools.map((s) => s.id), schoolNames: schools.map((s) => s.schoolName).join(', '), snapshot: d.snapshot || {},
  };
}

async function download(report, format) {
  const res = await fetch(`${API_BASE}/api/school-reports/export`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: report.title, markdown: report.content, format, schoolNames: report.schoolNames, kind: report.kind }),
  });
  if (!res.ok) { let m = `HTTP ${res.status}`; try { m = (await res.json()).message || m; } catch { /* 본문 없음 */ } throw new Error(m); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${report.title}.${format}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── 편집기 ──
export function ReportEditor({ report: initial, onClose, onSaved, onDeleted, onAuthError }) {
  const [r, setR] = useState(initial);
  const [dirty, setDirty] = useState(!initial.id); // 새로 만든 건 아직 저장 전
  const [mode, setMode] = useState('preview');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => { setR(initial); setDirty(!initial.id); }, [initial]);

  const edit = (patch) => { setR((x) => ({ ...x, ...patch })); setDirty(true); };
  const fail = (e) => { if (e.auth) onAuthError?.(); setMsg(e.message); };
  const save = async () => {
    setBusy('save'); setMsg('');
    try {
      const d = r.id
        ? await api(`/api/school-reports/${r.id}`, { method: 'PATCH', body: { title: r.title, content: r.content, focus: r.focus } })
        : await api('/api/school-reports', { method: 'POST', body: { kind: r.kind, title: r.title, content: r.content, focus: r.focus, schoolIds: r.schoolIds, schoolNames: r.schoolNames, snapshot: r.snapshot } });
      if (!d.success) throw new Error(d.message || '저장 실패');
      const saved = { ...r, id: d.item.id, updatedAt: d.item.updated_at };
      setR(saved); setDirty(false); setMsg('저장했습니다'); onSaved?.(saved);
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const remove = async () => {
    if (!window.confirm('이 보고서를 삭제할까요? 되돌릴 수 없습니다.')) return;
    setBusy('delete');
    try {
      if (r.id) { const d = await api(`/api/school-reports/${r.id}`, { method: 'DELETE' }); if (!d.success) throw new Error(d.message || '삭제 실패'); }
      onDeleted?.(r); onClose();
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const dl = async (format) => { setBusy(format); setMsg(''); try { await download(r, format); } catch (e) { fail(e); } finally { setBusy(''); } };
  const close = () => { if (dirty && !window.confirm('저장하지 않은 수정이 있습니다. 닫을까요?')) return; onClose(); };

  return (
    <div style={S.overlay} onClick={close}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input style={S.titleInput} value={r.title} onChange={(e) => edit({ title: e.target.value })} placeholder="보고서 제목" />
            <div style={S.sub}>
              {r.kind === 'compare' ? '비교 해설' : '학교 해설'} · {r.schoolNames}{r.focus ? ` · 학생 상황: ${r.focus}` : ''}
              {r.id ? ` · 저장됨 #${r.id}` : ' · 아직 저장 전'}{dirty ? ' · 수정됨' : ''}
            </div>
          </div>
          <button style={S.btn} onClick={close}>닫기 ✕</button>
        </div>

        <div style={S.toolbar}>
          <div style={S.seg}>
            {[['preview', '미리보기'], ['edit', '수정']].map(([k, l]) => (
              <button key={k} style={{ ...S.segBtn, ...(mode === k ? S.segOn : {}) }} onClick={() => setMode(k)}>{l}</button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button style={{ ...S.btn, ...S.primary }} disabled={!!busy || !dirty} onClick={save}>{busy === 'save' ? '저장 중…' : r.id ? '변경 저장' : '보관함에 저장'}</button>
          <button style={S.btn} disabled={!!busy} onClick={() => dl('docx')}>{busy === 'docx' ? '만드는 중…' : 'Word 다운로드'}</button>
          <button style={S.btn} disabled={!!busy} onClick={() => dl('pdf')}>{busy === 'pdf' ? '만드는 중…' : 'PDF 다운로드'}</button>
          <button style={{ ...S.btn, ...S.danger }} disabled={!!busy} onClick={remove}>{r.id ? '삭제' : '버리기'}</button>
        </div>
        {msg && <div style={S.msg}>{msg}</div>}

        {mode === 'edit' ? (
          <textarea style={S.textarea} value={r.content} onChange={(e) => edit({ content: e.target.value })} spellCheck={false} />
        ) : (
          <div style={S.preview} dangerouslySetInnerHTML={{ __html: mdPreview(r.content) }} />
        )}
        <p style={S.hint}>
          수정 탭에서 문단을 고치거나 지울 수 있습니다(마크다운: ## 제목, - 목록, | 표 |). 다운로드는 지금 화면의 내용을 그대로 담습니다 —
          보관함에 저장해 두면 나중에 다시 열어 고치거나 내려받을 수 있습니다.
        </p>
      </div>
    </div>
  );
}

// ── 보관함 ──
export function SavedReports({ onOpen, onClose, onAuthError, refreshKey }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const load = async () => {
    try {
      const d = await api(`/api/school-reports${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      if (!d.success) throw new Error(d.message || '목록 로드 실패');
      setItems(d.items || []); setMsg('');
    } catch (e) { if (e.auth) onAuthError?.(); setMsg(e.message); setItems([]); }
  };
  useEffect(() => { load(); }, [q, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (it) => {
    try {
      const d = await api(`/api/school-reports/${it.id}`);
      if (!d.success) throw new Error(d.message || '열기 실패');
      const x = d.item;
      onOpen({ id: x.id, kind: x.kind, title: x.title, content: x.content, focus: x.focus, schoolIds: x.school_ids || [], schoolNames: x.school_names, snapshot: x.snapshot || {}, updatedAt: x.updated_at });
    } catch (e) { if (e.auth) onAuthError?.(); setMsg(e.message); }
  };
  const remove = async (it) => {
    if (!window.confirm(`"${it.title}" 을(를) 삭제할까요?`)) return;
    try { const d = await api(`/api/school-reports/${it.id}`, { method: 'DELETE' }); if (!d.success) throw new Error(d.message); load(); }
    catch (e) { if (e.auth) onAuthError?.(); setMsg(e.message); }
  };
  const when = (s) => (s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <h3 style={S.h3}>📚 저장된 입시 해설 보고서</h3>
            <div style={S.sub}>학교 해설·비교 해설을 보관합니다. 열어서 고치고 Word·PDF 로 내려받을 수 있습니다.</div>
          </div>
          <button style={S.btn} onClick={onClose}>닫기 ✕</button>
        </div>
        <input style={S.search} placeholder="제목·학교명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        {msg && <div style={S.msg}>{msg}</div>}
        {items === null ? <p style={S.hint}>불러오는 중…</p> : !items.length ? (
          <p style={S.hint}>저장된 보고서가 없습니다. 학교 상세나 비교 화면에서 "입시 해설 생성" 후 저장해 보세요.</p>
        ) : (
          <div style={S.list}>
            {items.map((it) => (
              <div key={it.id} style={S.row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.rowTitle}>{it.kind === 'compare' ? '⚖️' : '🏫'} {it.title}</div>
                  <div style={S.sub}>{it.school_names}{it.focus ? ` · ${it.focus}` : ''} · {when(it.updated_at)}</div>
                </div>
                <button style={S.btn} onClick={() => open(it)}>열기</button>
                <button style={{ ...S.btn, ...S.danger }} onClick={() => remove(it)}>삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 상세·비교 모달 안에 놓는 '해설 생성' 상자 ──
export function ExplainBox({ label, onExplain, busy, hasKey }) {
  const [focus, setFocus] = useState('');
  return (
    <section style={S.box}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={S.boxTitle}>🧭 {label}</div>
          <div style={S.sub}>공시 수치를 입시·진학 관점에서 해설하고 어떤 학생에게 유리·불리한지 정리합니다. 결과는 고쳐서 저장하고 Word·PDF 로 내려받을 수 있습니다.</div>
        </div>
        <button style={{ ...S.btn, ...S.primary }} disabled={!!busy || !hasKey} onClick={() => onExplain(focus)} title={hasKey ? '' : '설정에서 AI API 키를 먼저 넣어 주세요'}>
          {busy || '입시 해설 생성'}
        </button>
      </div>
      <input style={{ ...S.search, marginTop: 8, marginBottom: 0 }} value={focus} onChange={(e) => setFocus(e.target.value)}
        placeholder="(선택) 상담 학생 상황 — 예: 중3, 내신 상위 5%, 의대 목표, 수학 강점·국어 약점" />
    </section>
  );
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' },
  modal: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 980, boxShadow: 'var(--shadow-md)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  h3: { fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text)' },
  titleInput: { width: '100%', fontSize: 17, fontWeight: 800, background: 'transparent', color: 'var(--text)', border: 'none', borderBottom: '1px dashed var(--border)', padding: '4px 0', outline: 'none' },
  sub: { fontSize: 12, color: 'var(--text3)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
  seg: { display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  segBtn: { background: 'var(--surface2)', color: 'var(--text)', border: 'none', padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  segOn: { background: 'var(--accent-bg)', color: 'var(--accent)' },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 700 },
  primary: { background: 'var(--accent)', color: '#0b1220', borderColor: 'var(--accent)' },
  danger: { color: '#f87171', borderColor: 'rgba(248,113,113,0.5)' },
  msg: { fontSize: 12, color: 'var(--accent)', margin: '0 0 8px' },
  textarea: { width: '100%', minHeight: 520, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical', boxSizing: 'border-box' },
  preview: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '6px 18px 14px', fontSize: 13.5, lineHeight: 1.65, color: 'var(--text)' },
  hint: { fontSize: 12, color: 'var(--text3)', marginTop: 10 },
  search: { width: '100%', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 10 },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' },
  rowTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  box: { marginTop: 18, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' },
  boxTitle: { fontSize: 14, fontWeight: 800, color: 'var(--text)' },
};
