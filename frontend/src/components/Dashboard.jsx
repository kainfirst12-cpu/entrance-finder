import Board from './Board';

const ACTIONS = [
  { key: 'form', icon: '✨', label: '새 분석', desc: '생기부 AI 분석 시작', color: '#5b86d6', bg: 'rgba(91,134,214,0.16)' },
  { key: 'assessment', icon: '📝', label: '수행평가 도우미', desc: '작성·첨삭·문서화', color: '#9070d8', bg: 'rgba(144,112,216,0.16)' },
  { key: 'chat', icon: '💬', label: '입시 상담', desc: 'AI에게 상담', color: '#46a571', bg: 'rgba(70,165,113,0.16)' },
  { key: 'admissions', icon: '🎓', label: '대학 입결 조회', desc: '정시·수시·논술 입결', color: '#e0993f', bg: 'rgba(224,153,63,0.16)' },
  { key: 'list', icon: '👥', label: '학생 목록', desc: '저장된 분석 목록', color: '#5b86d6', bg: 'rgba(91,134,214,0.16)' },
  { key: 'import', icon: '📂', label: '분석 불러오기', desc: 'JSON 파일 열기', color: '#8a857c', bg: 'rgba(255,255,255,0.05)' },
];

export default function Dashboard({ onNav, onImport, onAuthError }) {
  return (
    <div style={S.page}>
      <h2 style={S.h2}>대시보드</h2>
      <p style={S.lead}>학생 관리 보드를 중심으로 분석·수행평가·상담·입결 조회를 한 곳에서.</p>

      <div style={S.actions}>
        {ACTIONS.map(a => (
          <button key={a.key} style={{ ...S.actionCard, background: a.bg }}
            onClick={() => (a.key === 'import' ? onImport?.() : onNav?.(a.key))}>
            <span style={{ ...S.actionIcon, color: a.color }}>{a.icon}</span>
            <span style={S.actionLabel}>{a.label}</span>
            <span style={S.actionDesc}>{a.desc}</span>
          </button>
        ))}
      </div>

      <div style={S.boardWrap}>
        <Board onAuthError={onAuthError} />
      </div>
    </div>
  );
}

const S = {
  page: { padding: '24px 28px 8px' },
  h2: { fontSize: 24, fontWeight: 800, margin: '0 0 4px', color: '#e8eef3' },
  lead: { color: '#9db0bd', fontSize: 13.5, margin: '0 0 18px' },
  actions: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 10 },
  actionCard: { display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3, border: '1px solid #e8e6df', borderRadius: 14, padding: '16px 16px', cursor: 'pointer', textAlign: 'left', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  actionIcon: { fontSize: 24 },
  actionLabel: { fontSize: 15, fontWeight: 700, color: '#e8eef3', marginTop: 4 },
  actionDesc: { fontSize: 12, color: '#9db0bd' },
  boardWrap: { marginTop: 8, borderTop: '1px solid #e8e6df' },
};
