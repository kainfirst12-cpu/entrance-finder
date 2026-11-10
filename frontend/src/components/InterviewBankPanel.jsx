import { useState, useEffect, useCallback } from 'react';

// 📚 공식 기출 은행 — 대학이 공개한 선행학습 영향평가 보고서에서 뽑은 면접·논술 문항 검색.
// 논술 문항과 문항카드의 교육과정 근거(성취기준·교과서 단원·교과서 출처)는 2026-11-10 추가. 📖 복습할 교과 단원 보기는 근거를 과목별로 모아 준다.
// 면접 전략 화면 안의 패널. api 는 InterviewStrategy 의 헬퍼(Bearer·401/403 처리)를 받는다.

const TYPES = ['제시문 기반', '서류 기반', '인성', 'MMI', '교직적성', '전공적성', '기타'];

export default function InterviewBankPanel({ api, onAuthError, initialUniv = '', initialDept = '' }) {
  const [meta, setMeta] = useState(null);
  const [f, setF] = useState({ kind: '면접', univ: initialUniv, dept: initialDept, type: '', q: '', subject: '', passage: false, basis: false });
  const [review, setReview] = useState(null); // 📖 복습할 교과 단원 결과
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
      const qs = new URLSearchParams({ offset: String(offset), limit: '30', kind: f.kind });
      if (f.subject) qs.set('subject', f.subject);
      if (f.basis) qs.set('basis', '1');
      if (f.univ) qs.set('univ', f.univ);
      if (f.dept) qs.set('dept', f.dept);
      if (f.type && f.kind === '면접') qs.set('type', f.type);
      if (f.q) qs.set('q', f.q);
      if (f.passage) qs.set('passage', '1');
      const j = await api(`/api/interview/bank?${qs}`);
      if (!j.success) throw new Error(j.message || '검색 실패');
      setTotal(j.total);
      setItems((prev) => (offset ? [...prev, ...j.items] : j.items));
    } catch (e) { if (e.auth) onAuthError?.(); else setErr(e.message); }
    finally { setBusy(false); }
  }, [f]);
  useEffect(() => { search(0); setReview(null); }, [f.kind]); // 처음엔 최신 문항부터 · 면접/논술 바꾸면 다시

  const loadReview = async () => {
    if (!f.univ) { setErr('복습할 교과 단원은 대학을 먼저 고르면 보여 드립니다.'); return; }
    setBusy(true); setErr('');
    try {
      const qs = new URLSearchParams({ univ: f.univ, kind: f.kind }); if (f.dept) qs.set('dept', f.dept);
      const j = await api(`/api/interview/bank/review?${qs}`);
      if (!j.success) throw new Error(j.message || '불러오기 실패');
      setReview(j);
    } catch (e) { if (e.auth) onAuthError?.(); else setErr(e.message); }
    finally { setBusy(false); }
  };

  const copy = async (it) => {
    const text = [it.psg && `[제시문]\n${it.psg}`, `[${it.k === '논술' ? '논제' : '질문'}] ${it.q}`, ...(it.fu || []).map((x) => `[꼬리] ${x}`),
      (it.cur || []).length && `[교육과정 근거] ${it.cur.map((c) => `${c.s} ${c.c}`.trim()).join(', ')}`,
      `— ${it.univ} ${it.y}학년도 ${it.type}${it.dept ? ` · ${it.dept}` : ''} (출처: ${it.source?.name || ''}${it.source?.page ? ` ${it.source.page}쪽` : ''})`].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(it.id); setTimeout(() => setCopied(null), 1500); } catch { /* 권한 없음 */ }
  };

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const onKey = (e) => { if (e.key === 'Enter') search(0); };

  return (
    <div style={B.wrap}>
      <div style={B.lead}>
        대학이 법에 따라 공개하는 <b>선행학습 영향평가 자체평가보고서</b>에 실린 면접·구술 문항, 예상 질문, 논술 문항만 모았습니다
        {meta?.stats?.interview ? ` — 면접 ${meta.stats.interview.univs}개 대학 ${meta.stats.interview.total.toLocaleString()}문항 · 논술 ${meta.stats.essay.univs}개 대학 ${meta.stats.essay.total.toLocaleString()}문항` : meta?.stats ? ` — ${meta.stats.univs}개 대학 ${meta.stats.total.toLocaleString()}문항` : ''}.
        사설 후기 모음은 넣지 않았고, 모든 문항에 원문 PDF 쪽수를 달았습니다. 문항카드에 적힌 <b>교육과정 근거(과목·성취기준·교과서)</b>가 있으면 함께 보여 주고, «📖 복습할 교과 단원»으로 대학별로 모아 볼 수 있습니다. 면접 전략 리포트에는 면접 문항만 참고됩니다.
      </div>
      <div style={B.tabs}>
        {['면접', '논술'].map((k) => (
          <button key={k} style={{ ...B.tab, ...(f.kind === k ? B.tabOn : {}) }} onClick={() => setF((p) => ({ ...p, kind: k, type: '' }))}>
            {k === '면접' ? '🎤 면접·구술' : '✍️ 논술'}
          </button>
        ))}
      </div>
      <div style={B.filters}>
        <input style={B.input} list="bank-univs" placeholder="대학 (예: 경희대)" value={f.univ} onChange={set('univ')} onKeyDown={onKey} />
        <datalist id="bank-univs">{(meta?.univs || []).map((u) => <option key={u.univ} value={u.univ}>{u.n}문항</option>)}</datalist>
        <input style={B.input} placeholder="학과·계열 (예: 간호)" value={f.dept} onChange={set('dept')} onKeyDown={onKey} />
        {f.kind === '면접' && (
          <select style={B.input} value={f.type} onChange={set('type')}>
            <option value="">면접 유형 전체</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <input style={{ ...B.input, width: 130 }} placeholder="근거 과목 (예: 수학Ⅱ)" value={f.subject} onChange={set('subject')} onKeyDown={onKey} />
        <input style={{ ...B.input, flex: '1 1 180px' }} placeholder="질문·제시문 검색어" value={f.q} onChange={set('q')} onKeyDown={onKey} />
        <label style={B.check}><input type="checkbox" checked={f.passage} onChange={set('passage')} /> 제시문 있는 것만</label>
        <label style={B.check}><input type="checkbox" checked={f.basis} onChange={set('basis')} /> 교육과정 근거 있는 것만</label>
        <button style={B.btn} onClick={() => { setReview(null); search(0); }} disabled={busy}>{busy ? '찾는 중…' : '🔍 검색'}</button>
        <button style={{ ...B.btn, background: '#2f7d5b', borderColor: '#2f7d5b' }} onClick={loadReview} disabled={busy}>📖 복습할 교과 단원</button>
      </div>
      {err && <div style={B.err}>⚠ {err}</div>}
      {review && (
        <div style={B.review}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <b>📖 {f.univ}{f.dept ? ` · ${f.dept}` : ''} {f.kind} 기출이 근거로 든 교과 — 문항 {review.questions}개</b>
            <button style={B.small} onClick={() => setReview(null)}>닫기</button>
          </div>
          {!review.subjects.length && <div style={B.muted}>이 대학 {f.kind} 문항카드에는 교육과정 근거가 적혀 있지 않습니다(근거 없이 문항만 공개한 대학도 있습니다).</div>}
          {review.subjects.map((g) => (
            <div key={g.subject} style={B.subj}>
              <div style={B.subjHead}>{g.subject} <span style={B.dim}>· 근거 문항 {g.questions}개</span></div>
              {g.units.length > 0 && <div style={B.line}><b>교과서 단원·영역</b> {g.units.map((u) => `${u.name}${u.n > 1 ? `(${u.n})` : ''}`).join(' / ')}</div>}
              {g.standards.length > 0 && (
                <ul style={B.ul}>
                  {g.standards.map((s) => (
                    <li key={s.code + s.text} style={B.li}>
                      {s.code && <span style={B.code}>{s.code}</span>} {s.text}
                      {s.n > 1 && <span style={B.dim}> · {s.n}문항</span>}
                    </li>
                  ))}
                </ul>
              )}
              {g.textbooks.length > 0 && <div style={B.line}><b>교과서 출처</b> {g.textbooks.map((t) => `『${t.title}』${t.publisher ? ` ${t.publisher}` : ''}${t.pages.length ? ` ${t.pages.join('·')}쪽` : ''}`).join(' / ')}</div>}
            </div>
          ))}
        </div>
      )}
      <div style={B.count}>{total.toLocaleString()}문항{total > items.length ? ` 중 ${items.length}개 표시` : ''}</div>
      {!busy && !items.length && <div style={B.muted}>조건에 맞는 문항이 없습니다. {meta?.stats?.total === 0 ? '(기출 은행 데이터가 아직 배포되지 않았습니다)' : ''}</div>}
      <div>
        {items.map((it) => (
          <div key={it.id} style={B.item}>
            <div style={B.meta} onClick={() => setOpen(open === it.id ? null : it.id)}>
              <span style={B.univ}>{it.univ}</span>
              <span style={B.chip}>{it.y}학년도</span>
              <span style={{ ...B.chip, color: it.k === '논술' ? '#fcd34d' : it.type === '제시문 기반' ? '#c4b5fd' : '#93c5fd' }}>{it.k === '논술' ? `논술${it.ef ? ` · ${it.ef}` : ''}` : it.type}</span>
              {it.dept && <span style={B.dim}>{it.dept}</span>}
              {it.track && <span style={B.dim}>· {it.track}</span>}
              {it.psg && <span style={B.chip}>제시문</span>}
              {(it.cur || []).length > 0 && <span style={{ ...B.chip, color: '#86efac' }}>📖 {[...new Set(it.cur.map((c) => c.s))].slice(0, 3).join('·')}</span>}
            </div>
            <div style={B.q} onClick={() => setOpen(open === it.id ? null : it.id)}>{it.q}</div>
            {open === it.id && (
              <div style={B.detail}>
                {it.psg && <div style={B.psg}><b>제시문</b><br />{it.psg}</div>}
                {it.intent && <div style={B.line}><b>출제 의도</b> {it.intent}</div>}
                {(it.fu || []).length > 0 && <div style={B.line}><b>꼬리 질문</b> {it.fu.join(' / ')}</div>}
                {it.ev && <div style={B.line}><b>채점·예시 답안 요지</b> {it.ev}</div>}
                {it.subj && <div style={B.line}><b>관련 교과</b> {it.subj}</div>}
                {(it.cur || []).length > 0 && (
                  <div style={B.line}><b>교육과정 근거(관련 성취기준)</b>
                    <ul style={B.ul}>{it.cur.map((c, i) => <li key={i} style={B.li}>{c.s} {c.c && <span style={B.code}>{c.c}</span>} {c.t}</li>)}</ul>
                  </div>
                )}
                {(it.un || []).length > 0 && <div style={B.line}><b>교과서 단원·영역</b> {it.un.join(' / ')}</div>}
                {(it.tb || []).length > 0 && <div style={B.line}><b>교과서 출처</b> {it.tb.map((t) => `『${t.t}』${t.p ? ` ${t.p}` : ''}${t.pg ? ` ${t.pg}쪽` : ''}`).join(' / ')}</div>}
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
  tabs: { display: 'flex', gap: 6, marginBottom: 8 },
  tab: { border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.04)', color: '#9db0bd', borderRadius: 9, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  tabOn: { background: '#5b86d6', borderColor: '#5b86d6', color: '#fff' },
  review: { margin: '8px 0 12px', padding: '12px 14px', background: 'rgba(47,125,91,0.12)', border: '1px solid rgba(47,125,91,0.45)', borderRadius: 12, fontSize: 13 },
  subj: { marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' },
  subjHead: { fontWeight: 800, fontSize: 14, color: '#e8eef3' },
  ul: { margin: '4px 0 0', paddingLeft: 18 },
  li: { fontSize: 12.5, lineHeight: 1.6, color: '#cfd8e0' },
  code: { fontFamily: 'ui-monospace, monospace', fontSize: 11.5, color: '#86efac' },
};
