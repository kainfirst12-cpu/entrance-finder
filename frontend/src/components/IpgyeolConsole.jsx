import { useState, useEffect, useMemo } from 'react';
import { API_BASE } from '../apiBase';

const token = () => localStorage.getItem('ef_token');
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) { const e = new Error('권한/인증'); e.auth = true; throw e; }
  return res.json();
}

const ADIGA_URL = 'https://www.adiga.kr/uct/acd/ade/criteriaAndResultView.do?menuId=PCUCTACD3100';
const PIN_KEY = 'ef_ipgyeol_pins';

// SSE(keepalive) 응답 처리
async function postForResult(url, opts) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    try { return await res.json(); }
    catch { return { success: false, message: `서버 응답 오류 (HTTP ${res.status}) — 서버 업데이트 적용 중일 수 있습니다. 잠시 후 다시 시도해주세요.` }; }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) { try { result = JSON.parse(line.slice(6)); } catch {} }
    }
  }
  return result || { success: false, message: '서버 응답이 비었습니다' };
}

// 학생 기록(생기부 분석 등) 본문에서 내신 등급 찾기 — 학생 카드에 대표 내신이 없을 때만 쓰는 최후 수단.
//
// 예전 방식(기록을 전부 이어붙여 '내신…N등급'류 패턴의 첫 매치를 취함)은 수능최저 문구의 '등급 합 4'나
// 과목별 등급 같은 남의 숫자를 집어와 배치 판정을 통째로 틀어놨다. 그래서
//  ① 분석·브리핑 기록만 보고 ② 줄 단위로 신뢰도 순서대로 찾고 ③ 근거 문구를 함께 돌려준다.
const GPA_TOKEN = /(?<![\d.])([1-9](?:\.\d{1,3})?)(?![\d.])/g;
const NOISE_LINE = /수능|모의고사|모평|최저|백분위|표준점수|영역\s*등급|등급\s*합/;
const round2 = (v) => Math.round(v * 100) / 100;

function gpaTokens(line) {
  const out = [];
  for (const m of line.matchAll(GPA_TOKEN)) {
    const v = parseFloat(m[1]);
    if (v >= 1 && v <= 9) out.push({ v, decimal: m[1].includes('.') });
  }
  return out;
}

function extractGradeFromRecords(s) {
  const all = (s.records || []).filter((r) => r.content);
  const pool = all.filter((r) => ['생기부 분석', '컨설턴트 브리핑'].includes(r.type));
  const targets = pool.length ? pool : all; // 분석 기록이 없으면 어쩔 수 없이 전체
  for (const rec of targets) {
    const lines = String(rec.content).split('\n');
    // 신뢰도 순: ① "…2.69등급을 기준으로" ② 전체 합산·전 교과·최종/환산 내신 줄 ③ '내신 2.69'
    const rules = [
      (line) => {
        const m = line.match(/([1-9](?:\.\d{1,3})?)\s*등급(?:을|를)?\s*(?:기준|적용|사용)/);
        return m ? parseFloat(m[1]) : null;
      },
      (line) => {
        if (!/전체\s*합산|전\s*교과|최종\s*내신|환산\s*내신|평균\s*등급|내신\s*평균|평균\s*내신/.test(line)) return null;
        const toks = gpaTokens(line);
        const dec = toks.filter((t) => t.decimal);
        return dec.length ? dec[dec.length - 1].v : null; // 표 행이면 마지막 열(평균등급)
      },
      (line) => {
        if (!/내신/.test(line)) return null;
        const dec = gpaTokens(line).filter((t) => t.decimal);
        return dec.length ? dec[0].v : null;
      },
    ];
    for (const rule of rules) {
      for (const line of lines) {
        if (NOISE_LINE.test(line)) continue; // 수능·최저 문구에서 등급 숫자를 집지 않는다
        const v = rule(line);
        if (v != null && v >= 1 && v <= 9) {
          return { value: round2(v), snippet: line.trim().slice(0, 90), from: rec.type || '기록' };
        }
      }
    }
  }
  return null;
}

const VCOLORS = {
  '안정': { color: '#1a7f4e', bg: '#e6f6ee', border: '#bfe8d2' },
  '적정': { color: '#1d6fd6', bg: '#e8f1fc', border: '#c3dcf7' },
  '소신': { color: '#b7791f', bg: '#fdf3e2', border: '#f3ddb0' },
  '위험': { color: '#d64545', bg: '#fdeaea', border: '#f5c6c6' },
};
const vcolor = (label) => VCOLORS[label] || { color: '#5c6b7c', bg: '#f2f5f9', border: '#e3e9f1' };

// 판정: diff = 70%컷 - 학생등급 (양수 = 학생이 컷보다 좋음)
function verdict(cut, g) {
  if (cut == null) return null;
  const diff = cut - g;
  const label = diff >= 0.35 ? '안정' : diff >= -0.05 ? '적정' : diff >= -0.4 ? '소신' : '위험';
  return { label, ...VCOLORS[label] };
}

// 최근 연도 값 + 직전 연도 대비 증감
function latestWithDelta(entry, field, baseYear) {
  const ys = Object.keys(entry.years).filter((y) => y <= baseYear).sort();
  if (!ys.length) return { v: null, d: null, y: null };
  const last = ys[ys.length - 1];
  const v = entry.years[last][field];
  let d = null;
  for (let i = ys.length - 2; i >= 0; i--) {
    const pv = entry.years[ys[i]][field];
    if (pv != null && v != null) { d = Math.round((v - pv) * 100) / 100; break; }
  }
  return { v, d, y: last };
}

function Delta({ d, digits = 2 }) {
  if (d == null || d === 0) return null;
  const up = d > 0;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: up ? '#d64545' : '#1d6fd6' }}>
      {up ? '▲' : '▼'}{Math.abs(d).toFixed(digits)}
    </span>
  );
}

// 등급 70%컷 스파크라인 (낮을수록 위)
function Sparkline({ series }) {
  const pts = series.filter((p) => p.v != null);
  if (pts.length === 0) return <div style={{ ...S.sparkBox, color: '#98a4b3', fontSize: 12 }}>추이 자료 없음</div>;
  const W = 210, H = 74, PADX = 22, PADT = 18, PADB = 20;
  const vs = pts.map((p) => p.v);
  const min = Math.min(...vs), max = Math.max(...vs);
  const span = Math.max(max - min, 0.2);
  const x = (i) => PADX + (i * (W - PADX * 2)) / Math.max(series.length - 1, 1);
  const y = (v) => PADT + ((v - min) / span) * (H - PADT - PADB); // 등급 낮을수록(좋을수록) 위
  const linePts = series.map((p, i) => (p.v != null ? `${x(i)},${y(p.v)}` : null)).filter(Boolean).join(' ');
  const lastIdx = series.map((p) => p.v != null).lastIndexOf(true);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={S.sparkBox}>
      <polyline points={linePts} fill="none" stroke="#2b6fe3" strokeWidth="2" strokeLinejoin="round" />
      {series.map((p, i) => p.v != null && (
        <g key={p.year}>
          <circle cx={x(i)} cy={y(p.v)} r={i === lastIdx ? 4 : 3}
            fill={i === lastIdx ? '#2b6fe3' : '#fff'} stroke="#2b6fe3" strokeWidth="1.6" />
          <text x={x(i)} y={y(p.v) - 7} textAnchor="middle" fontSize="9.5" fontWeight={i === lastIdx ? 800 : 500} fill={i === lastIdx ? '#1d4fa8' : '#5c6b7c'}>
            {p.v.toFixed(2)}
          </text>
        </g>
      ))}
      {series.map((p, i) => (
        <text key={p.year} x={x(i)} y={H - 5} textAnchor="middle" fontSize="9" fill="#98a4b3">{p.year}</text>
      ))}
    </svg>
  );
}

// 저장용 스냅샷: 카드 핵심 수치를 기록 시점 그대로 보존
function buildSnapshot(entry, baseYear) {
  const cut = latestWithDelta(entry, 'grade70', baseYear);
  const rate = latestWithDelta(entry, 'rate', baseYear);
  const fill = latestWithDelta(entry, 'fill', baseYear);
  const recruit = latestWithDelta(entry, 'recruit', baseYear);
  const score = latestWithDelta(entry, 'score70', baseYear);
  const pct = latestWithDelta(entry, 'pct70', baseYear);
  const series = {};
  for (let y = Number(baseYear) - 3; y <= Number(baseYear); y++) {
    const v = entry.years[String(y)]?.grade70;
    if (v != null) series[y] = v;
  }
  return { cut70: cut.v, cutYear: cut.y, rate: rate.v, fill: fill.v, recruit: recruit.v, score70: score.v, pct70: pct.v, series };
}

function Card({ card, grade, baseYear, onPin, pinned, student, onSave, saving, saved, onDetail, ai }) {
  const { univ, entry, sunung, jonghapSiblings } = card;
  const yearsWindow = [];
  for (let y = Number(baseYear) - 3; y <= Number(baseYear); y++) yearsWindow.push(String(y));
  const series = yearsWindow.map((y) => ({ year: y, v: entry.years[y]?.grade70 ?? null }));

  const cut = latestWithDelta(entry, 'grade70', baseYear);
  const rate = latestWithDelta(entry, 'rate', baseYear);
  const fill = latestWithDelta(entry, 'fill', baseYear);
  const score = latestWithDelta(entry, 'score70', baseYear);
  const pct = latestWithDelta(entry, 'pct70', baseYear);
  const recruit = latestWithDelta(entry, 'recruit', baseYear);

  // 실질경쟁률(추정): 충원까지 반영한 단순 추정치 = 경쟁률 × 모집 / (모집 + 충원)
  const yd = entry.years[cut.y] || {};
  const real = yd.rate != null && yd.recruit ? Math.round((yd.rate * yd.recruit / (yd.recruit + (yd.fill || 0))) * 100) / 100 : null;

  const v = verdict(cut.v, grade);
  const lowText = sunung?.text || null;

  return (
    <div style={S.card}>
      <div style={S.cardTop}>
        <div>
          <div style={S.cardUniv}>{univ.name.replace(/\[.*\]$/, '')} <span style={S.cardRegion}>· {univ.region}</span></div>
          <div style={S.cardDept}>{entry.dept}</div>
          <div style={S.cardType}>{entry.track}({entry.typeName.replace(/^학생부(교과|종합)\(?/, '').replace(/\)$/, '') || entry.typeName})</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
          {v && <span style={{ ...S.badge, color: v.color, background: v.bg, borderColor: v.border }}>배치<br /><b style={{ fontSize: 13 }}>{v.label}</b></span>}
          {ai && (
            <span style={{ ...S.badge, color: vcolor(ai.verdict).color, background: vcolor(ai.verdict).bg, borderColor: vcolor(ai.verdict).border }}
              title={ai.reason || 'AI 종합 판정 (생기부 분석 기반)'}>
              AI<br /><b style={{ fontSize: 13 }}>{ai.verdict}</b>
            </span>
          )}
          <button style={S.pinBtn} title={pinned ? '고정 해제' : '카드 고정(다른 대학과 비교)'} onClick={() => onPin(card)}>{pinned ? '📌' : '📍'}</button>
        </div>
      </div>

      <div style={S.cutRow}>
        <span style={S.cutLabel}>{entry.track} 최종등급 70%컷 추이</span>
        <span style={S.cutValue}>{cut.v != null ? `${cut.v.toFixed(2)}등급` : '—'} <span style={S.cutYear}>({cut.y})</span></span>
      </div>
      <Sparkline series={series} />

      <div style={S.metricGrid}>
        <div style={S.metric}><div style={S.mLabel}>경쟁률</div><div style={S.mValue}>{rate.v ?? '—'} <Delta d={rate.d} /></div></div>
        <div style={S.metric}><div style={S.mLabel}>실질경쟁률(추정)</div><div style={S.mValue}>{real ?? '—'}</div></div>
        <div style={S.metric}><div style={S.mLabel}>충원인원</div><div style={S.mValue}>{fill.v != null ? `${fill.v}명` : '—'} <Delta d={fill.d} digits={0} /></div></div>
        <div style={S.metric}><div style={S.mLabel}>환산점수(70%)</div><div style={S.mValue}>{score.v ?? '—'}</div></div>
        <div style={S.metric}><div style={S.mLabel}>환산 득점률</div><div style={S.mValue}>{pct.v != null ? `${pct.v}%` : '—'} <Delta d={pct.d} digits={1} /></div></div>
        <div style={S.metric}><div style={S.mLabel}>모집인원</div><div style={S.mValue}>{recruit.v != null ? `${recruit.v}명` : '—'} <Delta d={recruit.d} digits={0} /></div></div>
      </div>

      {ai?.reason && <div style={S.aiReason}>🤖 {ai.reason}</div>}

      {jonghapSiblings?.length > 0 && (
        <div style={S.sibBox}>
          {jonghapSiblings.map((s) => {
            const sc = latestWithDelta(s, 'grade70', baseYear);
            const trend = yearsWindow.map((y) => s.years[y]?.grade70).filter((x) => x != null).map((x) => x.toFixed(1)).join(' → ');
            return (
              <div key={s.typeName} style={S.sibRow}>
                <span style={S.sibTag}>종합</span>
                <span style={S.sibName}>{s.typeName.replace(/^학생부종합\(?/, '').replace(/\)$/, '')}</span>
                <b style={S.sibCut}>{sc.v != null ? sc.v.toFixed(2) : '—'}</b>
                <span style={S.sibTrend}>{trend}</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={S.cardFoot}>
        <span style={S.lowChip} title={lowText || '수능최저 정보 없음'}>
          {lowText ? `최저 · ${lowText.slice(0, 34)}${lowText.length > 34 ? '…' : ''}` : '수능최저 정보 없음'}
        </span>
        <button style={S.srcLink} onClick={() => onDetail(card)}>더 자세한 내용</button>
      </div>
      {student && (
        <button style={{ ...S.saveBtn, ...(saved ? S.saveBtnDone : {}) }} disabled={saving || saved}
          onClick={() => onSave(card)}>
          {saving ? '저장 중…' : saved ? `✓ ${student.name} 배치 저장됨` : `💾 ${student.name} 학생에 배치 저장 (${v ? v.label : '—'})`}
        </button>
      )}
    </div>
  );
}

// 전형 상세 팝업 — 연도별 상세 표 + 전형방법 안내(어디가 입시가이드) + 수능최저 전문
function DetailModal({ card, guide, guideLoading, onClose }) {
  const { univ, entry, sunung } = card;
  const years = Object.keys(entry.years).sort();
  const fmt = (v, suffix = '') => (v == null ? '—' : `${v}${suffix}`);
  // 해당 전형구분(교과/종합)의 안내 표만 추림
  const guideTables = (guide?.tables || []).filter((t) =>
    t.some((row) => row[0] === '전형명' && row.slice(1).join(' ').includes(entry.track === '교과' ? '교과' : '종합')));
  return (
    <div style={S.mOverlay} onClick={onClose}>
      <div style={S.mBox} onClick={(e) => e.stopPropagation()}>
        <div style={S.mHead}>
          <div>
            <div style={S.cardUniv}>{univ.name.replace(/\[.*\]$/, '')} · {univ.region}</div>
            <div style={{ ...S.cardDept, fontSize: 18 }}>{entry.dept}</div>
            <div style={S.cardType}>{entry.track} · {entry.typeName}</div>
          </div>
          <button style={S.mClose} onClick={onClose}>✕</button>
        </div>

        <div style={S.mSecTitle}>연도별 입시결과</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.mTable}>
            <thead>
              <tr>
                {['연도', '모집(최초+이월)', '경쟁률', '충원', '등급 50%컷', '등급 70%컷', '환산 50%', '환산 70%', '총점', '득점률(70%)'].map((h) => (
                  <th key={h} style={S.mTh}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const d = entry.years[y];
                return (
                  <tr key={y}>
                    <td style={{ ...S.mTd, fontWeight: 800 }}>{y}</td>
                    <td style={S.mTd}>{fmt(d.recruit, '명')}{d.carry ? ` (${d.recruitFirst ?? '—'}+${d.carry})` : ''}</td>
                    <td style={S.mTd}>{fmt(d.rate, ':1')}</td>
                    <td style={S.mTd}>{fmt(d.fill, '명')}</td>
                    <td style={S.mTd}>{fmt(d.grade50)}</td>
                    <td style={{ ...S.mTd, fontWeight: 800, color: '#1d4fa8' }}>{fmt(d.grade70)}</td>
                    <td style={S.mTd}>{fmt(d.score50)}</td>
                    <td style={S.mTd}>{fmt(d.score70)}</td>
                    <td style={S.mTd}>{fmt(d.scoreTotal)}</td>
                    <td style={S.mTd}>{fmt(d.pct70, '%')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sunung?.text && (
          <>
            <div style={S.mSecTitle}>수능최저학력기준</div>
            <div style={S.mSunung}>{sunung.text}</div>
          </>
        )}

        <div style={S.mSecTitle}>전형방법 안내 (어디가 입시가이드)</div>
        {guideLoading && <div style={S.plEmpty}>안내 자료 불러오는 중…</div>}
        {!guideLoading && !guideTables.length && <div style={S.plEmpty}>이 전형구분의 안내 자료가 없습니다.</div>}
        {guideTables.map((t, i) => (
          <table key={i} style={{ ...S.mTable, marginBottom: 10 }}>
            <tbody>
              {t.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci} style={{ ...S.mTd, ...(ci === 0 ? S.mTdHead : {}), whiteSpace: 'pre-wrap' }}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ))}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
          <a href={ADIGA_URL} target="_blank" rel="noreferrer" style={S.srcLink}>어디가에서 직접 보기 ↗</a>
        </div>
      </div>
    </div>
  );
}

export default function IpgyeolConsole({ onAuthError }) {
  const [univs, setUnivs] = useState([]);
  const [q, setQ] = useState('');
  const [showSug, setShowSug] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [grade, setGrade] = useState(2.3);
  const [baseYear, setBaseYear] = useState('2026');
  const [track, setTrack] = useState('교과');
  const [deptQ, setDeptQ] = useState('');
  const [limit, setLimit] = useState(18);
  const [pins, setPins] = useState(() => { try { return JSON.parse(localStorage.getItem(PIN_KEY) || '[]'); } catch { return []; } });

  // 전형 상세 팝업
  const [detailCard, setDetailCard] = useState(null);
  const [guideCache, setGuideCache] = useState({}); // unvCd → guide
  const [guideLoading, setGuideLoading] = useState(false);

  function openDetail(card) {
    setDetailCard(card);
    const cd = card.univ.unvCd;
    if (!guideCache[cd]) {
      setGuideLoading(true);
      api(`/api/univ-info/${cd}`)
        .then((j) => { if (j.success) setGuideCache((prev) => ({ ...prev, [cd]: j.guide || { tables: [] } })); })
        .catch((e) => { if (e.auth) onAuthError?.(); })
        .finally(() => setGuideLoading(false));
    }
  }

  // 학생 연동
  const [students, setStudents] = useState([]);
  const [studentsMsg, setStudentsMsg] = useState('');
  const [student, setStudent] = useState(null);
  const [placements, setPlacements] = useState([]);
  const [savingKey, setSavingKey] = useState('');
  const [gradeSource, setGradeSource] = useState('');
  const [aiJudgments, setAiJudgments] = useState({}); // cardKey → {verdict, reason}
  const [aiJudging, setAiJudging] = useState(false);

  // 학생 자료(생기부 분석·브리핑·로드맵) — 배치 판단 근거를 콘솔 안에서 바로 확인
  const [dossier, setDossier] = useState(null);
  const [dossierOpen, setDossierOpen] = useState(false);
  const [openRecId, setOpenRecId] = useState(null);

  // AI 검색
  const [aiQ, setAiQ] = useState('');
  const [aiSearching, setAiSearching] = useState(false);
  const [aiSearch, setAiSearch] = useState(null); // {query, filter, total, results, summary, relaxed}
  const [useStudentCtx, setUseStudentCtx] = useState(true);

  useEffect(() => {
    api('/api/ipgyeol/list')
      .then((j) => { if (!j.success) throw new Error(j.error || '목록 로드 실패'); setUnivs(j.universities || []); })
      .catch((e) => { if (e.auth) onAuthError?.(); else setError(e.message); });
    api('/api/board/students')
      .then((j) => { if (j.success) setStudents(j.students || []); else setStudentsMsg(j.message || '학생 보드를 불러올 수 없습니다'); })
      .catch((e) => { if (e.auth) onAuthError?.(); else setStudentsMsg(e.message); });
  }, []);

  function selectStudent(id) {
    const s = students.find((x) => String(x.id) === String(id)) || null;
    setStudent(s); setPlacements([]); setAiJudgments({}); setGradeSource('');
    setDossier(null); setOpenRecId(null); setDossierOpen(false);
    if (!s) return;
    // 학생 자료 전체(기록 본문·로드맵)를 불러와 판단 근거로 쓴다
    api(`/api/board/students/${s.id}/context`)
      .then((j) => { if (j.success) setDossier(j); })
      .catch((e) => { if (e.auth) onAuthError?.(); });
    // 내신 반영 순서: ① 학생 카드의 대표 내신(분석 때 입력한 값) → ② 보드 학기 성적 → ③ 기록 본문 추정
    // ③은 글에서 숫자를 찾아내는 추정이라 틀릴 수 있다. 그래서 어느 문장에서 가져왔는지 함께 보여준다.
    const g = s.gpa == null || s.gpa === '' ? null : Number(s.gpa);
    const gpas = (s.grades || []).filter((x) => x.gpa != null);
    if (Number.isFinite(g) && g >= 1 && g <= 9) {
      setGrade(g);
      setGradeSource(`학생 카드의 대표 내신 ${g.toFixed(2)} 적용 (분석 입력값)`);
    } else if (gpas.length) {
      setGrade(Math.min(9, Math.max(1, Number(gpas[gpas.length - 1].gpa))));
      setGradeSource(`보드 성적(${gpas[gpas.length - 1].term})에서 내신 반영`);
    } else {
      const found = extractGradeFromRecords(s);
      if (found) {
        setGrade(found.value);
        setGradeSource(`추정: ${found.from} 본문에서 인식 — "${found.snippet}" · 다르면 직접 고쳐 주세요`);
      } else {
        setGradeSource('내신 자료 없음 — 학생 카드의 대표 내신을 채우거나 여기서 직접 입력해 주세요');
      }
    }
    api(`/api/board/students/${s.id}/placements`)
      .then((j) => { if (j.success) setPlacements(j.placements || []); })
      .catch((e) => { if (e.auth) onAuthError?.(); });
  }

  // 현재 선택된 모델의 API 키 (AI 판정·AI 검색 공용)
  function aiCreds() {
    const model = localStorage.getItem('ef_model') || 'claude';
    const group = model.startsWith('gemini') ? 'gemini' : model.startsWith('gpt') || model === 'o3' || model === 'o4-mini' ? 'gpt' : 'claude';
    const apiKey = { claude: localStorage.getItem('ef_apikey'), gemini: localStorage.getItem('ef_geminikey'), gpt: localStorage.getItem('ef_gptkey') }[group];
    return { model, group, apiKey };
  }
  const aiHeaders = ({ model, group, apiKey }) => ({
    'Content-Type': 'application/json', 'x-api-key': apiKey, 'x-ai-model': group, 'x-ai-submodel': model,
    Authorization: `Bearer ${token()}`,
  });

  // ── AI 종합 판정 (생기부 분석 기반) — list를 주면 그 카드들만 판정 ──
  async function runAiJudge(list) {
    if (!student) return;
    const source = list?.length ? list
      : (detail ? [...pins.filter((p) => p.univ.unvCd === detail.unvCd), ...unpinnedCards] : []);
    const visible = source.slice(0, 12);
    if (!visible.length) { setError('판정할 카드가 없습니다. 대학을 선택하거나 AI 검색을 먼저 실행하세요.'); return; }
    const creds = aiCreds();
    if (!creds.apiKey) { setError('설정에서 AI API 키를 먼저 입력해 주세요.'); return; }
    // 최신 생기부 분석 기록 발췌 — 자료 패널을 불러왔으면 본문 전체가 있는 쪽을 쓴다
    const pool = dossier?.records?.length ? dossier.records : (student.records || []);
    const analysisRec = pool.find((r) => r.type === '생기부 분석' && r.content)
      || pool.find((r) => r.type === '컨설턴트 브리핑' && r.content) || pool.find((r) => r.content);
    setAiJudging(true); setError('');
    try {
      const d = await postForResult(`${API_BASE}/api/ipgyeol/judge`, {
        method: 'POST',
        headers: aiHeaders(creds),
        body: JSON.stringify({
          studentProfile: {
            name: student.name, school: student.school, grade: student.grade, major: student.major,
            gpa: grade, analysisExcerpt: analysisRec?.content || '',
          },
          cards: visible.map((c) => {
            const snap = buildSnapshot(c.entry, baseYear);
            return { key: c.key, univ: c.univ.name, dept: c.entry.dept, track: c.entry.track, typeName: c.entry.typeName,
              cut70: snap.cut70, cutYear: snap.cutYear, trend: snap.series, rate: snap.rate, fill: snap.fill, recruit: snap.recruit,
              sunung: c.sunung?.text?.slice(0, 150) || null };
          }),
        }),
      });
      if (!d.success) throw new Error(d.message || 'AI 판정 실패');
      const map = {};
      d.judgments.forEach((j) => { map[j.key] = { verdict: j.verdict, reason: j.reason || '' }; });
      setAiJudgments((prev) => ({ ...prev, ...map }));
    } catch (e) { setError('AI 판정 오류: ' + e.message); }
    finally { setAiJudging(false); }
  }

  // ── AI 검색: 자연어 질문 → 전 대학 입결 통합 검색 ──
  // 서버가 질문을 필터로 바꾼 뒤 원본 입결에서 직접 골라내므로, 카드에 표시되는 숫자는 전부 공식 자료 값이다.
  async function runAiSearch(qOverride) {
    const q = String(qOverride ?? aiQ).trim();
    if (!q || aiSearching) return;
    const creds = aiCreds();
    if (!creds.apiKey) { setError('설정에서 AI API 키를 먼저 입력해 주세요.'); return; }
    setAiQ(q); setAiSearching(true); setError('');
    try {
      const body = { query: q, baseYear, limit: 24 };
      if (student && useStudentCtx) {
        body.studentProfile = { name: student.name, gpa: grade, major: student.major || '', targetUniv: student.target_univ || '' };
      }
      const d = await postForResult(`${API_BASE}/api/ipgyeol/ai-search`, {
        method: 'POST', headers: aiHeaders(creds), body: JSON.stringify(body),
      });
      if (!d.success) throw new Error(d.message || 'AI 검색 실패');
      setAiSearch({ ...d, query: q });
    } catch (e) { setError('AI 검색 오류: ' + e.message); }
    finally { setAiSearching(false); }
  }

  // 해석된 필터를 사람이 읽는 칩으로 (AI가 뭘로 알아들었는지 보이지 않으면 결과를 믿을 수 없다)
  function filterChips(f = {}) {
    const out = [];
    if (f.capitalOnly) out.push('수도권');
    (f.regions || []).forEach((r) => out.push(r));
    (f.univKeywords || []).forEach((r) => out.push(`대학: ${r}`));
    (f.deptKeywords || []).forEach((r) => out.push(`학과: ${r}`));
    (f.excludeKeywords || []).forEach((r) => out.push(`제외: ${r}`));
    (f.tracks || []).forEach((r) => out.push(`${r}전형`));
    (f.typeKeywords || []).forEach((r) => out.push(`전형명: ${r}`));
    if (f.targetGrade != null) out.push(`기준 내신 ${Number(f.targetGrade).toFixed(2)}`);
    (f.verdicts || []).forEach((r) => out.push(`판정 ${r}`));
    if (f.gradeMin != null || f.gradeMax != null) out.push(`70%컷 ${f.gradeMin ?? ''}~${f.gradeMax ?? ''}`);
    if (f.rateMax != null) out.push(`경쟁률 ≤${f.rateMax}`);
    if (f.rateMin != null) out.push(`경쟁률 ≥${f.rateMin}`);
    if (f.recruitMin != null) out.push(`모집 ≥${f.recruitMin}명`);
    if (f.trend === 'easing') out.push('컷 완화 추세');
    if (f.trend === 'tightening') out.push('컷 상승 추세');
    if (f.sunung === 'none') out.push('수능최저 없음');
    if (f.sunung === 'required') out.push('수능최저 있음');
    const sortLabel = { fit: '내신 근접순', cut: '상위권순', easy: '여유순', rate: '경쟁률 낮은순', recruit: '모집 많은순', trend: '완화순' }[f.sortBy];
    if (sortLabel) out.push(`정렬: ${sortLabel}`);
    return out;
  }

  async function savePlacement(card) {
    if (!student) return;
    setSavingKey(card.key);
    try {
      const snap = buildSnapshot(card.entry, baseYear);
      const ai = aiJudgments[card.key];
      if (ai) { snap.aiVerdict = ai.verdict; snap.aiReason = ai.reason; }
      const v = verdict(snap.cut70, grade);
      // 같은 (대학·학과·전형) 기존 기록은 덮어쓰기
      const dup = placements.find((p) => p.unv_cd === card.univ.unvCd && p.dept === card.entry.dept
        && p.track === card.entry.track && p.type_name === card.entry.typeName);
      if (dup) await api(`/api/board/placements/${dup.id}`, { method: 'DELETE' });
      const j = await api(`/api/board/students/${student.id}/placements`, { method: 'POST', body: {
        unvCd: card.univ.unvCd, univName: card.univ.name, region: card.univ.region,
        dept: card.entry.dept, track: card.entry.track, typeName: card.entry.typeName,
        baseYear, grade, verdict: v ? v.label : '', snapshot: snap,
      } });
      if (!j.success) throw new Error(j.message || '저장 실패');
      setPlacements((prev) => [j.placement, ...prev.filter((p) => p.id !== dup?.id)]);
    } catch (e) {
      if (e.auth) onAuthError?.(); else setError(`배치 저장 실패: ${e.message}`);
    } finally { setSavingKey(''); }
  }

  async function removePlacement(p) {
    try {
      const j = await api(`/api/board/placements/${p.id}`, { method: 'DELETE' });
      if (j.success) setPlacements((prev) => prev.filter((x) => x.id !== p.id));
    } catch (e) { if (e.auth) onAuthError?.(); }
  }

  function openUniv(u) {
    setSelected(u); setDetail(null); setLoading(true); setError(''); setQ(u.name); setShowSug(false); setLimit(18);
    api(`/api/ipgyeol/${u.unvCd}`)
      .then((j) => { if (!j.success) throw new Error(j.error); setDetail(j); })
      .catch((e) => { if (e.auth) onAuthError?.(); else setError(e.message); })
      .finally(() => setLoading(false));
  }

  const nfc = (s) => (s || '').normalize('NFC');
  const suggestions = useMemo(() => {
    const t = nfc(q.trim());
    if (!t) return univs.slice(0, 12);
    return univs.filter((u) => nfc(u.name).includes(t) || nfc(u.region).includes(t)).slice(0, 12);
  }, [q, univs]);

  // 수능최저: 전형구분 키워드가 들어간 안내문 선택
  const sunungFor = (d, tr) => d?.sunung?.find((s) => s.track.includes(tr)) || null;

  const cards = useMemo(() => {
    if (!detail) return [];
    const t = nfc(deptQ.trim());
    const byDept = new Map();
    detail.entries.forEach((e) => {
      if (!byDept.has(e.dept)) byDept.set(e.dept, []);
      byDept.get(e.dept).push(e);
    });
    const out = [];
    for (const e of detail.entries) {
      if (e.track !== track) continue;
      if (t && !nfc(e.dept).includes(t) && !nfc(e.typeName).includes(t)) continue;
      if (!Object.keys(e.years).some((y) => y <= baseYear && y > String(Number(baseYear) - 4))) continue;
      const sibs = track === '교과'
        ? (byDept.get(e.dept) || [])
            .filter((s) => s.track === '종합' && Object.values(s.years).some((y) => y.grade70 != null))
            .sort((a, b) => Object.keys(b.years).length - Object.keys(a.years).length)
            .slice(0, 2)
        : [];
      out.push({
        key: `${detail.unvCd}|${e.dept}|${e.track}|${e.typeName}`,
        univ: { unvCd: detail.unvCd, name: detail.name, region: detail.region },
        entry: e, sunung: sunungFor(detail, track), jonghapSiblings: sibs,
      });
    }
    out.sort((a, b) => a.entry.dept.localeCompare(b.entry.dept, 'ko'));
    return out;
  }, [detail, track, deptQ, baseYear]);

  function togglePin(card) {
    setPins((prev) => {
      const next = prev.some((p) => p.key === card.key) ? prev.filter((p) => p.key !== card.key) : [...prev, card];
      try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  const pinnedKeys = new Set(pins.map((p) => p.key));
  const unpinnedCards = cards.filter((c) => !pinnedKeys.has(c.key));

  // 현재 내신·기준연도로 이미 저장된 카드인지 (변경 시 다시 저장 가능)
  const isSaved = (c) => placements.some((p) => p.unv_cd === c.univ.unvCd && p.dept === c.entry.dept
    && p.track === c.entry.track && p.type_name === c.entry.typeName
    && Number(p.grade) === grade && p.base_year === baseYear);

  return (
    <div style={S.page}>
      <div style={S.shell}>
        <h2 style={S.h2}>입결 콘솔 — 어디가 공식 입결을 컨설팅 화면으로</h2>
        <p style={S.lead}>
          대학어디가 공식 입결(경쟁률·충원·최종등급/환산점수 70%컷)의 <b>2021~2026 다개년 추이</b>를 학생 내신과
          비교해 한 카드로 보여줍니다. 수능최저·원문 링크까지 담은 고도화 화면입니다.
        </p>

        <div style={S.tileRow}>
          <div style={S.tile}><div style={S.tileHead}>지표 폭</div><div style={S.tileMain}>6개 지표 × 교과·종합</div><div style={S.tileSub}>경쟁률·실질(추정)·충원·70%컷·환산·모집</div></div>
          <div style={S.tile}><div style={S.tileHead}>시계열</div><div style={S.tileMain}>최대 6개년 추이</div><div style={S.tileSub}>기준연도별 4개년 스파크라인</div></div>
          <div style={S.tile}><div style={S.tileHead}>신뢰·근거</div><div style={S.tileMain}>출처·표기 있음</div><div style={S.tileSub}>어디가 공식 발표자료 + 원문 링크</div></div>
        </div>

        {/* AI 검색 — 자연어로 전 대학 입결을 가로질러 찾는다 */}
        <div style={S.aiBox}>
          <div style={S.aiHead}>
            <span style={S.aiTitle}>🔎 AI 검색</span>
            <span style={S.aiSub}>전국 216개 대학 · 학과×전형 약 7만 건에서 조건에 맞는 후보를 찾아 카드로 보여줍니다</span>
            {student && (
              <label style={S.aiChk}>
                <input type="checkbox" checked={useStudentCtx} onChange={(e) => setUseStudentCtx(e.target.checked)} />
                {student.name} 학생 기준(내신 {grade.toFixed(2)})으로 검색
              </label>
            )}
          </div>
          <div style={S.aiInputRow}>
            <textarea style={S.aiInput} value={aiQ} rows={2} disabled={aiSearching}
              placeholder="예) 수도권 간호학과 중 내신 3.0으로 적정·안정인 교과전형 찾아줘 / 작년보다 컷이 내려간 서울 공대 종합전형"
              onChange={(e) => setAiQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAiSearch(); } }} />
            <button style={{ ...S.aiRunBtn, ...(aiSearching ? S.aiRunBusy : {}) }} onClick={() => runAiSearch()} disabled={aiSearching || !aiQ.trim()}>
              {aiSearching ? '검색 중…' : 'AI 검색'}
            </button>
          </div>
          <div style={S.exRow}>
            {[
              '수도권 간호학과 중 내신 3.0으로 적정·안정인 교과전형',
              '수능최저 없는 서울 종합전형 중 2.5등급대',
              '경쟁률 낮고 모집인원 20명 이상인 지방 공대 교과',
              '작년보다 컷이 완화된 경기권 경영·경제 학과',
            ].map((ex) => (
              <button key={ex} style={S.exChip} onClick={() => runAiSearch(ex)} disabled={aiSearching}>{ex}</button>
            ))}
          </div>
        </div>

        {/* 컨트롤 바 */}
        <div style={S.controls}>
          <div style={S.ctrlGroup}>
            <span style={S.ctrlLabel}>학생 배정 <span style={S.ctrlHint}>(보드의 학생과 연결)</span></span>
            <select style={S.select} value={student?.id || ''} onChange={(e) => selectStudent(e.target.value)}
              disabled={!students.length} title={studentsMsg}>
              <option value="">{students.length ? '학생 선택 안 함' : (studentsMsg || '학생 없음')}</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.school ? ` · ${s.school}` : ''}{s.grades?.length ? ` · 내신 ${s.grades[s.grades.length - 1].gpa ?? '—'}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div style={S.ctrlGroup}>
            <span style={S.ctrlLabel}>학생 내신 등급 <span style={S.ctrlHint}>(최종등급 70%컷 대비)</span></span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="range" min="1" max="6" step="0.05" value={Math.min(6, grade)}
                onChange={(e) => setGrade(Number(e.target.value))} style={{ width: 170, accentColor: '#2b6fe3' }} />
              <input type="number" min="1" max="9" step="0.01" value={grade}
                onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setGrade(Math.min(9, Math.max(1, v))); }}
                style={S.gradeInput} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#5c6b7c' }}>등급</span>
            </div>
            {gradeSource && <span style={{ fontSize: 11, color: '#8492a5', maxWidth: 360, lineHeight: 1.5, wordBreak: 'break-all' }}>{gradeSource}</span>}
          </div>
          <div style={S.ctrlGroup}>
            <span style={S.ctrlLabel}>기준 연도</span>
            <div style={S.segRow}>
              {['2024', '2025', '2026'].map((y) => (
                <button key={y} onClick={() => setBaseYear(y)} style={{ ...S.segBtn, ...(baseYear === y ? S.segOn : {}) }}>{y}</button>
              ))}
            </div>
          </div>
          <div style={S.ctrlGroup}>
            <span style={S.ctrlLabel}>전형</span>
            <div style={S.segRow}>
              {['교과', '종합'].map((tr) => (
                <button key={tr} onClick={() => setTrack(tr)} style={{ ...S.segBtn, ...(track === tr ? S.segOn : {}) }}>{tr}</button>
              ))}
            </div>
          </div>
        </div>

        {/* 대학/학과 검색 */}
        <div style={S.searchRow}>
          <div style={{ position: 'relative', flex: '0 0 300px' }}>
            <input style={S.input} value={q} placeholder="대학명·지역 검색 (예: 중앙대, 서울)"
              onChange={(e) => { setQ(e.target.value); setShowSug(true); }}
              onFocus={() => setShowSug(true)} />
            {showSug && suggestions.length > 0 && (
              <div style={S.sugBox}>
                {suggestions.map((u) => (
                  <button key={u.unvCd} style={S.sugItem} onClick={() => openUniv(u)}>
                    {u.name} <span style={S.sugMeta}>{u.region} · 학과 {u.deptCount} · {u.years[0]}~{u.years[u.years.length - 1]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <input style={{ ...S.input, flex: '0 0 220px' }} value={deptQ} onChange={(e) => setDeptQ(e.target.value)}
            placeholder="학과·전형명 필터 (예: AI, 간호)" />
          {selected && <span style={S.selInfo}>{selected.name} · {track} 카드 {cards.length}개</span>}
        </div>

        {error && <div style={S.error}>⚠ {error}</div>}

        {/* AI 검색 결과 */}
        {aiSearch && (
          <div style={S.aiResBox}>
            <div style={S.aiResHead}>
              <b style={{ fontSize: 14 }}>“{aiSearch.query}”</b>
              <span style={S.plCount}>매칭 {aiSearch.total}건 · 표시 {aiSearch.results.length}건</span>
              {student && (
                <button style={S.aiBtn} onClick={() => runAiJudge(aiSearch.results)} disabled={aiJudging}>
                  {aiJudging ? '🤖 AI 판정 중…' : '🤖 이 결과를 생기부 기반으로 판정'}
                </button>
              )}
              <button style={S.plDel} title="검색 결과 닫기" onClick={() => setAiSearch(null)}>✕</button>
            </div>
            {aiSearch.filter?.intent && <div style={S.aiIntent}>해석: {aiSearch.filter.intent}</div>}
            <div style={S.chipRow}>
              {filterChips(aiSearch.filter).map((c) => <span key={c} style={S.fchip}>{c}</span>)}
            </div>
            {aiSearch.relaxed?.length > 0 && (
              <div style={S.relaxNote}>조건이 너무 좁아 결과가 없어 {aiSearch.relaxed.join(' · ')} 조건을 풀고 다시 검색했습니다.</div>
            )}
            {aiSearch.summary && <div style={S.aiSummary}>{aiSearch.summary}</div>}
            {!aiSearch.results.length && <div style={S.plEmpty}>조건에 맞는 전형이 없습니다. 지역·등급 범위를 넓혀 다시 물어보세요.</div>}
            {aiSearch.results.length > 0 && (
              <div style={S.grid}>
                {aiSearch.results.map((c) => (
                  <Card key={`ai-${c.key}`} card={c} grade={grade} baseYear={baseYear} onPin={togglePin}
                    pinned={pinnedKeys.has(c.key)} student={student} onSave={savePlacement}
                    saving={savingKey === c.key} saved={isSaved(c)} onDetail={openDetail} ai={aiJudgments[c.key]} />
                ))}
              </div>
            )}
            <div style={S.aiFoot}>표시된 수치는 모두 어디가 공식 입결 원본에서 직접 읽은 값입니다. AI는 조건 해석과 요약만 담당합니다.</div>
          </div>
        )}

        {/* 학생 자료 패널 — 배치 판단의 근거를 콘솔 안에서 확인 */}
        {student && dossier && (
          <div style={S.plBox}>
            <div style={S.plHead}>
              📁 {student.name} 학생 자료
              <span style={S.plCount}>
                기록 {dossier.records.length}건 · 성적 {dossier.grades.length}건 · 로드맵 {dossier.roadmaps.length}건
              </span>
              <button style={S.aiBtn} onClick={() => setDossierOpen((v) => !v)}>{dossierOpen ? '접기' : '펼쳐 보기'}</button>
              {dossier.grades.length > 0 && (
                <span style={S.plHint}>내신 추이 {dossier.grades.map((g) => `${g.term} ${g.gpa ?? '-'}`).join(' · ')}</span>
              )}
            </div>
            {dossierOpen && (
              <>
                <div style={S.dossierMeta}>
                  {dossier.student.school || '학교 미입력'} · {dossier.student.grade || '학년 미입력'} · 희망 {dossier.student.major || '미입력'} · 목표 {dossier.student.target_univ || '미입력'}
                  {dossier.student.notes ? ` · 메모: ${dossier.student.notes}` : ''}
                </div>
                {dossier.roadmaps.map((r) => {
                  const done = r.items.filter((i) => i.done).length;
                  return (
                    <div key={r.id} style={S.dossierRoad}>
                      🗺 {r.title} — {done}/{r.items.length} 완료
                      {r.items.filter((i) => !i.done).slice(0, 4).map((i) => <span key={i.id} style={S.roadChip}>{i.title}</span>)}
                    </div>
                  );
                })}
                {!dossier.records.length && <div style={S.plEmpty}>저장된 기록이 없습니다. 생기부 분석·상담 기록을 먼저 쌓아주세요.</div>}
                {dossier.records.map((r) => (
                  <div key={r.id} style={S.recRow}>
                    <button style={S.recHead} onClick={() => setOpenRecId(openRecId === r.id ? null : r.id)}>
                      <span style={S.recType}>{r.type || '기록'}</span>
                      <span style={S.recTitle}>{r.title || '(제목 없음)'}</span>
                      <span style={S.recDate}>{String(r.created_at).slice(0, 10)}</span>
                      <span style={S.recToggle}>{openRecId === r.id ? '▲' : '▼'}</span>
                    </button>
                    {openRecId === r.id && <div style={S.recBody}>{r.content || '(본문 없음)'}</div>}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* 학생 배치 기록 */}
        {student && (
          <div style={S.plBox}>
            <div style={S.plHead}>
              🎯 {student.name} 학생의 배치 기록 <span style={S.plCount}>({placements.length}건)</span>
              <button style={S.aiBtn} onClick={() => runAiJudge()} disabled={aiJudging || !detail}
                title="학생의 생기부 분석 내용과 카드의 입결 데이터를 종합해 AI가 학과별 배치를 판정합니다">
                {aiJudging ? '🤖 AI 판정 중…' : '🤖 생기부 기반 AI 종합 판정'}
              </button>
              <span style={S.plHint}>카드의 💾 버튼으로 추가 · 내신 슬라이더를 움직이면 현재 기준 재평가가 표시됩니다</span>
            </div>
            {!placements.length && <div style={S.plEmpty}>아직 저장된 배치가 없습니다. 아래 카드에서 💾 버튼으로 저장하세요.</div>}
            {['안정', '적정', '소신', '위험', ''].map((vl) => {
              const group = placements.filter((p) => (vl === '' ? !['안정', '적정', '소신', '위험'].includes(p.verdict) : p.verdict === vl));
              if (!group.length) return null;
              return (
                <div key={vl} style={{ marginBottom: 6 }}>
                  {group.map((p) => {
                    const snap = p.snapshot || {};
                    const savedV = verdict(snap.cut70, Number(p.grade));
                    const nowV = verdict(snap.cut70, grade);
                    const changed = nowV && savedV && nowV.label !== savedV.label;
                    return (
                      <div key={p.id} style={S.plRow}>
                        {savedV && <span style={{ ...S.plChip, color: savedV.color, background: savedV.bg, borderColor: savedV.border }}>{savedV.label}</span>}
                        {snap.aiVerdict && (
                          <span style={{ ...S.plChip, color: vcolor(snap.aiVerdict).color, background: vcolor(snap.aiVerdict).bg, borderColor: vcolor(snap.aiVerdict).border }}
                            title={snap.aiReason || ''}>AI {snap.aiVerdict}</span>
                        )}
                        <span style={S.plName}>
                          <b>{p.univ_name.replace(/\[.*\]$/, '')}</b> {p.dept} <span style={S.plType}>{p.track}({(p.type_name || '').replace(/^학생부(교과|종합)\(?/, '').replace(/\)$/, '')})</span>
                        </span>
                        <span style={S.plMeta}>
                          70%컷 {snap.cut70 != null ? Number(snap.cut70).toFixed(2) : '—'}({snap.cutYear || p.base_year}) ·
                          저장 내신 {p.grade != null ? Number(p.grade).toFixed(2) : '—'} · {String(p.created_at).slice(0, 10)}
                        </span>
                        {changed && (
                          <span style={{ ...S.plChip, color: nowV.color, background: nowV.bg, borderColor: nowV.border }}>
                            현재 {grade.toFixed(2)} 기준 → {nowV.label}
                          </span>
                        )}
                        <button style={S.plDel} title="배치 기록 삭제" onClick={() => removePlacement(p)}>✕</button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* 고정 카드 */}
        {pins.length > 0 && (
          <>
            <div style={S.pinHead}>📌 고정 카드 (대학 간 비교)</div>
            <div style={S.grid}>
              {pins.map((c) => (
                <Card key={c.key} card={c} grade={grade} baseYear={baseYear} onPin={togglePin} pinned
                  student={student} onSave={savePlacement} saving={savingKey === c.key} saved={isSaved(c)} onDetail={openDetail}
                  ai={aiJudgments[c.key]} />
              ))}
            </div>
          </>
        )}

        {!selected && !pins.length && (
          <div style={S.placeholder}>위 검색창에서 대학을 선택하면 학과별 입결 카드가 표시됩니다.<br />
            <span style={{ fontSize: 12.5, color: '#98a4b3' }}>카드의 📍 버튼으로 고정하면 다른 대학과 나란히 비교할 수 있습니다.</span></div>
        )}
        {loading && <div style={S.placeholder}>입결 자료 불러오는 중…</div>}

        {detail && (
          <div style={S.grid}>
            {unpinnedCards.slice(0, limit).map((c) => (
              <Card key={c.key} card={c} grade={grade} baseYear={baseYear} onPin={togglePin} pinned={false}
                student={student} onSave={savePlacement} saving={savingKey === c.key} saved={isSaved(c)} onDetail={openDetail}
                ai={aiJudgments[c.key]} />
            ))}
          </div>
        )}
        {detail && unpinnedCards.length > limit && (
          <button style={S.moreBtn} onClick={() => setLimit((l) => l + 18)}>더 보기 ({unpinnedCards.length - limit}개 남음)</button>
        )}
        {detail && !unpinnedCards.length && !loading && (
          <div style={S.placeholder}>조건에 맞는 학과 카드가 없습니다. 전형(교과/종합)이나 필터를 바꿔보세요.</div>
        )}

        {detailCard && (
          <DetailModal card={detailCard} guide={guideCache[detailCard.univ.unvCd]}
            guideLoading={guideLoading} onClose={() => setDetailCard(null)} />
        )}

        <p style={S.footNote}>
          출처: 대학어디가(한국대학교육협의회) 공식 발표 입시결과. 2021~2025는 발표자료 취합본, 2026은 어디가 대학별
          입시결과 서비스 수집분입니다. ‘실질경쟁률(추정)’은 충원인원을 반영한 단순 추정치이며, ‘환산 득점률’은
          환산점수 70%컷 ÷ 학생부 총점입니다. 배치 판정(안정·적정·소신·위험)은 70%컷과 입력 내신의 차이에 따른
          참고용 지표로, 실제 지원 판단은 반영교과·최저·모집인원 변화를 함께 검토해야 합니다.
        </p>
      </div>
    </div>
  );
}

const S = {
  page: { padding: '18px 20px 26px' },
  shell: { background: '#f2f5f9', borderRadius: 18, padding: '24px 26px 18px', color: '#26313e' },
  h2: { fontSize: 22, fontWeight: 800, margin: '0 0 6px', color: '#1c2733' },
  lead: { color: '#5c6b7c', fontSize: 13, margin: '0 0 16px', lineHeight: 1.6 },
  tileRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginBottom: 14 },
  tile: { background: '#fff', border: '1px solid #e3e9f1', borderRadius: 12, padding: '12px 14px' },
  tileHead: { fontSize: 11.5, fontWeight: 700, color: '#8492a5', marginBottom: 4 },
  tileMain: { fontSize: 14.5, fontWeight: 800, color: '#1d4fa8' },
  tileSub: { fontSize: 11.5, color: '#8492a5', marginTop: 3 },
  aiBox: { background: 'linear-gradient(180deg,#f7f4ff 0%,#fff 100%)', border: '1px solid #ddd2f5', borderRadius: 14, padding: '13px 16px 12px', marginBottom: 12 },
  aiHead: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 9 },
  aiTitle: { fontSize: 14.5, fontWeight: 800, color: '#5b3fb8' },
  aiSub: { fontSize: 11.5, color: '#8492a5' },
  aiChk: { marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: '#5b3fb8', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' },
  aiInputRow: { display: 'flex', gap: 9, alignItems: 'stretch' },
  aiInput: { flex: 1, minWidth: 0, border: '1px solid #d7cdf0', borderRadius: 10, padding: '9px 12px', fontSize: 13.5, lineHeight: 1.55, background: '#fff', color: '#26313e', outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  aiRunBtn: { flex: '0 0 108px', border: 'none', background: '#6b46c1', color: '#fff', borderRadius: 10, fontSize: 13.5, fontWeight: 800, cursor: 'pointer' },
  aiRunBusy: { background: '#b9a8e6', cursor: 'default' },
  exRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  exChip: { border: '1px solid #e0d8f5', background: '#fff', color: '#6b46c1', borderRadius: 20, padding: '4px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' },
  aiResBox: { background: '#fff', border: '1px solid #ddd2f5', borderRadius: 14, padding: '13px 15px 10px', marginBottom: 14 },
  aiResHead: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 7 },
  aiIntent: { fontSize: 12, color: '#5c6b7c', marginBottom: 7 },
  chipRow: { display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 },
  fchip: { fontSize: 11, fontWeight: 700, color: '#4a3a7a', background: '#f2edfc', border: '1px solid #e0d8f5', borderRadius: 7, padding: '2px 8px' },
  relaxNote: { fontSize: 11.5, color: '#8a6d1f', background: '#fdf7e3', border: '1px solid #f0e6b8', borderRadius: 8, padding: '6px 10px', marginBottom: 8 },
  aiSummary: { fontSize: 12.8, lineHeight: 1.75, color: '#26313e', background: '#f8f6fe', border: '1px solid #e8e2f8', borderRadius: 10, padding: '11px 13px', marginBottom: 10, whiteSpace: 'pre-wrap' },
  aiFoot: { fontSize: 10.5, color: '#98a4b3', marginTop: 2 },
  dossierMeta: { fontSize: 12, color: '#5c6b7c', padding: '2px 0 8px' },
  dossierRoad: { fontSize: 12, color: '#3d4a5c', background: '#f7f9fc', border: '1px solid #eef2f7', borderRadius: 8, padding: '6px 9px', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  roadChip: { fontSize: 11, color: '#5c6b7c', background: '#fff', border: '1px solid #e3e9f1', borderRadius: 6, padding: '1px 7px' },
  recRow: { borderBottom: '1px solid #f2f5f9' },
  recHead: { display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'transparent', padding: '7px 2px', cursor: 'pointer', textAlign: 'left' },
  recType: { fontSize: 10.5, fontWeight: 800, color: '#1d4fa8', background: '#e8f1fc', border: '1px solid #c3dcf7', borderRadius: 6, padding: '1px 7px', whiteSpace: 'nowrap' },
  recTitle: { fontSize: 12.5, color: '#26313e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  recDate: { fontSize: 11, color: '#98a4b3' },
  recToggle: { fontSize: 10, color: '#98a4b3' },
  recBody: { fontSize: 12.5, lineHeight: 1.8, color: '#3d4a5c', background: '#f7f9fc', border: '1px solid #eef2f7', borderRadius: 8, padding: '10px 12px', margin: '2px 0 9px', maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre-wrap' },
  controls: { display: 'flex', flexWrap: 'wrap', gap: 22, alignItems: 'flex-end', background: '#fff', border: '1px solid #e3e9f1', borderRadius: 12, padding: '12px 16px', marginBottom: 12 },
  ctrlGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  ctrlLabel: { fontSize: 12, fontWeight: 700, color: '#3d4a5c' },
  ctrlHint: { fontWeight: 500, color: '#98a4b3', fontSize: 11 },
  gradeNum: { fontSize: 20, fontWeight: 800, color: '#1d4fa8', minWidth: 74 },
  segRow: { display: 'flex', gap: 6 },
  select: { border: '1px solid #d7dfea', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: '#fff', color: '#26313e', minWidth: 190, maxWidth: 260 },
  saveBtn: { marginTop: 8, border: '1px solid #c3dcf7', background: '#e8f1fc', color: '#1d4fa8', borderRadius: 9, padding: '7px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  saveBtnDone: { background: '#e6f6ee', border: '1px solid #bfe8d2', color: '#1a7f4e', cursor: 'default' },
  plBox: { background: '#fff', border: '1px solid #e3e9f1', borderRadius: 12, padding: '12px 14px', marginBottom: 14 },
  plHead: { fontSize: 13.5, fontWeight: 800, color: '#1c2733', marginBottom: 8, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  plCount: { fontSize: 12, color: '#8492a5', fontWeight: 600 },
  plHint: { fontSize: 11, color: '#98a4b3', fontWeight: 500 },
  plEmpty: { fontSize: 12.5, color: '#8492a5', padding: '6px 2px' },
  plRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', borderBottom: '1px solid #f2f5f9', fontSize: 12.5, flexWrap: 'wrap' },
  plChip: { fontSize: 11, fontWeight: 800, borderWidth: 1, borderStyle: 'solid', borderRadius: 7, padding: '2px 8px', whiteSpace: 'nowrap' },
  plName: { color: '#26313e' },
  plType: { color: '#8492a5', fontSize: 11.5 },
  plMeta: { color: '#98a4b3', fontSize: 11.5 },
  plDel: { marginLeft: 'auto', border: 'none', background: 'transparent', color: '#c2cbd8', cursor: 'pointer', fontSize: 13, padding: '0 4px' },
  aiBtn: { border: '1px solid #c9b8f0', background: '#f4effc', color: '#6b46c1', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  aiReason: { marginTop: 7, fontSize: 11.5, color: '#6b46c1', background: '#f4effc', border: '1px solid #e5dcf7', borderRadius: 8, padding: '5px 9px', lineHeight: 1.5 },
  segBtn: { border: '1px solid #d7dfea', background: '#fff', color: '#3d4a5c', borderRadius: 8, padding: '6px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  segOn: { background: '#2b6fe3', border: '1px solid #2b6fe3', color: '#fff' },
  searchRow: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 },
  input: { width: '100%', boxSizing: 'border-box', border: '1px solid #d7dfea', borderRadius: 9, padding: '9px 12px', fontSize: 13.5, background: '#fff', color: '#26313e', outline: 'none' },
  sugBox: { position: 'absolute', top: '110%', left: 0, right: 0, zIndex: 30, background: '#fff', border: '1px solid #d7dfea', borderRadius: 10, boxShadow: '0 8px 22px rgba(20,40,80,0.13)', maxHeight: 290, overflowY: 'auto' },
  sugItem: { display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: '1px solid #eef2f7', background: 'transparent', fontSize: 13, color: '#26313e', cursor: 'pointer' },
  sugMeta: { color: '#98a4b3', fontSize: 11.5 },
  selInfo: { fontSize: 12.5, color: '#5c6b7c', fontWeight: 600 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(258px, 1fr))', gap: 12, marginBottom: 12 },
  card: { background: '#fff', border: '1px solid #e3e9f1', borderRadius: 14, padding: '14px 15px 12px', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 4px rgba(20,40,80,0.05)' },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  cardUniv: { fontSize: 12, fontWeight: 700, color: '#5c6b7c' },
  cardRegion: { fontWeight: 500, color: '#98a4b3' },
  cardDept: { fontSize: 16.5, fontWeight: 800, color: '#1c2733', margin: '2px 0 1px', lineHeight: 1.25 },
  cardType: { fontSize: 11.5, color: '#8492a5' },
  badge: { textAlign: 'center', fontSize: 10, fontWeight: 700, lineHeight: 1.25, borderWidth: 1, borderStyle: 'solid', borderRadius: 8, padding: '3px 8px' },
  pinBtn: { border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 15, padding: 0 },
  cutRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 4 },
  cutLabel: { fontSize: 11, color: '#8492a5', fontWeight: 600 },
  cutValue: { fontSize: 15.5, fontWeight: 800, color: '#1d4fa8' },
  cutYear: { fontSize: 11, color: '#8492a5', fontWeight: 600 },
  sparkBox: { width: '100%', height: 74, background: '#f7fafd', border: '1px solid #eef2f7', borderRadius: 10, margin: '6px 0 8px', display: 'block' },
  metricGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 },
  metric: { background: '#f7f9fc', border: '1px solid #eef2f7', borderRadius: 8, padding: '6px 8px' },
  mLabel: { fontSize: 10, color: '#8492a5', fontWeight: 600, marginBottom: 2, whiteSpace: 'nowrap' },
  mValue: { fontSize: 13.5, fontWeight: 800, color: '#26313e', whiteSpace: 'nowrap' },
  sibBox: { marginTop: 8, borderTop: '1px dashed #e3e9f1', paddingTop: 7, display: 'flex', flexDirection: 'column', gap: 4 },
  sibRow: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 },
  sibTag: { fontSize: 10, fontWeight: 700, color: '#7a5fd0', background: '#f1edfc', borderRadius: 5, padding: '1px 6px' },
  sibName: { color: '#5c6b7c', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sibCut: { color: '#7a5fd0', fontSize: 13 },
  sibTrend: { color: '#98a4b3', fontSize: 11 },
  cardFoot: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 9 },
  lowChip: { fontSize: 10.5, fontWeight: 600, color: '#7a6a25', background: '#fbf6df', border: '1px solid #f0e6b8', borderRadius: 7, padding: '3px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  srcLink: { fontSize: 11.5, fontWeight: 700, color: '#1a7f4e', background: '#e6f6ee', border: '1px solid #bfe8d2', borderRadius: 7, padding: '3px 9px', textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer' },
  gradeInput: { width: 72, border: '1px solid #d7dfea', borderRadius: 8, padding: '6px 8px', fontSize: 16, fontWeight: 800, color: '#1d4fa8', background: '#fff', textAlign: 'center' },
  mOverlay: { position: 'fixed', inset: 0, background: 'rgba(15,25,40,0.55)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  mBox: { background: '#fff', borderRadius: 16, padding: '20px 22px', maxWidth: 860, width: '100%', maxHeight: '86vh', overflowY: 'auto', boxShadow: '0 18px 50px rgba(10,20,40,0.35)', color: '#26313e' },
  mHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  mClose: { border: 'none', background: '#f2f5f9', color: '#5c6b7c', borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 14 },
  mSecTitle: { fontSize: 13, fontWeight: 800, color: '#1c2733', margin: '16px 0 8px', paddingTop: 10, borderTop: '1px solid #eef2f7' },
  mTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  mTh: { background: '#f2f5f9', color: '#3d4a5c', fontWeight: 700, border: '1px solid #e3e9f1', padding: '6px 8px', whiteSpace: 'nowrap' },
  mTd: { border: '1px solid #e3e9f1', padding: '6px 8px', color: '#26313e' },
  mTdHead: { background: '#f7f9fc', fontWeight: 700, color: '#3d4a5c', whiteSpace: 'nowrap' },
  mSunung: { background: '#fbf6df', border: '1px solid #f0e6b8', borderRadius: 9, padding: '9px 12px', fontSize: 12.5, lineHeight: 1.7, color: '#5c5322' },
  pinHead: { fontSize: 13, fontWeight: 800, color: '#3d4a5c', margin: '2px 0 8px' },
  placeholder: { background: '#fff', border: '1px dashed #d7dfea', borderRadius: 12, padding: '38px 20px', textAlign: 'center', color: '#5c6b7c', fontSize: 14, lineHeight: 1.7, marginBottom: 12 },
  moreBtn: { display: 'block', margin: '0 auto 10px', border: '1px solid #d7dfea', background: '#fff', color: '#1d4fa8', borderRadius: 9, padding: '8px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  error: { background: '#fdeaea', border: '1px solid #f5c6c6', color: '#b33', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12 },
  footNote: { fontSize: 11, color: '#98a4b3', lineHeight: 1.6, margin: '6px 2px 0' },
};
