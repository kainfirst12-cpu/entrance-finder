import { useState, useRef } from 'react';
import { API_BASE } from '../apiBase';

// SSE(keepalive 포함) 또는 일반 JSON 응답을 모두 처리해 최종 결과 객체를 반환.
// 긴 AI 생성(refine 등)은 서버가 8초마다 keepalive를 보내고 마지막에 data: {결과}를 보낸다.
async function postForResult(url, opts) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    return res.json();
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try { result = JSON.parse(line.slice(6)); } catch {}
      }
    }
  }
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}

const MODEL_CONFIG = {
  claude:        { icon: '🔵', label: 'Claude Sonnet 4.6', color: '#7c6af7', group: 'claude' },
  'claude-opus': { icon: '🔷', label: 'Claude Opus 4.8',   color: '#5b21b6', group: 'claude' },
  gemini:        { icon: '🟢', label: 'Gemini 3.5 Flash',    color: '#4caf50', group: 'gemini' },
  'gemini-pro':  { icon: '🟩', label: 'Gemini 3.1 Pro',    color: '#166534', group: 'gemini' },
  gpt:           { icon: '🟡', label: 'GPT-5.5',           color: '#f0a500', group: 'gpt' },
  'gpt-mini':    { icon: '🟠', label: 'GPT-5.4 Mini',      color: '#ea580c', group: 'gpt' },
  'gpt-4.1':     { icon: '🟤', label: 'GPT-5.4',           color: '#78350f', group: 'gpt' },
  'o3':          { icon: '⚪', label: 'GPT-5.5 Pro',       color: '#374151', group: 'gpt' },
  'o4-mini':     { icon: '🔘', label: 'GPT-5.4 Nano',      color: '#6b7280', group: 'gpt' },
};

const SECTION_MAP = [
  { key: 'caseMatching',   num: '0', title: '합격자 사례 매칭 분석' },
  { key: 'academic',       num: '1', title: '학업역량 종합 분석' },
  { key: 'activity',       num: '2', title: '비교과 활동 평가' },
  { key: 'career',         num: '3', title: '진로 역량 및 전공 적합성' },
  { key: 'strategy',       num: '4', title: '수시 지원 전략 (6장 카드)' },
  { key: 'roadmap',        num: '5', title: '핵심 리스크 및 대응 방안' },
  { key: 'recordFeedback', num: '6', title: '실행 계획' },
  { key: 'dashboard',      num: '7', title: '종합 평가 및 권고사항' },
];

// 검증 반영 결과에서 메타 표현 제거 (보수적: 명백한 마커만)
function sanitizeRefinedContent(raw) {
  if (!raw) return raw;
  let t = raw;
  // 1) 괄호/볼드 안의 메타 마커
  t = t.replace(/\s*[（(]\s*(수정됨|수정 사항|수정함|수정|개선됨|개선|보완됨|보완|재작성됨|재작성|반영됨|반영)\s*[)）]\s*/g, ' ');
  t = t.replace(/\*\*\s*(수정됨|수정 사항|수정|개선됨|개선|보완됨|보완|재작성됨|재작성|반영됨|반영)\s*\*\*/g, '');
  // 2) 흔한 메타 문장이 단독으로 들어간 줄 제거 (보수적: 짧은 줄만)
  const metaLineRe = /^[\s>*-]*.{0,80}(검증\s*(피드백|결과|에서)?\s*(을|를|에)?\s*(반영|반영하여|반영함|토대로|기반)|기존\s*분석(에서는|을\s*개선|을\s*다듬어|보다)|이전\s*분석|원래\s*분석|지적된?\s*사항(을|이)?|(피드백|검증)을?\s*토대로|AI\s*분석을\s*다듬어|정확성을\s*높이기\s*위해|오류를\s*바로잡|재구성하여|재작성하여)/;
  t = t.split('\n').filter(line => !metaLineRe.test(line)).join('\n');
  // 3) 연속된 빈 줄 정리
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

// 이모지 제거
function stripEmojis(str) {
  if (!str) return str;
  return str.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}]/gu, '');
}

// 마크다운 → HTML 변환 (테이블, 볼드, 헤딩, 블록쿼트 등)
function mdToHtml(raw) {
  if (!raw) return '';
  let text = stripEmojis(raw);
  // AI가 출력한 <br> 태그를 줄바꿈으로 변환 (HTML escape 전에 처리)
  text = text.replace(/<br\s*\/?>/gi, '\n');
  // HTML escape
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = text.split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 마크다운 테이블 감지: | col | col | 패턴
    if (/^\s*\|.*\|/.test(line)) {
      const tableLines = [];
      while (i < lines.length && /^\s*\|.*\|/.test(lines[i])) {
        tableLines.push(lines[i]);
        i++;
      }
      // 구분선 (|---|---| ) 제거하고 데이터 행만 추출
      const dataRows = tableLines.filter(l => !/^\s*\|[\s\-:]+\|/.test(l));
      if (dataRows.length > 0) {
        let html = '<div class="md-table-wrap"><table class="md-table">';
        dataRows.forEach((row, ri) => {
          const cells = row.split('|')
            .filter((_, ci, arr) => ci > 0 && ci < arr.length - 1)
            .map(c => c.trim()
              .replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
              .replace(/`([^`]+)`/g, '$1'));
          const tag = ri === 0 ? 'th' : 'td';
          html += '<tr>' + cells.map(c => `<${tag}>${c}</${tag}>`).join('') + '</tr>';
        });
        html += '</table></div>';
        out.push(html);
      }
      continue;
    }

    // 코드블록 ``` 제거
    if (/^\s*```/.test(line)) { i++; continue; }

    // 구분선 (────) → <hr>
    if (/^[─━─]{5,}/.test(line.trim())) {
      out.push('<hr class="md-hr">');
      i++; continue;
    }

    // 소제목 번호 패턴 감지 (예: 1.1, 2.3.1 등)
    const subsectionMatch = line.match(/^(\d+\.\d+(?:\.\d+)?)\s+(.+)/);
    if (subsectionMatch) {
      const depth = subsectionMatch[1].split('.').length;
      const cls = depth <= 2 ? 'md-h3' : 'md-h4';
      out.push(`<div class="${cls}">${subsectionMatch[1]} ${subsectionMatch[2]}</div>`);
      i++; continue;
    }

    // 헤딩 ### → 소제목
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = Math.min(headingMatch[1].length, 4);
      out.push(`<div class="md-h${level}">${headingMatch[2]}</div>`);
      i++; continue;
    }

    // 마크다운 볼드 → <strong> 태그
    let processed = line
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');

    out.push(processed);
    i++;
  }

  return out.join('\n');
}

export default function AnalysisResult({ data, onBack, onNewAnalysis, onReanalyze, selectedModel, apiKey, geminiKey, gptKey }) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [verifyModel, setVerifyModel] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null); // raw text (legacy)
  const [verifyItems, setVerifyItems] = useState([]); // parsed checklist items
  const [checkedItems, setCheckedItems] = useState({}); // { index: boolean }
  const [refining, setRefining] = useState(false);
  const [refinedResults, setRefinedResults] = useState(null);
  // 검증 반영 미리보기 staging
  // { changes: { [sectionKey]: { before, after, num, title } }, appliedIdx: number[] }
  const [pendingRefine, setPendingRefine] = useState(null);
  const [previewExpandedKey, setPreviewExpandedKey] = useState(null);
  const [editingKey, setEditingKey] = useState(null);
  const [editText, setEditText] = useState('');
  const [manualEdits, setManualEdits] = useState({});
  const [showCoverModal, setShowCoverModal] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatImages, setChatImages] = useState([]); // {name, mimeType, base64, preview}
  const [chatDragging, setChatDragging] = useState(false);
  const chatFileInputRef = useRef(null);
  const [regeneratingKeys, setRegeneratingKeys] = useState(new Set());
  const [coverEdit, setCoverEdit] = useState({
    reportTitle: localStorage.getItem('ef_report_title') || 'PATHFINDER REPORT',
    brandName: localStorage.getItem('ef_brand_name') || 'PATHFINDER EDU',
    brandSub: localStorage.getItem('ef_brand_sub') || '패스파인더 에듀',
    logoData: localStorage.getItem('ef_logo') || '',
  });
  const { results: originalResults, studentData, pdfCount, analyzedModel, pdfTexts } = data || {};
  const baseResults = refinedResults || originalResults;
  // 수동 편집이 있으면 해당 섹션만 덮어씌움
  const results = { ...baseResults, ...manualEdits };

  const usedModel = analyzedModel || selectedModel || 'claude';

  // 검증에 사용할 수 있는 AI 목록 (분석에 사용한 AI 제외)
  const verifyOptions = Object.entries(MODEL_CONFIG).filter(([key]) => key !== usedModel);

  const getKeyForModel = (model) => {
    const group = MODEL_CONFIG[model]?.group || model;
    if (group === 'claude' || model.startsWith('claude')) return apiKey;
    if (group === 'gemini' || model.startsWith('gemini')) return geminiKey;
    if (group === 'gpt' || model.startsWith('gpt')) return gptKey;
    return '';
  };

  const handleDownloadPDF = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(`${API_BASE}/api/generate-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': localStorage.getItem('ef_apikey') || '',
        },
        body: JSON.stringify({ analysisData: results, studentData }),
      });
      if (!response.ok) throw new Error('PDF 생성 실패');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${studentData?.name || '학생'}_입시분석_리포트.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('PDF 다운로드 오류: ' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  // JSON 내보내기
  const [assigning, setAssigning] = useState(false);
  const assignToBoard = async () => {
    const tok = localStorage.getItem('ef_token');
    if (!studentData?.name) { alert('학생 이름이 없어 배정할 수 없습니다.'); return; }
    setAssigning(true);
    try {
      const analysisText = SECTION_MAP.filter(({ key }) => results?.[key])
        .map(({ key, title }) => `## ${title}\n${results[key]}`).join('\n\n');
      const res = await fetch(`${API_BASE}/api/board/upsert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({
          name: studentData.name, school: studentData.school, grade: studentData.grade,
          major: studentData.major, targetUniv: studentData.targetUniv,
          record: { type: '생기부 분석', title: `${MODEL_CONFIG[usedModel]?.label || 'AI'} 분석`, content: analysisText },
        }),
      });
      const d = await res.json();
      if (d.success) alert(`'${studentData.name}' 학생 보드에 배정되었습니다.\n학생 관리 보드에서 카드를 클릭하면 이 분석을 볼 수 있어요.`);
      else alert('배정 실패: ' + (d.message || '다시 로그인해 주세요'));
    } catch (e) { alert('배정 오류: ' + e.message); }
    finally { setAssigning(false); }
  };

  const handleExportJSON = () => {
    const exportData = {
      version: 2,
      exportedAt: new Date().toISOString(),
      studentData,
      results,
      analyzedModel: usedModel,
      pdfCount: pdfCount || 0,
      pdfTexts: pdfTexts || '', // 재분석용 — PDF 재업로드 없이도 분석 재실행 가능
      refinedResults: refinedResults || null,
      manualEdits: Object.keys(manualEdits).length > 0 ? manualEdits : null,
      verifyResult: verifyResult || null,
    };
    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const name = studentData?.name || '학생';
    const date = new Date().toISOString().slice(0, 10);
    a.download = `${name}_입시분석_${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 표지 수정 모달 열기
  const year = new Date().getFullYear();
  const openCoverModal = () => {
    setCoverEdit({
      reportTitle: localStorage.getItem('ef_report_title') || 'PATHFINDER REPORT',
      mainTitle: '입시 컨설팅 종합 분석 리포트',
      subTitle: `${studentData?.entryYear || year + 2}학년도 대입 대비`,
      studentName: studentData?.name || '',
      studentSchool: `${studentData?.school || ''}${studentData?.grade ? ' / ' + studentData.grade : ''}`,
      studentMajor: studentData?.major || '',
      studentTarget: studentData?.targetUniv || studentData?.target || '',
      brandName: localStorage.getItem('ef_brand_name') || 'PATHFINDER EDU',
      brandSub: localStorage.getItem('ef_brand_sub') || '패스파인더 에듀',
      logoData: localStorage.getItem('ef_logo') || '',
    });
    setShowCoverModal(true);
  };

  const handlePrintHTML = () => {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const yr = new Date().getFullYear();
    const modelLabel = MODEL_CONFIG[usedModel]?.label || 'AI';
    // 표지 정보는 모달에서 편집된 coverEdit 사용
    const cvName = coverEdit.studentName || studentData?.name || '학생';
    const cvSchool = coverEdit.studentSchool || `${studentData?.school || ''}${studentData?.grade ? ' / ' + studentData.grade : ''}`;
    const cvMajor = coverEdit.studentMajor || studentData?.major || '';
    const cvTarget = coverEdit.studentTarget || studentData?.targetUniv || '';
    const cvMainTitle = coverEdit.mainTitle || '입시 컨설팅 종합 분석 리포트';
    const cvSubTitle = coverEdit.subTitle || `${studentData?.entryYear || yr + 2}학년도 대입 대비`;

    // 섹션 타이틀 매핑 (PDF 시안 스타일)
    const sectionTitles = [
      { key: 'caseMatching',   num: '0', title: '합격자 사례 매칭 분석' },
      { key: 'academic',       num: '1', title: '학업역량 심층 분석' },
      { key: 'activity',       num: '2', title: '비교과 활동 분석' },
      { key: 'career',         num: '3', title: '진로 역량 및 전공 적합성 분석' },
      { key: 'strategy',       num: '4', title: '지원 전략 수립' },
      { key: 'roadmap',        num: '5', title: '3년 로드맵' },
      { key: 'recordFeedback', num: '6', title: '세특 Before/After 개선안' },
      { key: 'dashboard',      num: '7', title: '종합 대시보드' },
    ];

    const activeSections = sectionTitles.filter(({ key }) => results?.[key]);

    // 검증 결과
    let verifyHTML = '';
    if (verifyResult) {
      const vContent = mdToHtml(verifyResult.content);
      const vLabel = MODEL_CONFIG[verifyResult.model]?.label || 'AI';
      verifyHTML = `
        <div class="section">
          <h2 class="section-title" style="color:#92400e;">${vLabel} 교차 검증 리포트</h2>
          <div class="section-divider" style="background:#d97706;"></div>
          <div class="verify-badge">${MODEL_CONFIG[usedModel]?.label} 분석 결과를 ${vLabel}(이)가 검증</div>
          <div class="section-body">${vContent}</div>
        </div>`;
    }

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${name} 입시 분석 리포트 - PATHFINDER REPORT</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;900&display=swap');
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --navy: #0f172a;
    --dark-blue: #1e293b;
    --blue: #1d4ed8;
    --blue-light: #3b82f6;
    --blue-bg: #eff6ff;
    --red: #dc2626;
    --text: #1e293b;
    --text2: #475569;
    --text3: #94a3b8;
    --border: #e2e8f0;
    --surface: #f8fafc;
  }

  body {
    font-family: 'Noto Sans KR', 'Inter', sans-serif;
    color: var(--text);
    background: #fff;
    font-size: 13px;
    line-height: 1.75;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-bar {
    position: fixed; top: 0; left: 0; right: 0;
    background: var(--navy);
    color: #fff;
    display: flex; align-items: center; justify-content: center; gap: 16px;
    padding: 12px 24px; z-index: 100;
    font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
  }
  .print-bar button {
    padding: 10px 28px; background: #fff; color: var(--navy);
    border: none; border-radius: 8px; font-size: 14px; font-weight: 700;
    cursor: pointer; font-family: inherit;
  }
  .print-bar button:hover { background: var(--blue-bg); }
  .print-bar .close-btn {
    background: transparent; border: 1px solid rgba(255,255,255,0.3);
    color: #fff; padding: 10px 20px; font-weight: 500;
  }

  .report { max-width: 780px; margin: 68px auto 60px; padding: 0 20px; }

  /* ── 커버 ─────────────────────────────── */
  .cover {
    text-align: center;
    padding: 0;
    margin-bottom: 0;
    page-break-after: always;
    min-height: 92vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    position: relative;
  }
  .cover-brand {
    font-family: 'Inter', sans-serif;
    font-size: 15px;
    font-weight: 800;
    letter-spacing: 0.25em;
    color: var(--blue);
    text-transform: uppercase;
    margin-bottom: 52px;
  }
  .cover-main-title {
    font-size: 38px;
    font-weight: 900;
    color: var(--navy);
    line-height: 1.25;
    margin-bottom: 14px;
  }
  .cover-sub {
    font-size: 17px;
    color: var(--text2);
    font-weight: 400;
    margin-bottom: 56px;
  }
  .cover-info-table {
    text-align: left;
    margin: 0 auto;
    border-collapse: separate;
    border-spacing: 0;
    width: auto;
    min-width: 420px;
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
  }
  .cover-info-table td {
    padding: 13px 24px;
    font-size: 15px;
    border-bottom: 1px solid var(--border);
  }
  .cover-info-table tr:last-child td { border-bottom: none; }
  .cover-info-table td:first-child {
    font-weight: 700;
    color: var(--navy);
    background: var(--surface);
    width: 130px;
    border-right: 1px solid var(--border);
  }
  .cover-info-table td:last-child { color: var(--text); }

  .cover-bottom {
    margin-top: auto;
    padding-top: 40px;
    text-align: center;
    width: 100%;
  }
  .cover-note {
    font-size: 11.5px;
    color: var(--text3);
    line-height: 1.7;
    margin-bottom: 24px;
  }
  .cover-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 16px 0;
    border-top: 1px solid var(--border);
  }
  .cover-logo-icon {
    width: 32px; height: 32px;
    background: var(--navy);
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 16px; font-weight: 900;
    font-family: 'Inter', sans-serif;
  }
  .cover-logo-text {
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: var(--navy);
    letter-spacing: 0.05em;
  }
  .cover-logo-sub {
    font-size: 11px;
    color: var(--text3);
    font-weight: 400;
  }
  .cover-logo-img {
    height: 36px;
    width: auto;
    max-width: 120px;
    object-fit: contain;
    border-radius: 6px;
  }
  .footer-logo-icon-img {
    height: 22px;
    width: auto;
    object-fit: contain;
    border-radius: 4px;
  }

  /* ── 목차 ─────────────────────────────── */
  .toc { padding: 48px 0; page-break-after: always; }
  .toc h2 {
    font-size: 26px; font-weight: 900; color: var(--navy); margin-bottom: 10px;
  }
  .toc-line { height: 3px; background: var(--red); margin-bottom: 28px; }
  .toc-item {
    padding: 11px 0 11px 12px;
    font-size: 15px;
    color: var(--text);
    display: flex; align-items: center; gap: 8px;
    border-bottom: 1px solid #f1f5f9;
  }
  .toc-item:last-child { border-bottom: none; }
  .toc-bullet {
    width: 6px; height: 6px;
    background: var(--navy);
    border-radius: 50%;
    flex-shrink: 0;
  }

  /* ── 섹션 ─────────────────────────────── */
  .section {
    margin-bottom: 4px;
    padding: 40px 0 20px;
    page-break-inside: avoid;
  }
  .section-title {
    font-size: 22px;
    font-weight: 900;
    color: var(--blue);
    margin-bottom: 8px;
  }
  .section-line { height: 3px; background: var(--red); margin-bottom: 20px; }
  .section-body {
    font-size: 13.5px;
    line-height: 1.9;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text);
    padding: 0;
  }

  /* 마크다운 변환된 테이블 */
  .md-table {
    width: 100%;
    border-collapse: collapse;
    margin: 14px 0;
    font-size: 12.5px;
    line-height: 1.5;
    white-space: normal;
  }
  .md-table th {
    background: var(--navy);
    color: #fff;
    font-weight: 600;
    padding: 10px 14px;
    text-align: left;
    border: 1px solid var(--dark-blue);
  }
  .md-table td {
    padding: 9px 14px;
    border: 1px solid #e2e8f0;
    vertical-align: top;
  }
  .md-table tr:nth-child(even) td { background: #f8fafc; }
  .md-hr { border: none; height: 1px; background: #e2e8f0; margin: 14px 0; }
  .md-h1, .md-h2 {
    font-size: 16px; font-weight: 700; color: var(--navy);
    margin: 22px 0 8px; padding-bottom: 6px;
    border-bottom: 2px solid var(--blue); white-space: normal;
  }
  .md-h3, .md-h4 {
    font-size: 14px; font-weight: 600; color: var(--navy);
    margin: 16px 0 6px; white-space: normal;
  }
  strong { font-weight: 700; }
  em { font-style: italic; }

  /* ── 검증 ─────────────────────────────── */
  .verify-badge {
    display: inline-block;
    padding: 6px 16px;
    background: #fef3c7; color: #92400e;
    border: 1px solid #fcd34d; border-radius: 6px;
    font-size: 12px; font-weight: 600; margin-bottom: 16px;
  }

  /* ── 푸터 ─────────────────────────────── */
  .report-footer {
    text-align: center;
    padding: 28px 0;
    border-top: 2px solid var(--navy);
    margin-top: 36px;
  }
  .footer-logo {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    margin-bottom: 8px;
  }
  .footer-logo-box {
    width: 22px; height: 22px;
    background: var(--navy); border-radius: 5px;
    display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 11px; font-weight: 900; font-family: 'Inter', sans-serif;
  }
  .footer-logo-name {
    font-family: 'Inter', sans-serif;
    font-size: 12px; font-weight: 700; color: var(--navy); letter-spacing: 0.05em;
  }
  .footer-copy { font-size: 11px; color: var(--text3); }

  @media print {
    .print-bar { display: none !important; }
    .report { margin-top: 0; padding: 0; }
    .cover { min-height: auto; padding: 50px 0 30px; }
    .section { break-inside: avoid; }
    body { font-size: 12px; }
  }
  @page { size: A4; margin: 18mm 15mm; }
</style>
</head>
<body>
  <div class="print-bar">
    <span>리포트가 준비되었습니다</span>
    <button onclick="window.print()">PDF로 인쇄 / 저장</button>
    <button class="close-btn" onclick="window.close()">닫기</button>
  </div>

  <div class="report">
    <!-- 커버 -->
    <div class="cover">
      <div class="cover-brand">${coverEdit.reportTitle}</div>
      <div class="cover-main-title">${cvMainTitle}</div>
      <div class="cover-sub">${cvSubTitle}</div>

      <table class="cover-info-table">
        <tr><td>학생명</td><td>${cvName}</td></tr>
        ${cvSchool ? `<tr><td>학교/학년</td><td>${cvSchool}</td></tr>` : ''}
        ${cvMajor ? `<tr><td>희망 전공</td><td>${cvMajor}</td></tr>` : ''}
        ${cvTarget ? `<tr><td>목표 대학</td><td>${cvTarget}</td></tr>` : ''}
        ${pdfCount > 0 ? `<tr><td>첨부 자료</td><td>PDF ${pdfCount}건 분석 포함</td></tr>` : ''}
      </table>

      <div class="cover-bottom">
        <div class="cover-note">
          본 리포트는 학생의 학교생활기록부를 바탕으로<br>
          AI 빅데이터 합격 사례 분석을 통해 작성되었습니다.
        </div>
        <div class="cover-logo">
          ${coverEdit.logoData ? `<img src="${coverEdit.logoData}" class="cover-logo-img" alt="로고">` : `<div class="cover-logo-icon">${coverEdit.brandName.charAt(0)}</div>`}
          <div>
            <div class="cover-logo-text">${coverEdit.brandName}</div>
            <div class="cover-logo-sub">${coverEdit.brandSub}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 목차 -->
    <div class="toc">
      <h2>목차</h2>
      <div class="toc-line"></div>
      ${activeSections.map(({ num, title }, idx) =>
        `<div class="toc-item"><span class="toc-bullet"></span>${idx + 1}. [${num}단계] ${title}</div>`
      ).join('')}
    </div>

    <!-- 분석 섹션들 -->
    ${activeSections.map(({ key, num, title }, idx) => {
      const c = mdToHtml(results[key] || '');
      return `<div class="section"><h2 class="section-title">${idx + 1}. [${num}단계] ${title}</h2><div class="section-line"></div><div class="section-body">${c}</div></div>`;
    }).join('')}

    <!-- 검증 결과 -->
    ${verifyHTML}

    <!-- 푸터 -->
    <div class="report-footer">
      <div class="footer-logo">
        ${coverEdit.logoData ? `<img src="${coverEdit.logoData}" class="footer-logo-icon-img" alt="">` : `<div class="footer-logo-box">${coverEdit.brandName.charAt(0)}</div>`}
        <span class="footer-logo-name">${coverEdit.brandName}</span>
      </div>
      <div class="footer-copy">&copy; ${year} &mdash; ${today} 생성</div>
    </div>
  </div>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    } else {
      alert('팝업이 차단되었습니다. 팝업 차단을 해제해 주세요.');
    }
  };

  const handleVerify = async () => {
    if (!verifyModel || verifying) return;
    const vKey = getKeyForModel(verifyModel);
    if (!vKey) {
      alert(`${MODEL_CONFIG[verifyModel]?.label || verifyModel} API 키가 설정되지 않았습니다. 설정에서 입력해 주세요.`);
      return;
    }

    setVerifying(true);
    setVerifyResult(null);

    try {
      const token = localStorage.getItem('ef_token');
      const analysisText = SECTION_MAP
        .filter(({ key }) => results?.[key])
        .map(({ key, title }) => `## ${title}\n${results[key]}`)
        .join('\n\n');

      const res = await fetch(`${API_BASE}/api/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': vKey,
          'x-ai-model': MODEL_CONFIG[verifyModel]?.group || verifyModel,
          'x-ai-submodel': verifyModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          studentData,
          analysisText,
          originalModel: MODEL_CONFIG[usedModel]?.label || usedModel,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setVerifyResult({ model: verifyModel, content: data.reply });
        // 백엔드에서 파싱된 결과가 있으면 우선 사용
        const items = data.parsedItems || null;
        if (items && Array.isArray(items) && items.length > 0) {
          setVerifyItems(items);
          const defaults = {};
          items.forEach((item, i) => { defaults[i] = item.type === 'error'; });
          setCheckedItems(defaults);
        } else {
          // 백엔드 파싱 실패 시 프론트엔드에서 재시도
          try {
            let raw = data.reply.trim();
            const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
            if (codeBlockMatch) {
              raw = codeBlockMatch[1].trim();
            } else {
              raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
            }
            let parsed = null;
            // 1차: 전체 JSON 배열 파싱
            const jsonStart = raw.indexOf('[');
            const jsonEnd = raw.lastIndexOf(']');
            if (jsonStart >= 0 && jsonEnd > jsonStart) {
              try {
                let jsonStr = raw.slice(jsonStart, jsonEnd + 1);
                jsonStr = jsonStr.replace(/,\s*([}\]])/g, '$1');
                parsed = JSON.parse(jsonStr);
              } catch { /* 전체 파싱 실패 → 개별 객체 추출 시도 */ }
            }
            // 2차: 전체 파싱 실패 시 개별 JSON 객체를 하나씩 추출
            if (!parsed) {
              const objectRegex = /\{[^{}]*"section"\s*:\s*"[^"]*"[^{}]*"type"\s*:\s*"[^"]*"[^{}]*\}/g;
              const matches = raw.match(objectRegex);
              if (matches && matches.length > 0) {
                const items = [];
                for (const m of matches) {
                  try {
                    const obj = JSON.parse(m);
                    if (obj.section && obj.type) items.push(obj);
                  } catch { /* 개별 객체 파싱 실패 무시 */ }
                }
                if (items.length > 0) parsed = items;
              }
            }
            if (Array.isArray(parsed) && parsed.length > 0) {
              setVerifyItems(parsed);
              const defaults = {};
              parsed.forEach((item, i) => { defaults[i] = item.type === 'error'; });
              setCheckedItems(defaults);
            }
          } catch (parseErr) {
            console.warn('[검증] JSON 파싱 실패, 레거시 모드 사용:', parseErr.message);
          }
        }
      } else {
        alert('검증 오류: ' + data.message);
      }
    } catch (err) {
      alert('검증 요청 실패: ' + err.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleRefine = async () => {
    if (!verifyResult || refining) return;
    const refineKey = getKeyForModel(usedModel);
    if (!refineKey) {
      alert(`${MODEL_CONFIG[usedModel]?.label} API 키가 필요합니다.`);
      return;
    }

    // 체크된 항목만 필터링
    const selectedFeedback = verifyItems.length > 0
      ? verifyItems.filter((_, i) => checkedItems[i]).map(item =>
          `[${item.section}] (${item.type}) ${item.title}: ${item.detail}`
        ).join('\n')
      : verifyResult.content;

    if (verifyItems.length > 0 && !selectedFeedback.trim()) {
      alert('반영할 항목을 1개 이상 체크해주세요.');
      return;
    }

    setRefining(true);
    try {
      const token = localStorage.getItem('ef_token');
      const analysisText = SECTION_MAP
        .filter(({ key }) => results?.[key])
        .map(({ key, title }) => `## ${title}\n${results[key]}`)
        .join('\n\n');

      const resData = await postForResult(`${API_BASE}/api/refine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': refineKey,
          'x-ai-model': MODEL_CONFIG[usedModel]?.group || usedModel,
          'x-ai-submodel': usedModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          studentData,
          analysisText,
          verifyText: selectedFeedback,
        }),
      });

      if (resData.success) {
        // AI가 전체를 하나의 텍스트로 반환 — 섹션별로 파싱
        const refined = { ...results };
        const replyText = resData.reply;

        // 정규식으로 [N단계] 헤더 위치를 모두 찾기
        const headerRegex = /^\[(\d)단계\]\s*.*/gm;
        const headers = [];
        let match;
        while ((match = headerRegex.exec(replyText)) !== null) {
          headers.push({ num: match[1], index: match.index, fullMatch: match[0] });
        }

        // 헤더 기반 섹션 분할
        // 마지막 섹션은 응답이 잘렸을 가능성이 있어 검증 필요
        for (let i = 0; i < headers.length; i++) {
          const hdr = headers[i];
          const sectionDef = SECTION_MAP.find(s => s.num === hdr.num);
          if (!sectionDef) continue;
          const contentStart = hdr.index + hdr.fullMatch.length;
          const contentEnd = i + 1 < headers.length ? headers[i + 1].index : replyText.length;
          const content = replyText.slice(contentStart, contentEnd).trim();

          // 안전장치: 새 콘텐츠가 기존의 30% 미만이면 응답 잘림으로 간주하고 기존 유지
          const existingContent = results?.[sectionDef.key] || '';
          const isLastSection = i === headers.length - 1;
          const tooShort =
            existingContent.length > 200 &&
            content.length < existingContent.length * 0.3;

          if (!content) continue;
          if (isLastSection && tooShort) {
            console.warn(
              `[refine] ${sectionDef.title} 섹션이 잘린 것으로 판단 (기존 ${existingContent.length}자 → 새 ${content.length}자) - 기존 유지`
            );
            continue;
          }
          refined[sectionDef.key] = content;
        }

        // 정규식 파싱 실패 시 기존 indexOf 방식 fallback
        const anyParsed = SECTION_MAP.some(({ key }) => refined[key] !== results?.[key]);
        if (!anyParsed) {
          for (const { key, num, title } of SECTION_MAP) {
            const patterns = [`[${num}단계] ${title}`, `[${num}단계]`, `## ${title}`];
            for (const pattern of patterns) {
              const idx = replyText.indexOf(pattern);
              if (idx !== -1) {
                let endIdx = replyText.length;
                for (const { num: nNum, title: nTitle } of SECTION_MAP) {
                  if (nNum <= num) continue;
                  for (const np of [`[${nNum}단계]`, `## ${nTitle}`]) {
                    const ni = replyText.indexOf(np, idx + pattern.length);
                    if (ni !== -1 && ni < endIdx) endIdx = ni;
                  }
                }
                refined[key] = replyText.slice(idx + pattern.length, endIdx).trim();
                break;
              }
            }
          }
        }

        // 최종 파싱 실패 시 전체 텍스트를 dashboard에 넣기
        const finalParsed = SECTION_MAP.some(({ key }) => refined[key] !== results?.[key]);
        if (!finalParsed) {
          refined.dashboard = replyText;
        }

        // 메타 문구 후처리 + 변경된 섹션만 추출하여 staging
        const changes = {};
        for (const sec of SECTION_MAP) {
          const before = (results?.[sec.key] || '').trim();
          const afterRaw = (refined[sec.key] || '').trim();
          const after = sanitizeRefinedContent(afterRaw);
          if (after && after !== before) {
            changes[sec.key] = { before, after, num: sec.num, title: sec.title };
          }
        }

        if (Object.keys(changes).length === 0) {
          alert('변경된 내용이 없습니다. 검증 항목을 다시 선택해 주세요.');
        } else {
          // 어떤 항목이 반영됐는지 기록
          const appliedIdx = verifyItems
            .map((_, i) => (checkedItems[i] ? i : -1))
            .filter(i => i >= 0);
          setPendingRefine({ changes, appliedIdx });
          setPreviewExpandedKey(Object.keys(changes)[0] || null);
        }
      } else {
        alert('재생성 오류: ' + resData.message);
      }
    } catch (err) {
      alert('재생성 요청 실패: ' + err.message);
    } finally {
      setRefining(false);
    }
  };

  // 미리보기에서 "최종 반영" — 실제로 결과에 적용
  const confirmPendingRefine = () => {
    if (!pendingRefine) return;
    const merged = { ...results };
    for (const [key, { after }] of Object.entries(pendingRefine.changes)) {
      merged[key] = after;
    }
    setRefinedResults(merged);
    // 반영된 검증 항목 숨기기
    const appliedSet = new Set(pendingRefine.appliedIdx);
    const remaining = verifyItems.filter((_, i) => !appliedSet.has(i));
    setVerifyItems(remaining);
    setCheckedItems({});
    if (remaining.length === 0) setVerifyResult(null);
    setPendingRefine(null);
    setPreviewExpandedKey(null);
  };

  // 미리보기 취소 — 변경 내용 폐기
  const cancelPendingRefine = () => {
    setPendingRefine(null);
    setPreviewExpandedKey(null);
  };

  // ── 채팅 이미지 첨부 (붙여넣기/드래그/선택) ──────────────
  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const addChatImages = async (files) => {
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const added = [];
    for (const file of imageFiles) {
      try {
        const base64 = await fileToBase64(file);
        added.push({
          name: file.name || `screenshot_${Date.now()}.png`,
          mimeType: file.type || 'image/png',
          base64,
          preview: URL.createObjectURL(file),
        });
      } catch (err) {
        console.error('이미지 변환 실패:', err);
      }
    }
    if (added.length > 0) setChatImages(prev => [...prev, ...added]);
  };

  const removeChatImage = (idx) => {
    setChatImages(prev => {
      const target = prev[idx];
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const handleChatPaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addChatImages(files);
    }
  };

  const handleChatDragOver = (e) => { e.preventDefault(); setChatDragging(true); };
  const handleChatDragLeave = (e) => { e.preventDefault(); setChatDragging(false); };
  const handleChatDrop = (e) => {
    e.preventDefault();
    setChatDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) addChatImages(files);
  };

  // ── AI 대화 (분석 결과 수정 요청) ──────────────────────
  const handleChatSend = async () => {
    if ((!chatInput.trim() && chatImages.length === 0) || chatLoading) return;
    const userMsg = chatInput.trim() || '(첨부된 이미지를 참고하여 수정해 주세요)';
    const imagesToSend = chatImages.map(img => ({ name: img.name, mimeType: img.mimeType, base64: img.base64 }));
    const previewLabel = chatImages.length > 0 ? ` [이미지 ${chatImages.length}장 첨부]` : '';
    setChatInput('');
    // 미리보기 URL 해제
    chatImages.forEach(img => img.preview && URL.revokeObjectURL(img.preview));
    setChatImages([]);
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg + previewLabel }]);
    setChatLoading(true);

    try {
      const refineKey = getKeyForModel(usedModel);
      if (!refineKey) throw new Error('API 키가 필요합니다.');
      const token = localStorage.getItem('ef_token');

      const res = await fetch(`${API_BASE}/api/chat-edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': refineKey,
          'x-ai-model': MODEL_CONFIG[usedModel]?.group || usedModel,
          'x-ai-submodel': usedModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          studentData,
          currentResults: results,
          userMessage: userMsg,
          imageData: imagesToSend.length > 0 ? imagesToSend : undefined,
        }),
      });

      const resData = await res.json();
      if (resData.success) {
        const { explanation, changes, changedSections, fullReply } = resData;

        if (changes && Object.keys(changes).length > 0) {
          // 변경된 섹션만 반영
          const updated = { ...results, ...changes };
          setRefinedResults(updated);

          // 변경 내용 상세 표시
          const changeMsg = `[수정 완료] ${changedSections.join(', ')}\n\n${explanation}`;
          setChatMessages(prev => [...prev, { role: 'ai', text: changeMsg }]);
        } else {
          // 파싱 실패 — AI가 설명만 하고 섹션을 출력하지 않은 경우
          const msg = '[반영 실패] AI가 수정 설명만 하고 실제 섹션 내용을 출력하지 않았습니다.\n\n'
            + '다시 시도하시거나, 더 구체적으로 요청해 주세요.\n'
            + '(예: "1단계의 모의고사 점수를 수학 65점, 영어 76점으로 수정해줘")\n\n'
            + (explanation || (fullReply ? fullReply.slice(0, 600) : ''));
          setChatMessages(prev => [...prev, { role: 'ai', text: msg }]);
        }
      } else {
        setChatMessages(prev => [...prev, { role: 'ai', text: '오류: ' + resData.message }]);
      }
    } catch (err) {
      setChatMessages(prev => [...prev, { role: 'ai', text: '오류: ' + err.message }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ── 개별 섹션 재생성 ────────────────────────────────
  const handleRegenerateSection = async (key, num, title) => {
    if (regeneratingKeys.has(key)) return;
    setRegeneratingKeys(prev => new Set([...prev, key]));
    try {
      const refineKey = getKeyForModel(usedModel);
      if (!refineKey) throw new Error('API 키가 필요합니다.');
      const token = localStorage.getItem('ef_token');
      const res = await fetch(`${API_BASE}/api/chat-edit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': refineKey,
          'x-ai-model': MODEL_CONFIG[usedModel]?.group || usedModel,
          'x-ai-submodel': usedModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          studentData,
          currentResults: results,
          userMessage: `[${num}단계] ${title} 섹션의 내용이 불완전하거나 잘렸습니다. 이 섹션을 처음부터 끝까지 완전하게 다시 작성해 주세요. 기존 내용을 참고하되 더 풍부하고 구체적으로 작성하십시오. 반드시 끝까지 마무리하십시오.`,
        }),
      });
      const resData = await res.json();
      if (resData.success && resData.changes?.[key]) {
        setRefinedResults(prev => ({ ...(prev || results), ...resData.changes }));
        alert(`[${num}단계] ${title} 재생성 완료`);
      } else {
        alert('재생성 실패: ' + (resData.message || '파싱 오류'));
      }
    } catch (err) {
      alert('재생성 오류: ' + err.message);
    } finally {
      setRegeneratingKeys(prev => { const next = new Set(prev); next.delete(key); return next; });
    }
  };

  const startEdit = (key, content) => {
    setEditingKey(key);
    setEditText(content || '');
  };

  const saveEdit = (key) => {
    setManualEdits(prev => ({ ...prev, [key]: editText }));
    setEditingKey(null);
    setEditText('');
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditText('');
  };

  const renderSection = (key, num, title, content) => {
    if (!content) return null;
    const isEditing = editingKey === key;
    return (
      <div className="result-section" key={key}>
        <div className="section-header">
          <span className="section-num-badge">{num}</span>
          <h3>{title}</h3>
          <div className="section-header-actions">
            {manualEdits[key] && <span className="edit-badge">수정됨</span>}
            {!isEditing ? (
              <>
                <button className="btn-edit-section" onClick={() => startEdit(key, content)}>수정</button>
                <button
                  className="btn-edit-section"
                  style={{marginLeft:4, opacity: regeneratingKeys.has(key) ? 0.5 : 1}}
                  onClick={() => handleRegenerateSection(key, num, title)}
                  disabled={regeneratingKeys.has(key)}
                >
                  {regeneratingKeys.has(key) ? '재생성 중...' : '재생성'}
                </button>
              </>
            ) : (
              <>
                <button className="btn-save-section" onClick={() => saveEdit(key)}>저장</button>
                <button className="btn-cancel-section" onClick={cancelEdit}>취소</button>
              </>
            )}
          </div>
        </div>
        {isEditing ? (
          <textarea
            className="section-edit-textarea"
            value={editText}
            onChange={e => setEditText(e.target.value)}
            rows={20}
          />
        ) : (
          <div
            className="section-content md-rendered"
            dangerouslySetInnerHTML={{ __html: mdToHtml(content) }}
          />
        )}
      </div>
    );
  };

  const handleCopyAll = async () => {
    const sections = SECTION_MAP
      .filter(({ key }) => results?.[key])
      .map(({ key, title }) => `## ${title}\n\n${results[key]}`)
      .join('\n\n---\n\n');
    const header = `# ${studentData?.name || '학생'} 입시 분석 결과\n${studentData?.school || ''} · ${studentData?.major || ''}\n\n---\n\n`;
    await navigator.clipboard.writeText(header + sections);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const usedCfg = MODEL_CONFIG[usedModel] || MODEL_CONFIG.claude;

  return (
    <div className="result-page">
      <div className="result-header">
        <div className="result-header-info">
          <h2>✅ 분석 완료</h2>
          <p>
            {studentData?.name} · {studentData?.school} · {studentData?.major}
            <span className="model-badge-inline" style={{ background: usedCfg.color + '20', color: usedCfg.color }}>
              {usedCfg.icon} {usedCfg.label} 분석
            </span>
          </p>
          {data?.partial && (
            <div style={{ background: 'rgba(240,165,0,0.12)', border: '1px solid rgba(240,165,0,0.4)', color: '#b8860b', padding: '8px 12px', borderRadius: 8, fontSize: 13, margin: '6px 0' }}>
              ⚠️ 일부 항목만 완료된 상태로 저장되었습니다. 누락된 항목은 아래 "🔄 이 데이터로 재분석"으로 이어서 분석하세요.
            </div>
          )}
          {pdfCount > 0 && <span className="pdf-badge">📎 PDF {pdfCount}건 분석 포함</span>}
        </div>
        <div className="result-actions">
          <button className="btn-analyze" onClick={assignToBoard} disabled={assigning} style={{ padding: '8px 16px', fontSize: 13 }}>
            {assigning ? '배정 중...' : '📋 학생에게 배정'}
          </button>
          <button className="btn-print-html" onClick={openCoverModal}>
            🖨️ HTML 리포트 / PDF 인쇄
          </button>
          <button className="btn-download-pdf" onClick={handleDownloadPDF} disabled={downloading}>
            {downloading ? '⏳ PDF 생성 중...' : '📄 PDF 다운로드'}
          </button>
          <button className="btn-secondary" onClick={handleExportJSON}>
            💾 JSON 내보내기
          </button>
          <button className="btn-secondary" onClick={handleCopyAll}>
            {copied ? '✅ 복사됨!' : '📋 전체 복사'}
          </button>
          <button className="btn-secondary" onClick={() => onReanalyze?.({
            version: 2,
            studentData,
            results,
            analyzedModel: usedModel,
            pdfCount: pdfCount || 0,
            pdfTexts: pdfTexts || '',
            exportedAt: new Date().toISOString(),
          })}>🔄 이 데이터로 재분석</button>
          <button className="btn-secondary" onClick={onNewAnalysis}>✨ 새 분석</button>
          <button className="btn-ghost" onClick={onBack}>← 목록</button>
        </div>
      </div>

      {/* AI 교차 검증 패널 */}
      <div className="verify-panel">
        <div className="verify-panel-header">
          <span className="verify-title">🔎 교차 검증</span>
          <span className="verify-desc">
            분석 결과를 다른 AI가 교차 검증합니다
          </span>
        </div>
        <div className="verify-controls">
          {verifyOptions.map(([key, cfg]) => {
            const hasKey = !!getKeyForModel(key);
            return (
              <button
                key={key}
                className={`verify-model-btn ${verifyModel === key ? 'active' : ''} ${!hasKey ? 'no-key' : ''}`}
                style={verifyModel === key ? { borderColor: cfg.color, color: cfg.color } : {}}
                onClick={() => setVerifyModel(key)}
                title={!hasKey ? `${cfg.label} API 키가 설정되지 않았습니다` : ''}
              >
                {cfg.icon} {cfg.label}
                {!hasKey && <span className="no-key-label">키 없음</span>}
              </button>
            );
          })}
          <button
            className="btn-verify-start"
            onClick={handleVerify}
            disabled={!verifyModel || verifying}
          >
            {verifying ? '⏳ 검증 중...' : '검증 실행'}
          </button>
        </div>
      </div>

      {/* 검증 결과 — 체크박스 리스트 */}
      {verifyResult && (
        <div className="verify-result">
          <div className="verify-result-header">
            <span>
              {MODEL_CONFIG[verifyResult.model]?.icon} {MODEL_CONFIG[verifyResult.model]?.label} 검증 결과
            </span>
            <span className="verify-vs">
              {usedCfg.icon} {usedCfg.label} 분석 → {MODEL_CONFIG[verifyResult.model]?.icon} {MODEL_CONFIG[verifyResult.model]?.label} 검증
            </span>
          </div>

          {verifyItems.length > 0 ? (
            <>
              <div className="verify-checklist">
                <div className="verify-checklist-controls">
                  <button className="btn-check-all" onClick={() => {
                    const all = {};
                    verifyItems.forEach((_, i) => { all[i] = true; });
                    setCheckedItems(all);
                  }}>전체 선택</button>
                  <button className="btn-check-all" onClick={() => setCheckedItems({})}>전체 해제</button>
                  <span className="verify-count">
                    {Object.values(checkedItems).filter(Boolean).length} / {verifyItems.length}개 선택
                  </span>
                </div>
                {verifyItems.map((item, i) => (
                  <label key={i} className={`verify-item ${checkedItems[i] ? 'checked' : ''} type-${item.type} priority-${item.priority}`}>
                    <input
                      type="checkbox"
                      checked={!!checkedItems[i]}
                      onChange={e => setCheckedItems(prev => ({ ...prev, [i]: e.target.checked }))}
                    />
                    <div className="verify-item-content">
                      <div className="verify-item-top">
                        <span className={`verify-type-badge type-${item.type}`}>
                          {item.type === 'error' ? '오류' : item.type === 'improve' ? '개선' : '추가'}
                        </span>
                        <span className={`verify-priority priority-${item.priority}`}>
                          {item.priority === 'high' ? '높음' : item.priority === 'medium' ? '보통' : '낮음'}
                        </span>
                        <span className="verify-item-section">{item.section}</span>
                      </div>
                      <div className="verify-item-title">{item.title}</div>
                      <div className="verify-item-detail">{item.detail}</div>
                    </div>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <div
              className="verify-result-body md-rendered"
              dangerouslySetInnerHTML={{ __html: mdToHtml(verifyResult.content) }}
            />
          )}

          <div className="verify-result-actions">
            <button
              className="btn-refine"
              onClick={handleRefine}
              disabled={refining || (verifyItems.length > 0 && !Object.values(checkedItems).some(Boolean))}
            >
              {refining ? '반영 중...' : `체크한 항목 반영 후 변경 미리보기 (${Object.values(checkedItems).filter(Boolean).length}개)`}
            </button>
            {refinedResults && (
              <span className="refine-done-badge">반영 완료</span>
            )}
          </div>
        </div>
      )}

      {/* 검증 반영 미리보기 모달 */}
      {pendingRefine && (
        <div className="refine-preview-overlay" onClick={cancelPendingRefine}>
          <div className="refine-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="refine-preview-header">
              <div>
                <h3>검증 반영 미리보기</h3>
                <p className="refine-preview-sub">
                  체크한 검증 항목 {pendingRefine.appliedIdx.length}건이 반영되어
                  {' '}{Object.keys(pendingRefine.changes).length}개 섹션이 변경되었습니다.
                  내용을 확인한 후 최종 반영하세요.
                </p>
              </div>
              <button className="refine-preview-close" onClick={cancelPendingRefine}>×</button>
            </div>

            <div className="refine-preview-list">
              {Object.entries(pendingRefine.changes).map(([key, { before, after, num, title }]) => {
                const expanded = previewExpandedKey === key;
                const beforeLen = before.length;
                const afterLen = after.length;
                const delta = afterLen - beforeLen;
                return (
                  <div key={key} className={`refine-preview-item ${expanded ? 'expanded' : ''}`}>
                    <button
                      className="refine-preview-item-header"
                      onClick={() => setPreviewExpandedKey(expanded ? null : key)}
                    >
                      <span className="refine-preview-section">[{num}단계] {title}</span>
                      <span className="refine-preview-meta">
                        {beforeLen.toLocaleString()}자 → {afterLen.toLocaleString()}자
                        <span className={`refine-preview-delta ${delta >= 0 ? 'plus' : 'minus'}`}>
                          {delta >= 0 ? '+' : ''}{delta.toLocaleString()}
                        </span>
                      </span>
                      <span className="refine-preview-toggle">{expanded ? '▲ 닫기' : '▼ 변경 전/후 보기'}</span>
                    </button>
                    {expanded && (
                      <div className="refine-preview-diff">
                        <div className="refine-preview-col">
                          <div className="refine-preview-col-label before">변경 전</div>
                          <div
                            className="refine-preview-col-body md-rendered"
                            dangerouslySetInnerHTML={{ __html: mdToHtml(before) }}
                          />
                        </div>
                        <div className="refine-preview-col">
                          <div className="refine-preview-col-label after">변경 후</div>
                          <div
                            className="refine-preview-col-body md-rendered"
                            dangerouslySetInnerHTML={{ __html: mdToHtml(after) }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="refine-preview-footer">
              <button className="btn-preview-cancel" onClick={cancelPendingRefine}>취소 (반영 안 함)</button>
              <button className="btn-preview-confirm" onClick={confirmPendingRefine}>최종 반영</button>
            </div>
          </div>
        </div>
      )}

      <div className="result-sections">
        {SECTION_MAP.map(({ key, num, title }) => renderSection(key, num, title, results?.[key]))}
      </div>

      {/* AI 대화창 (분석 결과 수정 요청) */}
      <div className={`result-chat ${chatOpen ? 'open' : ''}`}>
        <button className="result-chat-toggle" onClick={() => setChatOpen(v => !v)}>
          {chatOpen ? 'X 닫기' : '💬 AI에게 수정 요청'}
        </button>
        {chatOpen && (
          <div
            className={`result-chat-panel ${chatDragging ? 'drag-over' : ''}`}
            onDragOver={handleChatDragOver}
            onDragLeave={handleChatDragLeave}
            onDrop={handleChatDrop}
          >
            <div className="result-chat-header">
              <span>AI 수정 요청</span>
              <span className="result-chat-model">{MODEL_CONFIG[usedModel]?.icon} {MODEL_CONFIG[usedModel]?.label}</span>
            </div>
            <div className="result-chat-messages">
              {chatMessages.length === 0 && (
                <div className="result-chat-hint">
                  수정하고 싶은 내용을 자유롭게 요청하세요.<br/>
                  예: "지원 전략에서 안정 대학을 더 추가해줘"<br/>
                  예: "비교과 분석을 더 자세하게 해줘"<br/>
                  <span style={{ color: '#94a3b8', fontSize: 11 }}>이미지: Ctrl+V 붙여넣기 / 드래그앤드롭 / + 버튼</span>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`result-chat-msg ${msg.role}`}>
                  <div className="result-chat-msg-label">{msg.role === 'user' ? '나' : 'AI'}</div>
                  <div className="result-chat-msg-text" style={{whiteSpace:'pre-wrap'}}>{msg.text.replace(/\*\*(.*?)\*\*/g, '→ $1')}</div>
                </div>
              ))}
              {chatLoading && <div className="result-chat-msg ai"><div className="result-chat-msg-label">AI</div><div className="result-chat-msg-text">수정 중...</div></div>}
            </div>
            {chatImages.length > 0 && (
              <div className="result-chat-attached">
                {chatImages.map((img, i) => (
                  <div key={i} className="result-chat-thumb">
                    <img src={img.preview} alt={img.name} />
                    <button className="result-chat-thumb-remove" onClick={() => removeChatImage(i)} title="삭제">×</button>
                  </div>
                ))}
              </div>
            )}
            <div className="result-chat-input-row">
              <button
                className="result-chat-attach"
                onClick={() => chatFileInputRef.current?.click()}
                disabled={chatLoading}
                title="이미지 첨부"
              >+</button>
              <input
                ref={chatFileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={e => { addChatImages(e.target.files || []); e.target.value = ''; }}
              />
              <input
                type="text"
                className="result-chat-input"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleChatSend()}
                onPaste={handleChatPaste}
                placeholder="수정 요청을 입력하세요... (이미지는 Ctrl+V로 붙여넣기)"
                disabled={chatLoading}
              />
              <button
                className="result-chat-send"
                onClick={handleChatSend}
                disabled={chatLoading || (!chatInput.trim() && chatImages.length === 0)}
              >전송</button>
            </div>
          </div>
        )}
      </div>

      {/* 표지 수정 모달 */}
      {showCoverModal && (
        <div className="cover-modal-overlay" onClick={() => setShowCoverModal(false)}>
          <div className="cover-modal" onClick={e => e.stopPropagation()}>
            <div className="cover-modal-header">
              <h3>리포트 표지 설정</h3>
              <button className="cover-modal-close" onClick={() => setShowCoverModal(false)}>X</button>
            </div>
            <div className="cover-modal-body">
              <div className="cover-modal-group-label">표지 내용</div>
              <div className="cover-modal-field">
                <label>리포트 제목</label>
                <input type="text" value={coverEdit.mainTitle} onChange={e => setCoverEdit({ ...coverEdit, mainTitle: e.target.value })} placeholder="입시 컨설팅 종합 분석 리포트" />
              </div>
              <div className="cover-modal-field">
                <label>부제목</label>
                <input type="text" value={coverEdit.subTitle} onChange={e => setCoverEdit({ ...coverEdit, subTitle: e.target.value })} placeholder="2028학년도 대입 대비" />
              </div>
              <div className="cover-modal-row">
                <div className="cover-modal-field">
                  <label>학생명</label>
                  <input type="text" value={coverEdit.studentName} onChange={e => setCoverEdit({ ...coverEdit, studentName: e.target.value })} />
                </div>
                <div className="cover-modal-field">
                  <label>학교/학년</label>
                  <input type="text" value={coverEdit.studentSchool} onChange={e => setCoverEdit({ ...coverEdit, studentSchool: e.target.value })} />
                </div>
              </div>
              <div className="cover-modal-row">
                <div className="cover-modal-field">
                  <label>희망 전공</label>
                  <input type="text" value={coverEdit.studentMajor} onChange={e => setCoverEdit({ ...coverEdit, studentMajor: e.target.value })} />
                </div>
                <div className="cover-modal-field">
                  <label>목표 대학</label>
                  <input type="text" value={coverEdit.studentTarget} onChange={e => setCoverEdit({ ...coverEdit, studentTarget: e.target.value })} />
                </div>
              </div>

              <div className="cover-modal-group-label" style={{marginTop:'16px'}}>브랜딩</div>
              <div className="cover-modal-field">
                <label>상단 타이틀</label>
                <input type="text" value={coverEdit.reportTitle} onChange={e => setCoverEdit({ ...coverEdit, reportTitle: e.target.value })} placeholder="PATHFINDER REPORT" />
              </div>
              <div className="cover-modal-row">
                <div className="cover-modal-field">
                  <label>기관명 (영문)</label>
                  <input type="text" value={coverEdit.brandName} onChange={e => setCoverEdit({ ...coverEdit, brandName: e.target.value })} placeholder="PATHFINDER EDU" />
                </div>
                <div className="cover-modal-field">
                  <label>기관명 (한글)</label>
                  <input type="text" value={coverEdit.brandSub} onChange={e => setCoverEdit({ ...coverEdit, brandSub: e.target.value })} placeholder="패스파인더 에듀" />
                </div>
              </div>
              <div className="cover-modal-field">
                <label>학원 로고</label>
                {coverEdit.logoData ? (
                  <div className="cover-modal-logo-preview">
                    <img src={coverEdit.logoData} alt="로고" />
                    <button onClick={() => setCoverEdit({ ...coverEdit, logoData: '' })}>삭제</button>
                  </div>
                ) : (
                  <div className="cover-modal-logo-empty">
                    <span>설정 &gt; 리포트 브랜딩에서 로고를 업로드하세요</span>
                  </div>
                )}
              </div>
            </div>
            <div className="cover-modal-footer">
              <button className="btn-ghost" onClick={() => setShowCoverModal(false)}>취소</button>
              <button className="btn-print-html" onClick={() => { setShowCoverModal(false); handlePrintHTML(); }}>
                리포트 발행
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
