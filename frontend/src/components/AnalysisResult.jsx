import { useState } from 'react';

export default function AnalysisResult({ data, onBack, onNewAnalysis }) {
  const [downloading, setDownloading] = useState(false);
  const { results, studentData, pdfCount } = data || {};

  const handleDownloadPDF = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'https://entrance-finder-production.up.railway.app';
      const response = await fetch(`${apiUrl}/api/generate-pdf`, {
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

  const sectionMap = [
    { key: 'caseMatching',   title: 'Drive 합격자 사례 매칭', icon: '🔍' },
    { key: 'academic',       title: '학업역량 분석',          icon: '📚' },
    { key: 'activity',       title: '비교과 활동 분석',       icon: '🏃' },
    { key: 'career',         title: '진로 역량 분석',         icon: '🎯' },
    { key: 'strategy',       title: '지원 전략 수립',         icon: '📋' },
    { key: 'roadmap',        title: '3년 로드맵',             icon: '🗓️' },
    { key: 'recordFeedback', title: '세특 개선안',            icon: '✏️' },
    { key: 'dashboard',      title: '종합 대시보드',          icon: '☁️' },
  ];

  return (
    <div className="result-page">
      <div className="result-header">
        <div className="result-header-info">
          <h2>✅ 분석 완료</h2>
          <p>{studentData?.name} · {studentData?.school} · {studentData?.major}</p>
          {pdfCount > 0 && <span className="pdf-badge">📎 PDF {pdfCount}건 분석 포함</span>}
        </div>
        <div className="result-actions">
          <button className="btn-download-pdf" onClick={handleDownloadPDF} disabled={downloading}>
            {downloading ? '⏳ PDF 생성 중...' : '📄 PDF 다운로드'}
          </button>
          <button className="btn-secondary" onClick={onNewAnalysis}>✨ 새 분석</button>
          <button className="btn-ghost" onClick={onBack}>← 목록</button>
        </div>
      </div>
      <div className="result-sections">
        {sectionMap.map(({ key, title, icon }) => renderSection(title, results?.[key], icon))}
      </div>
    </div>
  );
}