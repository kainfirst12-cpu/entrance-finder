import { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';
import { univLabel, campusBadge, sortByCampus } from '../univName';

const token = () => localStorage.getItem('ef_token');
async function api(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token()}` } });
  if (res.status === 401 || res.status === 403) { const e = new Error('권한/인증'); e.auth = true; throw e; }
  return res.json();
}

function DataTable({ rows }) {
  if (!rows?.length) return null;
  return (
    <table style={S.table}>
      <tbody>
        {rows.map((cells, ri) => (
          <tr key={ri}>
            {cells.map((c, ci) => (
              <td key={ci} style={{ ...S.td, ...(ci === 0 ? S.tdHead : {}) }}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ title, count, children }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h3 style={S.secTitle}>{title} {count != null && <span style={S.secCount}>({count})</span>}</h3>
      {children}
    </section>
  );
}

export default function UnivInfo({ onAuthError }) {
  const [universities, setUniversities] = useState([]);
  const [meta, setMeta] = useState(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/api/univ-info/list')
      .then((j) => {
        if (!j.success) throw new Error(j.error || '목록 로드 실패');
        setUniversities(j.universities || []);
        setMeta({ source: j.source, years: j.years, count: j.count });
      })
      .catch((e) => { if (e.auth) onAuthError?.(); else setError(e.message); })
      .finally(() => setLoadingList(false));
  }, []);

  function openUniv(u) {
    setSelected(u); setDetail(null); setLoadingDetail(true); setError('');
    api(`/api/univ-info/${u.unvCd}`)
      .then((j) => { if (!j.success) throw new Error(j.error); setDetail(j); })
      .catch((e) => { if (e.auth) onAuthError?.(); else setError(e.message); })
      .finally(() => setLoadingDetail(false));
  }

  const nfc = (s) => (s || '').normalize('NFC');
  // 같은 대학의 본캠·지역캠(분교·제N캠퍼스)이 목록에서 흩어지지 않게 붙여 두고 본캠을 먼저 놓는다.
  const filtered = sortByCampus(q.trim()
    ? universities.filter((u) => nfc(u.name).includes(nfc(q)) || nfc(u.region).includes(nfc(q)))
    : universities);

  return (
    <div style={S.page}>
      <h2 style={S.h2}>🏫 대학별 입시정보</h2>
      <p style={S.lead}>
        대학어디가 공식 자료 기반 — 전형방법·전년도 입시결과·장애인전형을 대학별로 조회합니다.
        {meta && <> 현재 <b>{meta.count}개 대학</b> · 입시가이드 {meta.years?.guide} · 결과 {meta.years?.criteria}.</>}
      </p>

      <div style={S.layout}>
        {/* 좌: 대학 목록 */}
        <div style={S.listCol}>
          <input style={S.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="대학명·지역 검색" />
          <div style={S.listScroll}>
            {loadingList && <div style={S.muted}>불러오는 중…</div>}
            {!loadingList && filtered.map((u) => (
              <button key={u.unvCd} onClick={() => openUniv(u)}
                style={{ ...S.listItem, ...(selected?.unvCd === u.unvCd ? S.listItemActive : {}) }}>
                {univLabel(u.name)}
                {campusBadge(u.name) && <span style={S.campusTag}>{campusBadge(u.name)}</span>}
                <span style={S.region}>{u.region}</span>
              </button>
            ))}
            {!loadingList && !filtered.length && <div style={S.muted}>검색 결과 없음</div>}
          </div>
        </div>

        {/* 우: 상세 */}
        <div style={S.detailCol}>
          {error && <div style={S.error}>⚠ {error}</div>}
          {!selected && <div style={S.placeholder}>왼쪽에서 대학을 선택하세요.</div>}
          {selected && (
            <>
              <h1 style={S.univName}>
                {univLabel(selected.name)}
                {campusBadge(selected.name) && <span style={S.campusTag}>{campusBadge(selected.name)}</span>}
                <span style={S.region}>{selected.region}</span>
              </h1>
              {loadingDetail && <div style={S.muted}>상세 불러오는 중…</div>}
              {detail && (
                <>
                  {detail.guide?.tables?.length > 0 && (
                    <Section title={`전형방법 (입시가이드 ${detail.guide.syr}학년도)`} count={`전형 ${detail.guide.tables.length}개`}>
                      {detail.guide.tables.map((t, i) => <DataTable key={i} rows={t} />)}
                    </Section>
                  )}
                  {detail.criteria?.sections?.length > 0 && (
                    <Section title={`전형평가기준·전년도결과 (${detail.criteria.syr}학년도)`} count={`구분 ${detail.criteria.sections.length}개`}>
                      {detail.criteria.sections.map((s, i) => (
                        <div key={i} style={{ marginBottom: 14 }}>
                          {s.tables.map((t, j) => <DataTable key={j} rows={t} />)}
                        </div>
                      ))}
                    </Section>
                  )}
                  {(detail.disabled?.blocks?.length > 0 || detail.disabled?.tables?.length > 0) && (
                    <Section title={`장애인전형 (${detail.disabled.syr}학년도)`}>
                      {detail.disabled.tables?.map((t, i) => <DataTable key={i} rows={t} />)}
                      {detail.disabled.blocks?.length > 0 && (
                        <ul style={S.blockList}>
                          {detail.disabled.blocks.map((b, i) => <li key={i} style={{ marginBottom: 4 }}>{b}</li>)}
                        </ul>
                      )}
                    </Section>
                  )}
                  {!detail.guide?.tables?.length && !detail.criteria?.sections?.length && !detail.disabled?.blocks?.length && (
                    <div style={S.muted}>공개된 상세 정보가 없습니다.</div>
                  )}
                  <div style={S.source}>출처: {detail.source}</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const S = {
  page: { padding: '24px 28px', maxWidth: 1100, margin: '0 auto', color: '#e8eef3', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  h2: { fontSize: 22, fontWeight: 700, margin: '0 0 6px' },
  lead: { color: '#9db0bd', fontSize: 13.5, margin: '0 0 16px', lineHeight: 1.5 },
  layout: { display: 'flex', gap: 20, flex: 1, minHeight: 0 },
  listCol: { width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 },
  input: { padding: '10px 12px', borderRadius: 9, border: '1px solid #2a3a4a', background: '#16212e', color: '#e8eef3', fontSize: 14, outline: 'none', marginBottom: 10, boxSizing: 'border-box' },
  listScroll: { overflowY: 'auto', flex: 1, paddingRight: 4 },
  listItem: { display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4, border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: '#16212e', color: '#cdd9e2' },
  listItemActive: { background: '#14b8a6', color: '#fff' },
  region: { fontSize: 11, opacity: 0.7 },
  campusTag: { margin: '0 6px', fontSize: 10.5, fontWeight: 800, color: '#9a5b00', background: '#fff4e0', border: '1px solid #f3ddb4', borderRadius: 6, padding: '1px 6px' },
  detailCol: { flex: 1, overflowY: 'auto', minWidth: 0, paddingRight: 6 },
  placeholder: { color: '#6b7d8a', marginTop: 40, textAlign: 'center' },
  univName: { fontSize: 22, fontWeight: 800, margin: '0 0 16px' },
  secTitle: { fontSize: 16, fontWeight: 700, margin: '0 0 12px', paddingBottom: 6, borderBottom: '2px solid #14b8a6', color: '#e8eef3' },
  secCount: { fontSize: 12, color: '#9db0bd', fontWeight: 400 },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13, marginBottom: 10 },
  td: { border: '1px solid #2a3a4a', padding: '6px 8px', verticalAlign: 'top', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#e8eef3' },
  tdHead: { background: '#1c2937', fontWeight: 600, color: '#9db0bd' },
  blockList: { fontSize: 13, lineHeight: 1.6, paddingLeft: 18, margin: 0, color: '#cdd9e2' },
  muted: { color: '#6b7d8a', fontSize: 14, padding: '8px 4px' },
  error: { background: 'rgba(248,113,113,0.14)', border: '1px solid #fca5a5', color: '#f87171', padding: '10px 14px', borderRadius: 9, fontSize: 13.5, marginBottom: 12 },
  source: { marginTop: 24, paddingTop: 12, borderTop: '1px solid #2a3a4a', fontSize: 11, color: '#6b7d8a' },
};
