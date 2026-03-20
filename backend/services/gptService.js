import OpenAI from 'openai';

const GPT_MODELS = {
  'gpt': 'gpt-4o',
  'gpt-mini': 'gpt-4o-mini',
};

async function callGPT(systemPrompt, userPrompt, maxTokens = 2000, apiKey, submodel = 'gpt') {
  const openai = new OpenAI({ apiKey });
  const modelId = GPT_MODELS[submodel] || GPT_MODELS['gpt'];
  const response = await openai.chat.completions.create({
    model: modelId,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });
  return response.choices[0].message.content;
}

export async function runFullAnalysisGPT(studentData, knowledgeBase, studentDriveFiles, progressCallback, pdfDocuments, apiKey) {
  const onProgress = progressCallback;
  const results = {};

  const systemPrompt = `당신은 대한민국 최고 수준의 입시 전문 컨설턴트입니다.

[출력 형식 원칙 — 최우선 준수]
- 이모티콘, 이모지, 유니코드 특수기호를 절대 사용하지 마라 (예: 📊🔍✅❌🎯📚🏃✏️☁️🗓️💬🚨⚠️👍👎🔴🟡🟢📌✨🚀 등 모든 이모지/이모티콘 금지)
- 노션 스타일 아이콘 절대 금지
- 허용되는 기호: 번호(1. 2. 3.), 기호(-, *, >), 대괄호([항목]), 구분선(──), 표 구분(|)만 사용
- 강조는 **볼드**만 사용하고 이모지로 강조하지 마라
- 전문 컨설팅 보고서 톤을 유지하라

[분석 원칙]
- 학생의 희망 전공을 절대 혼동하지 마라 — 모든 분석은 반드시 학생이 입력한 희망 전공 기준으로 작성
- 데이터 부재 시 0점 처리가 아닌 '데이터 부재로 평가 불가'로 명시
- 합격자 컷라인, 합격률 등 수치는 출처 또는 기준연도 명시. 근거 없는 수치 금지
- 근거 없는 희망적 분석 금지 — 현실적이고 냉정하게 평가

=== 지식베이스 - 대입정책 ===
${knowledgeBase.대입정책 || '(자료 없음)'}
=== 지식베이스 - 대학별전형 ===
${knowledgeBase.대학별전형 || '(자료 없음)'}
=== 합격자 사례 ===
${knowledgeBase.합격자사례 || '(자료 없음)'}`;

  const steps = [
    { key: 'caseMatching', label: 'Drive 사례 매칭 탐색', step: 1,
      prompt: `[0단계] 학생: ${studentData.name} / 희망전공: ${studentData.major} / 내신: ${studentData.gpa}등급\n합격자 사례에서 가장 유사한 사례 3건을 찾아 분석하라.` },
    { key: 'academic', label: '학업역량 분석', step: 2,
      prompt: `[1단계] 학생 내신: ${studentData.gpa}등급 / 모의고사: ${studentData.mockExam || '미입력'}\n교과별 성취도와 세특 질적 수준을 합격자와 비교 분석하라.` },
    { key: 'activity', label: '비교과 활동 분석', step: 3,
      prompt: `[2단계] 동아리: ${studentData.club} / 봉사: ${studentData.volunteer}\n비교과 활동의 진로 연계성과 깊이를 분석하라.` },
    { key: 'career', label: '진로 역량 분석', step: 4,
      prompt: `[3단계] 희망전공: ${studentData.major} / 목표대학: ${studentData.targetUniv}\n전공 적합성과 진로 역량을 분석하라.` },
    { key: 'strategy', label: '지원 전략 수립', step: 5,
      prompt: `[4단계] 학생 종합 정보: ${JSON.stringify(studentData)}\n수시 6장 지원 전략을 수립하라.` },
    { key: 'roadmap', label: '3년 로드맵 생성', step: 6,
      prompt: `[5단계] 학생: ${studentData.name} / ${studentData.grade}학년\n고3까지의 구체적 실행 로드맵을 작성하라.` },
    { key: 'recordFeedback', label: '세특 개선안 작성', step: 7,
      prompt: `[6단계] 학생 특기사항: ${studentData.specialNotes || '미입력'}\n교과별 세특 개선안을 작성하라.` },
    { key: 'dashboard', label: '종합 대시보드 생성', step: 8,
      prompt: `[7단계] 지금까지 분석 결과를 종합하여 최종 평가 대시보드를 생성하라.` },
  ];

  for (const s of steps) {
    onProgress?.({ step: s.step, label: `${s.label} 중...` });
    results[s.key] = await callGPT(systemPrompt, s.prompt, 8000, apiKey);
  }

  onProgress?.({ step: 8, label: '분석 완료!' });
  return results;
}

export async function testGPTConnection(apiKey) {
  const openai = new OpenAI({ apiKey });
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 20,
    messages: [{ role: 'user', content: '안녕하세요. "연결성공"이라고만 답하세요.' }],
  });
  return response.choices[0].message.content;
}