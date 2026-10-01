import { useMemo, useState } from 'react';
import { Term } from '../schoolTerms';

// 🎯 지망 판단 보조 — 학생의 지역(학군) 내 석차 백분위를 넣으면, 지금 목록의 학교마다 1학년 핵심 과목에서
// A 를 기대할 수 있는지(A 가능 · 경계 · B 이하)를 어림한다. 순위를 매기지 않고, 무엇을 앞세울지는 상담에서 정한다.
//
// 어림 규칙(화면에도 밝힌다):
//   · 평준화 추첨이면 학교 학생 구성은 학군과 비슷하다고 보고, 학생의 교내 백분위 ≈ 학군 백분위.
//   · 다만 학교 평균이 함께 본 학교들보다 높으면(쏠림 +) 교내 백분위를 조금 낮춰 잡는다: 표준편차 1 당 ×(1+0.15).
//   · 과목별 A 비율 a 에 대해 교내 백분위 ≤ 0.85a → A 가능, ≤ 1.15a → 경계, 그 밖 → B 이하.
//   · 5등급제 1등급은 상위 10% — 교내 백분위 ≤ 10 이면 1등급권, ≤ 13 이면 경계.
const KEYS = ['국어', '수학', '영어', '통합사회', '통합과학'];
const LABEL = { 국어: '국어', 수학: '수학', 영어: '영어', 통합사회: '통합사회', 통합과학: '통합과학' };
const TONE = { A: ['A 가능', '#16a34a'], edge: ['경계', '#d6a24a'], B: ['B 이하', '#6b7280'] };
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const sd = (xs) => { const m = avg(xs); return xs.length > 1 ? Math.sqrt(avg(xs.map((x) => (x - m) ** 2))) || 1 : 1; };

export default function StudentFit({ schools, weights, onClose }) {
  const [p, setP] = useState(15);
  const [sort, setSort] = useState('name');

  const rows = useMemo(() => {
    const list = schools.filter((s) => weights?.[s.id]).slice(0, 80);
    const stat = {};
    for (const k of KEYS) { const ms = list.map((s) => weights[s.id][k]?.mean).filter((v) => typeof v === 'number'); stat[k] = { m: avg(ms), sd: sd(ms) }; }
    return list.map((s) => {
      const w = weights[s.id];
      const zs = KEYS.map((k) => (w[k] && stat[k].m !== null ? (w[k].mean - stat[k].m) / stat[k].sd : null)).filter((v) => v !== null);
      const tilt = avg(zs) ?? 0;
      const pin = Math.min(99, Math.max(0.5, p * (1 + 0.15 * tilt)));
      const subj = {};
      let nA = 0;
      for (const k of KEYS) {
        const a = w[k]?.a;
        if (typeof a !== 'number') continue;
        const tone = pin <= a * 0.85 ? 'A' : pin <= a * 1.15 ? 'edge' : 'B';
        if (tone === 'A') nA++;
        subj[k] = { a, pct: w[k].pct, tone };
      }
      const g1 = s.enrollment?.grade1;
      return { s, tilt, pin, subj, nA, seats: g1 ? Math.round(g1 * 0.1) : null, rank1: pin <= 10 ? '1등급권' : pin <= 13 ? '경계' : '2등급 이하', year: w.year };
    });
  }, [schools, weights, p]);
  const sorted = useMemo(() => [...rows].sort(sort === 'fit' ? (x, y) => y.nA - x.nA || x.s.schoolName.localeCompare(y.s.schoolName, 'ko') : (x, y) => x.s.schoolName.localeCompare(y.s.schoolName, 'ko')), [rows, sort]);
  const skipped = schools.length - rows.length;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <h3 style={S.h3}>🎯 지망 판단 보조</h3>
            <div style={S.sub}>지금 목록의 학교 {rows.length}곳{skipped > 0 ? ` (성취도 없는 ${skipped}곳 제외${schools.length > 80 ? ', 80곳까지' : ''})` : ''} · 1학년 핵심 과목 · 학교별 최신 공시</div>
          </div>
          <button style={S.btn} onClick={onClose}>✕</button>
        </div>

        <div style={S.inputRow}>
          <label style={S.lbl}>학생의 지역(학군) 내 석차 백분위 — 상위
            <input type="number" min={0.5} max={99} step={0.5} value={p} onChange={(e) => setP(Math.max(0.5, Math.min(99, Number(e.target.value) || 0)))} style={S.num} />%
          </label>
          <input type="range" min={1} max={80} step={1} value={Math.min(80, p)} onChange={(e) => setP(Number(e.target.value))} style={{ flex: 1, minWidth: 160 }} />
          <select style={S.select} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">학교 이름순</option>
            <option value="fit">A 가능 과목 많은 순</option>
          </select>
        </div>
        <div style={S.note}>
          어림 방법: 평준화 지역은 학교 학생 구성이 학군과 비슷하다고 보고, 학교 평균이 함께 본 학교들보다 높으면(<Term k="쏠림" /> +) 교내 백분위를 조금 낮춰 잡습니다.
          과목별 <Term k="A 비율" />과 비교해 A 가능 · 경계 · B 이하로 나눕니다. 중학교 성적과 고교 성취는 다를 수 있어 <b>참고용</b>이며, 순위를 매기지 않습니다.
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>학교</th>
                <th style={S.th}><Term k="쏠림" /></th>
                <th style={S.th}>교내 예상</th>
                {KEYS.map((k) => <th key={k} style={S.th}>{LABEL[k]}</th>)}
                <th style={S.th}><Term k="1등급 자리" /></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.s.id}>
                  <td style={S.td}><b>{r.s.schoolName.replace(/고등학교$/, '고')}</b><div style={S.dim}>{r.s.gender} · {r.year}</div></td>
                  <td style={{ ...S.td, color: r.tilt > 0.3 ? '#f87171' : r.tilt < -0.3 ? '#60a5fa' : 'var(--text2)' }}>{r.tilt >= 0 ? '+' : ''}{r.tilt.toFixed(1)}</td>
                  <td style={S.td}>상위 {r.pin.toFixed(1)}%<div style={S.dim}>{r.rank1}</div></td>
                  {KEYS.map((k) => {
                    const c = r.subj[k];
                    if (!c) return <td key={k} style={S.td}><span style={S.dim}>—</span></td>;
                    const [label, color] = TONE[c.tone];
                    return (
                      <td key={k} style={S.td}>
                        <span style={{ ...S.chip, background: color }}>{label}</span>
                        <div style={S.dim}>A {c.a}% · 전국 {c.pct ?? '—'}%</div>
                      </td>
                    );
                  })}
                  <td style={S.td}>{r.seats != null ? `${r.seats}명` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <div style={S.dim}>성취도 자료가 있는 학교가 없습니다. 시도·시군구를 골라 목록을 좁혀 주세요.</div>}
      </div>
    </div>
  );
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(1200px, 97vw)', maxHeight: '92vh', overflow: 'auto' },
  head: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' },
  h3: { margin: 0, fontSize: 18, color: 'var(--text)' },
  sub: { fontSize: 12, color: 'var(--text2)', marginTop: 4 },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' },
  inputRow: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '14px 0 8px' },
  lbl: { fontSize: 13, color: 'var(--text)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 },
  num: { width: 70, background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', fontSize: 14 },
  select: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', fontSize: 13 },
  note: { fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', whiteSpace: 'nowrap', fontWeight: 700 },
  td: { padding: '7px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text)', verticalAlign: 'top', whiteSpace: 'nowrap' },
  chip: { display: 'inline-block', color: '#fff', fontSize: 11, fontWeight: 800, borderRadius: 999, padding: '2px 8px' },
  dim: { fontSize: 11, color: 'var(--text3)', marginTop: 2 },
};
