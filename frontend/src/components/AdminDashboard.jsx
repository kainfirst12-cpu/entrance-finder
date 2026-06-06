import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../apiBase';

const token = () => localStorage.getItem('ef_token');

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token()}`,
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    const e = new Error('인증 오류');
    e.auth = true;
    throw e;
  }
  return res.json();
}

function fmtTime(ts) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString('ko-KR', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
  } catch { return '-'; }
}

function fmtDuration(sec) {
  if (!sec || sec < 0) return '0분';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

const LOG_TYPE_LABEL = { login: '로그인', analyze: '분석 실행', logout: '로그아웃' };

export default function AdminDashboard({ onAuthError }) {
  const [users, setUsers] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [logs, setLogs] = useState([]);
  const [dbOn, setDbOn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdCode, setCreatedCode] = useState(null);

  // 지식베이스 (pgvector)
  const [kb, setKb] = useState({ vectorEnabled: true, counts: {} });
  const [kbBusy, setKbBusy] = useState('');
  const [kbMsg, setKbMsg] = useState('');
  const [uploadType, setUploadType] = useState('합격자사례');
  const uploadRef = useRef(null);

  const handleErr = useCallback((e) => {
    if (e.auth) { onAuthError?.(); return; }
    setError(e.message || '오류가 발생했습니다');
  }, [onAuthError]);

  const loadAll = useCallback(async () => {
    try {
      const [u, a, l, k] = await Promise.all([
        api('/api/admin/users'),
        api('/api/admin/active'),
        api('/api/admin/logs?limit=80'),
        api('/api/admin/kb'),
      ]);
      if (u.success) { setUsers(u.users || []); setDbOn(u.dbEnabled !== false); }
      if (a.success) setSessions(a.sessions || []);
      if (l.success) setLogs(l.logs || []);
      if (k.success) setKb({ vectorEnabled: k.vectorEnabled !== false, counts: k.counts || {} });
      setError('');
    } catch (e) { handleErr(e); }
    finally { setLoading(false); }
  }, [handleErr]);

  const ingestDrive = async () => {
    if (!confirm('Google Drive의 지식베이스를 Supabase로 가져옵니다.\n기존 지식베이스는 교체되며, 자료 양에 따라 1~3분 걸릴 수 있습니다. 진행할까요?')) return;
    setKbBusy('drive'); setKbMsg('');
    try {
      const r = await api('/api/admin/ingest/drive', { method: 'POST', body: JSON.stringify({ replace: true }) });
      if (r.success) { setKbMsg(`완료: 문서 ${r.documents}건 → ${r.chunks}청크`); setKb(k => ({ ...k, counts: r.counts || {} })); }
      else setKbMsg('실패: ' + (r.message || ''));
    } catch (e) { handleErr(e); setKbMsg('실패: ' + (e.message || '')); }
    finally { setKbBusy(''); }
  };

  const ingestUpload = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setKbBusy('upload'); setKbMsg('');
    try {
      const fd = new FormData();
      fd.append('type', uploadType);
      files.forEach(f => fd.append('files', f));
      const res = await fetch(`${API_BASE}/api/admin/ingest/upload`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd,
      });
      const r = await res.json();
      if (r.success) { setKbMsg(`완료: 문서 ${r.documents}건 → ${r.chunks}청크 (${uploadType})`); setKb(k => ({ ...k, counts: r.counts || {} })); }
      else setKbMsg('실패: ' + (r.message || ''));
    } catch (e) { setKbMsg('실패: ' + (e.message || '')); }
    finally { setKbBusy(''); if (uploadRef.current) uploadRef.current.value = ''; }
  };

  const clearKb = async () => {
    if (!confirm('지식베이스 전체를 삭제할까요? 다시 인제스트해야 분석에 활용됩니다.')) return;
    setKbBusy('clear'); setKbMsg('');
    try {
      const r = await api('/api/admin/kb', { method: 'DELETE' });
      if (r.success) { setKbMsg('지식베이스를 비웠습니다.'); setKb(k => ({ ...k, counts: r.counts || {} })); }
    } catch (e) { handleErr(e); }
    finally { setKbBusy(''); }
  };

  // 접속자만 빠르게 새로고침
  const loadActive = useCallback(async () => {
    try {
      const a = await api('/api/admin/active');
      if (a.success) setSessions(a.sessions || []);
    } catch (e) { if (e.auth) onAuthError?.(); }
  }, [onAuthError]);

  useEffect(() => {
    loadAll();
    const id = setInterval(loadActive, 15000); // 15초마다 접속자 갱신
    return () => clearInterval(id);
  }, [loadAll, loadActive]);

  const createCode = async () => {
    setCreating(true);
    setCreatedCode(null);
    try {
      const r = await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ name: newName }) });
      if (r.success) {
        setCreatedCode(r.user.code);
        setNewName('');
        loadAll();
      } else {
        setError(r.message || '발급 실패');
      }
    } catch (e) { handleErr(e); }
    finally { setCreating(false); }
  };

  const toggleActive = async (u) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) });
      loadAll();
    } catch (e) { handleErr(e); }
  };

  const removeUser = async (u) => {
    if (!confirm(`'${u.name || u.code}' 코드를 삭제할까요? 사용 기록도 함께 정리됩니다.`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' });
      loadAll();
    } catch (e) { handleErr(e); }
  };

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code);
  };

  const S = STYLES;

  return (
    <div style={S.page}>
      <div style={S.headerRow}>
        <h2 style={S.h2}>🛡️ 관리자 대시보드</h2>
        <button style={S.refreshBtn} onClick={loadAll}>↻ 새로고침</button>
      </div>

      {!dbOn && (
        <div style={S.warn}>
          데이터베이스(DATABASE_URL)가 연결되지 않았습니다. Railway에 Postgres를 추가하면
          이용자 코드 발급과 사용량 추적이 활성화됩니다.
        </div>
      )}
      {error && <div style={S.error}>{error}</div>}
      {loading && <div style={S.muted}>불러오는 중...</div>}

      {/* 현재 접속자 */}
      <section style={S.card}>
        <div style={S.cardTitle}>
          <span style={S.liveDot} /> 현재 접속 중 ({sessions.length}명)
          <span style={S.sub}>최근 3분 내 활동 · 15초마다 자동 갱신</span>
        </div>
        {sessions.length === 0 ? (
          <div style={S.muted}>현재 접속 중인 이용자가 없습니다.</div>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>이용자</th>
                <th style={S.th}>접속 위치</th>
                <th style={S.th}>IP</th>
                <th style={S.th}>접속 시작</th>
                <th style={S.th}>사용 시간</th>
                <th style={S.th}>마지막 활동</th>
              </tr></thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.id}>
                    <td style={S.td}><b>{s.name || '(이름없음)'}</b> <span style={S.code}>{s.code}</span></td>
                    <td style={S.td}>{s.geo || '조회중/알수없음'}</td>
                    <td style={S.td}>{s.ip || '-'}</td>
                    <td style={S.td}>{fmtTime(s.created_at)}</td>
                    <td style={S.td}>{fmtDuration(s.duration_sec)}</td>
                    <td style={S.td}>{fmtTime(s.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 이용자 코드 관리 */}
      <section style={S.card}>
        <div style={S.cardTitle}>이용자 코드 관리</div>
        <div style={S.createRow}>
          <input
            style={S.input}
            placeholder="이용자 이름/메모 (예: 김선생, 3학년반)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !creating && dbOn && createCode()}
            disabled={!dbOn}
          />
          <button style={{ ...S.primaryBtn, opacity: dbOn ? 1 : 0.5 }} onClick={createCode} disabled={creating || !dbOn}>
            {creating ? '발급 중...' : '+ 코드 발급'}
          </button>
        </div>
        {createdCode && (
          <div style={S.createdBox}>
            새 코드 발급됨: <b style={S.bigCode}>{createdCode}</b>
            <button style={S.copyBtn} onClick={() => copyCode(createdCode)}>복사</button>
            <span style={S.sub}>이용자에게 이 코드를 전달하세요.</span>
          </div>
        )}

        {users.length === 0 ? (
          <div style={S.muted}>{dbOn ? '발급된 이용자 코드가 없습니다.' : ''}</div>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>상태</th>
                <th style={S.th}>이름</th>
                <th style={S.th}>코드</th>
                <th style={S.th}>분석 횟수</th>
                <th style={S.th}>전체 활동</th>
                <th style={S.th}>최근 접속</th>
                <th style={S.th}>발급일</th>
                <th style={S.th}>관리</th>
              </tr></thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ opacity: u.active ? 1 : 0.5 }}>
                    <td style={S.td}>
                      {u.online ? <span style={S.onlineBadge}>● 접속중</span>
                        : u.active ? <span style={S.offlineBadge}>오프라인</span>
                        : <span style={S.disabledBadge}>비활성</span>}
                    </td>
                    <td style={S.td}>{u.name || '(이름없음)'}</td>
                    <td style={S.td}>
                      <span style={S.code}>{u.code}</span>
                      <button style={S.copyMini} onClick={() => copyCode(u.code)}>복사</button>
                    </td>
                    <td style={S.td}>{u.analyze_count}회</td>
                    <td style={S.td}>{u.event_count}건</td>
                    <td style={S.td}>{fmtTime(u.last_seen_at)}</td>
                    <td style={S.td}>{fmtTime(u.created_at)}</td>
                    <td style={S.td}>
                      <button style={S.smallBtn} onClick={() => toggleActive(u)}>
                        {u.active ? '비활성화' : '활성화'}
                      </button>
                      <button style={{ ...S.smallBtn, ...S.dangerBtn }} onClick={() => removeUser(u)}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 지식베이스 (pgvector) */}
      <section style={S.card}>
        <div style={S.cardTitle}>
          지식베이스 (Supabase 벡터 검색)
          <span style={S.sub}>분석 시 참고하는 입시 자료</span>
        </div>
        {!kb.vectorEnabled ? (
          <div style={S.warn}>
            pgvector가 비활성 상태입니다. DATABASE_URL을 Supabase로 설정하고 `vector` 확장이 켜져 있는지 확인하세요.
          </div>
        ) : (
          <>
            <div style={S.kbCounts}>
              {['대입정책', '대학별전형', '합격자사례'].map(t => (
                <div key={t} style={S.kbStat}>
                  <div style={S.kbStatNum}>{kb.counts?.[t] || 0}</div>
                  <div style={S.kbStatLabel}>{t} 청크</div>
                </div>
              ))}
            </div>
            <div style={S.createRow}>
              <button style={{ ...S.primaryBtn, opacity: kbBusy ? 0.5 : 1 }} onClick={ingestDrive} disabled={!!kbBusy}>
                {kbBusy === 'drive' ? '가져오는 중...' : '📥 Google Drive에서 가져오기 (교체)'}
              </button>
              <button style={{ ...S.smallBtn, ...S.dangerBtn, padding: '10px 14px' }} onClick={clearKb} disabled={!!kbBusy}>전체 삭제</button>
            </div>
            <div style={{ ...S.createRow, marginTop: 4, alignItems: 'center' }}>
              <select style={{ ...S.input, flex: '0 0 160px' }} value={uploadType} onChange={e => setUploadType(e.target.value)}>
                <option value="합격자사례">합격자사례</option>
                <option value="대입정책">대입정책</option>
                <option value="대학별전형">대학별전형</option>
              </select>
              <input ref={uploadRef} type="file" multiple accept=".pdf,.txt,.md,.docx"
                onChange={e => ingestUpload(e.target.files)} disabled={!!kbBusy}
                style={{ ...S.input, flex: 1, padding: '8px 10px' }} />
            </div>
            {kbMsg && <div style={{ ...S.muted, color: kbMsg.startsWith('실패') ? '#ff8080' : '#22c55e' }}>{kbMsg}</div>}
          </>
        )}
      </section>

      {/* 최근 활동 로그 */}
      <section style={S.card}>
        <div style={S.cardTitle}>최근 활동 로그</div>
        {logs.length === 0 ? (
          <div style={S.muted}>기록이 없습니다.</div>
        ) : (
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>시각</th>
                <th style={S.th}>이용자</th>
                <th style={S.th}>활동</th>
                <th style={S.th}>상세</th>
                <th style={S.th}>IP</th>
              </tr></thead>
              <tbody>
                {logs.map(l => (
                  <tr key={l.id}>
                    <td style={S.td}>{fmtTime(l.created_at)}</td>
                    <td style={S.td}>{l.name || '관리자/알수없음'}</td>
                    <td style={S.td}>{LOG_TYPE_LABEL[l.type] || l.type}</td>
                    <td style={S.td}>{l.detail || '-'}</td>
                    <td style={S.td}>{l.ip || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const STYLES = {
  page: { padding: '28px 32px', maxWidth: 1100, margin: '0 auto', color: '#e6edf3' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  h2: { fontSize: 22, fontWeight: 700, margin: 0 },
  refreshBtn: { background: 'rgba(255,255,255,0.08)', color: '#e6edf3', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 },
  warn: { background: 'rgba(240,165,0,0.12)', border: '1px solid rgba(240,165,0,0.4)', color: '#f0c040', padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13.5, lineHeight: 1.5 },
  error: { background: 'rgba(255,80,80,0.12)', border: '1px solid rgba(255,80,80,0.4)', color: '#ff8080', padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13.5 },
  muted: { color: 'rgba(230,237,243,0.45)', fontSize: 13.5, padding: '8px 2px' },
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 20, marginBottom: 18 },
  cardTitle: { fontSize: 15.5, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 },
  sub: { fontSize: 12, color: 'rgba(230,237,243,0.4)', fontWeight: 400, marginLeft: 8 },
  liveDot: { width: 9, height: 9, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px #22c55e', display: 'inline-block' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', color: 'rgba(230,237,243,0.5)', fontWeight: 600, borderBottom: '1px solid rgba(255,255,255,0.1)', whiteSpace: 'nowrap' },
  td: { padding: '9px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', whiteSpace: 'nowrap' },
  code: { fontFamily: 'monospace', background: 'rgba(124,106,247,0.18)', color: '#b9acff', padding: '2px 7px', borderRadius: 6, fontSize: 12.5, letterSpacing: 1 },
  bigCode: { fontFamily: 'monospace', fontSize: 18, letterSpacing: 2, color: '#fff', margin: '0 8px' },
  createRow: { display: 'flex', gap: 10, marginBottom: 12 },
  input: { flex: 1, padding: '10px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, outline: 'none' },
  primaryBtn: { background: 'linear-gradient(135deg, #667eea, #764ba2)', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontWeight: 600, cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap' },
  createdBox: { background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 14, display: 'flex', alignItems: 'center', flexWrap: 'wrap' },
  copyBtn: { background: 'rgba(255,255,255,0.12)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12.5, marginRight: 10 },
  copyMini: { background: 'transparent', color: 'rgba(185,172,255,0.8)', border: 'none', cursor: 'pointer', fontSize: 11.5, marginLeft: 6, textDecoration: 'underline' },
  onlineBadge: { color: '#22c55e', fontWeight: 600, fontSize: 12.5 },
  offlineBadge: { color: 'rgba(230,237,243,0.4)', fontSize: 12.5 },
  disabledBadge: { color: '#ff8080', fontSize: 12.5 },
  smallBtn: { background: 'rgba(255,255,255,0.08)', color: '#e6edf3', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 12, marginRight: 6 },
  dangerBtn: { background: 'rgba(255,80,80,0.12)', borderColor: 'rgba(255,80,80,0.35)', color: '#ff8080' },
  kbCounts: { display: 'flex', gap: 12, marginBottom: 14 },
  kbStat: { flex: 1, background: 'rgba(124,106,247,0.1)', border: '1px solid rgba(124,106,247,0.25)', borderRadius: 10, padding: '14px 12px', textAlign: 'center' },
  kbStatNum: { fontSize: 24, fontWeight: 700, color: '#b9acff' },
  kbStatLabel: { fontSize: 12, color: 'rgba(230,237,243,0.55)', marginTop: 4 },
};
