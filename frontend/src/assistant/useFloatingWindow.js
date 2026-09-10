import { useCallback, useEffect, useRef, useState } from 'react';

// 떠 있는 창의 자리·크기. 라이브러리를 쓰지 않는 이유: 이 앱은 빌드 뒤 난독화를 한 번 더 거치고
// 의존성이 react/react-dom 둘뿐이다. 드래그 한 가지 때문에 그 균형을 깨지 않는다.

const STORE_KEY = 'ef-assistant-window';
// 폭이 이보다 좁으면 띄우지 않고 아래에 붙는 시트로 바꾼다 — 휴대폰에서 창을 끌게 하면 못 쓴다.
export const COMPACT_WIDTH = 900;

const DEFAULTS = {
  landscape: { w: 780, h: 380 },
  portrait: { w: 400, h: 660 },
};
const MIN = {
  landscape: { w: 520, h: 240 },
  portrait: { w: 320, h: 320 },
};
const MARGIN = 16;

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function save(all) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(all)); } catch { /* 프라이빗 창 — 이번만 기억 못 한다 */ }
}

function defaultBox(orient) {
  const d = DEFAULTS[orient];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // 처음 뜨는 자리는 오른쪽 아래 — 화면 한복판을 가리지 않는다.
  return { x: Math.max(MARGIN, vw - d.w - MARGIN), y: Math.max(MARGIN, vh - d.h - MARGIN), w: d.w, h: d.h };
}

function clamp(box, orient) {
  const min = MIN[orient];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(Math.max(box.w, min.w), Math.max(min.w, vw - MARGIN * 2));
  const h = Math.min(Math.max(box.h, min.h), Math.max(min.h, vh - MARGIN * 2));
  return {
    w, h,
    x: Math.min(Math.max(box.x, MARGIN - w + 80), vw - 80),   // 최소한 머리줄 한 줌은 화면 안에 남긴다
    y: Math.min(Math.max(box.y, MARGIN), vh - 48),
  };
}

export function useFloatingWindow() {
  const [compact, setCompact] = useState(() => window.innerWidth < COMPACT_WIDTH);
  const [orient, setOrient] = useState(() => loadSaved().orient || 'landscape');
  const [box, setBox] = useState(() => {
    const saved = loadSaved();
    const o = saved.orient || 'landscape';
    return clamp(saved[o] || defaultBox(o), o);
  });
  const winRef = useRef(null);
  const boxRef = useRef(box);
  boxRef.current = box;

  useEffect(() => {
    const onResize = () => {
      setCompact(window.innerWidth < COMPACT_WIDTH);
      setBox((b) => clamp(b, orient));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [orient]);

  const persist = useCallback((next, o) => {
    const all = loadSaved();
    all.orient = o;
    all[o] = next;
    save(all);
  }, []);

  // 끄는 동안은 setState 를 하지 않고 DOM 좌표만 직접 쓴다 — 리렌더를 프레임마다 돌리면
  // 대화 목록까지 다시 그려져 눈에 띄게 뻑뻑해진다. 손을 뗄 때 한 번만 state 에 반영한다.
  const startDrag = useCallback((e) => {
    if (compact || e.button !== 0) return;
    const el = winRef.current;
    if (!el) return;
    e.preventDefault();
    const start = { ...boxRef.current };
    const ox = e.clientX;
    const oy = e.clientY;
    let latest = start;
    const move = (ev) => {
      latest = clamp({ ...start, x: start.x + (ev.clientX - ox), y: start.y + (ev.clientY - oy) }, orient);
      el.style.left = `${latest.x}px`;
      el.style.top = `${latest.y}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBox(latest);
      persist(latest, orient);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [compact, orient, persist]);

  /** dir: 잡은 모서리. {dx,dy} 는 -1(왼쪽·위) / +1(오른쪽·아래). */
  const startResize = useCallback((dir) => (e) => {
    if (compact || e.button !== 0) return;
    const el = winRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { ...boxRef.current };
    const ox = e.clientX;
    const oy = e.clientY;
    let latest = start;
    const move = (ev) => {
      const mx = ev.clientX - ox;
      const my = ev.clientY - oy;
      const next = { ...start };
      if (dir.dx < 0) { next.w = start.w - mx; next.x = start.x + mx; } else { next.w = start.w + mx; }
      if (dir.dy < 0) { next.h = start.h - my; next.y = start.y + my; } else { next.h = start.h + my; }
      latest = clamp(next, orient);
      el.style.left = `${latest.x}px`;
      el.style.top = `${latest.y}px`;
      el.style.width = `${latest.w}px`;
      el.style.height = `${latest.h}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setBox(latest);
      persist(latest, orient);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [compact, orient, persist]);

  /** 가로 ↔ 세로. 자리·크기는 방향마다 따로 기억한다 — 되돌렸을 때 쓰던 자리 그대로. */
  const toggleOrient = useCallback(() => {
    setOrient((prev) => {
      const next = prev === 'landscape' ? 'portrait' : 'landscape';
      const saved = loadSaved();
      const b = clamp(saved[next] || defaultBox(next), next);
      setBox(b);
      persist(b, next);
      return next;
    });
  }, [persist]);

  return { winRef, box, orient, compact, startDrag, startResize, toggleOrient };
}
