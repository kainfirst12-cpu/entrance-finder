import { GoogleGenerativeAI } from '@google/generative-ai';
import pdfParse from 'pdf-parse';

const GEMINI_MODELS = {
  'gemini': ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite'],
  'gemini-pro': ['gemini-2.5-pro', 'gemini-2.5-flash'],
};

// PDF 텍스트 추출 (대용량 PDF 대비)
async function extractPdfTextsForGemini(pdfDocuments) {
  const texts = [];
  for (const pdf of pdfDocuments) {
    try {
      const buffer = Buffer.from(pdf.base64, 'base64');
      const data = await pdfParse(buffer);
      const extracted = data.text.slice(0, 25000);
      console.log(`[Gemini PDF] ${pdf.label}: ${data.text.length}자 추출 (전달: ${extracted.length}자)`);
      if (data.text.length < 50) {
        console.warn(`[Gemini PDF] ${pdf.label}: 텍스트가 거의 없음! 스캔 이미지 PDF일 가능성`);
      }
      texts.push(`[${pdf.label} 내용]\n${extracted}`);
    } catch (e) {
      console.error(`[Gemini PDF] ${pdf.label} 추출 실패:`, e.message);
      texts.push(`[${pdf.label}] PDF 텍스트 추출 실패`);
    }
  }
  return texts.join('\n\n');
}

// 대용량 PDF 임계값 (5MB base64 = ~3.75MB 원본)
const LARGE_PDF_THRESHOLD = 5 * 1024 * 1024;

async function callGemini(systemPrompt, userPrompt, maxTokens = 2000, apiKey, submodel = 'gemini', pdfDocuments = []) {
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelList = GEMINI_MODELS[submodel] || GEMINI_MODELS['gemini'];

  // PDF 처리: 항상 텍스트 추출 + 소형 PDF만 inlineData 사용
  let pdfText = '';
  if (pdfDocuments.length > 0) {
    pdfText = await extractPdfTextsForGemini(pdfDocuments);
  }

  const parts = [];

  // 소형 PDF만 inlineData로 전달 (대용량은 텍스트만)
  for (const pdf of pdfDocuments) {
    if (pdf.base64.length < LARGE_PDF_THRESHOLD) {
      parts.push({
        inlineData: {
          mimeType: 'application/pdf',
          data: pdf.base64,
        },
      });
      parts.push({ text: `[위 PDF는 "${pdf.label}" 파일입니다.]` });
      console.log(`[Gemini] ${pdf.label}: inlineData로 전달 (${(pdf.base64.length/1024/1024).toFixed(1)}MB)`);
    } else {
      console.log(`[Gemini] ${pdf.label}: 대용량(${(pdf.base64.length/1024/1024).toFixed(1)}MB) → 텍스트만 전달`);
    }
  }

  // 텍스트 추출 결과를 프롬프트에 포함
  const fullPrompt = pdfText
    ? `${systemPrompt}\n\n=== 첨부 PDF 내용 (반드시 읽고 분석에 활용하라) ===\n${pdfText}\n=== PDF 내용 끝 ===\n\n${userPrompt}`
    : `${systemPrompt}\n\n${userPrompt}`;
  parts.push({ text: fullPrompt });

  // 모델 폴백 + 재시도 로직
  for (const modelId of modelList) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const model = genAI.getGenerativeModel({ model: modelId });
        const result = await model.generateContent(parts);
        return result.response.text();
      } catch (err) {
        const status = err?.status || err?.message || '';
        console.warn(`[Gemini] ${modelId} attempt ${attempt + 1} failed:`, String(status).slice(0, 200));
        if (String(status).includes('500') || String(status).includes('503') || String(status).includes('Internal')) {
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }
        break;
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
${knowledgeBase.합격자사례 || '(자료 없음)'}

=== 보고서 구조 원칙 ===
- 각 단계 내에서 소제목 번호를 사용하라 (예: 1.1, 1.2, 2.1)
- 자기소개서 샘플 문구는 작성하지 마라. 방향성과 전략만 제시하라
- 면접 대응은 예상 질문과 답변 구조(키워드)만 제시하라`;

  const pdfNote = pdfDocuments.length > 0
    ? `\n[중요] 첨부된 PDF(${pdfDocuments.map(p=>p.label).join(', ')})를 반드시 직접 읽고 학생의 성적, 세특, 비교과 정보를 추출하여 분석에 활용하라. PDF에 있는 데이터를 무시하고 '데이터 부재'로 처리하지 마라.\n`
    : '';

  const steps = [
    { key: 'caseMatching', label: 'Drive 사례 매칭 탐색', step: 1,
      prompt: `${pdfNote}[0단계: AI 드라이브 사례 매칭 분석] 학생: ${studentData.name} / 희망전공: ${studentData.major} / 내신: ${studentData.gpa}등급 / 목표: ${studentData.targetUniv || '미입력'}

[매칭 규칙 — 반드시 준수]
1. **전공 계열 일치가 최우선이다.** 학생의 희망전공(${studentData.major})과 동일하거나 유사한 계열의 합격 사례만 매칭하라.
2. 희망전공과 무관한 계열(예: 사범/교육 학생에게 공학/의학/경제 사례)은 절대 매칭하지 마라.
3. 전공이 일치하는 사례가 없으면 가장 인접한 학문 계열까지 넓히되, 반드시 그 이유를 명시하라.
4. 그래도 유사한 사례가 없으면 "합격자 사례 DB에 해당 전공 관련 사례가 부족합니다"라고 솔직히 밝혀라. 억지로 무관한 사례를 매칭하지 마라.
5. 매칭 우선순위: 1순위-전공 계열 일치(40점), 2순위-내신 갭(30점), 3순위-전형 유형(15점), 4순위-비교과 유사성(15점)
6. 합산 100점 만점으로 유사도 %를 산출하라. 전공 불일치 시 유사도는 최대 30%를 넘을 수 없다.

[출력 형식]
매칭된 유사 합격 사례 TOP 3

| 구분 | 대학/학과 | 유사도 | 매칭 근거 및 시사점 |
|------|----------|--------|-------------------|
| CASE A | ... | XX% | 유사점: ... / 차이점: ... / 시사점: ... |
| CASE B | ... | XX% | 유사점: ... / 차이점: ... / 시사점: ... |
| CASE C | ... | XX% | 유사점: ... / 차이점: ... / 시사점: ... |

유사도 산정 기준:
- 희망 전공 일치: 40점
- 내신 성적 갭: 30점
- 전형 유형: 15점
- 비교과 유형: 15점
소제목 번호(0.1, 0.2, 0.3) 사용` },
    { key: 'academic', label: '학업역량 종합 분석', step: 2,
      prompt: `${pdfNote}[1단계: 학업역량 종합 분석] 학생 내신: ${studentData.gpa}등급 / 모의고사: ${studentData.mockExam || '미입력'}
첨부 PDF에서 성적과 세특을 직접 읽고 교과별 성취도와 세특 질적 수준을 합격자와 비교 분석하라.
소제목 1.1 내신 등급 비교표, 1.2 성적 추이 분석, 1.3 세특 질적 분석 구조로 작성
[출력 형식] 반드시 표로 정리:
| 교과 | 등급 | 세특 평가 | 합격자 대비 | 개선 방향 |
|------|------|----------|-----------|----------|` },
    { key: 'activity', label: '비교과 활동 평가', step: 3,
      prompt: `${pdfNote}[2단계: 비교과 활동 평가] 동아리: ${studentData.club} / 봉사: ${studentData.volunteer}
첨부 PDF에서 비교과 활동을 직접 읽고 진로 연계성과 깊이를 분석하라.
소제목 2.1~2.5 구조로 작성
[출력 형식] 활동별 표로 정리:
| 활동명 | 유형 | 진로 연계성 | 평가 | 보완 사항 |
|--------|------|-----------|------|----------|` },
    { key: 'career', label: '진로 역량 및 전공 적합성', step: 4,
      prompt: `${pdfNote}[3단계: 진로 역량 및 전공 적합성] 희망전공: ${studentData.major} / 목표대학: ${studentData.targetUniv}
첨부 PDF에서 진로 관련 내용을 읽고 전공 적합성과 진로 역량을 분석하라.
소제목 3.1~3.3 구조로 작성
[출력 형식] 표로 정리:
| 평가 영역 | 현재 수준 | 목표 수준 | 갭 분석 | 실행 방안 |
|-----------|----------|----------|--------|----------|` },
    { key: 'strategy', label: '수시 지원 전략 (6장 카드)', step: 5,
      prompt: `[4단계: 지원 전략 수립] 학생: 내신 ${studentData.gpa} / 목표 ${studentData.targetUniv} / ${studentData.major}
수시 6장 지원 전략을 수립하라.
[출력 형식 — 절대 준수: 반드시 마크다운 표(| |)로만 출력하라. 카드 형태, 블록쿼트(>), 들여쓰기 나열 금지.]

전형 유형 추천:
| 전형 유형 | 추천도 | 근거 |
|----------|--------|------|
| 학생부종합 | XX% | ... |
| 학생부교과 | XX% | ... |
| 논술 | XX% | ... |
| 정시 | XX% | ... |

수시 지원 카드 6장:
| 구분 | 대학 | 학과 | 전형 | 합격컷 | 현재 갭 | 합격 가능성 | 핵심 전략 |
|------|------|------|------|--------|--------|-----------|----------|
| 상향 1 | ... | ... | ... | ... | ... | XX% | ... |
| 상향 2 | ... | ... | ... | ... | ... | XX% | ... |
| 적정 1 | ... | ... | ... | ... | ... | XX% | ... |
| 적정 2 | ... | ... | ... | ... | ... | XX% | ... |
| 안정 1 | ... | ... | ... | ... | ... | XX% | ... |
| 안정 2 | ... | ... | ... | ... | ... | XX% | ... |

각 대학별 합격 조건과 핵심 전략을 간결히 서술.

핵심 리스크 분석:
| 리스크 | 심각도 | 대응 방안 |
|--------|--------|----------|` },
    { key: 'roadmap', label: '핵심 리스크 및 대응 방안', step: 6,
      prompt: `[5단계: 핵심 리스크 및 대응 방안] 학생: ${studentData.name} / ${studentData.grade}학년
핵심 리스크 3가지를 분석하고 대응 방안을 제시하라. 5.1~5.4 소제목 구조, 리스크별 상세/우려사항/대응방안/면접대응 포함. 자소서 샘플 문구 제외.` },
    { key: 'recordFeedback', label: '실행 계획', step: 7,
      prompt: `[6단계: 실행 계획] 학생: ${studentData.name} / ${studentData.grade}학년
3학년 실행 계획을 수립하라. 6.1 월별 실행 계획(3~8월, 주차별 표), 6.2 성적 목표 및 관리 전략(표), 6.3 비교과 활동 체계화, 6.4 독서 및 탐구 계획(표)` },
    { key: 'dashboard', label: '종합 평가 및 권고사항', step: 8,
      prompt: `[7단계: 종합 평가 및 권고사항] 지금까지 분석 결과를 종합하여 종합 평가를 작성하라.
7.1 5개 영역 평가표(학업/비교과/진로/세특/전공적합성, 10점 척도), 합격 가능성 분석. 7.2 즉시 실행 과제 3가지 + 유지 강점. 7.3 차기 상담 일정. 7.4 맺음말` },
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
