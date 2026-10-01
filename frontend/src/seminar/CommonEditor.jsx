import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { api, postSSE, token } from './api';
import { buildCommonSlides, renderCommonSlide, LAYOUTS, LAYOUT_LABEL } from './commonSlides';
import { numberSlides } from './deckModel';
import { toForm, fromForm, FORM_FIELDS } from './slideForm';
import SlidePreview from './SlidePreview';

// ① 제도 설명 '공통본' 관리(관리자 전용) — 판(version)을 만들고, 장마다 AI 가 지식베이스·개정 자료와 비교해
// 바뀐 점을 제안하면 원장이 슬라이드마다 승인·거절·고치기 → 발행. 발행본은 설명회 메뉴가 열린 학원이 받아 쓴다.

const STATUS = { published: ['발행 중', '#00b765'], draft: ['초안', '#d6a24a'], archived: ['보관', '#8a857c'] };
const ACTION = { update: ['수정 제안', '#3f8fe0'], remove: ['삭제 제안', '#e05b5b'], new: ['새 슬라이드 제안', '#9b6ad6'] };

export default function CommonEditor({ getActiveKey, selectedModel, aiGroup, onAuthError }) {
  const [list, setList] = useState([]);
  const [v, setV] = useState(null);          // 지금 여는 판(전체)
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [stage, setStage] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [extra, setExtra] = useState({ names: [], text: '' });   // 올린 개정 자료(이 화면에서만)
  const [edit, setEdit] = useState(null);    // { id, form }
  const [chFilter, setChFilter] = useState('all');

  const fail = useCallback((e) => { if (e?.auth) onAuthError?.(); setErr(e?.message || String(e)); }, [onAuthError]);
  const reload = useCallback(async (openId) => {
    const r = await api('/api/seminar/common'); if (!r.success) throw new Error(r.message);
    setList(r.items || []);
    const id = openId ?? (r.items || [])[0]?.id;
    if (id) { const g = await api(`/api/seminar/common/${id}`); if (g.success) { setV(g.item); setDirty(false); } }
  }, []);
  useEffect(() => { reload().catch(fail); }, [reload, fail]);

  const chapters = v?.chapters || {};
  const chNums = useMemo(() => [...new Set((v?.slides || []).map((s) => Number(s.chapter)))].sort((a, b) => a - b), [v]);
  const pending = (v?.slides || []).filter((s) => s.proposal).length;
  const locked = v?.status === 'published';

  const setSlides = (fn) => { setV((cur) => ({ ...cur, slides: fn(cur.slides) })); setDirty(true); };
  const save = async () => {
    setBusy('save'); setErr('');
    try { const r = await api(`/api/seminar/common/${v.id}`, { method: 'PUT', body: { title: v.title, meta: v.meta, chapters: v.chapters, slides: v.slides } }); if (!r.success) throw new Error(r.message); setDirty(false); setMsg('저장했습니다.'); await reload(v.id); }
    catch (e) { fail(e); } finally { setBusy(''); }
  };
  const open = async (id) => { if (dirty && !confirm('저장하지 않은 변경이 있습니다. 버리고 열까요?')) return; try { await reload(id); } catch (e) { fail(e); } };
  const newVersion = async () => {
    if (dirty && !confirm('저장하지 않은 변경이 있습니다. 버리고 새 판을 만들까요?')) return;
    const goip = prompt('몇 학년도 고입 설명회인가요? (예: 2027)', String((v?.meta?.goipYear || 2026) + 1));
    if (!goip) return;
    const daeip = prompt('그 학생들의 대입 학년도는? (고입 + 3)', String(Number(goip) + 3));
    if (!daeip) return;
    setBusy('new');
    try {
      const r = await api('/api/seminar/common', { method: 'POST', body: { baseId: v.id, title: `${goip} 고입 · ${daeip} 대입 설명회`, meta: { goipYear: Number(goip), daeipYear: Number(daeip), basedOn: v.title } } });
      if (!r.success) throw new Error(r.message);
      await reload(r.item.id); setMsg(`'${v.title}' 을 바탕으로 새 판을 만들었습니다. 장마다 'AI 갱신'을 눌러 바뀐 점을 받아 보세요.`);
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const publish = async () => {
    if (dirty) { alert('먼저 저장해 주세요.'); return; }
    if (!confirm(`'${v.title}' 을 공통본으로 발행할까요?${pending ? `\n승인 안 한 제안 ${pending}개는 빠진 채로 나갑니다.` : ''}\n지금 발행 중인 판은 보관으로 바뀝니다.`)) return;
    try { await api(`/api/seminar/common/${v.id}/publish`, { method: 'POST' }); await reload(v.id); setMsg('발행했습니다. 설명회 자료 만들기에서 ‘① 제도 설명 넣기’를 켜면 이 판이 들어갑니다.'); } catch (e) { fail(e); }
  };
  const remove = async () => {
    if (!confirm(`'${v.title}' 을 지울까요? 되돌릴 수 없습니다.`)) return;
    try { await api(`/api/seminar/common/${v.id}`, { method: 'DELETE' }); setV(null); await reload(); } catch (e) { fail(e); }
  };

  // 개정 자료 올리기 → 글자 추출(수행평가 도우미와 같은 추출기)
  const onFiles = async (files) => {
    if (!files?.length) return;
    setBusy('extract'); setErr('');
    try {
      const names = [], texts = [];
      for (let i = 0; i < files.length; i += 10) {
        const fd = new FormData();
        [...files].slice(i, i + 10).forEach((f) => fd.append('files', f));
        const apiKey = getActiveKey?.();
        const r = await postSSE(`${API_BASE}/api/assessment/extract`, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, ...(apiKey ? { 'x-api-key': apiKey, 'x-ai-model': aiGroup || 'claude', 'x-ai-submodel': selectedModel || 'claude' } : {}) }, body: fd });
        if (!r.success) throw new Error(r.message || '글자를 읽지 못했습니다');
        texts.push(r.text); [...files].slice(i, i + 10).forEach((f) => names.push(f.name));
        if (r.notices?.length) setMsg(r.notices.join(' / '));
      }
      setExtra((cur) => ({ names: [...cur.names, ...names], text: [cur.text, ...texts].filter(Boolean).join('\n\n') }));
    } catch (e) { fail(e); } finally { setBusy(''); }
  };

  const aiUpdate = async (ch) => {
    const apiKey = getActiveKey?.();
    if (!apiKey) { setErr('설정에서 AI API 키를 먼저 넣어 주세요.'); return; }
    if (dirty) { alert('먼저 저장해 주세요.'); return; }
    setBusy(`ai:${ch}`); setErr(''); setMsg(''); setStage('');
    try {
      const r = await postSSE(`${API_BASE}/api/seminar/common/${v.id}/ai-update`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', 'x-api-key': apiKey, 'x-ai-model': aiGroup || 'claude', 'x-ai-submodel': selectedModel || 'claude' },
        body: JSON.stringify({ chapter: ch, extraText: extra.text, extraNames: extra.names }),
      }, (d) => d.stage && setStage(d.stage));
      if (!r.success) throw new Error(r.message || 'AI 갱신 실패');
      setV(r.item); setDirty(false);
      const c = r.counts || {};
      setMsg(`${ch}장: 수정 ${c.update || 0} · 삭제 ${c.remove || 0} · 새 슬라이드 ${c.new || 0} 제안 (그대로 ${c.keep || 0}, 근거 발췌 ${r.kbHits || 0}건). ${r.summary || ''}`);
      reload(v.id).catch(() => {});
    } catch (e) { fail(e); } finally { setBusy(''); setStage(''); }
  };

  // 제안 처리
  const approve = (id) => setSlides((ss) => ss.flatMap((s) => {
    if (s.id !== id || !s.proposal) return [s];
    const p = s.proposal; const { proposal, pendingNew, ...rest } = s;
    if (p.action === 'remove') return [];
    if (p.action === 'new') return [{ ...rest }];
    return [{ ...rest, layout: p.layout, heading: p.heading, data: p.data, ...(p.source ? { source: p.source } : {}) }];
  }));
  const reject = (id) => setSlides((ss) => ss.flatMap((s) => {
    if (s.id !== id) return [s];
    if (s.pendingNew) return [];
    const { proposal, ...rest } = s; return [rest];
  }));
  const approveAll = (ch) => (v.slides || []).filter((s) => s.proposal && (ch === 'all' || Number(s.chapter) === ch)).forEach((s) => approve(s.id));
  const toggleRemoved = (id) => setSlides((ss) => ss.map((s) => (s.id === id ? { ...s, removed: !s.removed } : s)));
  const move = (id, dir) => setSlides((ss) => { const i = ss.findIndex((s) => s.id === id), j = i + dir; if (i < 0 || j < 0 || j >= ss.length || ss[j].chapter !== ss[i].chapter) return ss; const n = [...ss]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const addSlide = (ch) => { const id = `m${ch}${Date.now() % 100000}`; setSlides((ss) => { const at = ss.reduce((last, s, i) => (Number(s.chapter) === ch ? i + 1 : last), ss.length); const n = [...ss]; n.splice(at, 0, { id, chapter: ch, layout: 'bullets', heading: '새 슬라이드', data: { items: ['내용을 넣으세요'] } }); return n; }); setEdit({ id, form: toForm({ layout: 'bullets', heading: '새 슬라이드', data: { items: ['내용을 넣으세요'] } }) }); };
  const applyEdit = () => { const patch = fromForm(edit.form); setSlides((ss) => ss.map((s) => (s.id === edit.id ? { ...s, ...patch, ...(patch.source ? {} : { source: undefined }) } : s))); setEdit(null); };

  const download = async () => {
    setBusy('pptx');
    try { const { downloadPptx } = await import('./pptx'); await downloadPptx(numberSlides(buildCommonSlides(v), 1), { fileName: `${v.title}.pptx`.replace(/[\\/:*?"<>|]/g, '_'), title: v.title }); }
    catch (e) { setErr(`PPT 만들기 실패: ${e.message}`); } finally { setBusy(''); }
  };

  if (!v) return <div style={S.empty}>{err || '공통본을 불러오는 중…'}</div>;
  const shown = (v.slides || []).filter((s) => chFilter === 'all' || (chFilter === 'pending' ? s.proposal : Number(s.chapter) === Number(chFilter)));

  return (
    <div>
      <p style={S.lead}>설명회 앞부분(고교학점제·대입 제도·특목/자사고·일반고)의 <b>공통본</b>입니다. 판을 새로 만들고 장마다 <b>🤖 AI 갱신</b>을 누르면,
        지식베이스(대입정책·대학별전형)와 아래에 올린 개정 자료를 근거로 슬라이드마다 바뀐 점을 제안합니다. 승인한 것만 반영되고, <b>발행</b>한 판을 설명회 메뉴가 열린 학원들이 함께 씁니다.</p>
      {err && <div style={S.err} onClick={() => setErr('')}>{err}</div>}
      {msg && <div style={S.ok} onClick={() => setMsg('')}>{msg}</div>}

      <div style={S.bar}>
        <select style={S.input} value={v.id} onChange={(e) => open(Number(e.target.value))}>
          {list.map((x) => <option key={x.id} value={x.id}>{STATUS[x.status]?.[0]} · {x.title} ({x.slide_count}장{x.pending ? ` · 제안 ${x.pending}` : ''})</option>)}
        </select>
        <button style={S.btn} onClick={newVersion} disabled={busy === 'new'}>➕ 이 판으로 새 판 만들기</button>
        {!locked && <button style={{ ...S.btn, ...S.primary }} onClick={save} disabled={!dirty || busy === 'save'}>{dirty ? '💾 저장*' : '💾 저장'}</button>}
        {!locked && <button style={S.btn} onClick={publish}>📢 발행</button>}
        <button style={S.btn} onClick={download} disabled={busy === 'pptx'}>⬇ 이 판 PPT</button>
        {!locked && v.status !== 'published' && <button style={S.btn} onClick={remove}>지우기</button>}
        <span style={{ ...S.badge, background: STATUS[v.status]?.[1] }}>{STATUS[v.status]?.[0]}</span>
      </div>
      {locked && <div style={S.dim}>발행 중인 판은 고치지 않습니다. 바꾸려면 ‘이 판으로 새 판 만들기’ → 고치기 → 발행.</div>}

      {!locked && (
        <div style={S.card}>
          <div style={S.row}>
            <label style={S.lbl}>판 이름 <input style={{ ...S.input, width: 300 }} value={v.title} onChange={(e) => { setV({ ...v, title: e.target.value }); setDirty(true); }} /></label>
            <label style={S.lbl}>고입 학년도 <input type="number" style={{ ...S.input, width: 80 }} value={v.meta?.goipYear || ''} onChange={(e) => { setV({ ...v, meta: { ...v.meta, goipYear: Number(e.target.value) } }); setDirty(true); }} /></label>
            <label style={S.lbl}>대입 학년도 <input type="number" style={{ ...S.input, width: 80 }} value={v.meta?.daeipYear || ''} onChange={(e) => { setV({ ...v, meta: { ...v.meta, daeipYear: Number(e.target.value) } }); setDirty(true); }} /></label>
          </div>
          <div style={{ ...S.row, marginTop: 6 }}>
            <label style={{ ...S.btn, display: 'inline-block' }}>📎 개정 자료 올리기 (PDF·HWP·DOCX)
              <input type="file" multiple accept=".pdf,.hwp,.hwpx,.docx,.txt" style={{ display: 'none' }} onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
            </label>
            {busy === 'extract' && <span style={S.dim}>글자 읽는 중…</span>}
            {extra.names.map((n) => <span key={n} style={S.chip}>{n}</span>)}
            {extra.names.length > 0 && <button style={S.link} onClick={() => setExtra({ names: [], text: '' })}>비우기</button>}
            <span style={S.dim}>올린 자료는 AI 갱신에만 쓰고 저장하지 않습니다. 지식베이스 폴더에 넣은 자료는 관리자 › 지식베이스 동기화 뒤 자동으로 찾습니다.</span>
          </div>
        </div>
      )}

      <div style={S.bar}>
        <button style={chFilter === 'all' ? { ...S.tab, ...S.tabOn } : S.tab} onClick={() => setChFilter('all')}>전체</button>
        {chNums.map((c) => <button key={c} style={chFilter === String(c) ? { ...S.tab, ...S.tabOn } : S.tab} onClick={() => setChFilter(String(c))}>{c}. {chapters[c]}</button>)}
        {pending > 0 && <button style={chFilter === 'pending' ? { ...S.tab, ...S.tabOn } : S.tab} onClick={() => setChFilter('pending')}>제안만 ({pending})</button>}
      </div>

      {chNums.filter((c) => chFilter === 'all' || chFilter === 'pending' || Number(chFilter) === c).map((c) => {
        const items = shown.filter((s) => Number(s.chapter) === c);
        if (!items.length && chFilter === 'pending') return null;
        const last = [...(v.updates || [])].reverse().find((u) => Number(u.chapter) === c);
        return (
          <section key={c} style={S.card}>
            <div style={{ ...S.row, justifyContent: 'space-between' }}>
              <div style={S.row}>
                <b style={{ fontSize: 15, color: 'var(--text)' }}>{c}.</b>
                {locked ? <b style={{ color: 'var(--text)' }}>{chapters[c]}</b>
                  : <input style={{ ...S.input, width: 280, fontWeight: 700 }} value={chapters[c] || ''} onChange={(e) => { setV({ ...v, chapters: { ...chapters, [c]: e.target.value } }); setDirty(true); }} />}
              </div>
              {!locked && (
                <div style={S.row}>
                  {items.some((s) => s.proposal) && <button style={S.btn} onClick={() => approveAll(c)}>✓ 이 장 제안 모두 승인</button>}
                  <button style={S.btn} onClick={() => addSlide(c)}>＋ 슬라이드</button>
                  <button style={{ ...S.btn, ...S.primary }} onClick={() => aiUpdate(c)} disabled={!!busy}>{busy === `ai:${c}` ? `🤖 ${stage || '갱신 중…'}` : '🤖 AI 갱신'}</button>
                </div>
              )}
            </div>
            {last && <div style={S.dim}>마지막 AI 갱신 {new Date(last.at).toLocaleString('ko-KR')} · 근거 발췌 {last.kbHits}건{last.extra?.length ? ` · 개정 자료 ${last.extra.join(', ')}` : ''} — {last.summary}</div>}
            <div style={S.grid}>
              {items.map((s) => <SlideCard key={s.id} s={s} chapters={chapters} locked={locked}
                onApprove={() => approve(s.id)} onReject={() => reject(s.id)} onEdit={() => setEdit({ id: s.id, form: toForm(s) })}
                onToggle={() => toggleRemoved(s.id)} onUp={() => move(s.id, -1)} onDown={() => move(s.id, 1)} />)}
            </div>
          </section>
        );
      })}

      {edit && (
        <div style={S.overlay} onClick={() => setEdit(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 8 }}>
              <b style={{ color: 'var(--text)' }}>✏ 슬라이드 고치기</b>
              <select style={S.input} value={edit.form.layout} onChange={(e) => setEdit({ ...edit, form: { ...toForm({ layout: e.target.value, data: {} }), heading: edit.form.heading, source: edit.form.source } })}>
                {LAYOUTS.map((l) => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 320px' }}>
                {edit.form.layout !== 'section' && <Field label="슬라이드 제목" v={edit.form.heading} on={(x) => setEdit({ ...edit, form: { ...edit.form, heading: x } })} />}
                {(FORM_FIELDS[edit.form.layout] || []).map(([k, label, multi]) => <Field key={k} label={label} multi={multi} v={edit.form[k] || ''} on={(x) => setEdit({ ...edit, form: { ...edit.form, [k]: x } })} />)}
                <Field label="출처(선택)" v={edit.form.source} on={(x) => setEdit({ ...edit, form: { ...edit.form, source: x } })} />
                <div style={S.dim}>**굵게** 로 감싸면 초록 강조가 됩니다.</div>
              </div>
              <div><SlidePreview slide={{ els: renderCommonSlide({ ...v.slides.find((s) => s.id === edit.id), ...fromForm(edit.form) }, chapters) }} width={420} /></div>
            </div>
            <div style={{ ...S.row, justifyContent: 'flex-end', marginTop: 10 }}>
              <button style={S.btn} onClick={() => setEdit(null)}>취소</button>
              <button style={{ ...S.btn, ...S.primary }} onClick={applyEdit}>적용 (저장은 💾)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, v, on, multi }) {
  return (
    <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>{label}
      {multi ? <textarea rows={6} style={{ ...S.input, width: '100%', marginTop: 3, resize: 'vertical' }} value={v} onChange={(e) => on(e.target.value)} />
        : <input style={{ ...S.input, width: '100%', marginTop: 3 }} value={v} onChange={(e) => on(e.target.value)} />}
    </label>
  );
}

function SlideCard({ s, chapters, locked, onApprove, onReject, onEdit, onToggle, onUp, onDown }) {
  const p = s.proposal;
  const cur = { els: renderCommonSlide(s, chapters) };
  const next = p && p.action === 'update' ? { els: renderCommonSlide({ ...s, ...p }, chapters) } : null;
  return (
    <div style={{ ...S.slide, opacity: s.removed ? 0.45 : 1, borderColor: p ? ACTION[p.action][1] : 'var(--border)' }}>
      {p && <div style={{ ...S.badge, background: ACTION[p.action][1], marginBottom: 6 }}>{ACTION[p.action][0]}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div>{next && <div style={S.cap}>지금</div>}<SlidePreview slide={cur} width={next ? 260 : 300} /></div>
        {next && <div><div style={S.cap}>제안</div><SlidePreview slide={next} width={260} /></div>}
      </div>
      {p && (
        <div style={S.reason}>
          {p.reason && <div>💡 {p.reason}</div>}
          {p.evidence && <div style={S.dim}>근거: {p.evidence}</div>}
        </div>
      )}
      {!locked && (
        <div style={{ ...S.row, marginTop: 6 }}>
          {p ? <>
            <button style={{ ...S.mini, ...S.primary }} onClick={onApprove}>✓ 승인</button>
            <button style={S.mini} onClick={onReject}>✕ 거절</button>
          </> : <>
            <button style={S.mini} onClick={onEdit}>✏ 고치기</button>
            <button style={S.mini} onClick={onToggle}>{s.removed ? '↺ 되살리기' : '🗑 빼기'}</button>
            <button style={S.mini} onClick={onUp}>↑</button>
            <button style={S.mini} onClick={onDown}>↓</button>
          </>}
          {s.source && <span style={S.dim} title={s.source}>출처 있음</span>}
        </div>
      )}
    </div>
  );
}

const S = {
  lead: { fontSize: 13, color: 'var(--text2)', margin: '0 0 12px', lineHeight: 1.6, maxWidth: 1000 },
  bar: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' },
  row: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, margin: '10px 0' },
  input: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', fontSize: 13, boxSizing: 'border-box' },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  mini: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, padding: '4px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  primary: { background: '#00b765', borderColor: '#00b765', color: '#fff' },
  badge: { display: 'inline-block', color: '#fff', fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '2px 9px' },
  lbl: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text2)', fontWeight: 600 },
  dim: { fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5, marginTop: 4 },
  chip: { fontSize: 11.5, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-bg)', borderRadius: 999, padding: '2px 9px' },
  link: { background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12 },
  tab: { background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  tabOn: { background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' },
  grid: { display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  slide: { border: '2px solid var(--border)', borderRadius: 10, padding: 8, background: 'var(--surface2)', maxWidth: 560 },
  cap: { fontSize: 11, color: 'var(--text3)', fontWeight: 700, marginBottom: 2 },
  reason: { fontSize: 12, color: 'var(--text)', marginTop: 6, lineHeight: 1.5, maxWidth: 530 },
  empty: { padding: 40, textAlign: 'center', color: 'var(--text2)' },
  err: { background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#f87171', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 10, cursor: 'pointer' },
  ok: { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 10, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(1000px, 96vw)', maxHeight: '92vh', overflow: 'auto' },
};
