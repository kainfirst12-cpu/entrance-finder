import express from 'express';
import cors from 'cors';
import multer from 'multer';
import 'dotenv/config';
import { loadKnowledgeBase, loadStudentFiles, loadAllKnowledgeDocs } from './services/driveService.js';
import { loadKnowledgeBaseRAG, ragAvailable } from './services/ragService.js';
import { refreshKbCount, countByType, clearKnowledge, ingestDocuments } from './services/vectorStore.js';
import {
  BOARD_COLUMNS, listStudents, getStudentOwner, createStudent, updateStudent, deleteStudent,
  addGrade, deleteGrade, addRecord, deleteRecord, listTeachers, getGradeOwner, getRecordOwner,
  upsertStudentByName, addFile, getFile, deleteFile, getFileStudentOwner,
  listPlacements, addPlacement, deletePlacement, getPlacementOwner,
  listSuhaeng, getSuhaeng, createSuhaeng, deleteSuhaeng, getSuhaengOwner,
  setStudentCode, getStudentByCode, getStudentDossier,
  getStudentIdByCode, countStudentUploads, deleteStudentUpload,
} from './services/boardStore.js';
import { searchEntries as searchIpgyeolEntries, REGIONS as IPG_REGIONS, TRACKS as IPG_TRACKS } from './services/ipgyeolSearch.js';
import { CONSULT_TOOLS, runConsultTool } from './services/consultAgent.js';
import {
  listRoadmaps, createRoadmap, updateRoadmap, deleteRoadmap,
  addItem as addRoadmapItem, updateItem as updateRoadmapItem, deleteItem as deleteRoadmapItem,
  getRoadmapOwner, getItemOwner as getRoadmapItemOwner,
  getRoadmapStudentId, getItemStudentId as getRoadmapItemStudentId,
} from './services/roadmapStore.js';
import { parseSheet, ingestRows, searchAdmissions, admissionStats, clearAdmissions } from './services/admissionStore.js';
import { runFullAnalysis } from './services/claudeService.js';
import { generateAnalysisPDF } from './services/pdfService.js';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  initDb, dbEnabled, vectorEnabled, ensureAdminUser,
  findActiveUserByCode, createUserCode, setUserActive, deleteUser,
  listUsersWithStats, listActiveSessions, listRecentLogs,
  createSession, touchSession, logEvent, lookupGeo,
} from './services/db.js';
import Anthropic from '@anthropic-ai/sdk';
import { runFullAnalysisGemini, testGeminiConnection } from './services/geminiService.js';
import { runFullAnalysisGPT, testGPTConnection } from './services/gptService.js';
import { searchAdmissionCases } from './services/searchService.js';
import { execSync, execFileSync } from 'child_process';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, unlinkSync, rmdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';

// 비밀번호는 사용자 입력이라 셸에 문자열로 붙이면 명령 주입이 된다.
// poppler 계열은 전부 execFileSync(인자 배열)로 호출해 셸을 아예 거치지 않는다.
const upwArgs = (password) => (password ? ['-upw', String(password)] : []);

// PDF 총 페이지 수 + 암호화 여부. 정부24 생기부는 기본이 비밀번호 보호라
// 이걸 구분하지 않으면 "빈 PDF"로 처리돼 근거 없는 리포트가 나간다.
function inspectPdf(pdfBuffer, password = '') {
  const tmpPdf = join(tmpdir(), `pginfo-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    writeFileSync(tmpPdf, pdfBuffer);
    try {
      const out = execFileSync('pdfinfo', [...upwArgs(password), tmpPdf], { timeout: 10000 }).toString();
      const m = /^Pages:\s+(\d+)/m.exec(out);
      const enc = /^Encrypted:\s+yes/mi.test(out);
      return { pages: m ? Number(m[1]) : 0, encrypted: enc, needsPassword: false };
    } catch (e) {
      const msg = String(e.stderr || e.message || '');
      // 비번이 없거나 틀리면 poppler가 'Incorrect password'를 낸다.
      if (/password/i.test(msg)) return { pages: 0, encrypted: true, needsPassword: true };
      return { pages: 0, encrypted: false, needsPassword: false };
    }
  } catch {
    return { pages: 0, encrypted: false, needsPassword: false };
  } finally {
    try { unlinkSync(tmpPdf); } catch {}
  }
}

// 기존 호출부 호환용
function getPdfPageCount(pdfBuffer, password = '') {
  return inspectPdf(pdfBuffer, password).pages;
}

// 스캔 생기부는 20~30페이지가 기본이다. 상한을 낮게 잡으면 뒷학년(2·3학년 교과 성적표·세특)이
// 통째로 잘려 AI가 "1학년 내신"을 최종 내신으로, 뒷학년 이수과목을 "미이수"로 단정한다.
// 이미지 1장당 토큰 비용이 있으므로 무한정 늘리지는 않되, 생기부 전체는 반드시 덮는다.
const PDF_IMAGE_PAGE_CAP = 40;

// 텍스트 생기부도 마찬가지다. 3개 학년 세특이 다 붙은 생기부는 5~6만자가 예사라
// 3만자에서 끊으면 딱 2학년 초입에서 잘린다. 컨텍스트가 감당하는 선까지 올린다.
const PDF_TEXT_CHAR_CAP = 120000;

// ── PDF → 이미지 변환 (poppler pdftoppm 사용) ──────────
// PNG 200DPI는 장당 3~5MB라 페이지가 늘면 요청이 터진다. JPEG 150DPI로 낮춰
// 화질(표의 숫자·등급 판독)은 유지하면서 전체 페이지를 담을 수 있게 한다.
async function convertPdfToImages(pdfBuffer, maxPages = 16, password = '') {
  const tmpDir = join(tmpdir(), `pdf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  const pdfPath = join(tmpDir, 'input.pdf');
  writeFileSync(pdfPath, pdfBuffer);

  try {
    // poppler가 jpeg 없이 빌드된 환경도 있어 실패하면 png로 떨어뜨린다.
    // png는 장당 용량이 커서 해상도를 함께 낮춰야 전체 페이지가 요청에 들어간다.
    let ext = /\.jpe?g$/, fmt = 'jpeg';
    try {
      execFileSync('pdftoppm', ['-jpeg', '-jpegopt', 'quality=82', '-r', '150', '-l', String(maxPages),
        ...upwArgs(password), pdfPath, join(tmpDir, 'page')], { timeout: 180000 });
    } catch (jpegErr) {
      console.warn(`[PDF→Image] jpeg 변환 실패 → png 폴백: ${jpegErr.message}`);
      readdirSync(tmpDir).filter(f => f.startsWith('page')).forEach(f => { try { unlinkSync(join(tmpDir, f)); } catch {} });
      execFileSync('pdftoppm', ['-png', '-r', '120', '-l', String(maxPages),
        ...upwArgs(password), pdfPath, join(tmpDir, 'page')], { timeout: 180000 });
      ext = /\.png$/; fmt = 'png';
    }

    const files = readdirSync(tmpDir)
      .filter(f => f.startsWith('page') && ext.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const images = files.map(f => {
      const imgBuffer = readFileSync(join(tmpDir, f));
      return imgBuffer.toString('base64');
    });

    const mb = images.reduce((s, b) => s + b.length, 0) / 1024 / 1024;
    console.log(`[PDF→Image] ${images.length}페이지 변환 완료 (${fmt}, base64 ${mb.toFixed(1)}MB)`);
    return images;
  } finally {
    try {
      readdirSync(tmpDir).forEach(f => unlinkSync(join(tmpDir, f)));
      rmdirSync(tmpDir);
    } catch {}
  }
}
// ── 범용 파일 텍스트 추출 (아카이브·수행평가 공용) ──────────
// poppler pdftotext — pdf-parse가 못 읽는 PDF(폰트 매핑 깨짐 등)의 2차 시도.
function popplerPdfText(pdfBuffer, password = '') {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const tmpPdf = join(tmpdir(), `xt-${stamp}.pdf`);
  const tmpTxt = join(tmpdir(), `xt-${stamp}.txt`);
  try {
    writeFileSync(tmpPdf, pdfBuffer);
    execFileSync('pdftotext', ['-enc', 'UTF-8', ...upwArgs(password), tmpPdf, tmpTxt], { timeout: 30000 });
    return readFileSync(tmpTxt, 'utf-8');
  } catch {
    return '';
  } finally {
    try { unlinkSync(tmpPdf); } catch {}
    try { unlinkSync(tmpTxt); } catch {}
  }
}

// 추출 텍스트가 '내용이 있는' 수준인지 — 스캔 PDF는 공백·페이지번호만 나온다.
function hasRealText(text) {
  return ((text || '').match(/[가-힣A-Za-z0-9]/g) || []).length >= 80;
}

// .hwpx (한글 2014+ 개방형식) = zip 안의 XML. Contents/section*.xml에서 <hp:t> 텍스트만 모은다.
async function extractHwpxText(buffer) {
  const AdmZip = (await import('adm-zip')).default;
  const zip = new AdmZip(buffer);
  const sections = zip.getEntries()
    .filter(e => /^Contents\/section\d+\.xml$/i.test(e.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true }));
  if (!sections.length) throw new Error('hwpx 본문(section XML)을 찾지 못했습니다');
  const decodeEntities = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, '&');
  const out = [];
  for (const s of sections) {
    const xml = s.getData().toString('utf-8');
    // 문단(<hp:p>) 단위로 줄을 나누고, 각 문단 안의 <hp:t> 런을 이어 붙인다.
    for (const para of xml.split(/<hp:p[ >]/).slice(1)) {
      const runs = [...para.matchAll(/<hp:t[^>]*>([\s\S]*?)<\/hp:t>/g)].map(m => decodeEntities(m[1].replace(/<[^>]+>/g, '')));
      const line = runs.join('').trim();
      if (line) out.push(line);
    }
  }
  return out.join('\n');
}

// .hwp (한글 v5 바이너리) = CFB(복합문서) 안 BodyText/Section* 스트림의 zlib 압축 레코드.
// HWPTAG_PARA_TEXT(67) 레코드에서 UTF-16LE 본문만 걷어낸다 (표·그림 등 컨트롤은 건너뜀).
async function extractHwpText(buffer) {
  const XLSX = (await import('xlsx')).default;
  const zlib = await import('zlib');
  const cfb = XLSX.CFB.read(buffer, { type: 'buffer' });
  const header = XLSX.CFB.find(cfb, 'FileHeader');
  if (!header) throw new Error('한글(HWP) 파일 헤더가 없습니다');
  const flags = Buffer.from(header.content).readUInt32LE(36);
  if (flags & 0x2) throw new Error('암호가 걸린 한글 문서입니다 — 암호를 해제하고 다시 올려주세요');
  if (flags & 0x4) throw new Error('배포용(편집제한) 한글 문서는 텍스트 추출이 불가합니다 — PDF로 저장해 올려주세요');
  const compressed = !!(flags & 0x1);
  const sections = cfb.FullPaths
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => /BodyText\/Section\d+$/.test(p))
    .sort((a, b) => a.p.localeCompare(b.p, undefined, { numeric: true }));
  if (!sections.length) throw new Error('한글 문서 본문(BodyText)을 찾지 못했습니다');
  let out = '';
  for (const { i } of sections) {
    let data = Buffer.from(cfb.FileIndex[i].content);
    if (compressed) data = zlib.inflateRawSync(data);
    let off = 0;
    while (off + 4 <= data.length) {
      const hdr = data.readUInt32LE(off); off += 4;
      const tag = hdr & 0x3FF;
      let size = (hdr >>> 20) & 0xFFF;
      if (size === 0xFFF) { size = data.readUInt32LE(off); off += 4; }
      if (tag === 67) { // HWPTAG_PARA_TEXT
        const end = Math.min(off + size, data.length);
        let i2 = off;
        while (i2 + 1 < end) {
          const c = data.readUInt16LE(i2);
          if (c >= 32) { out += String.fromCharCode(c); i2 += 2; }
          else if (c === 10 || c === 13) { out += '\n'; i2 += 2; }
          // 확장·인라인 컨트롤(그림·표·필드 등)은 자기 포함 8 WCHAR(16바이트)를 차지한다.
          else if ((c >= 1 && c <= 9) || c === 11 || c === 12 || (c >= 14 && c <= 23)) { i2 += 16; }
          else { i2 += 2; } // 0, 24~31 = 예약 문자
        }
        out += '\n';
      }
      off += size;
    }
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

// 스캔 PDF → 이미지 → AI 비전으로 본문 전사(OCR). 페이지를 나눠 여러 번 호출한다.
// 상한은 생기부 이미지 파이프라인과 동일한 40 — 23페이지 생기부가 12페이지 상한에 잘려
// 사고 났던 전례(2026-07-28)가 있어, 스캔 자료도 같은 기준으로 전체를 덮는다.
async function ocrPdfWithVision(pdfBuffer, { aiModel, submodel, apiKey, maxPages = PDF_IMAGE_PAGE_CAP }) {
  const info = inspectPdf(pdfBuffer);
  const pages = Math.min(info.pages || maxPages, maxPages);
  const images = await convertPdfToImages(pdfBuffer, pages);
  if (!images.length) throw new Error('PDF를 이미지로 변환하지 못했습니다');
  const mimeOf = (b64) => b64.startsWith('/9j/') ? 'image/jpeg' : 'image/png';
  const BATCH = 6;
  const parts = [];
  for (let i = 0; i < images.length; i += BATCH) {
    const batch = images.slice(i, i + BATCH).map(b64 => ({ mimeType: mimeOf(b64), base64: b64 }));
    const text = await callAIModel({
      aiModel, submodel, apiKey,
      systemPrompt: '당신은 문서 전사(OCR) 도우미입니다. 이미지 속 문서의 텍스트를 요약·해석 없이 그대로 옮겨 적습니다. 표는 마크다운 표로 옮깁니다. 읽을 수 없는 부분만 [판독불가]로 표시합니다.',
      userMsg: `문서 ${i + 1}~${i + batch.length}페이지입니다. 텍스트를 순서대로 그대로 옮겨 적어주세요.`,
      maxTokens: 12000,
      images: batch,
    });
    parts.push(text.trim());
  }
  const truncated = (info.pages || 0) > maxPages;
  return { text: parts.join('\n\n'), pages: images.length, totalPages: info.pages || images.length, truncated };
}

const app = express();
app.set('trust proxy', true); // Railway 프록시 뒤에서 실제 클라이언트 IP 파악
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// multipart 한글 파일명 보정 (multer가 latin1로 해석 → utf8 복원)
const fixFilename = (n) => {
  if (!n) return n;
  try {
    const fixed = Buffer.from(n, 'latin1').toString('utf8');
    // 복원 결과에 한글이 생기면 채택, 아니면 원본 유지
    return /[가-힣]/.test(fixed) ? fixed : n;
  } catch { return n; }
};

// 클라이언트 실제 IP 추출
const getIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
  req.socket?.remoteAddress || '';

// 토큰 검증 — 유효하면 req.user 세팅, 없거나 무효여도 통과 (사용량 추적용)
function optionalAuth(req, _res, next) {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* 무시 */ }
  }
  next();
}

// 토큰 필수
function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  const token = h?.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ success: false, message: '로그인이 필요합니다' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, message: '세션이 만료되었습니다. 다시 로그인해주세요.' });
  }
}

// 관리자 전용
function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: '관리자 전용 기능입니다' });
    next();
  });
}

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
[0단계] 합격자 사례 매칭 분석
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

  // 긴 생성 동안 Railway 프록시 타임아웃(Failed to fetch) 방지 — 8초마다 keepalive 핑
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 8000);
  const sendDone = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} clearInterval(keepAlive); res.end(); };

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

    sendDone({ success: true, reply });
  } catch (err) {
    console.error(`[refine/${aiModel}] 오류:`, err.message);
    sendDone({ success: false, message: err.message });
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
   [0단계] 합격자 사례 매칭 분석
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
  { key: 'caseMatching',   num: '0', title: '합격자 사례 매칭 분석' },
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
  'claude-opus': 'claude-opus-4-8',
  gemini: 'gemini-3.5-flash',
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

// ── 공통 AI 텍스트 호출 (claude/gpt/gemini) — 이미지(비전) 지원 ──
// images: [{ mimeType, base64 }]  — 캡처/사진을 모델이 직접 읽음(고해상도 인식)
async function callAIModel({ aiModel, submodel, apiKey, systemPrompt, userMsg, maxTokens = 8000, images = [] }) {
  const hasImages = Array.isArray(images) && images.length > 0;

  if (aiModel === 'gemini') {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelId = getModelId('gemini', submodel || aiModel);
    // pro 계열은 사고(thinking) 토큰이 maxOutputTokens 안에서 먼저 소모된다.
    // 한도를 그대로 두면 본문이 빈 문자열로 돌아온다(GPT pro와 같은 증상).
    const cap = Math.min(/pro/i.test(modelId) ? maxTokens + 8000 : maxTokens, 32000);
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: { maxOutputTokens: cap },
    });
    const parts = [{ text: systemPrompt }, { text: userMsg }];
    if (hasImages) for (const img of images) parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    const result = await model.generateContent(parts);
    const text = result.response.text();
    if (!String(text || '').trim()) {
      const fin = result.response.candidates?.[0]?.finishReason || 'UNKNOWN';
      throw new Error(`${modelId}: 응답이 비어 있습니다(finishReason=${fin}). 설정에서 pro가 아닌 모델을 선택해 주세요.`);
    }
    return text;
  }
  if (aiModel === 'gpt') {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });
    const modelId = getModelId('gpt', submodel || aiModel);

    // pro 계열(gpt-5.5-pro 등)은 chat/completions 를 지원하지 않고 Responses API 전용이다.
    // 그대로 부르면 404 "This is not a chat model" 이 나므로 처음부터 갈라 보낸다.
    const viaResponses = async () => {
      const content = [{ type: 'input_text', text: userMsg }];
      if (hasImages) for (const img of images) {
        content.push({ type: 'input_image', image_url: `data:${img.mimeType};base64,${img.base64}`, detail: 'high' });
      }
      // pro 계열은 추론 토큰을 먼저 쓴다. max_output_tokens 를 호출자가 준 값 그대로 두면
      // 추론만으로 예산을 다 써서 본문이 빈 문자열로 돌아온다(status=incomplete).
      // 실제로 parse 단계(1200)에서 추론 1200을 전부 소모하고 빈 응답이 나왔다. 여유분을 얹는다.
      const r = await openai.responses.create({
        model: modelId,
        instructions: systemPrompt,
        input: [{ role: 'user', content }],
        max_output_tokens: Math.min(maxTokens + 8000, 32000),
      });
      const text = r.output_text
        ?? (r.output || []).map(o => (o.content || []).map(c => c.text || '').join('')).join('');
      if (!String(text).trim()) {
        const why = r.incomplete_details?.reason === 'max_output_tokens'
          ? '추론 토큰이 출력 한도를 모두 소모했습니다'
          : `응답이 비어 있습니다(status=${r.status})`;
        throw new Error(`${modelId}: ${why}. 설정에서 pro가 아닌 모델을 선택해 주세요.`);
      }
      return text;
    };

    if (/-pro$/.test(modelId)) return viaResponses();

    const userContent = hasImages
      ? [{ type: 'text', text: userMsg },
         ...images.map(img => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: 'high' } }))]
      : userMsg;
    try {
      const response = await openai.chat.completions.create({
        model: modelId,
        max_completion_tokens: Math.min(maxTokens, 16384),
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      });
      return response.choices[0].message.content;
    } catch (err) {
      // 이름 규칙에서 벗어난 Responses 전용 모델이 나중에 추가돼도 죽지 않게
      if (/not a chat model/i.test(String(err?.message || ''))) return viaResponses();
      throw err;
    }
  }
  const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
  const client = new AnthropicSDK({ apiKey });
  const userContent = hasImages
    ? [...images.map(img => ({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.base64 } })),
       { type: 'text', text: userMsg }]
    : userMsg;
  const stream = client.messages.stream({
    model: getModelId('claude', submodel || aiModel),
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
  const final = await stream.finalMessage();
  return final.content.map(b => (b.type === 'text' ? b.text : '')).join('');
}

// ── AI 제공사 오류를 사람이 읽는 문장으로 ──────────────────
// SDK 오류를 그대로 내보내면 화면에 `400 {"type":"error",...}` 원문이 뜬다.
// 그러면 결제·키 문제가 "기능 고장"으로 읽혀서, 고칠 수 있는 사람이 고치질 못한다.
const AI_LABEL = { claude: 'Claude(Anthropic)', gpt: 'GPT(OpenAI)', gemini: 'Gemini(Google)' };
function friendlyAIError(err, group = 'claude') {
  const label = AI_LABEL[group] || AI_LABEL.claude;
  const other = group === 'gpt' ? 'Claude·Gemini' : group === 'gemini' ? 'Claude·GPT' : 'GPT·Gemini';
  const raw = String(err?.message || err || '');
  const t = raw.toLowerCase();
  const status = err?.status ?? err?.statusCode ?? null;
  const swap = `또는 ${other} 모델로 바꿔도 됩니다.`;

  // 잔액·쿼터 소진 — 키는 유효하지만 결제가 막힌 상태
  if (t.includes('credit balance is too low') || t.includes('insufficient_quota')
    || t.includes('exceeded your current quota') || t.includes('billing')) {
    return `${label} 크레딧이 부족해 AI 호출이 거부됐습니다. 제공사 콘솔에서 결제·크레딧을 충전해 주세요. ${swap}`;
  }
  // 키 자체가 틀렸거나 폐기됨
  if (status === 401 || status === 403 || t.includes('invalid x-api-key')
    || t.includes('incorrect api key') || t.includes('api key not valid') || t.includes('api_key_invalid')) {
    return `${label} API 키가 유효하지 않습니다. 설정에서 키를 다시 입력해 주세요. ${swap}`;
  }
  // 호출량 제한 — 잠시 뒤 재시도하면 풀린다
  if (status === 429 || t.includes('rate limit') || t.includes('rate_limit')) {
    return `${label} 호출량 제한에 걸렸습니다. 1~2분 뒤 다시 시도해 주세요. ${swap}`;
  }
  // 제공사 과부하·장애
  if (status === 529 || status === 503 || t.includes('overloaded')) {
    return `${label} 서버가 일시적으로 과부하 상태입니다. 잠시 뒤 다시 시도해 주세요. ${swap}`;
  }
  if (status >= 500) {
    return `${label} 서버 오류(${status})로 응답을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요. ${swap}`;
  }
  // 네트워크 계층 — 제공사에 닿지도 못한 경우
  if (t.includes('econnreset') || t.includes('etimedout') || t.includes('enotfound')
    || t.includes('fetch failed') || t.includes('socket hang up')) {
    return `${label} 서버에 연결하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.`;
  }
  // 그 밖의 오류는 원문을 짧게 붙여 둔다 — 단서까지 지우면 디버깅이 불가능해진다
  return `${label} 호출 실패: ${raw.slice(0, 200)}`;
}

// ── 수행평가: 결과물 작성 / 첨삭·평가 (SSE keepalive) ──────
app.post('/api/assessment/generate', optionalAuth, async (req, res) => {
  const { mode = 'create', subject, grade, kind, topic, requirements, referenceText, submissionText, rubric, images, current, instruction } = req.body || {};
  const imgList = Array.isArray(images) ? images.slice(0, 8) : [];
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음 (설정에서 입력)' });

  let systemPrompt, userMsg, maxTokens;
  const head = `[과목] ${subject || '미입력'} / [학년] ${grade || '미입력'} / [유형] ${kind || '미입력'}`;

  const imgNote = imgList.length > 0
    ? `\n\n[첨부 이미지] 캡처/사진 ${imgList.length}장이 첨부되었습니다. 이미지 속 글자(과제 양식, 안내문, 손글씨 등)를 꼼꼼히 읽어 내용에 반영하십시오.`
    : '';

  if (mode === 'verify') {
    if (!current?.trim()) return res.status(400).json({ success: false, message: '검증할 결과물이 없습니다' });
    systemPrompt = `당신은 수행평가 결과물을 검토하는 전문 교사입니다. 아래 결과물을 꼼꼼히 검토하여 피드백을 제시합니다.

[출력 — 마크다운, 이모지 금지]
## 강점 — 잘 작성된 점 2~3가지
## 점검이 필요한 점 — 사실/논리 오류, 근거 부족, 과장 등 (있으면 구체적으로)
## 보완 제안 — 더 좋게 만들 구체적 방법 (항목별)
간결하고 실질적으로. 결과물이 충실하면 솔직히 그렇게 평가.`;
    userMsg = `${head}\n[검토 대상 결과물]\n${current}`;
    maxTokens = 5000;
  } else if (mode === 'revise') {
    if (!current?.trim()) return res.status(400).json({ success: false, message: '수정할 결과물이 없습니다' });
    systemPrompt = `당신은 수행평가 결과물을 사용자의 요청대로 다듬는 전문 교사 보조입니다.
아래 결과물을 사용자의 수정 요청에 맞춰 개선하여 **전체를 다시 출력**합니다.

[원칙]
- 기존의 구조·분량은 유지하되 요청된 부분을 반영. 요청과 무관한 부분은 그대로 유지.
- 처음부터 그렇게 작성된 것처럼 자연스럽게 서술(수정·반영 같은 메타 표현 금지).
- 마크다운(# 제목, ##, 표 |, **굵게**, 목록). 이모지 금지.
- 결과물 전체를 빠짐없이 출력(잘리지 않게).`;
    userMsg = `[수정 요청]\n${instruction || '전반적으로 더 완성도 높게 다듬어 주세요.'}\n\n[현재 결과물]\n${current}`;
    maxTokens = 16000;
  } else if (mode === 'review') {
    if (!submissionText?.trim() && imgList.length === 0) return res.status(400).json({ success: false, message: '평가할 학생 제출물(텍스트 또는 이미지)이 없습니다' });
    systemPrompt = `당신은 대한민국 학교 수행평가 채점·첨삭 전문 교사입니다.
학생 제출물을 평가 기준에 따라 공정하고 구체적으로 평가합니다.

[출력 형식 — 마크다운]
1. ## 평가 요약  — 표로: | 평가 항목 | 배점 | 획득 | 코멘트 |
2. ## 잘된 점 — 구체적으로 3가지 내외
3. ## 개선이 필요한 점 — 항목별 구체적 지적 + 어떻게 고치면 좋을지
4. ## 개선 예시 — 학생 글에서 약한 문장/문단을 골라 Before → After로 다듬은 예시
[원칙] 이모지 금지. 합니다체. 표는 마크다운(| |). 학년 수준을 고려해 현실적으로 평가.`;
    userMsg = `${head}\n[수행평가 주제/과제]\n${topic || '미입력'}\n\n[평가 기준/루브릭]\n${rubric || requirements || '일반적인 학교 수행평가 기준에 따라 평가'}\n\n[학생 제출물]\n${submissionText || '(텍스트 없음 — 첨부 이미지에서 읽어 평가)'}${imgNote}`;
    maxTokens = 12000;
  } else {
    systemPrompt = `당신은 대한민국 ${subject || ''} 과목 수행평가를 돕는 전문 교사 보조입니다.
${grade || ''} 학생 수준에 맞춰 완성도 높은 수행평가 결과물을 작성합니다.

[출력 형식 — 마크다운]
- 맨 위에 # 제목
- 필요하면 ## 개요/목차
- 본문 전체를 완성형으로 작성(서론·본론·결론 또는 과제 성격에 맞는 구조)
- 표가 필요하면 마크다운 표(| |), 강조는 **굵게**, 목록은 - 또는 1.
[원칙] 이모지 금지. 합니다체(또는 과제 성격에 맞는 문체). 요구 분량·형식을 지킬 것.
주의: 학생이 그대로 베끼는 용도가 아니라 교사가 검토·수정할 초안이므로, 충실하고 구체적으로 작성하되 출처가 필요한 수치는 일반적 표현을 사용.`;
    userMsg = `${head}\n[주제/과제 설명]\n${topic || '미입력'}\n\n[요구사항(분량·형식 등)]\n${requirements || '제한 없음'}${referenceText ? `\n\n[참고 자료 — 반드시 활용]\n${referenceText.slice(0, 12000)}` : ''}${imgNote}\n\n위 수행평가의 완성된 결과물을 작성해 주세요.`;
    maxTokens = 16000;
  }

  // 긴 생성 동안 프록시 타임아웃(Failed to fetch) 방지
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 8000);
  const sendDone = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} clearInterval(keepAlive); res.end(); };

  try {
    const reply = await callAIModel({ aiModel, submodel, apiKey, systemPrompt, userMsg, maxTokens, images: imgList });
    if (req.user?.role === 'user' && req.user?.userId) {
      logEvent({ userId: req.user.userId, type: 'assessment', detail: `${mode === 'review' ? '첨삭' : '작성'} / ${subject || ''} ${kind || ''}`, ip: getIp(req) });
      if (req.user.jti) touchSession(req.user.jti);
    }
    sendDone({ success: true, reply });
  } catch (err) {
    console.error('[assessment/generate] 오류:', err.message);
    sendDone({ success: false, message: err.message });
  }
});

// ── 수행평가·아카이브: 업로드 파일에서 텍스트 추출 (pdf/docx/hwp/hwpx/txt) ──
// 스캔 PDF는 AI 키가 헤더로 오면 비전 OCR까지 폴백. OCR이 오래 걸려 SSE+keepalive로 응답
// (프론트 postForResult가 JSON/SSE 둘 다 처리하므로 구버전과도 호환).
app.post('/api/assessment/extract', upload.array('files', 10), async (req, res) => {
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'] || '';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 8000);
  const sendDone = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} clearInterval(keepAlive); res.end(); };

  try {
    const files = req.files || [];
    const parts = [];
    const notices = [];
    for (const f of files) {
      const name = fixFilename(f.originalname);
      let text = '';
      try {
        if (f.mimetype === 'application/pdf' || /\.pdf$/i.test(name)) {
          // 1차 pdf-parse → 2차 poppler → 3차 비전 OCR(키 필요)
          try { text = (await pdfParse(f.buffer)).text || ''; } catch { text = ''; }
          if (!hasRealText(text)) {
            const t2 = popplerPdfText(f.buffer);
            if (hasRealText(t2)) text = t2;
          }
          if (!hasRealText(text)) {
            const info = inspectPdf(f.buffer);
            if (info.needsPassword) throw new Error('비밀번호가 걸린 PDF입니다 — 암호를 해제한 사본으로 올려주세요');
            if (!apiKey) throw new Error('스캔(이미지) PDF입니다 — 설정에서 AI 키를 등록하면 자동 OCR로 읽어옵니다');
            console.log(`[extract] 스캔 PDF 비전 OCR 시작: ${name} (${info.pages}p)`);
            const ocr = await ocrPdfWithVision(f.buffer, { aiModel, submodel, apiKey });
            text = ocr.text;
            notices.push(`${name}: 스캔 PDF라 AI 판독(OCR)으로 읽었습니다 (${ocr.pages}/${ocr.totalPages}페이지${ocr.truncated ? ' — 뒷부분 생략됨' : ''}). 숫자·표는 원본과 대조해 주세요.`);
          }
        } else if (f.mimetype.includes('wordprocessingml') || /\.docx$/i.test(name)) {
          const mammoth = await import('mammoth');
          text = (await mammoth.extractRawText({ buffer: f.buffer })).value || '';
        } else if (/\.doc$/i.test(name)) {
          throw new Error('옛 워드(.doc) 형식은 지원되지 않습니다 — 워드에서 .docx 또는 PDF로 저장해 올려주세요');
        } else if (/\.hwpx$/i.test(name)) {
          text = await extractHwpxText(f.buffer);
        } else if (/\.hwp$/i.test(name)) {
          text = await extractHwpText(f.buffer);
          if (!hasRealText(text)) throw new Error('한글(.hwp) 본문을 읽지 못했습니다 — 한글에서 "PDF로 저장" 후 올려주세요');
        } else {
          text = f.buffer.toString('utf-8');
        }
      } catch (fileErr) {
        notices.push(`${name}: ${fileErr.message}`);
        continue;
      }
      if (text.trim()) parts.push(`[${name}]\n${text.trim()}`);
      else notices.push(`${name}: 텍스트를 추출하지 못했습니다`);
    }
    sendDone({ success: parts.length > 0 || files.length === 0, text: parts.join('\n\n'), notices, message: parts.length ? undefined : (notices.join(' / ') || '텍스트를 추출하지 못했습니다') });
  } catch (err) {
    console.error('[extract] 오류:', err.message);
    sendDone({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
// 수행평가 아카이브 — 업로드 자료 AI 정리 → 분야·주제·학교별 보관·재활용
// ══════════════════════════════════════════════════════

// 업로드 자료(추출 텍스트) → AI가 상세 정리 + 분류 필드 추출
app.post('/api/suhaeng/analyze', requireAuth, async (req, res) => {
  const { text, filename } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ success: false, message: '분석할 텍스트가 없습니다' });
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음 (설정에서 입력)' });

  const systemPrompt = `당신은 학원 수행평가 자료를 아카이브로 정리하는 전문 조교입니다.
업로드된 수행평가 자료(과제 안내문, 학생 결과물, 채점 기준 등)를 나중에 다른 학생 지도에 재활용할 수 있도록 상세히 정리합니다.

[출력 — 반드시 아래 형식. 첫 6줄은 분류 메타데이터, 그 뒤 정리 본문]
TITLE: (자료를 대표하는 짧은 제목)
SCHOOL: (자료에서 확인되는 학교명, 없으면 빈칸)
SUBJECT: (과목/분야 — 예: 국어, 수학, 통합과학, 영어)
TOPIC: (핵심 주제 한 줄)
GRADE: (학년 — 예: 고1, 중3, 확인 안 되면 빈칸)
KIND: (유형 — 보고서/글쓰기/발표/실험보고서/포트폴리오 등)

## 자료 개요
(무슨 자료인지, 어떤 과제였는지 2~4문장)
## 과제 요구사항 정리
(분량·형식·평가 기준 등 확인되는 요구사항. 표가 적절하면 마크다운 표)
## 내용 상세 정리
(자료의 핵심 내용을 구조적으로 정리 — 목차·논리 전개·사용된 근거·데이터 등)
## 재활용 포인트
(다른 학생을 미리 준비시킬 때 활용할 수 있는 포인트: 자주 나오는 평가 요소, 고득점 요령, 보완할 점)
[원칙] 이모지 금지, 합니다체, 사실만 정리(추측은 '추정'으로 표시).`;
  const userMsg = `[파일명] ${filename || '업로드 자료'}\n\n[자료 전문]\n${String(text).slice(0, 50000)}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 8000);
  const sendDone = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} clearInterval(keepAlive); res.end(); };
  try {
    const reply = await callAIModel({ aiModel, submodel, apiKey, systemPrompt, userMsg, maxTokens: 12000 });
    // 메타데이터 6줄 파싱
    const meta = {};
    for (const [key, field] of [['TITLE', 'title'], ['SCHOOL', 'school'], ['SUBJECT', 'subject'], ['TOPIC', 'topic'], ['GRADE', 'grade'], ['KIND', 'kind']]) {
      const m = reply.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
      meta[field] = (m?.[1] || '').trim();
    }
    const content = reply.replace(/^(TITLE|SCHOOL|SUBJECT|TOPIC|GRADE|KIND):.*$\n?/gm, '').trim();
    sendDone({ success: true, meta, content });
  } catch (err) {
    console.error('[suhaeng/analyze] 오류:', err.message);
    sendDone({ success: false, message: err.message });
  }
});

// 아카이브 CRUD (선생님별 분리)
app.get('/api/suhaeng', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    if (!req.user.userId) return res.status(400).json({ success: false, message: '소유자 없음 — 다시 로그인해 주세요' });
    res.json({ success: true, items: await listSuhaeng(req.user.userId, { q: req.query.q, school: req.query.school, subject: req.query.subject }) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/api/suhaeng', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    if (!req.user.userId) return res.status(400).json({ success: false, message: '소유자 없음 — 다시 로그인해 주세요' });
    res.json({ success: true, item: await createSuhaeng(req.user.userId, req.body) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.get('/api/suhaeng/:id', requireAuth, async (req, res) => {
  try {
    const item = await getSuhaeng(Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, message: '자료 없음' });
    if (req.user.role !== 'admin' && item.owner_id !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    res.json({ success: true, item });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/api/suhaeng/:id', requireAuth, async (req, res) => {
  try {
    const owner = await getSuhaengOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    await deleteSuhaeng(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
// 아카이브 자료를 학생에게 배정 (미리 준비용)
app.post('/api/suhaeng/:id/assign', requireAuth, async (req, res) => {
  try {
    const item = await getSuhaeng(Number(req.params.id));
    if (!item) return res.status(404).json({ success: false, message: '자료 없음' });
    if (req.user.role !== 'admin' && item.owner_id !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    const studentId = Number(req.body.studentId);
    if (!(await canEditStudent(req, studentId))) return res.status(403).json({ success: false, message: '학생 권한 없음' });
    const prefix = req.body.mode === 'prepare' ? '[미리 준비] ' : '';
    const record = await addRecord(studentId, {
      type: '수행평가', title: `${prefix}${item.title}${item.school ? ` (${item.school})` : ''}`,
      detail: [item.subject, item.topic].filter(Boolean).join(' · '),
      content: item.content,
    });
    res.json({ success: true, record });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── 수행평가/분석 결과 → Word(.docx) 다운로드 ──────────────
app.post('/api/assessment/docx', async (req, res) => {
  try {
    const { title, markdown } = req.body || {};
    if (!markdown) return res.status(400).json({ success: false, message: '내용 없음' });
    const { markdownToDocxBuffer } = await import('./services/docxService.js');
    const buffer = await markdownToDocxBuffer(title || '수행평가', markdown);
    const filename = encodeURIComponent(`${(title || '수행평가').replace(/[\\/:*?"<>|]/g, '_')}.docx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (err) {
    console.error('[assessment/docx] 오류:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
// 학생 관리 보드 (칸반) — 선생님별 분리 + 관리자 조망
// ══════════════════════════════════════════════════════

// 편집 권한: 관리자는 전체, 선생님은 본인 소유만
async function canEditStudent(req, studentId) {
  if (req.user?.role === 'admin') return true;
  const owner = await getStudentOwner(studentId);
  return owner != null && owner === req.user?.userId;
}

// 관리자: 선생님 목록 (+ 본인 '관리자(나)' 항목)
app.get('/api/board/teachers', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, me: { id: req.user.userId || null, name: '관리자 (나)' }, teachers: await listTeachers() });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 보드 학생 목록 — 선생님은 본인, 관리자는 teacherId 지정(없으면 본인 보드)
app.get('/api/board/students', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    const ownerId = Number(req.query.teacherId) || req.user.userId;
    if (!ownerId) return res.status(400).json({ success: false, message: '소유자 없음 — 다시 로그인해 주세요' });
    res.json({ success: true, columns: BOARD_COLUMNS, students: await listStudents(ownerId) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 자동 연동: 분석/수행평가 완료 시 학생 카드 upsert + 기록 추가 (선생님 전용)
app.post('/api/board/upsert', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.json({ success: false, skipped: true });
  if (!req.user.userId) {
    return res.json({ success: false, skipped: true, message: '보드에 배정하려면 다시 로그인해 주세요(토큰 갱신 필요)' });
  }
  try {
    const { name, school, grade, major, targetUniv, gpa, record } = req.body || {};
    if (!name?.trim()) return res.json({ success: false, skipped: true });
    // gpa(분석 폼에 입력한 전 교과 내신)는 여기서 학생 카드에 박아둔다.
    // 저장하지 않으면 입결 콘솔이 분석 본문에서 등급을 추정하게 되고, 그 추정이 틀리면 배치가 통째로 어긋난다.
    const g = gpa === '' || gpa == null ? null : Number(gpa);
    const student = await upsertStudentByName(req.user.userId, {
      name: name.trim(), school, grade, major, targetUniv,
      gpa: Number.isFinite(g) && g >= 1 && g <= 9 ? g : null,
    });
    if (record?.title || record?.type) await addRecord(student.id, record);
    res.json({ success: true, studentId: student.id });
  } catch (e) {
    console.error('[board/upsert] 오류:', e.message);
    res.json({ success: false, message: e.message });
  }
});

// 학생 카드 생성
app.post('/api/board/students', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    // 관리자가 다른 선생님 보드에 추가하려면 teacherId 지정, 아니면 본인 보드
    const ownerId = (req.user.role === 'admin' && Number(req.body.teacherId)) ? Number(req.body.teacherId) : req.user.userId;
    if (!ownerId) return res.status(400).json({ success: false, message: '소유자 없음 — 다시 로그인해 주세요' });
    res.json({ success: true, student: await createStudent(ownerId, req.body) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 학생 카드 수정 (상태 이동/메모/정보)
app.patch('/api/board/students/:id', requireAuth, async (req, res) => {
  try {
    if (!(await canEditStudent(req, Number(req.params.id)))) return res.status(403).json({ success: false, message: '권한 없음' });
    await updateStudent(Number(req.params.id), req.body);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 학생 카드 삭제
app.delete('/api/board/students/:id', requireAuth, async (req, res) => {
  try {
    if (!(await canEditStudent(req, Number(req.params.id)))) return res.status(403).json({ success: false, message: '권한 없음' });
    await deleteStudent(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 성적 추가 / 삭제
app.post('/api/board/students/:id/grades', requireAuth, async (req, res) => {
  try {
    if (!(await canEditStudent(req, Number(req.params.id)))) return res.status(403).json({ success: false, message: '권한 없음' });
    res.json({ success: true, grade: await addGrade(Number(req.params.id), req.body) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/api/board/grades/:id', requireAuth, async (req, res) => {
  try {
    const owner = await getGradeOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    await deleteGrade(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 활동 기록 추가 / 삭제
app.post('/api/board/students/:id/records', requireAuth, async (req, res) => {
  try {
    if (!(await canEditStudent(req, Number(req.params.id)))) return res.status(403).json({ success: false, message: '권한 없음' });
    res.json({ success: true, record: await addRecord(Number(req.params.id), req.body) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/api/board/records/:id', requireAuth, async (req, res) => {
  try {
    const owner = await getRecordOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    await deleteRecord(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 입결 콘솔 배치 기록 조회 / 추가 / 삭제
app.get('/api/board/students/:id/placements', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    if (!(await canEditStudent(req, Number(req.params.id)))) return res.status(403).json({ success: false, message: '권한 없음' });
    res.json({ success: true, placements: await listPlacements(Number(req.params.id)) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/api/board/students/:id/placements', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    if (!(await canEditStudent(req, Number(req.params.id)))) return res.status(403).json({ success: false, message: '권한 없음' });
    res.json({ success: true, placement: await addPlacement(Number(req.params.id), req.body) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/api/board/placements/:id', requireAuth, async (req, res) => {
  try {
    const owner = await getPlacementOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    await deletePlacement(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 학생 자료 묶음 — 입시상담·입결 콘솔에서 "이 학생 자료 불러오기"
// 기록 본문·성적·배치·로드맵을 한 번에 내려, 화면에서 고른 항목만 AI 컨텍스트로 넣게 한다.
app.get('/api/board/students/:id/context', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    const sid = Number(req.params.id);
    if (!(await canEditStudent(req, sid))) return res.status(403).json({ success: false, message: '권한 없음' });
    const dossier = await getStudentDossier(sid);
    if (!dossier) return res.status(404).json({ success: false, message: '학생 없음' });
    res.json({ success: true, ...dossier });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// AI 컨설턴트 브리핑 — 학생의 기록 전체를 컨설턴트 관점으로 정리해 기록으로 저장
app.post('/api/board/students/:id/brief', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  const sid = Number(req.params.id);
  if (!(await canEditStudent(req, sid))) return res.status(403).json({ success: false, message: '권한 없음' });
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음 (설정에서 입력)' });

  // 기록만 보던 것을 dossier(기록+배치+로드맵)로 넓힌다.
  // 입결 콘솔에서 저장한 배치와 로드맵 진행률이 빠지면 "지금 이 학생이 어디까지 왔는지"를
  // 브리핑이 알 수 없어, 이미 검토가 끝난 카드를 다시 추천하는 일이 생긴다.
  const dossier = await getStudentDossier(sid);
  if (!dossier) return res.status(404).json({ success: false, message: '학생 없음' });
  const s = { ...dossier.student, grades: dossier.grades, records: dossier.records };
  const placements = dossier.placements || [];
  const roadmaps = dossier.roadmaps || [];
  const sourceRecords = (s.records || []).filter((r) => r.type !== '컨설턴트 브리핑' && r.content);
  if (!sourceRecords.length && !placements.length && !roadmaps.length) {
    return res.status(400).json({ success: false, message: '정리할 자료가 없습니다. 생기부 분석·수행평가·상담 기록이나 입결 배치를 먼저 쌓아주세요.' });
  }

  const systemPrompt = `당신은 학원 원장을 보좌하는 수시 컨설팅 수석 조교입니다.
한 학생에 대해 쌓인 자료를 세 갈래로 전부 읽고, 컨설턴트가 바로 쓸 수 있는 브리핑을 씁니다.
 (1) 기록 — 생기부 분석·수행평가·상담
 (2) 입결 배치 — 입결 콘솔에서 저장한 지원 후보와 그때의 판정
 (3) 로드맵 — 학생이 실제로 무엇을 끝냈고 무엇이 남았는지

[출력 — 마크다운, 이모지 금지, 합니다체]
## 학생 한눈에
(내신·계열·희망 전공·현재 단계 3~4줄 요약)
## 강점
(기록에서 확인되는 강점 — 근거가 된 기록을 괄호로 표시)
## 보완점·리스크
(약점, 빠진 활동, 최저 리스크 등)
## 지원 카드 재검토
(저장된 배치를 다시 봅니다. 세 가지를 반드시 짚으십시오.
 · 저장 당시 내신과 현재 대표 내신이 다르면 판정이 어떻게 바뀌는지
 · 안정·적정·소신·위험의 분포가 한쪽으로 쏠려 있지는 않은지
 · 생기부 기록의 강점이 그 학과·전형과 실제로 맞는지
 배치가 없으면 '저장된 배치 없음 — 입결 콘솔에서 후보를 먼저 담아야 합니다'라고 쓰십시오.)
## 로드맵 진행 점검
(끝낸 항목과 밀린 항목을 보고, 지금 밀린 것 중 무엇이 위 지원 카드에 직접 영향을 주는지.
 로드맵이 없으면 '로드맵 없음'이라고만 쓰십시오.)
## 추천 전략
(수시 방향: 유리한 전형 유형, 강화할 활동, 다음 학기 과목/탐구 방향)
## 다음 액션 체크리스트
(- [ ] 형태로 5개 내외, 구체적으로)

[원칙]
- 자료에 없는 사실은 지어내지 않고, 부족하면 '자료 부족'이라고 명시합니다.
- 배치의 컷·경쟁률 숫자는 주어진 값만 인용하고 새로 계산하거나 추정하지 않습니다.
- 세 갈래를 따로 요약하지 말고 서로 연결해서 읽으십시오. 브리핑의 값어치는 거기서 나옵니다.`;

  const gradeLine = (s.grades || []).map((g) => `${g.term}: ${g.gpa ?? '-'}`).join(', ');
  const recordsText = sourceRecords.map((r) =>
    `[${r.type}] ${r.title} (${String(r.created_at).slice(0, 10)})\n${String(r.content).slice(0, 6000)}`).join('\n\n---\n\n');
  // 배치는 저장 당시 내신(p.grade)과 지금 대표 내신(s.gpa)을 나란히 준다.
  // 그래야 "그 사이 성적이 바뀌어 판정이 달라졌다"를 모델이 스스로 짚을 수 있다.
  const placementsText = placements.length
    ? placements.map((p) => {
        const snap = p.snapshot || {};
        const parts = [
          `${String(p.univ_name || '').replace(/\[.*\]$/, '')} ${p.dept} ${p.track}(${p.type_name || '-'})`,
          `저장판정 ${p.verdict || '-'}`,
          `70%컷 ${snap.cut70 ?? '-'}${snap.cutYear ? `(${snap.cutYear})` : ''}`,
          `저장당시 내신 ${p.grade ?? '-'}`,
        ];
        if (snap.rate != null) parts.push(`경쟁률 ${snap.rate}`);
        if (snap.recruit != null) parts.push(`모집 ${snap.recruit}명`);
        if (snap.fill != null) parts.push(`충원 ${snap.fill}명`);
        if (snap.aiVerdict) parts.push(`AI판정 ${snap.aiVerdict}${snap.aiReason ? ` — ${snap.aiReason}` : ''}`);
        if (p.memo) parts.push(`메모 ${p.memo}`);
        return `- ${parts.join(' · ')} (저장 ${String(p.created_at).slice(0, 10)})`;
      }).join('\n')
    : '(저장된 배치 없음)';

  const roadmapText = roadmaps.length
    ? roadmaps.map((m) => {
        const items = m.items || [];
        const done = items.filter((i) => i.done).length;
        const pending = items.filter((i) => !i.done)
          .map((i) => `    · [${i.section || '기타'}${i.subject ? `/${i.subject}` : ''}] ${i.title}${i.period ? ` (${i.period})` : ''}`)
          .slice(0, 25).join('\n');
        return `- ${m.title} — ${done}/${items.length} 완료\n${pending ? `  남은 항목:\n${pending}` : '  남은 항목 없음'}`;
      }).join('\n')
    : '(로드맵 없음)';

  const userMsg = `[학생] ${s.name} / ${s.school || '학교 미입력'} / ${s.grade || '학년 미입력'} / 희망 ${s.major || '미입력'} / 목표 ${s.target_univ || '미입력'}
[대표 내신] ${s.gpa != null ? `${s.gpa}등급 (전 교과 환산 — 기준값)` : '미입력'}
[학기별 내신] ${gradeLine || '미입력'}
[메모] ${s.notes || '없음'}

[입결 배치 — ${placements.length}건]
${placementsText}

[로드맵 — ${roadmaps.length}개]
${roadmapText.slice(0, 6000)}

[기록 전체 — ${sourceRecords.length}건]
${recordsText.slice(0, 40000)}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 8000);
  const sendDone = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} clearInterval(keepAlive); res.end(); };
  try {
    const reply = await callAIModel({ aiModel, submodel, apiKey, systemPrompt, userMsg, maxTokens: 8000 });
    const record = await addRecord(sid, {
      type: '컨설턴트 브리핑',
      title: `컨설턴트 브리핑 (${new Date().toLocaleDateString('ko-KR')})`,
      content: reply,
    });
    sendDone({ success: true, reply, record });
  } catch (err) {
    console.error('[board/brief] 오류:', err.message);
    sendDone({ success: false, message: err.message });
  }
});

// 학생 셀프 열람 코드 발급/해제 — 학생이 코드만으로 본인 배정 내용을 봄
app.post('/api/board/students/:id/code', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    const sid = Number(req.params.id);
    if (!(await canEditStudent(req, sid))) return res.status(403).json({ success: false, message: '권한 없음' });
    const code = 'S' + crypto.randomBytes(4).toString('hex').toUpperCase(); // 예: S3F9A2C1B
    await setStudentCode(sid, code);
    res.json({ success: true, code });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/api/board/students/:id/code', requireAuth, async (req, res) => {
  try {
    const sid = Number(req.params.id);
    if (!(await canEditStudent(req, sid))) return res.status(403).json({ success: false, message: '권한 없음' });
    await setStudentCode(sid, null);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
// 공개 조회 — 코드 자체가 인증 (읽기 전용)
app.get('/api/student-view/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!/^S[0-9A-F]{8}$/.test(code)) return res.status(400).json({ success: false, message: '유효하지 않은 코드 형식입니다' });
    const data = await getStudentByCode(code);
    if (!data) return res.status(404).json({ success: false, message: '해당 코드의 학생을 찾을 수 없습니다' });
    res.json({ success: true, ...data });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 학생 셀프 업로드 — 코드 자체가 인증. 생기부·성적표 등을 올리면 선생님 보드에 나타나고,
// 선생님이 확인 후 그 파일로 분석을 돌린다. (분석 권한은 선생님에게만 있음)
const STUDENT_UPLOAD_KINDS = new Set(['생기부', '성적표', '기타']);
app.post('/api/student-view/:code/upload', upload.array('files', 5), async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!/^S[0-9A-F]{8}$/.test(code)) return res.status(400).json({ success: false, message: '유효하지 않은 코드 형식입니다' });
    const studentId = await getStudentIdByCode(code);
    if (!studentId) return res.status(404).json({ success: false, message: '해당 코드의 학생을 찾을 수 없습니다' });
    const existing = await countStudentUploads(studentId);
    if (existing >= 15) return res.status(400).json({ success: false, message: '업로드 한도(15개)에 도달했습니다 — 선생님께 정리를 요청해 주세요' });
    const kindLabel = STUDENT_UPLOAD_KINDS.has(req.body.kind) ? req.body.kind : '기타';
    const out = [];
    for (const f of (req.files || []).slice(0, 15 - existing)) {
      const fname = fixFilename(f.originalname);
      if (f.size > 30 * 1024 * 1024) { out.push({ name: fname, error: '30MB 초과' }); continue; }
      const saved = await addFile(studentId, {
        name: fname, mime: f.mimetype, size: f.size,
        kind: `학생업로드-${kindLabel}`, data: f.buffer,
      });
      out.push({ id: saved.id, name: saved.name, size: saved.size, kind: saved.kind, created_at: saved.created_at });
    }
    res.json({ success: true, files: out });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
// 학생이 잘못 올린 본인 파일 삭제 (본인 업로드만 지울 수 있다)
app.delete('/api/student-view/:code/files/:fileId', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    if (!/^S[0-9A-F]{8}$/.test(code)) return res.status(400).json({ success: false, message: '유효하지 않은 코드 형식입니다' });
    const studentId = await getStudentIdByCode(code);
    if (!studentId) return res.status(404).json({ success: false, message: '해당 코드의 학생을 찾을 수 없습니다' });
    const ok = await deleteStudentUpload(studentId, Number(req.params.fileId));
    if (!ok) return res.status(404).json({ success: false, message: '본인이 올린 파일만 삭제할 수 있습니다' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ══════════════════════════════════════════════════════
// 생기부 로드맵 — 컨설팅 로드맵 문서를 학생이 체크할 실행 항목으로 변환
// ══════════════════════════════════════════════════════

// 원자료(수행평가·탐구보고서 전수) → 로드맵 보고서 본문 작성
const ROADMAP_WRITE_SYSTEM = `당신은 패스파인더 입시팀의 생기부 로드맵 작성자입니다.
학생 한 명의 산출물(수행평가·탐구보고서·자기평가서 등)을 전수로 읽고,
다음 학기 각 과목에서 무엇을 어떻게 이어갈지를 설계한 로드맵 보고서를 씁니다.

핵심은 주제 추천이 아닙니다. 학생이 이미 남긴 것을 회수해 한 층 올리는 것입니다.
새 주제를 던지면 학생부가 활동 목록이 되고, 회수하면 한 사람의 사고 궤적이 됩니다.

[작성 원칙]
1. 새 주제를 만들지 않는다 — 학생이 스스로 예고한 것("다음에는 ~해 보고 싶다"), 스스로 밝힌 한계("~까지는 못 했다"), 이미 낸 산출물 안에서만 고른다. 자료에서 이 예고·한계 문장을 반드시 찾아 원문 그대로 인용한다.
2. 과목마다 학생이 직접 만든 숫자(측정·집계·계산·검증)를 하나 이상 남기도록 설계한다. 문헌 조사로 끝나는 주제는 승격시킨다.
3. 강점은 근거와 함께 구체적으로 쓴다 — "탐구력이 우수함"이 아니라 "자료가 자기 주장을 지지하지 않을 때 결론을 낮춘 기록이 두 번 있다".
4. 빈틈은 인격이 아니라 구조의 문제로 쓴다 — "노력이 부족하다"가 아니라 "예고 3건, 이행 0건이다". 모든 빈틈에는 그것을 메우는 다음 학기 주제를 대응시킨다.
5. 억지 융합을 넣지 않는다. 상대 과목이 자료 조달·번역만 맡으면 융합이 아니다. 예체능처럼 협동·성실 축을 담당할 과목은 의도적으로 비우고, 비운 이유를 쓴다.
6. 우선순위를 매긴다. 전 과목에 심화탐구를 넣으면 전부 얕아진다 — 한 학기 3~4개가 한계다.
7. 자료에 없는 사실을 지어내지 않는다. 확인이 필요한 것은 'Ⅶ. 남은 작업'에 올린다.

[출력 — 마크다운. 이모지 금지. 표는 마크다운 표(| |)]
## 이 로드맵의 한 줄 요지
(학생의 현 상태와 다음 학기 과제를 3~6문장으로. 구체적 수치·인용 포함)

## Ⅰ. 활동 정리
(표: 과목 | 확보 산출물 | 핵심 내용 | 본인 주도 여부 — 전 과목. 이어서 주요 산출물 2~4건을 소제목으로 상세 정리)

## Ⅱ. 진단 — 강점과 빈틈
(강점 ①②③…, 빈틈 ①②③… 각각 근거 인용과 함께. 빈틈은 처방의 시급성 순)

## Ⅲ. 연결 지도
(표: 과목 | 이번 학기에 남긴 것 | 미해결로 남은 것 | 다음 학기에 되어야 할 것 — 전 과목)

## Ⅳ. 다음 학기 과목별 설계
(과목마다 소제목 + 우선순위. 각 과목 안에 Ⓐ 직전 학기 연계 / Ⓑ 교과 융합 / Ⓒ 진로 연계)

## Ⅴ. 융합 축
(여러 과목을 관통하는 축 1~3개. 각 축마다 단계 | 담당 과목 | 맡는 일)

## Ⅵ. 실행 타임라인
(표: 시기(월별) | 할 일 — 구체적 행동 단위로)

## Ⅶ. 남은 작업
(표: 항목 | 비고 — 확보하지 못한 자료, 사실 확인이 필요한 곳, 정정할 오류)

## 우선순위
(표: 순위 | 과목 | 사유)`;

app.post('/api/roadmap/generate', requireAuth, async (req, res) => {
  const { text, filename, profile } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ success: false, message: '분석할 자료가 없습니다' });
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음 (설정에서 입력)' });

  const p = profile || {};
  const userMsg = `[학생] ${[p.name, p.school, p.grade].filter(Boolean).join(' · ') || '미입력'}
[희망 진로/전공] ${p.major || '미입력'}${p.targetUniv ? `\n[목표 대학] ${p.targetUniv}` : ''}
[이번 학기 수강 과목] ${p.currentSubjects || '자료에서 파악할 것'}
[다음 학기 수강 과목] ${p.nextSubjects || '자료에서 파악하거나, 파악되지 않으면 일반적인 후속 과목으로 설계하고 그 사실을 남은 작업에 적을 것'}
${p.memo ? `[선생님 메모]\n${p.memo}\n` : ''}
[학생 산출물 전문 — 수행평가·탐구보고서·자기평가서 등]
${String(text).slice(0, 120000)}

위 자료를 전수로 읽고 생기부 로드맵 보고서를 작성해 주세요.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 8000);
  const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };
  const sendDone = (obj) => { send(obj); clearInterval(keepAlive); res.end(); };
  try {
    // 1단계 — 로드맵 본문 작성
    const body = await callAIModel({ aiModel, submodel, apiKey, systemPrompt: ROADMAP_WRITE_SYSTEM, userMsg, maxTokens: 16000 });
    if (!body?.trim()) throw new Error('로드맵 본문을 생성하지 못했습니다');
    send({ stage: 'items', message: '로드맵을 작성했습니다. 체크 항목으로 정리하는 중…' });
    // 2단계 — 본문을 체크 항목으로 분해
    const parsed = await aiRoadmapItems({ aiModel, submodel, apiKey }, body,
      `${p.name || ''} 생기부 로드맵`.trim());
    sendDone({
      success: true,
      roadmap: {
        title: parsed.title || `${[p.school, p.grade, p.name].filter(Boolean).join(' ')} 생기부 로드맵`.trim(),
        student: p.name || parsed.student || '',
        summary: parsed.summary || '',
        body,
        items: parsed.items,
        sourceName: filename || '',
      },
    });
  } catch (err) {
    console.error('[roadmap/generate] 오류:', err.message);
    sendDone({ success: false, message: err.message });
  }
});

// 로드맵 문서(추출 텍스트) → AI가 체크 가능한 실행 항목으로 분해
app.post('/api/roadmap/analyze', requireAuth, async (req, res) => {
  const { text, filename } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ success: false, message: '분석할 텍스트가 없습니다' });
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음 (설정에서 입력)' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 8000);
  const sendDone = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} clearInterval(keepAlive); res.end(); };
  try {
    const parsed = await aiRoadmapItems({ aiModel, submodel, apiKey }, text, filename);
    sendDone({
      success: true,
      roadmap: {
        title: parsed.title || filename || '생기부 로드맵',
        student: parsed.student || '',
        summary: parsed.summary || '',
        body: String(text).slice(0, 100000),
        items: parsed.items,
        sourceName: filename || '',
      },
    });
  } catch (err) {
    console.error('[roadmap/analyze] 오류:', err.message);
    sendDone({ success: false, message: err.message });
  }
});

// 로드맵 텍스트 → 체크 항목 JSON (analyze·generate 공용)
async function aiRoadmapItems({ aiModel, submodel, apiKey }, text, filename) {
  const systemPrompt = `당신은 입시 컨설턴트가 작성한 "생기부 로드맵" 문서를,
학생이 스스로 체크하며 실행할 수 있는 할 일 목록으로 바꾸는 전문 조교입니다.

[출력 — 반드시 JSON 객체 하나만. 코드펜스·설명·이모지 금지]
{
  "title": "로드맵 제목 (예: 살레시오고 1학년 안세혁 생기부 로드맵)",
  "student": "학생 이름 (문서에서 확인되면, 없으면 빈 문자열)",
  "summary": "이 로드맵의 핵심 요지 3~5문장 — 학생이 무엇을 왜 해야 하는지",
  "items": [
    {
      "section": "과목별 설계 | 타임라인 | 남은 작업",
      "subject": "과목명 (과목별 설계일 때. 예: 통합과학2). 해당 없으면 빈 문자열",
      "period": "시기 (타임라인일 때. 예: 8월, 9월). 해당 없으면 빈 문자열",
      "priority": "1순위 | 2순위 | 3순위 (문서에 우선순위가 있으면). 없으면 빈 문자열",
      "title": "학생이 할 일 한 줄 — 무엇을 하는지 동사로 끝나게, 40자 이내",
      "detail": "어떻게 하는지 구체적 설명 2~4문장. 문서에 있는 자료명·사이트·수치·조건을 그대로 살릴 것"
    }
  ]
}

[원칙]
- 항목은 반드시 "했다 / 안 했다"로 체크 가능한 단위로 쪼갠다. 진단·평가·칭찬 같은 서술은 항목으로 만들지 말고 summary에만 반영한다.
- 문서의 과목별 설계(각 과목의 직전 학기 연계·교과 융합·진로 연계 주제), 월별 실행 타임라인, 남은 작업 표를 빠짐없이 옮긴다.
- 같은 일이 여러 장에 반복되면 하나로 합치되, 과목별 설계와 타임라인처럼 관점이 다르면 각각 남긴다.
- 문서에 없는 내용을 지어내지 않는다. 자료 출처·사이트명(GBIF, 기상자료개방포털 등)은 원문 그대로 쓴다.
- 항목 수는 문서 분량에 맞춰 20~60개.`;
  const userMsg = `[파일명] ${filename || '로드맵 문서'}\n\n[로드맵 전문]\n${String(text).slice(0, 60000)}`;

  const reply = await callAIModel({ aiModel, submodel, apiKey, systemPrompt, userMsg, maxTokens: 16000 });
  const m = String(reply).match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 응답에서 로드맵 JSON을 찾지 못했습니다');
  const parsed = JSON.parse(m[0]);
  const items = (Array.isArray(parsed.items) ? parsed.items : []).filter(it => it && String(it.title || '').trim());
  if (!items.length) throw new Error('실행 항목을 추출하지 못했습니다 (문서 내용을 확인해 주세요)');
  return { title: parsed.title || '', student: parsed.student || '', summary: parsed.summary || '', items };
}

// 선생님: 학생 로드맵 조회 / 저장 / 삭제
app.get('/api/board/students/:id/roadmaps', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    if (!(await canEditStudent(req, Number(req.params.id)))) return res.status(403).json({ success: false, message: '권한 없음' });
    res.json({ success: true, roadmaps: await listRoadmaps(Number(req.params.id)) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/api/board/students/:id/roadmaps', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    if (!(await canEditStudent(req, Number(req.params.id)))) return res.status(403).json({ success: false, message: '권한 없음' });
    res.json({ success: true, roadmap: await createRoadmap(Number(req.params.id), req.body || {}) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.patch('/api/roadmap/:id', requireAuth, async (req, res) => {
  try {
    const owner = await getRoadmapOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    await updateRoadmap(Number(req.params.id), req.body || {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/api/roadmap/:id', requireAuth, async (req, res) => {
  try {
    const owner = await getRoadmapOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    await deleteRoadmap(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
// 선생님: 항목 추가 / 수정(체크 포함) / 삭제
app.post('/api/roadmap/:id/items', requireAuth, async (req, res) => {
  try {
    const owner = await getRoadmapOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    res.json({ success: true, item: await addRoadmapItem(Number(req.params.id), req.body || {}) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.patch('/api/roadmap/items/:id', requireAuth, async (req, res) => {
  try {
    const owner = await getRoadmapItemOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    res.json({ success: true, item: await updateRoadmapItem(Number(req.params.id), req.body || {}) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/api/roadmap/items/:id', requireAuth, async (req, res) => {
  try {
    const owner = await getRoadmapItemOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    await deleteRoadmapItem(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 학생 셀프: 열람 코드로 본인 로드맵 항목 체크·수정·삭제·추가 (코드 자체가 인증)
const STUDENT_CODE_RE = /^S[0-9A-F]{8}$/;
async function studentIdFromCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!STUDENT_CODE_RE.test(c)) return null;
  return await getStudentIdByCode(c);
}
app.patch('/api/student-view/:code/roadmap-items/:itemId', async (req, res) => {
  try {
    const sid = await studentIdFromCode(req.params.code);
    if (!sid) return res.status(404).json({ success: false, message: '유효하지 않은 코드입니다' });
    const itemId = Number(req.params.itemId);
    if (await getRoadmapItemStudentId(itemId) !== sid) return res.status(403).json({ success: false, message: '본인 항목이 아닙니다' });
    const { done, note, title, detail, subject, period, priority, section } = req.body || {};
    res.json({ success: true, item: await updateRoadmapItem(itemId, { done, note, title, detail, subject, period, priority, section }) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/api/student-view/:code/roadmap-items/:itemId', async (req, res) => {
  try {
    const sid = await studentIdFromCode(req.params.code);
    if (!sid) return res.status(404).json({ success: false, message: '유효하지 않은 코드입니다' });
    const itemId = Number(req.params.itemId);
    if (await getRoadmapItemStudentId(itemId) !== sid) return res.status(403).json({ success: false, message: '본인 항목이 아닙니다' });
    await deleteRoadmapItem(itemId);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.post('/api/student-view/:code/roadmaps/:rid/items', async (req, res) => {
  try {
    const sid = await studentIdFromCode(req.params.code);
    if (!sid) return res.status(404).json({ success: false, message: '유효하지 않은 코드입니다' });
    const rid = Number(req.params.rid);
    if (await getRoadmapStudentId(rid) !== sid) return res.status(403).json({ success: false, message: '본인 로드맵이 아닙니다' });
    res.json({ success: true, item: await addRoadmapItem(rid, req.body || {}) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 학생 첨부파일 업로드 / 다운로드 / 삭제
app.post('/api/board/students/:id/files', requireAuth, upload.array('files', 10), async (req, res) => {
  try {
    if (!(await canEditStudent(req, Number(req.params.id)))) return res.status(403).json({ success: false, message: '권한 없음' });
    const out = [];
    for (const f of (req.files || [])) {
      const fname = fixFilename(f.originalname);
      if (f.size > 15 * 1024 * 1024) { out.push({ name: fname, error: '15MB 초과' }); continue; }
      out.push(await addFile(Number(req.params.id), { name: fname, mime: f.mimetype, size: f.size, kind: req.body.kind || '', data: f.buffer }));
    }
    res.json({ success: true, files: out });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.get('/api/board/files/:id', requireAuth, async (req, res) => {
  try {
    const owner = await getFileStudentOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    const f = await getFile(Number(req.params.id));
    if (!f) return res.status(404).json({ success: false, message: '파일 없음' });
    const filename = encodeURIComponent(f.name || 'file');
    res.setHeader('Content-Type', f.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.end(f.data);
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});
app.delete('/api/board/files/:id', requireAuth, async (req, res) => {
  try {
    const owner = await getFileStudentOwner(Number(req.params.id));
    if (req.user.role !== 'admin' && owner !== req.user.userId) return res.status(403).json({ success: false, message: '권한 없음' });
    await deleteFile(Number(req.params.id));
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

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

// 학생 보드 자료를 프롬프트 블록으로 — 상담이 "일반론"이 아니라 이 학생 이야기가 되게 하는 핵심.
// 기록 본문은 길어서 통째로 넣으면 컨텍스트를 잡아먹으므로 항목당·전체 상한을 둔다.
function buildStudentSection(sc) {
  if (!sc) return '';
  const p = sc.profile || {};
  const lines = [`\n=== 상담 대상 학생 자료 (학생 보드에서 불러옴) ===`];
  lines.push(`[학생] ${p.name || '이름없음'} / ${p.school || '학교 미입력'} / ${p.grade || '학년 미입력'}`);
  lines.push(`[희망 전공] ${p.major || '미입력'} / [목표 대학] ${p.targetUniv || '미입력'} / [진행 단계] ${p.status || '미입력'}`);
  if (p.gpa != null && p.gpa !== '') lines.push(`[대표 내신(전 교과 환산)] ${p.gpa}등급 — 지원 판단은 이 값을 기준으로 하라`);
  if (p.notes) lines.push(`[선생님 메모] ${String(p.notes).slice(0, 600)}`);

  const grades = sc.grades || [];
  if (grades.length) {
    lines.push(`[내신 추이] ${grades.map((g) => `${g.term} ${g.gpa ?? '-'}`).join(' · ')}`);
  }

  const pls = sc.placements || [];
  if (pls.length) {
    lines.push(`[입결 콘솔 배치 기록 — ${pls.length}건]`);
    pls.slice(0, 25).forEach((x) => {
      lines.push(` - ${x.univName || ''} ${x.dept || ''} ${x.track || ''}(${x.typeName || ''}) · 판정 ${x.verdict || '—'}` +
        `${x.aiVerdict ? ` / AI ${x.aiVerdict}` : ''} · 70%컷 ${x.cut70 ?? '—'}(${x.cutYear || ''}) · 저장 내신 ${x.grade ?? '—'}` +
        `${x.aiReason ? ` · ${String(x.aiReason).slice(0, 80)}` : ''}`);
    });
  }

  const rms = sc.roadmaps || [];
  if (rms.length) {
    lines.push(`[생기부 로드맵 진행]`);
    rms.slice(0, 5).forEach((r) => {
      lines.push(` - ${r.title || '로드맵'} · 완료 ${r.done ?? 0}/${r.total ?? 0}` +
        (r.pending?.length ? ` · 미완료: ${r.pending.slice(0, 8).join(', ')}` : ''));
    });
  }

  const recs = sc.records || [];
  if (recs.length) {
    let budget = 40000;
    lines.push(`[학생 기록 — ${recs.length}건, 선생님이 선택한 항목]`);
    for (const r of recs) {
      if (budget <= 0) { lines.push(' (이하 생략 — 분량 초과)'); break; }
      const body = String(r.content || '').slice(0, Math.min(9000, budget));
      budget -= body.length;
      lines.push(`\n──── [${r.type || '기록'}] ${r.title || ''} (${String(r.date || '').slice(0, 10)}) ────\n${body}`);
    }
  }
  lines.push(`=== 학생 자료 끝 ===
위 자료는 이 학생에 대해 실제로 쌓인 기록이다. 상담 답변은 반드시 이 학생의 내신·기록·배치 상황에 맞춰 구체적으로 하라.
자료에 없는 사실은 지어내지 말고, 판단에 필요한 자료가 없으면 무엇이 더 필요한지 밝혀라.`);
  return lines.join('\n');
}

// ── 채팅 엔드포인트 (파일 컨텍스트 + 분석 컨텍스트 + 학생 보드 자료 지원) ──
app.post('/api/chat', async (req, res) => {
  const { message, history = [], analysisContext, fileContents, imageData, studentContext } = req.body;
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

    // 학생 보드 자료 컨텍스트
    const studentSection = buildStudentSection(studentContext);

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
${kb.합격자사례 || '(자료 없음)'}${studentSection}${analysisSection}${fileSection}`;

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

      // web_search 도구 활성화 (tool use loop)
      const webSearchTool = { type: 'web_search_20250305', name: 'web_search', max_uses: 5 };
      let currentMessages = messages;
      let response;
      for (let i = 0; i < 10; i++) {
        response = await client.messages.create({
          model: getModelId('claude', submodel),
          max_tokens: 8000,
          system: systemPrompt,
          tools: [webSearchTool],
          messages: currentMessages,
        });
        if (response.stop_reason !== 'tool_use') break;

        // tool_use 블록 처리 → tool_result로 응답
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: response.content },
          {
            role: 'user',
            content: response.content
              .filter(b => b.type === 'tool_use')
              .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: b.content ?? '' })),
          },
        ];
      }
      reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
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

app.post('/api/analyze', optionalAuth, pdfFields, async (req, res) => {
  let studentData;
  let reusedPdfTexts = '';
  let pdfPassword = '';   // 비밀번호 걸린 정부24 생기부용
  let existingResults = null;
  let sectionsToRun = null;
  try {
    studentData = JSON.parse(req.body.studentData);
    if (req.body.pdfTexts) reusedPdfTexts = String(req.body.pdfTexts);
    if (req.body.pdfPassword) pdfPassword = String(req.body.pdfPassword).trim();
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

  // 사용량 기록 (로그인 이용자인 경우)
  if (req.user?.role === 'user' && req.user?.userId) {
    const ip = getIp(req);
    logEvent({ userId: req.user.userId, type: 'analyze', detail: `${studentData.name} / ${studentData.major || ''}`, ip });
    if (req.user.jti) touchSession(req.user.jti);
  }

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
      } else if (studentDriveFiles && studentDriveFiles.trim()) {
        // 업로드 PDF가 없어도, 드라이브 학생폴더에서 불러온 생기부를 '학생 원문'으로 주입한다.
        // (이 처리가 없으면 학생 이름만으로 분석 시 AI에 생기부가 안 들어가 '원문 없음'으로 나온다.)
        // reusedPdfTexts 에도 담아 아래 preExtractedPdfText 초기화·pdf.preExtractedText 재설정에서 그대로 쓰이게 한다.
        reusedPdfTexts = studentDriveFiles.slice(0, PDF_TEXT_CHAR_CAP);
        pdfDocuments.push({
          label: '드라이브 생기부',
          base64: '',
          preExtractedText: reusedPdfTexts,
        });
        send({ type: 'progress', step: 0, label: `드라이브 생기부 사용 (${reusedPdfTexts.length}자)`, total: 9 });
        console.log(`[Analyze] 드라이브 생기부 ${reusedPdfTexts.length}자를 학생 원문으로 주입`);
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

        // 0차: 암호화 여부 확인. 정부24 생기부는 기본이 비밀번호 보호(보통 생년월일 6자리)라
        // 이걸 구분하지 않으면 텍스트도 이미지도 못 뽑고 근거 없는 리포트가 조용히 나간다.
        const info = inspectPdf(buffer, pdfPassword);
        if (info.needsPassword) {
          const msg = pdfPassword
            ? `${pdf.label}: 비밀번호가 맞지 않습니다. 정부24 생기부는 보통 생년월일 6자리(예: 080220)입니다.`
            : `${pdf.label}: 비밀번호가 걸린 PDF입니다. 업로드 화면의 'PDF 비밀번호'란에 입력한 뒤 다시 분석해 주세요.`;
          console.warn(`[Analyze] ${msg}`);
          send({ type: 'warning', step: 0, label: msg, total: 9 });
          preExtractedPdfText += `[${pdf.label}] 비밀번호가 걸려 있어 내용을 읽지 못했습니다. 이 자료는 분석에 반영되지 않았습니다.\n\n`;
          // 잠긴 PDF를 그대로 첨부하면 모델도 못 읽으면서 토큰만 태운다. 첨부 대상에서 뺀다.
          pdf.locked = true;
          pdf.base64 = '';
          continue;
        }
        if (info.encrypted && pdfPassword) {
          console.log(`[Analyze] ${pdf.label}: 비밀번호로 복호화 성공 (${info.pages}페이지)`);
          send({ type: 'progress', step: 0, label: `${pdf.label} 비밀번호 해제 완료 (${info.pages}페이지)`, total: 9 });
        }

        // 1차: pdftotext (poppler) — 스캔 PDF가 아닌 경우 가장 정확
        try {
          const tmpPdf = join(tmpdir(), `analyze-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
          const tmpTxt = tmpPdf.replace('.pdf', '.txt');
          writeFileSync(tmpPdf, buffer);
          execFileSync('pdftotext', ['-enc', 'UTF-8', ...upwArgs(pdfPassword), tmpPdf, tmpTxt], { timeout: 20000 });
          text = readFileSync(tmpTxt, 'utf-8').trim().slice(0, PDF_TEXT_CHAR_CAP);
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
            const parsed = data.text.slice(0, PDF_TEXT_CHAR_CAP);
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

        // 3차: 텍스트 추출 실패 → 스캔 PDF → 이미지 변환
        const totalPages = info.pages || getPdfPageCount(buffer, pdfPassword);
        if (koreanChars < 50) {
          console.warn(`[Analyze] ${pdf.label}: 스캔 PDF로 판단 → 이미지 변환 시도! (총 ${totalPages || '?'}페이지)`);
          send({ type: 'progress', step: 0, label: `${pdf.label} 스캔 PDF ${totalPages || ''}페이지 이미지 변환 중...`, total: 9 });
          try {
            const images = await convertPdfToImages(buffer, PDF_IMAGE_PAGE_CAP, pdfPassword);
            pdf.images = images;
            pdf.totalPages = totalPages;
            console.log(`[Analyze] ${pdf.label}: ${images.length}/${totalPages || '?'}페이지 이미지 변환 성공`);
            if (totalPages && images.length < totalPages) {
              // 잘렸으면 반드시 알린다. 조용히 자르면 뒷학년 성적·이수과목이 통째로 사라진 채 분석이 나간다.
              console.warn(`[Analyze] ${pdf.label}: ${totalPages}페이지 중 ${images.length}페이지만 전달 (상한 ${PDF_IMAGE_PAGE_CAP})`);
              send({ type: 'warning', step: 0, label: `${pdf.label}: 총 ${totalPages}페이지 중 ${images.length}페이지만 분석에 반영됩니다. 나머지는 나눠서 추가 업로드해 주세요.`, total: 9 });
            } else {
              send({ type: 'progress', step: 0, label: `${pdf.label} ${images.length}페이지 전체 변환 완료`, total: 9 });
            }
          } catch (imgErr) {
            console.error(`[Analyze] 이미지 변환 실패: ${pdf.label}`, imgErr.message);
          }
        }

        if (koreanChars >= 50) {
          const cut = text.length >= PDF_TEXT_CHAR_CAP;
          if (cut) {
            console.warn(`[Analyze] ${pdf.label}: 텍스트가 상한(${PDF_TEXT_CHAR_CAP}자)에 걸려 잘렸습니다`);
            send({ type: 'warning', step: 0, label: `${pdf.label}: 원문이 길어 앞 ${PDF_TEXT_CHAR_CAP}자까지만 분석에 반영됩니다.`, total: 9 });
          }
          preExtractedPdfText += `[${pdf.label} 내용]${cut ? ` (주의: 원문 앞 ${PDF_TEXT_CHAR_CAP}자까지만 포함 — 뒤쪽 학년 자료가 누락되었을 수 있음)` : ` (전문 ${text.length}자, 누락 없음)`}\n${text}\n\n`;
        } else if (pdf.images?.length > 0) {
          const cov = pdf.totalPages
            ? (pdf.images.length >= pdf.totalPages
                ? `총 ${pdf.totalPages}페이지 전부 첨부 — 누락 없음`
                : `주의: 총 ${pdf.totalPages}페이지 중 앞 ${pdf.images.length}페이지만 첨부됨. 첨부되지 않은 페이지의 내용은 '없음'이 아니라 '확인 불가'로 처리하라`)
            : `${pdf.images.length}페이지 첨부`;
          preExtractedPdfText += `[${pdf.label}] 스캔 PDF — AI가 첨부 이미지에서 직접 읽어야 함 (${cov})\n\n`;
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

    // 섹션 완료 시 즉시 클라이언트로 전송(부분 저장용), 그 외는 진행상황으로 전송
    const progressCb = (progress) => {
      if (progress && progress.section) {
        send({ type: 'section', key: progress.section, content: progress.content });
      } else {
        send({ type: 'progress', ...progress, total: 9 });
      }
    };
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

// ── 대학별 입시정보 (대학어디가 adiga.kr 스냅샷) ──────────────
const ADIGA_DIR = join(dirname(fileURLToPath(import.meta.url)), 'data', 'adiga');
let _univList = null;
function getUnivList() {
  if (!_univList) _univList = JSON.parse(readFileSync(join(ADIGA_DIR, 'univ-list.json'), 'utf8'));
  return _univList;
}
// 대학 목록 (검색어 q로 필터)
app.get('/api/univ-info/list', requireAuth, (req, res) => {
  try {
    const data = getUnivList();
    const q = (req.query.q || '').trim();
    let unis = data.universities;
    if (q) unis = unis.filter(u => u.name.includes(q) || (u.region || '').includes(q));
    res.json({ success: true, source: data.source, years: data.years, count: unis.length, universities: unis });
  } catch (err) {
    console.error('[/api/univ-info/list] 오류:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// 대학별 상세 (입시가이드/평가기준·전년도결과/장애인전형)
app.get('/api/univ-info/:unvCd', requireAuth, (req, res) => {
  const { unvCd } = req.params;
  if (!/^[0-9]+$/.test(unvCd)) return res.status(400).json({ success: false, error: '잘못된 대학 코드' });
  try {
    const data = JSON.parse(readFileSync(join(ADIGA_DIR, 'univ', `${unvCd}.json`), 'utf8'));
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(404).json({ success: false, error: '해당 대학 정보를 찾을 수 없습니다.' });
  }
});

// ── 입결 콘솔 (어디가 공식 입시결과 2021~2026 시계열) ──────────
let _ipgyeolIndex = null;
function getIpgyeolIndex() {
  if (!_ipgyeolIndex) _ipgyeolIndex = JSON.parse(readFileSync(join(ADIGA_DIR, 'ipgyeol-index.json'), 'utf8'));
  return _ipgyeolIndex;
}
// 대학 목록 (검색어 q로 필터)
app.get('/api/ipgyeol/list', requireAuth, (req, res) => {
  try {
    const data = getIpgyeolIndex();
    const q = (req.query.q || '').trim();
    let unis = data.universities;
    if (q) unis = unis.filter(u => u.name.includes(q) || (u.region || '').includes(q));
    res.json({ success: true, source: data.source, count: unis.length, universities: unis });
  } catch (err) {
    console.error('[/api/ipgyeol/list] 오류:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// 대학별 학과×전형×연도 입결 시계열
app.get('/api/ipgyeol/:unvCd', requireAuth, (req, res) => {
  const { unvCd } = req.params;
  if (!/^[0-9]+$/.test(unvCd)) return res.status(400).json({ success: false, error: '잘못된 대학 코드' });
  try {
    const data = JSON.parse(readFileSync(join(ADIGA_DIR, 'ipgyeol', `${unvCd}.json`), 'utf8'));
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(404).json({ success: false, error: '해당 대학의 입결 자료가 없습니다.' });
  }
});

// 입결 콘솔 AI 종합 판정 — 학생 생기부 분석 내용 + 카드 입결 데이터로 학과별 배치 판정
app.post('/api/ipgyeol/judge', requireAuth, async (req, res) => {
  const { studentProfile, cards } = req.body || {};
  if (!Array.isArray(cards) || !cards.length) return res.status(400).json({ success: false, message: '판정할 카드가 없습니다' });
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음 (설정에서 입력)' });

  const systemPrompt = `당신은 대한민국 수시 배치 전문 입시 컨설턴트입니다.
학생의 생기부 분석 내용(내신·비교과·학업역량)과 각 지원 후보(대학·학과·전형)의 공식 입결 데이터를 종합해
후보별 배치 판정을 내립니다.

[판정 기준]
- 4단계: 안정(합격 가능성 높음) / 적정(무난히 노려볼 수준) / 소신(다소 도전적) / 위험(상당히 도전적)
- 교과전형: 내신 등급 대비 70%컷·경쟁률·충원 흐름 중심
- 종합전형: 내신뿐 아니라 생기부 분석에 나타난 비교과·전공적합성·학업역량의 강약을 반드시 반영
- 수능최저가 있으면 충족 가능성도 고려(분석 내용에 모의고사 정보가 있으면 활용)

[출력 — 반드시 JSON 배열만. 다른 텍스트·코드펜스 금지]
[{"key":"<카드 key 그대로>","verdict":"안정|적정|소신|위험","reason":"판정 근거 한 문장(40자 이내)"}]`;

  const userMsg = `[학생 정보]
${JSON.stringify({ name: studentProfile?.name, school: studentProfile?.school, grade: studentProfile?.grade, major: studentProfile?.major, 내신: studentProfile?.gpa }, null, 1)}

[생기부 분석 발췌]
${String(studentProfile?.analysisExcerpt || '(분석 자료 없음 — 내신과 입결 데이터만으로 판정)').slice(0, 9000)}

[지원 후보 카드 — key를 그대로 돌려줄 것]
${JSON.stringify(cards.slice(0, 15), null, 1)}`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 8000);
  const sendDone = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} clearInterval(keepAlive); res.end(); };
  try {
    const reply = await callAIModel({ aiModel, submodel, apiKey, systemPrompt, userMsg, maxTokens: 4000 });
    const m = String(reply).match(/\[[\s\S]*\]/);
    if (!m) throw Object.assign(new Error('AI 응답에서 판정 JSON을 찾지 못했습니다'), { userFacing: true });
    const judgments = JSON.parse(m[0]).filter((j) => j && j.key && j.verdict);
    sendDone({ success: true, judgments });
  } catch (err) {
    console.error('[ipgyeol/judge] 오류:', err.message);
    sendDone({ success: false, message: err.userFacing ? err.message : friendlyAIError(err, aiModel) });
  }
});

// 입결 콘솔 AI 검색 — 자연어 질문 → 필터 JSON(AI) → 전 대학 결정적 검색(코드) → 요약(AI)
// 숫자는 전부 코드가 원본 입결에서 뽑는다. AI는 "무엇을 찾을지"와 "어떻게 읽을지"만 담당한다.
app.post('/api/ipgyeol/ai-search', requireAuth, async (req, res) => {
  const { query, studentProfile, baseYear = '2026', limit = 24 } = req.body || {};
  if (!String(query || '').trim()) return res.status(400).json({ success: false, message: '검색어가 비었습니다' });
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음 (설정에서 입력)' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 8000);
  const sendDone = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} clearInterval(keepAlive); res.end(); };

  const parsePrompt = `당신은 대한민국 수시 입결 데이터 검색기의 질의 해석기입니다.
컨설턴트의 자연어 질문을 아래 스키마의 필터 JSON으로만 변환합니다. 검색·판단은 하지 않습니다.

[검색 대상] 대학어디가 공식 입시결과. 전국 216개 대학 × 학과 × 전형 약 7만 건.
각 건은 연도별로 최종등급 70%컷 / 경쟁률 / 충원인원 / 모집인원을 가집니다.

[사용 가능한 지역] ${IPG_REGIONS.join(', ')}
[사용 가능한 전형구분] ${IPG_TRACKS.join(', ')} (학생부교과=교과, 학생부종합=종합)

[필터 스키마 — 해당 없는 키는 생략]
{
 "regions": ["서울"],            // 지역명 배열. '수도권/인서울'이면 capitalOnly 사용
 "capitalOnly": true,             // 수도권(서울·경기·인천)
 "univKeywords": ["중앙대"],      // 특정 대학 지정 시에만
 "deptKeywords": ["간호","보건"], // 학과명 포함 키워드(OR). 계열 질문이면 대표 학과명을 여러 개 펼쳐라
 "excludeKeywords": ["야간"],
 "tracks": ["교과"],
 "typeKeywords": ["지역균형"],    // 전형명 키워드
 "gradeMin": 2.0, "gradeMax": 3.5,// 70%컷 등급 범위(숫자가 클수록 낮은 성적)
 "targetGrade": 2.8,              // 학생 내신 — 주어지면 판정·정렬 기준이 됨
 "verdicts": ["적정","안정"],     // 안정/적정/소신/위험 중 원하는 것
 "rateMax": 10, "rateMin": null,  // 경쟁률
 "recruitMin": 20,                // 모집인원 하한
 "trend": "easing",               // easing=컷 완화 추세, tightening=컷 상승 추세
 "sunung": "none",                // none=수능최저 없는 전형, required=있는 전형
 "sortBy": "fit",                 // fit(내신 근접) | cut(상위권 순) | easy(여유 순) | rate(경쟁률 낮은 순) | recruit(모집 많은 순) | trend(완화 순)
 "limit": 24,
 "intent": "질문을 한 문장으로 재진술"
}

[해석 규칙 — 질문에 있는 조건은 하나도 빠뜨리지 말 것]
- 지역어는 반드시 반영한다. '수도권/인서울/서울권 통틀어' → capitalOnly:true, '서울' → regions:["서울"],
  '지방/지역대학' → regions에 비수도권 지역들, 특정 시도명 → 그대로 regions.
- '교과전형/학생부교과' → tracks:["교과"], '종합/학종/학생부종합' → tracks:["종합"], '논술' → tracks:["논술"].
- 학생 성적을 뜻하는 표현('내신 3.0으로', '3등급인 학생이', '2.8인데')은 gradeMax가 아니라 targetGrade다.
  gradeMin/gradeMax는 '컷이 3등급 이내인 곳'처럼 컷 자체를 한정할 때만 쓴다.
- '적정·안정', '갈 만한', '지원 가능한' → verdicts로 옮긴다. '안정' → ["안정"], '상향/소신' → ["소신","위험"],
  '갈 만한/무난한' → ["안정","적정"].
- '경쟁률 낮은' → sortBy:"rate", '뽑는 인원 많은' → sortBy:"recruit", '작년보다 쉬워진/컷 내려간' → trend:"easing",
  '수능최저 없는' → sunung:"none".
- 계열어는 학과 키워드로 펼쳐라. 예: '공대'→["공학","기계","전기","전자","컴퓨터","화학공","신소재","산업","토목","건축"],
  '경영·상경'→["경영","경제","무역","회계","금융"], '간호·보건'→["간호","보건","물리치료","임상병리","작업치료"],
  '교육계열'→["교육","사범"], 'AI·컴공'→["인공지능","AI","컴퓨터","소프트웨어","데이터"]
- 학생 정보가 주어졌는데 질문에 등급이 없으면 학생 내신을 targetGrade로 쓴다.
- 질문에 없는 조건을 상상해서 넣지는 마라. 다만 질문에 적힌 조건은 전부 넣어야 한다.

[예시]
질문: "수도권 간호학과 중 내신 3.0으로 적정·안정인 교과전형 찾아줘"
→ {"capitalOnly":true,"deptKeywords":["간호"],"tracks":["교과"],"targetGrade":3.0,"verdicts":["적정","안정"],"sortBy":"fit","intent":"수도권 간호 교과전형 중 내신 3.0 기준 적정·안정 후보"}

질문: "작년보다 컷이 완화된 경기권 경영·경제 학과"
→ {"regions":["경기"],"deptKeywords":["경영","경제"],"trend":"easing","sortBy":"trend","intent":"경기 지역 경영·경제 중 70%컷이 완화된 학과"}

질문: "수능최저 없는 서울 종합전형 중 2.5등급대"
→ {"regions":["서울"],"tracks":["종합"],"sunung":"none","targetGrade":2.5,"sortBy":"fit","intent":"수능최저 없는 서울 종합전형 중 내신 2.5 기준 후보"}

[출력] JSON 객체 하나만. 코드펜스·설명 금지.`;

  const profileLine = studentProfile
    ? `[학생 정보] 이름 ${studentProfile.name || '-'} / 내신 ${studentProfile.gpa ?? '-'} / 희망 전공 ${studentProfile.major || '-'} / 목표 ${studentProfile.targetUniv || '-'}`
    : '[학생 정보] 없음';

  try {
    const raw = await callAIModel({
      aiModel, submodel, apiKey, systemPrompt: parsePrompt, maxTokens: 1200,
      userMsg: `${profileLine}\n[기준연도] ${baseYear}\n\n[질문]\n${String(query).slice(0, 1000)}`,
    });
    const m = String(raw).match(/\{[\s\S]*\}/);
    if (!m) throw Object.assign(new Error('질문을 검색 조건으로 바꾸지 못했습니다. 조금 더 구체적으로 적어주세요.'), { userFacing: true });
    const filter = JSON.parse(m[0]);
    filter.baseYear = baseYear;
    filter.limit = Math.min(Number(filter.limit) || Number(limit) || 24, 40);
    if (filter.targetGrade == null && studentProfile?.gpa != null) filter.targetGrade = Number(studentProfile.gpa);

    let { total, results } = searchIpgyeolEntries(filter);

    // 0건이면 조건을 단계적으로 풀어 재검색 — "결과 없음"만 돌려주면 컨설턴트가 손으로 다시 짜야 한다
    const relaxed = [];
    const relaxSteps = [
      ['verdicts', () => { delete filter.verdicts; relaxed.push('배치 판정'); }],
      ['trend', () => { delete filter.trend; relaxed.push('추세'); }],
      ['sunung', () => { delete filter.sunung; relaxed.push('수능최저'); }],
      ['rateMax', () => { delete filter.rateMax; delete filter.rateMin; relaxed.push('경쟁률'); }],
      ['recruitMin', () => { delete filter.recruitMin; relaxed.push('모집인원'); }],
      ['gradeMax', () => { delete filter.gradeMin; delete filter.gradeMax; relaxed.push('등급 범위'); }],
      // 대학·학과·전형명을 한 질문에 다 적으면 AND 로 겹쳐 0건이 되기 쉽다.
      // (예: 성균관대·중앙대·숭실대 + 정보보호 + 융합인재/성장형인재 → 동시에 만족하는 전형 없음)
      // 좁은 쪽(전형명 → 학과) 순으로 풀어 준다. 대학은 질문의 핵심이라 끝까지 유지한다.
      ['typeKeywords', () => { delete filter.typeKeywords; relaxed.push('전형명'); }],
      ['deptKeywords', () => { delete filter.deptKeywords; relaxed.push('학과'); }],
      ['regions', () => { delete filter.regions; delete filter.capitalOnly; relaxed.push('지역'); }],
    ];
    for (const [key, drop] of relaxSteps) {
      if (total > 0) break;
      if (filter[key] == null && !(key === 'regions' && filter.capitalOnly)) continue;
      drop();
      ({ total, results } = searchIpgyeolEntries(filter));
    }

    let summary = '';
    if (results.length) {
      const compact = results.slice(0, 20).map((r) => ({
        대학: r.univ.name.replace(/\[.*\]$/, ''), 지역: r.univ.region, 학과: r.entry.dept,
        전형: `${r.entry.track}(${r.entry.typeName})`, 컷70: r.match.cut70, 연도: r.match.cutYear,
        전년대비: r.match.delta, 경쟁률: r.match.rate, 충원: r.match.fill, 모집: r.match.recruit, 판정: r.match.verdict,
      }));
      const sumPrompt = `당신은 수시 배치 상담 컨설턴트입니다. 아래는 공식 입결에서 조건에 맞게 뽑힌 검색 결과입니다.
이 결과를 컨설턴트가 학생·학부모에게 바로 설명할 수 있도록 정리하십시오.

[출력 — 마크다운, 이모지 금지, 합니다체, 12줄 이내]
- 첫 줄: 검색 결과 한 줄 요약(몇 건 중 어떤 성격의 후보가 나왔는지)
- **눈여겨볼 후보**: 3~5개를 이유와 함께 (대학 학과 전형 · 컷 · 근거)
- **주의할 점**: 경쟁률 급등·충원 적음·컷 상승 등 데이터에서 읽히는 리스크
- **다음 확인 사항**: 반영교과·수능최저 등 이 데이터만으로 알 수 없는 것
[원칙] 표에 없는 숫자를 지어내지 마십시오. 표의 값만 인용하십시오.`;
      summary = await callAIModel({
        aiModel, submodel, apiKey, systemPrompt: sumPrompt, maxTokens: 1600,
        userMsg: `[질문] ${query}\n${profileLine}\n[전체 매칭] ${total}건 중 상위 ${compact.length}건\n\n${JSON.stringify(compact, null, 1)}`,
      });
    }

    sendDone({ success: true, filter, total, results, summary, relaxed });
  } catch (err) {
    console.error('[ipgyeol/ai-search] 오류:', err.message);
    sendDone({ success: false, message: err.userFacing ? err.message : friendlyAIError(err, aiModel) });
  }
});

// ── 상담 에이전트 — 학생 자료를 알고, 입결·지식베이스를 스스로 조회하는 다중 턴 상담 ──
//
// 기존 /api/chat 과 나눈 이유: 이 라우트는 서버가 직접 학생 DB를 읽고 쓰므로 인증이 필수다.
// (/api/chat 은 인증 없이 프론트가 넘겨준 컨텍스트만 본다.)
app.post('/api/chat/agent', requireAuth, async (req, res) => {
  const { studentId, message, history = [], baseYear = '2026' } = req.body || {};
  if (!String(message || '').trim()) return res.status(400).json({ success: false, message: '메시지가 비었습니다' });
  const aiModel = req.headers['x-ai-model'] || 'claude';
  const submodel = req.headers['x-ai-submodel'] || aiModel;
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(400).json({ success: false, message: 'API 키 없음 (설정에서 입력)' });

  // 도구 호출은 제공사마다 규격이 달라 우선 GPT 계열만 지원한다.
  // 지원하지 않는 모델을 조용히 다른 모델로 바꾸면 사용자가 무엇으로 답을 받았는지 알 수 없게 된다.
  if (aiModel !== 'gpt') {
    return res.status(400).json({ success: false, message: '상담 에이전트는 현재 GPT 계열에서만 동작합니다. 설정에서 GPT 모델을 선택해 주세요.' });
  }
  const modelId = getModelId('gpt', submodel);
  if (/-pro$/.test(modelId)) {
    return res.status(400).json({ success: false, message: `${modelId} 는 도구 호출을 지원하지 않습니다. GPT-5.5 등 pro가 아닌 모델을 선택해 주세요.` });
  }

  // 학생 컨텍스트 — 유한한 자료라 프롬프트에 직접 넣는다(입결과 달리).
  let studentSection = '(학생이 선택되지 않았습니다. 일반 상담으로 답하고, 학생별 자료가 필요하면 선택을 요청하십시오.)';
  let sid = null, defaultGrade = null;
  if (studentId) {
    sid = Number(studentId);
    if (!(await canEditStudent(req, sid))) return res.status(403).json({ success: false, message: '권한 없음' });
    const d = await getStudentDossier(sid);
    if (!d) return res.status(404).json({ success: false, message: '학생 없음' });
    const s = d.student;
    defaultGrade = s.gpa != null ? Number(s.gpa) : null;
    const grades = (d.grades || []).map((g) => `${g.term}:${g.gpa ?? '-'}`).join(', ') || '미입력';
    const recs = (d.records || []).filter((r) => r.content)
      .map((r) => `[${r.type}] ${r.title} (${String(r.created_at).slice(0, 10)})\n${String(r.content).slice(0, 5000)}`)
      .join('\n\n---\n\n').slice(0, 32000);
    const pls = (d.placements || []).map((p) => {
      const sn = p.snapshot || {};
      return `- ${String(p.univ_name || '').replace(/\[.*\]$/, '')} ${p.dept} ${p.track}(${p.type_name || '-'}) · 판정 ${p.verdict || '-'}`
        + ` · 70%컷 ${sn.cut70 ?? '-'}${sn.cutYear ? `(${sn.cutYear})` : ''} · 저장당시 내신 ${p.grade ?? '-'}`;
    }).join('\n') || '(저장된 배치 없음)';
    const rms = (d.roadmaps || []).map((m) => {
      const items = m.items || [];
      const pending = items.filter((i) => !i.done).map((i) => i.title).slice(0, 15).join(' / ');
      return `- ${m.title} — ${items.filter((i) => i.done).length}/${items.length} 완료${pending ? ` · 남은 것: ${pending}` : ''}`;
    }).join('\n') || '(로드맵 없음)';
    studentSection = `[학생] ${s.name} / ${s.school || '학교 미입력'} / ${s.grade || '학년 미입력'} / 희망 ${s.major || '미입력'} / 목표 ${s.target_univ || '미입력'}
[대표 내신] ${s.gpa != null ? `${s.gpa}등급` : '미입력'}   [학기별] ${grades}
[메모] ${s.notes || '없음'}

[저장된 입결 배치]
${pls}

[로드맵]
${rms}

[기록 — 생기부 분석·수행평가·상담]
${recs || '(기록 없음)'}`;
  }

  const systemPrompt = `당신은 학원 원장을 보좌하는 수시 컨설팅 수석 조교입니다.
아래 학생 자료를 이미 읽은 상태로 대화합니다. 필요한 자료는 도구로 직접 조회하십시오.

[도구 사용 규칙 — 반드시 지킬 것]
- 입결 숫자(70%컷·경쟁률·충원·모집)는 반드시 search_ipgyeol 결과만 인용하십시오. 기억이나 추정으로 숫자를 쓰지 마십시오.
- 전형방법·반영교과·수능최저 기준처럼 입결 숫자로 알 수 없는 것은 search_knowledge 로 확인하십시오.
- 한 번의 검색으로 부족하면 조건을 바꿔 여러 번 부르십시오. 특히 0건이 나오면 조건을 하나씩 빼고 다시 부르십시오.
- save_placement 는 사용자가 저장을 요청했거나 명확히 동의했을 때만 부르십시오. 추천 단계에서 미리 저장하지 마십시오.
- 도구로도 확인되지 않으면 "자료에 없습니다"라고 말하십시오. 지어내지 마십시오.

[알아둘 한계]
- 입결 자료는 2021~2026 대학어디가 공식 발표분입니다. 올해 신설된 전형은 입결이 존재하지 않습니다.
  신설 전형을 물으면 입결로는 답할 수 없다고 밝히고, 전형방법 쪽으로 돌려 답하십시오.
- 배치 판정(안정·적정·소신·위험)은 70%컷과 내신 차이만 본 참고값입니다. 반영교과·최저·모집인원 변화는 별도입니다.

[답변 형식]
- 마크다운, 이모지 금지, 합니다체.
- 숫자를 인용할 때는 어느 연도 자료인지 함께 밝히십시오.
- 길게 늘어놓지 말고 컨설턴트가 바로 쓸 수 있게 정리하십시오.

=== 학생 자료 ===
${studentSection}
=== 학생 자료 끝 ===`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  const keepAlive = setInterval(() => { try { res.write(': keepalive\n\n'); } catch {} }, 8000);
  const sendDone = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} clearInterval(keepAlive); res.end(); };

  const toolLog = [];     // 화면에 "무엇을 조회했는지" 보여주기 위한 기록
  const savedPlacements = [];
  try {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });
    const msgs = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-10).filter((h) => h && h.role && h.content)
        .map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 6000) })),
      { role: 'user', content: String(message).slice(0, 8000) },
    ];

    let reply = '';
    const MAX_TURNS = 8;   // 도구 호출이 끝없이 이어지는 것을 막는 상한
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const r = await openai.chat.completions.create({
        model: modelId,
        messages: msgs,
        tools: CONSULT_TOOLS,
        max_completion_tokens: 8000,
      });
      const m = r.choices[0].message;
      msgs.push(m);
      if (!m.tool_calls?.length) { reply = m.content || ''; break; }

      for (const tc of m.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        let out;
        try {
          out = await runConsultTool(tc.function.name, args, {
            studentId: sid, baseYear, defaultGrade,
            onSaved: (p) => savedPlacements.push(p),
          });
        } catch (e) {
          out = { 오류: e.message };
        }
        toolLog.push({
          name: tc.function.name,
          args,
          summary: out?.전체매칭 != null ? `${out.전체매칭}건 매칭 · ${out.반환}건 확인`
            : out?.자료 ? `자료 ${out.자료.length}건`
            : out?.저장됨 ? `저장 — ${out.내용}`
            : out?.오류 || '완료',
        });
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 60000) });
      }
      if (turn === MAX_TURNS - 1) reply = m.content || '자료 조회가 상한에 도달했습니다. 질문을 좁혀 다시 물어봐 주세요.';
    }

    sendDone({ success: true, reply, toolLog, savedPlacements });
  } catch (err) {
    console.error('[chat/agent] 오류:', err.message);
    sendDone({ success: false, message: err.userFacing ? err.message : friendlyAIError(err, aiModel), toolLog });
  }
});

// ── 로그인 (코드 기반) ────────────────────────────────
// - 관리자: ADMIN_CODE(환경변수) 또는 기존 APP_PASSWORD
// - 이용자: 관리자가 발급한 코드 (DB 조회)
app.post('/api/login', async (req, res) => {
  const cred = (req.body.code || req.body.password || '').trim();
  if (!cred) return res.json({ success: false, message: '코드를 입력해주세요' });

  const ip = getIp(req);
  const userAgent = req.headers['user-agent'] || '';
  const jti = crypto.randomBytes(12).toString('hex');

  // 1) 관리자 코드
  const adminCode = process.env.ADMIN_CODE || process.env.APP_PASSWORD;
  if (adminCode && cred === adminCode) {
    const adminUserId = await ensureAdminUser(); // 관리자도 본인 보드를 가질 수 있게 userId 부여
    const token = jwt.sign({ role: 'admin', name: '관리자', jti, userId: adminUserId || undefined }, JWT_SECRET, { expiresIn: '7d' });
    logEvent({ userId: null, type: 'login', detail: '관리자 로그인', ip });
    return res.json({ success: true, token, role: 'admin', name: '관리자' });
  }

  // 2) 이용자 코드 (DB)
  if (dbEnabled()) {
    try {
      const user = await findActiveUserByCode(cred);
      if (user) {
        const token = jwt.sign(
          { role: 'user', userId: user.id, name: user.name, jti },
          JWT_SECRET, { expiresIn: '7d' }
        );
        // 세션 생성 + 위치 조회는 비동기로 (응답 지연 방지)
        (async () => {
          const geo = await lookupGeo(ip);
          await createSession({ userId: user.id, jti, ip, userAgent, geo });
          await logEvent({ userId: user.id, type: 'login', detail: geo || '', ip });
        })().catch(() => {});
        return res.json({ success: true, token, role: 'user', name: user.name });
      }
    } catch (e) {
      console.error('[login] DB 조회 오류:', e.message);
    }
  }

  return res.json({ success: false, message: '유효하지 않은 코드입니다' });
});

// ── 하트비트 (현재 접속자 추적) ───────────────────────
app.post('/api/heartbeat', requireAuth, async (req, res) => {
  if (req.user?.jti && req.user?.role === 'user') {
    await touchSession(req.user.jti);
  }
  res.json({ success: true });
});

// ── 관리자: 이용자 코드 목록 + 사용량 ──────────────────
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, dbEnabled: dbEnabled(), users: await listUsersWithStats() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 관리자: 이용자 코드 발급
app.post('/api/admin/users', requireAdmin, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DATABASE_URL이 설정되지 않아 코드 발급이 불가합니다' });
  try {
    const user = await createUserCode((req.body.name || '').trim());
    res.json({ success: true, user });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 관리자: 코드 활성/비활성 토글
app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await setUserActive(Number(req.params.id), !!req.body.active);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 관리자: 코드 삭제
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    await deleteUser(Number(req.params.id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 관리자: 현재 접속 중인 사용자
app.get('/api/admin/active', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, sessions: await listActiveSessions() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 관리자: 최근 접속/사용 로그
app.get('/api/admin/logs', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, logs: await listRecentLogs(Number(req.query.limit) || 100) });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 관리자: 지식베이스 상태 (type별 청크 수)
app.get('/api/admin/kb', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, vectorEnabled: vectorEnabled(), counts: await countByType() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 인제스트 진행 상태 (백그라운드 작업 추적)
let ingestState = { running: false, phase: 'idle', docs: 0, docsDone: 0, chunks: 0, error: null, finishedAt: null };

// 관리자: Google Drive 지식베이스를 Supabase(pgvector)로 인제스트 (백그라운드 실행)
app.post('/api/admin/ingest/drive', requireAdmin, async (req, res) => {
  if (!vectorEnabled()) return res.status(400).json({ success: false, message: 'pgvector 비활성 — DATABASE_URL(Supabase)과 vector 확장을 확인하세요' });
  if (!process.env.OPENAI_API_KEY) return res.status(400).json({ success: false, message: 'OPENAI_API_KEY 미설정 — 임베딩 불가' });
  if (ingestState.running) return res.json({ success: true, started: false, already: true, state: ingestState });

  const replace = req.body?.replace !== false; // 기본: 기존 KB 비우고 교체
  ingestState = { running: true, phase: 'drive-read', docs: 0, docsDone: 0, chunks: 0, error: null, finishedAt: null };
  const ip = getIp(req);

  // 즉시 응답 — 무거운 작업은 백그라운드에서 (요청 타임아웃/Failed to fetch 방지)
  res.json({ success: true, started: true });

  (async () => {
    try {
      const docs = await loadAllKnowledgeDocs();
      ingestState.docs = docs.length;
      if (docs.length === 0) {
        ingestState = { running: false, phase: 'error', docs: 0, docsDone: 0, chunks: 0, error: 'Drive에서 추출된 문서가 없습니다 (폴더/권한 확인)', finishedAt: Date.now() };
        return;
      }
      if (replace) await clearKnowledge();
      ingestState.phase = 'embedding';
      const inserted = await ingestDocuments(docs, (p) => {
        ingestState.docsDone = p.doc;
        ingestState.chunks = p.chunks;
      });
      ingestState = { running: false, phase: 'done', docs: docs.length, docsDone: docs.length, chunks: inserted, error: null, finishedAt: Date.now() };
      logEvent({ userId: null, type: 'ingest', detail: `Drive ${docs.length}문서 → ${inserted}청크`, ip });
      console.log(`[ingest/drive] 완료: ${docs.length}문서 → ${inserted}청크`);
    } catch (e) {
      console.error('[ingest/drive] 오류:', e.message);
      ingestState = { running: false, phase: 'error', docs: ingestState.docs, docsDone: ingestState.docsDone, chunks: ingestState.chunks, error: e.message, finishedAt: Date.now() };
    }
  })();
});

// 관리자: 인제스트 진행 상태 + 현재 카운트
app.get('/api/admin/ingest/status', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, state: ingestState, counts: await countByType() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// 관리자: 파일 업로드로 지식베이스 추가
const kbUpload = upload.array('files', 20);
app.post('/api/admin/ingest/upload', requireAdmin, kbUpload, async (req, res) => {
  if (!vectorEnabled()) return res.status(400).json({ success: false, message: 'pgvector 비활성 상태입니다' });
  if (!process.env.OPENAI_API_KEY) return res.status(400).json({ success: false, message: 'OPENAI_API_KEY 미설정' });
  const type = (req.body.type || '').trim();
  const validTypes = ['대입정책', '대학별전형', '합격자사례'];
  if (!validTypes.includes(type)) return res.status(400).json({ success: false, message: `type은 ${validTypes.join('/')} 중 하나여야 합니다` });
  try {
    const files = req.files || [];
    const docs = [];
    for (const f of files) {
      let text = '';
      if (f.mimetype === 'application/pdf') {
        try { text = (await pdfParse(f.buffer)).text || ''; } catch (e) { text = ''; }
      } else if (f.mimetype.includes('wordprocessingml')) {
        const mammoth = await import('mammoth');
        text = (await mammoth.extractRawText({ buffer: f.buffer })).value || '';
      } else {
        text = f.buffer.toString('utf-8');
      }
      if (text.trim()) docs.push({ type, title: fixFilename(f.originalname), text });
    }
    if (docs.length === 0) return res.status(400).json({ success: false, message: '텍스트를 추출할 수 있는 파일이 없습니다' });
    const inserted = await ingestDocuments(docs);
    logEvent({ userId: null, type: 'ingest', detail: `업로드 ${docs.length}문서 → ${inserted}청크 (${type})`, ip: getIp(req) });
    res.json({ success: true, documents: docs.length, chunks: inserted, counts: await countByType() });
  } catch (e) {
    console.error('[ingest/upload] 오류:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 관리자: 지식베이스 전체 삭제 (재인제스트용)
app.delete('/api/admin/kb', requireAdmin, async (req, res) => {
  if (!vectorEnabled()) return res.status(400).json({ success: false, message: 'pgvector 비활성 상태입니다' });
  try {
    await clearKnowledge();
    res.json({ success: true, counts: await countByType() });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});
// ══════════════════════════════════════════════════════
// 대학 입결 (어디가 등 공식자료 업로드 → 검색)
// ══════════════════════════════════════════════════════

// 관리자: 입결 자료 업로드 (엑셀/CSV)
app.post('/api/admin/admissions/upload', requireAdmin, upload.single('file'), async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  if (!req.file) return res.status(400).json({ success: false, message: '파일이 없습니다' });
  try {
    const rows = parseSheet(req.file.buffer);
    if (rows.length === 0) return res.status(400).json({ success: false, message: '읽을 수 있는 행이 없습니다 (엑셀/CSV 형식 확인)' });
    const meta = {
      year: parseInt(req.body.year, 10) || null,
      univType: (req.body.univType || '').trim(),
      track: (req.body.track || '').trim(),
    };
    const inserted = await ingestRows(rows, meta);
    logEvent({ userId: null, type: 'admissions', detail: `${req.file.originalname} → ${inserted}행 (${meta.track}/${meta.univType}/${meta.year || '-'})`, ip: getIp(req) });
    res.json({ success: true, inserted, stats: await admissionStats() });
  } catch (e) {
    console.error('[admissions/upload] 오류:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// 입결 검색 (로그인 사용자 누구나)
app.get('/api/admissions/search', requireAuth, async (req, res) => {
  if (!dbEnabled()) return res.status(400).json({ success: false, message: 'DB 비활성 상태입니다' });
  try {
    const { univ, dept, track, year, univType, limit } = req.query;
    res.json({ success: true, rows: await searchAdmissions({ univ, dept, track, year, univType, limit }) });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 입결 통계 (총건수/연도)
app.get('/api/admissions/stats', requireAuth, async (req, res) => {
  try { res.json({ success: true, stats: await admissionStats() }); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// 관리자: 입결 전체 삭제
app.delete('/api/admin/admissions', requireAdmin, async (req, res) => {
  try { await clearAdmissions(); res.json({ success: true, stats: await admissionStats() }); }
  catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  await initDb();
  await refreshKbCount();
  const hasAdmin = !!(process.env.ADMIN_CODE || process.env.APP_PASSWORD);
  console.log(`🔐 인증: 관리자코드=${hasAdmin ? '설정됨' : '미설정!'}, DB=${dbEnabled() ? 'ON' : 'OFF'}, pgvector=${vectorEnabled() ? 'ON' : 'OFF'}, RAG=${ragAvailable() ? 'ON' : 'OFF'}`);
  console.log(`\n🚀 입시-Finder 서버 실행 중: http://localhost:${PORT}`);
  console.log(`📁 Drive 연결 테스트: http://localhost:${PORT}/api/drive/test`);

  // 시작 시 Drive 환경변수 상태 출력 (디버그)
  const hasEmail = !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const hasKey = !!process.env.GOOGLE_PRIVATE_KEY;
  const keyLen = (process.env.GOOGLE_PRIVATE_KEY || '').length;
  const hasFolder = !!process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID;
  console.log(`📋 Drive 환경변수: email=${hasEmail}, key=${hasKey}(${keyLen}자), folder=${hasFolder}\n`);
});
