// services/claudeService.js
import Anthropic from '@anthropic-ai/sdk';
import pdfParse from 'pdf-parse';
import { stripBoldMarkers, studentContextBlock, buildPlanMonths } from './reportUtils.js';

// ── System Prompt 생성 ─────────────────────────────────
const buildSystemPrompt = (knowledgeBase, studentDriveFiles, studentData = {}) => `${studentContextBlock(studentData)}

당신은 대한민국 최고 수준의 입시 전문 컨설턴트입니다.
15년 이상의 학생부종합전형 컨설팅 경험을 보유하고 있으며 서울대·연세대·고려대 합격자를 다수 배출했습니다.

=== 문체·톤 원칙 (필수) ===
- 담백하고 절제된 서술을 유지하라. 과장된 미사여구·극적 표현·감탄조를 쓰지 마라
  (예: "압도적", "완벽한", "탁월한", "눈부신", "독보적", "최고의", "매우 인상적입니다" 등 과장 표현 남발 금지).
- 칭찬도 사실과 근거에 기반해 담담하게 표현하라. 근거 없는 상찬이나 단정을 피하라.
- 상담하듯 자연스럽게, 판단의 근거를 차분히 설명하라. 상투적·기계적 문구를 반복하지 마라.
- "본 분석은", "이 리포트는", "분석 결과에 따르면" 같은 자기지시·메타 표현을 남발하지 마라.
- 형용사·부사로 부풀리기보다 구체적 사실과 수치로 말하라.

=== 출력 형식 원칙 (최우선 준수) ===
- 이모티콘, 이모지, 유니코드 특수기호를 절대 사용하지 마라 (예: 📊🔍✅❌🎯📚🏃✏️☁️🗓️💬🚨⚠️👍👎🔴🟡🟢 등 모든 이모지/이모티콘 금지)
- 노션 스타일 아이콘(📌, ✨, 🚀 등) 절대 금지
- 허용되는 기호: 번호(1. 2. 3.), 기호(-, *, >), 대괄호([항목]), 구분선(──), 표 구분(|)만 사용
- 섹션 제목은 [대괄호]와 번호를 조합하여 표시 (예: [1단계] 학업역량 심층 분석)
- 마크다운 강조 기호(**, __)를 절대 쓰지 마라. 굵게 표시하지 말고 담백한 문장으로 쓰라 (표의 항목명도 ** 없이 그대로 쓴다)
- 전문 컨설팅 보고서 톤을 유지하되, 출력 문체는 반드시 '~합니다', '~됩니다', '~있습니다' 같은 합니다체(격식체)를 사용하라. 반말(~하다, ~이다, ~한다, ~된다, ~임, ~함)이나 명령체(~하라, ~마라)로 출력하지 마라

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
- 자기소개서(자소서)는 2025학년도부터 '교육부 소관 일반 대학'의 대입에서 폐지되었으므로, 일반 대학 지원 전략에서는 자소서를 언급하지 마라
- 다만 과학기술원(KAIST/GIST/DGIST/UNIST), POSTECH, 한국에너지공대는 교육부 소관이 아니어서 자소서(자기소개서·지원동기서)를 요구하는 전형이 있다.
  이들 대학을 지원 카드에 포함할 때는 '자소서 폐지'라고 쓰지 말고, 해당 대학의 서류 제출 요건을 모집요강에서 확인하도록 안내하라.
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
9. "사례가 없습니다", "DB에 포함되어 있지 않습니다", "매칭 제한 안내", "사전 고지" 같은 면책성 문구를 절대 쓰지 마라. 보유 데이터 내에서 가장 유사한 사례를 찾아 전문적으로 분석하라. 전문 컨설턴트는 자료 부족을 변명하지 않고 최선의 분석을 제공한다.

=== 지식베이스 — 대입정책 ===
${knowledgeBase.대입정책 || '(자료 없음)'}

=== 지식베이스 — 대학별전형 ===
${knowledgeBase.대학별전형 || '(자료 없음)'}

=== 합격자 사례 ===
${knowledgeBase.합격자사례 || '(자료 없음)'}

=== 학생 Drive 파일 ===
${studentDriveFiles || '(없음)'}
`;

// ── PDF 텍스트 추출 (pdf-parse) ──────────────────────────
async function extractPdfText(pdfDocuments) {
  const texts = [];
  for (const pdf of pdfDocuments) {
    try {
      const buffer = Buffer.from(pdf.base64, 'base64');
      const data = await pdfParse(buffer);
      const truncated = data.text.slice(0, 120000);
      texts.push(`[${pdf.label} 내용]\n${truncated}`);
    } catch (e) {
      texts.push(`[${pdf.label}] PDF 텍스트 추출 실패`);
    }
  }
  return texts.join('\n\n');
}

// base64 앞머리로 이미지 포맷 판별 (jpeg: /9j/, png: iVBOR, webp: UklGR, gif: R0lGOD)
function sniffImageMime(b64) {
  const head = String(b64 || '').slice(0, 12);
  if (head.startsWith('/9j/')) return 'image/jpeg';
  if (head.startsWith('iVBOR')) return 'image/png';
  if (head.startsWith('UklGR')) return 'image/webp';
  if (head.startsWith('R0lGOD')) return 'image/gif';
  return 'image/png';
}

// document 타입으로 붙일 수 있는 base64 PDF의 상한.
// 스캔 생기부는 원본이 40MB를 넘기도 해서 그대로 붙이면 매번 413이 나고,
// 그때마다 조용히 텍스트 전용으로 떨어져 분석 근거가 사라진다.
const MAX_DOC_BASE64 = 12 * 1024 * 1024;

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
              // media_type을 png로 박아두면 jpeg를 보낼 때 400으로 전부 거부되고
              // 조용히 텍스트 폴백으로 떨어져 "판독 불가" 리포트가 나온다. 매직바이트로 판별한다.
              media_type: sniffImageMime(imgBase64),
              data: imgBase64,
            },
          });
        }
      }
    }
    console.log(`[buildUserMessage] 이미지 모드: ${pdfDocuments.reduce((s, p) => s + (p.images?.length || 0), 0)}페이지`);
  } else {
    // 이미지 없으면 PDF document 타입으로 전달 (단, base64가 있는 경우만)
    let pdfAttached = 0;
    for (const pdf of pdfDocuments) {
      if (!pdf.base64) continue; // 텍스트 전용(재분석 모드)이면 document 첨부 생략
      if (pdf.base64.length > MAX_DOC_BASE64) {
        console.warn(`[buildUserMessage] ${pdf.label}: base64 ${(pdf.base64.length / 1024 / 1024).toFixed(1)}MB — 상한 초과로 document 첨부 생략(413 방지)`);
        continue;
      }
      content.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: pdf.base64,
        },
        title: pdf.label,
      });
      pdfAttached++;
    }
    if (pdfAttached > 0) {
      console.log(`[buildUserMessage] document 모드: ${pdfAttached}개 PDF`);
    } else {
      console.log(`[buildUserMessage] 텍스트 전용 모드 (PDF base64 없음, preExtractedText 사용)`);
    }
  }

  content.push({ type: 'text', text: fullPrompt });
  return content.length === 1
    ? [{ role: 'user', content: fullPrompt }]
    : [{ role: 'user', content }];
};

// ── Claude 호출 헬퍼 ──────────────────────────────────
const CLAUDE_MODELS = {
  'claude': 'claude-sonnet-4-6',
  'claude-opus': 'claude-opus-4-8',
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
    const stream = client.messages.stream({
      model: modelId,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });
    const final = await stream.finalMessage();
    return stripBoldMarkers(final.content.map(b => b.type === 'text' ? b.text : '').join(''));
  } catch (err) {
    console.error(`[callClaude] document 타입 실패 (${err.status || 'unknown'}):`, err.message);

    // 2차 시도: 텍스트만으로 재시도 (document 타입 제거)
    try {
      console.log(`[callClaude] 2차 시도: 텍스트만 ${pdfText.length}자`);
      const messages = buildUserMessage(userPrompt, [], pdfText);
      const stream = client.messages.stream({
        model: modelId,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      });
      const final = await stream.finalMessage();
      return stripBoldMarkers(final.content.map(b => b.type === 'text' ? b.text : '').join(''));
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
[0단계: 합격자 사례 매칭 분석]

=== 학생 핵심 정보 (모든 분석의 기준 — 절대 변경 금지) ===
- 학생명: ${studentData.name}
- 희망전공: **${studentData.major}**
- 목표대학: **${studentData.targetUniv || '미입력'}**
- 내신: ${studentData.gpa}등급
=== 끝 ===

${pdfDocuments.length ? `첨부된 PDF(${pdfDocuments.map(p=>p.label).join(', ')})를 먼저 읽고 학생 정보를 파악한 후 분석하라.` : ''}

[절대 규칙 — 위반 시 분석 전체 무효]
- 이 학생의 희망전공은 "${studentData.major}"이고 목표대학은 "${studentData.targetUniv || '미입력'}"이다.
- 매칭할 합격 사례는 반드시 "${studentData.major}" 또는 동일 계열 학과여야 한다.
- "${studentData.targetUniv}" 합격 사례를 최우선으로 찾고, 없으면 동급 대학의 동일 학과를 찾아라.
- 전혀 다른 전공(예: 화학 학생에게 경영학, 컴퓨터 학생에게 간호학)을 매칭하면 분석 실패이다.

[매칭 규칙]
1. **전공 일치가 최우선이다.** "${studentData.major}"과 동일하거나 직접 관련된 학과의 합격 사례만 매칭하라.
2. 희망전공과 무관한 계열은 절대 매칭하지 마라.
3. 동일 전공 사례가 없으면 가장 인접한 학문 계열까지만 넓히되, 반드시 그 이유를 명시하라.
4. 동일 전공 사례가 DB에 없더라도, 가장 인접한 계열의 사례를 활용하여 유의미한 비교 분석을 반드시 제공하라. "사례가 없다", "DB에 부족하다", "매칭 제한" 등의 면책 문구는 절대 쓰지 마라. 전문 컨설턴트처럼 보유한 데이터 내에서 최선의 분석을 제공하라.
5. 매칭 우선순위: 1순위-전공 학과 일치(50점), 2순위-대학 일치(20점), 3순위-내신 갭(20점), 4순위-전형 유형(10점)
6. 전공 불일치 시 유사도는 최대 20%를 넘을 수 없다.

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

### 0.4 PDF 핵심 데이터 추출 (후속 분석용 — 반드시 작성)

[중요] 이 섹션은 후속 분석 단계에서 PDF 원본 대신 사용된다. 이후 단계는 PDF를 다시 볼 수 없으므로,
여기서 빠뜨린 과목은 이후 분석에서 '미이수'로 오판된다. 절대 요약하거나 생략하지 마라.

[자료 우선순위 — 반드시 지켜라]
1순위: 이 메시지에 첨부된 생기부 이미지/PDF. 스캔 이미지라도 너는 이미지를 직접 볼 수 있다.
       "텍스트 추출이 안 되어 확인 불가"라고 쓰지 마라 — 첨부된 이미지의 표를 눈으로 읽어서 옮겨 적어라.
       교과 성적표는 표 형태이므로 학년-학기, 과목명, 학점수, 원점수/평균, 성취도(수강자수), 석차등급 칸을
       한 행씩 그대로 옮기면 된다. 판독이 어려운 칸만 개별적으로 '판독 불가'라고 표시하라.
2순위: 학생이 입력한 데이터.
3순위: 과거 분석 리포트(있다면). 이것은 AI 생성물이라 오류가 있을 수 있다.
       1순위와 충돌하면 무조건 1순위를 따르고, 과거 리포트의 수치를 사실로 인용하지 마라.
첨부 이미지가 있는데도 과거 리포트를 근거로 표를 채우는 것은 명백한 오답이다.

[필수 절차] 표를 쓰기 전에, 첨부 자료에 [1학년] [2학년] [3학년] 블록이 각각 있는지 먼저 확인하고
"확인된 학년: 1학년, 2학년, 3학년 1학기" 형식으로 한 줄 적어라. 확인되지 않은 학년도 그대로 명시하라.

**교과 성적표 (전 학년·전 학기·전 과목 — 한 행도 빠뜨리지 마라):**
| 학년-학기 | 교과 | 과목 | 학점수 | 원점수/평균(표준편차) | 성취도(수강자수) | 석차등급 |
|----------|------|------|--------|---------------------|----------------|---------|
| (1학년 1학기부터 마지막 학기까지 모든 과목. '이하 동일', '외 O과목' 같은 축약 금지) |

**진로 선택 과목 (석차등급 없이 성취도 A/B/C로만 표기되는 과목 — 반드시 별도로 전부 나열):**
| 학년-학기 | 과목 | 학점수 | 원점수/과목평균 | 성취도 | 성취도별 분포비율 |
|----------|------|--------|----------------|--------|-----------------|
| (기하, 심화 수학, 고급 수학, 물리학II, 화학II, 생명과학II, 과학 실험 과목 등이 여기 들어간다) |

**수학·과학 이수 점검표 (이공계 판정의 핵심 — 표를 다 쓴 뒤 대조해 채워라):**
| 과목 | 이수 여부 | 학년-학기 | 석차등급 또는 성취도 |
|------|----------|----------|--------------------|
| 물리학I / 물리학II / 화학I / 화학II / 생명과학I / 생명과학II / 지구과학I / 미적분 / 기하 / 확률과통계 / 심화·고급 수학 |
※ 위 표에서 '미이수'라고 쓰려면 그 과목이 편성될 학년의 성적표를 실제로 확인했어야 한다.
   해당 학년 자료를 보지 못했다면 '미이수'가 아니라 '확인 불가'로 적어라.

**세부능력 및 특기사항 요약:** 과목별 핵심 키워드와 활동 요약 (각 과목 1~2문장)

**창의적 체험활동:** 자율활동, 동아리활동, 진로활동의 핵심 내용 요약

**수상경력/봉사활동:** 주요 항목 나열

**행동특성 및 종합의견:** 핵심 키워드
`;
  return callClaude(systemPrompt, prompt, 16000, pdfDocuments, apiKey);
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

**합격자 세특 비교** (합격자 사례)
- 매칭된 합격자 사례의 세특 수준과 비교하라

**갭 분석 및 개선 방향**

| 항목 | 현재 학생 | 합격자 수준 | 갭 분석 |
|------|----------|-----------|---------|
| 탐구 깊이 | ... | ... | ... |
| 전공 연계성 | ... | ... | ... |
| 자기주도성 | ... | ... | ... |
| 성장 서사 | ... | ... | ... |
`;
  return callClaude(systemPrompt, prompt, 12000, pdfDocuments, apiKey);
};

export const step2_activity = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[2단계] 비교과 활동 평가
${pdfDocuments.length ? `첨부 PDF에서 비교과 활동 내용을 직접 읽고 분석하라.` : ''}
입력 데이터: 동아리-${studentData.club} / 봉사-${studentData.volunteer} / 리더십-${studentData.leadership} / 수상-${studentData.awards} / 특기-${studentData.talent}

### 2.1 활동 유사도 매칭 결과 (합격자 사례 기준)

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
  return callClaude(systemPrompt, prompt, 12000, pdfDocuments, apiKey);
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
  return callClaude(systemPrompt, prompt, 12000, pdfDocuments, apiKey);
};

export const step4_strategy = async (systemPrompt, studentData, prevAnalysis, pdfDocuments, apiKey) => {
  const prompt = `
[4단계] 수시 지원 전략 (6장 카드)
앞선 분석 요약: ${prevAnalysis}
[필수] 이 학생의 희망전공은 "${studentData.major}"이고 목표대학은 "${studentData.targetUniv}"입니다. 지원 카드 6장은 반드시 "${studentData.major}" 관련 학과로만 구성하십시오.
학생: 내신 ${studentData.gpa} / 모의 ${studentData.mockExam || '미입력'} / 목표 ${studentData.targetUniv} / ${studentData.major}

[출력 형식 — 절대 준수: 반드시 마크다운 표(| |)로만 출력하라. 카드 형태, 블록쿼트(>), 들여쓰기 목록 금지.]
[판정은 시스템 프롬프트의 "수시 판정 정밀 규칙"(이원화·강등 규칙·균형 진단)을 반드시 적용하라.]

### 4.1 판정 기준 안내

- 학생부교과는 대학별 환산내신 vs 대학 발표 합격컷의 정량 비교(신뢰도 높음),
  학생부종합은 서류평가가 당락을 가르므로 "지원 가능권/준안정/상향"으로만 표기함을 2~3문장으로 안내하라.

### 4.2 전형 유형별 적합도

| 전형 유형 | 적합도 | 이유 |
|----------|--------|------|
| 학생부종합 | XX% | ... |
| 학생부교과 | XX% | ... |
| 논술 | XX% | ... |
| 정시 | XX% | ... |

### 4.3 학생부교과 판정

| 대학 · 전형 | 모집단위 | 모집인원(전년→올해) | 수능최저 | 합격컷(70%) | 환산내신 | 격차 | 판정 |
|------------|---------|-----------------|---------|------------|---------|------|------|

- 판정 라벨: 안정/준안정/적정/경계/소신/상향, 최저 걸린 카드는 "(최저조건부)"를 붙여라.
- 표 아래에 환산 기준(반영교과·컷 출처 연도)과 강등 규칙 적용 사유(모집인원 급감·소수모집 등)를 각주로 명시하라.

### 4.4 수능최저 충족 구조 분석 (최저 걸린 카드가 있을 때 필수)

| 모의고사 시기 | 최선 조합 | 등급 합 | 충족 여부 |
|-------------|----------|--------|----------|

- 충족이 어떤 과목에 의존하는지(단일 실패점), 미달 이력이 있는지, 안전마진이 있는지를 서술하라.
- "N번 중 M번 충족"이라는 요약만으로 낙관하지 말고, 미충족 시나리오에서 어느 카드가 무효가 되는지 명시하라.

### 4.5 학생부종합 — 지원 가능권 검토

| 대학 · 전형 | 모집단위 | 모집인원 | 전형 방법 | 최근 경쟁률 | 최근 컷(70%) | 표기 |
|------------|---------|---------|----------|-----------|------------|------|

- 표기: 지원 가능권 / 준안정(최저 없음+서류100+컷 여유 0.4등급 이상일 때만) / 상향.
- 서류 관점의 방어 논리(진로 일관성 등)와 취약점(감점 요인 과목 등)을 표 아래 2~3문장으로 정리하라.

### 4.6 권장 지원 구성 (6장) + 균형 진단

| 성격 | 카드 | 핵심 근거 |
|------|------|----------|

- 구성 비율은 학생 상황에 맞추되, "진짜 안전판"(최저 없음+격차 +0.3등급 이상+등록 현실성)을 최소 2장 확보하라.
- 표 아래 균형 진단을 반드시 쓰라: 진짜 안전판 O장 / 최저조건부 O장 / 상향 O장.
  진짜 안전판이 1장 이하이면 경고하고 보강 카드를 제시하라. 최저조건부가 2장을 넘으면 동시 무효 시나리오를 서술하라.
- 통학 시간이 비현실적인 카드(편도 90분 초과)는 그 사실을 근거에 명시하고 하한선 역할을 주지 마라.

### 4.7 다음 모의고사 이후 재점검 사항

- 최저 재검증(의존 과목 유지 여부)과 미충족 시 무게중심 이동 계획, 취약 과목 반등 여부,
  모집요강 확정본의 모집인원·전형방법 재확인을 항목별로 쓰라.
`;
  return callClaude(systemPrompt, prompt, 16000, pdfDocuments, apiKey);
};

export const step5_roadmap = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[5단계] 핵심 리스크 및 대응 방안
학생: ${studentData.name} / ${studentData.grade}학년 / 목표: ${studentData.targetUniv} ${studentData.major}

### 5.1 리스크 1: (구체적 리스크명)

- **리스크 상세**: 해당 리스크의 구체적 내용을 서술하라
- **입학사정관 관점의 우려사항**: 입학사정관이 어떻게 평가할지 분석하라
- **대응 방안**: 구체적 실행 단계를 제시하라 (일반 대학 자소서는 폐지됨 — 언급 금지, 과기원·POSTECH은 예외)
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
  return callClaude(systemPrompt, prompt, 12000, pdfDocuments, apiKey);
};

export const step6_recordFeedback = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const planMonths = buildPlanMonths(studentData.planStartYm, 6);
  const prompt = `
[6단계] 실행 계획
${pdfDocuments.length ? `생기부 PDF 기반으로 작성하십시오.` : ''}
학생: ${studentData.name} / ${studentData.grade} / 희망전공: ${studentData.major}

### 6.1 월별 핵심 실행 계획 (${planMonths[0]}부터 6개월)

| 월 | 학업 목표 | 비교과/세특 과제 | 핵심 체크포인트 |
|----|----------|---------------|--------------|
${planMonths.map(m => `| ${m} | ... | ... | ... |`).join("\n")}

### 6.2 성적 목표

| 과목 | 현재 등급 | 목표 등급 | 전략 |
|------|----------|----------|------|

### 6.3 비교과 및 독서 계획

| 활동/독서 | 내용 | 시기 | 세특 연계 |
|----------|------|------|----------|
`;
  return callClaude(systemPrompt, prompt, 12000, pdfDocuments, apiKey);
};

export const step7_dashboard = async (systemPrompt, studentData, allAnalysis, pdfDocuments, apiKey) => {
  const prompt = `
[7단계] 종합 평가 및 권고사항
지금까지 분석 요약: ${allAnalysis.slice(0, 3000)}

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

[필수] 7.4 맺음말까지 반드시 끝까지 작성하십시오. 중간에 끊기거나 생략하지 마십시오.
`;
  return callClaude(systemPrompt, prompt, 12000, pdfDocuments, apiKey);
};

// ── 전체 분석 오케스트레이터 (병렬 + 섹션별 오류 격리 + 증분 전송) ──
export const runFullAnalysis = async (studentData, knowledgeBase, studentDriveFiles, onProgress, pdfDocuments = [], apiKey, options = {}) => {
  const systemPrompt = buildSystemPrompt(knowledgeBase, studentDriveFiles, studentData);
  const { existingResults = {}, sectionsToRun = null } = options;
  // sectionsToRun이 null이면 전부 실행, 배열이면 그 키만 실행. 기존 결과가 있고 실행 대상이 아니면 그대로 보존.
  const shouldRun = (key) => {
    if (sectionsToRun && Array.isArray(sectionsToRun)) return sectionsToRun.includes(key);
    return true;
  };
  const results = { ...existingResults };

  // 한 섹션을 실행하고, 성공/실패와 무관하게 결과를 즉시 onProgress로 전송한다.
  // 한 섹션이 실패해도 전체 분석은 중단되지 않는다(부분 저장 보장).
  const runSection = async (key, step, label, fn) => {
    if (!shouldRun(key)) {
      onProgress?.({ step, label: `${label} (기존 결과 유지)` });
      if (results[key]) onProgress?.({ section: key, content: results[key] });
      return;
    }
    onProgress?.({ step, label: `${label} 중...` });
    try {
      results[key] = await fn();
    } catch (e) {
      console.error(`[Analysis] '${key}' 섹션 실패:`, e.message);
      results[key] = `> 이 항목 분석 중 오류가 발생했습니다 (${e.message}).\n>\n> 결과 화면의 "이 데이터로 재분석"에서 이 섹션만 다시 실행할 수 있습니다.`;
    }
    onProgress?.({ section: key, content: results[key] }); // 완료 즉시 전송 → 끊겨도 저장됨
  };

  // 스캔 PDF 여부 판단
  const isScannedPdf = pdfDocuments.some(pdf => pdf.images?.length > 0);
  console.log(`[Analysis] 스캔 PDF: ${isScannedPdf ? '예 — 이미지 모드' : '아니오 — 텍스트 모드'}`);
  console.log(`[Analysis] 모드: ${sectionsToRun ? `부분 재분석 (${sectionsToRun.join(', ')})` : '전체 분석(병렬)'}`);

  // 이미지 없는 경량 pdfDocuments (텍스트만, 이미지 제거)
  // 스캔 PDF는 base64도 같이 버린다. 원본이 수십MB라 document로 붙이면 매 단계 413이 나고,
  // 그때마다 조용히 텍스트 전용으로 떨어져 정작 근거가 사라진다. 스캔은 0단계 추출 텍스트로 간다.
  const pdfDocsLight = pdfDocuments.map(pdf => ({
    label: pdf.label,
    base64: (pdf.images?.length > 0 || (pdf.base64 || '').length > MAX_DOC_BASE64) ? '' : pdf.base64,
    preExtractedText: pdf.preExtractedText,
  }));

  // 단계 0: 이미지 포함 → PDF 데이터 추출 + 사례 매칭 (이후 단계의 컨텍스트라 먼저 단독 실행)
  await runSection('caseMatching', 0, isScannedPdf ? '스캔 PDF 이미지 분석' : 'Drive 사례 매칭',
    () => step0_caseMatching(systemPrompt, studentData, pdfDocuments, apiKey));

  // step0에서 추출한 데이터를 이후 단계 컨텍스트로 사용
  const step0Context = results.caseMatching || '';
  for (const pdf of pdfDocsLight) {
    if (pdf.preExtractedText && pdf.preExtractedText.includes('이미지에서 직접 읽어야 함')) {
      // 꼬리 4000자만 넘기면 0.4의 교과 성적표(앞쪽)가 잘려 하위 단계가 이수과목을 못 본다.
      // 스캔 PDF에서 하위 단계가 가진 유일한 원문이므로 통째로 넘긴다.
      pdf.preExtractedText = `[0단계에서 추출한 PDF 데이터 — 이 데이터를 기반으로 분석하십시오]\n${step0Context.slice(0, 40000)}\n\n[주의] 위 데이터에 없는 과목을 '미이수'로 단정하지 마라. 확인되지 않으면 '확인 불가'로 쓰라.\n`;
    }
  }
  const academicDocs = isScannedPdf ? pdfDocuments : pdfDocsLight;

  // 1~3,5,6단계는 서로 독립 → 병렬 실행 (속도 대폭 개선)
  await Promise.all([
    runSection('academic',       1, '학업역량 분석',     () => step1_academic(systemPrompt, studentData, academicDocs, apiKey)),
    runSection('activity',       2, '비교과 활동 분석',   () => step2_activity(systemPrompt, studentData, pdfDocsLight, apiKey)),
    runSection('career',         3, '진로 역량 분석',     () => step3_career(systemPrompt, studentData, pdfDocsLight, apiKey)),
    runSection('roadmap',        5, '핵심 리스크 분석',   () => step5_roadmap(systemPrompt, studentData, pdfDocsLight, apiKey)),
    runSection('recordFeedback', 6, '실행 계획 작성',     () => step6_recordFeedback(systemPrompt, studentData, pdfDocsLight, apiKey)),
  ]);

  // 4단계(지원 전략)는 1~3단계 요약을 참고
  await runSection('strategy', 4, '수시 지원 전략 수립', () => {
    const prevSummary = `학업:${results.academic?.slice(0,200)}\n비교과:${results.activity?.slice(0,200)}\n진로:${results.career?.slice(0,200)}`;
    return step4_strategy(systemPrompt, studentData, prevSummary, pdfDocsLight, apiKey);
  });

  // 7단계(종합 평가)는 전체 분석을 종합
  await runSection('dashboard', 7, '종합 평가 생성', () => {
    const allAnalysis = Object.values(results).filter(Boolean).join('\n\n');
    return step7_dashboard(systemPrompt, studentData, allAnalysis, pdfDocsLight, apiKey);
  });

  onProgress?.({ step: 8, label: '분석 완료!' });
  return results;
};
