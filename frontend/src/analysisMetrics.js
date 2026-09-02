// analysisMetrics.js — 리포트 본문에서 '한눈에 보기' 지표를 뽑는다
//
// 예전 규칙은 "'학업'이 들어간 첫 줄의 첫 숫자"였다. 그래서
//   "| 3 | 중앙대 경영 | … 일반고 2.2등급대, 전공 관련 교과 우수 | 85% |"
// 같은 합격사례 표에서 2.2를 '전공적합성 2.2점'으로 읽었다(실제 사고).
// 이제는 ① 항목명을 정확히 보고 ② 숫자가 '점수'로 적힌 자리일 때만 인정한다.
// 못 찾으면 만들어내지 않고 비운다 — 학부모에게 나가는 문서에 가짜 점수를 넣을 수는 없다.

const LABELS = [
  { re: /학업\s*역량/, label: '학업역량' },
  { re: /비교과(\s*활동)?/, label: '비교과' },
  { re: /진로\s*역량/, label: '진로역량' },
  { re: /세특(\s*질)?|세부능력/, label: '세특 질' },
  { re: /전공\s*적합(성)?/, label: '전공적합성' },
];

// 성적·비율이 적힌 줄은 역량 점수가 아니다
const NOT_SCORE = /등급|백분위|퍼센타일|경쟁률|%|명\s*모집/;

function scoreFromLine(line) {
  if (NOT_SCORE.test(line)) return null;
  // ① 배점·획득 표: | 학업 역량 | 10점 | 8.0점 |
  let m = line.match(/\|\s*([0-9]+(?:\.[0-9]+)?)\s*점?\s*\|\s*([0-9]+(?:\.[0-9]+)?)\s*점?\s*(?=\||$)/);
  if (m) {
    const max = parseFloat(m[1]), score = parseFloat(m[2]);
    if (max >= 5 && score >= 0 && score <= max) return { score, max };
  }
  // ② 8.0 / 10 · 8점/10점
  m = line.match(/([0-9]+(?:\.[0-9]+)?)\s*점?\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*점?/);
  if (m) {
    const score = parseFloat(m[1]), max = parseFloat(m[2]);
    if (max >= 5 && score >= 0 && score <= max) return { score, max };
  }
  // ③ 점수 칸 하나: | 학업역량 | 8.5 | 우수 |  (10점 만점으로 본다)
  m = line.match(/\|\s*([0-9]+(?:\.[0-9]+)?)\s*점?\s*(?=\||$)/);
  if (m) {
    const score = parseFloat(m[1]);
    if (score >= 0 && score <= 10) return { score, max: 10 };
  }
  return null;
}

const textOf = (results) =>
  Object.values(results || {}).filter((v) => typeof v === 'string').join('\n').replace(/\*\*/g, '');

/** 역량 점수 — 3개 이상 찾았을 때만 돌려준다(반쪽짜리 도표는 오해를 부른다) */
export function extractScores(results) {
  try {
    const lines = textOf(results).split('\n');
    const found = [];
    for (const w of LABELS) {
      for (const line of lines) {
        if (!w.re.test(line)) continue;
        const s = scoreFromLine(line);
        if (s) { found.push({ label: w.label, ...s }); break; }
      }
    }
    return found.length >= 3 ? found : null;
  } catch { return null; }
}

// 소제목(불릿이 아닌 짧은 줄) 아래의 불릿만 모은다.
// 예전 방식은 키워드를 한 번 만나면 글 끝까지 불릿을 주워, 강점과 보완점에 같은 문장이 실렸다.
function sectionItems(text, kwRe, cap = 4) {
  const out = [];
  let capture = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/[*_#"\\]/g, '').trim();
    if (!line) continue;
    const isBullet = /^[-•]/.test(line);
    const looksHeading = !isBullet && line.length <= 30;
    if (looksHeading && kwRe.test(line)) { capture = true; continue; }
    if (!capture) continue;
    if (isBullet) {
      const item = line.replace(/^[-•]\s*/, '').trim();
      if (item.length > 3 && item.length < 70 && !out.includes(item)) out.push(item);
      if (out.length >= cap) break;
      continue;
    }
    if (looksHeading || out.length) break;   // 다음 소제목이거나 불릿이 끊기면 그 절은 끝
  }
  return out;
}

/** 강점·보완점 — 같은 문장이 양쪽에 실리지 않게 겹치는 것은 보완점에서 뺀다 */
export function extractHighlights(results) {
  try {
    const text = textOf(results);
    const strengths = sectionItems(text, /강점|강화|유지/);
    const weaknesses = sectionItems(text, /보완|약점|개선|부족/).filter((t) => !strengths.includes(t));
    return { strengths, weaknesses };
  } catch { return { strengths: [], weaknesses: [] }; }
}

export const scoreTone = (pct) => (pct >= 80 ? '#16a34a' : pct >= 60 ? '#4f7cff' : pct >= 40 ? '#d97706' : '#dc2626');

/** 종합 역량(10점 환산) */
export const totalScore = (scores) =>
  scores?.length ? Math.round((scores.reduce((s, x) => s + (x.score / x.max) * 10, 0) / scores.length) * 10) / 10 : null;

/** 인쇄용 레이더 차트 SVG 문자열 (화면 컴포넌트와 같은 좌표계) */
export function radarSvg(scores, { size = 260, r = 74 } = {}) {
  const N = scores.length;
  const CX = size / 2, CY = 104;
  const angle = (i) => ((-90 + (360 / N) * i) * Math.PI) / 180;
  const pt = (i, rr) => [CX + rr * Math.cos(angle(i)), CY + rr * Math.sin(angle(i))];
  const ring = (frac) => scores.map((_, i) => pt(i, r * frac).map((v) => v.toFixed(1)).join(',')).join(' ');
  const data = scores.map((s, i) => pt(i, r * (s.score / s.max)).map((v) => v.toFixed(1)).join(',')).join(' ');
  const grid = [0.25, 0.5, 0.75, 1].map((f) => `<polygon points="${ring(f)}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`).join('');
  const spokes = scores.map((_, i) => { const [x, y] = pt(i, r); return `<line x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`; }).join('');
  const dots = scores.map((s, i) => { const [x, y] = pt(i, r * (s.score / s.max)); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#4f7cff"/>`; }).join('');
  const labels = scores.map((s, i) => { const [x, y] = pt(i, r + 17); return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="700" fill="#475569">${s.label}</text>`; }).join('');
  return `<svg width="${size}" height="208" viewBox="0 0 ${size} 208" xmlns="http://www.w3.org/2000/svg">${grid}${spokes}<polygon points="${data}" fill="rgba(79,124,255,0.22)" stroke="#4f7cff" stroke-width="2" stroke-linejoin="round"/>${dots}${labels}</svg>`;
}
