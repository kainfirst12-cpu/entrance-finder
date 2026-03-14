import { useState } from 'react';

const SECTIONS = [
  { key: 'caseMatching',   icon: '🔍', title: 'AI 드라이브 사례 매칭 분석' },
  { key: 'academic',       icon: '📊', title: '학업역량 심층 분석' },
  { key: 'activity',       icon: '🏆', title: '비교과 활동 분석' },
  { key: 'career',         icon: '🎯', title: '진로 역량 및 전공 적합성' },
  { key: 'strategy',       icon: '📋', title: '지원 전략 수립' },
  { key: 'roadmap',        icon: '📅', title: '3년 로드맵' },
  { key: 'recordFeedback', icon: '✏️', title: '세특 Before/After 개선안' },
  { key: 'dashboard',      icon: '🎓', title: '종합 대시보드' },
];

// ** 같은 AI 마크다운 제거
const cleanText = (text = '') =>
  text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/#{1,6}\s/g, '')
    .replace(/`{1,3}/g, '')
    .trim();

export default function AnalysisResult({ data, onBack, onNewAnalysis }) {
  const [view, setView] = useState('report'); // report | edit
  const [results, setResults] = useState(() => {
    const cleaned = {};
    Object.entries(data.results || {}).forEach(([k, v]) => {
      cleaned[k] = cleanText(v);
    });
    return cleaned;
  });
  const [editingKey, setEditingKey] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [copied, setCopied] = useState('');
  const { studentData } = data;

  // 편집 시작
  const startEdit = (key) => {
    setEditingKey(key);
    setEditValue(results[key] || '');
  };

  // 편집 저장
  const saveEdit = () => {
    setResults(prev => ({ ...prev, [editingKey]: editValue }));
    setEditingKey(null);
  };

  // 편집 취소
  const cancelEdit = () => setEditingKey(null);

  // 전체 리포트 텍스트 생성
  const buildFullReport = () => {
    const date = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const header = `IPSIFINDER REPORT
입시 컨설팅 종합 분석 리포트
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

학생명      ${studentData.name}
학교/학년   ${studentData.school || '미입력'}  ${studentData.grade}
희망 전공   ${studentData.major}
목표 대학   ${studentData.targetUniv}
분석일      ${date}

본 리포트는 학생의 학교생활기록부를 바탕으로
AI 빅데이터 합격 사례 분석을 통해 작성되었습니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
목차

  1. AI 드라이브 사례 매칭 분석
  2. 학업역량 심층 분석
  3. 비교과 활동 분석
  4. 진로 역량 및 전공 적합성
  5. 지원 전략 수립
  6. 3년 로드맵
  7. 세특 Before/After 개선안
  8. 종합 대시보드

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    const body = SECTIONS.map((s, i) =>
      `\n\n${i + 1}. ${s.title}\n${'─'.repeat(50)}\n\n${results[s.key] || '(내용 없음)'}`
    ).join('\n');

    return header + body;
  };

  const copyReport = () => {
    navigator.clipboard.writeText(buildFullReport());
    setCopied('report');
    setTimeout(() => setCopied(''), 2000);
  };

  const copySection = (key) => {
    navigator.clipboard.writeText(results[key] || '');
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="result-page">
      {/* 헤더 */}
      <div className="result-header">
        <div className="result-header-left">
          <button className="btn-ghost" onClick={onBack}>← 목록으로</button>
          <div>
            <h1 className="result-title">✅ {studentData.name} 분석 완료</h1>
            <p className="result-meta">{studentData.grade} · {studentData.targetUniv} · {studentData.major}</p>
          </div>
        </div>
        <div className="result-header-right">
          <div className="view-toggle">
            <button className={`toggle-btn ${view === 'report' ? 'active' : ''}`} onClick={() => setView('report')}>
              📄 리포트
            </button>
            <button className={`toggle-btn ${view === 'edit' ? 'active' : ''}`} onClick={() => setView('edit')}>
              ✏️ 수정
            </button>
          </div>
          <button className={`btn-copy-all ${copied === 'report' ? 'copied' : ''}`} onClick={copyReport}>
            {copied === 'report' ? '✅ 복사됨!' : '📋 전체 리포트 복사'}
          </button>
          <button className="btn-primary" onClick={onNewAnalysis}>+ 새 분석</button>
        </div>
      </div>

      {/* 리포트 뷰 */}
      {view === 'report' && (
        <div className="report-view">
          {/* 리포트 커버 */}
          <div className="report-cover">
            <div className="report-cover-logo">IPSIFINDER REPORT</div>
            <div className="report-cover-title">입시 컨설팅 종합 분석 리포트</div>
            <div className="report-cover-divider"/>
            <div className="report-cover-info">
              <div className="report-info-row"><span>학생명</span><span>{studentData.name}</span></div>
              <div className="report-info-row"><span>학교/학년</span><span>{studentData.school || '미입력'} {studentData.grade}</span></div>
              <div className="report-info-row"><span>희망 전공</span><span>{studentData.major}</span></div>
              <div className="report-info-row"><span>목표 대학</span><span>{studentData.targetUniv}</span></div>
              <div className="report-info-row"><span>분석일</span><span>{new Date().toLocaleDateString('ko-KR')}</span></div>
            </div>
            <div className="report-cover-note">
              본 리포트는 학생의 학교생활기록부를 바탕으로<br/>
              AI 빅데이터 합격 사례 분석을 통해 작성되었습니다.
            </div>
          </div>

          {/* 각 섹션 */}
          {SECTIONS.map((s, i) => (
            <div key={s.key} className="report-section">
              <div className="report-section-num">{i + 1}</div>
              <div className="report-section-body">
                <div className="report-section-header">
                  <h2 className="report-section-title">{s.icon} {s.title}</h2>
                  <button
                    className={`btn-copy-sm ${copied === s.key ? 'copied' : ''}`}
                    onClick={() => copySection(s.key)}
                  >
                    {copied === s.key ? '✅' : '복사'}
                  </button>
                </div>
                <div className="report-section-content">
                  {results[s.key] || '(내용 없음)'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 수정 뷰 */}
      {view === 'edit' && (
        <div className="edit-view">
          <div className="edit-notice">
            각 섹션의 내용을 직접 수정할 수 있어요. 수정 후 저장하면 리포트에 반영됩니다.
          </div>
          {SECTIONS.map((s) => (
            <div key={s.key} className="edit-section">
              <div className="edit-section-header">
                <span className="edit-section-title">{s.icon} {s.title}</span>
                {editingKey !== s.key ? (
                  <button className="btn-edit" onClick={() => startEdit(s.key)}>
                    수정하기
                  </button>
                ) : (
                  <div className="edit-actions">
                    <button className="btn-save" onClick={saveEdit}>저장</button>
                    <button className="btn-cancel" onClick={cancelEdit}>취소</button>
                  </div>
                )}
              </div>
              {editingKey === s.key ? (
                <textarea
                  className="edit-textarea"
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  rows={20}
                  autoFocus
                />
              ) : (
                <div className="edit-preview">
                  {results[s.key] || '(내용 없음)'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
