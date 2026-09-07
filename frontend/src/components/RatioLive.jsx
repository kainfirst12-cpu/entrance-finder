import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { API_BASE } from '../apiBase';

// 📈 실시간 경쟁률 — 접수 기간에만 값이 찬다.
//
// 이 화면이 답해야 하는 질문은 "지금 몇 대 몇"이 아니라 **"지금 넣어도 되나"** 다.
// 그래서 세 가지를 한 자리에 둔다: ① 마감까지 얼마 남았나(대학마다 다르다 — 16시부터
// 자정까지 갈린다) ② 지금 몇 배인가 ③ 그 숫자가 어떻게 움직여 왔나(시간별 흐름).

const token = () => localStorage.getItem('ef_token');
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, ...(opts.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) { const e = new Error('권한/인증'); e.auth = true; throw e; }
  return res.json();
}

const KST = 9 * 3600 * 1000;

/** ISO → '9/11 18:00' (한국시각) */
function kstLabel(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + KST);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** 남은 분 → '2일 3시간' / '4시간 12분' / '38분' */
function leftLabel(min) {
  if (min == null) return '';
  if (min <= 0) return '마감';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  if (d > 0) return `${d}일 ${h}시간`;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

/** 남은 시간에 따른 색 — 3시간 안이면 빨강, 하루 안이면 주황 */
function urgency(min) {
  if (min == null || min <= 0) return { c: '#6f7f8c', b: 'rgba(255,255,255,0.05)' };
  if (min <= 180) return { c: '#ff8a8a', b: 'rgba(255,138,138,0.14)' };
  if (min <= 1440) return { c: '#ffc46b', b: 'rgba(255,196,107,0.13)' };
  return { c: '#7fd8a8', b: 'rgba(127,216,168,0.12)' };
}

/** 시간별 흐름을 작은 선으로 — 숫자만으론 '오르는 중'인지 '멈췄는지'를 못 읽는다 */
function Spark({ points, w = 240, h = 44 }) {
  if (!points || points.length < 2) {
    return <span style={S.dim}>흐름을 그릴 만큼 기록이 쌓이지 않았습니다 (관측 {points ? points.length : 0}회)</span>;
  }
  const ys = points.map((p) => Number(p.ratio) || 0);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const span = hi - lo || 1;
  const d = points.map((p, i) => {
    const x = (i / (points.length - 1)) * (w - 4) + 2;
    const y = h - 4 - (((Number(p.ratio) || 0) - lo) / span) * (h - 8);
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <svg width={w} height={h} style={{ overflow: 'visible' }}>
        <path d={d} fill="none" stroke="#5b86d6" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      <span style={S.dim}>
        {kstLabel(first.captured_at)} {Number(first.ratio).toFixed(2)}배
        {' → '}
        {kstLabel(last.captured_at)} {Number(last.ratio).toFixed(2)}배
        {' · 관측 '}{points.length}회
      </span>
    </span>
  );
}

export default function RatioLive({ onAuthError }) {
  const [univs, setUnivs] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [units, setUnits] = useState(null);
  const [unitQ, setUnitQ] = useState('');
  const [openUnit, setOpenUnit] = useState(null);   // 흐름을 펼친 모집단위
  const [series, setSeries] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  // 남은 시간은 스스로 줄어야 한다 — 새로고침해야 줄어들면 그건 '남은 시간'이 아니다.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [a, b] = await Promise.all([api('/api/ratio/univs'), api('/api/ratio/status')]);
      if (a.success) setUnivs(a.univs || []);
      else setErr(a.message || '목록을 불러오지 못했습니다');
      if (b.success) setStatus(b);
    } catch (e) {
      if (e.auth) onAuthError?.(); else setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => { load(); }, [load]);

  const openUniv = useCallback(async (u) => {
    setSel(u);
    setUnits(null);
    setOpenUnit(null);
    setSeries(null);
    setUnitQ('');
    try {
      const r = await api(`/api/ratio/univ/${encodeURIComponent(u.univ)}`);
      setUnits(r.success ? (r.units || []) : []);
    } catch (e) {
      if (e.auth) onAuthError?.(); else setUnits([]);
    }
  }, [onAuthError]);

  async function toggleSeries(row) {
    const key = `${row.jeonhyeong}|${row.unit}`;
    if (openUnit === key) { setOpenUnit(null); setSeries(null); return; }
    setOpenUnit(key);
    setSeries(null);
    try {
      const qs = `univ=${encodeURIComponent(sel.univ)}&jeonhyeong=${encodeURIComponent(row.jeonhyeong || '')}&unit=${encodeURIComponent(row.unit)}`;
      const r = await api(`/api/ratio/series?${qs}`);
      setSeries(r.success ? (r.points || []) : []);
    } catch {
      setSeries([]);
    }
  }

  // 한 바퀴는 몇 분이 걸린다. **기다리지 않는다** — 시작만 시키고 진행 상황을 물어본다.
  // (예전엔 이 요청 하나로 166곳을 다 돌아서 브라우저가 먼저 끊고 'Failed to fetch' 만 떴다)
  async function runNow() {
    setBusy(true);
    setErr('');
    try {
      const r = await api('/api/ratio/run', { method: 'POST', body: JSON.stringify({ force: true }) });
      if (!r.success) { setErr(r.message || '수집을 시작하지 못했습니다'); setBusy(false); return; }
    } catch (e) {
      if (e.auth) onAuthError?.(); else setErr(e.message);
      setBusy(false);
      return;
    }
    // 3초마다 물어보며 목록을 갱신한다 — 대학·마감 시각은 경쟁률보다 먼저 채워진다.
    const started = Date.now();
    const poll = async () => {
      try {
        const st = await api('/api/ratio/status');
        if (st.success) setStatus(st);
        const u = await api('/api/ratio/univs');
        if (u.success) setUnivs(u.univs || []);
        if (st.success && !st.running) { setBusy(false); if (sel) await openUniv(sel); return; }
      } catch { /* 한 번 실패해도 다음에 다시 묻는다 */ }
      if (Date.now() - started > 15 * 60 * 1000) { setBusy(false); return; }   // 15분이면 그만 묻는다
      setTimeout(poll, 3000);
    };
    setTimeout(poll, 2000);
  }

  // 남은 시간은 화면에서 다시 센다 — 서버가 준 값은 응답한 그 순간의 것이다.
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return univs
      .map((u) => ({ ...u, minsLeft: u.closesAt ? Math.round((new Date(u.closesAt).getTime() - now) / 60000) : null }))
      .filter((u) => !needle || u.univ.toLowerCase().includes(needle) || (u.region || '').includes(needle))
      .sort((a, b) => {
        // 마감이 임박한 순 → 이미 닫힌 곳 → 시각을 모르는 곳
        const rank = (x) => (x.minsLeft == null ? 2 : x.minsLeft <= 0 ? 1 : 0);
        return rank(a) - rank(b)
          || (a.minsLeft ?? 0) - (b.minsLeft ?? 0)
          || a.univ.localeCompare(b.univ, 'ko');
      });
  }, [univs, q, now]);

  // 하루 안에 닫는 곳 — 이건 놓치면 되돌릴 수 없다.
  const closingSoon = rows.filter((u) => u.minsLeft != null && u.minsLeft > 0 && u.minsLeft <= 1440);

  const shownUnits = useMemo(() => {
    if (!units) return null;
    const needle = unitQ.trim().toLowerCase();
    const list = needle
      ? units.filter((r) => r.unit.toLowerCase().includes(needle) || (r.jeonhyeong || '').toLowerCase().includes(needle))
      : units;
    const groups = new Map();
    for (const r of list) {
      const k = r.jeonhyeong || '(전형 미상)';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    return [...groups.entries()];
  }, [units, unitQ]);

  const selUrgency = urgency(sel ? rows.find((r) => r.univ === sel.univ)?.minsLeft ?? null : null);

  return (
    <div style={S.page}>
      <div style={S.head}>
        <div>
          <h2 style={S.h2}>📈 실시간 경쟁률</h2>
          <p style={S.lead}>
            원서접수 기간에만 값이 찹니다. 마감 시각은 대학마다 다릅니다(16시~자정) — 같은 시각의 숫자를 그냥 비교하면 안 됩니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button style={S.btnGhost} onClick={load} disabled={loading}>새로고침</button>
          <button style={S.btn} onClick={runNow} disabled={busy}>
            {busy
              ? (status?.progress?.total
                ? `수집 중… ${status.progress.done}/${status.progress.total}곳`
                : '수집 중…')
              : '지금 한 바퀴'}
          </button>
        </div>
      </div>

      {status && (
        <p style={S.status}>
          대학 {status.univCount}곳 · 마감 시각 확보 {status.withDeadline}곳
          {status.running && status.progress
            ? ` · 수집 중 — ${status.progress.stage} ${status.progress.done}/${status.progress.total}곳 (새 관측 ${status.progress.points}줄)`
            : status.lastRun
              ? ` · 마지막 수집 ${kstLabel(status.lastRun.finishedAt)} (성공 ${status.lastRun.ok} / 실패 ${status.lastRun.fail} · 새 관측 ${status.lastRun.points}줄)`
              : ' · 아직 수집한 적이 없습니다'}
          {status.cronEnabled === false && <span style={{ color: '#ffc46b' }}> · 자동 수집 꺼짐</span>}
          {status.check && (
            <span style={{ color: status.check.scrapers === 'ok' && status.check.db === 'ok' ? '#7f93a3' : '#ff8a8a' }}>
              {' · 점검: DB '}{status.check.db}{' · 수집기 '}{status.check.scrapers}{' · 주소록 '}{status.check.sources}
            </span>
          )}
        </p>
      )}
      {err && <p style={S.err}>{err}</p>}
      {status?.lastError && !status.running && (
        <p style={S.err}>
          마지막 수집이 실패했습니다 — {status.lastError.message}
          <span style={{ color: '#b98', marginLeft: 6 }}>({kstLabel(status.lastError.at)})</span>
        </p>
      )}

      {closingSoon.length > 0 && (
        <div style={S.soonBar}>
          <span style={S.soonTitle}>⏰ 24시간 안에 마감</span>
          {closingSoon.slice(0, 12).map((u) => {
            const t = urgency(u.minsLeft);
            return (
              <button key={u.univ} style={{ ...S.soonChip, color: t.c, background: t.b }} onClick={() => openUniv(u)}>
                {u.univ} <b>{leftLabel(u.minsLeft)}</b>
              </button>
            );
          })}
          {closingSoon.length > 12 && <span style={S.dim}>외 {closingSoon.length - 12}곳</span>}
        </div>
      )}

      <div style={S.split}>
        <div style={S.left}>
          <input style={S.input} placeholder="대학·지역 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          {loading && <p style={S.dim}>불러오는 중…</p>}
          {!loading && rows.length === 0 && (
            <p style={S.dim}>대학 목록이 비어 있습니다. ‘지금 한 바퀴’를 눌러 주세요.</p>
          )}
          <div style={S.list}>
            {rows.map((u) => {
              const t = urgency(u.minsLeft);
              const on = sel?.univ === u.univ;
              return (
                <button key={u.univ} onClick={() => openUniv(u)} style={{ ...S.item, ...(on ? S.itemOn : {}) }}>
                  <span style={S.itemName}>{u.univ}</span>
                  <span style={S.itemMeta}>
                    {u.region ? <span style={S.dim}>{u.region}</span> : null}
                    {u.closesAt
                      ? <span style={{ color: t.c }}>{kstLabel(u.closesAt)} 마감 · {leftLabel(u.minsLeft)}</span>
                      : <span style={S.dim}>마감 시각 미확인</span>}
                  </span>
                  {!u.lastSeen && <span style={S.noData}>아직 경쟁률 미공개</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div style={S.right}>
          {!sel && <p style={S.dim}>왼쪽에서 대학을 고르세요.</p>}
          {sel && (
            <>
              <div style={S.detailHead}>
                <h3 style={S.h3}>{sel.univ}</h3>
                {sel.closesAt && (
                  <span style={{ ...S.badge, color: selUrgency.c, background: selUrgency.b }}>
                    {kstLabel(sel.closesAt)} 마감
                  </span>
                )}
                {sel.ratioUrl && (
                  <a style={S.link} href={sel.ratioUrl} target="_blank" rel="noreferrer">대학 발표 페이지 ↗</a>
                )}
              </div>

              {units === null && <p style={S.dim}>불러오는 중…</p>}
              {units && units.length === 0 && (
                <p style={S.dim}>
                  아직 이 대학의 경쟁률이 쌓이지 않았습니다. 접수 초반에는 공개하지 않는 대학이 많습니다.
                </p>
              )}
              {units && units.length > 0 && (
                <>
                  <input
                    style={{ ...S.input, marginTop: 4, marginBottom: 12 }}
                    placeholder="전형·모집단위 검색"
                    value={unitQ}
                    onChange={(e) => setUnitQ(e.target.value)}
                  />
                  {shownUnits.map(([jeon, list]) => (
                    <section key={jeon} style={{ marginBottom: 18 }}>
                      <h4 style={S.jeon}>{jeon} <span style={S.dim}>({list.length})</span></h4>
                      <table style={S.table}>
                        <thead>
                          <tr>
                            <th style={S.th}>모집단위</th>
                            <th style={{ ...S.th, textAlign: 'right' }}>모집</th>
                            <th style={{ ...S.th, textAlign: 'right' }}>지원</th>
                            <th style={{ ...S.th, textAlign: 'right' }}>경쟁률</th>
                            <th style={S.th} />
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((r) => {
                            const key = `${r.jeonhyeong}|${r.unit}`;
                            const open = openUnit === key;
                            return (
                              <Fragment key={key}>
                                <tr style={open ? S.trOn : undefined}>
                                  <td style={S.td}>
                                    {r.campus && <span style={S.campus}>{r.campus}</span>}
                                    {r.unit}
                                  </td>
                                  <td style={{ ...S.td, textAlign: 'right' }}>{r.capacity ?? '-'}</td>
                                  <td style={{ ...S.td, textAlign: 'right' }}>
                                    {r.applicants != null ? Number(r.applicants).toLocaleString() : '-'}
                                  </td>
                                  <td style={{ ...S.td, textAlign: 'right', fontWeight: 700, color: '#e8eef3' }}>
                                    {r.ratio != null ? Number(r.ratio).toFixed(2) : '-'}
                                  </td>
                                  <td style={{ ...S.td, textAlign: 'right' }}>
                                    <button style={S.miniBtn} onClick={() => toggleSeries(r)}>{open ? '접기' : '흐름'}</button>
                                  </td>
                                </tr>
                                {open && (
                                  <tr>
                                    <td style={{ ...S.td, paddingTop: 2 }} colSpan={5}>
                                      {series === null ? <span style={S.dim}>불러오는 중…</span> : <Spark points={series} />}
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </section>
                  ))}
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
  page: { padding: '24px 28px 40px' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  h2: { fontSize: 22, fontWeight: 800, margin: '0 0 4px', color: '#e8eef3' },
  h3: { fontSize: 17, fontWeight: 800, margin: 0, color: '#e8eef3' },
  lead: { color: '#9db0bd', fontSize: 13, margin: 0, maxWidth: 660 },
  status: { color: '#7f93a3', fontSize: 12, margin: '10px 0 0' },
  err: { color: '#ff8a8a', fontSize: 13, background: 'rgba(255,138,138,0.1)', padding: '8px 10px', borderRadius: 8, margin: '10px 0 0' },
  soonBar: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '14px 0 0', padding: '10px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12 },
  soonTitle: { fontSize: 12.5, fontWeight: 700, color: '#ffc46b' },
  soonChip: { border: 'none', borderRadius: 999, padding: '4px 10px', fontSize: 12, cursor: 'pointer' },
  split: { display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: 18, marginTop: 16, alignItems: 'start' },
  left: { display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 },
  right: { minWidth: 0 },
  input: { width: '100%', padding: '9px 11px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)', color: '#e8eef3', fontSize: 13, boxSizing: 'border-box' },
  list: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: '62vh', overflowY: 'auto' },
  item: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '8px 10px', borderRadius: 9, border: '1px solid transparent', background: 'rgba(255,255,255,0.03)', cursor: 'pointer', textAlign: 'left' },
  itemOn: { border: '1px solid #5b86d6', background: 'rgba(91,134,214,0.14)' },
  itemName: { color: '#e8eef3', fontSize: 13.5, fontWeight: 600 },
  itemMeta: { display: 'flex', gap: 8, fontSize: 11.5, flexWrap: 'wrap' },
  noData: { fontSize: 10.5, color: '#7f93a3' },
  detailHead: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 },
  badge: { fontSize: 12, fontWeight: 700, padding: '3px 9px', borderRadius: 999 },
  link: { fontSize: 12, color: '#5b86d6', textDecoration: 'none' },
  jeon: { fontSize: 13.5, fontWeight: 700, color: '#cdd9e2', margin: '0 0 6px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', fontSize: 11.5, color: '#7f93a3', fontWeight: 600, padding: '4px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)' },
  td: { fontSize: 12.5, color: '#b9c6d1', padding: '5px 8px', borderBottom: '1px solid rgba(255,255,255,0.05)' },
  trOn: { background: 'rgba(91,134,214,0.08)' },
  campus: { fontSize: 10.5, color: '#7f93a3', marginRight: 6 },
  miniBtn: { fontSize: 11, padding: '2px 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#9db0bd', cursor: 'pointer' },
  btn: { fontSize: 12.5, padding: '7px 14px', borderRadius: 9, border: 'none', background: '#3f6fe0', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  btnGhost: { fontSize: 12.5, padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.14)', background: 'transparent', color: '#9db0bd', cursor: 'pointer' },
  dim: { color: '#7f93a3', fontSize: 12 },
};
