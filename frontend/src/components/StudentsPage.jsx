import { useState, useEffect } from 'react';
import StudentList from './StudentList';
import Board from './Board';

// 👥 학생 화면 — 목록과 관리 보드를 한 자리에 두되 **한 번에 하나만** 보여준다.
//
// 왜 이렇게 두나(원장 요청 2026-09-07): 관리 보드가 대시보드 아래에 늘 펼쳐져 있어서
// 대시보드가 한없이 길어졌다. 그렇다고 목록 밑에 그대로 옮겨 붙이면 이번엔 학생 목록이
// 길어진다 — 자리만 옮긴 셈이다. 그래서 위에서 골라 보게 한다.
// 무엇을 보고 있었는지는 이 기기에 기억한다(대개 늘 같은 쪽만 본다).

const KEY = 'ef_students_tab';
const TABS = [
  { key: 'list', icon: '👥', label: '학생 목록', desc: '등록·기록·브리핑' },
  { key: 'board', icon: '📋', label: '관리 보드', desc: '진행 단계별 칸반' },
];

export default function StudentsPage({ onNewAnalysis, onAuthError, onOpenAnalysis, onAnalyzeFile }) {
  const [tab, setTab] = useState('list');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'board' || saved === 'list') setTab(saved);
    } catch { /* 저장이 막힌 브라우저에서도 화면은 떠야 한다 */ }
  }, []);

  const pick = (k) => {
    setTab(k);
    try { localStorage.setItem(KEY, k); } catch { /* 저장 불가 */ }
  };

  return (
    <div>
      <div style={S.bar}>
        {TABS.map((t) => {
          const on = tab === t.key;
          return (
            <button key={t.key} onClick={() => pick(t.key)}
              style={{ ...S.tab, ...(on ? S.tabOn : {}) }}>
              <span style={S.icon}>{t.icon}</span>
              <span>
                <span style={S.label}>{t.label}</span>
                <span style={S.desc}>{t.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* 두 화면 모두 살려 둔다 — 숨기기만 하면 보드에 쓰던 값·펼친 카드가 전환할 때마다 날아가지 않는다 */}
      <div style={tab === 'list' ? undefined : S.hidden}>
        <StudentList onNewAnalysis={onNewAnalysis} onAuthError={onAuthError} onOpenAnalysis={onOpenAnalysis} />
      </div>
      <div style={tab === 'board' ? undefined : S.hidden}>
        <Board onAuthError={onAuthError} onOpenAnalysis={onOpenAnalysis} onAnalyzeFile={onAnalyzeFile} />
      </div>
    </div>
  );
}

const S = {
  bar: { display: 'flex', gap: 8, padding: '18px 28px 0', flexWrap: 'wrap' },
  tab: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.09)', background: 'rgba(255,255,255,0.03)',
    color: '#9db0bd', cursor: 'pointer', textAlign: 'left',
  },
  tabOn: { border: '1px solid #3f6fe0', background: 'rgba(63,111,224,0.14)', color: '#e8eef3' },
  icon: { fontSize: 18 },
  label: { display: 'block', fontSize: 13.5, fontWeight: 700 },
  desc: { display: 'block', fontSize: 11, color: '#7f93a3', marginTop: 1 },
  hidden: { display: 'none' },
};
