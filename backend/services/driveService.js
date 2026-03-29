// services/driveService.js
import { google } from 'googleapis';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const MAX_CHARS_PER_FILE = 10000;
const MAX_FILES_PER_FOLDER = 50;
const MAX_RELEVANT_FILES = 5;    // 계열 필터 후 최대 파일 수
const MAX_CHARS_PER_CATEGORY = 25000; // 카테고리당 최대 총 글자수
const PDF_TIMEOUT = 10000;
const TOTAL_TIMEOUT = 60000;
const API_TIMEOUT = 10000;
const AUTH_TIMEOUT = 15000;

// ── 계열 매핑 (학생 전공 → 파일 필터 키워드) ─────────────
const FIELD_MAP = {
  이공계열: ['이공', '공학', '자연', '공학자연'],
  메디컬: ['메디컬', '의학', '의예', '약학', '간호', '생명'],
  인문계열: ['인문', '상경', '사회', '인문상경'],
};

function getStudentField(major) {
  if (!major) return null;
  const m = major.toLowerCase();
  // 메디컬
  if (/의학|의예|치의|한의|약학|수의|간호|바이오|생명공학/.test(m)) return '메디컬';
  // 인문/사회
  if (/경영|경제|법학|행정|정치|심리|사회|언론|미디어|국어|영어|문학|사학|철학|사범|교육|국제/.test(m)) return '인문계열';
  // 이공계열 (기본값)
  return '이공계열';
}

function isFileRelevant(fileName, studentField) {
  if (!studentField) return true; // 계열 모르면 전부 포함
  const fn = fileName.toLowerCase();

  // 공통 파일 (항상 포함)
  if (/수시|정시|입시결과|논술|전형|기본사항|모집|무지개|프롬프트|강화/.test(fn)) return true;

  // 계열 키워드 매칭
  const keywords = FIELD_MAP[studentField] || [];
  if (keywords.some(kw => fn.includes(kw))) return true;

  // 유니브클래스/유클 파일은 이름에서 계열 판단
  if (/유니브|유클/.test(fn)) {
    // 계열 키워드가 없으면 공통 자료로 간주
    const hasFieldKeyword = Object.values(FIELD_MAP).flat().some(kw => fn.includes(kw));
    return !hasFieldKeyword; // 계열 키워드 없으면 공통
  }

  // 생기부 예시 파일 — 계열 매칭
  if (/생기부/.test(fn)) {
    return keywords.some(kw => fn.includes(kw));
  }

  return true; // 그 외 파일은 포함
}

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
  let key = raw.trim().replace(/^["']|["']$/g, '');
  key = key.replace(/\\n/g, '\n');
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

  console.log('[Drive] 인증 시도...', { email, keyLength: privateKey.length });

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  const client = await Promise.race([
    auth.getClient(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Drive 인증 타임아웃')), AUTH_TIMEOUT)
    ),
  ]);

  driveClient = google.drive({ version: 'v3', auth: client });
  console.log('[Drive] 인증 완료');
  return driveClient;
}

// ── 파일 목록 조회 (전체) ────────────────────────────────
async function listFiles(drive, folderId) {
  const res = await withTimeout(
    drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType, size)',
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
    if (mimeType === 'text/plain' || fileName.endsWith('.md')) {
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
    // Google Sheets
    if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const res = await withTimeout(
        drive.files.export({ fileId, mimeType: 'text/csv' }, { responseType: 'text' }),
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
      // 1차: pdftotext (poppler) — 한글 PDF에 강함
      try {
        const tmpPdf = join(tmpdir(), `drive-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
        const tmpTxt = tmpPdf.replace('.pdf', '.txt');
        writeFileSync(tmpPdf, buffer);
        execSync(`pdftotext -enc UTF-8 "${tmpPdf}" "${tmpTxt}"`, { timeout: PDF_TIMEOUT });
        const text = readFileSync(tmpTxt, 'utf-8').trim();
        try { unlinkSync(tmpPdf); unlinkSync(tmpTxt); } catch {}
        if (text && text.length > 50) {
          const koreanChars = (text.match(/[가-힣]/g) || []).length;
          console.log(`[Drive] pdftotext 성공: ${fileName} → ${text.length}자 (한글 ${koreanChars}자)`);
          return text.slice(0, MAX_CHARS_PER_FILE);
        }
      } catch (e) {
        console.warn(`[Drive] pdftotext 실패 (${fileName}):`, e.message);
      }

      // 2차: pdf-parse 폴백
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const parsed = await Promise.race([
          pdfParse(buffer, { max: 10 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('PDF 타임아웃')), PDF_TIMEOUT)),
        ]);
        const text = parsed.text?.trim();
        if (text && text.length > 50) {
          console.log(`[Drive] pdf-parse 성공: ${fileName} → ${text.length}자`);
          return text.slice(0, MAX_CHARS_PER_FILE);
        }
      } catch (e2) {
        console.error(`[Drive] pdf-parse도 실패 (${fileName}):`, e2.message);
      }

      return `[PDF: ${fileName} - 텍스트 추출 불가]`;
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value.slice(0, MAX_CHARS_PER_FILE);
    }

    // Excel
    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        mimeType === 'application/vnd.ms-excel') {
      return `[Excel: ${fileName} - 텍스트로 변환 불가, Google Sheets로 변환 권장]`;
    }

    return `[${fileName} - 지원하지 않는 형식: ${mimeType}]`;
  } catch (err) {
    console.error(`[Drive] 파일 추출 오류 (${fileName}):`, err.message);
    return `[${fileName} - 추출 오류]`;
  }
}

// ── 폴더 처리 (계열 필터링 적용) ─────────────────────────
async function processFolder(drive, folder, studentField) {
  const allFiles = await listFiles(drive, folder.id);
  if (!allFiles.length) return '';

  // 계열 기반 필터링
  const relevantFiles = allFiles.filter(f => isFileRelevant(f.name, studentField));
  const filesToProcess = relevantFiles.slice(0, MAX_RELEVANT_FILES);

  console.log(`[Drive] ${folder.name}: 전체 ${allFiles.length}개 → 관련 ${relevantFiles.length}개 → 처리 ${filesToProcess.length}개`);
  if (relevantFiles.length > MAX_RELEVANT_FILES) {
    console.log(`[Drive] ${folder.name}: ${relevantFiles.length - MAX_RELEVANT_FILES}개 파일 생략됨`);
  }

  // 파일들을 병렬로 처리
  const texts = await Promise.all(
    filesToProcess.map(f => extractText(drive, f.id, f.mimeType, f.name))
  );

  let combined = `\n=== ${folder.name} (${filesToProcess.length}/${allFiles.length} 파일) ===\n`;
  filesToProcess.forEach((f, i) => {
    if (texts[i] && !texts[i].startsWith('[')) {
      combined += `\n--- ${f.name} ---\n${texts[i]}\n`;
    }
  });
  return combined;
}

// ── 지식베이스 캐시 ──────────────────────────────────────
let kbCache = null;
let kbCacheTime = 0;
const KB_CACHE_TTL = 10 * 60 * 1000; // 10분 캐시

// ── 지식베이스 로딩 (계열 필터링 + 캐싱) ─────────────────
export const loadKnowledgeBase = async (studentMajor) => {
  const folderId = (process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID || '').trim();
  const result = { 대입정책: '', 대학별전형: '', 합격자사례: '' };

  if (!folderId) {
    console.error('[Drive] GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID 미설정');
    return result;
  }

  const studentField = getStudentField(studentMajor);
  console.log(`[Drive] 학생 계열: ${studentMajor} → ${studentField}`);

  const startTime = Date.now();

  try {
    const drive = await getDrive();

    const loadWithTimeout = async () => {
      const folders = await withTimeout(
        drive.files.list({
          q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
          fields: 'files(id, name)',
        }),
        API_TIMEOUT,
        'folders.list'
      );

      const subFolders = folders.data.files || [];
      console.log(`[Drive] 하위 폴더 ${subFolders.length}개 발견`);

      if (!subFolders.length) return;

      // 모든 폴더를 병렬로 처리 (계열 필터링 적용)
      const folderResults = await Promise.all(
        subFolders.map(folder => processFolder(drive, folder, studentField))
      );

      subFolders.forEach((folder, i) => {
        const n = folder.name;
        const content = folderResults[i];
        if (!content) return;
        if (n.includes('정책') || n.includes('01') || n.includes('1.')) result.대입정책 += content;
        else if (n.includes('전형') || n.includes('02') || n.includes('2.')) result.대학별전형 += content;
        else if (n.includes('사례') || n.includes('03') || n.includes('3.')) result.합격자사례 += content;
      });

      // 카테고리별 글자수 제한 (시스템 프롬프트 크기 제어)
      if (result.대입정책.length > MAX_CHARS_PER_CATEGORY) result.대입정책 = result.대입정책.slice(0, MAX_CHARS_PER_CATEGORY);
      if (result.대학별전형.length > MAX_CHARS_PER_CATEGORY) result.대학별전형 = result.대학별전형.slice(0, MAX_CHARS_PER_CATEGORY);
      if (result.합격자사례.length > MAX_CHARS_PER_CATEGORY) result.합격자사례 = result.합격자사례.slice(0, MAX_CHARS_PER_CATEGORY);
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

export { listFiles as listFilesInFolder };
