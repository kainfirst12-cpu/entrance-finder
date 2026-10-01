// 청크 → 면접 문항 추출 요청 파라미터 (동기 테스트·배치 공용)
export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['university', 'questions'],
  properties: {
    university: { type: 'string', description: '보고서를 낸 대학 이름(캠퍼스 포함, 예: 한양대학교(ERICA))' },
    questions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['question', 'passage', 'dept', 'track', 'interviewType', 'subject', 'intent', 'followUps', 'evalPoints', 'page'],
        properties: {
          question: { type: 'string', description: '학생이 답해야 하는 질문 원문. 하위문항은 [1-1] 처럼 번호를 살려 한 질문에 함께 둔다' },
          passage: { type: 'string', description: '제시문·자료 원문(없으면 빈 문자열). 수식·그림이 깨져 읽을 수 없는 부분은 [그림] [수식] 으로 표시' },
          dept: { type: 'string', description: '모집단위·학과·계열(문서 표기 그대로, 없으면 빈 문자열)' },
          track: { type: 'string', description: '전형명(없으면 빈 문자열)' },
          interviewType: { type: 'string', enum: ['제시문 기반', '서류 기반', '인성', 'MMI', '교직적성', '전공적성', '기타'] },
          subject: { type: 'string', description: '관련 교과·과목(없으면 빈 문자열)' },
          intent: { type: 'string', description: '출제의도·평가 요소 요약(문서에 있을 때만, 150자 이내, 없으면 빈 문자열)' },
          followUps: { type: 'array', items: { type: 'string' }, description: '문서에 적힌 추가·꼬리 질문' },
          evalPoints: { type: 'string', description: '채점 기준·예시 답안의 핵심 요지(문서에 있을 때만, 300자 이내, 없으면 빈 문자열)' },
          page: { type: 'integer', description: '질문이 실린 쪽 번호(<<쪽 N>> 표시 기준)' },
        },
      },
    },
  },
};

export const SYSTEM = `당신은 대학 입학처의 '선행학습 영향평가 자체평가보고서'에서 **면접·구술고사 문항만** 정확히 옮겨 적는 편집자입니다.
규칙:
- 면접·구술고사(제시문 면접, 서류 기반 면접, 인성 면접, MMI, 교직적성 면접 등)에서 수험생에게 실제로 제시된 질문, 또는 대학이 공개한 면접 예상·예시 질문만 추출합니다.
- 논술고사, 적성고사, 실기, 수능, 지필고사 문항은 절대 넣지 않습니다. 문항이 면접인지 논술인지 불분명하면 넣지 않습니다.
- 평가자용 체크 문구, 평가 기준 설명 문장, 운영 절차, 통계, 교육과정 근거 설명은 질문이 아닙니다.
- 질문과 제시문은 원문 그대로 옮기고, 의미를 바꾸지 않는 범위에서 PDF 추출로 깨진 띄어쓰기·줄바꿈만 바로잡습니다. 새로 지어내지 않습니다.
- 같은 질문이 표와 문항카드에 두 번 나오면 한 번만 적고, 더 자세한 쪽을 씁니다.
- 제시문이 여러 하위문항에 공통이면 각 질문의 passage 에 같은 제시문을 넣습니다(길면 핵심 2000자까지).
- 문항이 면접·구술인지는 [문서 맥락]의 요약표(평가대상·전형·문항번호)와 본문 제목(예: '면접 및 구술고사', '논술고사')으로 판단합니다. 대학별고사가 면접·구술고사뿐인 대학(요약표에 논술이 없음)은 수학·과학 교과 문항도 구술 문항입니다.
- 이 구간에 면접 문항이 없으면 questions 를 빈 배열로 둡니다.`;

export function params(chunk, ctx = {}) {
  const head = `[문서 맥락] ${chunk.name}
문서 전체 언급 횟수: 면접·구술 ${ctx.iv ?? '?'}회, 논술 ${ctx.non ?? '?'}회, 적성고사 ${ctx.apt ?? '?'}회
${ctx.summary || '(요약표 없음)'}`;
  return {
    model: 'claude-opus-5-5',
    max_tokens: 32000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'text', text: head, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `(${chunk.year}학년도 보고서) 아래는 이 문서의 ${chunk.pages[0]}~${chunk.pages.at(-1)}쪽 텍스트 추출본입니다.\n\n${chunk.text}` },
    ] }],
  };
}
