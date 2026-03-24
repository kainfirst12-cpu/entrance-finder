import express from 'express';
import cors from 'cors';
import multer from 'multer';
import 'dotenv/config';
import { loadKnowledgeBase, loadStudentFiles } from './services/driveService.js';
import { runFullAnalysis } from './services/claudeService.js';
import { generateAnalysisPDF } from './services/pdfService.js';
import jwt from 'jsonwebtoken';
import Anthropic from '@anthropic-ai/sdk';
import { runFullAnalysisGemini, testGeminiConnection } from './services/geminiService.js';
import { runFullAnalysisGPT, testGPTConnection } from './services/gptService.js';
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const pdfFields = upload.fields([
  { name: 'recordPdf',   maxCount: 1 },
  { name: 'gradePdf',    maxCount: 1 },
  { name: 'awardsPdf',   maxCount: 1 },
  { name: 'mockExamPdf', maxCount: 1 },
]);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/drive/test', async (req, res) => {
  try {
    const kb = await loadKnowledgeBase();
    const summary = {
      대입정책:  kb.대입정책.length  > 0 ? `✅ ${kb.대입정책.length}자 로딩됨`  : '❌ 파일 없음',
      대학별전형: kb.대학별전형.length > 0 ? `✅ ${kb.대학별전형.length}자 로딩됨` : '❌ 파일 없음',
      합격자사례: kb.합격자사례.length > 0 ? `✅ ${kb.합격자사례.length}자 로딩됨` : '❌ 파일 없음',
    };
    res.json({
      success: true,
      summary,
      env: {
        folderId: (process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID || '').trim().slice(0, 10) + '...',
        serviceAccount: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '(미설정)',
        hasPrivateKey: !!(process.env.GOOGLE_PRIVATE_KEY),
      },
    });
  } catch (err) {
    console.error('[Drive Test] 실패:', err.message);
    res.status(500).json({ success: false, error: err.message, stack: err.stack?.split('\n').slice(0, 3) });
  }
});
// ── 검증 결과 반영 최종 리포트 재생성 ──────────────────────
app.post('/api/refine', async (req, res) => {
  const { studentData, analysisText, verifyText, sectionKey } = req.body;
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음' });
  if (!analysisText) return res.status(400).json({ success: false, message: '분석 데이터 없음' });

  const studentName = studentData?.name || '학생';
  const systemPrompt = `당신은 대한민국 최고 수준의 입시 전문 컨설턴트입니다.
아래에 기존 AI 분석 결과와 다른 AI의 검증 피드백이 제공됩니다.
검증 피드백에서 지적된 문제점을 반영하여 기존 분석을 개선한 최종 버전을 작성하세요.

[출력 형식 원칙 — 최우선 준수]
- 이모티콘, 이모지, 유니코드 특수기호를 절대 사용하지 마라
- 허용되는 기호: 번호(1. 2. 3.), 기호(-, *, >), 대괄호([항목]), 구분선(──), 표 구분(|)만 사용
- 강조는 **볼드**만 사용
- 전문 컨설팅 보고서 톤을 유지하라

[개선 원칙]
1. 검증에서 지적된 오류(전공 혼동, 근거 없는 수치, 데이터 부재 처리 등)를 반드시 수정하라
2. 검증에서 인정한 강점은 유지하되, 지적된 약점은 보완하라
3. 학생의 희망 전공(${studentData?.major || '미입력'})을 절대 혼동하지 마라
4. 기존 분석의 형식과 구조를 유지하되, 내용의 정확성과 깊이를 개선하라
5. 수정된 부분은 자연스럽게 통합하고, 수정했다는 메타 표시는 하지 마라

[학생 정보]
이름: ${studentName}
학교: ${studentData?.school || '미입력'}
희망 전공: ${studentData?.major || '미입력'}
학년: ${studentData?.grade || '미입력'}`;

  try {
    let reply;
    const userMsg = sectionKey
      ? `아래는 [${sectionKey}] 섹션의 기존 분석 결과와 검증 피드백입니다. 이 섹션만 개선하여 재작성해 주세요.\n\n=== 기존 분석 ===\n${analysisText}\n\n=== 검증 피드백 ===\n${verifyText}`
      : `아래는 전체 분석 결과와 검증 피드백입니다. 검증 피드백을 반영하여 전체를 개선한 최종 버전을 작성해 주세요.\n\n=== 기존 분석 ===\n${analysisText}\n\n=== 검증 피드백 ===\n${verifyText}`;

    if (aiModel === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: getModelId('gemini', submodel || aiModel) });
      const result = await model.generateContent([{ text: systemPrompt }, { text: userMsg }]);
      reply = result.response.text();
    } else if (aiModel === 'gpt') {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model: getModelId('gpt', submodel || aiModel), max_tokens: 8000,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
      });
      reply = response.choices[0].message.content;
    } else {
      const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
      const client = new AnthropicSDK({ apiKey });
      const response = await client.messages.create({
        model: getModelId('claude', submodel || aiModel), max_tokens: 8000, system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      });
      reply = response.content[0].text;
    }

    res.json({ success: true, reply });
  } catch (err) {
    console.error(`[refine/${aiModel}] 오류:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── AI 연결 테스트 ──────────────────────────────────────
app.post('/api/test-connection', async (req, res) => {
  const { aiModel = 'claude' } = req.body;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음' });
  try {
    if (aiModel === 'gemini') {
      const text = await testGeminiConnection(apiKey);
      return res.json({ success: true, message: `Gemini 연결 성공: ${text}` });
    }
    if (aiModel === 'gpt') {
      const text = await testGPTConnection(apiKey);
      return res.json({ success: true, message: `GPT 연결 성공: ${text}` });
    }
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'test' }],
    });
    return res.json({ success: true, message: 'Claude 연결 성공' });
  } catch (err) {
    console.error(`[${aiModel}] 연결 테스트 실패:`, err.message, err.status || '', err.code || '');
    return res.status(500).json({ success: false, message: err.message });
  }
});
// ── 지식베이스 캐시 (채팅용 — 10분 TTL) ──────────────
let kbCache = null;
let kbCacheTime = 0;
const KB_TTL = 10 * 60 * 1000;

async function getCachedKnowledgeBase() {
  if (kbCache && Date.now() - kbCacheTime < KB_TTL) return kbCache;
  kbCache = await loadKnowledgeBase();
  kbCacheTime = Date.now();
  return kbCache;
}

// ── 모델 ID 매핑 ──────────────────────────────────────
const MODEL_IDS = {
  claude: 'claude-sonnet-4-6',
  'claude-opus': 'claude-opus-4-6',
  gemini: 'gemini-2.5-flash',
  'gemini-pro': 'gemini-2.5-pro',
  gpt: 'gpt-4o',
  'gpt-mini': 'gpt-4o-mini',
};
function getModelId(group, submodel) {
  return MODEL_IDS[submodel] || MODEL_IDS[group] || MODEL_IDS.claude;
}

// ── 채팅 엔드포인트 ──────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { message, history = [] } = req.body;
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음' });
  if (!message) return res.status(400).json({ success: false, message: '메시지 없음' });

  try {
    const kb = await getCachedKnowledgeBase();

    const systemPrompt = `당신은 대한민국 최고 수준의 입시 전문 컨설턴트입니다.
15년 이상의 학생부종합전형 컨설팅 경험을 보유하고 있으며 서울대·연세대·고려대 합격자를 다수 배출했습니다.

아래 지식베이스를 참고하여 사용자의 질문에 전문적으로 답변하세요.
지식베이스에 있는 내용을 우선 활용하고, 없는 내용은 일반 지식으로 보완하세요.
답변은 구체적이고 실행 가능한 조언을 포함하세요.

[출력 형식 원칙 — 최우선 준수]
- 이모티콘, 이모지, 유니코드 특수기호를 절대 사용하지 마라 (모든 이모지/이모티콘 금지)
- 허용되는 기호: 번호(1. 2. 3.), 기호(-, *, >), 대괄호([항목]), 구분선(──)만 사용
- 강조는 **볼드**만 사용
- 전문 컨설팅 보고서 톤을 유지하라

=== 지식베이스 — 대입정책 ===
${kb.대입정책 || '(자료 없음)'}

=== 지식베이스 — 대학별전형 ===
${kb.대학별전형 || '(자료 없음)'}

=== 합격자 사례 ===
${kb.합격자사례 || '(자료 없음)'}`;

    let reply;

    if (aiModel === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: getModelId('gemini', submodel) });
      const chatHistory = history.map(h => ({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.content }],
      }));
      const chat = model.startChat({
        history: [
          { role: 'user', parts: [{ text: '시스템 지침: ' + systemPrompt }] },
          { role: 'model', parts: [{ text: '네, 입시 전문 컨설턴트로서 답변하겠습니다.' }] },
          ...chatHistory,
        ],
      });
      const result = await chat.sendMessage(message);
      reply = result.response.text();

    } else if (aiModel === 'gpt') {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey });
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message },
      ];
      const response = await openai.chat.completions.create({
        model: getModelId('gpt', submodel),
        max_tokens: 4000,
        messages,
      });
      reply = response.choices[0].message.content;

    } else {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey });
      const messages = [
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message },
      ];
      const response = await client.messages.create({
        model: getModelId('claude', submodel),
        max_tokens: 4000,
        system: systemPrompt,
        messages,
      });
      reply = response.content[0].text;
    }

    res.json({ success: true, reply });
  } catch (err) {
    console.error(`[chat/${aiModel}] 오류:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── AI 교차 검증 엔드포인트 ──────────────────────────
app.post('/api/verify', async (req, res) => {
  const { studentData, analysisText, originalModel } = req.body;
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음' });
  if (!analysisText) return res.status(400).json({ success: false, message: '분석 데이터 없음' });

  const studentName = studentData?.name || '학생';
  const systemPrompt = `당신은 대한민국 최고 수준의 입시 전문 컨설턴트이자 분석 검증 전문가입니다.
다른 AI(${originalModel || 'AI'})가 작성한 입시 분석 결과를 검증하고 피드백을 제공합니다.

[검증 원칙]
1. 각 섹션별로 분석의 정확성, 논리적 일관성, 실현 가능성을 평가하라
2. 구체적인 수정 제안을 개별 항목으로 제시하라
3. 각 제안에는 해당 섹션, 문제점, 수정 방향을 명확히 포함하라

[출력 형식 — 반드시 JSON 배열로 출력]
아래 형식의 JSON 배열만 출력하라. 마크다운이나 설명 텍스트 없이 순수 JSON만 출력:

[
  {
    "section": "해당 섹션명 (예: 학업역량 심층 분석)",
    "type": "error" | "improve" | "add",
    "title": "지적 사항 한 줄 요약",
    "detail": "구체적 설명 (현재 문제점 + 수정 방향)",
    "priority": "high" | "medium" | "low"
  }
]

type 설명:
- "error": 사실 오류, 논리적 모순 (반드시 수정 필요)
- "improve": 개선 제안 (더 나은 분석 가능)
- "add": 누락된 관점 추가 제안

priority 설명:
- "high": 분석 신뢰도에 직접 영향
- "medium": 분석 품질 향상에 도움
- "low": 있으면 좋지만 필수는 아님

최소 5개, 최대 15개 항목을 제시하라.
이모티콘/이모지 절대 금지.

[학생 정보]
이름: ${studentName}
학교: ${studentData?.school || '미입력'}
계열: ${studentData?.major || '미입력'}`;

  try {
    let reply;

    if (aiModel === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: getModelId('gemini', submodel || aiModel) });
      const result = await model.generateContent([
        { text: systemPrompt },
        { text: `아래는 ${originalModel || '다른 AI'}가 작성한 분석 결과입니다. 검증해 주세요.\n\n${analysisText}` },
      ]);
      reply = result.response.text();

    } else if (aiModel === 'gpt') {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model: getModelId('gpt', submodel || aiModel),
        max_tokens: 4000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `아래는 ${originalModel || '다른 AI'}가 작성한 분석 결과입니다. 검증해 주세요.\n\n${analysisText}` },
        ],
      });
      reply = response.choices[0].message.content;

    } else {
      const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
      const client = new AnthropicSDK({ apiKey });
      const response = await client.messages.create({
        model: getModelId('claude', submodel || aiModel),
        max_tokens: 4000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: `아래는 ${originalModel || '다른 AI'}가 작성한 분석 결과입니다. 검증해 주세요.\n\n${analysisText}` },
        ],
      });
      reply = response.content[0].text;
    }

    res.json({ success: true, reply });
  } catch (err) {
    console.error(`[verify/${aiModel}] 오류:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/analyze', pdfFields, async (req, res) => {
  let studentData;
  try {
    studentData = JSON.parse(req.body.studentData);
  } catch {
    return res.status(400).json({ error: '학생 데이터 파싱 오류' });
  }

  if (!studentData?.name) return res.status(400).json({ error: '학생 이름 필수' });
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  try {
    send({ type: 'progress', step: 0, label: 'Google Drive 지식베이스 로딩 중...', total: 9 });

    // 전체 Drive 로딩을 20초 타임아웃으로 감싸기
    let knowledgeBase = { 대입정책: '', 대학별전형: '', 합격자사례: '' };
    let studentDriveFiles = '';
    try {
      const driveResult = await Promise.race([
        Promise.all([
          getCachedKnowledgeBase(),
          loadStudentFiles(studentData.name).catch(e => {
            console.error('[Analyze] 학생파일 오류:', e.message);
            return '';
          }),
        ]),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Drive 로딩 20초 초과')), 20000)),
      ]);
      knowledgeBase = driveResult[0];
      studentDriveFiles = driveResult[1];
    } catch (driveErr) {
      console.error('[Analyze] Drive 로딩 실패, 빈 데이터로 진행:', driveErr.message);
      // 캐시에 데이터가 있으면 그거라도 사용
      if (kbCache) knowledgeBase = kbCache;
    }

    // PDF 파일들을 base64로 변환해서 Claude에게 직접 전달
    const uploadedFiles = req.files || {};
    const pdfDocuments = [];

    const pdfLabels = {
      recordPdf: '생기부 원본',
      gradePdf: '성적표',
      awardsPdf: '수상내역',
      mockExamPdf: '모의고사 성적',
    };

    for (const [key, label] of Object.entries(pdfLabels)) {
      if (uploadedFiles[key]?.[0]) {
        const base64 = uploadedFiles[key][0].buffer.toString('base64');
        pdfDocuments.push({ label, base64 });
        send({ type: 'progress', step: 0, label: `${label} PDF 준비 중...`, total: 9 });
      }
    }

    send({ type: 'progress', step: 1, label: 'Drive 자료 로딩 완료!', total: 9 });

    const progressCb = (progress) => send({ type: 'progress', ...progress, total: 9 });
    let results;
    if (aiModel === 'gemini') {
      results = await runFullAnalysisGemini(studentData, knowledgeBase, studentDriveFiles, progressCb, pdfDocuments, apiKey);
    } else if (aiModel === 'gpt') {
      results = await runFullAnalysisGPT(studentData, knowledgeBase, studentDriveFiles, progressCb, pdfDocuments, apiKey);
    } else {
      results = await runFullAnalysis(studentData, knowledgeBase, studentDriveFiles, progressCb, pdfDocuments, apiKey);
    }

    send({ type: 'complete', results, notionUrl: null, message: '분석 완료!' });
    res.end();
  } catch (err) {
    console.error('분석 오류:', err);
    send({ type: 'error', message: err.message });
    res.end();
  }
});
app.post('/api/generate-pdf', async (req, res) => {
  try {
    const { analysisData, studentData } = req.body;
    if (!analysisData || !studentData) {
      return res.status(400).json({ success: false, error: '데이터 없음' });
    }
    const pdfBuffer = await generateAnalysisPDF(analysisData, studentData);
    const filename = encodeURIComponent(`${studentData.name || '학생'}_입시분석_리포트.pdf`);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.end(pdfBuffer);
  } catch (err) {
    console.error('PDF 생성 오류:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});
app.get('/api/students', async (req, res) => {
  res.json({ success: true, students: [] });
});
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === process.env.APP_PASSWORD) {
    const token = jwt.sign({ auth: true }, process.env.JWT_SECRET || 'secret', { expiresIn: '7d' });
    res.json({ success: true, token });
  } else {
    res.json({ success: false });
  }
});
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 입시-Finder 서버 실행 중: http://localhost:${PORT}`);
  console.log(`📁 Drive 연결 테스트: http://localhost:${PORT}/api/drive/test`);

  // 시작 시 Drive 환경변수 상태 출력 (디버그)
  const hasEmail = !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const hasKey = !!process.env.GOOGLE_PRIVATE_KEY;
  const keyLen = (process.env.GOOGLE_PRIVATE_KEY || '').length;
  const hasFolder = !!process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID;
  console.log(`📋 Drive 환경변수: email=${hasEmail}, key=${hasKey}(${keyLen}자), folder=${hasFolder}\n`);
});
