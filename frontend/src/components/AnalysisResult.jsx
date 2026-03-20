import { useState } from 'react';

const API_BASE = 'https://entrance-finder-production.up.railway.app';

const MODEL_CONFIG = {
  claude: { icon: '🔵', label: 'Claude',  color: '#7c6af7' },
  gemini: { icon: '🟢', label: 'Gemini',  color: '#4caf50' },
  gpt:    { icon: '🟡', label: 'GPT-4o',  color: '#f0a500' },
};

const SECTION_MAP = [
  { key: 'caseMatching',   num: '0', title: 'AI 드라이브 사례 매칭 분석' },
  { key: 'academic',       num: '1', title: '학업역량 심층 분석' },
  { key: 'activity',       num: '2', title: '비교과 활동 분석' },
  { key: 'career',         num: '3', title: '진로 역량 및 전공 적합성 분석' },
  { key: 'strategy',       num: '4', title: '지원 전략 수립' },
  { key: 'roadmap',        num: '5', title: '3년 로드맵' },
  { key: 'recordFeedback', num: '6', title: '세특 Before/After 개선안' },
  { key: 'dashboard',      num: '7', title: '종합 대시보드' },
];

// 이모지/이모티콘 제거 함수
function stripEmojis(text) {
  if (!text) return text;
  return text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}]/gu, '').replace(/\s{2,}/g, ' ');
}

export default function AnalysisResult({ data, onBack, onNewAnalysis, selectedModel, apiKey, geminiKey, gptKey }) {
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [verifyModel, setVerifyModel] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [refining, setRefining] = useState(false);
  const [refinedResults, setRefinedResults] = useState(null);
  const { results: originalResults, studentData, pdfCount, analyzedModel } = data || {};
  const results = refinedResults || originalResults;

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

    // 검증 결과
    let verifyHTML = '';
    if (verifyResult) {
      const vContent = stripEmojis(verifyResult.content)
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
      <div class="cover-brand">PATHFINDER REPORT</div>
      <div class="cover-main-title">입시 컨설팅 종합 분석 리포트</div>
      <div class="cover-sub">${entryYear}학년도 대입 대비</div>

      <table class="cover-info-table">
        <tr><td>학생명</td><td>${name}</td></tr>
        ${school ? `<tr><td>학교/학년</td><td>${school}${grade ? ' / ' + grade : ''}</td></tr>` : ''}
        ${major ? `<tr><td>희망 전공</td><td>${major}</td></tr>` : ''}
        ${target ? `<tr><td>목표 대학</td><td>${target}</td></tr>` : ''}
        <tr><td>분석일</td><td>${today}</td></tr>
        <tr><td>분석 AI</td><td>${modelLabel}</td></tr>
        ${pdfCount > 0 ? `<tr><td>첨부 자료</td><td>PDF ${pdfCount}건 분석 포함</td></tr>` : ''}
      </table>

      <div class="cover-bottom">
        <div class="cover-note">
          본 리포트는 학생의 학교생활기록부를 바탕으로<br>
          AI 빅데이터 합격 사례 분석을 통해 작성되었습니다.
        </div>
        <div class="cover-logo">
          <div class="cover-logo-icon">P</div>
          <div>
            <div class="cover-logo-text">PATHFINDER EDU</div>
            <div class="cover-logo-sub">패스파인더 에듀</div>
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
      const c = stripEmojis(results[key] || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<div class="section"><h2 class="section-title">${idx + 1}. [${num}단계] ${title}</h2><div class="section-line"></div><div class="section-body">${c}</div></div>`;
    }).join('')}

    <!-- 검증 결과 -->
    ${verifyHTML}

    <!-- 푸터 -->
    <div class="report-footer">
      <div class="footer-logo">
        <div class="footer-logo-box">P</div>
        <span class="footer-logo-name">PATHFINDER EDU</span>
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

  const handleRefine = async () => {
    if (!verifyResult || refining) return;
    const refineKey = getKeyForModel(usedModel);
    if (!refineKey) {
      alert(`${MODEL_CONFIG[usedModel]?.label} API 키가 필요합니다.`);
      return;
    }

    setRefining(true);
    try {
      const token = localStorage.getItem('ef_token');
      const analysisText = SECTION_MAP
        .filter(({ key }) => results?.[key])
        .map(({ key, title }) => `## ${title}\n${results[key]}`)
        .join('\n\n');

      const res = await fetch(`${API_BASE}/api/refine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': refineKey,
          'x-ai-model': usedModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          studentData,
          analysisText,
          verifyText: verifyResult.content,
        }),
      });

      const resData = await res.json();
      if (resData.success) {
        // AI가 전체를 하나의 텍스트로 반환 — 섹션별로 파싱
        const refined = { ...results };
        const replyText = resData.reply;

        // 각 섹션 키워드로 분할 시도
        for (const { key, num, title } of SECTION_MAP) {
          const patterns = [
            `[${num}단계] ${title}`,
            `[${num}단계]`,
            `## ${title}`,
          ];
          for (const pattern of patterns) {
            const idx = replyText.indexOf(pattern);
            if (idx !== -1) {
              // 다음 섹션의 시작점 찾기
              let endIdx = replyText.length;
              for (const { num: nNum, title: nTitle } of SECTION_MAP) {
                if (nNum <= num) continue;
                const nextPatterns = [`[${nNum}단계]`, `## ${nTitle}`];
                for (const np of nextPatterns) {
                  const ni = replyText.indexOf(np, idx + pattern.length);
                  if (ni !== -1 && ni < endIdx) endIdx = ni;
                }
              }
              refined[key] = replyText.slice(idx + pattern.length, endIdx).trim();
              break;
            }
          }
        }

        // 파싱 실패 시 전체 텍스트를 dashboard에 넣기
        const anyParsed = SECTION_MAP.some(({ key }) => refined[key] !== results?.[key]);
        if (!anyParsed) {
          refined.dashboard = replyText;
        }

        setRefinedResults(refined);
        alert('검증 결과가 반영된 최종 리포트가 생성되었습니다.');
      } else {
        alert('재생성 오류: ' + resData.message);
      }
    } catch (err) {
      alert('재생성 요청 실패: ' + err.message);
    } finally {
      setRefining(false);
    }
  };

  const renderSection = (num, title, content) => {
    if (!content) return null;
    return (
      <div className="result-section" key={title}>
        <div className="section-header">
          <span className="section-num-badge">{num}</span>
          <h3>{title}</h3>
        </div>
        <div className="section-content">
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '13px', lineHeight: '1.6' }}>
            {stripEmojis(content)}
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
              {stripEmojis(verifyResult.content)}
            </pre>
          </div>
          <div className="verify-result-actions">
            <button
              className="btn-refine"
              onClick={handleRefine}
              disabled={refining}
            >
              {refining ? '재생성 중...' : '검증 반영 → 최종 리포트 재생성'}
            </button>
            {refinedResults && (
              <span className="refine-done-badge">최종 리포트 반영 완료</span>
            )}
          </div>
        </div>
      )}

      <div className="result-sections">
        {SECTION_MAP.map(({ key, num, title }) => renderSection(num, title, results?.[key]))}
      </div>
    </div>
  );
}
