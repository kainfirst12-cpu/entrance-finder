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

export default function VerifyPanel({ kind = 'record', text, context, compact = false, onAuthError }) {
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);

  // 키가 등록된 회사만 검토자가 될 수 있다
  const available = useMemo(
    () => REVIEWERS.map((r) => ({ ...r, apiKey: localStorage.getItem(r.keyName) || '' })).filter((r) => r.apiKey),
    [],
  );
  const [picked, setPicked] = useState(() => available.map((r) => r.group));

  async function run() {
    setErr(''); setBusy(true); setData(null);
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
                </div>
                {it.quote && <div style={S.quote}>“{it.quote}”</div>}
                <div style={S.problem}>{it.problem}</div>
                {it.fix && <div style={S.fix}>→ {it.fix}</div>}
              </div>
            );
          })}

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
  perModel: { marginTop: 7, paddingTop: 6, borderTop: '1px solid #1c2735' },
  rv: { fontSize: 10.5, color: '#7b8ca3', lineHeight: 1.6 },
};
