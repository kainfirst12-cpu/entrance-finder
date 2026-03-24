import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_MODELS = {
  'gemini': ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite'],
  'gemini-pro': ['gemini-2.5-pro', 'gemini-2.5-flash'],
};

async function callGemini(systemPrompt, userPrompt, maxTokens = 2000, apiKey, submodel = 'gemini', pdfDocuments = []) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelList = GEMINI_MODELS[submodel] || GEMINI_MODELS['gemini'];

  // PDF가 있으면 inline_data로 포함
  const parts = [];
  for (const pdf of pdfDocuments) {
    parts.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: pdf.base64,
      },
    });
    parts.push({ text: `[위 PDF는 "${pdf.label}" 파일입니다. 이 내용을 반드시 읽고 분석에 활용하세요.]` });
  }
  parts.push({ text: `${systemPrompt}\n\n${userPrompt}` });

  // 모델 폴백 + 재시도 로직
  for (const modelId of modelList) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent(parts);
        return result.response.text();
      } catch (err) {
        const status = err?.status || err?.message || '';
        console.warn(`[Gemini] ${modelId} attempt ${attempt + 1} failed:`, String(status).slice(0, 100));
        // 500/503 에러면 1.5초 후 재시도
        if (String(status).includes('500') || String(status).includes('503') || String(status).includes('Internal')) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        break; // 다른 에러(401, 404 등)는 재시도 불필요
      }
    }
  }
  throw new Error('모든 Gemini 모델이 실패했습니다. 잠시 후 다시 시도해주세요.');
}

export async function runFullAnalysisGemini(studentData, knowledgeBase, studentDriveFiles, progressCallback, pdfDocuments, apiKey) {
  const onProgress = progressCallback;
  const results = {};

  const systemPrompt = `당신은 대한민국 최고 수준의 입시 전문 컨설턴트입니다.

[출력 형식 원칙 — 최우선 준수]
- 이모티콘, 이모지, 유니코드 특수기호를 절대 사용하지 마라 (예: 📊🔍✅❌🎯📚🏃✏️☁️🗓️💬🚨⚠️👍👎🔴🟡🟢📌✨🚀 등 모든 이모지/이모티콘 금지)
- 노션 스타일 아이콘 절대 금지
- 허용되는 기호: 번호(1. 2. 3.), 기호(-, *, >), 대괄호([항목]), 구분선(──), 표 구분(|)만 사용
- 강조는 **볼드**만 사용하고 이모지로 강조하지 마라
- 전문 컨설팅 보고서 톤을 유지하라

[표 형식 출력 원칙 — 필수]
- 분석 결과는 가능한 한 **마크다운 표(| 항목 | 내용 |)** 형태로 정리하라
- 평가 항목, 점수, 분석 내용, 개선 방향 등을 표로 구분하라
- 나열식 설명보다 표로 구조화된 정보를 우선하라
- 표 예시:
  | 평가 항목 | 현재 수준 | 분석 | 개선 방향 |
  |-----------|-----------|------|-----------|
  | 내신 성적 | 2.3등급 | 상위권 | 1등급 진입 필요 |
- 긴 서술이 필요한 경우에만 문단 형태를 사용하되, 핵심은 반드시 표로 요약하라

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

  const pdfNote = pdfDocuments.length > 0
    ? `\n[중요] 첨부된 PDF(${pdfDocuments.map(p=>p.label).join(', ')})를 반드시 직접 읽고 학생의 성적, 세특, 비교과 정보를 추출하여 분석에 활용하라. PDF에 있는 데이터를 무시하고 '데이터 부재'로 처리하지 마라.\n`
    : '';

  const steps = [
    { key: 'caseMatching', label: 'Drive 사례 매칭 탐색', step: 1,
      prompt: `${pdfNote}[0단계: Drive 사례 매칭] 학생: ${studentData.name} / 희망전공: ${studentData.major} / 내신: ${studentData.gpa}등급
합격자 사례에서 가장 유사한 사례 3건을 찾아 분석하라.
[출력 형식] 각 사례를 표로 정리:
| 항목 | 내용 |
|------|------|
| 대학/전형 | ... |
| 합격자 내신 | ... |
| 현재 학생과 갭 | ... |
| 합격 가능성 | ... |
| 핵심 조건 | ... |` },
    { key: 'academic', label: '학업역량 분석', step: 2,
      prompt: `${pdfNote}[1단계: 학업역량 심층 분석] 학생 내신: ${studentData.gpa}등급 / 모의고사: ${studentData.mockExam || '미입력'}
첨부 PDF에서 성적과 세특을 직접 읽고 교과별 성취도와 세특 질적 수준을 합격자와 비교 분석하라.
[출력 형식] 반드시 표로 정리:
| 교과 | 등급 | 세특 평가 | 합격자 대비 | 개선 방향 |
|------|------|----------|-----------|----------|` },
    { key: 'activity', label: '비교과 활동 분석', step: 3,
      prompt: `${pdfNote}[2단계: 비교과 활동 분석] 동아리: ${studentData.club} / 봉사: ${studentData.volunteer}
첨부 PDF에서 비교과 활동을 직접 읽고 진로 연계성과 깊이를 분석하라.
[출력 형식] 활동별 표로 정리:
| 활동명 | 유형 | 진로 연계성 | 평가 | 보완 사항 |
|--------|------|-----------|------|----------|` },
    { key: 'career', label: '진로 역량 분석', step: 4,
      prompt: `${pdfNote}[3단계: 진로 역량 분석] 희망전공: ${studentData.major} / 목표대학: ${studentData.targetUniv}
첨부 PDF에서 진로 관련 내용을 읽고 전공 적합성과 진로 역량을 분석하라.
[출력 형식] 표로 정리:
| 평가 영역 | 현재 수준 | 목표 수준 | 갭 분석 | 실행 방안 |
|-----------|----------|----------|--------|----------|` },
    { key: 'strategy', label: '지원 전략 수립', step: 5,
      prompt: `[4단계: 지원 전략 수립] 학생 종합 정보: ${JSON.stringify(studentData)}
수시 6장 지원 전략을 수립하라.
[출력 형식] 각 지원 대학을 표로 정리:
| 순위 | 대학 | 전형 | 합격컷 | 현재 갭 | 합격 가능성 | 핵심 전략 |
|------|------|------|--------|--------|-----------|----------|
상향/적정/안정을 명확히 구분하라.` },
    { key: 'roadmap', label: '3년 로드맵 생성', step: 6,
      prompt: `[5단계: 3년 로드맵] 학생: ${studentData.name} / ${studentData.grade}학년
고3까지의 구체적 실행 로드맵을 작성하라.
[출력 형식] 학기별 표로 정리:
| 시기 | 학업 목표 | 비교과 활동 | 세특 전략 | 체크포인트 |
|------|----------|-----------|----------|----------|` },
    { key: 'recordFeedback', label: '세특 개선안 작성', step: 7,
      prompt: `[6단계: 세특 개선안] 학생 특기사항: ${studentData.specialNotes || '미입력'}
교과별 세특 개선안을 작성하라.
[출력 형식 — 필수] 각 교과별로 Before/After를 비교 표로 작성:

### [교과명] 세특 개선

| 구분 | 내용 |
|------|------|
| Before (현재) | 현재 세특 원문 요약 |
| → 문제점 | 구체적 문제 분석 |
| After (개선) | 개선된 세특 전문 |
| → 개선 포인트 | 1) ... 2) ... 3) ... |

Before와 After의 차이가 명확하게 드러나도록 작성하라. 개선 포인트는 번호 매겨서 구체적으로.` },
    { key: 'dashboard', label: '종합 대시보드 생성', step: 8,
      prompt: `[7단계: 종합 대시보드] 지금까지 분석 결과를 종합하여 최종 평가 대시보드를 생성하라.
[출력 형식] 종합 평가를 표로 정리:
| 평가 영역 | 점수(10점) | 평가 | 핵심 코멘트 |
|-----------|-----------|------|-----------|
| 학업역량 | /10 | ... | ... |
| 비교과 | /10 | ... | ... |
| 진로적합성 | /10 | ... | ... |
| 전공적합성 | /10 | ... | ... |
| 서류경쟁력 | /10 | ... | ... |
최종 합격 가능성과 핵심 액션 아이템도 표로 정리하라.` },
  ];

  for (const s of steps) {
    onProgress?.({ step: s.step, label: `${s.label} 중...` });
    results[s.key] = await callGemini(systemPrompt, s.prompt, 8000, apiKey, 'gemini', pdfDocuments);
  }

  onProgress?.({ step: 8, label: '분석 완료!' });
  return results;
}

export async function testGeminiConnection(apiKey) {
  const modelList = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite'];
  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelId of modelList) {
    try {
      const model = genAI.getGenerativeModel({ model: modelId });
      const result = await model.generateContent('안녕하세요. 연결 테스트입니다. "연결성공"이라고만 답하세요.');
      return result.response.text();
    } catch {
      continue;
    }
  }
  throw new Error('모든 Gemini 모델 연결 실패');
}
