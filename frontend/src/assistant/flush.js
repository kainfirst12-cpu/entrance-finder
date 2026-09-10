/**
 * 도구 하나를 실행한 뒤, 다음 도구를 부르기 전에 리액트가 화면을 다시 그릴 틈을 준다.
 *
 * 왜 두 프레임인가: setState → 렌더 → **passive effect**(도구 재등록) 순서라, 한 프레임만
 * 기다리면 재등록 전이라 다음 도구가 옛 클로저를 잡는다. 마지막 setTimeout 은 매크로태스크로
 * 한 박자 더 미뤄, 이펙트 안에서 또 setState 하는 화면까지 따라잡게 한다.
 */
export function flush() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
  });
}
