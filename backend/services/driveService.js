// services/driveService.js
import { google } from 'googleapis';

const MAX_CHARS_PER_FILE = 8000;   // 파일당 최대 글자수
const MAX_FILES_PER_FOLDER = 3;    // 폴더당 최대 파일 수

const getAuth = () => {
  const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  const rawKey = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  // Railway에서 JSON 이스케이프된 키를 처리
  let privateKey = rawKey
    .replace(/\\n/g, '\n')
    .replace(/^"|"$/g, '');
  // 만약 여전히 실제 줄바꿈이 없으면 \\n → \n 한번 더
  if (!privateKey.includes('\n') && privateKey.includes('\\n')) {
    privateKey = privateKey.replace(/\\n/g, '\n');
  }
  return new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });
};

const getDrive = async () => {
  const auth = getAuth();
  const client = await auth.getClient();
  return google.drive({ version: 'v3', auth: client });
};

export const listFilesInFolder = async (folderId) => {
  const drive = await getDrive();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType)',
    orderBy: 'modifiedTime desc',
    pageSize: MAX_FILES_PER_FOLDER,
  });
  return res.data.files || [];
};

export const extractFileText = async (fileId, mimeType, fileName) => {
  const drive = await getDrive();
  try {
    if (mimeType === 'text/plain') {
      const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'text' });
      return String(res.data).slice(0, MAX_CHARS_PER_FILE);
    }
    if (mimeType === 'application/vnd.google-apps.document') {
      const res = await drive.files.export({ fileId, mimeType: 'text/plain' }, { responseType: 'text' });
      return String(res.data).slice(0, MAX_CHARS_PER_FILE);
    }
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(res.data);
    if (mimeType === 'application/pdf') {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await Promise.race([
      pdfParse(buffer, { max: 3 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
    ]);
    const text = parsed.text?.trim();
    if (text && text.length > 50) return text.slice(0, MAX_CHARS_PER_FILE);
    return `[PDF: ${fileName} - 텍스트 추출 불가]`;
  } catch (pdfErr) {
    console.error(`PDF 파싱 실패 (${fileName}):`, pdfErr.message);
    return `[PDF: ${fileName} - 파싱 오류]`;
  }
}
    
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return result.value.slice(0, MAX_CHARS_PER_FILE);
    }
    return `[${fileName} — 지원하지 않는 형식]`;
  } catch (err) {
    console.error(`파일 추출 오류 (${fileName}):`, err.message);
    return `[${fileName} — 추출 오류]`;
  }
};

export const loadKnowledgeBase = async () => {
  const folderId = (process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID || '').trim();
  const result = { 대입정책: '', 대학별전형: '', 합격자사례: '' };
  if (!folderId) {
    console.error('GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID 환경변수가 설정되지 않았습니다.');
    return result;
  }
  try {
    const drive = await getDrive();
    console.log('[Drive] 인증 성공, 폴더 ID:', folderId);

    // 먼저 폴더 자체에 접근 가능한지 확인
    try {
      const folderMeta = await drive.files.get({ fileId: folderId, fields: 'id, name' });
      console.log('[Drive] 루트 폴더 접근 성공:', folderMeta.data.name);
    } catch (metaErr) {
      console.error('[Drive] 루트 폴더 접근 실패:', metaErr.message);
    }

    // 하위 폴더뿐 아니라 모든 항목도 조회 (디버그)
    const allItems = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: 'files(id, name, mimeType)',
    });
    console.log('[Drive] 폴더 내 모든 항목:', (allItems.data.files || []).map(f => `${f.name} (${f.mimeType})`));

    const folders = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });
    console.log('[Drive] 하위 폴더 수:', (folders.data.files || []).length);
    for (const folder of folders.data.files || []) {
      console.log('[Drive] 폴더 발견:', folder.name, folder.id);

      const files = await listFilesInFolder(folder.id);
      console.log('[Drive] 파일 수:', files.length, files.map(f => f.name));
      let combined = `\n=== ${folder.name} ===\n`;
      for (const file of files) {
        const text = await extractFileText(file.id, file.mimeType, file.name);
        combined += `\n--- ${file.name} ---\n${text}\n`;
      }
      const n = folder.name;
      if (n.includes('정책') || n.includes('01') || n.includes('1.')) result.대입정책 += combined;
      else if (n.includes('전형') || n.includes('02') || n.includes('2.')) result.대학별전형 += combined;
      else if (n.includes('사례') || n.includes('03') || n.includes('3.')) result.합격자사례 += combined;
    }
  } catch (err) {
    console.error('지식베이스 로딩 오류:', err.message);
  }
  return result;
};

export const loadStudentFiles = async (studentName) => {
  const folderId = process.env.GOOGLE_DRIVE_STUDENTS_FOLDER_ID;
  try {
    const drive = await getDrive();
    const folders = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and name contains '${studentName}' and trashed=false`,
      fields: 'files(id, name)',
    });
    if (!folders.data.files?.length) return '';
    const files = await listFilesInFolder(folders.data.files[0].id);
    let combined = '';
    for (const file of files) {
      const text = await extractFileText(file.id, file.mimeType, file.name);
      combined += `\n--- ${file.name} ---\n${text}\n`;
    }
    return combined;
  } catch (err) {
    console.error('학생 파일 로딩 오류:', err.message);
    return '';
  }
};
