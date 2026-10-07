// 🐞 너만의 패파 버그 신고 — 다섯 앱 공통(원장 요청 2026-10-07). 국뽀·뽀개기·패스파인더 Q 의
// src/lib/assistant/bug-report.ts 와 같은 일을 한다(이 앱은 JS·도구 모양만 다름) — 고치면 같이.
// 신고는 나만의 패파(academy-video) 한 곳에 모인다: POST /api/inbound/bug-report → 플랫폼 콘솔 '🐞 버그 신고함'.
// 화면·브라우저·최근 오류(installErrorCapture 가 모아 둔 것)·최근 대화는 자동으로 붙는다.

export const BUG_APP = 'entrance-finder';
const INBOX = `${import.meta.env.VITE_ACADEMY_VIDEO_URL || 'https://academy-video.vercel.app'}/api/inbound/bug-report`;

const recent = [];
let installed = false;
let turnsGetter = () => [];
const note = (s) => {
  recent.push(`${new Date().toLocaleTimeString('ko-KR', { hour12: false })} ${s}`.slice(0, 400));
  if (recent.length > 15) recent.shift();
};
// 주소의 ?쿼리는 뗀다 — 토큰·코드가 실려 있을 수 있어서.
const bare = (u) => { try { const x = new URL(u, location.href); return x.origin === location.origin ? x.pathname : `${x.origin}${x.pathname}`; } catch { return String(u).split('?')[0]; } };

/** 패널이 대화 기록을 읽을 수 있게 알려 준다 */
export function registerTurns(fn) { turnsGetter = fn; }

export function installErrorCapture() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => note(`오류: ${e.message}${e.filename ? ` (${bare(e.filename)}:${e.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (e) => note(`처리 안 된 오류: ${String(e.reason?.message ?? e.reason)}`));
  const origError = console.error.bind(console);
  console.error = (...args) => {
    try { note(`console.error: ${args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ').slice(0, 300)}`); } catch { /* ignore */ }
    origError(...args);
  };
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = String(init?.method || input?.method || 'GET').toUpperCase();
    try {
      const res = await origFetch(input, init);
      if (!res.ok && !url.includes('/api/inbound/bug-report')) note(`요청 실패: ${method} ${bare(url)} → ${res.status}`);
      return res;
    } catch (err) {
      note(`요청 실패: ${method} ${bare(url)} → ${err?.name === 'AbortError' ? '중단' : err?.message || '네트워크 오류'}`);
      throw err;
    }
  };
}

export const BUG_RULE = '[버그 신고] 원장이 버그·오류를 말하면("안 돼요", "오류 나요", "이상해요", "버그 신고") 먼저 사용법 문제인지 본다. 앱이 잘못 동작하는 거면 빠진 것만 한 번에 짧게 묻고(무엇을 하다가 / 어떻게 됐는지·오류 문구 그대로 / 원래 어떻게 돼야 하는지), 정리한 내용을 3~4줄로 보여 준 뒤 report_bug 로 보낸다. 화면·최근 오류는 자동으로 붙으니 묻지 않는다.';

function chatLines() {
  const out = [];
  for (const t of (turnsGetter() || []).slice(-12)) {
    if ((t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content) {
      out.push(`${t.role === 'user' ? '사용자' : '패파'}: ${t.content.slice(0, 300)}`);
    }
  }
  return out;
}

const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function bugReportTool(screen) {
  return {
    name: 'report_bug',
    description: '원장이 말한 버그·오류를 정리해 개발 담당에게 보낸다. 무엇을 하다가·어떻게 됐는지·원래 기대를 모은 뒤에만 부른다. 화면·브라우저·최근 오류 기록·최근 대화는 자동으로 붙는다.',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: "한 줄 요약(예: '면접 리포트 생성이 90%에서 멈춤')" },
        category: { type: 'string', enum: ['bug', 'error', 'slow', 'confusing', 'request'], description: 'bug 기능 고장 / error 오류 메시지 / slow 느림·멈춤 / confusing 헷갈림·불편 / request 바라는 점' },
        severity: { type: 'string', enum: ['high', 'normal', 'low'], description: 'high = 일을 못 함, normal = 불편, low = 사소함' },
        what_happened: { type: 'string', description: '어떻게 됐는지(오류 문구는 그대로)' },
        steps: { type: 'string', description: '무엇을 하다가 — 화면·누른 버튼·넣은 값 순서' },
        expected: { type: 'string', description: '원래 어떻게 돼야 하는지' },
        reporter: { type: 'string', description: '신고한 분이 밝힌 이름·학원(말했을 때만)' },
      },
      required: ['title', 'what_happened'],
    },
    confirm: (a) => `이 내용으로 버그 신고를 보낼까요?\n\n«${s(a.title, 200)}»\n${s(a.what_happened, 300)}`,
    run: async (a) => {
      const body = {
        app: BUG_APP,
        title: s(a.title, 200), category: s(a.category, 20), severity: s(a.severity, 20),
        what_happened: s(a.what_happened, 4000), steps: s(a.steps, 4000), expected: s(a.expected, 2000), reporter: s(a.reporter, 100),
        page_url: `${location.origin}${location.pathname}`,
        context: {
          screen: screen(), user_agent: navigator.userAgent, viewport: `${window.innerWidth}×${window.innerHeight}`,
          recent_errors: [...recent], recent_chat: chatLines(),
        },
      };
      if (!body.title) return '신고 제목이 비어 있습니다.';
      try {
        const r = await fetch(INBOX, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return `신고를 보내지 못했습니다: ${j.error || r.status}`;
        return `신고 접수됨(번호 ${String(j.id || '').slice(0, 8)}). 개발 담당이 확인한다고 원장에게 알리세요.`;
      } catch {
        return '신고를 보내지 못했습니다(네트워크). 잠시 뒤 다시 시도하자고 안내하세요.';
      }
    },
  };
}
