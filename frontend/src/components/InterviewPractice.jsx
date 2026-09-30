import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { API_BASE } from '../apiBase';
import { analyzeAnswer, pickFollowUp, lengthBand } from '../interviewPractice/ruleAnalysis';

// 🎤 면접 연습 — 학생 페이지(열람 코드) 안의 연습 화면.
// 문항은 선생님이 '연습 공개'한 면접 전략 리포트에서 온다(내 생기부로 만든 질문).
// 준비 타이머 → 답변 타이머(받아쓰기·녹음) → 규칙 점검 → 의도·예시 답안 비교 → 꼬리질문 → 저장.
// 녹음은 이 기기에만 남고 서버로 보내지 않는다. 기록(글)은 선생님이 보고 코멘트를 단다.

const PREP_OPTIONS = [0, 15, 30, 60, 90];
const fmtSec = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
const cardLabel = (c) => [c.univ, c.dept, c.track].filter(Boolean).join(' · ');

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.value = 0.15;
    o.connect(g); g.connect(ctx.destination); o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 350);
  } catch { /* 소리 못 내는 환경 */ }
}

// 받아쓰기 — 크롬·엣지·사파리의 음성인식. 말이 멈추면 브라우저가 끊으므로 켜 둔 동안은 다시 잇는다
function useDictation(onFinal) {
  const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const recRef = useRef(null), wantRef = useRef(false), cbRef = useRef(onFinal);
  cbRef.current = onFinal;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const start = useCallback(() => {
    if (!SR || recRef.current) return;
    wantRef.current = true;
    const r = new SR();
    r.lang = 'ko-KR'; r.interimResults = true; r.continuous = true;
    r.onresult = (ev) => {
      let tmp = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) cbRef.current?.(t.trim()); else tmp += t;
      }
      setInterim(tmp);
    };
    r.onerror = (e) => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') wantRef.current = false; };
    r.onend = () => {
      recRef.current = null; setInterim('');
      if (wantRef.current) { try { start(); } catch { setListening(false); } } else setListening(false);
    };
    recRef.current = r; setListening(true);
    try { r.start(); } catch { recRef.current = null; setListening(false); }
  }, [SR]);
  const stop = useCallback(() => { wantRef.current = false; try { recRef.current?.stop(); } catch { /* 이미 끝남 */ } setListening(false); }, []);
  useEffect(() => () => { wantRef.current = false; try { recRef.current?.abort(); } catch { /* */ } }, []);
  return { supported: !!SR, listening, interim, start, stop };
}

// 녹음 — 이 기기에서만. 끝나면 들어 보거나 내려받을 수 있다
function useRecorder() {
  const [rec, setRec] = useState(null);
  const [url, setUrl] = useState('');
  const chunks = useRef([]);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(new Blob(chunks.current, { type: mr.mimeType || 'audio/webm' })); });
      };
      mr.start(); setRec(mr);
      return true;
    } catch { return false; }
  };
  const stop = () => { if (rec && rec.state !== 'inactive') rec.stop(); setRec(null); };
  const reset = () => { setUrl((old) => { if (old) URL.revokeObjectURL(old); return ''; }); };
  return { recording: !!rec, url, start, stop, reset };
}

export default function InterviewPractice({ code, major }) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [sets, setSets] = useState([]);
  const [records, setRecords] = useState([]);
  const [tab, setTab] = useState('home'); // home | session | history

  const call = useCallback(async (path = '', opts = {}) => {
    const res = await fetch(`${API_BASE}/api/student-view/${encodeURIComponent(code)}/interview-practice${path}`, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await res.json().catch(() => ({ success: false, message: '서버 응답 오류' }));
    if (!j.success) throw new Error(j.message || '처리 실패');
    return j;
  }, [code]);

  const load = useCallback(async () => {
    try { const j = await call(); setSets(j.sets || []); setRecords(j.records || []); setErr(''); }
    catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [call]);
  useEffect(() => { load(); }, [load]);

  // ── 세션 설정 ──
  const [setId, setSetId] = useState(null);
  const set = sets.find((s) => s.id === setId) || sets[0] || null;
  const [cardSel, setCardSel] = useState(null); // null = 전체
  const [count, setCount] = useState(5);
  const [prep, setPrep] = useState(30);
  const [limitMode, setLimitMode] = useState('card'); // card | 숫자
  const [shuffle, setShuffle] = useState(true);
  const [retryOnly, setRetryOnly] = useState(false);
  const [queue, setQueue] = useState([]);

  const retryKeys = useMemo(() => new Set(records.filter((r) => r.retry).map((r) => `${r.interview_id}:${r.card_index}:${r.q_index}`)), [records]);
  const pool = useMemo(() => {
    if (!set) return [];
    return set.cards
      .filter((c) => !cardSel || cardSel.includes(c.cardIndex))
      .flatMap((c) => c.questions.map((q) => ({ set, card: c, q })))
      .filter((it) => !retryOnly || retryKeys.has(`${set.id}:${it.card.cardIndex}:${it.q.qIndex}`));
  }, [set, cardSel, retryOnly, retryKeys]);

  const startSession = (items) => {
    const list = shuffle ? [...items].sort(() => Math.random() - 0.5) : items;
    setQueue(list.slice(0, Math.max(1, count)));
    setTab('session');
  };

  const stats = useMemo(() => {
    const week = Date.now() - 7 * 864e5;
    return {
      total: records.length,
      week: records.filter((r) => new Date(r.created_at).getTime() > week).length,
      retry: records.filter((r) => r.retry).length,
      comments: records.filter((r) => r.teacher_comment).length,
    };
  }, [records]);

  if (loading) return <div style={X.muted}>면접 연습을 불러오는 중…</div>;
  if (err) return <div style={{ ...X.muted, color: '#d64545' }}>⚠ {err}</div>;

  if (tab === 'session' && queue.length) {
    return <Session queue={queue} prep={prep} limitMode={limitMode} major={major} call={call}
      onDone={async () => { setTab('home'); await load(); }} />;
  }

  return (
    <div>
      <div style={X.tabs}>
        <button style={tab === 'home' ? X.tabOn : X.tab} onClick={() => setTab('home')}>연습하기</button>
        <button style={tab === 'history' ? X.tabOn : X.tab} onClick={() => setTab('history')}>
          내 연습 기록 {records.length ? `(${records.length})` : ''}{stats.comments ? ` · 💬${stats.comments}` : ''}
        </button>
      </div>

      {tab === 'history' && <History records={records} call={call} reload={load} />}

      {tab === 'home' && (!sets.length ? (
        <div style={X.empty}>
          아직 연습할 문항이 없어요. 선생님이 내 <b>면접 전략 리포트</b>를 연습용으로 열어 주면
          내 생기부로 만든 면접 질문이 여기에 나타나요.
        </div>
      ) : (
        <div style={X.box}>
          <div style={X.statRow}>
            <Stat k="누적 연습" v={`${stats.total}회`} />
            <Stat k="최근 7일" v={`${stats.week}회`} />
            <Stat k="다시 연습할 문항" v={`${stats.retry}개`} />
          </div>

          {sets.length > 1 && (
            <label style={X.label}>리포트
              <select style={X.select} value={set?.id || ''} onChange={(e) => { setSetId(Number(e.target.value)); setCardSel(null); }}>
                {sets.map((s) => <option key={s.id} value={s.id}>{s.title} ({String(s.createdAt).slice(0, 10)})</option>)}
              </select>
            </label>
          )}

          <div style={X.subTitle}>지원 카드 — 연습할 대학을 고르세요</div>
          <div style={X.chips}>
            {set.cards.map((c) => {
              const on = !cardSel || cardSel.includes(c.cardIndex);
              return (
                <button key={c.cardIndex} style={on ? X.chipOn : X.chip}
                  onClick={() => {
                    const all = set.cards.map((x) => x.cardIndex);
                    const cur = cardSel || all;
                    const nx = on ? cur.filter((i) => i !== c.cardIndex) : [...cur, c.cardIndex];
                    setCardSel(nx.length === all.length ? null : nx.length ? nx : cur);
                  }}>
                  {cardLabel(c)} <span style={{ opacity: 0.7 }}>· {c.questions.length}문항 · {c.answerSeconds}초</span>
                </button>
              );
            })}
          </div>

          <div style={X.optRow}>
            <label style={X.label}>문항 수
              <input type="number" min={1} max={30} value={count} style={X.num}
                onChange={(e) => setCount(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
            </label>
            <label style={X.label}>준비 시간
              <select style={X.select} value={prep} onChange={(e) => setPrep(Number(e.target.value))}>
                {PREP_OPTIONS.map((s) => <option key={s} value={s}>{s ? `${s}초` : '없음'}</option>)}
              </select>
            </label>
            <label style={X.label}>답변 시간
              <select style={X.select} value={limitMode} onChange={(e) => setLimitMode(e.target.value)}>
                <option value="card">대학별 기준(리포트)</option>
                {[30, 45, 60, 90, 120].map((s) => <option key={s} value={s}>{s}초</option>)}
              </select>
            </label>
          </div>
          <div style={X.optRow}>
            <label style={X.check}><input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} /> 순서 섞기</label>
            {stats.retry > 0 && (
              <label style={X.check}><input type="checkbox" checked={retryOnly} onChange={(e) => setRetryOnly(e.target.checked)} /> '다시 연습' 표시한 문항만</label>
            )}
          </div>
          <button style={X.primary} disabled={!pool.length} onClick={() => startSession(pool)}>
            🎤 {pool.length ? `${Math.min(count, pool.length)}문항 실전 연습 시작` : '조건에 맞는 문항이 없어요'}
          </button>
          <p style={X.hint}>
            실제 면접처럼 질문을 보고 준비한 뒤, 시간 안에 소리 내어 답하세요. 받아쓰기를 켜면 말한 내용이 글로 적혀요.
            녹음은 이 기기에만 남고 어디에도 보내지 않아요.
          </p>
        </div>
      ))}
    </div>
  );
}

function Stat({ k, v }) {
  return <div style={X.stat}><div style={X.statK}>{k}</div><div style={X.statV}>{v}</div></div>;
}

// ── 실전 연습 세션 ─────────────────────────────────────
function Session({ queue, prep, limitMode, major, call, onDone }) {
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState(prep ? 'prep' : 'answer'); // prep | answer | review | end
  const limitOf = (item) => (limitMode === 'card' ? (item?.card.answerSeconds || 60) : Number(limitMode));
  const [deadline, setDeadline] = useState(() => Date.now() + (prep || limitOf(queue[0])) * 1000);
  const [now, setNow] = useState(Date.now());
  const [answer, setAnswer] = useState('');
  const [usedVoice, setUsedVoice] = useState(false);
  const [answerStart, setAnswerStart] = useState(prep ? 0 : Date.now());
  const [duration, setDuration] = useState(0);
  const [analysis, setAnalysis] = useState(null);
  const [follow, setFollow] = useState(null);
  const [followAnswer, setFollowAnswer] = useState('');
  const [showSample, setShowSample] = useState(false);
  const [retry, setRetry] = useState(false);
  const [withRec, setWithRec] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [done, setDone] = useState([]);
  const target = useRef('answer'); // 받아쓰기가 채울 칸

  const it = queue[idx];
  const limit = limitOf(it);
  const band = lengthBand(it?.card.answerSeconds || limit);

  const dict = useDictation((t) => {
    if (!t) return;
    if (target.current === 'follow') setFollowAnswer((a) => (a ? `${a} ${t}` : t));
    else { setAnswer((a) => (a ? `${a} ${t}` : t)); setUsedVoice(true); }
  });
  const rec = useRecorder();

  useEffect(() => {
    if (phase !== 'prep' && phase !== 'answer') return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [phase]);

  const left = Math.ceil((deadline - now) / 1000);

  const beginAnswer = useCallback(async () => {
    target.current = 'answer';
    setPhase('answer'); setAnswerStart(Date.now()); setDeadline(Date.now() + limit * 1000); setNow(Date.now());
    if (withRec && !(await rec.start())) setMsg('마이크를 쓸 수 없어 녹음은 건너뜁니다.');
  }, [limit, withRec, rec]);

  const finishAnswer = useCallback(() => {
    dict.stop(); rec.stop();
    const dur = Math.round((Date.now() - answerStart) / 1000);
    const a = analyzeAnswer({
      question: it.q.q, answer, durationSec: dur, targetSec: it.card.answerSeconds || limit,
      inputMode: usedVoice ? 'voice' : 'text', topics: it.set.topics || [], major,
    });
    setDuration(dur); setAnalysis(a); setFollow(pickFollowUp(it.q, a)); setPhase('review');
  }, [dict, rec, answerStart, it, answer, limit, usedVoice, major]);

  // 시간 끝 — 준비가 끝나면 답변 시작, 답변 시간이 끝나면 종료음 후 점검
  useEffect(() => {
    if (left > 0) return;
    if (phase === 'prep') beginAnswer();
    else if (phase === 'answer') { beep(); finishAnswer(); }
  }, [left, phase, beginAnswer, finishAnswer]);

  const next = async (save) => {
    setMsg('');
    if (save) {
      setSaving(true);
      try {
        await call('', { method: 'POST', body: {
          interviewId: it.set.id, cardIndex: it.card.cardIndex, qIndex: it.q.qIndex, cardLabel: cardLabel(it.card),
          question: it.q.q, answer, inputMode: usedVoice ? 'voice' : 'text', prepSec: prep, limitSec: limit,
          durationSec: duration, analysis, followUp: follow?.text || '', followAnswer, retry,
        } });
        setDone((d) => [...d, { q: it.q.q, chars: analysis?.chars || 0, retry }]);
      } catch (e) { setMsg('⚠ 저장 실패: ' + e.message); setSaving(false); return; }
      setSaving(false);
    }
    dict.stop(); rec.reset();
    if (idx + 1 >= queue.length) { setPhase('end'); return; }
    setIdx(idx + 1); setAnswer(''); setFollowAnswer(''); setUsedVoice(false); setAnalysis(null); setFollow(null);
    setShowSample(false); setRetry(false);
    if (prep) { setPhase('prep'); setDeadline(Date.now() + prep * 1000); setNow(Date.now()); }
    else { target.current = 'answer'; setPhase('answer'); setAnswerStart(Date.now()); setDeadline(Date.now() + limit * 1000); }
  };

  if (phase === 'end') {
    return (
      <div style={X.box}>
        <div style={X.subTitle}>🎉 연습 끝 — {done.length}문항 저장</div>
        {done.map((d, i) => (
          <div key={i} style={X.doneRow}><span style={{ flex: 1 }}>{d.q}</span><span style={X.pill}>{d.chars}자</span>{d.retry && <span style={X.pillWarn}>다시 연습</span>}</div>
        ))}
        <p style={X.hint}>저장한 답변은 선생님이 보고 코멘트를 남겨요. '내 연습 기록'에서 확인하세요.</p>
        <button style={X.primary} onClick={onDone}>처음으로</button>
      </div>
    );
  }

  const danger = phase === 'answer' && left <= 10;
  return (
    <div style={X.box}>
      <div style={X.sessHead}>
        <span style={X.pill}>{idx + 1} / {queue.length}</span>
        <span style={{ fontWeight: 700, color: '#1c2733' }}>{cardLabel(it.card)}</span>
        {it.card.kind && <span style={X.pillSoft}>{it.card.kind}</span>}
        <button style={{ ...X.ghost, marginLeft: 'auto' }} onClick={() => { dict.stop(); rec.stop(); done.length ? setPhase('end') : onDone(); }}>연습 그만하기</button>
      </div>

      <div style={X.question}>{it.q.q}</div>

      {(phase === 'prep' || phase === 'answer') && (
        <div style={{ ...X.timer, color: danger ? '#d64545' : phase === 'prep' ? '#b7791f' : '#1d6fd6' }}>
          {phase === 'prep' ? '준비' : '답변'} {fmtSec(left)}
        </div>
      )}

      {phase === 'prep' && (
        <>
          <div style={X.tip}>
            답변 틀: <b>{it.card.formula || '결론 → 한 장면 → 배운 점'}</b> · {it.card.answerSeconds || limit}초에 {band.lo}~{band.hi}자
          </div>
          <div style={X.optRow}>
            <label style={X.check}><input type="checkbox" checked={withRec} onChange={(e) => setWithRec(e.target.checked)} /> 내 목소리 녹음하기 (이 기기에만)</label>
          </div>
          <button style={X.primary} onClick={beginAnswer}>지금 답변 시작</button>
        </>
      )}

      {phase === 'answer' && (
        <>
          <textarea style={X.area} rows={7} value={answer} onChange={(e) => setAnswer(e.target.value)}
            placeholder={dict.supported ? '🎙 받아쓰기를 켜고 말하거나, 직접 입력하세요.' : '말한 내용을 직접 입력하세요. (받아쓰기는 크롬·엣지에서 돼요)'} />
          {dict.interim && <div style={X.interim}>…{dict.interim}</div>}
          <div style={X.optRow}>
            {dict.supported && (
              <button style={dict.listening ? X.micOn : X.mic} onClick={() => { target.current = 'answer'; dict.listening ? dict.stop() : dict.start(); }}>
                {dict.listening ? '⏺ 받아쓰는 중 (누르면 멈춤)' : '🎙 받아쓰기 켜기'}
              </button>
            )}
            {rec.recording && <span style={X.pillWarn}>● 녹음 중</span>}
            <span style={{ ...X.hint, margin: 0 }}>{answer.replace(/\s+/g, ' ').trim().length}자 / 권장 {band.lo}~{band.hi}자</span>
            <button style={{ ...X.primary, width: 'auto', marginTop: 0, marginLeft: 'auto', padding: '9px 18px' }} onClick={finishAnswer}>답변 완료</button>
          </div>
        </>
      )}

      {phase === 'review' && analysis && (
        <>
          <div style={X.metaRow}>
            <span style={X.pill}>{analysis.chars}자 (권장 {analysis.band.lo}~{analysis.band.hi})</span>
            <span style={X.pill}>걸린 시간 {fmtSec(duration)}</span>
            <span style={X.pill}>말하면 약 {analysis.estSec}초</span>
            {analysis.rate != null && <span style={X.pill}>분당 {analysis.rate}자</span>}
          </div>
          {rec.url && (
            <div style={X.optRow}>
              <audio controls src={rec.url} style={{ height: 34 }} />
              <a href={rec.url} download={`면접연습_${idx + 1}.webm`} style={X.link}>녹음 내려받기</a>
            </div>
          )}
          {answer && <div style={X.myAnswer}>{answer}</div>}

          <div style={X.fb}>
            {analysis.good.length > 0 && <FbList title="잘한 점" color="#1a7f4e" items={analysis.good} />}
            {analysis.fix.length > 0 && <FbList title="고칠 점" color="#b7791f" items={analysis.fix} />}
            {analysis.next.length > 0 && <FbList title="다음 답변에서 할 것" color="#1d6fd6" items={analysis.next} />}
            <div style={X.fbNote}>AI가 아닌 규칙 점검이에요. 점수나 합격 가능성은 알려 주지 않아요.</div>
          </div>

          {(it.q.intent || it.q.sample) && (
            <div style={X.sampleBox}>
              <button style={X.ghost} onClick={() => setShowSample(!showSample)}>
                {showSample ? '▲ 접기' : '▼ 이 질문의 의도와 예시 답안 설계도 보기'}
              </button>
              {showSample && (
                <div style={{ marginTop: 8 }}>
                  {it.q.intent && <div style={X.intent}>의도 · {it.q.intent}</div>}
                  {it.q.sample && <div style={X.sample}>{it.q.sample}</div>}
                  <div style={X.fbNote}>외우지 말고, 내 답변과 순서·장면·마무리를 비교해 보세요.</div>
                </div>
              )}
            </div>
          )}

          {follow && (
            <div style={X.followBox}>
              <div style={X.followQ}><span style={X.pillSoft}>{follow.type}</span> {follow.text}</div>
              <textarea style={X.area} rows={3} value={followAnswer} onChange={(e) => setFollowAnswer(e.target.value)}
                placeholder="꼬리질문에 짧게 답해 보세요 (선택)" />
              {dict.supported && (
                <button style={dict.listening ? X.micOn : X.mic} onClick={() => { target.current = 'follow'; dict.listening ? dict.stop() : dict.start(); }}>
                  {dict.listening ? '⏺ 받아쓰는 중' : '🎙 받아쓰기'}
                </button>
              )}
            </div>
          )}

          <div style={X.optRow}>
            <label style={X.check}><input type="checkbox" checked={retry} onChange={(e) => setRetry(e.target.checked)} /> 이 문항 다시 연습하기로 표시</label>
          </div>
          {msg && <div style={{ color: '#d64545', fontSize: 12.5 }}>{msg}</div>}
          <div style={X.optRow}>
            <button style={{ ...X.primary, width: 'auto', marginTop: 0, padding: '10px 20px' }} disabled={saving} onClick={() => next(true)}>
              {saving ? '저장 중…' : idx + 1 >= queue.length ? '저장하고 끝내기' : '저장하고 다음 문항'}
            </button>
            <button style={X.ghost} disabled={saving} onClick={() => next(false)}>저장 안 하고 넘어가기</button>
          </div>
        </>
      )}
      {msg && phase !== 'review' && <div style={{ color: '#b7791f', fontSize: 12.5, marginTop: 6 }}>{msg}</div>}
    </div>
  );
}

function FbList({ title, color, items }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color }}>{title}</div>
      {items.map((t, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.6, margin: '2px 0 2px 10px' }}>• {t}</div>)}
    </div>
  );
}

// ── 내 연습 기록 ──────────────────────────────────────
function History({ records, call, reload }) {
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');
  const act = async (fn) => { setMsg(''); try { await fn(); await reload(); } catch (e) { setMsg('⚠ ' + e.message); } };
  if (!records.length) return <div style={X.empty}>아직 저장한 연습이 없어요.</div>;
  return (
    <div>
      {msg && <div style={{ color: '#d64545', fontSize: 12.5, marginBottom: 6 }}>{msg}</div>}
      {records.map((r) => {
        const a = r.analysis || {};
        return (
          <div key={r.id} style={X.recBox}>
            <div style={X.recHead} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <span style={{ color: '#8492a5', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleDateString('ko-KR')}</span>
              <span style={{ flex: 1, fontWeight: 600 }}>{r.question}</span>
              {a.chars != null && <span style={X.pill}>{a.chars}자</span>}
              {r.retry && <span style={X.pillWarn}>다시 연습</span>}
              {r.teacher_comment && <span style={X.pillGood}>💬 코멘트</span>}
            </div>
            {open === r.id && (
              <div style={X.recBody}>
                <div style={{ fontSize: 12, color: '#8492a5', marginBottom: 6 }}>{r.card_label} · 걸린 시간 {fmtSec(r.duration_sec || 0)} · {r.input_mode === 'voice' ? '받아쓰기' : '직접 입력'}</div>
                {r.teacher_comment && <div style={X.comment}><b>선생님 코멘트</b><br />{r.teacher_comment}</div>}
                <div style={X.myAnswer}>{r.answer || '(답변 없음)'}</div>
                {r.follow_up && <div style={{ fontSize: 13, margin: '8px 0 4px' }}><b>꼬리질문</b> {r.follow_up}</div>}
                {r.follow_answer && <div style={{ ...X.myAnswer, background: '#fff' }}>{r.follow_answer}</div>}
                {(a.fix || []).length > 0 && <FbList title="그때 고칠 점" color="#b7791f" items={a.fix} />}
                <div style={X.optRow}>
                  <button style={X.ghost} onClick={() => act(() => call(`/${r.id}`, { method: 'PATCH', body: { retry: !r.retry } }))}>
                    {r.retry ? '다시 연습 표시 빼기' : '다시 연습으로 표시'}
                  </button>
                  <button style={{ ...X.ghost, color: '#d64545' }} onClick={() => window.confirm('이 연습 기록을 지울까요?') && act(() => call(`/${r.id}`, { method: 'DELETE' }))}>삭제</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const X = {
  muted: { color: '#8492a5', fontSize: 13.5, padding: '8px 2px' },
  empty: { color: '#5c6b7c', fontSize: 13.5, lineHeight: 1.7, background: '#f7f9fc', border: '1px dashed #d7dfea', borderRadius: 12, padding: '14px 16px' },
  box: { background: '#f7f9fc', border: '1px solid #e3e9f1', borderRadius: 12, padding: '14px 16px' },
  tabs: { display: 'flex', gap: 6, marginBottom: 10 },
  tab: { border: '1px solid #d7dfea', background: '#fff', color: '#5c6b7c', borderRadius: 9, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  tabOn: { border: '1px solid #3a63b5', background: '#3a63b5', color: '#fff', borderRadius: 9, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  statRow: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  stat: { flex: '1 1 120px', background: '#fff', border: '1px solid #e3e9f1', borderRadius: 10, padding: '8px 12px' },
  statK: { fontSize: 11.5, color: '#8492a5' },
  statV: { fontSize: 18, fontWeight: 800, color: '#1c2733' },
  subTitle: { fontSize: 13.5, fontWeight: 800, color: '#1c2733', margin: '6px 0 8px' },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 },
  chip: { border: '1px solid #d7dfea', background: '#fff', color: '#8492a5', borderRadius: 18, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer' },
  chipOn: { border: '1px solid #3a63b5', background: '#e8f1fc', color: '#1d4f9c', borderRadius: 18, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  optRow: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' },
  label: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#5c6b7c', fontWeight: 600 },
  select: { padding: '7px 9px', borderRadius: 8, border: '1px solid #d7dfea', background: '#fff', fontSize: 13, color: '#26313e' },
  num: { width: 70, padding: '7px 9px', borderRadius: 8, border: '1px solid #d7dfea', fontSize: 13 },
  check: { fontSize: 13, color: '#26313e', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' },
  primary: { width: '100%', padding: 13, marginTop: 8, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #5b86d6, #3a63b5)', color: '#fff', fontSize: 14.5, fontWeight: 700, cursor: 'pointer' },
  ghost: { border: '1px solid #d7dfea', background: '#fff', color: '#5c6b7c', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' },
  hint: { fontSize: 12, color: '#8492a5', lineHeight: 1.6, margin: '10px 0 0' },
  sessHead: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  question: { fontSize: 18, fontWeight: 800, lineHeight: 1.55, color: '#1c2733', background: '#fff', border: '1px solid #e3e9f1', borderRadius: 12, padding: '16px 18px' },
  timer: { fontSize: 34, fontWeight: 900, textAlign: 'center', margin: '12px 0 6px', fontVariantNumeric: 'tabular-nums' },
  tip: { fontSize: 13, color: '#5c6b7c', textAlign: 'center', marginBottom: 6 },
  area: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid #d7dfea', fontSize: 14, lineHeight: 1.7, fontFamily: 'inherit', resize: 'vertical', marginTop: 8 },
  interim: { fontSize: 12.5, color: '#8492a5', marginTop: 4 },
  mic: { border: '1px solid #3a63b5', background: '#fff', color: '#3a63b5', borderRadius: 18, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  micOn: { border: '1px solid #d64545', background: '#fdeaea', color: '#d64545', borderRadius: 18, padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  metaRow: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0 8px' },
  pill: { fontSize: 11.5, fontWeight: 700, color: '#1d6fd6', background: '#e8f1fc', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' },
  pillSoft: { fontSize: 11, fontWeight: 700, color: '#7a5fd0', background: '#f1edfc', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' },
  pillWarn: { fontSize: 11.5, fontWeight: 700, color: '#b7791f', background: '#fdf3e2', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' },
  pillGood: { fontSize: 11.5, fontWeight: 700, color: '#1a7f4e', background: '#e6f6ee', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' },
  myAnswer: { fontSize: 13.5, lineHeight: 1.75, background: '#fbfcfe', border: '1px solid #e3e9f1', borderRadius: 10, padding: '10px 12px', whiteSpace: 'pre-wrap', color: '#333' },
  fb: { background: '#fff', border: '1px solid #e3e9f1', borderRadius: 10, padding: '10px 12px', marginTop: 10 },
  fbNote: { fontSize: 11.5, color: '#98a4b3', marginTop: 4 },
  sampleBox: { marginTop: 10 },
  intent: { fontSize: 12.5, fontWeight: 700, color: '#1d6fd6', marginBottom: 4 },
  sample: { fontSize: 13.5, lineHeight: 1.75, background: '#fffdf5', border: '1px solid #f3ddb0', borderRadius: 10, padding: '10px 12px', color: '#3d3526' },
  followBox: { marginTop: 12, background: '#fff', border: '1px solid #e3e9f1', borderRadius: 10, padding: '10px 12px' },
  followQ: { fontSize: 14, fontWeight: 700, color: '#1c2733' },
  link: { fontSize: 12.5, color: '#1d6fd6', fontWeight: 700 },
  doneRow: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, padding: '6px 0', borderBottom: '1px solid #eef2f7' },
  recBox: { border: '1px solid #e3e9f1', borderRadius: 12, marginBottom: 8, overflow: 'hidden' },
  recHead: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', cursor: 'pointer', background: '#fff', fontSize: 13.5, flexWrap: 'wrap' },
  recBody: { padding: '12px 16px', borderTop: '1px solid #eef2f7', background: '#fbfcfe' },
  comment: { fontSize: 13.5, lineHeight: 1.7, background: '#e6f6ee', border: '1px solid #bfe8d2', borderRadius: 10, padding: '10px 12px', marginBottom: 8, color: '#1c4a33' },
};
