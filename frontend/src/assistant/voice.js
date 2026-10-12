// 🎤 너만의 패파 받아쓰기 — 다섯 앱 같은 규칙(패스파인더 Q src/lib/assistant/voice.ts 를 옮긴 것, 2026-10-12).
// 안드로이드 크롬이 «지금까지 말한 전체»를 새 결과로 또 보내 말이 겹쳐 적히던 문제를 고쳤다:
//   매번 결과 전체로 글을 다시 만들고(앞 조각을 포함한 새 조각은 바꿔 끼움), 안드로이드는 한 문장씩 듣고 끊기면 저절로 다시 듣는다.
function getCtor() {
  if (typeof window === "undefined") return null;
  const w = window;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
function voiceSupported() {
  return getCtor() !== null;
}
const join = (...xs) => xs.map((x) => x.trim()).filter(Boolean).join(" ");
function mergeResults(results) {
  const finals = [];
  let interim = "";
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const t = (r?.[0]?.transcript || "").trim();
    if (!t) continue;
    if (r.isFinal) {
      const last = finals[finals.length - 1];
      if (last && t.startsWith(last)) finals[finals.length - 1] = t;
      else if (!last || !last.endsWith(t)) finals.push(t);
    } else interim = t;
  }
  const final = finals.join(" ");
  if (interim && final && interim.startsWith(final)) interim = interim.slice(final.length).trim();
  return { final, interim };
}
function startVoice(handlers) {
  const Ctor = getCtor();
  if (!Ctor) return null;
  const android = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
  let committed = "";
  let current = "";
  let stopped = false;
  let quiet = 0;
  let rec = null;
  const finish = () => {
    if (stopped) return;
    stopped = true;
    handlers.onEnd(join(committed, current));
  };
  const begin = () => {
    const r = new Ctor();
    rec = r;
    r.lang = "ko-KR";
    r.continuous = !android;
    r.interimResults = true;
    let heard = false;
    r.onresult = (e) => {
      const m = mergeResults(e.results);
      if (m.final || m.interim) heard = true;
      current = m.final;
      handlers.onText(join(committed, current), m.interim);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        handlers.onError("\uB9C8\uC774\uD06C \uAD8C\uD55C\uC774 \uD544\uC694\uD574\uC694 \u2014 \uC8FC\uC18C\uCC3D \uC67C\uCABD \uC790\uBB3C\uC1E0\uC5D0\uC11C \uB9C8\uC774\uD06C\uB97C \xAB\uD5C8\uC6A9\xBB\uC73C\uB85C \uBC14\uAFD4 \uC8FC\uC138\uC694.");
        stopped = true;
        return;
      }
      handlers.onError(`\uC74C\uC131 \uC778\uC2DD \uC624\uB958: ${e.error ?? "\uC54C \uC218 \uC5C6\uC74C"}`);
    };
    r.onend = () => {
      if (stopped) return;
      if (android) {
        committed = join(committed, current);
        current = "";
        quiet = heard ? 0 : quiet + 1;
        if (quiet < 3) {
          try {
            begin();
            return;
          } catch {
          }
        }
      }
      finish();
    };
    r.start();
  };
  try {
    begin();
  } catch {
    return null;
  }
  return {
    stop: () => {
      if (stopped) return;
      try {
        rec?.stop();
      } catch {
      }
      finish();
    }
  };
}
export {
  mergeResults,
  startVoice,
  voiceSupported
};
