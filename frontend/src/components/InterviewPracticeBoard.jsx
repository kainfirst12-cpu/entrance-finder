import { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE } from '../apiBase';

// 설정에 저장된 AI 키 (Board 와 같은 규칙)
const aiCreds = () => {
  const model = localStorage.getItem('ef_model') || 'claude';
  const group = model.startsWith('gemini') ? 'gemini' : model.startsWith('gpt') || model.startsWith('o') ? 'gpt' : 'claude';
  const keyName = { claude: 'ef_apikey', gemini: 'ef_geminikey', gpt: 'ef_gptkey' }[group];
  return { model, group, apiKey: localStorage.getItem(keyName) };
};

// AI 첨삭은 SSE(keepalive)로 온다 — success 가 있는 이벤트가 결과, 나머지는 진행 알림
async function postSSE(path, onStage) {
  const { model, group, apiKey } = aiCreds();
  if (!apiKey) return { success: false, message: 'AI 키가 없습니다 — 설정에서 키를 넣어 주세요' };
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ef_token')}`, 'x-api-key': apiKey, 'x-ai-model': group, 'x-ai-submodel': model },
  });
  if (res.status === 401) { const e = new Error('세션 만료 — 다시 로그인하세요'); e.auth = true; throw e; }
  if (!(res.headers.get('content-type') || '').includes('text/event-stream')) return res.json().catch(() => ({ success: false, message: `서버 응답 오류 (HTTP ${res.status})` }));
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', result = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) {
      if (!l.startsWith('data: ')) continue;
      try { const o = JSON.parse(l.slice(6)); if (o.success !== undefined) result = o; else if (o.message) onStage?.(o.message); } catch { /* 조각 */ }
    }
  }
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}

// 선생님 보드(학생 상세) — 🎤 면접 연습
// ① 이 학생의 면접 전략 리포트를 학생 페이지 연습에 공개/비공개
// ② 학생이 저장한 연습 답변을 문항별로 보고 코멘트를 남긴다(학생 페이지에 그대로 보인다)
// api 는 Board 의 헬퍼(Bearer·401 처리)를 그대로 받는다.

const fmtSec = (s) => `${Math.floor(Math.max(0, s || 0) / 60)}:${String(Math.max(0, s || 0) % 60).padStart(2, '0')}`;

export default function InterviewPracticeBoard({ student, api, onError }) {
  const [reports, setReports] = useState([]);
  const [records, setRecords] = useState([]);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [filter, setFilter] = useState('all'); // all | retry | nocomment
  const [reviewing, setReviewing] = useState(null); // { id, msg }

  const base = `/api/board/students/${student.id}`;
  const load = useCallback(async () => {
    try {
      const d = await api(`${base}/interview-practice`);
      if (d.success) { setReports(d.reports || []); setRecords(d.records || []); }
      else setMsg('⚠ ' + (d.message || '면접 연습 조회 실패'));
    } catch (e) { if (e.auth) onError?.(e); }
  }, [base]);
  useEffect(() => { load(); }, [load]);

  const act = async (path, opts, okMsg) => {
    try {
      const d = await api(path, opts);
      if (d && d.success === false) throw new Error(d.message || '처리 실패');
      await load();
      setMsg(okMsg || '');
    } catch (e) { if (e.auth) onError?.(e); else setMsg('⚠ ' + e.message); }
  };

  const aiReview = async (r) => {
    setReviewing({ id: r.id, msg: 'AI 첨삭 시작…' }); setMsg('');
    try {
      const d = await postSSE(`${base}/interview-practice/${r.id}/ai-review`, (m) => setReviewing({ id: r.id, msg: m }));
      if (!d.success) throw new Error(d.message || 'AI 첨삭 실패');
      await load(); setMsg('✓ AI 첨삭이 끝났습니다 — 코멘트로 옮겨 저장하면 학생에게 보입니다');
    } catch (e) { if (e.auth) onError?.(e); else setMsg('⚠ ' + e.message); }
    finally { setReviewing(null); }
  };
  const appendDraft = (r, text) => setDrafts((d) => {
    const cur = d[r.id] ?? r.teacher_comment ?? '';
    return { ...d, [r.id]: cur ? `${cur}\n\n${text}` : text };
  });

  const shown = useMemo(() => records.filter((r) =>
    filter === 'retry' ? r.retry : filter === 'nocomment' ? !r.teacher_comment : true), [records, filter]);
  const week = records.filter((r) => new Date(r.created_at).getTime() > Date.now() - 7 * 864e5).length;
  const openCount = reports.filter((r) => r.practice_open).length;

  return (
    <div>
      <div style={T.title}>
        🎤 면접 연습
        <span style={T.titleSub}>
          {records.length ? `누적 ${records.length}회 · 최근 7일 ${week}회 · 다시 연습 ${records.filter(r => r.retry).length}` : '아직 연습 기록 없음'}
        </span>
      </div>
      {msg && <div style={{ fontSize: 12.5, color: msg.startsWith('⚠') ? '#fbbf24' : '#34d399', margin: '0 0 6px' }}>{msg}</div>}

      <div style={T.panel}>
        <div style={T.label}>학생 페이지에 연습으로 공개할 면접 전략 리포트 {student.student_code ? '' : '(학생 열람 코드를 먼저 발급해야 학생이 볼 수 있어요)'}</div>
        {!reports.length && (
          <div style={T.muted}>이 학생으로 만든 면접 전략 리포트가 없습니다. 면접 전략 화면에서 이 학생을 골라 만들거나, 만든 리포트를 이 학생에게 배정하면 여기에 나타나고 연습이 열립니다.</div>
        )}
        {reports.map((r) => (
          <div key={r.id} style={T.row}>
            <span style={{ flex: 1 }}>
              <b>{r.title}</b>
              <span style={T.muted2}> · {(r.cards || []).filter(c => c.interview !== false).map(c => c.univ).join(', ')} · {r.question_count}문항 · {String(r.created_at).slice(0, 10)}</span>
            </span>
            <button style={r.practice_open ? T.onBtn : T.offBtn}
              onClick={() => act(`${base}/interviews/${r.id}/practice-open`, { method: 'PATCH', body: JSON.stringify({ open: !r.practice_open }) },
                r.practice_open ? '✓ 연습 공개를 닫았습니다' : '✓ 학생 페이지에 연습을 열었습니다')}>
              {r.practice_open ? '연습 공개 중 ✓' : '연습 공개하기'}
            </button>
          </div>
        ))}
        {reports.length > 0 && !openCount && <div style={{ ...T.muted, marginTop: 4 }}>공개한 리포트가 없어 학생 페이지에는 문항이 보이지 않습니다.</div>}
      </div>

      {records.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, margin: '10px 0 6px' }}>
            {[['all', '전체'], ['nocomment', '코멘트 안 단 것'], ['retry', '다시 연습 표시']].map(([k, l]) => (
              <button key={k} style={filter === k ? T.fOn : T.f} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {shown.map((r) => {
              const a = r.analysis || {};
              const isOpen = open === r.id;
              const draft = drafts[r.id] ?? r.teacher_comment ?? '';
              return (
                <div key={r.id} style={T.rec}>
                  <div style={T.recHead} onClick={() => setOpen(isOpen ? null : r.id)}>
                    <span style={T.muted2}>{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
                    <span style={{ flex: 1 }}>{r.question}</span>
                    {a.chars != null && <span style={T.chip}>{a.chars}자{a.band ? ` / ${a.band.lo}~${a.band.hi}` : ''}</span>}
                    <span style={T.chip}>{fmtSec(r.duration_sec)}</span>
                    {r.retry && <span style={T.warn}>다시 연습</span>}
                    {r.teacher_comment && <span style={T.good}>💬</span>}
                    {r.ai_review && <span style={T.ai}>🤖</span>}
                  </div>
                  {isOpen && (
                    <div style={T.recBody}>
                      <div style={T.muted2}>{r.card_label} · {r.input_mode === 'voice' ? '받아쓰기' : '직접 입력'} · 준비 {r.prep_sec ?? '-'}초 · 제한 {r.limit_sec ?? '-'}초</div>
                      <div style={T.answer}>{r.answer || '(답변 없음)'}</div>
                      {r.follow_up && <div style={{ fontSize: 12.5, margin: '6px 0 3px', color: '#9db0bd' }}>꼬리질문 · {r.follow_up}</div>}
                      {r.follow_answer && <div style={T.answer}>{r.follow_answer}</div>}
                      {((a.good || []).length > 0 || (a.fix || []).length > 0) && (
                        <div style={{ fontSize: 12.5, lineHeight: 1.6, margin: '6px 0' }}>
                          {(a.good || []).map((t, i) => <div key={'g' + i} style={{ color: '#34d399' }}>✓ {t}</div>)}
                          {(a.fix || []).map((t, i) => <div key={'f' + i} style={{ color: '#fbbf24' }}>△ {t}</div>)}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
                        <button style={T.aiBtn} disabled={!!reviewing || !r.answer} onClick={() => aiReview(r)}>
                          {reviewing?.id === r.id ? '첨삭 중…' : r.ai_review ? '🤖 AI 첨삭 다시' : '🤖 AI 첨삭'}
                        </button>
                        {reviewing?.id === r.id && <span style={T.muted2}>{reviewing.msg}</span>}
                        {!reviewing && !r.ai_review && <span style={T.muted2}>학생부와 대조해 고칠 점·개선 답안·코멘트 초안을 만듭니다(설정의 AI 키, 30초~1분)</span>}
                      </div>
                      {r.ai_review && <AiReview rv={r.ai_review} at={r.ai_reviewed_at} onUse={(t) => appendDraft(r, t)} />}
                      <textarea style={T.textarea} rows={3} value={draft} placeholder="학생에게 보일 코멘트 (예: 첫 문장 결론 좋음. 실험 수치를 한 번만 넣자)"
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))} />
                      <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
                        <button style={T.save} onClick={() => act(`${base}/interview-practice/${r.id}`, { method: 'PATCH', body: JSON.stringify({ teacherComment: draft }) }, '✓ 코멘트를 저장했습니다 — 학생 페이지에 보입니다')}>코멘트 저장</button>
                        <button style={T.offBtn} onClick={() => act(`${base}/interview-practice/${r.id}`, { method: 'PATCH', body: JSON.stringify({ retry: !r.retry }) })}>
                          {r.retry ? '다시 연습 해제' : '다시 연습 지정'}
                        </button>
                        <button style={T.del} onClick={() => window.confirm('이 연습 기록을 삭제할까요?') && act(`${base}/interview-practice/${r.id}`, { method: 'DELETE' })}>삭제</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {!shown.length && <div style={T.muted}>해당하는 기록이 없습니다.</div>}
          </div>
        </>
      )}
    </div>
  );
}

// AI 첨삭 결과 — 선생님만 본다. '코멘트에 넣기'로 학생에게 보일 코멘트 칸에 옮긴다
function AiReview({ rv, at, onUse }) {
  const arr = (v) => (Array.isArray(v) ? v : []);
  const stColor = (st) => (/확인/.test(st) ? '#34d399' : /다름/.test(st) ? '#f87171' : '#fbbf24');
  return (
    <div style={T.rv}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ color: '#c4b5fd' }}>🤖 AI 첨삭</b>
        {rv.summary && <span style={{ fontSize: 13 }}>{rv.summary}</span>}
        <span style={{ ...T.muted2, marginLeft: 'auto' }}>{at ? new Date(at).toLocaleString('ko-KR') : ''}{rv.model ? ` · ${rv.model}` : ''} · 선생님만 보임</span>
      </div>
      {arr(rv.good).length > 0 && <div style={T.rvSec}>{arr(rv.good).map((g, i) => <div key={i} style={{ color: '#34d399' }}>✓ {g}</div>)}</div>}
      {arr(rv.fix).length > 0 && (
        <div style={T.rvSec}>
          {arr(rv.fix).map((f, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <span style={{ color: '#fbbf24' }}>△ {f.point}</span>
              {f.why && <span style={T.muted2}> — {f.why}</span>}
              {f.how && <div style={{ marginLeft: 14, color: '#cfd8e0' }}>→ {f.how}</div>}
            </div>
          ))}
        </div>
      )}
      {arr(rv.factCheck).length > 0 && (
        <div style={T.rvSec}>
          <div style={T.rvTitle}>학생부 사실 대조</div>
          {arr(rv.factCheck).map((c, i) => (
            <div key={i}><span style={{ ...T.stChip, color: stColor(c.status), borderColor: stColor(c.status) }}>{c.status}</span> {c.claim}{c.note && <span style={T.muted2}> · {c.note}</span>}</div>
          ))}
        </div>
      )}
      {rv.improved && (
        <div style={T.rvSec}>
          <div style={T.rvTitle}>개선 답안 (학생 문장을 살려 다듬음 · {String(rv.improved).replace(/\s+/g, ' ').trim().length}자)
            <button style={T.useBtn} onClick={() => onUse(`[다듬은 답안]\n${rv.improved}`)}>코멘트에 넣기</button>
          </div>
          <div style={T.answer}>{rv.improved}</div>
        </div>
      )}
      {arr(rv.followUps).length > 0 && <div style={T.rvSec}><div style={T.rvTitle}>이어질 꼬리질문</div>{arr(rv.followUps).map((q, i) => <div key={i}>• {q}</div>)}</div>}
      {rv.studentComment && (
        <div style={T.rvSec}>
          <div style={T.rvTitle}>학생 코멘트 초안 <button style={T.useBtn} onClick={() => onUse(rv.studentComment)}>코멘트에 넣기</button></div>
          <div style={{ color: '#e8eef3' }}>{rv.studentComment}</div>
        </div>
      )}
    </div>
  );
}

const T = {
  ai: { fontSize: 11, color: '#c4b5fd', whiteSpace: 'nowrap' },
  aiBtn: { background: 'rgba(167,139,250,0.15)', border: '1px solid rgba(167,139,250,0.5)', color: '#c4b5fd', fontSize: 12, cursor: 'pointer', borderRadius: 7, padding: '4px 11px', whiteSpace: 'nowrap' },
  rv: { background: 'rgba(167,139,250,0.07)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 9, padding: '9px 11px', margin: '4px 0 8px', fontSize: 12.5, lineHeight: 1.65 },
  rvSec: { marginTop: 7 },
  rvTitle: { fontSize: 12, fontWeight: 700, color: '#9db0bd', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8 },
  stChip: { fontSize: 10.5, border: '1px solid', borderRadius: 5, padding: '0 6px', whiteSpace: 'nowrap' },
  useBtn: { background: 'transparent', border: '1px solid #334556', color: '#2dd4bf', fontSize: 11, cursor: 'pointer', borderRadius: 6, padding: '1px 8px' },
  title: { fontSize: 14, fontWeight: 700, color: '#e8eef3', margin: '20px 0 8px', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  titleSub: { fontSize: 12, fontWeight: 500, color: '#9db0bd' },
  panel: { background: '#1c2937', borderRadius: 9, padding: '9px 11px' },
  label: { fontSize: 12, color: '#9db0bd', marginBottom: 6 },
  row: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.05)' },
  muted: { fontSize: 12.5, color: '#6b7d8a', lineHeight: 1.6 },
  muted2: { fontSize: 12, color: '#6b7d8a', whiteSpace: 'nowrap' },
  onBtn: { background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.5)', color: '#34d399', fontSize: 11.5, cursor: 'pointer', borderRadius: 6, padding: '3px 9px', whiteSpace: 'nowrap' },
  offBtn: { background: 'rgba(45,212,191,0.12)', border: '1px solid rgba(45,212,191,0.4)', color: '#2dd4bf', fontSize: 11.5, cursor: 'pointer', borderRadius: 6, padding: '3px 9px', whiteSpace: 'nowrap' },
  f: { background: 'transparent', border: '1px solid #334556', color: '#9db0bd', fontSize: 12, cursor: 'pointer', borderRadius: 14, padding: '3px 10px' },
  fOn: { background: '#14b8a6', border: '1px solid #14b8a6', color: '#fff', fontSize: 12, cursor: 'pointer', borderRadius: 14, padding: '3px 10px' },
  rec: { background: '#1c2937', borderRadius: 7, overflow: 'hidden' },
  recHead: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 9px', cursor: 'pointer', flexWrap: 'wrap' },
  recBody: { padding: '6px 10px 10px', borderTop: '1px solid rgba(255,255,255,0.06)' },
  chip: { fontSize: 11, color: '#93c5fd', background: 'rgba(59,130,246,0.15)', borderRadius: 5, padding: '1px 7px', whiteSpace: 'nowrap' },
  warn: { fontSize: 11, color: '#fbbf24', background: 'rgba(251,191,36,0.15)', borderRadius: 5, padding: '1px 7px', whiteSpace: 'nowrap' },
  good: { fontSize: 11, color: '#34d399', whiteSpace: 'nowrap' },
  answer: { fontSize: 13, lineHeight: 1.7, background: '#16212e', borderRadius: 7, padding: '8px 10px', margin: '6px 0', whiteSpace: 'pre-wrap', color: '#e8eef3' },
  textarea: { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #334556', background: '#16212e', color: '#e8eef3', fontSize: 13, outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 },
  save: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', fontSize: 12.5 },
  del: { background: 'transparent', border: 'none', color: '#f87171', fontSize: 12, cursor: 'pointer', marginLeft: 'auto' },
};
