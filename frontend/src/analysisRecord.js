// analysisRecord.js — 저장된 '생기부 분석' 기록을 분석 결과 화면으로 되살린다
//
// 학생에게 배정할 때 기록에 남는 것은 섹션을 이어 붙인 글 한 덩어리다. 구조화된 결과(results)는
// 남지 않아, 지금까지는 배정하고 나면 그 분석으로 리포트를 다시 만들 수 없었다.
// 다행히 그 글은 '## 섹션 제목'으로 또렷하게 나뉘어 있다. 제목만 알면 되돌릴 수 있다.
//   → 새로 배정한 기록은 물론, 이미 배정해 둔 옛 기록도 그대로 분석 화면으로 불러올 수 있다.
//
// 제목 형식이 두 가지인 점에 주의: 분석 화면이 쓴 '## 학업역량 종합 분석' 과
// 보드의 JSON 불러오기가 쓴 '## 1단계 · 학업역량 종합 분석' 을 모두 같은 섹션으로 본다.

export const ANALYSIS_SECTIONS = [
  { key: 'caseMatching',   num: '0', title: '합격자 사례 매칭 분석' },
  { key: 'academic',       num: '1', title: '학업역량 종합 분석' },
  { key: 'activity',       num: '2', title: '비교과 활동 평가' },
  { key: 'career',         num: '3', title: '진로 역량 및 전공 적합성' },
  { key: 'strategy',       num: '4', title: '수시 지원 전략' },
  { key: 'roadmap',        num: '5', title: '핵심 리스크 및 대응 방안' },
  { key: 'recordFeedback', num: '6', title: '실행 계획' },
  { key: 'dashboard',      num: '7', title: '종합 평가 및 권고사항' },
  // 섹션이 나뉘지 않은 기록을 통째로 담는 칸. 되살린 뒤 다시 배정해도 같은 칸으로 돌아온다.
  { key: 'fullText',       num: '·', title: '분석 전문' },
];

// 제목 비교용 정규화 — 괄호 주석('(6장 카드)')·단계 번호·공백·기호를 걷어낸다
const norm = (s) => String(s || '')
  .normalize('NFC')
  .replace(/\([^)]*\)/g, '')
  .replace(/^\s*#+\s*/, '')
  .replace(/^\s*\d+\s*단계\s*[·ㆍ・.\-:]*\s*/, '')
  .replace(/[\s·ㆍ・.\-:]/g, '')
  .trim();

// 제목이 정확히 맞을 때만 섹션 경계로 본다.
// 번호만 보고 짐작하면 안 된다 — 모델이 본문 안에 쓰는 '## 2단계: 교과 성적 …' 같은 소제목은
// 우리 섹션 번호(2 = 비교과 활동 평가)와 뜻이 달라서, 번호를 믿으면 남의 글이 그 칸에 들어간다.
function keyOfHeading(heading) {
  const n = norm(heading);
  if (!n) return null;
  for (const s of ANALYSIS_SECTIONS) {
    if (n === norm(s.title) || n === s.key.toLowerCase()) return s.key;
  }
  return null;
}

/** 기록 본문 → { caseMatching: '...', academic: '...' } */
export function analysisResultsFromText(text) {
  const results = {};
  let cur = null, buf = [];
  const flush = () => {
    if (cur) {
      const body = buf.join('\n').trim();
      if (body) results[cur] = results[cur] ? `${results[cur]}\n\n${body}` : body;
    }
    buf = [];
  };
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^\s{0,3}#{1,3}\s+(.+?)\s*$/);
    const key = m ? keyOfHeading(m[1]) : null;
    if (key) { flush(); cur = key; continue; }
    if (cur) buf.push(line);
  }
  flush();
  return results;
}

// 생기부 분석 계열의 기록인가 — 입결·배치 보고서는 분석 화면이 다룰 글이 아니다
function looksLikeAnalysis(rec) {
  const t = `${rec?.type || ''} ${rec?.title || ''}`;
  if (/입결|배치|판정|로드맵/.test(t)) return false;
  return /생기부|분석/.test(t);
}

/** 이 기록을 분석 화면으로 되살릴 수 있는가 */
export function isRestorableRecord(rec) {
  const body = String(rec?.content || '').trim();
  if (body.length < 40) return false;
  if (Object.keys(analysisResultsFromText(body)).length > 0) return true;
  // 섹션 제목이 없는 기록(다른 도구에서 옮겨 온 글 등)도 생기부 분석이면 전문 그대로 연다.
  // 리포트를 다시 만드는 것이 목적이므로, 칸이 하나뿐이어도 인쇄·PDF·워드는 그대로 나온다.
  return looksLikeAnalysis(rec);
}

// 기록 제목에 적힌 모델 이름('Gemini 3.1 Pro 분석')에서 모델 키를 되찾는다.
// 긴 이름이 짧은 이름을 포함하므로(‘GPT-5.5’ ⊂ ‘GPT-5.5 Pro’) 긴 것부터 맞춰 본다.
const MODEL_BY_LABEL = {
  'Claude Sonnet 5': 'claude', 'Claude Opus 5': 'claude-opus',
  'Gemini 3.7 Flash': 'gemini', 'Gemini 3.1 Pro': 'gemini-pro',
  'GPT-5.6 Sol': 'gpt', 'GPT-5.6 Terra': 'gpt-mini', 'GPT-5.6 Luna': 'o4-mini',
  'GPT-5.5 Pro': 'o3', 'GPT-5.5': 'gpt-4.1',
};
export function modelKeyFromTitle(title) {
  const t = String(title || '');
  const labels = Object.keys(MODEL_BY_LABEL).sort((a, b) => b.length - a.length);
  for (const lab of labels) if (t.includes(lab)) return MODEL_BY_LABEL[lab];
  return null;
}

/** 학생 카드 + 기록 → 분석 결과 화면이 그대로 쓰는 데이터 */
export function analysisDataFromRecord(student, rec) {
  const body = String(rec?.content || '').trim();
  let results = analysisResultsFromText(body);
  // 섹션이 안 잡히면 전문을 한 칸에 담는다. 없는 제목을 붙여 나누는 것보다,
  // 글을 그대로 두고 '분석 전문'이라고 말하는 편이 정직하고 리포트도 온전하다.
  if (!Object.keys(results).length) {
    if (!body) return null;
    results = { fullText: body };
  }
  return {
    results,
    studentData: {
      name: student?.name || '',
      school: student?.school || '',
      grade: student?.grade || '',
      major: student?.major || '',
      targetUniv: student?.target_univ || student?.targetUniv || '',
    },
    pdfCount: 0,
    pdfTexts: '',   // 원본 PDF 글자는 기록에 남지 않는다 — 재분석하려면 생기부를 다시 올려야 한다
    analyzedModel: modelKeyFromTitle(rec?.title) || undefined,
    restoredFrom: `${student?.name || '학생'} · ${rec?.title || rec?.type || '저장된 기록'}`,
    restoredAt: rec?.created_at || null,
  };
}
