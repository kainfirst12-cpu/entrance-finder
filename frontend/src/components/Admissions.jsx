import { useState, useEffect, useRef, Fragment } from 'react';
import { API_BASE } from '../apiBase';

const token = () => localStorage.getItem('ef_token');
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) { const e = new Error('권한/인증'); e.auth = res.status === 401; throw e; }
  return res.json();
}

const TRACKS = ['', '수시', '정시', '논술'];
const UNIV_TYPES = ['', '4년제', '전문대'];

export default function Admissions({ onAuthError }) {
  const isAdmin = (localStorage.getItem('ef_role') || 'user') === 'admin';
  const [q, setQ] = useState({ univ: '', dept: '', track: '', univType: '', year: '' });
  const [rows, setRows] = useState([]);
  const [stats, setStats] = useState({ total: 0, years: [] });
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);

  // 업로드 (관리자)
  const [upYear, setUpYear] = useState('');
  const [upType, setUpType] = useState('4년제');
  const [upTrack, setUpTrack] = useState('수시');
  const [uploading, setUploading] = useState(false);
  const [upMsg, setUpMsg] = useState('');
  const fileRef = useRef(null);

  const loadStats = async () => {
    try { const s = await api('/api/admissions/stats'); if (s.success) setStats(s.stats || { total: 0, years: [] }); }
    catch (e) { if (e.auth) onAuthError?.(); }
  };
  useEffect(() => { loadStats(); }, []);

  const search = async () => {
    setLoading(true); setError(''); setSearched(true); setExpanded(null);
    try {
      const params = new URLSearchParams();
      Object.entries(q).forEach(([k, v]) => { if (v) params.append(k, v); });
      const d = await api(`/api/admissions/search?${params.toString()}`);
      if (d.success) setRows(d.rows || []);
      else setError(d.message || '검색 실패');
    } catch (e) { if (e.auth) onAuthError?.(); else setError(e.message); }
    finally { setLoading(false); }
  };

  const upload = async (file) => {
    if (!file) return;
    setUploading(true); setUpMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('year', upYear); fd.append('univType', upType); fd.append('track', upTrack);
      const res = await fetch(`${API_BASE}/api/admin/admissions/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
      const d = await res.json();
      if (d.success) { setUpMsg(`완료: ${d.inserted}행 추가`); setStats(d.stats || stats); }
      else setUpMsg('실패: ' + (d.message || ''));
    } catch (e) { setUpMsg('실패: ' + e.message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const clearAll = async () => {
    if (!confirm('업로드된 입결 데이터를 전부 삭제할까요?')) return;
    try { const d = await api('/api/admin/admissions', { method: 'DELETE' }); if (d.success) { setStats(d.stats || { total: 0, years: [] }); setRows([]); } }
    catch (e) { if (e.auth) onAuthError?.(); }
  };

  const rawKeys = (raw) => Object.entries(raw || {}).filter(([, v]) => String(v ?? '').trim());
  const S = STYLES;

  return (
    <div style={S.page}>
      <h2 style={S.h2}>🎓 대학 입결 조회</h2>
      <p style={S.lead}>
        업로드된 공식 입결 자료(어디가 등)에서 대학·학과·전형별로 검색합니다.
        {stats.total > 0
          ? <> 현재 <b>{Number(stats.total).toLocaleString()}건</b>{stats.years?.length ? ` · 연도 ${stats.years.join(', ')}` : ''}.</>
          : ' 아직 데이터가 없습니다.'}
      </p>

      {isAdmin && (
        <div style={S.uploadCard}>
          <div style={S.uploadTitle}>📤 입결 자료 업로드 <span style={S.opt}>관리자 전용 · 엑셀(.xlsx)/CSV</span></div>
          <div style={S.upRow}>
            <select style={{ ...S.input, flex: '0 0 110px' }} value={upType} onChange={e => setUpType(e.target.value)}>
              <option value="4년제">4년제</option><option value="전문대">전문대</option>
            </select>
            <select style={{ ...S.input, flex: '0 0 100px' }} value={upTrack} onChange={e => setUpTrack(e.target.value)}>
              <option value="수시">수시</option><option value="정시">정시</option><option value="논술">논술</option>
            </select>
            <input style={{ ...S.input, flex: '0 0 110px' }} value={upYear} onChange={e => setUpYear(e.target.value)} placeholder="학년도 예:2026" />
            <button style={S.upBtn} onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? '업로드 중...' : '파일 선택 후 업로드'}</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={e => upload(e.target.files?.[0])} />
            {stats.total > 0 && <button style={{ ...S.upBtn, background: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5' }} onClick={clearAll}>전체 삭제</button>}
          </div>
          {upMsg && <div style={{ ...S.opt, color: upMsg.startsWith('실패') ? '#dc2626' : '#16a34a', marginTop: 8 }}>{upMsg}</div>}
          <div style={{ ...S.opt, marginTop: 6 }}>※ 업로드 전 위에서 구분(수시/정시/논술)·4년제/전문대·학년도를 먼저 고르세요. 파일에 해당 열이 있으면 자동 반영됩니다.</div>
        </div>
      )}

      <div style={S.card}>
        <div style={S.searchRow}>
          <input style={S.input} value={q.univ} onChange={e => setQ({ ...q, univ: e.target.value })} placeholder="대학 (예: 서울대)" onKeyDown={e => e.key === 'Enter' && search()} />
          <input style={S.input} value={q.dept} onChange={e => setQ({ ...q, dept: e.target.value })} placeholder="학과/모집단위 (예: 컴퓨터)" onKeyDown={e => e.key === 'Enter' && search()} />
          <select style={{ ...S.input, flex: '0 0 110px' }} value={q.track} onChange={e => setQ({ ...q, track: e.target.value })}>
            {TRACKS.map(t => <option key={t} value={t}>{t || '전형 전체'}</option>)}
          </select>
          <select style={{ ...S.input, flex: '0 0 110px' }} value={q.univType} onChange={e => setQ({ ...q, univType: e.target.value })}>
            {UNIV_TYPES.map(t => <option key={t} value={t}>{t || '구분 전체'}</option>)}
          </select>
          <select style={{ ...S.input, flex: '0 0 100px' }} value={q.year} onChange={e => setQ({ ...q, year: e.target.value })}>
            <option value="">연도 전체</option>
            {(stats.years || []).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button style={S.searchBtn} onClick={search} disabled={loading}>{loading ? '검색 중...' : '🔍 검색'}</button>
        </div>

        {error && <div style={S.error}>{error}</div>}

        {searched && !loading && rows.length === 0 && <div style={S.muted}>검색 결과가 없습니다. 대학/학과 키워드를 바꿔보세요.</div>}

        {rows.length > 0 && (
          <div style={S.tableWrap}>
            <div style={S.resultCount}>{rows.length}건 {rows.length >= 300 ? '(상위 300건)' : ''}</div>
            <table style={S.table}>
              <thead><tr>
                <th style={S.th}>대학</th><th style={S.th}>학과/모집단위</th><th style={S.th}>전형</th>
                <th style={S.th}>구분</th><th style={S.th}>연도</th><th style={S.th}></th>
              </tr></thead>
              <tbody>
                {rows.map(r => (
                  <Fragment key={r.id}>
                    <tr>
                      <td style={S.td}>{r.univ || '-'}</td>
                      <td style={S.td}>{r.dept || '-'}</td>
                      <td style={S.td}>{r.admission_type || '-'}</td>
                      <td style={S.td}>{[r.track, r.univ_type].filter(Boolean).join(' · ') || '-'}</td>
                      <td style={S.td}>{r.year || '-'}</td>
                      <td style={S.td}><button style={S.detailBtn} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>{expanded === r.id ? '닫기' : '입결 보기'}</button></td>
                    </tr>
                    {expanded === r.id && (
                      <tr>
                        <td style={S.rawCell} colSpan={6}>
                          <div style={S.rawGrid}>
                            {rawKeys(r.raw).map(([k, v]) => (
                              <div key={k} style={S.rawItem}><span style={S.rawKey}>{k}</span><span style={S.rawVal}>{String(v)}</span></div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {stats.total === 0 && !isAdmin && <div style={S.muted}>아직 업로드된 입결 자료가 없습니다. 관리자에게 자료 업로드를 요청하세요.</div>}
      </div>
    </div>
  );
}

const STYLES = {
  page: { padding: '24px 28px', maxWidth: 1000, margin: '0 auto', color: '#1a1916' },
  h2: { fontSize: 22, fontWeight: 700, margin: '0 0 6px' },
  lead: { color: '#6b6860', fontSize: 13.5, margin: '0 0 16px', lineHeight: 1.5 },
  opt: { fontSize: 12, color: '#9b9890', fontWeight: 400 },
  uploadCard: { background: '#e4f7f3', border: '1px solid #9fe3d8', borderRadius: 12, padding: 16, marginBottom: 16 },
  uploadTitle: { fontWeight: 700, fontSize: 14, marginBottom: 10 },
  upRow: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' },
  upBtn: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  card: { background: '#fff', border: '1px solid #e8e6df', borderRadius: 14, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  searchRow: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  input: { flex: 1, minWidth: 120, padding: '10px 12px', borderRadius: 9, border: '1px solid #d8d5cc', background: '#fff', color: '#1a1916', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  searchBtn: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 14, whiteSpace: 'nowrap' },
  error: { background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', padding: '10px 14px', borderRadius: 9, fontSize: 13.5, marginTop: 12 },
  muted: { color: '#9b9890', fontSize: 14, padding: '16px 4px' },
  tableWrap: { overflowX: 'auto', marginTop: 14 },
  resultCount: { fontSize: 12.5, color: '#6b6860', marginBottom: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13.5 },
  th: { textAlign: 'left', padding: '9px 10px', color: '#6b6860', fontWeight: 600, borderBottom: '2px solid #e8e6df', whiteSpace: 'nowrap' },
  td: { padding: '9px 10px', borderBottom: '1px solid #f0eee8', color: '#1a1916' },
  detailBtn: { background: '#e4f7f3', color: '#14b8a6', border: 'none', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' },
  rawCell: { padding: '10px 12px', background: '#f9f8f5', borderBottom: '1px solid #e8e6df' },
  rawGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '6px 16px' },
  rawItem: { display: 'flex', gap: 8, fontSize: 12.5, borderBottom: '1px dotted #e0ded6', padding: '2px 0' },
  rawKey: { color: '#6b6860', minWidth: 90, fontWeight: 600 },
  rawVal: { color: '#1a1916' },
};
