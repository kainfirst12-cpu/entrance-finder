import { useEffect, useState } from 'react';
import { API_BASE } from '../apiBase';

// 학교알리미 새 공시 알림 — 교과별 학업성취는 보안문자 때문에 자동 갱신이 안 되므로(scripts/schoolinfo/README.md),
// 백엔드가 하루 한 번 학교알리미의 '공시기준년' 최신값을 읽어 오고, 지금 실린 catalog 연도(school-catalog-meta.json)보다
// 크면 "다시 수집할 때" 라고 알려 준다. 학교알리미 조회가 안 되는 날엔 시기(다음 해 5월 이후)로만 약하게 안내한다.
const META_URL = '/data/school-catalog-meta.json';
const DISMISS_KEY = 'ef_disclosure_dismissed'; // 값 = 닫은 공시 연도 → 그 연도 배너만 숨긴다

export default function DisclosureNotice({ compact = false }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const meta = await fetch(META_URL).then((r) => (r.ok ? r.json() : null));
        if (!meta?.disclosureYear) return;
        let probe = null;
        try { probe = await fetch(`${API_BASE}/api/schoolinfo/disclosure`).then((r) => (r.ok ? r.json() : null)); } catch { /* 백엔드 없음 */ }
        const now = new Date();
        const dueSince = new Date(meta.disclosureYear + 1, 4, 1); // 다음 해 5월 1일 — 학교알리미 정기 공시 시기
        let kind = null, latestYear = null;
        if (probe?.ok && probe.latestYear > meta.disclosureYear) { kind = 'new'; latestYear = probe.latestYear; }
        else if (!probe?.ok && now >= dueSince) { kind = 'due'; latestYear = meta.disclosureYear + 1; }
        if (!kind) return;
        let dismissed = null;
        try { dismissed = localStorage.getItem(DISMISS_KEY); } catch { /* 저장소 막힘 */ }
        if (dismissed === String(latestYear)) return;
        if (!dead) setState({ kind, latestYear, meta, probe });
      } catch { /* 조용히 */ }
    })();
    return () => { dead = true; };
  }, []);
  if (!state) return null;
  const { kind, latestYear, meta } = state;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, String(latestYear)); } catch { /* 무시 */ } setState(null); };
  const title = kind === 'new'
    ? `학교알리미에 ${latestYear}년 공시가 올라왔습니다`
    : `${latestYear}년 학교알리미 공시 시기입니다 — 새 공시가 올라왔는지 확인해 보세요`;
  return (
    <div style={{ ...S.box, ...(compact ? S.boxCompact : {}) }}>
      <div style={{ flex: 1 }}>
        <div style={S.title}>🔔 {title}</div>
        <div style={S.desc}>
          지금 화면은 {meta.disclosureYear}년 공시({meta.academicYear}) 기준입니다. 교과별 학업성취는 학교마다 보안문자를 넣어야 해서
          자동으로 바뀌지 않습니다 — <code style={S.code}>scripts/schoolinfo/README.md</code> 절차대로 다시 수집해 주세요.
          {kind === 'new' && ' (전국 약 5,900곳, 여러 PC 로 나누면 하루)'}
        </div>
      </div>
      <a href="https://www.schoolinfo.go.kr" target="_blank" rel="noreferrer" style={S.link}>학교알리미 열기 ↗</a>
      <button onClick={dismiss} style={S.close} title="이번 공시 알림 닫기">✕</button>
    </div>
  );
}

const S = {
  box: { display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 16px', margin: '0 0 16px', borderRadius: 12, background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.45)', color: 'var(--text, #e5e7eb)' },
  boxCompact: { margin: '0 0 12px', padding: '10px 14px' },
  title: { fontWeight: 700, fontSize: 14, marginBottom: 4 },
  desc: { fontSize: 12.5, opacity: 0.85, lineHeight: 1.5 },
  code: { fontSize: 11.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.08)' },
  link: { fontSize: 12.5, color: '#fbbf24', textDecoration: 'none', whiteSpace: 'nowrap', alignSelf: 'center' },
  close: { background: 'none', border: 'none', color: 'inherit', opacity: 0.6, cursor: 'pointer', fontSize: 14, alignSelf: 'flex-start' },
};
