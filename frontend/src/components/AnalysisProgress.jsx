// src/components/AnalysisProgress.jsx

const STEP_INFO = [
  { icon: '📁', label: 'Drive 지식베이스 로딩' },
  { icon: '🔍', label: 'Drive 사례 매칭 탐색' },
  { icon: '📚', label: '학업역량 분석' },
  { icon: '🏆', label: '비교과 활동 분석' },
  { icon: '🎯', label: '진로 역량 분석' },
  { icon: '🗺️', label: '지원 전략 수립' },
  { icon: '📅', label: '3년 로드맵 생성' },
  { icon: '✏️', label: '세특 개선안 작성' },
  { icon: '🎓', label: '종합 대시보드 생성' },
];

export default function AnalysisProgress({ steps, currentStep }) {
  return (
    <div className="progress-page">
      <div className="progress-header">
        <div className="progress-badge">AI 분석 진행 중</div>
        <h1 className="progress-title">Drive 자료 기반 분석 중...</h1>
        <p className="progress-desc">합격자 사례와 대입 정책 자료를 참조하여 분석하고 있어요</p>
      </div>

      {/* 진행 바 */}
      <div className="progress-bar-wrap">
        <div
          className="progress-bar-fill"
          style={{ width: `${(currentStep / (STEP_INFO.length - 1)) * 100}%` }}
        />
      </div>
      <div className="progress-percent">{Math.round((currentStep / (STEP_INFO.length - 1)) * 100)}%</div>

      {/* 단계 목록 */}
      <div className="steps-list">
        {STEP_INFO.map((info, i) => {
          const isCompleted = i < currentStep;
          const isActive = i === currentStep;
          const isPending = i > currentStep;

          return (
            <div
              key={i}
              className={`step-item ${isCompleted ? 'completed' : isActive ? 'active' : 'pending'}`}
            >
              <div className="step-icon-wrap">
                {isCompleted ? (
                  <span className="step-check">✓</span>
                ) : isActive ? (
                  <span className="step-spinner" />
                ) : (
                  <span className="step-num">{i + 1}</span>
                )}
              </div>
              <div className="step-content">
                <span className="step-emoji">{info.icon}</span>
                <span className="step-label">{info.label}</span>
              </div>
              {isActive && (
                <div className="step-dots">
                  <span /><span /><span />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="progress-note">
        ⏱️ 분석에 약 2~3분 소요됩니다. Drive 자료가 많을수록 더 정확한 분석이 이루어집니다.
      </div>
    </div>
  );
}
