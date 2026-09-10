import { useAssistantAgent } from './useAssistantAgent';

// 어느 화면에서나 되는 도구 — 화면 이동과 모델 선택.
// 이 앱은 라우터가 없고 App.jsx 의 view 상태 하나로 화면이 갈린다. 그래서 '주소 이동'이 아니라
// setView 를 직접 부른다(새로고침이 없어 하던 작업이 날아가지 않는다).

// key = App.jsx 의 view 값. 설명은 조교가 어디로 갈지 고르는 유일한 근거라 한 줄씩 붙인다.
export const VIEWS = [
  { key: 'dashboard', label: '대시보드', desc: '오늘 할 일·학생 보드 요약. 시작 화면.' },
  { key: 'list', label: '학생 목록', desc: '학생을 찾아 열거나 새 분석을 시작한다.' },
  { key: 'form', label: '새 생기부 분석', desc: '학생 정보를 넣고 생기부·성적 PDF를 올려 분석을 돌린다.' },
  { key: 'result', label: '분석 결과', desc: '끝난 생기부 분석 리포트. 분석을 한 번 돌렸거나 불러왔을 때만 열린다.', needsResult: true },
  { key: 'chat', label: '상담 대화', desc: '분석 결과를 놓고 길게 상담하고 섹션 본문을 고치는 큰 화면.' },
  { key: 'assessment', label: '수행평가 출제', desc: '수행평가 문항을 만들고 워드로 내려받는다.' },
  { key: 'suharchive', label: '수행평가 보관함', desc: '만들어 둔 수행평가를 모아 보고 학생에게 배정한다.' },
  { key: 'board', label: '학생 보드', desc: '학생별 성적·기록·배치·로드맵을 관리한다.' },
  { key: 'ipgyeol', label: '입결 콘솔', desc: '대학어디가 입시결과(70%컷·경쟁률·충원)를 조건으로 뒤진다.' },
  { key: 'ratio', label: '실시간 경쟁률', desc: '원서 접수 기간 경쟁률을 따라간다.' },
  { key: 'admissions', label: '전형 자료', desc: '대학별 전형계획·모집요강 자료.' },
  { key: 'univinfo', label: '대학 정보', desc: '대학별 기본 정보.' },
  { key: 'settings', label: '설정', desc: 'Claude·GPT·Gemini API 키를 넣는 곳.' },
  { key: 'admin', label: '관리자', desc: '이용자 코드·접속 기록·지식베이스. 관리자만.', adminOnly: true },
];

export function useAppAgent({ view, setView, selectedModel, setModel, modelConfig, role, hasResult }) {
  const allowed = VIEWS.filter((v) => (!v.adminOnly || role === 'admin') && (!v.needsResult || hasResult));
  const here = VIEWS.find((v) => v.key === view);

  useAssistantAgent('global', {
    key: 'app',
    title: '입시-Finder',
    describe: () => [
      '[앱] 입시-Finder (패스파인더 에듀) — 생기부 분석 · 입결 조회 · 수행평가 출제 · 학생 관리.',
      `[지금 모델] ${modelConfig[selectedModel]?.label || selectedModel}`,
      `[갈 수 있는 화면] ${allowed.map((v) => `${v.key}(${v.label}: ${v.desc})`).join(' / ')}`,
      here ? `[현재 view] ${here.key} — ${here.label}` : `[현재 view] ${view}`,
      hasResult ? '' : '[참고] 아직 분석 결과가 없어 result 화면은 열 수 없다.',
      '[할 수 없는 일] PDF·이미지 첨부는 파일 선택창이 필요해 조교가 대신 하지 못한다. 원장에게 직접 올려 달라고 말할 것.',
    ].filter(Boolean).join('\n'),
    tools: [
      {
        name: 'get_screen',
        description: '지금 어떤 화면에 무엇이 들어 있는지 다시 읽는다. 도구를 몇 번 쓴 뒤 결과를 확인할 때.',
        schema: { type: 'object', properties: {} },
        run: () => '아래 [지금 보고 있는 화면] 을 다시 확인하세요.',
      },
      {
        name: 'set_view',
        description: `화면을 옮긴다. 고를 수 있는 값: ${allowed.map((v) => v.key).join(', ')}`,
        schema: {
          type: 'object',
          properties: { view: { type: 'string', enum: allowed.map((v) => v.key), description: '옮겨 갈 화면' } },
          required: ['view'],
        },
        run: ({ view: next }) => {
          const hit = allowed.find((v) => v.key === next);
          if (!hit) return `그 화면은 지금 열 수 없습니다: ${next}`;
          setView(next);
          return `${hit.label} 화면으로 옮겼습니다.`;
        },
      },
      {
        name: 'set_model',
        description: `분석·상담에 쓸 AI 모델을 바꾼다. 고를 수 있는 값: ${Object.keys(modelConfig).join(', ')}`,
        schema: {
          type: 'object',
          properties: { model: { type: 'string', enum: Object.keys(modelConfig) } },
          required: ['model'],
        },
        run: ({ model }) => {
          if (!modelConfig[model]) return `그런 모델은 없습니다: ${model}`;
          setModel(model);
          return `모델을 ${modelConfig[model].label} 로 바꿨습니다. (이 대화는 다음 요청부터 새 모델로 갑니다)`;
        },
      },
    ],
  });
}
