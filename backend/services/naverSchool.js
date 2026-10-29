// services/naverSchool.js — 네이버 교육 학교 페이지의 '개설 과목'(편제)을 읽는다.
//
// 왜: 과목 선택 보조의 '우리 학교 개설 여부'는 2026 나이스 시간표 기반이라 2022 개정 3학년 과목은 '가능성'으로만 보였다.
//   네이버 교육 학교 페이지(제공 윈드폴리)는 1학년 1학기~3학년 2학기 편제를 학기별로 보여 주고, 3학년은 2027 개설 예정 과목이다.
// 쓰는 법: 원장·선생님이 학교 페이지 링크를 붙여 넣을 때 그 학교 하나만 읽는다(학기 6쪽). 전국 일괄 수집은 하지 않는다.
// 페이지는 선택한 학기 하나만 HTML 에 싣는다 — 그래서 subjectGrade·subjectTerm 을 바꿔 6번 읽는다.

const SEMS = [[1, 1], [1, 2], [2, 1], [2, 2], [3, 1], [3, 2]];
const TTL = 7 * 24 * 60 * 60 * 1000; // 편제는 자주 안 바뀐다 — 학교당 7일 캐시
const cache = new Map();

/** 링크·ID 문자열 → 네이버 학교 ID (없으면 null) */
export function naverSchoolId(input) {
  const s = String(input || '').trim();
  const m = s.match(/edu\.naver\.com\/schools\/([A-Za-z0-9]{6,20})/) || s.match(/^([A-Za-z0-9]{6,20})$/);
  return m ? m[1] : null;
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** 학기 한 쪽 HTML → [{ area, subjects: [] }] (개설 과목 영역만) */
export function parseOfferings(html) {
  const start = html.indexOf('data-nlog-area="subject_offerings"');
  if (start < 0) return null; // 페이지 모양이 바뀌었거나 개설 과목 영역이 없는 학교
  const end = html.indexOf('</section>', start);
  const seg = html.slice(start, end > 0 ? end : start + 60000).replace(/<!--[\s\S]*?-->/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
  // 교과 머리: <span>국어</span><span>2과목</span>
  const head = /<span[^>]*>([^<]{1,30})<\/span><span[^>]*>(\d+)과목<\/span>/g;
  const heads = [...seg.matchAll(head)];
  return heads.map((h, i) => {
    const body = seg.slice(h.index + h[0].length, i + 1 < heads.length ? heads[i + 1].index : seg.length);
    // 마지막 교과 뒤에는 '제공 윈드폴리' 같은 출처 글자가 이어진다 — 머리에 적힌 과목 수만큼만 받는다.
    const subjects = [...body.matchAll(/<span[^>]*>([^<]+)<\/span>/g)].map((m) => decode(m[1])).filter((s) => s && s !== '제공');
    return { area: decode(h[1]), count: Number(h[2]), subjects: [...new Set(subjects)].slice(0, Number(h[2])) };
  });
}

async function fetchPage(id, g, t) {
  const url = `https://edu.naver.com/schools/${id}?subjectGrade=${g}&subjectTerm=${t}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) entrance-finder', 'Accept-Language': 'ko' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`네이버 교육 응답 ${res.status}`);
  return res.text();
}

/** 학교 하나의 6학기 편제 */
export async function loadNaverOfferings(id) {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const pages = await Promise.all(SEMS.map(([g, t]) => fetchPage(id, g, t)));
  const name = (pages[0].match(/<h1[^>]*>([^<]+)<\/h1>/) || [])[1];
  const yearNote = (pages[0].match(/3학년은\s*(?:<!--[^>]*-->)?\s*(\d{4})/) || [])[1] || null;
  const sems = {};
  let parsed = 0;
  SEMS.forEach(([g, t], i) => {
    const areas = parseOfferings(pages[i]);
    if (areas) parsed++;
    sems[`${g}-${t}`] = areas || [];
  });
  if (!name || !parsed) throw new Error('개설 과목을 읽지 못했습니다 — 네이버 교육 학교 페이지 링크인지 확인해 주세요');
  const total = Object.values(sems).reduce((n, a) => n + a.reduce((m, x) => m + x.subjects.length, 0), 0);
  if (!total) throw new Error(`${decode(name)} 페이지에 개설 과목이 아직 없습니다`);
  const data = { id, schoolName: decode(name), sems, g3Year: yearNote ? Number(yearNote) : null, provider: '윈드폴리 · 네이버 교육', url: `https://edu.naver.com/schools/${id}`, fetchedAt: new Date().toISOString() };
  cache.set(id, { at: Date.now(), data });
  return data;
}
