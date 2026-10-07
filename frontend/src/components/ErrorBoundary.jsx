import { Component } from 'react';

// 한 부분이 렌더 중에 터져도 앱 전체가 언마운트되지 않게 막는다.
// 경계가 없으면 React 가 트리를 통째로 내려서 App.css 의 어두운 --bg 만 남은 '검은 화면'이 된다
// (2026-09-01 입결 콘솔, 2026-10-08 너만의 패파 — 둘 다 로그인 화면조차 안 떴다).
// fallback 이 null 이면 그 부분만 조용히 사라지고(떠 있는 창 등), 아니면 안내문을 보여 준다.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`[ErrorBoundary:${this.props.name || '?'}]`, error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <div style={{ maxWidth: 520, margin: '15vh auto', padding: 24, borderRadius: 12, background: '#fff', color: '#1f2937', fontSize: 15, lineHeight: 1.6 }}>
        <b>화면을 그리다 오류가 났습니다.</b>
        <div style={{ marginTop: 8, color: '#6b7280', fontSize: 13, wordBreak: 'break-all' }}>{String(this.state.error?.message || this.state.error)}</div>
        <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 16, padding: '8px 16px', borderRadius: 8, border: 0, background: '#2f7d6d', color: '#fff', cursor: 'pointer' }}>
          새로고침
        </button>
      </div>
    );
  }
}
