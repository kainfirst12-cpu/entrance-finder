import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../apiBase';
import { loadRegionIndex } from '../schoolCatalog';

// 🏫 학교별 정리 (관리자 전체 자료함 안의 두 번째 보기)
//   학교 해설을 '보고서'가 아니라 '학교' 단위로 뒤집어 본다 — 같은 학교 해설이 여러 원장에게서 여러 벌 쌓이기 때문.
//   · 학교마다: 해설 몇 벌(단독·비교) · 몇 개 학원이 찾았나 · 대표본 · 미검토 · 옛 수치
//   · 검토 단계: 미검토 → 검토 완료 → ⭐ 대표본(같은 학교에 하나)
//   · 대표본이 쓰이는 곳: 학원이 같은 학교 해설을 만들려 할 때 먼저 보여 줌 · 생기부 분석/브리핑/상담 AI 가 재학 학교 맥락으로 읽음
//   학교 이름·지역은 학교 목록 파일(school_ids)로 찾는다. id 가 없는 옛 복사본은 '학교 정보 없음'에 모은다.

const token = () => localStorage.getItem('ef_token');
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

const STATUS = {
  new: { label: '미검토', color: '#9aa4b2' },
  reviewed: { label: '검토 완료', color: '#60a5fa' },
  rep: { label: '⭐ 대표본', color: '#fbbf24' },
};
const day = (s) => (s ? new Date(s).toLocaleDateString('ko-KR', { year: '2-digit', month: 'numeric', day: 'numeric' }) : '');
const PAGE = 50;

export default function AdminSchoolShelf({ onOpen, refreshKey }) {
  const [rows, setRows] = useState(null);
  const [idx, setIdx] = useState(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [region, setRegion] = useState('');
  const [level, setLevel] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState('demand');
  const [openKey, setOpenKey] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [busy, setBusy] = useState(0);

  const load = () => api('/api/admin/school-library').then((d) => {
    if (!d.success) throw new Error(d.message || '불러오지 못했습니다');
    setRows(d.items || []);
  }).catch((e) => { setMsg(e.message); setRows([]); });
  useEffect(() => { load(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadRegionIndex().then(setIdx).catch(() => setMsg('학교 목록 파일을 읽지 못해 지역을 표시하지 못합니다')); }, []);

  // 해설 → 학교로 뒤집기. 비교 해설은 그 안의 학교마다 한 번씩 들어간다.
  const schools = useMemo(() => {
    const map = new Map();
    for (const r of rows || []) {
      const ids = Array.isArray(r.school_ids) ? r.school_ids.map(String) : [];
      const names = String(r.school_names || '').split(/\s*,\s*/);
      const keys = ids.length ? ids : ['none'];
      keys.forEach((id, i) => {
        if (!map.has(id)) {
          const c = idx?.byId.get(id);
          map.set(id, {
            id, name: id === 'none' ? '학교 정보 없음(옛 복사본)' : (c?.name || names[i] || id),
            region: id === 'none' ? '' : (c?.region || '지역 미상'), level: c?.level || '', dataYear: c?.dataYear || null, reports: [],
          });
        }
        map.get(id).reports.push(r);
      });
    }
    return [...map.values()].map((s) => {
      const makers = new Set(s.reports.map((r) => r.auto_from || r.owner_name || '?'));
      const rep = s.reports.find((r) => r.review_status === 'rep' && r.kind === 'school');
      const stale = (r) => !!(s.dataYear && r.data_year && Number(r.data_year) < s.dataYear);
      return {
        ...s, makers: makers.size, makerNames: [...makers],
        singles: s.reports.filter((r) => r.kind === 'school').length,
        compares: s.reports.filter((r) => r.kind === 'compare').length,
        rep, repStale: rep ? stale(rep) : false, stale,
        newCount: s.reports.filter((r) => r.review_status === 'new').length,
        last: s.reports.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), ''),
      };
    });
  }, [rows, idx]);

  const regionCounts = useMemo(() => {
    const c = {};
    for (const s of schools) if (s.region) c[s.region] = (c[s.region] || 0) + 1;
    return Object.entries(c).sort((a, b) => (a[0] === '지역 미상') - (b[0] === '지역 미상') || b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  }, [schools]);

  const list = useMemo(() => {
    const t = q.trim().replace(/\s+/g, '');
    let l = schools.filter((s) => (!region || s.region === region)
      && (!level || s.level === level)
      && (!t || s.name.replace(/\s+/g, '').includes(t) || s.region.includes(t)));
    if (status === 'norep') l = l.filter((s) => !s.rep && s.id !== 'none');
    if (status === 'new') l = l.filter((s) => s.newCount > 0);
    if (status === 'rep') l = l.filter((s) => s.rep);
    if (status === 'stale') l = l.filter((s) => s.repStale);
    const by = {
      demand: (a, b) => b.makers - a.makers || b.reports.length - a.reports.length || (b.last > a.last ? 1 : -1),
      recent: (a, b) => (b.last > a.last ? 1 : b.last < a.last ? -1 : 0),
      name: (a, b) => a.name.localeCompare(b.name, 'ko'),
    };
    // '학교 정보 없음' 묶음은 정리 대상이 아니라 늘 맨 아래
    return [...l].sort((a, b) => (a.id === 'none') - (b.id === 'none') || by[sort](a, b));
  }, [schools, q, region, level, status, sort]);
  useEffect(() => { setShown(PAGE); }, [q, region, level, status, sort]);

  const totals = useMemo(() => ({
    schools: schools.filter((s) => s.id !== 'none').length,
    withRep: schools.filter((s) => s.rep).length,
    needs: schools.filter((s) => !s.rep && s.id !== 'none').length,
    unreviewed: (rows || []).filter((r) => r.review_status === 'new').length,
  }), [schools, rows]);

  const setReview = async (r, next) => {
    if (next === 'rep') {
      const warn = r.has_focus
        ? '\n\n⚠ 이 해설은 상담 학생 상황을 넣고 만든 것입니다. 본문에 특정 학생 이야기가 있으면 다른 학원 화면과 AI 분석에도 그대로 나갑니다. 열어서 확인·수정하셨나요?'
        : '';
      if (!window.confirm(`'${r.title}'을(를) 대표본으로 정할까요?\n\n같은 학교 해설을 만들려는 학원에 먼저 보여 주고, 이 학교 학생의 생기부 분석·상담 AI 가 참고합니다. 같은 학교의 이전 대표본은 '검토 완료'로 내려갑니다.${warn}`)) return;
    }
    setBusy(r.id); setMsg('');
    try {
      const d = await api(`/api/admin/school-library/${r.id}/review`, { method: 'PATCH', body: { status: next } });
      if (!d.success) throw new Error(d.message || '바꾸지 못했습니다');
      setRows((xs) => xs.map((x) => {
        if (x.id === r.id) return { ...x, review_status: d.item.review_status, reviewed_at: d.item.reviewed_at };
        if (next === 'rep' && x.school_key === d.item.school_key && x.review_status === 'rep') return { ...x, review_status: 'reviewed' };
        return x;
      }));
    } catch (e) { setMsg(e.message); } finally { setBusy(0); }
  };

  if (rows === null) return <p style={S.sub}>불러오는 중…</p>;

  return (
    <div>
      <div style={S.stats}>
        <span>학교 <b>{totals.schools}</b>곳</span>
        <span>⭐ 대표본 있음 <b>{totals.withRep}</b></span>
        <span>대표본 필요 <b style={{ color: totals.needs ? '#fbbf24' : undefined }}>{totals.needs}</b></span>
        <span>미검토 해설 <b>{totals.unreviewed}</b>건</span>
      </div>
      <div style={S.filters}>
        <input style={S.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="학교·지역 검색 (예: 초지, 안산)" />
        <div style={S.seg}>
          {[['', '전체'], ['고등학교', '고교'], ['중학교', '중학']].map(([k, l]) => (
            <button key={k || 'all'} style={{ ...S.segBtn, ...(level === k ? S.segOn : {}) }} onClick={() => setLevel(k)}>{l}</button>
          ))}
        </div>
        <select style={S.select} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">상태 전체</option>
          <option value="norep">대표본 필요</option>
          <option value="new">미검토 있음</option>
          <option value="rep">⭐ 대표본 있음</option>
          <option value="stale">대표본이 옛 수치</option>
        </select>
        <select style={S.select} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="demand">많이 찾은 순</option>
          <option value="recent">최근 순</option>
          <option value="name">이름 순</option>
        </select>
      </div>
      {regionCounts.length > 0 && (
        <div style={S.chips}>
          <span style={S.chipLabel}>지역</span>
          <button style={{ ...S.chip, ...(!region ? S.chipOn : {}) }} onClick={() => setRegion('')}>전체</button>
          {regionCounts.map(([r, n]) => (
            <button key={r} style={{ ...S.chip, ...(region === r ? S.chipOn : {}) }} onClick={() => setRegion(region === r ? '' : r)}>{r} <b>{n}</b></button>
          ))}
        </div>
      )}
      {msg && <div style={S.err}>{msg}</div>}
      {!list.length ? <p style={S.sub}>조건에 맞는 학교가 없습니다.</p> : (
        <div style={S.list}>
          {list.slice(0, shown).map((s) => {
            const on = openKey === s.id;
            return (
              <div key={s.id} style={S.school}>
                <div style={S.schoolHead} onClick={() => setOpenKey(on ? '' : s.id)}>
                  <span style={S.caret}>{on ? '▾' : '▸'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.schoolName}>
                      {s.name}
                      {s.rep ? <span style={{ ...S.pill, ...pillColor('#fbbf24') }}>⭐ 대표본</span> : s.id !== 'none' && <span style={{ ...S.pill, ...pillColor('#9aa4b2') }}>대표본 없음</span>}
                      {s.repStale && <span style={{ ...S.pill, ...pillColor('#f87171') }} title={`대표본은 ${s.rep.data_year}학년도 수치 — 공시가 ${s.dataYear}학년도로 갱신됨`}>옛 수치</span>}
                      {s.newCount > 0 && <span style={{ ...S.pill, ...pillColor('#818cf8') }}>미검토 {s.newCount}</span>}
                    </div>
                    <div style={S.sub}>
                      {s.region && `📍 ${s.region} · `}해설 {s.reports.length}건(단독 {s.singles} · 비교 {s.compares}) · 원장 {s.makers}명 · 최근 {day(s.last)}
                    </div>
                  </div>
                </div>
                {on && (
                  <div style={S.reports}>
                    <div style={S.sub}>찾은 곳: {s.makerNames.join(', ')}</div>
                    {s.reports.map((r) => {
                      const st = STATUS[r.review_status] || STATUS.new;
                      return (
                        <div key={r.id} style={S.report}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={S.reportTitle}>
                              <span style={{ ...S.pill, marginLeft: 0, marginRight: 6, ...pillColor(st.color) }}>{st.label}</span>
                              {r.title}
                            </div>
                            <div style={S.sub}>
                              {r.kind === 'compare' ? '비교' : '단독'} · {r.auto_from || r.owner_name || '—'}{r.auto_from ? '(자동 사본)' : ''} · {day(r.updated_at)}
                              {r.data_year ? ` · ${r.data_year}학년도 수치` : ''}
                              {s.stale(r) && <span style={{ color: '#f87171' }}> · 옛 수치</span>}
                              {r.has_focus && <span style={{ color: '#fbbf24' }}> · 학생 맞춤(메모 있음)</span>}
                            </div>
                          </div>
                          <div style={S.actions}>
                            <button style={S.btn} onClick={() => onOpen?.('report', r.id)}>열기</button>
                            {r.review_status === 'new' && <button style={S.btn} disabled={busy === r.id} onClick={() => setReview(r, 'reviewed')}>✔ 검토 완료</button>}
                            {r.review_status !== 'rep' && (
                              <button style={{ ...S.btn, ...S.repBtn }} disabled={busy === r.id || !r.school_key}
                                title={r.school_key ? '' : '학교 정보가 없는 옛 복사본은 대표본으로 정할 수 없습니다'}
                                onClick={() => setReview(r, 'rep')}>⭐ 대표본으로</button>
                            )}
                            {r.review_status !== 'new' && <button style={S.linkBtn} disabled={busy === r.id} onClick={() => setReview(r, 'new')}>미검토로</button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
          {list.length > shown && <button style={{ ...S.btn, alignSelf: 'center' }} onClick={() => setShown((n) => n + PAGE)}>학교 더 보기 ({list.length - shown}곳 남음)</button>}
        </div>
      )}
      <p style={S.sub}>
        ⭐ 대표본은 학교마다 하나입니다. 학원이 같은 학교 해설을 만들려 하면 이 해설을 먼저 보여 주고, 이 학교 학생의 생기부 분석·브리핑·상담 AI 가 학교 맥락으로 참고합니다.
        비교 해설을 대표본으로 정하면 같은 학교 묶음(예: A고 vs B고)을 비교하려 할 때만 쓰입니다.
      </p>
    </div>
  );
}

const pillColor = (c) => ({ color: c, borderColor: c });
const S = {
  sub: { fontSize: 12, color: 'var(--text3)', margin: '3px 0 0' },
  err: { fontSize: 12, color: '#f87171', margin: '6px 0' },
  stats: { display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text2, var(--text))', margin: '2px 0 10px' },
  filters: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 },
  search: { flex: '1 1 200px', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 13 },
  select: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', fontSize: 12 },
  seg: { display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  segBtn: { background: 'var(--surface2)', color: 'var(--text)', border: 'none', padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  segOn: { background: 'var(--accent-bg)', color: 'var(--accent)' },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '2px 0 10px' },
  chipLabel: { fontSize: 11, color: 'var(--text3)', fontWeight: 700, marginRight: 2 },
  chip: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer' },
  chipOn: { background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  school: { border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' },
  schoolHead: { display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', cursor: 'pointer', userSelect: 'none' },
  caret: { width: 14, color: 'var(--text3)', paddingTop: 1 },
  schoolName: { fontSize: 14, fontWeight: 800, color: 'var(--text)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 },
  pill: { fontSize: 10.5, fontWeight: 800, border: '1px solid', borderRadius: 999, padding: '1px 7px', marginLeft: 4, whiteSpace: 'nowrap' },
  reports: { borderTop: '1px solid var(--border)', padding: '8px 12px 10px 34px', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface2)' },
  report: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' },
  reportTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', flexWrap: 'wrap' },
  actions: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 700 },
  repBtn: { color: '#fbbf24', borderColor: 'rgba(251,191,36,0.5)' },
  linkBtn: { background: 'none', border: 'none', color: 'var(--text3)', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline', padding: 0 },
};
