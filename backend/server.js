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
    res.status(500).json({ success: false, error: err.message, stack: err.stack?.split('\n').slice(0, 3) });
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
      model: 'claude-opus-4-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'test' }],
    });
    return res.json({ success: true, message: 'Claude 연결 성공' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
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
  const apiKey = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    send({ type: 'progress', step: 0, label: 'Google Drive 지식베이스 로딩 중...', total: 9 });

    const [knowledgeBase, studentDriveFiles] = await Promise.all([
      loadKnowledgeBase(),
      loadStudentFiles(studentData.name),
    ]);

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
  console.log(`📁 Drive 연결 테스트: http://localhost:${PORT}/api/drive/test\n`);
});
