import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { API_BASE } from '../apiBase';
import { describeScreen, findTool, getTools, keysSnapshot, subscribeKeys } from '../assistant/store';
import { flush } from '../assistant/flush';
import { useFloatingWindow } from '../assistant/useFloatingWindow';
import StudentPicker from './StudentPicker';
import './assistant.css';
import { installErrorCapture, registerTurns } from '../assistant/bugReport';

// 떠 있는 AI 선생님. 말(또는 타자)로 시키면 화면을 대신 조작하고, 입결·전형 자료는 서버 도구로 조회한다.
//
// 한 번의 요청으로 끝나지 않는다: 서버가 '화면 도구를 부를 차례'를 알려 오면 여기서 실행하고
// 결과를 붙여 다시 물어본다. 서버 도구(입결·지식베이스·배치 저장)는 서버가 알아서 돌리므로
// 여기 왕복에 끼지 않는다(backend/services/assistantAgent.js 주석 참고).

const MAX_STEPS = 16;
// 고른 모델이 안 될 때(키 틀림·잔액 없음·도구 미지원·장애) 키가 있는 다른 제공사로 넘어간다 — 이 순서로.
// 원장 제보(2026-10-01): Gemini 키만 쓰여서 Gemini 키가 막히면 Claude·GPT 키가 있어도 AI 선생님이 멈췄다.
const FALLBACK_ORDER = ['claude', 'gpt', 'gemini'];
const GROUP_MODEL = { claude: 'claude', gpt: 'gpt', gemini: 'gemini' };   // 제공사별 기본 모델(App modelConfig 키)
const GROUP_NAME = { claude: 'Claude', gpt: 'GPT', gemini: 'Gemini' };
const SWITCHABLE = new Set(['key', 'credit', 'unsupported', 'down', 'rate']);
const STUDENT_KEY = 'ef_assistant_student';

export default function AssistantPanel({ getActiveKey, getKeyFor, selectedModel, aiGroup, onAuthError }) {
  // 자동 전환으로 정해진 제공사 — 왼쪽에서 모델을 새로 고르면 그 모델부터 다시 시도한다
  const [fallback, setFallback] = useState(null);   // { group, model }
  useEffect(() => { setFallback(null); }, [aiGroup, selectedModel]);
  // 시도할 순서: (자동 전환해 둔 것) → 고른 모델 → 키가 있는 다른 제공사
  const candidates = useCallback(() => {
    const keyOf = (g) => (getKeyFor ? getKeyFor(g) : g === aiGroup ? getActiveKey() : '') || '';
    const list = [];
    if (fallback) list.push({ ...fallback, key: keyOf(fallback.group) });
    list.push({ group: aiGroup, model: selectedModel, key: keyOf(aiGroup) });
    for (const g of FALLBACK_ORDER) list.push({ group: g, model: GROUP_MODEL[g], key: keyOf(g) });
    const seen = new Set();
    return list.filter((c) => c.key && !seen.has(c.group) && seen.add(c.group));
  }, [aiGroup, fallback, getActiveKey, getKeyFor, selectedModel]);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);          // 화면에 보이는 대화 흔적
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [student, setStudent] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STUDENT_KEY)) || null; } catch { return null; }
  });
  const [listening, setListening] = useState(false);

  const turnsRef = useRef([]);                     // 모델에게 보내는 진짜 대화(도구 호출 포함)
  // 🐞 신고에 붙일 최근 오류·대화 — 패널이 뜰 때부터 모은다
  useEffect(() => { installErrorCapture(); registerTurns(() => turnsRef.current); }, []);
  const scrollRef = useRef(null);
  const recogRef = useRef(null);
  const win = useFloatingWindow();
  const { winRef, box, orient, compact, startDrag, startResize, toggleOrient } = win;

  // 화면이 갈리면 도구 목록도 갈린다 — 등록 상태를 구독해 다시 그린다.
  const agentKeys = useSyncExternalStore(subscribeKeys, keysSnapshot, () => '-|-');
  const tools = getTools();

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items, open]);

  useEffect(() => {
    try {
      if (student) localStorage.setItem(STUDENT_KEY, JSON.stringify({ id: student.id, name: student.name }));
      else localStorage.removeItem(STUDENT_KEY);
    } catch { /* 프라이빗 창 */ }
  }, [student]);

  const push = useCallback((item) => setItems((prev) => [...prev, item]), []);

  // ── 한 걸음: 서버에 물어본다 ──────────────────────────
  const askOnce = useCallback(async (turns, cand) => {
    const token = localStorage.getItem('ef_token');
    const res = await fetch(`${API_BASE}/api/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cand.key,
        'x-ai-model': cand.group,
        'x-ai-submodel': cand.model,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        turns,
        // ⚠ 도구 목록은 매 걸음 **지금 것**을 다시 만든다. 렌더 시점에 굳혀 두면 화면을 옮긴 뒤에도
        //   옛 화면의 도구를 광고하게 된다(다른 앱에서 실제로 난 버그).
        uiTools: getTools().map((t) => ({ name: t.name, description: t.description, schema: t.schema })),
        screen: describeScreen(),
        studentId: student?.id,
      }),
    });
    if (res.status === 401) { onAuthError?.(); throw new Error('로그인이 풀렸습니다. 다시 로그인해 주세요.'); }
    const json = await res.json().catch(() => ({ success: false, message: `서버 응답을 읽지 못했습니다 (HTTP ${res.status})` }));
    if (!json.success) { const e = new Error(json.message || `요청 실패 (HTTP ${res.status})`); e.aiError = json.aiError || null; throw e; }
    return json;
  }, [onAuthError, student]);

  // 한 걸음 — 고른 모델이 막히면 키가 있는 다음 제공사로 바꿔 같은 걸음을 다시 묻는다(대화 형식은 제공사 공통)
  const askServer = useCallback(async (turns) => {
    const list = candidates();
    let lastErr = null;
    for (let i = 0; i < list.length; i++) {
      try {
        const r = await askOnce(turns, list[i]);
        if (i > 0) setFallback({ group: list[i].group, model: list[i].model });
        return r;
      } catch (e) {
        lastErr = e;
        if (!SWITCHABLE.has(e.aiError)) throw e;
        if (i === list.length - 1) {
          if (i > 0) e.message = `넣어 두신 키(${list.map((c) => GROUP_NAME[c.group]).join('·')})가 모두 안 됩니다. 설정에서 키를 확인해 주세요. — 마지막 오류: ${e.message}`;
          throw e;
        }
        push({ kind: 'trace', text: `${GROUP_NAME[list[i].group] || list[i].group} 이(가) 지금 안 돼서 ${GROUP_NAME[list[i + 1].group]} 키로 바꿔 다시 합니다` });
      }
    }
    throw lastErr || new Error('쓸 수 있는 AI 키가 없습니다');
  }, [askOnce, candidates, push]);

  // ── 화면 도구 하나 실행 ───────────────────────────────
  const runUiTool = useCallback(async (call) => {
    // 부르기 직전에 다시 찾는다 — 앞의 도구가 화면을 옮겼을 수 있다.
    const tool = findTool(call.name);
    if (!tool) return `그런 도구는 지금 화면에 없습니다: ${call.name}`;
    if (tool.confirm) {
      const question = typeof tool.confirm === 'function' ? tool.confirm(call.input || {}) : tool.confirm;
      // eslint-disable-next-line no-alert
      if (question && !window.confirm(question)) return '사용자가 취소했습니다. 다시 묻지 말고 다음으로 넘어가세요.';
    }
    try {
      const out = await tool.run(call.input || {});
      return out == null ? '완료했습니다' : out;
    } catch (e) {
      return `실행하지 못했습니다: ${e.message}`;
    }
  }, []);

  // ── 대화 한 번 ────────────────────────────────────────
  const send = useCallback(async (raw) => {
    const text = String(raw || '').trim();
    if (!text || busy) return;
    if (!candidates().length) {
      push({ kind: 'error', text: '먼저 설정에서 Claude·GPT·Gemini 중 하나의 API 키를 넣어 주세요.' });
      return;
    }
    setInput('');
    push({ kind: 'user', text });
    setBusy(true);

    let turns = [...turnsRef.current, { role: 'user', content: text }];
    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        const r = await askServer(turns);
        if (r.text) push({ kind: 'ai', text: r.text });
        for (const log of r.toolLog || []) push({ kind: 'trace', text: `${log.name} — ${log.summary}` });

        if (r.done) { turns.push({ role: 'assistant', content: r.text || '' }); break; }

        turns.push(r.assistantTurn);
        const uiResults = [];
        for (const call of r.toolCalls || []) {
          const result = await runUiTool(call);
          uiResults.push({ id: call.id, name: call.name, result });
          push({ kind: 'trace', text: `${call.name} — ${typeof result === 'string' ? result : '완료'}` });
          // 화면이 다시 그려지고 도구가 재등록될 때까지 기다린다. 안 기다리면 다음 도구가 옛 값을 본다.
          await flush();
        }
        turns.push({ role: 'toolResults', results: [...(r.serverResults || []), ...uiResults] });

        if (step === MAX_STEPS - 1) push({ kind: 'error', text: '단계가 너무 길어져 멈췄습니다. 나눠서 시켜 주세요.' });
      }
    } catch (e) {
      push({ kind: 'error', text: e.message });
    } finally {
      // 너무 길어진 대화는 앞을 자른다 — 매 요청 통째로 보내므로 그냥 두면 요금과 지연이 계속 는다.
      turnsRef.current = turns.slice(-40);
      setBusy(false);
    }
  }, [askServer, busy, candidates, push, runUiTool]);

  // ── 말로 시키기 ───────────────────────────────────────
  const SpeechRecognition = typeof window !== 'undefined'
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;

  const toggleMic = useCallback(() => {
    if (!SpeechRecognition) return;
    if (recogRef.current) { recogRef.current.stop(); return; }
    const recog = new SpeechRecognition();
    recog.lang = 'ko-KR';
    recog.interimResults = true;
    recog.continuous = false;
    let finalText = '';
    recog.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const chunk = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += chunk; else interim += chunk;
      }
      setInput(finalText + interim);
    };
    recog.onerror = () => { setListening(false); recogRef.current = null; };
    recog.onend = () => {
      setListening(false);
      recogRef.current = null;
      // 말이 끝나면 바로 보낸다 — 마이크를 쓰는 사람은 손이 비어 있다는 뜻이다.
      if (finalText.trim()) send(finalText);
    };
    recogRef.current = recog;
    setListening(true);
    recog.start();
  }, [SpeechRecognition, send]);

  useEffect(() => () => { try { recogRef.current?.abort(); } catch { /* 이미 끝났다 */ } }, []);

  if (!open) {
    return (
      <button className="ef-as-fab" onClick={() => setOpen(true)} title="너만의 패파에게 시키기">
        🎓 너만의 패파
      </button>
    );
  }

  const style = compact
    ? undefined
    : { left: box.x, top: box.y, width: box.w, height: box.h };

  return (
    <div ref={winRef} className={`ef-as-win ${compact ? 'compact' : ''}`} style={style} data-orient={orient}>
      {!compact && (
        <>
          <div className="ef-as-grip nw" onPointerDown={startResize({ dx: -1, dy: -1 })} />
          <div className="ef-as-grip ne" onPointerDown={startResize({ dx: 1, dy: -1 })} />
          <div className="ef-as-grip sw" onPointerDown={startResize({ dx: -1, dy: 1 })} />
          <div className="ef-as-grip se" onPointerDown={startResize({ dx: 1, dy: 1 })} />
        </>
      )}

      <header className="ef-as-head" onPointerDown={startDrag}>
        <span className="ef-as-title">🎓 너만의 패파</span>
        <span className="ef-as-sub" title={`도구 ${tools.length}개 · ${agentKeys}`}>도구 {tools.length}</span>
        <span className="ef-as-spacer" />
        {!compact && (
          <button className="ef-as-icon" onClick={toggleOrient} title="가로형 ↔ 세로형">
            {orient === 'landscape' ? '▭' : '▯'}
          </button>
        )}
        <button className="ef-as-icon" onClick={() => setOpen(false)} title="닫기">✕</button>
      </header>

      <div className="ef-as-bar">
        <StudentPicker value={student} onChange={setStudent} placeholder="학생 선택 안 함" />
        <span className="ef-as-model" title={fallback ? `고른 모델(${selectedModel})이 안 돼서 자동으로 바꿨습니다` : ''}>{fallback ? `${fallback.model} (자동 전환)` : selectedModel}</span>
      </div>

      <div className="ef-as-log" ref={scrollRef}>
        {items.length === 0 && (
          <div className="ef-as-hint">
            화면을 대신 조작합니다. 예를 들어 —
            <ul>
              <li>입결 콘솔 열어줘</li>
              <li>새 분석 폼에 김하늘 / 부천고 / 고2 / 내신 2.3 넣어줘</li>
              <li>중앙대 컴퓨터공학 교과 70%컷 찾아서 배치에 저장해줘</li>
            </ul>
            학생을 고르면 그 학생 기록을 읽고 답합니다.
          </div>
        )}
        {items.map((it, i) => (
          <div key={i} className={`ef-as-msg ${it.kind}`}>
            {it.kind === 'trace' ? <span className="ef-as-arrow">↳</span> : null}
            <span>{it.text}</span>
          </div>
        ))}
        {busy && <div className="ef-as-msg trace"><span className="ef-as-arrow">↳</span><span>생각하는 중…</span></div>}
      </div>

      <div className="ef-as-input">
        <textarea
          value={input}
          placeholder="무엇을 할까요?"
          rows={compact || orient === 'landscape' ? 2 : 3}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input); }
          }}
        />
        {SpeechRecognition && (
          <button className={`ef-as-mic ${listening ? 'on' : ''}`} onClick={toggleMic} title="말로 시키기">
            {listening ? '■' : '🎤'}
          </button>
        )}
        <button className="ef-as-send" onClick={() => send(input)} disabled={busy || !input.trim()}>
          {busy ? '…' : '시키기'}
        </button>
      </div>
    </div>
  );
}
