// reportHtml.js — 보고서 마크다운 안의 '점수'를 그림으로 바꾸는 공용 HTML 조각 (다크 테마)
//   · 점수 표: 어느 칸이든 "7/10", "4/5", "65%" 꼴이면 그 칸을 막대(또는 점)로 그린다 — 생기부 분석 '5개 영역 평가'·'합격 가능성' 표가 여기에 걸린다
//   · [지표] 이름: 4/5 — 근거   → 점 5개 스코어카드 (비교: 학교A 4/5 · 학교B 2/5)
//   · [전형] 학생부교과 2/5 · 학생부종합 5/5 · 정시(수능) 3/5 → 전형별 적합도 막대
// mdPreview(수행평가 아카이브·학교 해설)와 AnalysisResult 의 mdToHtml 이 같이 쓴다. PDF·Word·나만의 패파도 같은 규칙으로 그린다.

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ACCENT = '#2dd4bf', DIM = '#9aa4b2', TRACK = 'rgba(255,255,255,0.08)';
const SCHOOL_COLORS = ['#818cf8', '#2dd4bf', '#fbbf24', '#fb7185'];

/** "7/10" → {value:7,max:10} · "65%" → {value:65,max:100} · 아니면 null */
export function parseScore(text) {
  const t = String(text || '').trim().replace(/\*\*/g, '');
  let m = t.match(/^(\d+(?:\.\d+)?)\s*\/\s*(5|10|100)\s*(?:점)?$/);
  if (m) return { value: Number(m[1]), max: Number(m[2]), label: `${m[1]}/${m[2]}` };
  m = t.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (m) return { value: Number(m[1]), max: 100, label: `${m[1]}%` };
  return null;
}

const barColor = (ratio) => (ratio >= 0.7 ? ACCENT : ratio >= 0.4 ? '#fbbf24' : '#f87171');

export function barHtml(sc, { color } = {}) {
  const ratio = Math.max(0, Math.min(1, sc.value / sc.max));
  const c = color || barColor(ratio);
  return `<span style="display:inline-flex;align-items:center;gap:6px;min-width:120px"><span style="flex:1;height:8px;border-radius:4px;background:${TRACK};overflow:hidden;display:inline-block;min-width:70px"><span style="display:block;height:100%;width:${(ratio * 100).toFixed(0)}%;background:${c};border-radius:4px"></span></span><b style="font-size:11px;color:${c};white-space:nowrap">${esc(sc.label)}</b></span>`;
}
export function dotsHtml(score, color = ACCENT) {
  const on = Math.round(Math.max(0, Math.min(5, score)));
  return `<span style="color:${color};letter-spacing:1px;white-space:nowrap">${'●'.repeat(on)}<span style="opacity:.3">${'●'.repeat(5 - on)}</span> <span style="font-size:10px;opacity:.8">${score}/5</span></span>`;
}

/** 표(첫 줄 = 머리)에 점수 칸이 있으면 막대 표 HTML, 없으면 null */
export function scoreTableHtml(rows) {
  if (rows.length < 2) return null;
  const body = rows.slice(1);
  const scoreCols = new Set();
  body.forEach((r) => r.forEach((c, i) => { if (parseScore(c)) scoreCols.add(i); }));
  if (!scoreCols.size) return null;
  let html = '<table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:12.5px">';
  html += '<tr>' + rows[0].map((c) => `<th style="text-align:left;padding:6px 9px;border-bottom:1px solid rgba(255,255,255,0.14);color:${DIM};font-weight:700;font-size:11px">${esc(c)}</th>`).join('') + '</tr>';
  body.forEach((r) => {
    html += '<tr>' + r.map((c, i) => {
      const sc = scoreCols.has(i) ? parseScore(c) : null;
      const inner = sc ? barHtml(sc) : (i === 0 ? `<b>${esc(c)}</b>` : esc(c));
      return `<td style="padding:7px 9px;border-bottom:1px solid rgba(255,255,255,0.07);vertical-align:middle;${sc ? 'min-width:150px' : ''}">${inner}</td>`;
    }).join('') + '</tr>';
  });
  return html + '</table>';
}

/** "[지표] 이름: 4/5 — 근거" 한 줄 → 스코어카드 행 HTML. 아니면 null */
export function indicatorLineHtml(line) {
  const m = line.match(/^\s*\[지표\]\s*(.+?)\s*[:：]\s*(.+?)(?:\s*[—–-]{1,2}\s*(.*))?$/);
  if (!m) return null;
  const parts = m[2].split(/\s*[·,]\s*/).map((p) => p.trim()).filter(Boolean);
  const scores = parts.map((p) => { const s = p.match(/(\d(?:\.\d)?)\s*\/\s*5/); if (!s) return null; return { who: p.slice(0, s.index).replace(/[:：]\s*$/, '').trim(), score: Number(s[1]) }; }).filter(Boolean);
  if (!scores.length) return null;
  const cells = scores.map((s, i) => `<span style="display:inline-flex;gap:6px;align-items:center;margin-right:14px">${s.who ? `<span style="font-size:11px;font-weight:700;color:${SCHOOL_COLORS[i % 4]}">${esc(s.who)}</span>` : ''}${dotsHtml(s.score, scores.length > 1 ? SCHOOL_COLORS[i % 4] : ACCENT)}</span>`).join('');
  return `<div style="display:grid;grid-template-columns:120px minmax(0,1fr);gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.07)"><b style="font-size:12.5px">${esc(m[1])}</b><div><div>${cells}</div>${m[3] ? `<div style="font-size:11px;color:${DIM};margin-top:2px">${esc(m[3])}</div>` : ''}</div></div>`;
}

/** "[전형] (학교:) 학생부교과 2/5 · 학생부종합 5/5 · 정시(수능) 3/5" → 막대 행 HTML. 아니면 null */
export function trackLineHtml(line) {
  const m = line.match(/^\s*\[전형\]\s*(?:([^:：]{1,20})[:：]\s*)?(.+)$/);
  if (!m) return null;
  const parts = m[2].split(/\s*[·,]\s*/).map((p) => p.trim()).filter(Boolean);
  const scores = parts.map((p) => { const s = p.match(/(\d(?:\.\d)?)\s*\/\s*5/); if (!s) return null; return { who: p.slice(0, s.index).trim(), score: Number(s[1]) }; }).filter(Boolean);
  if (!scores.length) return null;
  const cells = scores.map((s) => `<span style="display:inline-flex;align-items:center;gap:6px;flex:1 1 170px"><span style="font-size:11px;width:64px">${esc(s.who)}</span>${barHtml({ value: s.score, max: 5, label: `${s.score}/5` }, { color: ACCENT })}</span>`).join('');
  return `<div style="display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:6px 0">${m[1] ? `<b style="font-size:12px;width:56px">${esc(m[1])}</b>` : `<span style="font-size:11px;color:${DIM};width:70px">전형 적합도</span>`}${cells}</div>`;
}

/** 스코어카드 여러 줄을 하나의 상자로 감싼다 */
export function wrapCard(innerHtml) {
  return `<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:6px 12px;margin:8px 0 12px">${innerHtml}</div>`;
}
