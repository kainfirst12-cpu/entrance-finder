import { useEffect, useState } from 'react';
import { API_BASE } from '../apiBase';

// 🔗 설정 → 나만의 패파 연동 — 학원마다 자기 나만의 패파(academy-video)에서 발급한 연동 열쇠를 등록한다.
// 등록할 때 서버가 나만의 패파에 확인 요청을 보내(없는 학생 이름이라 아무것도 안 만들어진다) 학원 이름을 받아 온다.
// 열쇠는 서버(app_users.papa_key)에 학원별로 저장되고 화면에는 앞 6자만 보인다. 관리자는 등록이 없으면 서버 열쇠를 쓴다.
const token = () => localStorage.getItem('ef_token');
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, { method: opts.method || 'GET', headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
  return res.json();
}

export default function PapaLinkSettings() {
  const [cfg, setCfg] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const load = () => api('/api/papa/config').then(setCfg).catch(() => setCfg({ configured: false }));
  useEffect(() => { load(); }, []);
  const save = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const d = await api('/api/papa/config', { method: 'PUT', body: { key: key.trim() } });
      if (!d.success) throw new Error(d.message || '등록 실패');
      setMsg(`연결됐습니다 → ${d.academy || '학원'} 나만의 패파`); setKey(''); load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm('나만의 패파 연동을 해제할까요? 보내기 버튼이 다시 안내만 보여 줍니다.')) return;
    setBusy(true); setErr(''); setMsg('');
    try { const d = await api('/api/papa/config', { method: 'DELETE' }); if (!d.success) throw new Error(d.message); setMsg('해제했습니다'); load(); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const isAdmin = localStorage.getItem('ef_role') === 'admin';
  return (
    <div className="settings-group">
      <h3 className="settings-group-title">나만의 패파 연동</h3>
      <div className="settings-section">
        <p style={{ fontSize: 13, color: '#9aa4b2', margin: '0 0 8px', lineHeight: 1.6 }}>
          우리 학원 <b>나만의 패파</b>(academy-video) → 선생님 대시보드 → <b>연동 열쇠</b>를 복사해 넣으면, 입시파인더에서 만든 보고서를
          <b>📨 나만의 패파에 배정</b> 버튼으로 우리 학원 학생·학부모에게 바로 보낼 수 있습니다(공개된 메뉴의 보고서만).
        </p>
        {cfg && (
          <div style={{ fontSize: 13, marginBottom: 8, padding: '8px 10px', borderRadius: 8, background: cfg.configured ? 'rgba(45,212,191,0.1)' : 'rgba(251,191,36,0.1)', border: `1px solid ${cfg.configured ? 'rgba(45,212,191,0.4)' : 'rgba(251,191,36,0.4)'}` }}>
            {cfg.configured
              ? <>✅ 연결됨 — <b>{cfg.academy || (cfg.own ? '학원' : '패스파인더(서버 열쇠)')}</b>{cfg.keyPrefix ? ` · 열쇠 ${cfg.keyPrefix}` : ''}{!cfg.own && isAdmin ? ' · 서버 환경변수 사용 중(아래에 등록하면 그것을 우선 씁니다)' : ''}</>
              : <>⚠️ 아직 연결되지 않았습니다.</>}
          </div>
        )}
        <div className="key-row">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="av_ 로 시작하는 연동 열쇠" className="api-key-input" />
          <button onClick={save} disabled={busy || !key.trim()} className="test-btn">{busy ? '확인 중…' : '등록·확인'}</button>
          {cfg?.own && <button onClick={remove} disabled={busy} className="test-btn" style={{ marginLeft: 6 }}>해제</button>}
        </div>
        {msg && <p style={{ color: '#2dd4bf', fontSize: 12, margin: '6px 0 0' }}>{msg}</p>}
        {err && <p className="test-error">{err}</p>}
      </div>
    </div>
  );
}
