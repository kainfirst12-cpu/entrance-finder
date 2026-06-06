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
  const [kbProgress, setKbProgress] = useState(null); // {state:'running'|'done'|'error', phase, docsDone, docs, chunks, error}
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
    if (!confirm('Google Drive의 지식베이스를 Supabase로 가져옵니다.\n기존 지식베이스는 교체되며, 백그라운드로 처리됩니다(1~3분). 진행할까요?')) return;
    setKbBusy('drive'); setKbMsg('');
    setKbProgress({ state: 'running', phase: 'drive-read', docsDone: 0, docs: 0, chunks: 0 });
    try {
      const r = await api('/api/admin/ingest/drive', { method: 'POST', body: JSON.stringify({ replace: true }) });
      if (!r.success) { setKbProgress({ state: 'error', error: r.message || '시작 실패' }); setKbBusy(''); return; }
      // 백그라운드 진행 상태를 폴링 (요청이 즉시 끝나므로 Failed to fetch 없음)
      const poll = async () => {
        try {
          const s = await api('/api/admin/ingest/status');
          if (s.counts) setKb(k => ({ ...k, counts: s.counts }));
          const st = s.state || {};
          if (st.running) {
            setKbProgress({ state: 'running', phase: st.phase, docsDone: st.docsDone || 0, docs: st.docs || 0, chunks: st.chunks || 0 });
            setTimeout(poll, 2500);
          } else if (st.phase === 'done') {
            setKbProgress({ state: 'done', docs: st.docs, chunks: st.chunks }); setKbBusy('');
          } else if (st.phase === 'error') {
            setKbProgress({ state: 'error', error: st.error || '알 수 없는 오류' }); setKbBusy('');
          } else { setKbProgress(null); setKbBusy(''); }
        } catch (e) {
          if (e.auth) { onAuthError?.(); return; }
          setTimeout(poll, 4000); // 일시적 네트워크 흔들림이면 재시도
        }
      };
      setTimeout(poll, 2000);
    } catch (e) { handleErr(e); setKbProgress({ state: 'error', error: e.message || '' }); setKbBusy(''); }
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
      <style>{`@keyframes efspin { to { transform: rotate(360deg); } }`}</style>
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
            {kbProgress && (() => {
              const p = kbProgress;
              if (p.state === 'running') {
                const pct = p.docs > 0 ? Math.round((p.docsDone / p.docs) * 100) : null;
                return (
                  <div style={S.progressBox}>
                    <div style={{ ...S.progressHead, color: '#14b8a6' }}>
                      <span style={S.spinner} />
                      {p.phase === 'drive-read' ? 'Drive에서 문서 읽는 중...' : `자료 가져오는 중 ${pct != null ? `(${pct}%)` : ''}`}
                    </div>
                    {p.phase !== 'drive-read' && (
                      <>
                        <div style={S.progressBarOuter}>
                          <div style={{ ...S.progressBarInner, width: `${pct ?? 5}%` }} />
                        </div>
                        <div style={S.progressSub}>문서 {p.docsDone} / {p.docs}건 처리 · 누적 {p.chunks.toLocaleString()}청크 저장</div>
                      </>
                    )}
                    <div style={S.progressSub}>창을 닫아도 서버에서 계속 진행됩니다. 잠시 후 자동 갱신됩니다.</div>
                  </div>
                );
              }
              if (p.state === 'done') {
                return (
                  <div style={{ ...S.progressBox, background: 'rgba(52,211,153,0.14)', borderColor: 'rgba(52,211,153,0.45)' }}>
                    <div style={{ ...S.progressHead, color: '#34d399', marginBottom: 4 }}>✅ 가져오기 완료</div>
                    <div style={S.progressSub}>문서 {p.docs}건 → {Number(p.chunks).toLocaleString()}청크 저장됨. 이제 분석에 이 자료가 활용됩니다.</div>
                  </div>
                );
              }
              return (
                <div style={{ ...S.progressBox, background: 'rgba(248,113,113,0.14)', borderColor: 'rgba(248,113,113,0.45)' }}>
                  <div style={{ ...S.progressHead, color: '#f87171', marginBottom: 4 }}>❌ 실패</div>
                  <div style={S.progressSub}>{p.error}</div>
                </div>
              );
            })()}
            {kbMsg && <div style={{ ...S.muted, fontWeight: 600, color: kbMsg.startsWith('실패') ? '#f87171' : '#34d399' }}>{kbMsg}</div>}
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

// 앱은 밝은(흰색) 테마 — 어두운 글씨/흰 카드로 또렷하게
const STYLES = {
  page: { padding: '28px 32px', maxWidth: 1100, margin: '0 auto', color: '#e8eef3' },
  headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  h2: { fontSize: 22, fontWeight: 700, margin: 0, color: '#e8eef3' },
  refreshBtn: { background: '#16212e', color: '#e8eef3', border: '1px solid #d8d5cc', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  warn: { background: 'rgba(251,191,36,0.14)', border: '1px solid #fcd34d', color: '#fbbf24', padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 13.5, lineHeight: 1.5 },
  error: { background: 'rgba(248,113,113,0.14)', border: '1px solid #fca5a5', color: '#f87171', padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13.5 },
  muted: { color: '#9db0bd', fontSize: 13.5, padding: '8px 2px' },
  card: { background: '#16212e', border: '1px solid #e8e6df', borderRadius: 14, padding: 20, marginBottom: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  cardTitle: { fontSize: 15.5, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, color: '#e8eef3' },
  sub: { fontSize: 12, color: '#6b7d8a', fontWeight: 400, marginLeft: 8 },
  liveDot: { width: 9, height: 9, borderRadius: '50%', background: '#34d399', boxShadow: '0 0 8px #16a34a', display: 'inline-block' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e8eef3' },
  th: { textAlign: 'left', padding: '8px 10px', color: '#9db0bd', fontWeight: 600, borderBottom: '2px solid #e8e6df', whiteSpace: 'nowrap' },
  td: { padding: '9px 10px', borderBottom: '1px solid #f0eee8', whiteSpace: 'nowrap', color: '#e8eef3' },
  code: { fontFamily: 'monospace', background: 'rgba(45,212,191,0.15)', color: '#14b8a6', padding: '2px 7px', borderRadius: 6, fontSize: 12.5, letterSpacing: 1, fontWeight: 600 },
  bigCode: { fontFamily: 'monospace', fontSize: 18, letterSpacing: 2, color: '#34d399', margin: '0 8px', fontWeight: 700 },
  createRow: { display: 'flex', gap: 10, marginBottom: 12 },
  input: { flex: 1, padding: '10px 14px', borderRadius: 9, border: '1px solid #d8d5cc', background: '#16212e', color: '#e8eef3', fontSize: 14, outline: 'none' },
  primaryBtn: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 18px', fontWeight: 600, cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap' },
  createdBox: { background: 'rgba(52,211,153,0.14)', border: '1px solid #86efac', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 14, display: 'flex', alignItems: 'center', flexWrap: 'wrap', color: '#34d399' },
  copyBtn: { background: '#34d399', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', cursor: 'pointer', fontSize: 12.5, marginRight: 10 },
  copyMini: { background: 'transparent', color: '#14b8a6', border: 'none', cursor: 'pointer', fontSize: 11.5, marginLeft: 6, textDecoration: 'underline' },
  onlineBadge: { color: '#34d399', fontWeight: 700, fontSize: 12.5 },
  offlineBadge: { color: '#6b7d8a', fontSize: 12.5 },
  disabledBadge: { color: '#f87171', fontSize: 12.5 },
  smallBtn: { background: '#131c26', color: '#e8eef3', border: '1px solid #d8d5cc', borderRadius: 7, padding: '5px 10px', cursor: 'pointer', fontSize: 12, marginRight: 6 },
  dangerBtn: { background: 'rgba(248,113,113,0.14)', borderColor: 'rgba(248,113,113,0.45)', color: '#f87171' },
  kbCounts: { display: 'flex', gap: 12, marginBottom: 14 },
  kbStat: { flex: 1, background: 'rgba(45,212,191,0.15)', border: '1px solid #9fe3d8', borderRadius: 10, padding: '14px 12px', textAlign: 'center' },
  kbStatNum: { fontSize: 26, fontWeight: 800, color: '#14b8a6' },
  kbStatLabel: { fontSize: 12, color: '#9db0bd', marginTop: 4, fontWeight: 600 },
  // 진행 상태 박스
  progressBox: { marginTop: 12, padding: '14px 16px', borderRadius: 10, border: '1px solid #e8e6df', background: '#1c2937' },
  progressHead: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 700, marginBottom: 10 },
  progressBarOuter: { height: 10, background: '#2a3a48', borderRadius: 6, overflow: 'hidden' },
  progressBarInner: { height: '100%', background: 'linear-gradient(90deg,#14b8a6,#4f46e5)', borderRadius: 6, transition: 'width 0.4s' },
  progressSub: { fontSize: 12.5, color: '#9db0bd', marginTop: 8 },
  spinner: { width: 14, height: 14, border: '2px solid #9fe3d8', borderTopColor: '#14b8a6', borderRadius: '50%', display: 'inline-block', animation: 'efspin 0.8s linear infinite' },
};
