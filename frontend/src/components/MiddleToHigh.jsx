import { useEffect, useMemo, useState } from 'react';
import { aGradeSpan, layerOf } from '../schoolTerms';
import { distanceKm } from '../schoolExtra';
import { schoolNameMatch, shortSchoolName } from '../schoolCatalog';

// 🔀 중학교 → 고교 A 이어보기 — «○○중에서 A 받던 학생이 △△고 1학년 그 과목에서 A 를 받을 가능성» 어림.
// 같은 학생을 따라간 자료가 아니라 두 학교의 학교알리미 성취도 비율만으로 계산하는 참고값이다(화면에도 밝힌다).
//
// 어림 규칙:
//   1) 중학교 X 의 과목 A 비율 a중 → X 에서 A 받은 학생은 X 안에서 상위 a중% 안에 고르게 있다고 본다.
//   2) X 의 평균이 같은 시군구 중학교들보다 높으면(수준 +) 그 A 는 지역에서 더 위쪽이다:
//      지역 백분위 = a중 × (1 − 0.15·z중)   (z중 = 과목별 평균의 지역 표준점수 평균, ±2 로 자름)
//   3) 고교 Y 학생 구성은 지역 일반고와 비슷하다고 보고, Y 평균이 지역 일반고보다 높으면 교내 백분위를 낮춰 잡는다:
//      교내 백분위 P = 지역 백분위 × (1 + 0.15·z고)   — 🎯 지망 판단 보조와 같은 보정
//   4) X 의 A 학생은 Y 에서 상위 0~P% 에 고르게 퍼진다 → Y 에서 A(상위 a고%) 를 받을 가능성 ≈ min(1, a고 ÷ P),
//      5등급제 1등급(상위 10%) 가능성 ≈ min(1, 10 ÷ P).
const SUBJ = [
  { mid: '국어', high: '국어', label: '국어' },
  { mid: '영어', high: '영어', label: '영어' },
  { mid: '수학', high: '수학', label: '수학' },
  { mid: '사회', high: '통합사회', label: '사회→통합사회' },
  { mid: '과학', high: '통합과학', label: '과학→통합과학' },
];
const MAX_HIGH = 8;
const K = 0.15;
const clampZ = (z) => Math.max(-2, Math.min(2, z));
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const sd = (xs) => { const m = avg(xs); return xs.length > 1 ? Math.sqrt(avg(xs.map((x) => (x - m) ** 2))) || 1 : 1; };
const yearNum = (y) => parseInt(String(y || ''), 10) || 0;
const short = (n) => String(n || '').replace(/고등학교$/, '고').replace(/중학교$/, '중');

/** 중학교 성취도 한 과목·한 학년 — 가장 최근 학년도의 학기들을 평균. 국·영·수는 family, 사회·과학은 과목명으로 찾는다. */
export function midBand(bands, subj, grade) {
  const list = (bands || []).filter((b) => b.grade === grade && b.a !== null && b.a !== undefined
    && (b.family === subj || (!b.family && b.subject === subj)));
  if (!list.length) return null;
  const y = Math.max(...list.map((b) => yearNum(b.year)));
  const cur = list.filter((b) => yearNum(b.year) === y);
  const means = cur.map((b) => b.mean).filter((v) => typeof v === 'number');
  return { a: avg(cur.map((b) => b.a)), mean: avg(means), year: cur[0].year, sems: cur.map((b) => b.semester).sort().join('·') };
}

// 어림값이 100% 로 보이면 약속처럼 읽힌다 → 95% 이상은 «95%+»
const shown = (p) => (p >= 95 ? '95%+' : `${p}%`);

/** 가능성 % → 색·말 */
function tone(p) {
  if (p >= 70) return { color: '#16a34a', word: '높음' };
  if (p >= 40) return { color: '#d6a24a', word: '반반' };
  return { color: '#6b7280', word: '낮음' };
}

export default function MiddleToHigh({ allSchools, weights, loadFullBands, initialMiddle, initialHighs, onClose }) {
  const middles = useMemo(() => allSchools.filter((s) => s.schoolLevel === '중학교'), [allSchools]);
  const highs = useMemo(() => allSchools.filter((s) => s.schoolLevel === '고등학교' && weights?.[s.id]), [allSchools, weights]);
  const label = (s) => `${s.schoolName} (${s.sido} ${s.sigungu})`;

  const [midQ, setMidQ] = useState(initialMiddle ? label(initialMiddle) : '');
  const mid = useMemo(() => middles.find((s) => label(s) === midQ) || null, [middles, midQ]);
  const [highIds, setHighIds] = useState((initialHighs || []).filter((s) => weights?.[s.id]).map((s) => s.id).slice(0, MAX_HIGH));
  const [highQ, setHighQ] = useState('');
  const [grade, setGrade] = useState(3);
  const [midData, setMidData] = useState(null); // { bands, region: { [subj]: { mean, sd, a, n } } }
  const [loading, setLoading] = useState(false);

  // 중학교를 고르면: 그 학교 전 과목 + 같은 시군구 중학교들의 전 과목을 받아 지역 평균을 만든다
  useEffect(() => {
    if (!mid) { setMidData(null); return undefined; }
    let dead = false;
    setLoading(true);
    (async () => {
      let peers = middles.filter((s) => s.sido === mid.sido && s.sigungu === mid.sigungu);
      let scope = mid.sigungu;
      if (peers.length < 5) { peers = middles.filter((s) => s.sido === mid.sido); scope = mid.sido; }
      const full = await Promise.all(peers.map(async (s) => ({ s, bands: (await loadFullBands(s).catch(() => null)) || s.bands || [] })));
      if (dead) return;
      const byGrade = {};
      for (const g of [2, 3]) {
        const region = {};
        for (const { mid: k } of SUBJ) {
          const rows = full.map((f) => midBand(f.bands, k, g)).filter((b) => b && typeof b.mean === 'number');
          const ms = rows.map((b) => b.mean);
          region[k] = { mean: avg(ms), sd: sd(ms), a: avg(rows.map((b) => b.a)), n: rows.length };
        }
        byGrade[g] = region;
      }
      const own = full.find((f) => f.s.id === mid.id)?.bands || mid.bands || [];
      setMidData({ bands: own, byGrade, peerScope: `${scope} 중학교 ${peers.length}곳` });
      setLoading(false);
    })().catch(() => { if (!dead) { setMidData(null); setLoading(false); } });
    return () => { dead = true; };
  }, [mid, middles, loadFullBands]);

  // 중학교 쪽: 과목별 A 비율·수준 보정 → 지역 백분위
  const midRows = useMemo(() => {
    if (!midData) return null;
    const region = midData.byGrade[grade];
    const per = {};
    const zs = [];
    for (const { mid: k } of SUBJ) {
      const b = midBand(midData.bands, k, grade);
      if (!b) continue;
      const r = region[k];
      const z = r && r.mean !== null && typeof b.mean === 'number' && r.n >= 3 ? (b.mean - r.mean) / r.sd : null;
      per[k] = { ...b, regionA: r?.a ?? null, z };
      if (z !== null) zs.push(z);
    }
    const zMid = clampZ(avg(zs) ?? 0);
    for (const k of Object.keys(per)) per[k].regionP = per[k].a > 0 ? Math.max(0.5, per[k].a * (1 - K * zMid)) : null;
    return { per, zMid };
  }, [midData, grade]);

  // 고교 쪽: 같은 시군구 일반고(없으면 시도) 평균과 비교한 쏠림
  const picked = highIds.map((id) => highs.find((s) => s.id === id)).filter(Boolean);
  const table = useMemo(() => {
    if (!midRows) return [];
    return picked.map((h) => {
      const w = weights[h.id];
      let peers = highs.filter((s) => s.sido === h.sido && s.sigungu === h.sigungu && layerOf(s) === 'local');
      if (peers.length < 3) peers = highs.filter((s) => s.sido === h.sido && layerOf(s) === 'local');
      const zs = SUBJ.map(({ high: k }) => {
        const ms = peers.map((s) => weights[s.id]?.[k]?.mean).filter((v) => typeof v === 'number');
        return w[k] && ms.length >= 2 ? (w[k].mean - avg(ms)) / sd(ms) : null;
      }).filter((v) => v !== null);
      const zHigh = clampZ(avg(zs) ?? 0);
      const cells = {};
      for (const { mid: mk, high: hk } of SUBJ) {
        const m = midRows.per[mk];
        const a = w[hk]?.a;
        if (!m || m.regionP === null || typeof a !== 'number') continue;
        const P = Math.min(99, Math.max(0.5, m.regionP * (1 + K * zHigh)));
        cells[hk] = { a, P, pA: Math.round(Math.min(1, a / P) * 100), p1: Math.round(Math.min(1, 10 / P) * 100) };
      }
      return { h, zHigh, cells, year: w.year, local: layerOf(h) === 'local' };
    });
  }, [midRows, picked, highs, weights]);

  const addHigh = (id) => setHighIds((c) => (c.includes(id) || c.length >= MAX_HIGH ? c : [...c, id]));
  const nearHighs = () => {
    if (!mid?.loc) return;
    const near = highs.filter((s) => s.loc && layerOf(s) === 'local')
      .map((s) => ({ s, d: distanceKm(mid.loc, s.loc) }))
      .sort((x, y) => x.d - y.d).slice(0, 6).map((x) => x.s.id);
    setHighIds(near);
  };
  const highOptions = useMemo(() => {
    const kw = highQ.trim().replace(/\s+/g, '');
    if (kw.length < 1) return [];
    return highs.filter((s) => schoolNameMatch(s.schoolName, kw)).slice(0, 40);
  }, [highs, highQ]);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <h3 style={S.h3}>🔀 중학교 → 고교 A 이어보기</h3>
            <div style={S.sub}>«이 중학교에서 A 받던 학생이 이 고등학교 1학년 그 과목에서 A를 받을 가능성» 어림 · 학교알리미 성취도 비율 기준</div>
          </div>
          <button style={S.btn} onClick={onClose}>✕</button>
        </div>

        <div style={S.inputRow}>
          <span style={S.lbl}>① 중학교</span>
          <input list="ef-m2h-mid" style={{ ...S.input, minWidth: 280 }} placeholder="중학교 이름 (예: 부천중)" value={midQ} onChange={(e) => setMidQ(e.target.value)} />
          <datalist id="ef-m2h-mid">{(midQ.trim().length >= 1 ? middles.filter((s) => schoolNameMatch(s.schoolName, midQ.trim().split(' ')[0])).slice(0, 60) : []).map((s) => <option key={s.id} value={label(s)} label={shortSchoolName(s.schoolName)} />)}</datalist>
          <span style={S.lbl}>기준 학년</span>
          {[3, 2].map((g) => <button key={g} style={{ ...S.pick, ...(grade === g ? S.pickOn : {}) }} onClick={() => setGrade(g)}>중{g}</button>)}
        </div>

        <div style={S.inputRow}>
          <span style={S.lbl}>② 고등학교</span>
          <input list="ef-m2h-high" style={{ ...S.input, minWidth: 240 }} placeholder="고교 이름으로 담기 (예: 부천고)" value={highQ}
            onChange={(e) => {
              const v = e.target.value;
              const hit = highs.find((s) => label(s) === v);
              if (hit) { addHigh(hit.id); setHighQ(''); } else setHighQ(v);
            }} />
          <datalist id="ef-m2h-high">{highOptions.map((s) => <option key={s.id} value={label(s)} />)}</datalist>
          {mid?.loc && <button style={S.btn} onClick={nearHighs}>📍 이 중학교에서 가까운 일반고 6곳</button>}
          {picked.map((s) => (
            <span key={s.id} style={S.tag}>{short(s.schoolName)} <b style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => setHighIds((c) => c.filter((x) => x !== s.id))}>×</b></span>
          ))}
          <span style={S.dim}>{picked.length}/{MAX_HIGH}</span>
        </div>

        {loading && <div style={S.note}>중학교 성취도와 같은 지역 중학교 자료를 불러오는 중…</div>}
        {mid && midRows && (
          <div style={S.note}>
            <b>{mid.schoolName}</b> 중{grade} A 비율 ({midData.peerScope}와 비교 · 수준{' '}
            <b style={{ color: midRows.zMid > 0.3 ? '#f87171' : midRows.zMid < -0.3 ? '#60a5fa' : 'var(--text)' }}>{midRows.zMid >= 0 ? '+' : ''}{midRows.zMid.toFixed(1)}</b>)
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
              {SUBJ.map(({ mid: k }) => {
                const m = midRows.per[k];
                return <span key={k}>{k} {m ? <><b>A {m.a.toFixed(1)}%</b>{m.regionA !== null ? <span style={S.dim}> (지역 {m.regionA.toFixed(1)}%)</span> : null}{m.regionP !== null ? <span style={S.dim}> → 지역 상위 {m.regionP.toFixed(0)}%</span> : null}</> : <span style={S.dim}>공시 없음</span>}</span>;
              })}
            </div>
            <div style={S.dim}>{Object.values(midRows.per)[0]?.year} {Object.values(midRows.per)[0]?.sems}학기 공시 평균</div>
          </div>
        )}
        {!mid && <div style={S.note}>중학교를 고르고 비교할 고등학교를 담으세요. 공시정보 목록의 비교함에 담긴 고교, 📍 출발 중학교가 있으면 미리 채워 둡니다.</div>}

        {mid && midRows && picked.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>고등학교</th>
                  <th style={S.th}>쏠림</th>
                  {SUBJ.map((s) => <th key={s.high} style={S.th}>{s.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.h.id}>
                    <td style={S.td}><b>{short(r.h.schoolName)}</b><div style={S.dim}>{r.h.sigungu} · {r.year}{!r.local ? ' · 일반고 외' : ''}</div></td>
                    <td style={{ ...S.td, color: r.zHigh > 0.3 ? '#f87171' : r.zHigh < -0.3 ? '#60a5fa' : 'var(--text2)' }}>{r.zHigh >= 0 ? '+' : ''}{r.zHigh.toFixed(1)}</td>
                    {SUBJ.map(({ high: k }) => {
                      const c = r.cells[k];
                      if (!c) return <td key={k} style={S.td}><span style={S.dim}>—</span></td>;
                      const t = tone(c.pA);
                      return (
                        <td key={k} style={S.td}>
                          <span style={{ ...S.chip, background: t.color }}>A 약 {shown(c.pA)}</span>
                          <div style={S.dim}>고1 A {c.a}% · 교내 상위 ~{c.P.toFixed(0)}% 안</div>
                          <div style={S.dim}>1등급 약 {shown(c.p1)}{aGradeSpan(c.a)?.span ? ` · A면 ${aGradeSpan(c.a).span}` : ''}</div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ ...S.note, marginTop: 12 }}>
          <b>어떻게 계산하나요?</b> 중학교에서 A 받은 학생은 그 학교 안에서 상위 (A 비율)% 안에 고르게 있다고 봅니다.
          중학교 평균이 같은 지역 중학교들보다 높으면 그 A를 지역에서 더 위쪽으로, 낮으면 아래쪽으로 옮깁니다.
          고등학교는 학생 구성이 지역 일반고와 비슷하다고 보고, 평균이 높은 학교(쏠림 +)일수록 교내 위치를 낮춰 잡습니다(🎯 지망 판단 보조와 같은 보정).
          그 범위 안에서 고1 A 비율만큼에 들 몫이 «A 가능성», 상위 10%에 들 몫이 «1등급 가능성»입니다.
          <br />
          <b>한계</b> · 같은 학생을 따라간 자료가 아니라 학교 전체 비율로 어림한 <b>참고값</b>입니다. 성취도는 절대평가라 시험 난이도에 따라 해마다 달라지고,
          상위권 일부가 특목·자사고로 빠지거나 고교 배정이 지역과 다르면 어긋날 수 있습니다. 학생 한 명의 결과를 약속하는 숫자가 아닙니다.
        </div>
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
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer', fontSize: 12.5 },
  input: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 13 },
  inputRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0 6px' },
  lbl: { fontSize: 13, color: 'var(--text)', fontWeight: 700 },
  tag: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px', fontSize: 12, color: 'var(--text)' },
  pick: { background: 'var(--surface2)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px', fontSize: 12, cursor: 'pointer' },
  pickOn: { background: '#16a34a', color: '#fff', borderColor: '#16a34a' },
  note: { fontSize: 12.5, color: 'var(--text)', lineHeight: 1.6, background: 'var(--surface2)', borderRadius: 8, padding: '8px 10px', margin: '8px 0' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '7px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', whiteSpace: 'nowrap', fontWeight: 700 },
  td: { padding: '7px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text)', verticalAlign: 'top', whiteSpace: 'nowrap' },
  chip: { display: 'inline-block', color: '#fff', fontSize: 11.5, fontWeight: 800, borderRadius: 999, padding: '2px 8px' },
  dim: { fontSize: 11, color: 'var(--text3)', marginTop: 2 },
};
