import OpenAI from 'openai';
import pdfParse from 'pdf-parse';

const GPT_MODELS = {
  'gpt': 'gpt-4o',
  'gpt-mini': 'gpt-4o-mini',
  'gpt-4.1': 'gpt-4.1',
  'o3': 'o3',
  'o4-mini': 'o4-mini',
};

async function extractPdfTexts(pdfDocuments) {
  const texts = [];
  for (const pdf of pdfDocuments) {
    try {
      const buffer = Buffer.from(pdf.base64, 'base64');
      const data = await pdfParse(buffer);
      texts.push(`[${pdf.label} 내용]\n${data.text.slice(0, 25000)}`);
    } catch (e) {
      texts.push(`[${pdf.label}] PDF 텍스트 추출 실패`);
    }
  }
  return texts.join('\n\n');
}

async function callGPT(systemPrompt, userPrompt, maxTokens = 2000, apiKey, submodel = 'gpt', pdfDocuments = []) {
  const openai = new OpenAI({ apiKey });
  const modelId = GPT_MODELS[submodel] || GPT_MODELS['gpt'];
  const isReasoningModel = modelId.startsWith('o3') || modelId.startsWith('o4');

  // PDF 텍스트 (서버에서 미리 추출된 텍스트 사용, 없으면 직접 추출)
  let pdfContext = '';
  const preText = pdfDocuments[0]?.preExtractedText || '';
  if (preText) {
    pdfContext = `\n\n=== 첨부 PDF 내용 (AI가 반드시 읽고 분석할 것) ===\n${preText}\n===\n\n`;
    console.log(`[GPT] PDF 텍스트 ${preText.length}자 사용`);
  } else if (pdfDocuments.length > 0) {
    const extracted = await extractPdfTexts(pdfDocuments);
    pdfContext = `\n\n=== 첨부 PDF 내용 (AI가 반드시 읽고 분석할 것) ===\n${extracted}\n===\n\n`;
  }

  // PDF 이미지가 있으면 vision 모드로 전달
  const hasImages = pdfDocuments.some(pdf => pdf.images?.length > 0);

  if (hasImages) {
    const contentParts = [];
    for (const pdf of pdfDocuments) {
      if (pdf.images?.length > 0) {
        contentParts.push({ type: 'text', text: `[${pdf.label} — ${pdf.images.length}페이지]` });
        for (const imgBase64 of pdf.images) {
          contentParts.push({
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${imgBase64}`, detail: 'high' },
          });
        }
      }
    }
    contentParts.push({ type: 'text', text: pdfContext + userPrompt });
    console.log(`[GPT] 이미지 모드: ${pdfDocuments.reduce((s, p) => s + (p.images?.length || 0), 0)}페이지`);

    const imgParams = {
      model: modelId,
      messages: [
        { role: isReasoningModel ? 'developer' : 'system', content: systemPrompt },
        { role: 'user', content: contentParts },
      ],
    };
    if (isReasoningModel) {
      imgParams.max_completion_tokens = maxTokens;
    } else {
      imgParams.max_tokens = maxTokens;
    }
    const response = await openai.chat.completions.create(imgParams);
    return response.choices[0].message.content;
  }

  const params = {
    model: modelId,
    messages: [
      { role: isReasoningModel ? 'developer' : 'system', content: systemPrompt },
      { role: 'user', content: pdfContext + userPrompt },
    ],
  };
  if (isReasoningModel) {
    params.max_completion_tokens = maxTokens;
  } else {
    params.max_tokens = maxTokens;
  }
  const response = await openai.chat.completions.create(params);
  return response.choices[0].message.content;
}

export async function runFullAnalysisGPT(studentData, knowledgeBase, studentDriveFiles, progressCallback, pdfDocuments, apiKey, submodel = 'gpt') {
  const onProgress = progressCallback;
  const results = {};

  const systemPrompt = `당신은 대한민국 최고 수준의 입시 전문 컨설턴트입니다.

[출력 형식 원칙 — 최우선 준수]
- 이모티콘, 이모지, 유니코드 특수기호를 절대 사용하지 마라 (예: 📊🔍✅❌🎯📚🏃✏️☁️🗓️💬🚨⚠️👍👎🔴🟡🟢📌✨🚀 등 모든 이모지/이모티콘 금지)
- 노션 스타일 아이콘 절대 금지
- 허용되는 기호: 번호(1. 2. 3.), 기호(-, *, >), 대괄호([항목]), 구분선(──), 표 구분(|)만 사용
- 강조는 **볼드**만 사용하고 이모지로 강조하지 마라
- 전문 컨설팅 보고서 톤을 유지하되, 출력 문체는 반드시 '~합니다', '~됩니다', '~있습니다' 같은 합니다체(격식체)를 사용하라. 반말(~하다, ~이다, ~한다, ~된다, ~임, ~함)이나 명령체(~하라, ~마라)로 출력하지 마라

[표 형식 출력 원칙 — 필수]
- 분석 결과는 가능한 한 마크다운 표(| 항목 | 내용 |) 형태로 정리하라
- 평가 항목, 점수, 분석 내용, 개선 방향 등을 표로 구분하라
- 나열식 설명보다 표로 구조화된 정보를 우선하라
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
${knowledgeBase.합격자사례 || '(자료 없음)'}

=== 보고서 구조 원칙 ===
- 각 단계 내에서 소제목 번호를 사용하라 (예: 1.1, 1.2, 2.1)
- 자기소개서(자소서)는 2025학년도부터 대입에서 완전 폐지되었으므로 자소서 관련 내용을 절대 언급하지 마라
- 면접 대응은 예상 질문과 답변 구조(키워드)만 제시하라`;

  const pdfNote = pdfDocuments.length > 0
    ? `\n[중요] 위에 첨부된 PDF 내용을 반드시 읽고 학생의 성적, 세특, 비교과 정보를 추출하여 분석에 활용하라. PDF에 있는 데이터를 무시하고 '데이터 부재'로 처리하지 마라.\n`
    : '';

  const steps = [
    { key: 'caseMatching', label: 'Drive 사례 매칭 탐색', step: 1,
      prompt: `${pdfNote}[0단계: AI 드라이브 사례 매칭 분석]

=== 학생 핵심 정보 (절대 변경 금지) ===
- 학생명: ${studentData.name}
- 희망전공: **${studentData.major}**
- 목표대학: **${studentData.targetUniv || '미입력'}**
- 내신: ${studentData.gpa}등급
=== 끝 ===

[절대 규칙 — 위반 시 분석 무효]
- 매칭할 합격 사례는 반드시 "${studentData.major}" 또는 동일 계열 학과여야 한다.
- "${studentData.targetUniv}" 합격 사례를 최우선으로 찾아라.
- 전혀 다른 전공을 매칭하면 분석 실패이다.

[매칭 규칙]
1. "${studentData.major}"과 동일하거나 직접 관련된 학과만 매칭하라.
2. 동일 전공 사례가 없으면 인접 계열까지만 넓히되 이유를 명시하라.
3. 사례가 없으면 솔직히 밝혀라.
4. 매칭 우선순위: 전공 학과 일치(50점), 대학 일치(20점), 내신 갭(20점), 전형(10점)
5. 전공 불일치 시 유사도 최대 20%.

[출력 형식]
매칭된 유사 합격 사례 TOP 3
| 구분 | 대학/학과 | 유사도 | 매칭 근거 |
소제목 번호(0.1, 0.2, 0.3) 사용` },
    { key: 'academic', label: '학업역량 종합 분석', step: 2,
      prompt: `${pdfNote}[1단계: 학업역량 종합 분석] 학생 내신: ${studentData.gpa}등급 / 모의고사: ${studentData.mockExam || '미입력'}\n첨부 PDF에서 성적과 세특을 직접 읽고 교과별 성취도와 세특 질적 수준을 합격자와 비교 분석하라.\n소제목 1.1 내신 등급 비교표, 1.2 성적 추이 분석, 1.3 세특 질적 분석 구조로 작성` },
    { key: 'activity', label: '비교과 활동 평가', step: 3,
      prompt: `${pdfNote}[2단계: 비교과 활동 평가] 동아리: ${studentData.club} / 봉사: ${studentData.volunteer}\n첨부 PDF에서 비교과 활동을 직접 읽고 진로 연계성과 깊이를 분석하라.\n소제목 2.1~2.5 구조로 작성` },
    { key: 'career', label: '진로 역량 및 전공 적합성', step: 4,
      prompt: `${pdfNote}[3단계: 진로 역량 및 전공 적합성] 희망전공: ${studentData.major} / 목표대학: ${studentData.targetUniv}\n첨부 PDF에서 진로 관련 내용을 읽고 전공 적합성과 진로 역량을 분석하라.\n소제목 3.1~3.3 구조로 작성` },
    { key: 'strategy', label: '수시 지원 전략 (6장 카드)', step: 5,
      prompt: `[4단계: 지원 전략 수립] 학생: 내신 ${studentData.gpa} / 목표 ${studentData.targetUniv} / ${studentData.major}
수시 6장 지원 전략을 수립하라.
[출력 형식 — 절대 준수: 반드시 마크다운 표(| |)로만 출력하라. 카드 형태, 블록쿼트(>), 들여쓰기 나열 금지.]

전형 유형 추천:
| 전형 유형 | 추천도 | 근거 |
|----------|--------|------|

수시 지원 카드 6장:
| 구분 | 대학 | 학과 | 전형 | 합격컷 | 현재 갭 | 합격 가능성 | 핵심 전략 |
|------|------|------|------|--------|--------|-----------|----------|
| 상향 1~2, 적정 1~2, 안정 1~2 |

각 대학별 합격 조건과 핵심 전략을 간결히 서술.

핵심 리스크 분석:
| 리스크 | 심각도 | 대응 방안 |
|--------|--------|----------|` },
    { key: 'roadmap', label: '핵심 리스크 및 대응 방안', step: 6,
      prompt: `[5단계: 핵심 리스크 및 대응 방안] 학생: ${studentData.name} / ${studentData.grade}학년\n핵심 리스크 3가지를 분석하고 대응 방안을 제시하라. 5.1~5.4 소제목 구조, 리스크별 상세/우려사항/대응방안/면접대응 포함. 자소서는 폐지됨 — 언급 금지.` },
    { key: 'recordFeedback', label: '실행 계획', step: 7,
      prompt: `[6단계: 실행 계획] 학생: ${studentData.name} / ${studentData.grade}학년\n3학년 실행 계획을 수립하라. 6.1 월별 실행 계획(3~8월, 주차별 표), 6.2 성적 목표 및 관리 전략(표), 6.3 비교과 활동 체계화, 6.4 독서 및 탐구 계획(표)` },
    { key: 'dashboard', label: '종합 평가 및 권고사항', step: 8,
      prompt: `[7단계: 종합 평가 및 권고사항] 지금까지 분석 결과를 종합하여 종합 평가를 작성하라.\n7.1 5개 영역 평가표(학업/비교과/진로/세특/전공적합성, 10점 척도), 합격 가능성 분석. 7.2 즉시 실행 과제 3가지 + 유지 강점. 7.3 차기 상담 일정. 7.4 맺음말` },
  ];

  // 이미지 없는 경량 pdfDocuments (단계 3+ 에서 사용)
  const pdfDocsLight = pdfDocuments.map(pdf => ({
    label: pdf.label,
    base64: pdf.base64,
    preExtractedText: pdf.preExtractedText,
  }));

  for (const s of steps) {
    onProgress?.({ step: s.step, label: `${s.label} 중...` });
    // step 1(사례매칭)만 이미지 포함, 나머지 텍스트만 (타임아웃 방지)
    const docs = s.step === 1 ? pdfDocuments : pdfDocsLight;
    results[s.key] = await callGPT(systemPrompt, s.prompt, 16000, apiKey, submodel, docs);
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