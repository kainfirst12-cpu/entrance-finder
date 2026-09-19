// services/reportMarkdown.js — 학교 입시 해설 보고서 본문(마크다운)의 '구조 서식' 파서
//
// AI 본문은 마크다운 한 벌이 원본이다(원장이 수정 탭에서 고치고, 나만의 패파로 그대로 보낸다).
// 대신 몇 줄은 고정 서식으로 쓰게 해서 렌더러(PDF·Word·화면·나만의 패파)가 표·차트로 바꿔 그린다:
//   [지표] 내신 경쟁 강도: 4/5 — 근거                         (비교: [지표] 내신 경쟁 강도: 부천고 4/5 · 중산고 2/5 — 근거)
//   [전형] 학생부교과 2/5 · 학생부종합 5/5 · 정시(수능) 3/5      (비교: 학교마다 한 줄 — [전형] 부천고: 학생부교과 2/5 · …)
//   - **학생 유형** — 근거                                    (유리/불리 섹션의 글머리표 → ✅/⚠️ 표)
// 서식이 안 맞는 줄은 그냥 글로 남긴다 — 렌더러가 깨지면 안 된다.
//
//   parseReport(md) → { sections: [{ title, level, lines[] }], indicators, tracks, favorable, unfavorable }

const SCORE_RE = /(\d(?:\.\d)?)\s*\/\s*5/;

function parseScores(text) {
  // "4/5" → [{who:null, score:4}] · "부천고 4/5 · 중산고 2/5" → [{who:'부천고', score:4}, ...]
  const parts = text.split(/\s*[·,]\s*/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const m = p.match(SCORE_RE);
    if (!m) continue;
    const who = p.slice(0, m.index).replace(/[:：]\s*$/, '').trim() || null;
    out.push({ who, score: Math.max(0, Math.min(5, Number(m[1]))) });
  }
  return out;
}

export function parseReport(md) {
  const sections = [];
  let cur = { title: '', level: 0, lines: [] };
  for (const raw of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    const h = raw.match(/^(#{1,4})\s+(.*)$/);
    if (h) { if (cur.title || cur.lines.some((l) => l.trim())) sections.push(cur); cur = { title: h[2].trim(), level: h[1].length, lines: [] }; continue; }
    cur.lines.push(raw);
  }
  if (cur.title || cur.lines.some((l) => l.trim())) sections.push(cur);

  const indicators = [], tracks = [], favorable = [], unfavorable = [];
  const bulletOf = (line) => {
    const m = line.match(/^\s*[-*•]\s+(?:\*\*(.+?)\*\*|(.+?))\s*(?:[—–:]\s*|$)(.*)$/);
    if (!m) return null;
    const who = (m[1] || m[2] || '').trim(); const why = (m[3] || '').trim();
    return who ? { who, why } : null;
  };
  for (const sec of sections) {
    const isFav = /유리/.test(sec.title) && !/불리/.test(sec.title);
    const isUnfav = /불리/.test(sec.title);
    for (const line of sec.lines) {
      const ind = line.match(/^\s*\[지표\]\s*(.+?)\s*[:：]\s*(.+?)(?:\s*[—–-]{1,2}\s*(.*))?$/);
      if (ind) { const scores = parseScores(ind[2]); if (scores.length) indicators.push({ label: ind[1].trim(), scores, note: (ind[3] || '').trim(), section: sec.title }); continue; }
      const tr = line.match(/^\s*\[전형\]\s*(?:([^:：]{1,20})[:：]\s*)?(.+)$/);
      if (tr) { const scores = parseScores(tr[2]); if (scores.length) tracks.push({ who: (tr[1] || '').trim() || null, scores, section: sec.title }); continue; }
      if (isFav || isUnfav) { const b = bulletOf(line); if (b) (isFav ? favorable : unfavorable).push(b); }
    }
  }
  return { sections, indicators, tracks, favorable, unfavorable };
}

/** 렌더러가 표·차트로 그린 줄은 본문에서 뺀다 — 같은 내용이 두 번 나오면 안 된다 */
export function stripStructured(md, { favorable = true } = {}) {
  const out = [];
  let inFavSec = false;
  for (const raw of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    const h = raw.match(/^(#{1,4})\s+(.*)$/);
    if (h) inFavSec = favorable && /유리|불리/.test(h[2]);
    if (/^\s*\[(지표|전형)\]/.test(raw)) continue;
    if (inFavSec && /^\s*[-*•]\s+/.test(raw)) continue;
    out.push(raw);
  }
  return out.join('\n');
}
