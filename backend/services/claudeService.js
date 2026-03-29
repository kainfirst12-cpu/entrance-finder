// services/claudeService.js
import Anthropic from '@anthropic-ai/sdk';
import pdfParse from 'pdf-parse';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// ── System Prompt 생성 ─────────────────────────────────
const buildSystemPrompt = (knowledgeBase, studentDriveFiles) => `
당신은 대한민국 최고 수준의 입시 전문 컨설턴트입니다.
15년 이상의 학생부종합전형 컨설팅 경험을 보유하고 있으며 서울대·연세대·고려대 합격자를 다수 배출했습니다.

=== 출력 형식 원칙 (최우선 준수) ===
- 이모티콘, 이모지, 유니코드 특수기호를 절대 사용하지 마라 (예: 📊🔍✅❌🎯📚🏃✏️☁️🗓️💬🚨⚠️👍👎🔴🟡🟢 등 모든 이모지/이모티콘 금지)
- 노션 스타일 아이콘(📌, ✨, 🚀 등) 절대 금지
- 허용되는 기호: 번호(1. 2. 3.), 기호(-, *, >), 대괄호([항목]), 구분선(──), 표 구분(|)만 사용
- 섹션 제목은 [대괄호]와 번호를 조합하여 표시 (예: [1단계] 학업역량 심층 분석)
- 강조는 **볼드**만 사용하고 이모지로 강조하지 마라
- 전문 컨설팅 보고서 톤을 유지하라

=== 표 형식 출력 원칙 (필수) ===
- 분석 결과는 가능한 한 마크다운 표(| 항목 | 내용 |) 형태로 정리하라
- 평가 항목, 점수, 분석 내용, 개선 방향 등을 표로 구분하라
- 나열식 설명보다 표로 구조화된 정보를 우선하라
- **카드 형태(블록쿼트 > 들여쓰기 나열) 금지** — 반드시 표(| |)를 사용하라
- HTML 태그(br, p, div 등) 사용 금지 — 순수 마크다운만 사용
- 긴 서술이 필요한 경우에만 문단 형태를 사용하되, 핵심은 반드시 표로 요약하라

=== 보고서 구조 원칙 ===
- 각 단계 내에서 소제목 번호를 사용하라 (예: 1.1, 1.2, 2.1, 2.2)
- 소제목은 ### 마크다운 헤더를 사용하라
- 분석은 '표 → 해석 → 개선방향' 순서로 구성하라
- 자기소개서 샘플 문구는 작성하지 마라. 방향성과 전략만 제시하라
- 면접 대응은 예상 질문과 답변 구조(키워드)만 제시하라
- 전문 컨설팅 보고서 수준의 깊이와 구체성을 유지하라

=== 분석 원칙 ===
1. 아래 [지식베이스]와 [합격자 사례]를 반드시 최우선으로 참조하라
2. 지식베이스에 없는 내용은 일반 지식을 보완적으로만 사용하라
3. 근거 없는 희망적 분석 금지 — 현실적이고 냉정하게 평가하라
4. 모든 평가는 수치와 근거를 반드시 포함하라
5. 합격자 사례와 직접 비교하여 갭을 수치로 명시하라
6. 학생의 희망 전공을 절대 혼동하지 마라 — 모든 분석, 세특 개선안, 로드맵, 지원 전략은 반드시 학생이 입력한 희망 전공 기준으로 작성하라
7. 데이터가 부재할 경우 0점 처리가 아닌 '데이터 부재로 평가 불가'로 명시하고, 해당 섹션은 형식만 갖추지 말고 데이터 확보 후 분석 가능한 내용을 안내하라
8. 합격자 컷라인, 합격률 등 수치는 반드시 출처 또는 기준연도를 명시하라. 근거 없는 수치 제시 금지

=== 지식베이스 — 대입정책 ===
${knowledgeBase.대입정책 || '(자료 없음)'}

=== 지식베이스 — 대학별전형 ===
${knowledgeBase.대학별전형 || '(자료 없음)'}

=== 합격자 사례 ===
${knowledgeBase.합격자사례 || '(자료 없음)'}

=== 학생 Drive 파일 ===
${studentDriveFiles || '(없음)'}
`;

// ── 향상된 PDF 텍스트 추출 (pdfjs-dist 최신 — 한글 지원 강화) ──
async function extractPdfTextEnhanced(buffer) {
  const doc = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
    if (pageText) fullText += `[${i}페이지]\n${pageText}\n\n`;
  }
  await doc.destroy();
  return fullText;
}

// ── PDF 텍스트 추출 (pdf-parse → pdfjs-dist 폴백) ──────
async function extractPdfText(pdfDocuments) {
  const texts = [];
  for (const pdf of pdfDocuments) {
    const buffer = Buffer.from(pdf.base64, 'base64');
    let text = '';

    // 1차: pdf-parse
    try {
      const data = await pdfParse(buffer);
      text = data.text.slice(0, 25000);
      console.log(`[Claude PDF] pdf-parse: ${pdf.label} → ${data.text.length}자`);
    } catch (e) {
      console.error(`[Claude PDF] pdf-parse 실패: ${pdf.label}`, e.message);
    }

    // 한글 검증 → pdfjs-dist 폴백
    const koreanChars = (text.match(/[가-힣]/g) || []).length;
    if (koreanChars < 50) {
      console.warn(`[Claude PDF] ${pdf.label}: 한글 ${koreanChars}자 → pdfjs-dist로 재시도`);
      try {
        const enhanced = await extractPdfTextEnhanced(buffer);
        const enhancedKorean = (enhanced.match(/[가-힣]/g) || []).length;
        if (enhancedKorean > koreanChars) {
          text = enhanced.slice(0, 25000);
          console.log(`[Claude PDF] pdfjs-dist 성공: ${pdf.label} → ${text.length}자 (한글 ${enhancedKorean}자)`);
        }
      } catch (e2) {
        console.error(`[Claude PDF] pdfjs-dist도 실패: ${pdf.label}`, e2.message);
      }
    }

    texts.push(text.length > 0 ? `[${pdf.label} 내용]\n${text}` : `[${pdf.label}] PDF 텍스트 추출 실패`);
  }
  return texts.join('\n\n');
}

// ── PDF 포함 메시지 빌더 (이미지 폴백 지원) ─────────────
const buildUserMessage = (promptText, pdfDocuments = [], pdfTextFallback = '') => {
  const fullPrompt = pdfTextFallback
    ? `${promptText}\n\n=== 첨부 PDF 내용 (반드시 읽고 분석에 활용하라) ===\n${pdfTextFallback}\n=== PDF 내용 끝 ===`
    : promptText;

  if (!pdfDocuments.length) {
    return [{ role: 'user', content: fullPrompt }];
  }

  const content = [];

  // PDF 이미지가 있으면 이미지로 전달 (가장 신뢰성 높음)
  const hasImages = pdfDocuments.some(pdf => pdf.images?.length > 0);

  if (hasImages) {
    for (const pdf of pdfDocuments) {
      if (pdf.images?.length > 0) {
        content.push({ type: 'text', text: `[${pdf.label} — ${pdf.images.length}페이지 이미지]` });
        for (const imgBase64 of pdf.images) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: imgBase64,
            },
          });
        }
      }
    }
    console.log(`[buildUserMessage] 이미지 모드: ${pdfDocuments.reduce((s, p) => s + (p.images?.length || 0), 0)}페이지`);
  } else {
    // 이미지 없으면 PDF document 타입으로 전달
    for (const pdf of pdfDocuments) {
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: pdf.base64,
        },
        title: pdf.label,
      });
    }
    console.log(`[buildUserMessage] document 모드: ${pdfDocuments.length}개 PDF`);
  }

  content.push({ type: 'text', text: fullPrompt });
  return [{ role: 'user', content }];
};

// ── Claude 호출 헬퍼 ──────────────────────────────────
const CLAUDE_MODELS = {
  'claude': 'claude-sonnet-4-6',
  'claude-opus': 'claude-opus-4-6',
};

const callClaude = async (systemPrompt, userPrompt, maxTokens = 2000, pdfDocuments = [], apiKey = null, submodel = 'claude') => {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY });
  const modelId = CLAUDE_MODELS[submodel] || CLAUDE_MODELS['claude'];

  // PDF 텍스트 (서버에서 미리 추출된 텍스트 사용, 없으면 직접 추출)
  let pdfText = pdfDocuments[0]?.preExtractedText || '';
  if (!pdfText && pdfDocuments.length > 0) {
    pdfText = await extractPdfText(pdfDocuments);
  }
  if (pdfText) {
    const koreanChars = (pdfText.match(/[가-힣]/g) || []).length;
    console.log(`[callClaude] PDF 텍스트 ${pdfText.length}자 사용 (한글 ${koreanChars}자)`);
    if (koreanChars < 50) {
      console.warn(`[callClaude] 경고: PDF 텍스트에 한글이 거의 없음! PDF 원본 읽기에 의존`);
    }
  } else {
    console.warn(`[callClaude] 경고: PDF 텍스트가 비어있음! PDF document 타입에 의존`);
  }

  // 1차 시도: document 타입 + 텍스트 fallback 동시 전달
  try {
    const messages = buildUserMessage(userPrompt, pdfDocuments, pdfText);
    console.log(`[callClaude] 1차 시도: document ${pdfDocuments.length}개 + 텍스트 ${pdfText.length}자`);
    const response = await client.messages.create({
      model: modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });
    return response.content[0].text;
  } catch (err) {
    console.error(`[callClaude] document 타입 실패 (${err.status || 'unknown'}):`, err.message);

    // 2차 시도: 텍스트만으로 재시도 (document 타입 제거)
    try {
      console.log(`[callClaude] 2차 시도: 텍스트만 ${pdfText.length}자`);
      const messages = buildUserMessage(userPrompt, [], pdfText);
      const response = await client.messages.create({
        model: modelId,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      });
      return response.content[0].text;
    } catch (err2) {
      console.error(`[callClaude] 2차 시도도 실패:`, err2.message);
      throw err2;
    }
  }
};

// ══════════════════════════════════════════════════════
// 8단계 분석
// ══════════════════════════════════════════════════════

export const step0_caseMatching = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[0단계: AI 드라이브 사례 매칭 분석]
학생: ${studentData.name} / 희망전공: ${studentData.major} / 내신: ${studentData.gpa}등급 / 목표: ${studentData.targetUniv}
${pdfDocuments.length ? `\n첨부된 PDF(${pdfDocuments.map(p=>p.label).join(', ')})를 먼저 읽고 학생 정보를 파악한 후 분석하라.` : ''}

[매칭 규칙 — 반드시 준수]
1. **전공 계열 일치가 최우선이다.** 학생의 희망전공(${studentData.major})과 동일하거나 유사한 계열의 합격 사례만 매칭하라.
2. 희망전공과 무관한 계열(예: 사범/교육 학생에게 공학/의학/경제 사례)은 절대 매칭하지 마라.
3. 전공이 일치하는 사례가 없으면 가장 인접한 학문 계열까지 넓히되, 반드시 그 이유를 명시하라.
4. 그래도 유사한 사례가 없으면 "합격자 사례 DB에 해당 전공 관련 사례가 부족합니다"라고 솔직히 밝혀라. 억지로 무관한 사례를 매칭하지 마라.
5. 매칭 우선순위: 1순위-전공 계열 일치(40점), 2순위-내신 갭(30점), 3순위-전형 유형(15점), 4순위-비교과 유사성(15점)
6. 합산 100점 만점으로 유사도 %를 산출하라. 전공 불일치 시 유사도는 최대 30%를 넘을 수 없다.

[출력 형식]

### 0.1 매칭 기준 및 방법

유사도 산정 기준을 아래 표로 제시하라:

| 매칭 기준 | 배점 | 설명 |
|----------|------|------|
| 전공 계열 일치 | 40점 | ... |
| 내신 성적 갭 | 30점 | ... |
| 전형 유형 | 15점 | ... |
| 비교과 유사성 | 15점 | ... |

### 0.2 유사 합격자 사례 3건

| 구분 | 대학/학과 | 유사도 | 매칭 근거 및 시사점 |
|------|----------|--------|-------------------|
| CASE A | ... | XX% | 유사점: ... / 차이점: ... / 시사점: ... |
| CASE B | ... | XX% | 유사점: ... / 차이점: ... / 시사점: ... |
| CASE C | ... | XX% | 유사점: ... / 차이점: ... / 시사점: ... |

### 0.3 학생 vs 합격자 핵심 비교 요약표

| 비교 항목 | 현재 학생 | 합격자 평균 | 차이 | 평가 |
|----------|----------|-----------|------|------|
| 내신 등급 | ... | ... | ... | ... |
| 전공 관련 활동 | ... | ... | ... | ... |
| 세특 수준 | ... | ... | ... | ... |
| 비교과 깊이 | ... | ... | ... | ... |
`;
  return callClaude(systemPrompt, prompt, 8000, pdfDocuments, apiKey);
};


export const step1_academic = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[1단계] 학업역량 종합 분석
${pdfDocuments.length ? `첨부 PDF(${pdfDocuments.map(p=>p.label).join(', ')})의 내용을 직접 읽고 분석하라.` : ''}
학생 입력 데이터: 내신 ${studentData.gpa}등급 / 모의고사 ${studentData.mockExam || '미입력'} / 과목선택: ${studentData.subjectPlan || '미입력'}

### 1.1 내신 등급 비교표

**전체 과목 성적 현황**

| 학년-학기 | 과목 | 원점수 | 평균 | 표준편차 | 성취도 | 석차등급 |
|----------|------|--------|------|---------|--------|---------|
| ... | ... | ... | ... | ... | ... | ... |

* PDF에서 실제 성적 데이터 추출하여 작성. 없으면 입력 데이터 활용.

**계열별 평균 등급 비교**

| 계열 | 현재 학생 | 합격자 평균 | 차이 | 평가 |
|------|----------|-----------|------|------|
| 국어 | ... | ... | ... | ... |
| 수학 | ... | ... | ... | ... |
| 영어 | ... | ... | ... | ... |
| 탐구(평균) | ... | ... | ... | ... |
| 전체 평균 | ... | ... | ... | ... |

### 1.2 성적 추이 분석

**주요 과목 등급 변화**

| 과목 | 1-1 | 1-2 | 2-1 | 2-2 | 추이 분석 |
|------|-----|-----|-----|-----|----------|
| ... | ... | ... | ... | ... | ... |

**학기별 종합 분석**
- 각 학기별 성적 흐름을 서술하라 (상승/하락/유지 추이, 원인 분석)

### 1.3 세부능력 및 특기사항 질적 분석

**현재 학생 세특 수준** (교과별)
- PDF 내용 기반으로 교과별 세특 수준을 분석하라

**합격자 세특 비교** (AI 드라이브 사례)
- 매칭된 합격자 사례의 세특 수준과 비교하라

**갭 분석 및 개선 방향**

| 항목 | 현재 학생 | 합격자 수준 | 갭 분석 |
|------|----------|-----------|---------|
| 탐구 깊이 | ... | ... | ... |
| 전공 연계성 | ... | ... | ... |
| 자기주도성 | ... | ... | ... |
| 성장 서사 | ... | ... | ... |
`;
  return callClaude(systemPrompt, prompt, 8000, pdfDocuments, apiKey);
};

export const step2_activity = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[2단계] 비교과 활동 평가
${pdfDocuments.length ? `첨부 PDF에서 비교과 활동 내용을 직접 읽고 분석하라.` : ''}
입력 데이터: 동아리-${studentData.club} / 봉사-${studentData.volunteer} / 리더십-${studentData.leadership} / 수상-${studentData.awards} / 특기-${studentData.talent}

### 2.1 활동 유사도 매칭 결과 (AI 드라이브 사례 기준)

| 현재 학생 활동 | 매칭된 합격자 활동 | 유사도 | 차이점 |
|--------------|------------------|--------|--------|
| ... | ... | ... | ... |

### 2.2 창의적 체험활동 상세 내역

#### 2.2.1 자율활동
- 학년별 자율활동 내역을 분석하라

#### 2.2.2 동아리활동
- 활동 상세 내용 + 평가를 서술하라

#### 2.2.3 진로활동
- 학년별 진로활동 내역 + 평가를 서술하라

#### 2.2.4 봉사활동
- 봉사 시간 + 평가를 서술하라

### 2.3 활동 깊이 비교 분석

| 항목 | 현재 학생 | 합격자 수준 | 개선 방향 |
|------|----------|-----------|----------|
| ... | ... | ... | ... |

### 2.4 독서활동 분석

**독서 목록** (학년별)
- 1학년, 2학년 독서 목록을 정리하라

**3학년 추천 독서**
- 전공 관련 추천 도서를 제시하라

### 2.5 비교과 종합 평가
- 종합 점수: X/10
- 스토리 일관성: X/10
- 강점 / 약점 / 개선 방향을 각각 서술하라
`;
  return callClaude(systemPrompt, prompt, 8000, pdfDocuments, apiKey);
};

export const step3_career = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[3단계] 진로 역량 및 전공 적합성
${pdfDocuments.length ? `첨부 PDF에서 진로 관련 내용을 직접 읽고 분석하라.` : ''}
희망전공: ${studentData.major} / 목표대학: ${studentData.targetUniv} / 관심분야: ${studentData.interests}

### 3.1 전공 적합성 체크리스트

| 역량 항목 | 보유 여부 | 수준 | 보완 필요도 | 비고 |
|----------|----------|------|-----------|------|
| 전공 관련 교과 성취 | ... | ... | ... | ... |
| 심화 탐구 경험 | ... | ... | ... | ... |
| 관련 활동 이력 | ... | ... | ... | ... |
| 핵심 과목 이수 | ... | ... | ... | ... |

### 3.2 과목 이수 현황 및 3학년 선택 전략

#### 3.2.1 현재까지 이수 과목

- 이수 과목 목록을 표로 정리하라

#### 3.2.2 권장 과목 이수 현황

| 권장 과목 | 이수 여부 | 비고 |
|----------|----------|------|
| ... | ... | ... |

#### 3.2.3 3학년 과목 선택 전략

- **필수 과목**: 반드시 이수해야 할 과목
- **권장 과목**: 이수를 강력히 권장하는 과목
- **금지 과목**: 전공 적합성에 부정적 영향을 줄 수 있는 과목

### 3.3 진로 역량 종합 평가
- 전공 적합성 점수: X/10

**가장 시급한 보완 역량 TOP 3**

각 역량별로 다음을 포함하여 서술하라:
1. 현황 / 목표 / 구체적 보완 방법
2. 현황 / 목표 / 구체적 보완 방법
3. 현황 / 목표 / 구체적 보완 방법
`;
  return callClaude(systemPrompt, prompt, 8000, pdfDocuments, apiKey);
};

export const step4_strategy = async (systemPrompt, studentData, prevAnalysis, pdfDocuments, apiKey) => {
  const prompt = `
[4단계] 수시 지원 전략 (6장 카드)
앞선 분석 요약: ${prevAnalysis}
학생: 내신 ${studentData.gpa} / 모의 ${studentData.mockExam || '미입력'} / 목표 ${studentData.targetUniv} / ${studentData.major}

[출력 형식 — 절대 준수: 반드시 마크다운 표(| |)로만 출력하라. 카드 형태, 블록쿼트(>), 들여쓰기 목록 금지.]

### 4.1 전형 유형별 적합도

| 전형 유형 | 적합도 | 이유 |
|----------|--------|------|
| 학생부종합 | XX% | ... |
| 학생부교과 | XX% | ... |
| 논술 | XX% | ... |
| 정시 | XX% | ... |

### 4.2 수시 지원 카드 6장 상세 분석

각 카드(상향1, 상향2, 적정1, 적정2, 안정1, 안정2)별로 다음을 포함하라:

- **대학 / 학과 / 전형**
- 합격자 스펙 비교:

| 항목 | 합격자 | 현재 학생 | 갭 분석 |
|------|--------|----------|---------|
| ... | ... | ... | ... |

- **합격 가능성**: XX%
- **필요 개선사항**: ...
- **지원 전략** (방향성만 제시, 자소서 샘플 문구 제외): ...
- **전형 정보** (모집인원, 전형방법, 수능최저): ...

위 형식을 6장 카드 각각에 대해 작성하라.

### 4.3 수시 지원 전략 종합

| 구분 | 대학 | 학과 | 합격 가능성 | 전략적 의미 |
|------|------|------|-----------|-----------|
| 상향 1 | ... | ... | XX% | ... |
| 상향 2 | ... | ... | XX% | ... |
| 적정 1 | ... | ... | XX% | ... |
| 적정 2 | ... | ... | XX% | ... |
| 안정 1 | ... | ... | XX% | ... |
| 안정 2 | ... | ... | XX% | ... |
`;
  return callClaude(systemPrompt, prompt, 8000, pdfDocuments, apiKey);
};

export const step5_roadmap = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[5단계] 핵심 리스크 및 대응 방안
학생: ${studentData.name} / ${studentData.grade}학년 / 목표: ${studentData.targetUniv} ${studentData.major}

### 5.1 리스크 1: (구체적 리스크명)

- **리스크 상세**: 해당 리스크의 구체적 내용을 서술하라
- **입학사정관 관점의 우려사항**: 입학사정관이 어떻게 평가할지 분석하라
- **대응 방안**: 구체적 실행 단계를 제시하라 (자소서 샘플 문구 제외)
- **면접 대응**: 예상 질문 + 답변 구조(키워드)만 제시하라

### 5.2 리스크 2: (구체적 리스크명)

- **리스크 상세**: ...
- **입학사정관 관점의 우려사항**: ...
- **대응 방안**: ...
- **면접 대응**: ...

### 5.3 리스크 3: (구체적 리스크명)

- **리스크 상세**: ...
- **입학사정관 관점의 우려사항**: ...
- **대응 방안**: ...
- **면접 대응**: ...

### 5.4 리스크 종합 대응 타임라인

| 시기 | 리스크1 대응 | 리스크2 대응 | 리스크3 대응 |
|------|------------|------------|------------|
| ... | ... | ... | ... |
`;
  return callClaude(systemPrompt, prompt, 8000, pdfDocuments, apiKey);
};

export const step6_recordFeedback = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[6단계] 3학년 실행 계획
${pdfDocuments.length ? `첨부 생기부 PDF를 직접 읽고 학생의 현재 상태를 파악한 후 실행 계획을 수립하라.` : `세특 내용: ${studentData.specialNotes || '(미입력)'}`}
수상: ${studentData.awards} / 관심분야: ${studentData.interests}

### 6.1 월별 세부 실행 계획

각 월별(3월~8월)로 다음을 작성하라:

**[3월] 주요 과제**: ...

| 주차 | 과제 | 담당 | 마감일 |
|------|------|------|--------|
| 1주차 | ... | ... | ... |
| 2주차 | ... | ... | ... |
| 3주차 | ... | ... | ... |
| 4주차 | ... | ... | ... |

위 형식을 4월~8월까지 각각 작성하라.

### 6.2 성적 목표 및 관리 전략

**목표 성적**

| 과목 | 현재 등급 | 목표 등급 | 전략 |
|------|----------|----------|------|
| ... | ... | ... | ... |

**일일 학습 시간 배분**

| 시간대 | 과목/활동 | 시간 |
|--------|----------|------|
| ... | ... | ... |

### 6.3 비교과 활동 체계화 계획
- 활동 운영 방식을 구체적으로 서술하라
- 성과 기록 방식을 구체적으로 서술하라

### 6.4 독서 및 탐구 계획

**필수 독서 목록**

| 월 | 책 | 저자 | 핵심 내용 | 활용 |
|----|-----|------|----------|------|
| ... | ... | ... | ... | ... |
`;
  return callClaude(systemPrompt, prompt, 8000, pdfDocuments, apiKey);
};

export const step7_dashboard = async (systemPrompt, studentData, allAnalysis, pdfDocuments, apiKey) => {
  const prompt = `
[7단계] 종합 평가 및 권고사항
지금까지 분석: ${allAnalysis.slice(0, 6000)}

──────────────────────────────────────
${studentData.name} 입시 컨설팅 종합 리포트
분석일: ${new Date().toLocaleDateString('ko-KR')}
──────────────────────────────────────

### 7.1 역량 종합 평가

**5개 영역 평가**

| 평가 항목 | 점수 | 등급 | 평가 |
|----------|------|------|------|
| 학업역량 | X/10 | ... | ... |
| 비교과 | X/10 | ... | ... |
| 진로역량 | X/10 | ... | ... |
| 세특 질 | X/10 | ... | ... |
| 전공적합성 | X/10 | ... | ... |

**합격 가능성 분석**

| 구분 | 합격 가능성 | 설명 |
|------|-----------|------|
| 현재 상태 | XX% | ... |
| 보완 시 | XX% | ... |
| 추가 노력 시 | XX% | ... |

### 7.2 최종 권고사항

#### 7.2.1 즉시 실행 과제 (이번 달 안에)
1. ...
2. ...
3. ...

#### 7.2.2 유지해야 할 강점
1. ...
2. ...
3. ...
4. ...

### 7.3 차기 상담 일정

| 구분 | 일정 | 점검 항목 |
|------|------|----------|
| 1차 점검 | ... | ... |
| 2차 점검 | ... | ... |

### 7.4 맺음말
(3~4문장으로 학생에 대한 종합 격려와 핵심 메시지를 작성하라)

──────────────────────────────────────

[Notion 저장용 JSON]
{
  "종합점수": {"학업역량":0,"비교과":0,"진로역량":0,"세특질":0,"전공적합성":0,"총점":0},
  "종합평가요약": "",
  "핵심강점": ["","",""],
  "핵심약점": ["","",""],
  "즉시실행과제": ["","",""]
}
`;
  return callClaude(systemPrompt, prompt, 8000, pdfDocuments, apiKey);
};

// ── 전체 분석 오케스트레이터 ──────────────────────────
export const runFullAnalysis = async (studentData, knowledgeBase, studentDriveFiles, onProgress, pdfDocuments = [], apiKey) => {
  const systemPrompt = buildSystemPrompt(knowledgeBase, studentDriveFiles);
  const results = {};

  onProgress?.({ step: 0, label: 'Drive 사례 매칭 중...' });
  results.caseMatching = await step0_caseMatching(systemPrompt, studentData, pdfDocuments, apiKey);

  onProgress?.({ step: 1, label: '학업역량 분석 중...' });
  results.academic = await step1_academic(systemPrompt, studentData, pdfDocuments, apiKey);

  onProgress?.({ step: 2, label: '비교과 활동 분석 중...' });
  results.activity = await step2_activity(systemPrompt, studentData, pdfDocuments, apiKey);

  onProgress?.({ step: 3, label: '진로 역량 분석 중...' });
  results.career = await step3_career(systemPrompt, studentData, pdfDocuments, apiKey);

  const prevSummary = `학업:${results.academic?.slice(0,200)}\n비교과:${results.activity?.slice(0,200)}\n진로:${results.career?.slice(0,200)}`;

  onProgress?.({ step: 4, label: '지원 전략 수립 중...' });
  results.strategy = await step4_strategy(systemPrompt, studentData, prevSummary, pdfDocuments, apiKey);

  onProgress?.({ step: 5, label: '3년 로드맵 생성 중...' });
  results.roadmap = await step5_roadmap(systemPrompt, studentData, pdfDocuments, apiKey);

  onProgress?.({ step: 6, label: '세특 개선안 작성 중...' });
  results.recordFeedback = await step6_recordFeedback(systemPrompt, studentData, pdfDocuments, apiKey);

  const allAnalysis = Object.values(results).join('\n\n');
  onProgress?.({ step: 7, label: '종합 대시보드 생성 중...' });
  results.dashboard = await step7_dashboard(systemPrompt, studentData, allAnalysis, pdfDocuments, apiKey);

  onProgress?.({ step: 8, label: '분석 완료!' });
  return results;
};
