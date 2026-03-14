// services/driveService.js
import { google } from 'googleapis';

const MAX_CHARS_PER_FILE = 3000;   // 파일당 최대 글자수
const MAX_FILES_PER_FOLDER = 3;    // 폴더당 최대 파일 수

const getAuth = () => new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY
      ?.replace(/\\n/g, '\n')
      ?.replace(/\\\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/drive.readonly'],
});

const getDrive = async () => google.drive({ version: 'v3', auth: getAuth() });

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
      const pdfParse = (await import('pdf-parse')).default;
      const parsed = await pdfParse(buffer);
      return parsed.text.slice(0, MAX_CHARS_PER_FILE);
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
  const folderId = process.env.GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID;
  const result = { 대입정책: '', 대학별전형: '', 합격자사례: '' };
  try {
    const drive = await getDrive();
    const folders = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)',
    });
    for (const folder of folders.data.files || []) {
      const files = await listFilesInFolder(folder.id);
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
