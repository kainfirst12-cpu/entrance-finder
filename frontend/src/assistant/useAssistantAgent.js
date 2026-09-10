import { useEffect } from 'react';
import { setAgent, clearAgent } from './store';

/**
 * 이 화면의 도구를 조교에게 등록한다.
 *
 * @param {'global'|'screen'} slot
 * @param {{
 *   key: string,                 // 화면을 가리키는 이름. 이게 바뀌면 도구 묶음이 갈린 것으로 본다.
 *   title?: string,
 *   describe?: () => string,     // 지금 화면 상태를 글로. 매 요청 새로 부른다.
 *   tools?: Array<{ name, description, schema?, confirm?, run }>,
 *   examples?: string[],
 * }} agent
 *
 * ⚠ 첫 useEffect 에 의존성 배열이 없는 것은 실수가 아니다.
 *   매 렌더 다시 등록해야 도구 안의 클로저가 **최신 state** 를 본다.
 *   배열을 달면 "지문 넣고 바로 생성"이 옛 목록으로 돈다(다른 앱에서 실제로 겪은 함정).
 */
export function useAssistantAgent(slot, agent) {
  useEffect(() => { setAgent(slot, agent); });
  useEffect(() => () => clearAgent(slot, agent.key), [slot, agent.key]);
}
