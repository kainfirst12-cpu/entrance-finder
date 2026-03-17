// services/claudeService.js
import Anthropic from '@anthropic-ai/sdk';



// ── System Prompt 생성 ─────────────────────────────────
const buildSystemPrompt = (knowledgeBase, studentDriveFiles) => `
당신은 대한민국 최고 수준의 입시 전문 컨설턴트입니다.
15년 이상의 학생부종합전형 컨설팅 경험을 보유하고 있으며 서울대·연세대·고려대 합격자를 다수 배출했습니다.

=== 분석 원칙 ===
1. 아래 [지식베이스]와 [합격자 사례]를 반드시 최우선으로 참조하라
2. 지식베이스에 없는 내용은 일반 지식을 보완적으로만 사용하라
3. 근거 없는 희망적 분석 금지 — 현실적이고 냉정하게 평가하라
4. 모든 평가는 수치와 근거를 반드시 포함하라
5. 합격자 사례와 직접 비교하여 갭을 수치로 명시하라

=== 지식베이스 — 대입정책 ===
${knowledgeBase.대입정책 || '(자료 없음)'}

=== 지식베이스 — 대학별전형 ===
${knowledgeBase.대학별전형 || '(자료 없음)'}

=== 합격자 사례 ===
${knowledgeBase.합격자사례 || '(자료 없음)'}

=== 학생 Drive 파일 ===
${studentDriveFiles || '(없음)'}
`;

// ── PDF 포함 메시지 빌더 ───────────────────────────────
const buildUserMessage = (promptText, pdfDocuments = []) => {
  if (!pdfDocuments.length) {
    return [{ role: 'user', content: promptText }];
  }

  // PDF가 있으면 document 형태로 함께 전달
  const content = [];

  // PDF 문서들 추가
  for (const pdf of pdfDocuments) {
    content.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdf.base64,
      },
      title: pdf.label,
      cache_control: { type: 'ephemeral' },
    });
  }

  // 텍스트 프롬프트 추가
  content.push({ type: 'text', text: promptText });

  return [{ role: 'user', content }];
};

// ── Claude 호출 헬퍼 ──────────────────────────────────
const callClaude = async (systemPrompt, userPrompt, maxTokens = 2000, pdfDocuments = [], apiKey = null) => {
  const client = new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY }); // ← 추가
  const messages = buildUserMessage(userPrompt, pdfDocuments);
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
  });
  return response.content[0].text;
};

// ══════════════════════════════════════════════════════
// 8단계 분석
// ══════════════════════════════════════════════════════

export const step0_caseMatching = async (systemPrompt, studentData, pdfDocuments, apiKey) => {

  const prompt = `
[0단계: Drive 사례 매칭 탐색]
학생: ${studentData.name} / 희망전공: ${studentData.major} / 내신: ${studentData.gpa}등급 / 목표: ${studentData.targetUniv}
${pdfDocuments.length ? `\n첨부된 PDF(${pdfDocuments.map(p=>p.label).join(', ')})를 먼저 읽고 학생 정보를 파악한 후 분석하라.` : ''}

[합격자 사례] 자료에서 가장 유사한 사례를 찾아라.
매칭 기준: 1순위-희망전공 일치, 2순위-내신±0.5등급, 3순위-비교과 유형, 4순위-전형 유형

출력:
■ 매칭된 사례: X건
■ TOP 3 사례: 대학/학과 — 유사도 XX% — 유사 이유
■ 주요 참조 사례 및 분석 방향
`;
return callClaude(systemPrompt, prompt, 1000, pdfDocuments, apiKey);
};


export const step1_academic = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[1단계: 학업역량 심층 분석]
${pdfDocuments.length ? `첨부 PDF(${pdfDocuments.map(p=>p.label).join(', ')})의 내용을 직접 읽고 분석하라.` : ''}
학생 입력 데이터: 내신 ${studentData.gpa}등급 / 모의고사 ${studentData.mockExam || '미입력'} / 과목선택: ${studentData.subjectPlan || '미입력'}

─────────────────────────────────────
📊 내신 등급 비교표
─────────────────────────────────────
과목       | 현재 학생 | 합격자 평균 | 차이 | 평가
국어       |          |            |      |
수학       |          |            |      |
영어       |          |            |      |
탐구(평균) |          |            |      |
전체 평균  |          |            |      |
─────────────────────────────────────
※ PDF에서 실제 성적 데이터 추출하여 작성. 없으면 입력 데이터 활용.

📝 세특 질적 평가 (PDF 내용 기반)
[현재 학생 세특 수준]
[합격자 세특 수준 — Drive 사례 기준]
→ 갭 분석 및 개선 방향

🎯 학업역량 종합: X/10
강점 3가지 (근거 포함) / 약점 3가지 + 개선 방향
`;
  return callClaude(systemPrompt, prompt, 2000, pdfDocuments, apiKey);
};

export const step2_activity = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[2단계: 비교과 활동 사례 매칭 비교]
${pdfDocuments.length ? `첨부 PDF에서 비교과 활동 내용을 직접 읽고 분석하라.` : ''}
입력 데이터: 동아리-${studentData.club} / 봉사-${studentData.volunteer} / 리더십-${studentData.leadership} / 수상-${studentData.awards} / 특기-${studentData.talent}

🔍 활동 유사도 매칭 결과 (Drive 사례 기준)
현재 학생 활동 | 매칭된 합격자 활동 | 유사도 | 차이점

📋 활동 깊이 비교 분석
항목 | 현재 학생 | 합격자 수준 | 개선 방향

비교과 종합: X/10 / 스토리 일관성: X/10
`;
  return callClaude(systemPrompt, prompt, 2000, pdfDocuments, apiKey);
};

export const step3_career = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[3단계: 진로 역량 및 전공 적합성 분석]
${pdfDocuments.length ? `첨부 PDF에서 진로 관련 내용을 직접 읽고 분석하라.` : ''}
희망전공: ${studentData.major} / 목표대학: ${studentData.targetUniv} / 관심분야: ${studentData.interests}

🎯 전공 적합성 체크리스트
역량 항목 | 보유 여부 | 수준 | 보완 필요도
전공 관련 교과 성취 | | |
심화 탐구 경험 | | |
관련 활동 이력 | | |
핵심 과목 이수 | | |

📚 과목 선택 전략 평가 (고교학점제)
필수 과목 이수 여부 / 권장 과목 / 미이수 불이익 / 즉시 추가 과목

전공 적합성: X/10 / 가장 시급한 보완 역량 TOP 3
`;
  return callClaude(systemPrompt, prompt, 2000, pdfDocuments, apiKey);
};

export const step4_strategy = async (systemPrompt, studentData, prevAnalysis, pdfDocuments) => {
  const prompt = `
[4단계: 지원 전략 수립 — 사례 기반]
앞선 분석 요약: ${prevAnalysis}
학생: 내신 ${studentData.gpa} / 모의 ${studentData.mockExam || '미입력'} / 목표 ${studentData.targetUniv} / ${studentData.major}

📊 전형 유형 추천 (비율 및 이유)
학생부종합: XX% / 학생부교과: XX% / 논술: XX% / 정시: XX%

🎯 수시 지원 카드 6장 (Drive 사례 근거 포함)

[상향 ①] 대학: / 학과: / 전형:
┌─────────────────────────────────┐
│ Drive 사례 근거:                 │
│ 합격 가능성: ★★☆☆☆ (XX%)       │
│ 필요 개선:                      │
└─────────────────────────────────┘

[상향 ②] / [적정 ①] / [적정 ②] / [안정 ①] / [안정 ②] — 동일 형식

⚠️ 핵심 리스크 3가지 + 대응 방안
`;
  return callClaude(systemPrompt, prompt, 3000, pdfDocuments, apiKey);
};

export const step5_roadmap = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[5단계: 3년 로드맵 — 합격자 타임라인 대조]
학생: ${studentData.name} / ${studentData.grade}학년 / 목표: ${studentData.targetUniv} ${studentData.major}

📅 학년별 합격자 vs 현재 학생 비교 로드맵

■ 고1 (기반 구축기)
시기 | 합격자 행동 (Drive 사례) | 현재 학생 목표
3월  |                          |
4-7월|                          |
8-12월|                         |
고1 핵심 메시지 / 내신 목표 / 세특 목표 / 비교과 목표

■ 고2 (심화 차별화기)
핵심 과제 3가지 / 심화 탐구 추천 주제 2개 / 과목 선택 확정 사항

■ 고3 (완성·집대성기)
수시 일정 / 면접 준비 방향 / 정시 대비 전략

📌 이번 달 즉시 실행 액션 3가지
① [긴급] ② [중요] ③ [준비]
`;
  return callClaude(systemPrompt, prompt, 2500, pdfDocuments, apiKey);
};

export const step6_recordFeedback = async (systemPrompt, studentData, pdfDocuments, apiKey) => {
  const prompt = `
[6단계: 세특 Before/After 개선안]
${pdfDocuments.length ? `첨부 생기부 PDF를 직접 읽고 각 교과 세특을 분석하라.` : `세특 내용: ${studentData.specialNotes || '(미입력)'}`}
수상: ${studentData.awards} / 관심분야: ${studentData.interests}

주요 교과별로 아래 형식 출력:

─────────────────────────────────────
✏️ [교과명] 세특 개선안
─────────────────────────────────────
현재 수준: 상/중/하

❌ 현재 (개선 전): "(현재 기록된 내용)"
→ 문제점: · · ·

✅ 개선 후 (합격자 수준으로 직접 작성):
"(구체적 탐구 과정이 담긴 개선 문장)"

→ 개선 포인트: ① 탐구 계기 → ② 어려움 → ③ 해결 → ④ 공유 → ⑤ 발전
─────────────────────────────────────

💬 담당 선생님께 전달할 세특 요청 문구
(바로 사용 가능한 실제 대화 스크립트)
`;
  return callClaude(systemPrompt, prompt, 2500, pdfDocuments, apiKey);
};

export const step7_dashboard = async (systemPrompt, studentData, allAnalysis, pdfDocuments) => {
  const prompt = `
[7단계: 종합 대시보드]
지금까지 분석: ${allAnalysis.slice(0, 2000)}

1. 한눈에 보는 종합 요약:

─────────────────────────────────────
🎓 ${studentData.name} 입시 컨설팅 종합 리포트
분석일: ${new Date().toLocaleDateString('ko-KR')}
─────────────────────────────────────
📊 역량 레이더 (10점 만점)
학업역량    [████░░░░░░] X/10
비교과      [████░░░░░░] X/10
진로역량    [████░░░░░░] X/10
세특 질    [████░░░░░░] X/10
전공적합성  [████░░░░░░] X/10

🚨 즉시 실행 필요 (이번 달 안에)
① [긴급] ② [긴급] ③ [중요]

✅ 이미 잘 하고 있는 것
· ·

📌 다음 상담 전 준비사항
□ □ □
─────────────────────────────────────

2. Notion 저장용 JSON:
{
  "종합점수": {"학업역량":0,"비교과":0,"진로역량":0,"세특질":0,"전공적합성":0,"총점":0},
  "종합평가요약": "",
  "핵심강점": ["","",""],
  "핵심약점": ["","",""],
  "즉시실행과제": ["","",""]
}
`;
  return callClaude(systemPrompt, prompt, 2000, pdfDocuments, apiKey);
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
