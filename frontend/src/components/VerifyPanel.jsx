import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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

// ── 무엇이 바뀌었는지 줄 단위로 맞춰 본다 ──────────────────
// "반영했다"는 말만으로는 못 믿는다. 어느 문장이 어떻게 바뀌었는지 눈으로 보여줘야
// 원장이 저장을 결정할 수 있다. 앞뒤로 똑같은 줄을 먼저 잘라내고(대개 그게 대부분이다)
// 남은 가운데만 LCS 로 맞춘다 — 긴 생기부 분석(수천 줄)에서도 즉시 끝난다.
function alignMiddle(A, B) {
  if (!A.length && !B.length) return [];
  if (!A.length) return B.map((r) => ({ t: 'add', l: null, r }));
  if (!B.length) return A.map((l) => ({ t: 'del', l, r: null }));
  // 가운데가 지나치게 크면 통째로 '바뀐 덩어리'로 본다 — 여기서 브라우저를 멈추게 할 수는 없다
  if (A.length * B.length > 400000) {
    return [...A.map((l) => ({ t: 'del', l, r: null })), ...B.map((r) => ({ t: 'add', l: null, r }))];
  }
  const n = A.length, m = B.length;
  const dp = [];
  for (let i = 0; i <= n; i += 1) dp.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ t: 'same', l: A[i], r: B[j] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', l: A[i], r: null }); i += 1; }
    else { ops.push({ t: 'add', l: null, r: B[j] }); j += 1; }
  }
  while (i < n) { ops.push({ t: 'del', l: A[i], r: null }); i += 1; }
  while (j < m) { ops.push({ t: 'add', l: null, r: B[j] }); j += 1; }

  // 지운 줄과 더한 줄이 붙어 있으면 한 줄씩 짝지어 '고침'으로 본다 — 좌우로 나란히 봐야 읽힌다
  const out = [];
  for (let k = 0; k < ops.length;) {
    if (ops[k].t !== 'del' && ops[k].t !== 'add') { out.push(ops[k]); k += 1; continue; }
    const dels = [], adds = [];
    while (k < ops.length && ops[k].t === 'del') { dels.push(ops[k].l); k += 1; }
    while (k < ops.length && ops[k].t === 'add') { adds.push(ops[k].r); k += 1; }
    const pair = Math.min(dels.length, adds.length);
    for (let x = 0; x < pair; x += 1) out.push({ t: 'chg', l: dels[x], r: adds[x] });
    for (let x = pair; x < dels.length; x += 1) out.push({ t: 'del', l: dels[x], r: null });
    for (let x = pair; x < adds.length; x += 1) out.push({ t: 'add', l: null, r: adds[x] });
  }
  return out;
}

function diffLines(before, after) {
  const A = String(before ?? '').split('\n'), B = String(after ?? '').split('\n');
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s += 1;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e += 1;
  const head = A.slice(0, s).map((l) => ({ t: 'same', l, r: l }));
  const tail = A.slice(A.length - e).map((l) => ({ t: 'same', l, r: l }));
  return [...head, ...alignMiddle(A.slice(s, A.length - e), B.slice(s, B.length - e)), ...tail];
}

/** 고친 줄 안에서 실제로 달라진 토막만 표시 — 앞뒤 같은 글자를 잘라낸다 */
function inlineParts(l, r) {
  const a = String(l ?? ''), b = String(r ?? '');
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q += 1;
  return {
    pre: a.slice(0, p),
    lMid: a.slice(p, a.length - q), rMid: b.slice(p, b.length - q),
    lPost: a.slice(a.length - q), rPost: b.slice(b.length - q),
  };
}

function DiffSide({ row, side }) {
  const text = side === 'l' ? row.l : row.r;
  if (text == null) return <div style={{ ...D.cell, ...D.cellEmpty }} />;
  const tone = row.t === 'same' ? D.cellSame : side === 'l' ? D.cellDel : D.cellAdd;
  if (row.t !== 'chg') return <div style={{ ...D.cell, ...tone }}>{text || ' '}</div>;
  const q = inlineParts(row.l, row.r);
  const mid = side === 'l' ? q.lMid : q.rMid;
  const post = side === 'l' ? q.lPost : q.rPost;
  return (
    <div style={{ ...D.cell, ...tone }}>
      {q.pre}
      {mid && <mark style={side === 'l' ? D.markDel : D.markAdd}>{mid}</mark>}
      {post}
    </div>
  );
}

/**
 * 반영 결과 비교 창 — 기존 글과 고친 글을 좌우로 나란히.
 * 저장 버튼을 여기에 둔다: 무엇이 바뀌는지 본 자리에서 결정해야 한다.
 */
function DiffModal({ before, after, onChangeAfter, onSave, onClose, saving, savable, savedAt }) {
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [editing, setEditing] = useState(false);
  const rows = useMemo(() => diffLines(before, after), [before, after]);
  const stat = useMemo(() => rows.reduce((acc, r) => {
    if (r.t === 'chg') acc.chg += 1; else if (r.t === 'add') acc.add += 1; else if (r.t === 'del') acc.del += 1;
    return acc;
  }, { chg: 0, add: 0, del: 0 }), [rows]);

  // '달라진 곳만' — 바뀐 줄 앞뒤 두 줄까지 함께 보여야 어디를 고쳤는지 알 수 있다
  const shown = useMemo(() => {
    if (!onlyDiff) return rows.map((r, i) => ({ r, i }));
    const keep = new Set();
    rows.forEach((r, i) => {
      if (r.t === 'same') return;
      for (let k = i - 2; k <= i + 2; k += 1) if (k >= 0 && k < rows.length) keep.add(k);
    });
    const out = [];
    let gap = false;
    rows.forEach((r, i) => {
      if (keep.has(i)) { out.push({ r, i }); gap = false; }
      else if (!gap) { out.push({ gap: true, i }); gap = true; }
    });
    return out;
  }, [rows, onlyDiff]);

  return createPortal(
    <div style={D.back} onClick={onClose}>
      <div style={D.box} onClick={(e) => e.stopPropagation()}>
        <div style={D.head}>
          <b style={D.title}>📑 무엇이 바뀌었는지 비교</b>
          <span style={D.stat}>
            고친 줄 {stat.chg} · 새로 들어간 줄 {stat.add} · 빠진 줄 {stat.del}
            {stat.chg + stat.add + stat.del === 0 && ' — 바뀐 곳이 없습니다'}
          </span>
          {savedAt && <span style={D.savedTag}>✓ 저장됨</span>}
          <button style={D.x} onClick={onClose}>✕</button>
        </div>

        <div style={D.tools}>
          <label style={D.toggle}>
            <input type="checkbox" checked={onlyDiff} onChange={() => setOnlyDiff((v) => !v)} />
            달라진 곳만 보기
          </label>
          <label style={D.toggle}>
            <input type="checkbox" checked={editing} onChange={() => setEditing((v) => !v)} />
            ✏ 고친 글 직접 손보기
          </label>
          <span style={D.legend}>
            <span style={{ ...D.chip, ...D.cellDel }}>기존</span>
            <span style={{ ...D.chip, ...D.cellAdd }}>고친 글</span>
          </span>
        </div>

        {editing ? (
          <textarea style={D.edit} value={after} onChange={(e) => onChangeAfter(e.target.value)} />
        ) : (
          <div style={D.table}>
            <div style={D.colHead}>기존 내용</div>
            <div style={D.colHead}>고친 내용</div>
            {shown.map((x) => (x.gap
              ? <div key={`g${x.i}`} style={D.gap}>⋯ 같은 내용 생략 ⋯</div>
              : (
                <div key={x.i} style={D.rowWrap}>
                  <DiffSide row={x.r} side="l" />
                  <DiffSide row={x.r} side="r" />
                </div>
              )))}
          </div>
        )}

        <div style={D.foot}>
          {savable && (
            <button style={D.save} onClick={onSave} disabled={saving}>
              {saving ? '저장 중…' : '✅ 이 내용으로 저장'}
            </button>
          )}
          <button style={D.copy} onClick={() => navigator.clipboard?.writeText(after)}>📋 고친 글 복사</button>
          <button style={D.close} onClick={onClose} disabled={saving}>닫기</button>
          <span style={D.footHint}>
            {savable ? '저장하면 원본이 이 글로 바뀝니다. 저장 전까지는 아무것도 바뀌지 않습니다.'
              : '이 화면은 되돌려 저장할 원본이 없어 복사만 할 수 있습니다.'}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const D = {
  back: { position: 'fixed', inset: 0, background: 'rgba(6,10,16,0.72)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 },
  box: { width: 'min(1400px, 96vw)', height: 'min(880px, 92vh)', display: 'flex', flexDirection: 'column', background: '#0f151f', border: '1px solid #26364d', borderRadius: 12, boxShadow: '0 24px 70px rgba(0,0,0,0.55)', overflow: 'hidden' },
  head: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #1e2a3b', flexWrap: 'wrap' },
  title: { fontSize: 14.5, color: '#e6edf6' },
  stat: { fontSize: 12, color: '#8fa3bd' },
  savedTag: { fontSize: 11.5, fontWeight: 800, color: '#7fd8a8', background: '#16281f', border: '1px solid #24503a', borderRadius: 6, padding: '2px 8px' },
  x: { marginLeft: 'auto', width: 28, height: 28, borderRadius: 8, border: '1px solid #2b3a52', background: 'transparent', color: '#8fa3bd', fontSize: 13, cursor: 'pointer' },
  tools: { display: 'flex', alignItems: 'center', gap: 14, padding: '8px 16px', borderBottom: '1px solid #1e2a3b', flexWrap: 'wrap' },
  toggle: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#9fb6d4', cursor: 'pointer' },
  legend: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' },
  chip: { fontSize: 10.5, padding: '2px 8px', borderRadius: 5 },
  table: { flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, alignContent: 'start' },
  colHead: { position: 'sticky', top: 0, zIndex: 1, padding: '7px 12px', fontSize: 11.5, fontWeight: 800, color: '#8fa3bd', background: '#131c28', borderBottom: '1px solid #1e2a3b' },
  rowWrap: { display: 'contents' },
  cell: { padding: '4px 12px', fontSize: 12.5, lineHeight: 1.7, color: '#cdd8e6', whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderBottom: '1px solid #131c28' },
  cellSame: { color: '#7f8ea3' },
  cellDel: { background: 'rgba(255,107,107,0.10)', color: '#f0c8c8' },
  cellAdd: { background: 'rgba(80,220,150,0.10)', color: '#c6ecd8' },
  cellEmpty: { background: 'rgba(255,255,255,0.02)' },
  markDel: { background: 'rgba(255,107,107,0.32)', color: '#ffdede', borderRadius: 3, padding: '0 2px' },
  markAdd: { background: 'rgba(80,220,150,0.30)', color: '#dcffee', borderRadius: 3, padding: '0 2px' },
  gap: { gridColumn: '1 / -1', padding: '3px 12px', fontSize: 11, color: '#5f6f84', background: '#0c121b', textAlign: 'center' },
  edit: { flex: 1, margin: 12, padding: '10px 12px', borderRadius: 8, border: '1px solid #2b3a52', background: '#0b1119', color: '#cdd8e6', fontSize: 13, lineHeight: 1.7, fontFamily: 'inherit', resize: 'none' },
  foot: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid #1e2a3b', flexWrap: 'wrap' },
  save: { padding: '7px 16px', borderRadius: 8, border: '1px solid #2f6d4c', background: '#173026', color: '#8fd8b0', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  copy: { padding: '7px 13px', borderRadius: 8, border: '1px solid #2b3a52', background: 'transparent', color: '#8fa3bd', fontSize: 12.5, cursor: 'pointer' },
  close: { padding: '7px 13px', borderRadius: 8, border: '1px solid #2b3a52', background: 'transparent', color: '#8fa3bd', fontSize: 12.5, cursor: 'pointer' },
  footHint: { fontSize: 11, color: '#7b8ca3' },
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
  const [base, setBase] = useState('');                // 고치기 전 원문 — 비교 창의 왼쪽
  const [diffOpen, setDiffOpen] = useState(false);     // 비교 창
  const [savedAt, setSavedAt] = useState(false);       // 저장까지 끝났는지(비교 창에 표시)
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
    setSkip(new Set()); setDraft(null); setApplyErr(''); setSavedMsg(''); setDiffOpen(false); setSavedAt(false);
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
    setApplyErr(''); setSavedMsg(''); setApplying(true); setStage(''); setSavedAt(false);
    const original = String(text || '');
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
      // 고친 글은 바로 저장하지 않는다 — 무엇이 어떻게 바뀌는지 큰 창에서 보고 결정한다
      setBase(original); setDraft(j.text); setDiffOpen(true);
    } catch (e) {
      setApplyErr(e.message || '고쳐 쓰지 못했습니다');
    } finally { setApplying(false); setStage(''); }
  }

  async function saveDraft() {
    if (!draft || !onApply) return;
    setApplying(true);
    try {
      await onApply(draft);
      setSavedAt(true); setSavedMsg('✓ 고친 내용을 저장했습니다');
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
                <div style={S.draftRow}>
                  <button style={S.saveBtn} onClick={() => setDiffOpen(true)}>
                    📑 {savedAt ? '바뀐 곳 다시 보기' : '바뀐 곳 비교해서 보기'}
                  </button>
                  <button style={S.copyBtn} onClick={() => navigator.clipboard?.writeText(draft)}>📋 복사</button>
                  {!savedAt && <button style={S.cancelBtn} onClick={() => setDraft(null)} disabled={applying}>버리기</button>}
                  <span style={S.applyHint}>
                    {savedAt ? '저장까지 끝났습니다. 어디가 바뀌었는지 다시 볼 수 있습니다.'
                      : '아직 저장되지 않았습니다 — 비교 창에서 확인한 뒤 저장하세요.'}
                  </span>
                </div>
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

      {diffOpen && draft != null && (
        <DiffModal
          before={base} after={draft} onChangeAfter={setDraft}
          savable={!!onApply && !savedAt} saving={applying} savedAt={savedAt}
          onSave={saveDraft} onClose={() => setDiffOpen(false)} />
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
  draftRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, flexWrap: 'wrap' },
  saveBtn: { padding: '4px 12px', borderRadius: 6, border: '1px solid #2f6d4c', background: '#173026', color: '#8fd8b0', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' },
  copyBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid #2b3a52', background: 'transparent', color: '#8fa3bd', fontSize: 11, cursor: 'pointer' },
  cancelBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid #2b3a52', background: 'transparent', color: '#8fa3bd', fontSize: 11, cursor: 'pointer' },
  perModel: { marginTop: 7, paddingTop: 6, borderTop: '1px solid #1c2735' },
  rv: { fontSize: 10.5, color: '#7b8ca3', lineHeight: 1.6 },
};
