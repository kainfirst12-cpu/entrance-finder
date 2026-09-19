import { useEffect, useState } from 'react';
import { API_BASE } from '../apiBase';

// 📨 나만의 패파(academy-video)에 배정 — 모든 보고서 공용 버튼+창. 관리자(패스파인더)만 보인다(면접 전략과 같은 규칙).
//   <SendToPapa kind="생기부 분석" title=… markdown=… data?=… studentName?=… onSent?=… endpoint?=… extra?=… />
// 서버 /api/papa/send(관리자 전용) → academy-video inbound → 그 학생의 성장 리포트에 문서로 + 학부모·학생 알림.
// 학교 해설 보고서는 endpoint='/api/school-reports/send' + extra={reportId} 로 전송 이력을 보고서에 남긴다.

const token = () => localStorage.getItem('ef_token');
const isAdmin = () => localStorage.getItem('ef_role') === 'admin';
export const AUD_LABEL = { parent: '학부모', student: '학생', both: '학생+학부모' };

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) { const e = new Error(res.status === 403 ? '관리자 전용 기능입니다' : '로그인이 필요합니다'); e.auth = res.status === 401; throw e; }
  return res.json();
}

export function SendToPapaDialog({ kind, title, markdown, data = null, studentName: initialName = '', endpoint = '/api/papa/send', extra = {}, onClose, onSent, onAuthError }) {
  const [studentName, setStudentName] = useState(initialName || '');
  const [audience, setAudience] = useState('parent');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cfg, setCfg] = useState(null);
  useEffect(() => { api('/api/papa/send-config').then(setCfg).catch(() => setCfg({ enabled: false })); }, []);
  const send = async () => {
    setBusy(true); setErr('');
    try {
      const d = await api(endpoint, { method: 'POST', body: { kind, title, markdown, data, studentName, audience, memo, ...extra } });
      if (!d.success) throw new Error(d.message || '전송 실패');
      onSent?.(d);
    } catch (e) { if (e.auth) onAuthError?.(); setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <h3 style={S.h3}>📨 나만의 패파에 배정</h3>
            <div style={S.sub}>나만의 패파의 학생 이름으로 찾아 그 아이의 성장 리포트에 넣고, 알림톡·푸시로 알립니다. 학생·학부모는 나만의 패파에 로그인해서 봅니다.</div>
          </div>
          <button style={S.btn} onClick={onClose}>✕</button>
        </div>
        {cfg && !cfg.enabled && <div style={S.warn}>서버에 나만의 패파 연동 열쇠가 없거나 관리자 계정이 아닙니다. (Railway 환경변수 <code style={S.code}>ACADEMY_VIDEO_INBOUND_KEY</code>)</div>}
        <label style={S.label}>학생 이름 (나만의 패파에 등록된 이름 그대로)</label>
        <input style={S.input} value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="예: 김민준" autoFocus />
        <label style={S.label}>누가 보나요</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['parent', 'both', 'student'].map((k) => <button key={k} style={{ ...S.btn, ...(audience === k ? S.primary : {}) }} onClick={() => setAudience(k)}>{AUD_LABEL[k]}</button>)}
        </div>
        <label style={S.label}>한 줄 메모 (알림에 함께 나갑니다, 선택)</label>
        <input style={S.input} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 상담 때 말씀드린 내용입니다. 읽어 보시고 궁금한 점 연락 주세요." />
        <div style={S.sub}>보내는 문서: <b>{title}</b> · {kind}{data ? ' (수치 차트 포함)' : ''}</div>
        {err && <div style={{ ...S.err, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={S.btn} onClick={onClose}>취소</button>
          <button style={{ ...S.btn, ...S.primary }} disabled={busy || !studentName.trim() || !markdown || (cfg && !cfg.enabled)} onClick={send}>{busy ? '보내는 중…' : '보내기'}</button>
        </div>
      </div>
    </div>
  );
}

/** 버튼 — 관리자가 아니면 아무것도 그리지 않는다. onSent 가 없으면 성공 메시지만 잠깐 보여 준다. */
export default function SendToPapa({ kind, title, markdown, data, studentName, endpoint, extra, onSent, onAuthError, style, label = '📨 나만의 패파에 배정', beforeOpen }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  if (!isAdmin()) return null;
  const openIt = async () => { if (beforeOpen) { const ok = await beforeOpen(); if (ok === false) return; } setOpen(true); };
  return (
    <>
      <button style={{ ...S.btn, ...style }} onClick={openIt} disabled={!markdown} title={markdown ? '학생·학부모의 나만의 패파 성장 리포트로 보냅니다(관리자 전용)' : '보낼 내용이 아직 없습니다'}>{label}{msg ? ` · ${msg}` : ''}</button>
      {open && <SendToPapaDialog kind={kind} title={title} markdown={markdown} data={data} studentName={studentName} endpoint={endpoint} extra={extra} onAuthError={onAuthError}
        onClose={() => setOpen(false)} onSent={(d) => { setOpen(false); setMsg('보냈습니다'); setTimeout(() => setMsg(''), 4000); onSent?.(d); }} />}
    </>
  );
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' },
  modal: { background: 'var(--bg, #0f1720)', border: '1px solid var(--border, #2a3a48)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 520, color: 'var(--text, #e8eef3)', boxShadow: '0 10px 40px rgba(0,0,0,0.4)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  h3: { fontSize: 18, fontWeight: 800, margin: 0 },
  sub: { fontSize: 12, color: 'var(--text3, #9aa4b2)', marginTop: 4 },
  label: { display: 'block', fontSize: 12, fontWeight: 700, margin: '8px 0 4px' },
  input: { width: '100%', boxSizing: 'border-box', background: 'var(--surface, #131c26)', color: 'inherit', border: '1px solid var(--border, #2a3a48)', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 10 },
  btn: { background: 'var(--surface2, #1c2937)', color: 'var(--text, #e8eef3)', border: '1px solid var(--border, #2a3a48)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 700 },
  primary: { background: 'var(--accent, #2dd4bf)', color: '#0b1220', borderColor: 'var(--accent, #2dd4bf)' },
  warn: { fontSize: 12, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.4)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 },
  code: { fontSize: 11.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.08)' },
  err: { fontSize: 12, color: '#f87171' },
};
