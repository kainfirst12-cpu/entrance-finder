// 화면이 자기 도구를 등록해 두는 자리. 리액트 Context 가 아니라 모듈 전역인 이유:
//
//   도구는 대화 도중(리액트 렌더 밖)에서 불린다. Context 로 넘기면 패널이 렌더될 때
//   찍힌 옛 클로저를 잡게 되고, "지문 넣고 바로 생성" 같은 연속 호출이 옛 값을 본다.
//   그래서 등록은 매 렌더마다 덮어쓰고, 도구를 부를 때 **그 순간의 것**을 꺼내 쓴다.
//
// 칸은 둘이다.
//   global — 앱 껍데기(App.jsx)가 등록한다. 화면 이동·모델 선택처럼 어디서나 되는 것.
//   screen — 지금 보고 있는 화면이 등록한다. 화면이 바뀌면 통째로 갈린다.
// 이름이 겹치면 screen 이 이긴다(그 화면에서 더 구체적인 뜻일 테니).

const slots = { global: null, screen: null };
const listeners = new Set();

function notify() { for (const fn of listeners) fn(); }

/** 매 렌더 불린다 — 키가 그대로면 알리지 않는다(안 그러면 렌더 → 알림 → 렌더로 맴돈다). */
export function setAgent(slot, agent) {
  const changed = slots[slot]?.key !== agent?.key;
  slots[slot] = agent;
  if (changed) notify();
}

/** 내가 등록한 것일 때만 지운다 — 다음 화면이 먼저 등록했으면 그걸 지우면 안 된다. */
export function clearAgent(slot, key) {
  if (slots[slot]?.key !== key) return;
  slots[slot] = null;
  notify();
}

export function getAgent(slot) { return slots[slot]; }

/** 지금 이 순간 쓸 수 있는 도구 전부. 도구를 부르기 직전에 이걸로 다시 찾는다. */
export function getTools() {
  const out = new Map();
  for (const t of slots.global?.tools || []) out.set(t.name, t);
  for (const t of slots.screen?.tools || []) out.set(t.name, t);
  return [...out.values()];
}

export function findTool(name) {
  return slots.screen?.tools?.find((t) => t.name === name)
    || slots.global?.tools?.find((t) => t.name === name)
    || null;
}

/** 지금 화면이 무엇이고 어떤 상태인지 — 시스템 프롬프트에 실어 보낸다. */
export function describeScreen() {
  const parts = [];
  const g = slots.global;
  const s = slots.screen;
  if (g) parts.push(safeDescribe(g));
  if (s) parts.push(`[지금 화면] ${s.title || s.key}\n${safeDescribe(s)}`);
  if (s?.examples?.length) parts.push(`[이 화면에서 시킬 수 있는 말]\n${s.examples.map((e) => `- ${e}`).join('\n')}`);
  return parts.filter(Boolean).join('\n\n');
}

function safeDescribe(agent) {
  try { return String(agent.describe?.() ?? '').trim(); }
  catch (e) { return `(화면 상태를 읽지 못했습니다: ${e.message})`; }
}

/** 화면이 갈릴 때만 불린다 — 패널이 도구 목록을 다시 그리는 신호. */
export function subscribeKeys(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function keysSnapshot() {
  return `${slots.global?.key || '-'}|${slots.screen?.key || '-'}`;
}
