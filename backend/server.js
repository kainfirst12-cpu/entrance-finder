import express from 'express';
import cors from 'cors';
import multer from 'multer';
import 'dotenv/config';
import { loadKnowledgeBase, loadStudentFiles } from './services/driveService.js';
import { loadKnowledgeBaseRAG, ragAvailable } from './services/ragService.js';
import { runFullAnalysis } from './services/claudeService.js';
import { generateAnalysisPDF } from './services/pdfService.js';
import jwt from 'jsonwebtoken';
import Anthropic from '@anthropic-ai/sdk';
import { runFullAnalysisGemini, testGeminiConnection } from './services/geminiService.js';
import { runFullAnalysisGPT, testGPTConnection } from './services/gptService.js';
import { searchAdmissionCases } from './services/searchService.js';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ── PDF → 이미지 변환 (poppler pdftoppm 사용) ──────────
async function convertPdfToImages(pdfBuffer, maxPages = 16) {
  const tmpDir = join(tmpdir(), `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  const pdfPath = join(tmpDir, 'input.pdf');
  writeFileSync(pdfPath, pdfBuffer);

  try {
    execSync(`pdftoppm -png -r 200 -l ${maxPages} "${pdfPath}" "${join(tmpDir, 'page')}"`, {
      timeout: 60000,
    });

    const files = readdirSync(tmpDir)
      .filter(f => f.startsWith('page') && f.endsWith('.png'))
      .sort();

    const images = files.map(f => {
      const imgBuffer = readFileSync(join(tmpDir, f));
      return imgBuffer.toString('base64');
    });

    console.log(`[PDF→Image] ${images.length}페이지 변환 완료`);
    return images;
  } finally {
    try {
      readdirSync(tmpDir).forEach(f => unlinkSync(join(tmpDir, f)));
      rmdirSync(tmpDir);
    } catch {}
  }
}
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const pdfFields = upload.fields([
  { name: 'recordPdf',   maxCount: 1 },
  { name: 'gradePdf',    maxCount: 1 },
  { name: 'awardsPdf',   maxCount: 1 },
  { name: 'mockExamPdf', maxCount: 1 },
]);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── PDF 진단 엔드포인트 ──────────────────────────────
import pdfParse from 'pdf-parse';
app.post('/api/test-pdf', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: 'PDF 파일이 수신되지 않았습니다' });
    const { buffer, size, originalname, mimetype } = req.file;
    console.log(`[PDF Test] 파일: ${originalname}, 크기: ${size}, MIME: ${mimetype}`);
    const base64 = buffer.toString('base64');

    let extractedText = '';
    let koreanChars = 0;
    try {
      const data = await pdfParse(buffer);
      extractedText = data.text.slice(0, 3000);
      koreanChars = (extractedText.match(/[가-힣]/g) || []).length;
    } catch (e) {
      extractedText = `추출 실패: ${e.message}`;
    }

    // 이미지 변환 테스트
    let imageCount = 0;
    try {
      const images = await convertPdfToImages(buffer, 3);
      imageCount = images.length;
    } catch (e) {
      console.error('[PDF Test] 이미지 변환 실패:', e.message);
    }

    res.json({
      success: true,
      filename: originalname,
      size: `${(size / 1024).toFixed(1)}KB`,
      mimetype,
      base64Length: base64.length,
      textPreview: extractedText.slice(0, 500),
      textLength: extractedText.length,
      koreanChars,
      imageConversion: imageCount > 0 ? `${imageCount}페이지 변환 성공` : '변환 실패',
      willUseImages: koreanChars < 50,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/drive/test', async (req, res) => {
  const major = req.query.major || '컴퓨터공학/SW';
  try {
    const kb = await loadKnowledgeBase(major);
    const summary = {
      테스트계열: major,
      대입정책:  kb.대입정책.length  > 0 ? `${kb.대입정책.length}자 로딩됨`  : '파일 없음',
      대학별전형: kb.대학별전형.length > 0 ? `${kb.대학별전형.length}자 로딩됨` : '파일 없음',
      합격자사례: kb.합격자사례.length > 0 ? `${kb.합격자사례.length}자 로딩됨` : '파일 없음',
      총합: `${kb.대입정책.length + kb.대학별전형.length + kb.합격자사례.length}자`,
    };
    // 내용 미리보기 (각 500자)
    const preview = {
      대입정책_preview: kb.대입정책.slice(0, 500),
      합격자사례_preview: kb.합격자사례.slice(0, 500),
    };
    res.json({ success: true, summary, preview });
  } catch (err) {
    console.error('[Drive Test] 실패:', err.message);
    res.status(500).json({ success: false, error: err.message });
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

  // 지식베이스 로드 (합격자 사례 재참조를 위해)
  let kb;
  try {
    kb = await getCachedKnowledgeBase(studentData?.major);
  } catch (e) {
    console.warn('[refine] 지식베이스 로드 실패, 기존 분석 기반으로 진행:', e.message);
    kb = { 대입정책: '', 대학별전형: '', 합격자사례: '' };
  }

  const systemPrompt = `당신은 대한민국 최고 수준의 입시 전문 컨설턴트입니다.
아래에 기존 AI 분석 결과와 다른 AI의 검증 피드백이 제공됩니다.
검증 피드백에서 지적된 문제점을 반영하여 기존 분석을 개선한 최종 버전을 작성하세요.

[출력 형식 원칙 — 최우선 준수]
- 이모티콘, 이모지, 유니코드 특수기호를 절대 사용하지 마라
- 허용되는 기호: 번호(1. 2. 3.), 기호(-, *, >), 대괄호([항목]), 구분선(──), 표 구분(|)만 사용
- 강조는 **볼드**만 사용
- 전문 컨설팅 보고서 톤을 유지하라

[섹션 구분 — 절대 준수]
반드시 아래 8개 섹션 헤더를 정확히 사용하여 출력하라. 각 섹션은 반드시 아래 형식의 헤더로 시작해야 한다:
[0단계] AI 드라이브 사례 매칭 분석
[1단계] 학업역량 종합 분석
[2단계] 비교과 활동 평가
[3단계] 진로 역량 및 전공 적합성
[4단계] 수시 지원 전략
[5단계] 핵심 리스크 및 대응 방안
[6단계] 실행 계획
[7단계] 종합 평가 및 권고사항

각 섹션 헤더는 반드시 줄의 맨 앞에 위치해야 하며, 헤더 텍스트를 변형하지 마라.

[개선 원칙 — 최우선 준수]
1. **기존 분석 내용을 기본 골격으로 유지하라.** 검증 피드백은 기존 내용을 "보완/수정"하는 것이지, 기존 내용을 삭제하고 새로 쓰는 것이 아니다.
2. 검증에서 지적된 오류(전공 혼동, 근거 없는 수치 등)만 정확히 수정하라.
3. 검증에서 지적되지 않은 부분은 기존 분석을 그대로 유지하라. 임의로 내용을 축소하거나 생략하지 마라.
4. 검증에서 인정한 강점은 반드시 유지하고, 지적된 약점만 보완하라.
5. 학생의 희망 전공(${studentData?.major || '미입력'})을 절대 혼동하지 마라.
6. 기존 분석의 표, 수치, 구체적 데이터를 절대 삭제하지 마라. 검증에서 수치 오류를 지적한 경우에만 해당 수치를 수정하라.
7. 유사합격사례(0단계) 관련 지적이 있으면 아래 [합격자 사례]를 다시 참조하여 매칭을 재수행하라.
8. 세특 개선안(6단계) 관련 지적이 있으면 아래 [합격자 사례]의 세특 수준을 참고하여 Before/After를 재작성하라.
9. **각 섹션의 분량은 기존 분석과 동일하거나 더 많아야 한다.** 기존보다 짧아지면 안 된다.

[메타 표현 절대 금지 — 위반 시 분석 무효]
당신의 출력은 처음부터 그렇게 작성된 "정식 컨설팅 보고서"여야 한다. 검증 과정이 있었다는 흔적을 남기면 전문성이 무너진다.

다음 표현/패턴을 절대 사용하지 마라:
- "수정", "수정됨", "(수정)", "수정 사항", "수정하였습니다"
- "개선", "개선됨", "(개선)", "보완", "(보완)", "보완하였습니다"
- "검증", "검증 결과", "검증 피드백", "검증을 반영"
- "기존 분석", "기존 내용", "원래는", "원래 분석", "이전에는", "이전 분석"
- "지적된", "지적 사항", "지적되었으나"
- "재작성", "재작성하였습니다", "재구성"
- "변경 전 / 변경 후", "Before / After" (단, 6단계 세특 Before/After 표는 학생 작성 사례 비교이므로 허용)
- "AI 분석을 다듬어", "피드백을 반영하여"
- "정확성을 높이기 위해", "오류를 바로잡아"
- 기타 "이 보고서가 한번 검토를 거쳤다"는 인상을 주는 모든 메타언어

대신, 마치 처음부터 그렇게 분석한 것처럼 자연스럽고 단정적인 컨설팅 어조로 직접 서술하라. 수치를 바꿨으면 바뀐 수치만 적고, 표현을 다듬었으면 다듬은 표현만 적어라. 수정 사실 자체를 본문에 남기지 마라.

[표 형식 원칙]
- 지원 전략(4단계)은 반드시 마크다운 표(| |)로 출력하라. 카드 형태나 블록쿼트(>) 금지.
- 기존 분석에 표가 있었으면 반드시 표 형식을 유지하라.

[학생 정보]
이름: ${studentName}
학교: ${studentData?.school || '미입력'}
희망 전공: ${studentData?.major || '미입력'}
학년: ${studentData?.grade || '미입력'}

=== 합격자 사례 (재매칭 참조용) ===
${kb.합격자사례 || '(자료 없음)'}`;

  try {
    let reply;
    const userMsg = sectionKey
      ? `아래는 [${sectionKey}] 섹션의 기존 분석 결과와 검증 피드백입니다. 이 섹션만 개선하여 재작성해 주세요.\n기존 내용을 기본 골격으로 유지하고, 검증에서 지적된 부분만 수정/보완하라. 기존 내용을 삭제하거나 축소하지 마라.\n\n=== 기존 분석 ===\n${analysisText}\n\n=== 검증 피드백 ===\n${verifyText}`
      : `아래는 전체 분석 결과와 검증 피드백입니다.\n**핵심 규칙: 기존 분석의 모든 내용을 기본 골격으로 유지하라. 검증에서 지적된 부분만 수정/보완하고, 지적되지 않은 부분은 그대로 살려라. 기존 내용을 삭제/축소/생략하지 마라.**\n모든 섹션을 [N단계] 헤더와 함께 빠짐없이 출력하라.\n\n=== 기존 분석 ===\n${analysisText}\n\n=== 검증 피드백 ===\n${verifyText}`;

    // 섹션 단일 재생성은 8K로 충분, 전체 재생성은 32K 필요 (8단계 × 평균 ~2K)
    const refineMaxTokens = sectionKey ? 8000 : 32000;

    if (aiModel === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: getModelId('gemini', submodel || aiModel),
        generationConfig: { maxOutputTokens: refineMaxTokens },
      });
      const result = await model.generateContent([{ text: systemPrompt }, { text: userMsg }]);
      reply = result.response.text();
    } else if (aiModel === 'gpt') {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model: getModelId('gpt', submodel || aiModel),
        max_completion_tokens: Math.min(refineMaxTokens, 16384),
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
      });
      reply = response.choices[0].message.content;
    } else {
      const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
      const client = new AnthropicSDK({ apiKey });
      const stream = client.messages.stream({
        model: getModelId('claude', submodel || aiModel),
        max_tokens: refineMaxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      });
      const final = await stream.finalMessage();
      reply = final.content.map(b => b.type === 'text' ? b.text : '').join('');
    }

    res.json({ success: true, reply });
  } catch (err) {
    console.error(`[refine/${aiModel}] 오류:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── AI 채팅 수정 (대화형 — 특정 부분만 수정) ──────────────
app.post('/api/chat-edit', async (req, res) => {
  const { studentData, currentResults, userMessage, imageData } = req.body;
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];
  const hasImages = Array.isArray(imageData) && imageData.length > 0;

  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음' });

  const systemPrompt = `당신은 입시 컨설턴트이며, 기존 분석 리포트를 사용자의 요청에 따라 수정하는 **최고 권한**을 가지고 있습니다.

[당신의 권한]
- 모든 섹션의 내용을 자유롭게 수정, 보강, 재작성할 수 있습니다.
- 사용자의 요청이 합리적이면 대폭 수정도 가능합니다.
- 잘린 내용을 완전하게 복원/재작성할 수 있습니다.
- 기존 분석의 오류를 발견하면 바로 수정할 수 있습니다.

[출력 형식 — 반드시 준수]
1. 수정한 섹션만 출력하십시오. 변경하지 않은 섹션은 출력하지 마십시오.
2. 반드시 아래 8개 헤더 중에서만 사용하십시오 (0~7만 존재, 8 이상 금지):
   [0단계] AI 드라이브 사례 매칭 분석
   [1단계] 학업역량 종합 분석
   [2단계] 비교과 활동 평가
   [3단계] 진로 역량 및 전공 적합성
   [4단계] 수시 지원 전략
   [5단계] 핵심 리스크 및 대응 방안
   [6단계] 실행 계획
   [7단계] 종합 평가 및 권고사항
3. 새로운 내용 추가 시 가장 적절한 기존 섹션(0~7)에 포함시키십시오.
4. **출력 순서 (필수):**
   (1) 먼저 "=== 변경 사항 ===" 줄을 쓰고, 그 아래 무엇을 바꿨는지 2~3줄로 설명
   (2) 그 다음 반드시 수정된 섹션의 헤더를 줄 맨 앞에 쓰십시오. 예시:
       [1단계] 학업역량 종합 분석
       (수정된 전체 내용...)
5. **[중요] 헤더 형식 규칙:**
   - 헤더는 반드시 줄의 맨 앞에 "[N단계]"로 시작해야 합니다.
   - 헤더 앞에 #, **, 공백 등 어떤 문자도 붙이지 마십시오.
   - 올바른 예: [1단계] 학업역량 종합 분석
   - 잘못된 예: ## [1단계], **[1단계]**, # [1단계]
6. **[중요] 설명만 하지 마십시오. 반드시 수정된 섹션 본문을 전부 출력하십시오.**
   - "~를 수정하였습니다"라고만 쓰고 끝내면 안 됩니다.
   - 수정된 내용이 포함된 전체 섹션을 [N단계] 헤더 아래에 작성해야 합니다.
7. 문체: 합니다체. 이모지 금지.
8. **섹션을 재작성할 때는 반드시 처음부터 끝까지 완전하게 작성하십시오. 중간에 끊기거나 생략하지 마십시오.**

[학생 정보]
이름: ${studentData?.name || '미입력'} / 희망전공: ${studentData?.major || '미입력'} / 목표대학: ${studentData?.targetUniv || '미입력'}`;

  // 현재 리포트 내용을 전달 (수정 대상 섹션은 충분히 보내야 정확한 수정 가능)
  const currentText = Object.entries(currentResults || {})
    .filter(([_, v]) => v)
    .map(([k, v]) => {
      const sec = SECTION_MAP_SERVER.find(s => s.key === k);
      return sec ? `[${sec.num}단계] ${sec.title}\n${v.slice(0, 4000)}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  const imageNote = hasImages ? `\n\n[첨부 이미지] 사용자가 이미지 ${imageData.length}장을 첨부했습니다. 이미지의 내용(스크린샷, 자료 등)을 분석하여 수정 요청에 반영하십시오.` : '';
  const userMsg = `=== 현재 리포트 (0~7단계) ===\n${currentText}\n\n=== 사용자 수정 요청 ===\n${userMessage}${imageNote}\n\n[지시] 위 요청을 반영하여 해당하는 기존 섹션(0~7단계 중 하나)을 수정하십시오.
먼저 "=== 변경 사항 ===" 블록에서 무엇을 바꿨는지 설명하고, 그 아래에 [N단계] 헤더 + 수정된 전체 섹션을 출력하십시오.
주의: [8단계] 등 새로운 번호를 만들지 마십시오. 반드시 기존 0~7 중 선택하십시오.`;

  try {
    let reply;
    if (aiModel === 'gemini') {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: getModelId('gemini', submodel || aiModel), generationConfig: { maxOutputTokens: 16000 } });
      const parts = [{ text: systemPrompt }, { text: userMsg }];
      if (hasImages) {
        for (const img of imageData) {
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
        }
      }
      const result = await model.generateContent(parts);
      reply = result.response.text();
    } else if (aiModel === 'gpt') {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey });
      const userContent = hasImages
        ? [{ type: 'text', text: userMsg }, ...imageData.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } }))]
        : userMsg;
      const response = await openai.chat.completions.create({
        model: getModelId('gpt', submodel || aiModel), max_completion_tokens: 16000,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      });
      reply = response.choices[0].message.content;
    } else {
      const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
      const client = new AnthropicSDK({ apiKey });
      const userContent = hasImages
        ? [...imageData.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } })), { type: 'text', text: userMsg }]
        : userMsg;
      const stream = client.messages.stream({
        model: getModelId('claude', submodel || aiModel), max_tokens: 16000, system: systemPrompt,
        messages: [{ role: 'user', content: userContent }],
      });
      const final = await stream.finalMessage();
      reply = final.content.map(b => b.type === 'text' ? b.text : '').join('');
    }

    // 수정된 섹션 파싱 (마크다운 장식 허용: ##, **, 공백 등)
    // 먼저 마크다운 장식을 제거한 정규화 버전에서 파싱
    const cleanReply = reply.replace(/^(#{1,4}\s*|\*{1,2})\[(\d)단계\]/gm, '[$2단계]');
    const headerRegex = /^\[(\d)단계\]\s*.*/gm;
    const headers = [];
    let m;
    while ((m = headerRegex.exec(cleanReply)) !== null) {
      headers.push({ num: m[1], index: m.index, fullMatch: m[0] });
    }
    // cleanReply 기반으로 파싱하므로 이후도 cleanReply 사용
    const parseTarget = cleanReply;

    const changes = {};
    for (let i = 0; i < headers.length; i++) {
      const hdr = headers[i];
      const sec = SECTION_MAP_SERVER.find(s => s.num === hdr.num);
      if (!sec) continue;
      const start = hdr.index + hdr.fullMatch.length;
      const end = i + 1 < headers.length ? headers[i + 1].index : parseTarget.length;
      const content = parseTarget.slice(start, end).trim();
      if (content) changes[sec.key] = content;
    }

    // 헤더 앞의 설명 부분 추출
    const explanation = headers.length > 0
      ? parseTarget.slice(0, headers[0].index).trim()
      : parseTarget.slice(0, 500);

    console.log(`[chat-edit] 파싱 결과: ${headers.length}개 헤더 발견, 변경 섹션: ${Object.keys(changes).join(', ') || '없음'}`);

    res.json({
      success: true,
      explanation: explanation || '수정이 완료되었습니다.',
      changes,
      changedSections: Object.keys(changes).map(k => SECTION_MAP_SERVER.find(s => s.key === k)?.title).filter(Boolean),
      fullReply: reply,
    });
  } catch (err) {
    console.error(`[chat-edit/${aiModel}] 오류:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

const SECTION_MAP_SERVER = [
  { key: 'caseMatching',   num: '0', title: 'AI 드라이브 사례 매칭 분석' },
  { key: 'academic',       num: '1', title: '학업역량 종합 분석' },
  { key: 'activity',       num: '2', title: '비교과 활동 평가' },
  { key: 'career',         num: '3', title: '진로 역량 및 전공 적합성' },
  { key: 'strategy',       num: '4', title: '수시 지원 전략' },
  { key: 'roadmap',        num: '5', title: '핵심 리스크 및 대응 방안' },
  { key: 'recordFeedback', num: '6', title: '실행 계획' },
  { key: 'dashboard',      num: '7', title: '종합 평가 및 권고사항' },
];

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
const kbCacheByField = {};
const KB_TTL = 10 * 60 * 1000;

async function getCachedKnowledgeBase(studentMajor) {
  const key = studentMajor || '_default';
  const cached = kbCacheByField[key];
  if (cached && Date.now() - cached.time < KB_TTL) return cached.data;
  const data = await loadKnowledgeBase(studentMajor);
  kbCacheByField[key] = { data, time: Date.now() };
  return data;
}

// ── 모델 ID 매핑 (2026-05 기준 최신) ────────────────────
const MODEL_IDS = {
  claude: 'claude-sonnet-4-6',
  'claude-opus': 'claude-opus-4-7',
  gemini: 'gemini-3-flash-preview',
  'gemini-pro': 'gemini-3.1-pro-preview',
  gpt: 'gpt-5.5',
  'gpt-mini': 'gpt-5.4-mini',
  'gpt-4.1': 'gpt-5.4',
  'o3': 'gpt-5.5-pro',
  'o4-mini': 'gpt-5.4-nano',
};
function getModelId(group, submodel) {
  return MODEL_IDS[submodel] || MODEL_IDS[group] || MODEL_IDS.claude;
}

// ── 채팅 파일 업로드 (PDF 텍스트 추출 / 이미지 base64 변환) ──
const chatUpload = upload.array('files', 5);
app.post('/api/chat-upload', chatUpload, async (req, res) => {
  try {
    const files = req.files || [];
    const results = [];
    for (const file of files) {
      if (file.mimetype === 'application/pdf') {
        try {
          const parsed = await pdfParse(file.buffer);
          results.push({ name: file.originalname, type: 'pdf', text: parsed.text.slice(0, 8000) });
        } catch (e) {
          results.push({ name: file.originalname, type: 'pdf', text: `[PDF 추출 실패: ${e.message}]` });
        }
      } else if (file.mimetype.startsWith('image/')) {
        const base64 = file.buffer.toString('base64');
        results.push({ name: file.originalname, type: 'image', mimeType: file.mimetype, base64 });
      }
    }
    res.json({ success: true, files: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── 채팅 엔드포인트 (파일 컨텍스트 + 분석 컨텍스트 지원) ──
app.post('/api/chat', async (req, res) => {
  const { message, history = [], analysisContext, fileContents, imageData } = req.body;
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음' });
  if (!message) return res.status(400).json({ success: false, message: '메시지 없음' });

  try {
    const kb = await getCachedKnowledgeBase(null);

    // 분석 컨텍스트가 있으면 시스템 프롬프트에 포함
    let analysisSection = '';
    if (analysisContext) {
      const { studentData, results } = analysisContext;
      analysisSection = `\n=== 현재 로드된 분석 데이터 ===
학생: ${studentData?.name || '미입력'} / 전공: ${studentData?.major || '미입력'} / 목표: ${studentData?.targetUniv || '미입력'}
${Object.entries(results || {}).filter(([_, v]) => v).map(([k, v]) => `[${k}] ${v.slice(0, 2000)}`).join('\n\n')}
=== 분석 데이터 끝 ===
사용자가 위 분석 데이터에 대해 질문하면 해당 내용을 참고하여 답변하라.`;
    }

    // 파일 컨텍스트 (PDF 텍스트)
    let fileSection = '';
    if (fileContents && fileContents.length > 0) {
      fileSection = '\n=== 사용자가 첨부한 파일 내용 ===\n' +
        fileContents.map(f => `[${f.name}]\n${f.text}`).join('\n\n') +
        '\n=== 첨부 파일 끝 ===\n위 파일 내용을 참고하여 답변하라.';
    }

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
${kb.합격자사례 || '(자료 없음)'}${analysisSection}${fileSection}`;

    let reply;

    // 이미지가 포함된 경우 멀티모달 메시지 구성
    const hasImages = imageData && imageData.length > 0;

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
      const parts = [{ text: message }];
      if (hasImages) {
        for (const img of imageData) {
          parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
        }
      }
      const result = await chat.sendMessage(parts);
      reply = result.response.text();

    } else if (aiModel === 'gpt') {
      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey });
      const userContent = hasImages
        ? [{ type: 'text', text: message }, ...imageData.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } }))]
        : message;
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userContent },
      ];
      const response = await openai.chat.completions.create({
        model: getModelId('gpt', submodel),
        max_completion_tokens: 8000,
        messages,
      });
      reply = response.choices[0].message.content;

    } else {
      const Anthropic = (await import('@anthropic-ai/sdk')).default;
      const client = new Anthropic({ apiKey });
      const userContent = hasImages
        ? [...imageData.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } })), { type: 'text', text: message }]
        : message;
      const messages = [
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: userContent },
      ];
      const response = await client.messages.create({
        model: getModelId('claude', submodel),
        max_tokens: 8000,
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

// ── 채팅 검증 결과 반영 ──────────────────────────
app.post('/api/chat-refine', async (req, res) => {
  const { question, originalAnswer, verifyText, studentData } = req.body;
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음' });

  const systemPrompt = `당신은 대한민국 최고 수준의 입시 전문 컨설턴트입니다.
아래에 원본 답변과 다른 AI의 교차 검증 피드백이 제공됩니다.
검증 피드백에서 지적된 문제점을 반영하여 원본 답변을 개선한 최종 버전을 작성하세요.

[출력 형식 원칙]
- 이모티콘, 이모지, 유니코드 특수기호를 절대 사용하지 마라
- 허용 기호: 번호(1. 2. 3.), 기호(-, *, >), 대괄호([항목]), 구분선(──), 표 구분(|), 볼드(**) 만 허용
- 전문 컨설팅 보고서 톤 유지 (합니다체)

[개선 원칙]
1. 원본 답변의 구조·분량·표 형식을 그대로 유지하라. 삭제하거나 줄이지 마라.
2. 검증에서 지적된 오류·개선점만 정확히 반영하라.
3. 검증에서 지적되지 않은 내용은 원본 그대로 유지하라.
4. 메타 표현 절대 금지: "수정됨", "개선됨", "검증 반영", "기존 답변", "이전 답변" 등
5. 처음부터 그렇게 작성된 전문 답변처럼 자연스럽게 서술하라.`;

  const userMsg = `[원본 질문]\n${question || ''}\n\n[원본 답변]\n${originalAnswer}\n\n[교차 검증 피드백]\n${verifyText}\n\n위 검증 피드백을 반영하여 원본 답변을 개선해주세요.`;

  try {
    let reply;
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
        model: getModelId('gpt', submodel || aiModel),
        max_completion_tokens: 8000,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userMsg }],
      });
      reply = response.choices[0].message.content;
    } else {
      const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
      const client = new AnthropicSDK({ apiKey });
      const response = await client.messages.create({
        model: getModelId('claude', submodel || aiModel),
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
      });
      reply = response.content[0].text;
    }
    res.json({ success: true, reply });
  } catch (err) {
    console.error(`[chat-refine/${aiModel}] 오류:`, err.message);
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
        max_completion_tokens: 8000,
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
        max_tokens: 8000,
        system: systemPrompt,
        messages: [
          { role: 'user', content: `아래는 ${originalModel || '다른 AI'}가 작성한 분석 결과입니다. 검증해 주세요.\n\n${analysisText}` },
        ],
      });
      reply = response.content[0].text;
    }

    // 서버에서 JSON 파싱 시도 → 프론트엔드 파싱 실패 방지
    let parsedItems = null;
    try {
      let cleaned = reply.trim();
      // 마크다운 코드블록 제거
      const codeBlockMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
      if (codeBlockMatch) cleaned = codeBlockMatch[1].trim();
      // 1차: 전체 JSON 배열 파싱
      const jsonStart = cleaned.indexOf('[');
      const jsonEnd = cleaned.lastIndexOf(']');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        try {
          let jsonStr = cleaned.slice(jsonStart, jsonEnd + 1);
          jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
          const arr = JSON.parse(jsonStr);
          if (Array.isArray(arr) && arr.length > 0) parsedItems = arr;
        } catch { /* 전체 파싱 실패 → 개별 객체 추출 */ }
      }
      // 2차: 전체 파싱 실패 시 개별 JSON 객체를 하나씩 추출 (잘린 JSON 대응)
      if (!parsedItems) {
        const objectRegex = /\{[^{}]*"section"\s*:\s*"[^"]*"[^{}]*"type"\s*:\s*"[^"]*"[^{}]*\}/g;
        const matches = cleaned.match(objectRegex);
        if (matches && matches.length > 0) {
          const items = [];
          for (const m of matches) {
            try {
              const obj = JSON.parse(m);
              if (obj.section && obj.type) items.push(obj);
            } catch { /* skip */ }
          }
          if (items.length > 0) parsedItems = items;
        }
      }
    } catch (e) {
      console.warn('[verify] JSON 파싱 실패:', e.message);
    }
    console.log(`[verify] 파싱 결과: ${parsedItems ? parsedItems.length + '개 항목' : '실패'}`);

    res.json({ success: true, reply, parsedItems });
  } catch (err) {
    console.error(`[verify/${aiModel}] 오류:`, err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/analyze', pdfFields, async (req, res) => {
  let studentData;
  let reusedPdfTexts = '';
  let existingResults = null;
  let sectionsToRun = null;
  try {
    studentData = JSON.parse(req.body.studentData);
    if (req.body.pdfTexts) reusedPdfTexts = String(req.body.pdfTexts);
    if (req.body.existingResults) existingResults = JSON.parse(req.body.existingResults);
    if (req.body.sectionsToRun) {
      const parsed = JSON.parse(req.body.sectionsToRun);
      if (Array.isArray(parsed) && parsed.length > 0) sectionsToRun = parsed;
    }
  } catch (e) {
    return res.status(400).json({ error: '요청 데이터 파싱 오류: ' + e.message });
  }

  if (!studentData?.name) return res.status(400).json({ error: '학생 이름 필수' });
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'] || process.env.ANTHROPIC_API_KEY;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  // SSE keepalive: 8초마다 핑 전송 (Railway 프록시 타임아웃 방지)
  const keepAlive = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch {}
  }, 8000);

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  try {
    const useRAG = ragAvailable();
    send({
      type: 'progress',
      step: 0,
      label: useRAG
        ? 'RAG 벡터 검색으로 지식베이스 로딩 중...'
        : 'Google Drive 지식베이스 로딩 중...',
      total: 9,
    });

    let knowledgeBase = { 대입정책: '', 대학별전형: '', 합격자사례: '' };
    let studentDriveFiles = '';

    if (useRAG) {
      // RAG: 벡터 검색으로 관련 청크만 추출 (1~3초)
      try {
        const [ragKb, driveStudent] = await Promise.all([
          loadKnowledgeBaseRAG(studentData).catch(e => {
            console.error('[Analyze] RAG 실패:', e.message);
            return null;
          }),
          loadStudentFiles(studentData.name).catch(e => {
            console.error('[Analyze] 학생파일 오류:', e.message);
            return '';
          }),
        ]);
        if (ragKb) {
          knowledgeBase = ragKb;
          console.log(`[Analyze] RAG 성공 — 청크 ${ragKb._meta?.chunksUsed}개 사용`);
        } else {
          // RAG 실패 시 Drive fallback
          knowledgeBase = await getCachedKnowledgeBase(studentData.major);
        }
        studentDriveFiles = driveStudent;
      } catch (e) {
        console.error('[Analyze] RAG/Drive 모두 실패:', e.message);
      }
    } else {
      // RAG 벡터 없을 때 기존 Drive 방식
      try {
        const driveResult = await Promise.race([
          Promise.all([
            getCachedKnowledgeBase(studentData.major),
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
        if (kbCacheByField[studentData.major]?.data) knowledgeBase = kbCacheByField[studentData.major].data;
      }
    }

    // 합격자 사례가 부족하면 웹 검색으로 보완
    const caseLength = knowledgeBase.합격자사례?.length || 0;
    console.log(`[Analyze] 합격자사례: ${caseLength}자`);
    if (caseLength < 500) {
      console.log(`[Analyze] 합격자사례 부족 → 웹 검색 보완`);
      send({ type: 'progress', step: 0, label: '웹에서 합격 사례 검색 중...', total: 9 });
      try {
        const searchResults = await searchAdmissionCases(studentData.major, studentData.targetUniv);
        if (searchResults) {
          knowledgeBase.합격자사례 += searchResults;
          console.log(`[Analyze] 웹 검색 보완 완료 (${searchResults.length}자 추가)`);
        }
      } catch (searchErr) {
        console.warn('[Analyze] 웹 검색 실패:', searchErr.message);
      }
    }

    // PDF 파일들을 base64로 변환
    const uploadedFiles = req.files || {};
    const pdfDocuments = [];

    console.log('[Analyze] req.files 키:', Object.keys(uploadedFiles));

    const pdfLabels = {
      recordPdf: '생기부 원본',
      gradePdf: '성적표',
      awardsPdf: '수상내역',
      mockExamPdf: '모의고사 성적',
    };

    for (const [key, label] of Object.entries(pdfLabels)) {
      const file = uploadedFiles[key]?.[0];
      if (file) {
        const base64 = file.buffer.toString('base64');
        pdfDocuments.push({ label, base64 });
        console.log(`[Analyze] PDF 수신: ${label} (${(file.size / 1024).toFixed(1)}KB, base64 ${base64.length}자)`);
        send({ type: 'progress', step: 0, label: `${label} PDF 준비 완료 (${(file.size / 1024).toFixed(0)}KB)`, total: 9 });
      }
    }

    console.log(`[Analyze] 총 PDF ${pdfDocuments.length}개 준비 완료`);
    if (pdfDocuments.length === 0) {
      if (reusedPdfTexts) {
        // JSON 재분석 모드: 이전 추출 텍스트를 가짜 pdfDocument로 주입 (base64 없음 → buildUserMessage가 텍스트 전용 모드로 처리)
        pdfDocuments.push({
          label: '이전 분석 PDF 텍스트',
          base64: '',
          preExtractedText: reusedPdfTexts,
        });
        send({ type: 'progress', step: 0, label: `이전 분석의 PDF 텍스트 재사용 (${reusedPdfTexts.length}자)`, total: 9 });
        console.log(`[Analyze] 재분석 모드: PDF 텍스트 ${reusedPdfTexts.length}자 재사용`);
      } else {
        console.warn('[Analyze] 경고: PDF 파일이 하나도 수신되지 않았습니다!');
      }
    }

    // PDF 텍스트 추출 + 이미지 변환
    let preExtractedPdfText = reusedPdfTexts || '';
    if (pdfDocuments.length > 0) {
      const pdfParseModule = await import('pdf-parse');
      const pdfParseFunc = pdfParseModule.default;

      for (const pdf of pdfDocuments) {
        if (!pdf.base64) continue; // 재분석 모드: base64 없으면 추출 스킵 (preExtractedText 이미 있음)
        const buffer = Buffer.from(pdf.base64, 'base64');
        let text = '';

        // 1차: pdftotext (poppler) — 스캔 PDF가 아닌 경우 가장 정확
        try {
          const tmpPdf = join(tmpdir(), `analyze-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
          const tmpTxt = tmpPdf.replace('.pdf', '.txt');
          writeFileSync(tmpPdf, buffer);
          execSync(`pdftotext -enc UTF-8 "${tmpPdf}" "${tmpTxt}"`, { timeout: 10000 });
          text = readFileSync(tmpTxt, 'utf-8').trim().slice(0, 30000);
          try { unlinkSync(tmpPdf); unlinkSync(tmpTxt); } catch {}
          console.log(`[Analyze] pdftotext: ${pdf.label} → ${text.length}자`);
        } catch (e) {
          console.warn(`[Analyze] pdftotext 실패: ${pdf.label}`, e.message);
        }

        // 2차: pdf-parse 폴백
        const koreanChars1 = (text.match(/[가-힣]/g) || []).length;
        if (koreanChars1 < 50) {
          try {
            const data = await pdfParseFunc(buffer);
            const parsed = data.text.slice(0, 30000);
            const koreanParsed = (parsed.match(/[가-힣]/g) || []).length;
            if (koreanParsed > koreanChars1) {
              text = parsed;
              console.log(`[Analyze] pdf-parse: ${pdf.label} → ${data.text.length}자 (한글 ${koreanParsed}자)`);
            }
          } catch (e) {
            console.error(`[Analyze] pdf-parse도 실패: ${pdf.label}`, e.message);
          }
        }

        // 최종 한글 확인
        const koreanChars = (text.match(/[가-힣]/g) || []).length;
        console.log(`[Analyze] ${pdf.label}: 최종 한글 ${koreanChars}자 / 전체 ${text.length}자`);

        // 3차: 텍스트 추출 실패 → 스캔 PDF → 이미지 변환 (200 DPI)
        if (koreanChars < 50) {
          console.warn(`[Analyze] ${pdf.label}: 스캔 PDF로 판단 → 이미지 변환 시도!`);
          send({ type: 'progress', step: 0, label: `${pdf.label} 스캔 PDF 이미지 변환 중...`, total: 9 });
          try {
            const images = await convertPdfToImages(buffer, 12);
            pdf.images = images;
            console.log(`[Analyze] ${pdf.label}: ${images.length}페이지 이미지 변환 성공`);
            send({ type: 'progress', step: 0, label: `${pdf.label} ${images.length}페이지 이미지 변환 완료`, total: 9 });
          } catch (imgErr) {
            console.error(`[Analyze] 이미지 변환 실패: ${pdf.label}`, imgErr.message);
          }
        }

        if (koreanChars >= 50) {
          preExtractedPdfText += `[${pdf.label} 내용]\n${text}\n\n`;
        } else if (pdf.images?.length > 0) {
          preExtractedPdfText += `[${pdf.label}] 스캔 PDF — AI가 첨부 이미지에서 직접 읽어야 함\n\n`;
        } else {
          preExtractedPdfText += `[${pdf.label}] PDF 처리 실패\n\n`;
        }
      }

      for (const pdf of pdfDocuments) {
        pdf.preExtractedText = preExtractedPdfText;
      }
      send({ type: 'progress', step: 0, label: `PDF 처리 완료 (텍스트 ${preExtractedPdfText.length}자)`, total: 9 });
    }

    send({ type: 'progress', step: 1, label: 'Drive 자료 로딩 완료!', total: 9 });

    const progressCb = (progress) => send({ type: 'progress', ...progress, total: 9 });
    const analyzeOptions = { existingResults: existingResults || {}, sectionsToRun };
    let results;
    if (aiModel === 'gemini') {
      results = await runFullAnalysisGemini(studentData, knowledgeBase, studentDriveFiles, progressCb, pdfDocuments, apiKey, analyzeOptions);
    } else if (aiModel === 'gpt') {
      results = await runFullAnalysisGPT(studentData, knowledgeBase, studentDriveFiles, progressCb, pdfDocuments, apiKey, submodel, analyzeOptions);
    } else {
      results = await runFullAnalysis(studentData, knowledgeBase, studentDriveFiles, progressCb, pdfDocuments, apiKey, analyzeOptions);
    }

    clearInterval(keepAlive);
    // 클라이언트가 재분석 시 재사용할 수 있도록 추출된 PDF 텍스트도 함께 전달
    send({ type: 'complete', results, notionUrl: null, pdfTexts: preExtractedPdfText, message: '분석 완료!' });
    res.end();
  } catch (err) {
    clearInterval(keepAlive);
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
  try {
    const { listStudents } = await import('./services/notionService.js');
    const students = await listStudents();
    res.json({ success: true, students });
  } catch (err) {
    console.error('[/api/students] 오류:', err.message);
    res.status(500).json({ success: false, error: err.message, students: [] });
  }
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
