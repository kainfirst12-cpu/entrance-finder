import { useState, useEffect, useCallback } from 'react';

// 📚 공식 기출 은행 — 대학이 공개한 선행학습 영향평가 보고서에서 뽑은 면접 문항 검색.
// 면접 전략 화면 안의 패널. api 는 InterviewStrategy 의 헬퍼(Bearer·401/403 처리)를 받는다.

const TYPES = ['제시문 기반', '서류 기반', '인성', 'MMI', '교직적성', '전공적성', '기타'];

export default function InterviewBankPanel({ api, onAuthError, initialUniv = '', initialDept = '' }) {
  const [meta, setMeta] = useState(null);
  const [f, setF] = useState({ univ: initialUniv, dept: initialDept, type: '', q: '', passage: false });
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    api('/api/interview/bank/meta').then((j) => j.success && setMeta(j)).catch((e) => { if (e.auth) onAuthError?.(); else setErr(e.message); });
  }, []);

  const search = useCallback(async (offset = 0) => {
    setBusy(true); setErr('');
    try {
      const qs = new URLSearchParams({ offset: String(offset), limit: '30' });
      if (f.univ) qs.set('univ', f.univ);
      if (f.dept) qs.set('dept', f.dept);
      if (f.type) qs.set('type', f.type);
      if (f.q) qs.set('q', f.q);
      if (f.passage) qs.set('passage', '1');
      const j = await api(`/api/interview/bank?${qs}`);
      if (!j.success) throw new Error(j.message || '검색 실패');
      setTotal(j.total);
      setItems((prev) => (offset ? [...prev, ...j.items] : j.items));
    } catch (e) { if (e.auth) onAuthError?.(); else setErr(e.message); }
    finally { setBusy(false); }
  }, [f]);
  useEffect(() => { search(0); }, []); // 처음엔 최신 문항부터

  const copy = async (it) => {
    const text = [it.psg && `[제시문]\n${it.psg}`, `[질문] ${it.q}`, ...(it.fu || []).map((x) => `[꼬리] ${x}`),
      `— ${it.univ} ${it.y}학년도 ${it.type}${it.dept ? ` · ${it.dept}` : ''} (출처: ${it.source?.name || ''}${it.source?.page ? ` ${it.source.page}쪽` : ''})`].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(it.id); setTimeout(() => setCopied(null), 1500); } catch { /* 권한 없음 */ }
  };

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const onKey = (e) => { if (e.key === 'Enter') search(0); };

  return (
    <div style={B.wrap}>
      <div style={B.lead}>
        대학이 법에 따라 공개하는 <b>선행학습 영향평가 자체평가보고서</b>에 실린 면접·구술 문항과 예상 질문만 모았습니다
        {meta?.stats ? ` — ${meta.stats.univs}개 대학 ${meta.stats.total.toLocaleString()}문항` : ''}.
        사설 후기 모음은 넣지 않았고, 모든 문항에 원문 PDF 쪽수를 달았습니다. 면접 전략 리포트를 만들 때도 지원 대학의 문항이 자동으로 참고됩니다.
      </div>
      <div style={B.filters}>
        <input style={B.input} list="bank-univs" placeholder="대학 (예: 경희대)" value={f.univ} onChange={set('univ')} onKeyDown={onKey} />
        <datalist id="bank-univs">{(meta?.univs || []).map((u) => <option key={u.univ} value={u.univ}>{u.n}문항</option>)}</datalist>
        <input style={B.input} placeholder="학과·계열 (예: 간호)" value={f.dept} onChange={set('dept')} onKeyDown={onKey} />
        <select style={B.input} value={f.type} onChange={set('type')}>
          <option value="">면접 유형 전체</option>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input style={{ ...B.input, flex: '1 1 180px' }} placeholder="질문·제시문 검색어" value={f.q} onChange={set('q')} onKeyDown={onKey} />
        <label style={B.check}><input type="checkbox" checked={f.passage} onChange={set('passage')} /> 제시문 있는 것만</label>
        <button style={B.btn} onClick={() => search(0)} disabled={busy}>{busy ? '찾는 중…' : '🔍 검색'}</button>
      </div>
      {err && <div style={B.err}>⚠ {err}</div>}
      <div style={B.count}>{total.toLocaleString()}문항{total > items.length ? ` 중 ${items.length}개 표시` : ''}</div>
      {!busy && !items.length && <div style={B.muted}>조건에 맞는 문항이 없습니다. {meta?.stats?.total === 0 ? '(기출 은행 데이터가 아직 배포되지 않았습니다)' : ''}</div>}
      <div>
        {items.map((it) => (
          <div key={it.id} style={B.item}>
            <div style={B.meta} onClick={() => setOpen(open === it.id ? null : it.id)}>
              <span style={B.univ}>{it.univ}</span>
              <span style={B.chip}>{it.y}학년도</span>
              <span style={{ ...B.chip, color: it.type === '제시문 기반' ? '#c4b5fd' : '#93c5fd' }}>{it.type}</span>
              {it.dept && <span style={B.dim}>{it.dept}</span>}
              {it.track && <span style={B.dim}>· {it.track}</span>}
              {it.psg && <span style={B.chip}>제시문</span>}
            </div>
            <div style={B.q} onClick={() => setOpen(open === it.id ? null : it.id)}>{it.q}</div>
            {open === it.id && (
              <div style={B.detail}>
                {it.psg && <div style={B.psg}><b>제시문</b><br />{it.psg}</div>}
                {it.intent && <div style={B.line}><b>출제 의도</b> {it.intent}</div>}
                {(it.fu || []).length > 0 && <div style={B.line}><b>꼬리 질문</b> {it.fu.join(' / ')}</div>}
                {it.ev && <div style={B.line}><b>채점·예시 답안 요지</b> {it.ev}</div>}
                {it.subj && <div style={B.line}><b>관련 교과</b> {it.subj}</div>}
                <div style={{ ...B.line, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={B.dim}>출처: {it.source?.name}{it.source?.page ? ` · ${it.source.page}쪽` : ''}</span>
                  {it.source?.url && <a href={it.source.url} target="_blank" rel="noreferrer" style={B.link}>원문 PDF</a>}
                  <button style={B.small} onClick={() => copy(it)}>{copied === it.id ? '✓ 복사됨' : '문항 복사'}</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {total > items.length && (
        <button style={{ ...B.btn, marginTop: 10 }} disabled={busy} onClick={() => search(items.length)}>더 보기</button>
      )}
    </div>
  );
}

const B = {
  wrap: { color: '#e8eef3' },
  lead: { color: '#9db0bd', fontSize: 13, lineHeight: 1.6, marginBottom: 10 },
  filters: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 },
  input: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#e8eef3', padding: '7px 10px', fontSize: 13 },
  check: { fontSize: 12.5, color: '#9db0bd', display: 'flex', alignItems: 'center', gap: 5 },
  btn: { background: '#5b86d6', border: '1px solid #5b86d6', color: '#fff', borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  small: { border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#e8eef3', borderRadius: 7, padding: '3px 10px', fontSize: 12, cursor: 'pointer' },
  err: { color: '#f87171', fontSize: 13, margin: '6px 0' },
  count: { fontSize: 12, color: '#9db0bd', margin: '6px 0' },
  muted: { fontSize: 13, color: '#6b7d8a', padding: '10px 0' },
  item: { borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '9px 4px' },
  meta: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, cursor: 'pointer' },
  univ: { fontWeight: 800, color: '#e8eef3', fontSize: 13 },
  chip: { fontSize: 11, fontWeight: 700, color: '#9db0bd', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, padding: '1px 7px' },
  dim: { color: '#9db0bd', fontSize: 12 },
  q: { fontSize: 14, lineHeight: 1.6, marginTop: 4, cursor: 'pointer', whiteSpace: 'pre-wrap' },
  detail: { marginTop: 8, padding: '10px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 10 },
  psg: { fontSize: 13, lineHeight: 1.75, whiteSpace: 'pre-wrap', color: '#cfd8e0', marginBottom: 8, maxHeight: 320, overflowY: 'auto' },
  line: { fontSize: 12.5, lineHeight: 1.6, color: '#cfd8e0', marginTop: 4 },
  link: { color: '#93c5fd', fontSize: 12.5, fontWeight: 700 },
};
