// services/practiceReview.js — 🤖 면접 연습 AI 첨삭 프롬프트
//
// 선생님 키로 돈다. 학생부 기록과 대조해 '학생부에 없는 말'을 짚고, 학생 문장을 살린 개선 답안을 쓴다.
// 결과(ai_review)는 선생님만 본다 — 학생에게는 선생님이 코멘트로 옮긴 것만 보인다.

export const PRACTICE_REVIEW_SYSTEM = `당신은 대입 면접 코치입니다. 학생이 실전처럼 연습한 면접 답변 하나를 첨삭합니다.
원칙:
- 학생부(제공된 기록)에 없는 활동·수치·책을 지어내지 않습니다. 개선 답안에 학생부 근거가 필요한데 찾을 수 없으면 [학생부에서 찾을 것: …] 자리표시를 둡니다.
- 개선 답안은 학생이 실제로 말한 내용과 표현을 최대한 살려 다듬습니다. 모범답안을 새로 쓰지 않습니다.
- 답변 길이 규칙: 60초 230~280자, 45초 200~240자, 30~40초 150~190자(공백 포함). 첫 문장에 결론, 활동 한 장면(무엇을·어떻게), 배운 점·전공 연결 순서.
- factCheck 는 답변 속 사실 주장(활동·역할·수치·책·결과)마다 학생부 기록과 대조합니다. 학생부 기록이 없으면 status 를 '학생부에 없음'으로 두고 note 에 '학생부 자료 없음'이라고 적습니다.
- 점수·등급·합격 가능성은 말하지 않습니다. 이모지 금지. 선생님용 문장은 합니다체, 학생 코멘트는 해요체.
- 학생 코멘트는 2~4문장: 잘한 점 하나 + 가장 중요한 고칠 점 1~2개를 구체적으로.
출력은 JSON 하나만:
{"summary":"선생님용 한 줄 총평(40자 이내)","good":["잘한 점"],"fix":[{"point":"고칠 점","why":"이유","how":"이렇게 바꾸기"}],"factCheck":[{"claim":"답변 속 주장","status":"학생부 확인됨|학생부에 없음|학생부와 다름","note":"근거나 확인할 것"}],"improved":"개선 답안","followUps":["면접관이 이어 물을 질문"],"studentComment":"학생에게 남길 코멘트 초안"}`;

// 문항 출처 정보 — 면접 전략 리포트(의도·예시 답안·카드 규칙) 또는 공식 기출(출제 의도·채점 요지)
export function questionInfo(rec, { interview, bankItem } = {}) {
  let seconds = Number(rec.limit_sec) || 60;
  if (interview) {
    const d = interview.data || {};
    const card = (d.cards || [])[rec.card_index] || {};
    const part = (d.interviews || []).find((x) => x.cardIndex === rec.card_index) || {};
    const q = (part.questions || [])[rec.q_index] || {};
    const a = (part.answers || [])[rec.q_index] || {};
    seconds = Number(card.answerSeconds) || seconds;
    return {
      seconds,
      text: [
        `[지원 카드] ${card.univ || ''} ${card.dept || ''} ${card.track || ''} · 면접 유형 ${card.kind || '-'} · 답변 ${seconds}초 · 답변 틀 ${card.formula || '결론 → 한 장면 → 배운 점'}`,
        `[이 문항의 의도] ${a.intent || '-'}`,
        `[리포트 예시 답안(설계도)] ${a.sample || '-'}`,
        `[리포트 꼬리질문] ${q.follow || '-'}`,
        `[학생부 핵심 소재] ${(d.topics || []).map((t) => t.title).join(' / ') || '-'}`,
      ].join('\n'),
    };
  }
  if (bankItem) {
    const it = bankItem;
    return {
      seconds,
      text: [
        `[공식 기출] ${it.univ} ${it.y}학년도 ${it.type}${it.dept ? ` · ${it.dept}` : ''}`,
        it.psg ? `[제시문] ${it.psg.slice(0, 2500)}` : '',
        `[대학이 밝힌 출제 의도] ${it.intent || '-'}`,
        `[채점·예시 답안 요지] ${it.ev || '-'}`,
      ].filter(Boolean).join('\n'),
    };
  }
  return { seconds, text: '' };
}

export function reviewUserMsg(rec, studentSection, qi) {
  const ra = rec.analysis || {};
  return [
    studentSection,
    '',
    `[연습 문항] ${rec.question}`,
    qi.text,
    `[제한 시간] ${rec.limit_sec || qi.seconds}초 · 실제 ${rec.duration_sec ?? '-'}초 · 입력 ${rec.input_mode === 'voice' ? '받아쓰기(말한 그대로)' : '직접 입력'}`,
    '[학생 답변]',
    rec.answer,
    rec.follow_up ? `\n[꼬리질문] ${rec.follow_up}\n[학생 답] ${rec.follow_answer || '(답하지 않음)'}` : '',
    `[규칙 점검(참고)] 분량 ${ra.chars ?? '-'}자, 고칠 점: ${(ra.fix || []).join(' / ') || '없음'}`,
    '',
    '위 답변을 첨삭해 JSON으로 주세요.',
  ].filter((x) => x !== undefined).join('\n');
}
