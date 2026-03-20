import { useState } from 'react';

const API_BASE = 'https://entrance-finder-production.up.railway.app';

const MODEL_CONFIG = {
  claude: { icon: '🔵', label: 'Claude',  color: '#7c6af7' },
  gemini: { icon: '🟢', label: 'Gemini',  color: '#4caf50' },
  gpt:    { icon: '🟡', label: 'GPT-4o',  color: '#f0a500' },
};

const SECTION_MAP = [
  { key: 'caseMatching',   title: 'Drive 합격자 사례 매칭', icon: '🔍' },
  { key: 'academic',       title: '학업역량 분석',          icon: '📚' },
  { key: 'activity',       title: '비교과 활동 분석',       icon: '🏃' },
  { key: 'career',         title: '진로 역량 분석',         icon: '🎯' },
  { key: 'strategy',       title: '지원 전략 수립',         icon: '📋' },
  { key: 'roadmap',        title: '3년 로드맵',             icon: '🗓️' },
  { key: 'recordFeedback', title: '세특 개선안',            icon: '✏️' },
  { key: 'dashboard',      title: '종합 대시보드',          icon: '☁️' },
];

export default function AnalysisResult({ data, onBack, onNewAnalysis, selectedModel, apiKey, geminiKey, gptKey }) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [verifyModel, setVerifyModel] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const { results, studentData, pdfCount, analyzedModel } = data || {};

  const usedModel = analyzedModel || selectedModel || 'claude';

  // 검증에 사용할 수 있는 AI 목록 (분석에 사용한 AI 제외)
  const verifyOptions = Object.entries(MODEL_CONFIG).filter(([key]) => key !== usedModel);

  const getKeyForModel = (model) => {
    if (model === 'claude') return apiKey;
    if (model === 'gemini') return geminiKey;
    if (model === 'gpt') return gptKey;
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

  const handlePrintHTML = () => {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const year = new Date().getFullYear();
    const name = studentData?.name || '학생';
    const school = studentData?.school || '';
    const major = studentData?.major || '';
    const grade = studentData?.grade || '';
    const target = studentData?.targetUniv || studentData?.target || '';
    const modelLabel = MODEL_CONFIG[usedModel]?.label || 'AI';
    const entryYear = studentData?.entryYear || `${year + 2}`;

    // 섹션 타이틀 매핑 (PDF 시안 스타일)
    const sectionTitles = [
      { key: 'caseMatching',   num: '0', title: 'AI 드라이브 사례 매칭 분석' },
      { key: 'academic',       num: '1', title: '학업역량 심층 분석' },
      { key: 'activity',       num: '2', title: '비교과 활동 분석' },
      { key: 'career',         num: '3', title: '진로 역량 및 전공 적합성 분석' },
      { key: 'strategy',       num: '4', title: '지원 전략 수립' },
      { key: 'roadmap',        num: '5', title: '3년 로드맵' },
      { key: 'recordFeedback', num: '6', title: '세특 Before/After 개선안' },
      { key: 'dashboard',      num: '7', title: '종합 대시보드' },
    ];

    const activeSections = sectionTitles.filter(({ key }) => results?.[key]);

    // 목차 HTML
    const tocHTML = activeSections.map(({ num, title }, idx) =>
      `<div class="toc-item"><span class="toc-num">${idx + 1}.</span>[${num}단계] ${title}</div>`
    ).join('');

    // 섹션 HTML
    const sectionsHTML = activeSections.map(({ key, num, title }, idx) => {
      const content = (results[key] || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `
        <div class="section">
          <h2 class="section-title">${idx + 1}. [${num}단계] ${title}</h2>
          <div class="section-divider"></div>
          <div class="section-body">${content}</div>
        </div>`;
    }).join('');

    // 검증 결과
    let verifyHTML = '';
    if (verifyResult) {
      const vContent = verifyResult.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
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
<title>${name} 입시 분석 리포트 - IPSI-FINDER</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700;900&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif;
    color: #222;
    background: #fff;
    font-size: 13px;
    line-height: 1.75;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* ── 인쇄 바 ────────────────────────── */
  .print-bar {
    position: fixed;
    top: 0; left: 0; right: 0;
    background: linear-gradient(135deg, #1a2744 0%, #2563eb 100%);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 12px 24px;
    z-index: 100;
    font-size: 14px;
    font-weight: 500;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  }
  .print-bar button {
    padding: 10px 28px;
    background: #fff;
    color: #1a2744;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }
  .print-bar button:hover { background: #e0e7ff; }
  .print-bar .close-btn {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.4);
    color: #fff;
    padding: 10px 20px;
    font-weight: 500;
  }
  .print-bar .close-btn:hover { background: rgba(255,255,255,0.1); }

  .report {
    max-width: 780px;
    margin: 72px auto 60px;
    padding: 0 20px;
  }

  /* ── 커버 페이지 ─────────────────────── */
  .cover {
    text-align: center;
    padding: 80px 40px 60px;
    margin-bottom: 0;
    page-break-after: always;
    min-height: 90vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
  }
  .cover-brand {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.15em;
    color: #2563eb;
    margin-bottom: 48px;
  }
  .cover-main-title {
    font-size: 36px;
    font-weight: 900;
    color: #1a2744;
    line-height: 1.3;
    margin-bottom: 16px;
  }
  .cover-sub-title {
    font-size: 18px;
    color: #6b7280;
    font-weight: 400;
    margin-bottom: 60px;
  }
  .cover-info-table {
    text-align: left;
    margin: 0 auto;
    border-collapse: collapse;
    width: auto;
    min-width: 400px;
  }
  .cover-info-table td {
    padding: 10px 20px;
    font-size: 15px;
    border-bottom: 1px solid #e5e7eb;
  }
  .cover-info-table td:first-child {
    font-weight: 700;
    color: #1a2744;
    width: 120px;
  }
  .cover-info-table td:last-child {
    color: #374151;
  }
  .cover-info-table tr:last-child td {
    border-bottom: none;
  }
  .cover-note {
    margin-top: 48px;
    font-size: 12px;
    color: #9ca3af;
    line-height: 1.7;
    text-align: center;
  }

  /* ── 목차 ────────────────────────────── */
  .toc {
    padding: 40px 0;
    page-break-after: always;
  }
  .toc h2 {
    font-size: 28px;
    font-weight: 900;
    color: #1a2744;
    margin-bottom: 12px;
  }
  .toc-divider {
    height: 3px;
    background: #dc2626;
    margin-bottom: 28px;
    width: 100%;
  }
  .toc-item {
    padding: 10px 0 10px 8px;
    font-size: 15px;
    color: #374151;
    border-left: 3px solid transparent;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .toc-item:hover { border-left-color: #2563eb; }
  .toc-num {
    color: #1a2744;
    font-weight: 600;
    width: 24px;
  }

  /* ── 섹션 ────────────────────────────── */
  .section {
    margin-bottom: 8px;
    padding: 36px 0 24px;
    page-break-inside: avoid;
  }
  .section-title {
    font-size: 24px;
    font-weight: 900;
    color: #2563eb;
    margin-bottom: 8px;
  }
  .section-divider {
    height: 3px;
    background: #dc2626;
    margin-bottom: 24px;
    width: 100%;
  }
  .section-body {
    font-size: 13.5px;
    line-height: 1.85;
    white-space: pre-wrap;
    word-break: break-word;
    color: #333;
    padding: 0;
  }

  /* ── 검증 배지 ───────────────────────── */
  .verify-badge {
    display: inline-block;
    padding: 6px 16px;
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fcd34d;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    margin-bottom: 16px;
  }

  /* ── 푸터 ────────────────────────────── */
  .report-footer {
    text-align: center;
    padding: 32px 0;
    font-size: 11px;
    color: #9ca3af;
    border-top: 2px solid #e5e7eb;
    margin-top: 32px;
    line-height: 1.8;
  }
  .report-footer strong {
    color: #6b7280;
  }

  /* ── 인쇄 스타일 ─────────────────────── */
  @media print {
    .print-bar { display: none !important; }
    .report { margin-top: 0; padding: 0; }
    .cover { min-height: auto; padding: 60px 40px 40px; }
    .section { break-inside: avoid; }
    body { font-size: 12px; }
  }

  @page {
    size: A4;
    margin: 18mm 15mm;
  }
</style>
</head>
<body>
  <div class="print-bar">
    <span>리포트가 준비되었습니다</span>
    <button onclick="window.print()">PDF로 인쇄 / 저장</button>
    <button class="close-btn" onclick="window.close()">닫기</button>
  </div>

  <div class="report">
    <!-- 커버 페이지 -->
    <div class="cover">
      <div class="cover-brand">IPSI-FINDER REPORT</div>
      <div class="cover-main-title">입시 컨설팅 종합 분석 리포트</div>
      <div class="cover-sub-title">${entryYear}학년도 대입 대비</div>

      <table class="cover-info-table">
        <tr><td>학생명</td><td>${name}</td></tr>
        ${school ? `<tr><td>학교/학년</td><td>${school}${grade ? ' / ' + grade : ''}</td></tr>` : ''}
        ${major ? `<tr><td>희망 전공</td><td>${major}</td></tr>` : ''}
        ${target ? `<tr><td>목표 대학</td><td>${target}</td></tr>` : ''}
        <tr><td>분석일</td><td>${today}</td></tr>
        <tr><td>분석 AI</td><td>${modelLabel}</td></tr>
        ${pdfCount > 0 ? `<tr><td>첨부 자료</td><td>PDF ${pdfCount}건 분석 포함</td></tr>` : ''}
      </table>

      <div class="cover-note">
        본 리포트는 학생의 학교생활기록부를 바탕으로<br>
        AI 빅데이터 합격 사례 분석을 통해 작성되었습니다.
      </div>
    </div>

    <!-- 목차 -->
    <div class="toc">
      <h2>목차</h2>
      <div class="toc-divider"></div>
      ${tocHTML}
    </div>

    <!-- 분석 섹션들 -->
    ${sectionsHTML}

    <!-- 검증 결과 -->
    ${verifyHTML}

    <!-- 푸터 -->
    <div class="report-footer">
      <strong>IPSI-FINDER</strong> | 패스파인더 에듀<br>
      &copy; ${year} &mdash; ${today} 생성
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
          'x-ai-model': verifyModel,
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
      } else {
        alert('검증 오류: ' + data.message);
      }
    } catch (err) {
      alert('검증 요청 실패: ' + err.message);
    } finally {
      setVerifying(false);
    }
  };

  const renderSection = (title, content, icon = '📊') => {
    if (!content) return null;
    return (
      <div className="result-section" key={title}>
        <div className="section-header">
          <span className="section-icon">{icon}</span>
          <h3>{title}</h3>
        </div>
        <div className="section-content">
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '13px', lineHeight: '1.6' }}>
            {content}
          </pre>
        </div>
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
          {pdfCount > 0 && <span className="pdf-badge">📎 PDF {pdfCount}건 분석 포함</span>}
        </div>
        <div className="result-actions">
          <button className="btn-print-html" onClick={handlePrintHTML}>
            🖨️ HTML 리포트 / PDF 인쇄
          </button>
          <button className="btn-download-pdf" onClick={handleDownloadPDF} disabled={downloading}>
            {downloading ? '⏳ PDF 생성 중...' : '📄 PDF 다운로드'}
          </button>
          <button className="btn-secondary" onClick={handleCopyAll}>
            {copied ? '✅ 복사됨!' : '📋 전체 복사'}
          </button>
          <button className="btn-secondary" onClick={onNewAnalysis}>✨ 새 분석</button>
          <button className="btn-ghost" onClick={onBack}>← 목록</button>
        </div>
      </div>

      {/* AI 교차 검증 패널 */}
      <div className="verify-panel">
        <div className="verify-panel-header">
          <span className="verify-title">🔎 다른 AI로 검증</span>
          <span className="verify-desc">
            {usedCfg.label}(으)로 분석한 결과를 다른 AI가 교차 검증합니다
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

      {/* 검증 결과 */}
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
          <div className="verify-result-body">
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '13px', lineHeight: '1.7' }}>
              {verifyResult.content}
            </pre>
          </div>
        </div>
      )}

      <div className="result-sections">
        {SECTION_MAP.map(({ key, title, icon }) => renderSection(title, results?.[key], icon))}
      </div>
    </div>
  );
}
