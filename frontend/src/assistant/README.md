# AI 선생님 (떠 있는 조교)

말(또는 타자)로 시키면 **화면을 대신 조작하고**, 입결·전형 자료는 서버 도구로 직접 조회한다.

## 어떻게 도는가

```
브라우저                                   서버 (/api/assistant)
─────────                                 ─────────────────────
turns + 지금 화면의 도구 목록  ──────────▶  모델에게 물어본다
                                           ├ 서버 도구(입결·지식베이스·배치 저장)
                                           │   → 여기서 실행하고 다시 물어본다 (왕복 없음)
                                           └ 화면 도구
◀────── toolCalls (화면 도구만) ──────────     → 여기서 멈추고 브라우저에 넘긴다
도구 실행 → 결과를 turns 에 붙여 다시 요청 ─▶  …  (최대 16걸음)
```

**대화 상태(`turns`)는 브라우저가 들고 매 요청 통째로 보낸다.** 서버에 세션을 두면 탭을 두 개
열었을 때 서로를 덮어쓴다.

서버 도구가 브라우저를 거치지 않는 이유는 인증과 DB가 서버에만 있어서다. 그래서 입결을 세 번
뒤지는 상담이라도 브라우저 왕복은 한 번이다.

## 파일

| 파일 | 역할 |
|---|---|
| `store.js` | 화면이 자기 도구를 등록해 두는 모듈 전역. `global`(앱 껍데기) / `screen`(지금 화면) 두 칸. |
| `useAssistantAgent.js` | 등록용 훅. **의존성 배열이 없는 것은 의도한 것** — 매 렌더 다시 등록해야 도구가 최신 state 를 본다. |
| `flush.js` | 도구 하나를 실행한 뒤 리렌더·재등록을 기다린다(두 프레임 + 매크로태스크). |
| `useFloatingWindow.js` | 자리·크기·방향. 라이브러리 없이 pointer 이벤트로. 방향별로 따로 기억한다. |
| `useAppAgent.js` | 어디서나 되는 도구 — `get_screen` · `set_view` · `set_model`. |
| `useFormAgent.js` | '새 생기부 분석' 폼의 도구. |
| `../components/AssistantPanel.jsx` | 창·대화·도구 루프. |
| `../../../backend/services/assistantAgent.js` | 서버 쪽 한 걸음 루프(제공사 3사 규격 변환 포함). |
| `../../../backend/scripts/test-assistant.mjs` | `npm run test:assistant` — 진짜 키 없이 요청 본문을 검증한다. |

## 화면 하나에 도구를 붙이려면

```js
// src/assistant/useMyScreenAgent.js
import { useAssistantAgent } from './useAssistantAgent';

export function useMyScreenAgent({ state, setState }) {
  useAssistantAgent('screen', {
    key: 'myscreen',                    // 이게 바뀌면 도구 묶음이 갈린 것으로 본다
    title: '내 화면',
    describe: () => `[화면] … 지금 상태: ${state}`,   // 매 요청 새로 부른다
    examples: ['이렇게 시켜 보세요'],
    tools: [{
      name: 'do_something',
      description: '무엇을 하는 도구인지. 모델이 고르는 유일한 근거다.',
      schema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      confirm: ({ x }) => `${x} 로 진행할까요?`,      // 되돌리기 어려운 것만
      run: ({ x }) => { setState(x); return `${x} 로 바꿨습니다.`; },
    }],
  });
}
```

그리고 그 화면 컴포넌트에서 훅을 부르면 끝이다. 패널은 건드리지 않는다.

### 지킬 것

- **`run` 은 사람이 읽을 수 있는 한 줄을 돌려준다.** 그게 모델이 다음 판단을 하는 재료이고,
  대화창에 `↳` 로도 그대로 뜬다.
- **`describe()` 는 지금 상태를 사실대로.** 여기 없는 값은 모델이 지어내게 된다.
- **목록에서 골라야 하는 값은 `enum` 이나 설명에 목록을 박는다.** 안 그러면 목록에 없는
  전공·전형을 만들어 낸다(`useFormAgent` 의 `resolveFrom` 참고).
- **되돌리기 어렵거나 돈이 드는 도구에는 `confirm`.** 분석 시작, 저장, 삭제.
- **못 하는 일은 도구를 만들지 말고 `describe()` 에 못 한다고 적는다.** 파일 첨부가 그렇다 —
  파일 선택창은 사용자 제스처가 있어야 열려서 조교가 대신 하지 못한다.

## 다른 대화 화면(`view === 'chat'`)과의 관계

`ChatInterface.jsx` 는 분석 리포트를 놓고 길게 상담하고 **섹션 본문을 직접 고치는** 큰 화면이다.
떠 있는 조교는 그 화면의 서버 도구 세 개를 그대로 쓰면서 **화면 조작**까지 한다 — 즉 조교가
상위 집합이지만, 리포트를 길게 손보는 작업은 여전히 `chat` 화면이 편하다. 둘은 같은
`consultAgent.js` 도구 정의를 공유하므로 도구를 고치면 양쪽이 함께 따라온다.
