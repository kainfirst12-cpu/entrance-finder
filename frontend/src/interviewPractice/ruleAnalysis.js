// interviewPractice/ruleAnalysis.js — 면접 연습 답변 즉시 점검 (AI 없이 규칙만)
//
// 점수나 합격 가능성은 내지 않는다. 길이·속도·구조·학생부 소재 사용처럼
// 답변에서 실제로 셀 수 있는 것만 짚는다. 기준은 면접 전략 리포트의 답변 길이 규칙
// (60초 230~280자 / 45초 200~240자 / 30~40초 150~190자)과 같은 값을 쓴다.

// 답변 시간(초) → 권장 분량(글자 수, 공백 포함). 리포트 INTERVIEW_RULES 와 같은 표.
export function lengthBand(seconds) {
  const s = Number(seconds) || 60;
  if (s >= 55) return { lo: Math.round(230 * s / 60), hi: Math.round(280 * s / 60) };
  if (s >= 42) return { lo: 200, hi: 240 };
  return { lo: Math.round(150 * s / 35), hi: Math.round(190 * s / 35) };
}

// 한국어 말하기 속도 — 권장 분량 규칙(60초 230~280자)에서 거꾸로 잡은 분당 글자 수
const RATE_LO = 200, RATE_HI = 320;

const STOP = new Set('저는 제가 그리고 그래서 하지만 때문에 대한 대해서 것이 것은 하는 있습니다 합니다 했습니다 정말 매우 그냥 조금 약간 생각합니다 있었습니다 되었습니다 통해 이를 이런 그런 또한 무엇인가요 무엇입니까 어떻게 있나요 설명해 주세요'.split(' '));
const FILLERS = ['음', '어', '저기', '그냥', '약간', '뭐랄까', '뭔가', '막', '좀', '이제', '사실'];

const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const words = (t) => (String(t || '').match(/[가-힣A-Za-z0-9]{2,}/g) || []);
// 조사를 떼어 비교용 어간 (단순: 흔한 조사 1개)
const stem = (w) => w.replace(/(으로|에서|에게|까지|부터|이라|라는|이다|이며|에는|와의|과의|을|를|이|가|은|는|의|와|과|로|에|도|만)$/, '');

export function analyzeAnswer({ question = '', answer = '', durationSec = 0, targetSec = 60, inputMode = 'text', topics = [], major = '' } = {}) {
  const text = norm(answer);
  const chars = text.length;
  const sentences = text ? text.split(/(?<=[.!?。])\s+|(?<=(?:니다|었다|았다|했다|한다|된다|있다|없다|이다|어요|아요|해요|예요|이에요))\s+|\n+/).map((s) => s.trim()).filter((s) => s.length > 1) : [];
  const band = lengthBand(targetSec);
  const estSec = Math.round(chars / 4.3); // 보통 속도(분당 약 260자)로 말했을 때 걸리는 시간
  const rate = inputMode === 'voice' && durationSec > 5 ? Math.round(chars / durationSec * 60) : null;

  // 추임새 — 받아쓰기로 입력했을 때만 의미가 있다(타자로는 거의 안 나온다)
  const fillerHits = FILLERS.map((f) => ({ f, n: (text.match(new RegExp(`(^|[\\s,])${f}(?=[\\s,.]|$)`, 'g')) || []).length }))
    .filter((x) => x.n > 0);

  // 같은 말 반복
  const freq = new Map();
  words(text).map(stem).filter((w) => w.length > 1 && !STOP.has(w)).forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
  const repeated = [...freq].filter(([, n]) => n >= 4).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w, n]) => `${w}(${n}회)`);

  // 답변 구조 — 결론 먼저 / 근거 / 구체적 장면 / 배운 점 / 전공 연결
  const first = sentences[0] || '';
  const structure = {
    conclusion: !!first && first.length <= 90 && /(다|요)[.!]?$/.test(first),
    reason: /왜냐|때문|이유|근거|따라서|그래서/.test(text),
    scene: /예를 들어|당시|활동|탐구|실험|보고서|프로젝트|동아리|수업|시간에|직접|\d+(명|개|회|주|%|시간)/.test(text),
    lesson: /배웠|깨달|느꼈|성장|알게 되|앞으로|다시 한다면|계기/.test(text),
    major: /전공|학과|진로|대학에서|입학 후/.test(text) || (!!major && words(major).some((w) => text.includes(stem(w)))),
  };

  // 학생부 소재(리포트가 뽑은 핵심 소재) 중 답변에 등장한 것
  const usedTopics = topics.filter((t) => {
    const ws = words(t).map(stem).filter((w) => w.length >= 2 && !STOP.has(w));
    const hit = ws.filter((w) => text.includes(w));
    return hit.some((w) => w.length >= 3) || hit.length >= 2; // '화학' 한 낱말만 겹친 건 그 소재를 쓴 게 아니다
  });

  // 질문의 핵심어에 답했는가 (질문 속 명사 중 답변에 나온 비율)
  const qWords = [...new Set(words(question).map(stem).filter((w) => w.length >= 2 && !STOP.has(w)))].slice(0, 10);
  const qHit = qWords.filter((w) => text.includes(w));

  const avgLen = sentences.length ? Math.round(chars / sentences.length) : 0;

  const good = [], fix = [], next = [];
  if (!chars) {
    fix.push('답변이 비어 있습니다. 한 문장이라도 소리 내어 말하고 적어 보세요.');
  } else {
    if (chars < band.lo * 0.8) fix.push(`분량이 짧습니다(${chars}자). ${targetSec}초 답변은 ${band.lo}~${band.hi}자가 알맞습니다 — 구체적인 장면을 한 문장 더하세요.`);
    else if (chars > band.hi * 1.15) fix.push(`분량이 깁니다(${chars}자). 실제로 말하면 약 ${estSec}초라 ${targetSec}초를 넘깁니다 — 결론과 장면 하나만 남기세요.`);
    else good.push(`분량이 알맞습니다(${chars}자 · 말하면 약 ${estSec}초).`);

    if (structure.conclusion) good.push('첫 문장에서 결론을 먼저 말했습니다.');
    else { fix.push('첫 문장이 결론이 아닙니다. 질문에 대한 답을 첫 문장에 바로 말하세요.'); next.push('첫 문장 = 질문에 대한 한 줄 답'); }

    if (structure.scene) good.push('실제 활동 장면이 들어 있습니다.');
    else { fix.push('추상적인 설명만 있습니다. 직접 한 활동의 장면(무엇을, 어떻게)을 넣으세요.'); next.push('활동 한 장면을 "언제·무엇을·어떻게"로 한 문장'); }

    if (structure.lesson) good.push('배운 점·변화가 드러납니다.');
    else next.push('마지막 문장 = 그 경험으로 배운 점이나 달라진 점');

    // 근거는 판단·의견을 묻는 질문에서만 따진다('맡은 역할은?'에 근거를 요구하면 잔소리가 된다)
    if (!structure.reason && /왜|이유|생각|의견|입장|판단|동의|찬성|반대|어떻게 보/.test(question)) fix.push('판단의 근거(왜 그렇게 생각했는지)가 보이지 않습니다.');

    if (topics.length) {
      if (usedTopics.length) good.push(`학생부 소재를 썼습니다: ${usedTopics.slice(0, 3).join(', ')}.`);
      else { fix.push('학생부에 있는 활동이 답변에 나오지 않습니다. 면접관은 학생부를 보며 묻습니다.'); next.push(`쓸 만한 소재: ${topics.slice(0, 3).join(' / ')}`); }
    }

    if (qWords.length >= 2 && qHit.length === 0) fix.push('질문의 핵심 낱말이 답변에 없습니다. 질문에서 벗어나지 않았는지 확인하세요.');

    if (avgLen > 75) fix.push(`문장이 깁니다(평균 ${avgLen}자). 말할 때는 한 문장에 한 가지만 담으세요.`);
    if (repeated.length) fix.push(`같은 말이 반복됩니다: ${repeated.join(', ')}.`);
    if (fillerHits.length) fix.push(`추임새가 들어갔습니다: ${fillerHits.map((x) => `"${x.f}" ${x.n}회`).join(', ')}.`);
    if (rate != null) {
      if (rate > RATE_HI) fix.push(`말이 빠릅니다(분당 약 ${rate}자). 문장 끝에서 반 박자 쉬세요.`);
      else if (rate < RATE_LO) fix.push(`말이 느리거나 멈춘 시간이 깁니다(분당 약 ${rate}자). 말할 순서를 먼저 정하고 시작하세요.`);
      else good.push(`말하기 속도가 안정적입니다(분당 약 ${rate}자).`);
    }
    if (!structure.major && /지원|전공|학과|진로|대학/.test(question)) next.push('마지막에 지원 전공과 연결하는 한 문장');
  }
  if (!next.length && chars) next.push('같은 구조를 유지하고, 꼬리질문에도 한 장면으로 답해 보기');

  return {
    chars, sentences: sentences.length, avgLen, estSec, rate, band, targetSec,
    structure, usedTopics, fillers: fillerHits, repeated,
    good, fix, next: next.slice(0, 3),
  };
}

// 꼬리질문 — 리포트에 적힌 꼬리질문이 먼저, 없으면 답변에서 빠진 것을 묻는다
export function pickFollowUp(q = {}, analysis = {}) {
  if (q.follow) return { text: q.follow, type: q.followType || '꼬리' };
  const s = analysis.structure || {};
  if (!s.scene) return { text: '방금 말한 내용을 실제로 해 본 활동 하나로 설명해 주시겠어요?', type: '검증' };
  if (!s.reason) return { text: '그렇게 판단한 근거는 무엇인가요?', type: '꼬리' };
  if (!s.lesson) return { text: '그 경험으로 무엇이 달라졌나요?', type: '꼬리' };
  return { text: '그 과정에서 가장 어려웠던 점과, 다시 한다면 바꿀 점은 무엇인가요?', type: '꼬리' };
}
