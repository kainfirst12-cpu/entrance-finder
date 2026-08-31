import { useMemo, useState } from 'react';
import { API_BASE } from '../apiBase';

/**
 * 교차 검증 패널 — 이 글이 맞는지 **다른 회사 모델들에게** 물어본다.
 *
 * 왜 다른 회사인가: 같은 모델에게 "맞니?"라고 물으면 자기가 쓴 글을 대체로 옹호한다.
 * Claude·GPT·Gemini 에 따로 묻고, 여럿이 같은 곳을 짚으면 그것부터 위에 보여준다.
 *
 * 붙이는 쪽은 글과 성격만 넘기면 된다:
 *   <VerifyPanel kind="record" text={본문} context={근거자료} />
 *   kind: ipgyeol | saenggibu | roadmap | record
 */
const REVIEWERS = [
  { group: 'claude', label: 'Claude', keyName: 'ef_apikey' },
  { group: 'gpt', label: 'GPT', keyName: 'ef_gptkey' },
  { group: 'gemini', label: 'Gemini', keyName: 'ef_geminikey' },
];

const SEV = { 높음: { c: '#ff8a8a', b: '#3a1f22' }, 중간: { c: '#ffcf7a', b: '#3a2f1c' }, 낮음: { c: '#9fb6d4', b: '#1c2735' } };
const VERDICT = {
  신뢰가능: { c: '#7fd8a8', b: '#16281f', t: '큰 문제는 안 보입니다' },
  주의: { c: '#ffcf7a', b: '#332a17', t: '고칠 곳이 있습니다' },
  재작성권장: { c: '#ff8a8a', b: '#331c1f', t: '이대로 내보내면 안 됩니다' },
};

/** 오래 걸리는 AI 호출은 SSE(keepalive)로 온다 — success 가 있는 이벤트가 결과, 나머지는 진행 알림 */
async function postForResult(url, opts, onStage) {
  const res = await fetch(url, opts);
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) {
    try { return await res.json(); } catch { return { success: false, message: `서버 응답 오류 (HTTP ${res.status})` }; }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const obj = JSON.parse(line.slice(6));
        if (obj.success !== undefined) result = obj;
        else if (obj.message) onStage?.(obj.message);
      } catch { /* keepalive 등 */ }
    }
  }
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}

export default function VerifyPanel({ kind = 'record', text, context, compact = false, onAuthError, onApply }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  // ── 반영 ── 지적을 골라 원문에 반영해 다시 쓴다. 검증만 하고 끝나면 손으로 옮겨 적다 빠뜨린다.
  const [skip, setSkip] = useState(() => new Set());   // 반영에서 뺀 지적의 인덱스
  const [applying, setApplying] = useState(false);
  const [stage, setStage] = useState('');
  const [draft, setDraft] = useState(null);            // 고쳐 쓴 글 (아직 저장 전)
  const [applyErr, setApplyErr] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  // 키가 등록된 회사만 검토자가 될 수 있다
  const available = useMemo(
    () => REVIEWERS.map((r) => ({ ...r, apiKey: localStorage.getItem(r.keyName) || '' })).filter((r) => r.apiKey),
    [],
  );
  const [picked, setPicked] = useState(() => available.map((r) => r.group));

  async function run() {
    setErr(''); setBusy(true); setData(null);
    setSkip(new Set()); setDraft(null); setApplyErr(''); setSavedMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/cross-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ef_token')}` },
        body: JSON.stringify({
          kind, text, context,
          reviewers: available.filter((r) => picked.includes(r.group))
            .map((r) => ({ group: r.group, apiKey: r.apiKey, label: r.label })),
        }),
      });
      if (res.status === 401) { onAuthError?.(); return; }
      const j = await res.json();
      if (!j.success) { setErr(j.error || '검증에 실패했습니다'); return; }
      setData(j); setOpen(true);
    } catch (e) {
      setErr(e.message || '검증에 실패했습니다');
    } finally { setBusy(false); }
  }

  // 반영은 검토자 중 한 곳이 맡는다 — 고른 것 중 첫 번째(누가 고쳤는지 버튼에 적어 둔다)
  const writer = available.find((r) => picked.includes(r.group)) || available[0];

  async function runApply() {
    const chosen = (data?.consensus?.issues || []).filter((_, i) => !skip.has(i));
    if (!chosen.length) { setApplyErr('반영할 지적을 하나 이상 골라 주세요'); return; }
    setApplyErr(''); setSavedMsg(''); setApplying(true); setStage('');
    try {
      const j = await postForResult(`${API_BASE}/api/cross-verify/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ef_token')}` },
        body: JSON.stringify({
          kind, text, context, issues: chosen,
          reviewer: { group: writer.group, apiKey: writer.apiKey, label: writer.label },
        }),
      }, (m) => setStage(m));
      if (!j.success) { setApplyErr(j.message || j.error || '고쳐 쓰지 못했습니다'); return; }
      setDraft(j.text);
    } catch (e) {
      setApplyErr(e.message || '고쳐 쓰지 못했습니다');
    } finally { setApplying(false); setStage(''); }
  }

  async function saveDraft() {
    if (!draft || !onApply) return;
    setApplying(true);
    try {
      await onApply(draft);
      setDraft(null); setSavedMsg('✓ 고친 내용을 저장했습니다');
    } catch (e) {
      setApplyErr(e.message || '저장하지 못했습니다');
    } finally { setApplying(false); }
  }

  if (!available.length) {
    return <span style={S.noKey} title="설정에서 Claude·GPT·Gemini 키를 등록하면 교차 검증을 쓸 수 있습니다">🔍 교차 검증 (키 없음)</span>;
  }

  const con = data?.consensus;
  const v = con?.verdict ? (VERDICT[con.verdict] || VERDICT.주의) : null;

  return (
    <div style={compact ? S.wrapCompact : S.wrap}>
      <div style={S.head}>
        <button style={S.runBtn} onClick={run} disabled={busy || !String(text || '').trim()}>
          {busy ? `🔍 ${picked.length}개 모델이 읽는 중…` : '🔍 교차 검증'}
        </button>
        {available.length > 1 && !busy && (
          <span style={S.pickRow}>
            {available.map((r) => (
              <label key={r.group} style={S.pick}>
                <input type="checkbox" checked={picked.includes(r.group)}
                  onChange={() => setPicked((p) => (p.includes(r.group) ? p.filter((x) => x !== r.group) : [...p, r.group]))} />
                {r.label}
              </label>
            ))}
          </span>
        )}
        {data && (
          <button style={S.foldBtn} onClick={() => setOpen((o) => !o)}>{open ? '접기' : '결과 보기'}</button>
        )}
      </div>
      {err && <div style={S.err}>{err}</div>}

      {data && open && (
        <div style={S.body}>
          {v && (
            <div style={{ ...S.verdict, color: v.c, background: v.b }}>
              <b>{con?.verdict}</b> — {v.t}
              <span style={S.vMeta}>
                검토자 {con?.reviewerCount}명 · 지적 {con?.issues?.length ?? 0}건
                {con?.agreedCount > 0 && <b style={{ color: '#ffcf7a' }}> · 둘 이상이 같이 짚은 것 {con.agreedCount}건</b>}
              </span>
            </div>
          )}

          {con?.issues?.length === 0 && <div style={S.clean}>지적된 곳이 없습니다.</div>}

          {con?.issues?.map((it, i) => {
            const sv = SEV[it.severity] || SEV.낮음;
            return (
              <div key={i} style={{ ...S.issue, borderLeftColor: sv.c }}>
                <div style={S.issueTop}>
                  <span style={{ ...S.sev, color: sv.c, background: sv.b }}>{it.severity || '낮음'}</span>
                  <span style={S.type}>{it.type}</span>
                  {it.agreedBy?.length > 1 && (
                    <span style={S.agree}>✓ {it.agreedBy.join(' · ')} 모두 지적</span>
                  )}
                  {it.agreedBy?.length === 1 && <span style={S.one}>{it.agreedBy[0]}</span>}
                  <label style={S.useIt} title="이 지적을 고쳐쓰기에 반영합니다">
                    <input type="checkbox" checked={!skip.has(i)}
                      onChange={() => setSkip((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />
                    반영
                  </label>
                </div>
                {it.quote && <div style={S.quote}>“{it.quote}”</div>}
                <div style={S.problem}>{it.problem}</div>
                {it.fix && <div style={S.fix}>→ {it.fix}</div>}
              </div>
            );
          })}

          {/* 지적을 원문에 반영해 다시 쓰기 — 고친 글을 먼저 보여주고, 확인한 뒤에만 저장한다 */}
          {con?.issues?.length > 0 && (
            <div style={S.applyBox}>
              <button style={S.applyBtn} onClick={runApply} disabled={applying}>
                {applying ? '✍ 고쳐 쓰는 중…' : `✍ 지적 ${con.issues.length - skip.size}건 반영해 고쳐쓰기 (${writer.label})`}
              </button>
              <span style={S.applyHint}>
                {onApply ? '고친 글을 먼저 보여드립니다. 확인한 뒤 [이 내용으로 저장]을 누르면 원본이 바뀝니다.'
                  : '이 화면은 저장 대상이 없어 고친 글을 복사만 할 수 있습니다.'}
              </span>
              {stage && <div style={S.stage}>{stage}</div>}
              {applyErr && <div style={S.err}>{applyErr}</div>}
              {savedMsg && <div style={S.saved}>{savedMsg}</div>}
              {draft != null && (
                <>
                  <textarea style={S.draft} value={draft} rows={14} onChange={(e) => setDraft(e.target.value)} />
                  <div style={S.draftRow}>
                    {onApply && (
                      <button style={S.saveBtn} onClick={saveDraft} disabled={applying}>
                        {applying ? '저장 중…' : '✅ 이 내용으로 저장'}
                      </button>
                    )}
                    <button style={S.copyBtn} onClick={() => navigator.clipboard?.writeText(draft)}>📋 복사</button>
                    <button style={S.cancelBtn} onClick={() => setDraft(null)} disabled={applying}>취소</button>
                    <span style={S.applyHint}>여기서 직접 손봐도 됩니다 — 저장되는 것은 지금 보이는 글입니다.</span>
                  </div>
                </>
              )}
            </div>
          )}

          <div style={S.perModel}>
            {(data.reviews || []).map((r) => (
              <div key={r.label} style={S.rv}>
                <b style={{ color: r.ok ? '#9fb6d4' : '#d98a8a' }}>{r.label}</b>{' '}
                {r.ok ? `${r.result.verdict || '-'} · ${r.result.summary || ''}` : `실패: ${r.error}`}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  wrap: { marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#101722', border: '1px solid #223047' },
  wrapCompact: { marginTop: 6 },
  head: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  runBtn: { padding: '4px 11px', borderRadius: 6, border: '1px solid #2b4a72', background: '#16233a', color: '#8fb4ea', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' },
  foldBtn: { marginLeft: 'auto', padding: '3px 9px', borderRadius: 6, border: '1px solid #2b3a52', background: 'transparent', color: '#8fa3bd', fontSize: 11, cursor: 'pointer' },
  pickRow: { display: 'flex', gap: 8, alignItems: 'center' },
  pick: { display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: '#8fa3bd', cursor: 'pointer' },
  noKey: { fontSize: 11, color: '#5c6b7c' },
  err: { marginTop: 6, fontSize: 11.5, color: '#d98a8a' },
  body: { marginTop: 8 },
  verdict: { padding: '6px 9px', borderRadius: 6, fontSize: 12, marginBottom: 7 },
  vMeta: { display: 'block', fontSize: 10.5, color: '#8fa3bd', marginTop: 2 },
  clean: { fontSize: 11.5, color: '#7fd8a8', padding: '4px 2px' },
  issue: { borderLeft: '3px solid', padding: '6px 9px', marginBottom: 6, background: '#0e141d', borderRadius: '0 6px 6px 0' },
  issueTop: { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 },
  sev: { fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4 },
  type: { fontSize: 10.5, color: '#8fa3bd' },
  agree: { fontSize: 10, color: '#ffcf7a', fontWeight: 700 },
  one: { fontSize: 10, color: '#6b7c92' },
  quote: { fontSize: 11.5, color: '#cdd8e6', fontStyle: 'italic', margin: '2px 0 4px', paddingLeft: 2 },
  problem: { fontSize: 11.5, color: '#e6edf6', lineHeight: 1.5 },
  fix: { fontSize: 11.5, color: '#8fd8b0', lineHeight: 1.5, marginTop: 2 },
  useIt: { display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto', fontSize: 10, color: '#8fa3bd', cursor: 'pointer', whiteSpace: 'nowrap' },
  applyBox: { marginTop: 8, paddingTop: 8, borderTop: '1px solid #1c2735' },
  applyBtn: { padding: '5px 12px', borderRadius: 6, border: '1px solid #2b4a72', background: '#16233a', color: '#8fd8b0', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' },
  applyHint: { display: 'block', marginTop: 4, fontSize: 10.5, color: '#7b8ca3', lineHeight: 1.5 },
  stage: { marginTop: 5, fontSize: 11, color: '#8fb4ea' },
  saved: { marginTop: 5, fontSize: 11.5, color: '#7fd8a8', fontWeight: 700 },
  draft: { width: '100%', marginTop: 7, padding: '8px 10px', borderRadius: 6, border: '1px solid #2b3a52', background: '#0e141d', color: '#cdd8e6', fontSize: 12, lineHeight: 1.65, fontFamily: 'inherit', resize: 'vertical' },
  draftRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' },
  saveBtn: { padding: '4px 12px', borderRadius: 6, border: '1px solid #2f6d4c', background: '#173026', color: '#8fd8b0', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' },
  copyBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid #2b3a52', background: 'transparent', color: '#8fa3bd', fontSize: 11, cursor: 'pointer' },
  cancelBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid #2b3a52', background: 'transparent', color: '#8fa3bd', fontSize: 11, cursor: 'pointer' },
  perModel: { marginTop: 7, paddingTop: 6, borderTop: '1px solid #1c2735' },
  rv: { fontSize: 10.5, color: '#7b8ca3', lineHeight: 1.6 },
};
