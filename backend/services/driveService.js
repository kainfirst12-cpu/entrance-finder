// services/driveService.js
import { google } from 'googleapis';

const MAX_CHARS_PER_FILE = 8000;
const MAX_FILES_PER_FOLDER = 3;
const PDF_TIMEOUT = 10000;       // PDF 파싱 타임아웃 10초
const TOTAL_TIMEOUT = 60000;     // 전체 로딩 타임아웃 60초
const API_TIMEOUT = 10000;       // Drive API 개별 호출 타임아웃 10초
const AUTH_TIMEOUT = 15000;      // 인증 타임아웃 15초

// ── Drive API 호출 래퍼 (타임아웃 포함) ─────────────────
function withTimeout(promise, ms = API_TIMEOUT, label = 'Drive API') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} 타임아웃 (${ms / 1000}초)`)), ms)
    ),
  ]);
}

// ── Drive 클라이언트 싱글톤 (인증 1회만) ──────────────
let driveClient = null;

function parsePrivateKey(raw) {
  if (!raw) return '';
  // 1) 앞뒤 따옴표 제거
  let key = raw.trim().replace(/^["']|["']$/g, '');
  // 2) 리터럴 \\n → 실제 줄바꿈 (Railway 등 환경변수에서 흔한 문제)
  key = key.replace(/\\n/g, '\n');
  // 3) 여전히 줄바꿈이 없으면 base64 블록 기준으로 복원 시도
  if (!key.includes('\n') && key.includes('-----')) {
    key = key
      .replace(/-----BEGIN PRIVATE KEY-----/, '-----BEGIN PRIVATE KEY-----\n')
      .replace(/-----END PRIVATE KEY-----/, '\n-----END PRIVATE KEY-----\n');
  }
  return key;
}

async function getDrive() {
  if (driveClient) return driveClient;

  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
  const privateKey = parsePrivateKey(rawKey);

  if (!email || !privateKey) {
    throw new Error(`Drive 인증 정보 누락 — email: ${email ? '있음' : '없음'}, key: ${privateKey ? '있음' : '없음'}`);
  }

  console.log('[Drive] 인증 시도...', { email, keyLength: privateKey.length, keyStart: privateKey.slice(0, 30) });

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  const client = await Promise.race([
    auth.getClient(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Drive 인증 타임아웃 (15초) — GOOGLE_PRIVATE_KEY 형식을 확인하세요')), AUTH_TIMEOUT)
    ),
  ]);

  driveClient = google.drive({ version: 'v3', auth: client });
  console.log('[Drive] 인증 완료');
  return driveClient;
}

// ── 파일 목록 조회 ────────────────────────────────────
async function listFiles(drive, folderId) {
  const res = await withTimeout(
    drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType)',
      orderBy: 'modifiedTime desc',
      pageSize: MAX_FILES_PER_FOLDER,
    }),
    API_TIMEOUT,
    'files.list'
  );
  return res.data.files || [];
}

// ── 파일 텍스트 추출 ──────────────────────────────────
async function extractText(drive, fileId, mimeType, fileName) {
  try {
    if (mimeType === 'text/plain') {
      const res = await withTimeout(
        drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' }),
        API_TIMEOUT, `files.get(${fileName})`
      );
      return String(res.data).slice(0, MAX_CHARS_PER_FILE);
    }
    if (mimeType === 'application/vnd.google-apps.document') {
      const res = await withTimeout(
        drive.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' }),
        API_TIMEOUT, `files.export(${fileName})`
      );
      return String(res.data).slice(0, MAX_CHARS_PER_FILE);
    }

    const res = await withTimeout(
      drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' }),
      API_TIMEOUT, `files.get(${fileName})`
    );
    const buffer = Buffer.from(res.data);

    if (mimeType === 'application/pdf') {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const parsed = await Promise.race([
          pdfParse(buffer, { max: 3 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('PDF 파싱 타임아웃')), PDF_TIMEOUT)),
        ]);
        const text = parsed.text?.trim();
        if (text && text.length > 50) return text.slice(0, MAX_CHARS_PER_FILE);
        return `[PDF: ${fileName} - 텍스트 추출 불가]`;
      } catch (pdfErr) {
        console.error(`[Drive] PDF 파싱 실패 (${fileName}):`, pdfErr.message);
        return `[PDF: ${fileName} - 파싱 오류: ${pdfErr.message}]`;
      }
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value.slice(0, MAX_CHARS_PER_FILE);
    }

    return `[${fileName} - 지원하지 않는 형식]`;
  } catch (err) {
    console.error(`[Drive] 파일 추출 오류 (${fileName}):`, err.message);
    return `[${fileName} - 추출 오류]`;
  }
}

// ── 폴더 1개 처리 (파일들을 병렬로 추출) ──────────────
async function processFolder(drive, folder) {
  const files = await listFiles(drive, folder.id);
  if (!files.length) return '';

  // 폴더 내 파일들을 병렬로 처리
  const texts = await Promise.all(
    files.map(f => extractText(drive, f.id, f.mimeType, f.name))
  );

  let combined = `\n=== ${folder.name} ===\n`;
  files.forEach((f, i) => {
    combined += `\n--- ${f.name} ---\n${texts[i]}\n`;
  });
  return combined;
}

// ── 지식베이스 로딩 (타임아웃 + 병렬) ─────────────────
export const loadKnowledgeBase = async () => {
  const folderId = (process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID || '').trim();
  const result = { 대입정책: '', 대학별전형: '', 합격자사례: '' };

  if (!folderId) {
    console.error('[Drive] GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID 미설정');
    return result;
  }

  const startTime = Date.now();

  try {
    const drive = await getDrive();

    // 전체 타임아웃 래핑
    const loadWithTimeout = async () => {
      // 하위 폴더 조회
      const folders = await withTimeout(
        drive.files.list({
          q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id, name)',
        }),
        API_TIMEOUT,
        'folders.list'
      );

      const subFolders = folders.data.files || [];
      console.log(`[Drive] 하위 폴더 ${subFolders.length}개 발견 (${Date.now() - startTime}ms)`);

      if (!subFolders.length) return;

      // 모든 폴더를 병렬로 처리
      const folderResults = await Promise.all(
        subFolders.map(folder => processFolder(drive, folder))
      );

      subFolders.forEach((folder, i) => {
        const n = folder.name;
        const content = folderResults[i];
        if (!content) return;
        if (n.includes('정책') || n.includes('01') || n.includes('1.')) result.대입정책 += content;
        else if (n.includes('전형') || n.includes('02') || n.includes('2.')) result.대학별전형 += content;
        else if (n.includes('사례') || n.includes('03') || n.includes('3.')) result.합격자사례 += content;
      });
    };

    await Promise.race([
      loadWithTimeout(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('전체 타임아웃 60초 초과')), TOTAL_TIMEOUT)),
    ]);

    console.log(`[Drive] 로딩 완료 (${Date.now() - startTime}ms) — 대입정책:${result.대입정책.length}자, 대학별전형:${result.대학별전형.length}자, 합격자사례:${result.합격자사례.length}자`);
  } catch (err) {
    console.error(`[Drive] 지식베이스 로딩 오류 (${Date.now() - startTime}ms):`, err.message);
  }

  return result;
};

// ── 학생 파일 로딩 ────────────────────────────────────
export const loadStudentFiles = async (studentName) => {
  const folderId = process.env.GOOGLE_DRIVE_STUDENTS_FOLDER_ID;
  if (!folderId) return '';

  try {
    const drive = await getDrive();
    const folders = await withTimeout(
      drive.files.list({
        q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and name contains '${studentName}' and trashed=false`,
        fields: 'files(id, name)',
      }),
      API_TIMEOUT,
      'student.folders.list'
    );
    if (!folders.data.files?.length) return '';

    const files = await listFiles(drive, folders.data.files[0].id);
    const texts = await Promise.all(
      files.map(f => extractText(drive, f.id, f.mimeType, f.name))
    );

    let combined = '';
    files.forEach((f, i) => {
      combined += `\n--- ${f.name} ---\n${texts[i]}\n`;
    });
    return combined;
  } catch (err) {
    console.error('[Drive] 학생 파일 로딩 오류:', err.message);
    return '';
  }
};

// 외부에서 사용할 수 있도록 export
export { listFiles as listFilesInFolder };
