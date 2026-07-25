// 리포트 공통 유틸 — 세 엔진(claude/gpt/gemini)이 함께 사용한다.

// 마크다운 강조 기호(**, ***) 제거.
// 리포트에 **이렇게** 남으면 기계가 쓴 티가 나므로, 프롬프트로 막고 출력에서도 한 번 더 걷어낸다.
// 표(|)·목록(-)·헤더(#)는 그대로 두고 강조 기호만 없앤다.
export function stripBoldMarkers(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/\*\*\*([\s\S]+?)\*\*\*/g, '$1')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/\*\*/g, '');   // 짝이 안 맞고 남은 것까지 정리
}

// 실행 계획 시작 시점(YYYY-MM) → 그 달부터 n개월의 라벨 배열.
// 예) '2026-09', 6 → ['2026년 9월','2026년 10월','2026년 11월','2026년 12월','2027년 1월','2027년 2월']
// 생기부는 1학년치라도 상담 시점이 2학년 2학기면 3월이 아니라 9월부터 계획을 잡아야 하므로 시작월을 받는다.
export function buildPlanMonths(startYm, n = 6) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(startYm || '').trim());
  const now = new Date();
  let year = m ? Number(m[1]) : now.getFullYear();
  let month = m ? Number(m[2]) : now.getMonth() + 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(`${year}년 ${month}월`);
    month++;
    if (month > 12) { month = 1; year++; }
  }
  return out;
}

// 내신 등급제 — 2028학년도 대입부터 5등급제, 그 이전(2027학년도까지)은 9등급제.
// 학생마다 적용 체계가 다르므로 분석·목표등급·지원전략을 그 체계에 맞춰 쓰게 한다.
export function gradeSystemGuide(gradeSystem) {
  const five = String(gradeSystem || '').includes('5');
  if (five) {
    return [
      '=== 내신 등급 체계 (필수 준수) ===',
      '- 이 학생은 5등급제(2028학년도 대입 이후) 적용 대상이다.',
      '- 모든 등급 표기·목표 등급·지원 가능선은 반드시 1~5등급 체계로 쓰라. 6~9등급은 존재하지 않으므로 절대 쓰지 마라.',
      '- 5등급제 비율(1등급 10%, 2등급 24%, 3등급 32%, 4등급 24%, 5등급 10%)을 기준으로 해석하라.',
      '- 9등급제 기준의 컷·환산·표현(예: "1.5등급대", "2등급 후반")을 5등급제 학생에게 그대로 적용하지 마라.',
      '- 5등급제는 변별력이 낮아 교과 성적만으로 줄세우기가 어렵다는 점을 고려해, 세특·탐구의 질과 면접 비중을 상대적으로 더 무겁게 평가하라.',
    ].join('\n');
  }
  return [
    '=== 내신 등급 체계 (필수 준수) ===',
    '- 이 학생은 9등급제(2027학년도 대입까지) 적용 대상이다.',
    '- 모든 등급 표기·목표 등급·지원 가능선은 1~9등급 체계로 쓰라.',
    '- 9등급제 비율(1등급 4%, 2등급 11%, 3등급 23%, 4등급 40% 누적)을 기준으로 해석하라.',
    '- 5등급제(2028학년도 이후) 기준을 이 학생에게 적용하지 마라.',
  ].join('\n');
}

// 학생 기준 정보 블록 — 시스템 프롬프트에 붙여 모든 단계가 같은 전제로 쓰게 한다.
export function studentContextBlock(studentData = {}) {
  const months = buildPlanMonths(studentData.planStartYm, 6);
  return [
    '',
    gradeSystemGuide(studentData.gradeSystem),
    '',
    '=== 실행 계획 기준 시점 (필수 준수) ===',
    `- 상담 시점 기준으로 실행 계획은 ${months[0]}부터 시작한다.`,
    `- 월별 계획 표의 행은 정확히 다음 순서로 쓰라: ${months.join(' → ')}`,
    '- 이미 지난 달(예: 3월)로 계획을 잡지 마라. 생기부 기록이 지난 학년 것이어도 계획은 위 시점부터 세운다.',
  ].join('\n');
}
