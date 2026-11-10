// 청크 → 대학별고사 문항(면접·구술 + 논술) 추출 요청 파라미터 (동기 테스트·배치 공용)
// v2(2026-11-10): 논술 문항, 문항카드의 교육과정 근거(과목·성취기준·교과서 출처)·채점 기준까지 뽑는다.
export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['university', 'questions'],
  properties: {
    university: { type: 'string', description: '보고서를 낸 대학 이름(캠퍼스 포함, 예: 한양대학교(ERICA))' },
    questions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['kind', 'qno', 'question', 'passage', 'dept', 'track', 'interviewType', 'essayField', 'subject', 'intent', 'followUps', 'evalPoints', 'curriculum', 'units', 'textbooks', 'page'],
        properties: {
          kind: { type: 'string', enum: ['면접', '논술'], description: '면접·구술고사 문항이면 면접, 논술고사 문항이면 논술' },
          qno: { type: 'string', description: '문서에 적힌 문항 번호·이름 그대로(예: "인문계 논제 II", "자연계열 오전 [문제 2]", "문항 3"). 같은 문항의 질문과 문항카드 근거를 잇는 열쇠이니 문서 표기를 그대로 쓴다. 없으면 빈 문자열' },
          question: { type: 'string', description: '학생이 답해야 하는 질문·논제 원문. 하위문항은 [1-1] 처럼 번호를 살려 한 질문에 함께 둔다. 이 구간에 질문 원문은 없고 그 문항의 교육과정 근거·채점 기준만 있으면 빈 문자열' },
          passage: { type: 'string', description: '제시문·자료 원문(없으면 빈 문자열, 5000자까지). 수식·그림이 깨져 읽을 수 없는 부분은 [그림] [수식] 으로 표시' },
          dept: { type: 'string', description: '모집단위·학과·계열(문서 표기 그대로, 없으면 빈 문자열)' },
          track: { type: 'string', description: '전형명(없으면 빈 문자열)' },
          interviewType: { type: 'string', enum: ['제시문 기반', '서류 기반', '인성', 'MMI', '교직적성', '전공적성', '기타', '해당없음'], description: '면접 유형. 논술이면 해당없음' },
          essayField: { type: 'string', enum: ['인문', '사회', '인문사회 통합', '수리', '과학', '의학', '기타', '해당없음'], description: '논술 계열. 면접이면 해당없음' },
          subject: { type: 'string', description: '관련 교과·과목 한 줄 요약(없으면 빈 문자열)' },
          intent: { type: 'string', description: '출제의도·평가 요소 요약(문서에 있을 때만, 200자 이내, 없으면 빈 문자열)' },
          followUps: { type: 'array', items: { type: 'string' }, description: '문서에 적힌 추가·꼬리 질문(면접만)' },
          evalPoints: { type: 'string', description: '채점 기준과 예시 답안의 핵심 요지(문서에 있을 때만, 600자 이내, 없으면 빈 문자열). 무엇을 쓰면 점수가 나는지가 드러나게' },
          curriculum: {
            type: 'array', description: '문항카드의 «관련 성취기준»(교육과정 근거). 문서에 적힌 것만, 없으면 빈 배열',
            items: {
              type: 'object', additionalProperties: false, required: ['subject', 'code', 'standard'],
              properties: {
                subject: { type: 'string', description: '과목명(예: 수학Ⅱ, 통합사회, 생명과학Ⅰ, 국어)' },
                code: { type: 'string', description: '성취기준 코드(예: [12수학Ⅱ02-03], [10국02-01]). 없으면 빈 문자열' },
                standard: { type: 'string', description: '성취기준 문장(150자 이내)' },
              },
            },
          },
          units: { type: 'array', items: { type: 'string' }, description: '근거로 든 교과서 단원·영역(예: "통합사회 · 사회 변화와 공존", "수학Ⅱ · 미분 · 도함수의 활용"). 문서에 적힌 것만, 「과목 · 단원」 모양으로' },
          textbooks: {
            type: 'array', description: '«자료 출처»·«교과서 출처» 표의 고교 교과서(도서명·출판사·쪽). 문서에 적힌 것만, 없으면 빈 배열',
            items: {
              type: 'object', additionalProperties: false, required: ['title', 'publisher', 'pages'],
              properties: { title: { type: 'string' }, publisher: { type: 'string' }, pages: { type: 'string' } },
            },
          },
          page: { type: 'integer', description: '질문(질문이 없으면 근거)이 실린 쪽 번호(<<쪽 N>> 표시 기준)' },
        },
      },
    },
  },
};

export const SYSTEM = `당신은 대학 입학처의 '선행학습 영향평가 자체평가보고서'에서 **대학별고사 문항(면접·구술고사, 논술고사)**을 정확히 옮겨 적는 편집자입니다.
규칙:
- 면접·구술고사(제시문 면접, 서류 기반 면접, 인성 면접, MMI, 교직적성 면접 등)와 논술고사에서 수험생에게 실제로 제시된 질문·논제, 또는 대학이 공개한 면접 예상·예시 질문을 추출합니다. kind 로 면접/논술을 구분합니다.
- 적성고사, 실기, 수능, 지필고사(논술 아님) 문항은 넣지 않습니다. 면접인지 논술인지 알 수 없으면 넣지 않습니다.
- 문항카드에는 보통 «적용 교육과정», «관련 성취기준»(교과명·과목명·성취기준 코드와 문장), «자료 출처»(교과서 도서명·저자·발행처·쪽), «문항 해설», «채점 기준», «예시 답안»이 있습니다. 이것을 그 문항의 curriculum·textbooks·units·evalPoints·intent 에 넣습니다. 성취기준 코드와 문장은 원문 그대로, 지어내지 않습니다.
- 한 문항카드의 질문 원문과 근거가 이 구간에서 떨어져 있어도(앞 구간에 질문, 이 구간에 근거) qno 를 문서 표기 그대로 적어 두면 나중에 잇습니다. 이 구간에 근거만 있으면 question 을 빈 문자열로 두고 qno·kind·curriculum·textbooks·units·evalPoints 만 채웁니다.
- 평가자용 체크 문구, 평가 기준 설명 문장, 운영 절차, 통계, 위원회 검토의견서는 질문이 아닙니다.
- 질문과 제시문은 원문 그대로 옮기고, 의미를 바꾸지 않는 범위에서 PDF 추출로 깨진 띄어쓰기·줄바꿈만 바로잡습니다. 새로 지어내지 않습니다.
- 같은 질문이 표와 문항카드에 두 번 나오면 한 번만 적고, 더 자세한 쪽을 씁니다.
- 제시문이 여러 하위문항에 공통이면 각 질문의 passage 에 같은 제시문을 넣습니다(길면 핵심 5000자까지).
- 문항이 면접·구술인지 논술인지는 [문서 맥락]의 요약표(평가대상·전형·문항번호)와 본문 제목(예: '면접 및 구술고사', '논술고사')으로 판단합니다. 대학별고사가 면접·구술고사뿐인 대학(요약표에 논술이 없음)은 수학·과학 교과 문항도 구술 면접 문항입니다.
- 이 구간에 해당 문항이 없으면 questions 를 빈 배열로 둡니다.`;

export function params(chunk, ctx = {}) {
  const head = `[문서 맥락] ${chunk.name}
문서 전체 언급 횟수: 면접·구술 ${ctx.iv ?? '?'}회, 논술 ${ctx.non ?? '?'}회, 적성고사 ${ctx.apt ?? '?'}회
${ctx.summary || '(요약표 없음)'}`;
  return {
    model: 'claude-opus-5-5',
    max_tokens: 48000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: [
      { type: 'text', text: head, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `(${chunk.year}학년도 보고서) 아래는 이 문서의 ${chunk.pages[0]}~${chunk.pages.at(-1)}쪽 텍스트 추출본입니다.\n\n${chunk.text}` },
    ] }],
  };
}
