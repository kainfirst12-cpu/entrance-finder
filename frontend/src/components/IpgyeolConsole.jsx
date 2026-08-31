import { useState, useEffect, useMemo, useRef } from 'react';
import { API_BASE } from '../apiBase';
import VerifyPanel from './VerifyPanel';

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
const REPORT_KEY = 'ef_ipgyeol_report'; // 리포트 제목·총평 등 편집값 (상담 때마다 다시 쓰지 않게 남긴다)

// 합격선 백분위 — 어디가가 발표하는 항목만. 40%·20%컷은 발표된 적이 없어 존재하지 않는다.
// 50%·70%는 대부분의 전형에 있고, 85·90·100%는 제출한 대학이 극소수다(전체의 0~5%).
const CUT_FIELD = { 50: 'grade50', 70: 'grade70', 85: 'grade85', 90: 'grade90', 100: 'grade100' };
const CUT_OPTS = [50, 70, 90, 100];
const cutField = (pct) => CUT_FIELD[pct] || 'grade70';

const DEFAULT_NOTE = `배치 판정(안정·적정·소신·위험)은 최종등급 70%컷과 기준 내신의 차이에 따른 참고용 지표입니다. 실제 지원 판단은 반영교과·수능최저·모집인원 변화를 함께 검토해야 합니다.
올해 신설된 전형은 누적 입시결과가 존재하지 않아 이 리포트에 포함되지 않습니다.`;

const DEFAULT_REPORT = {
  title: '입결 분석 리포트',
  lead: '2021~2026 다개년 입시결과 기반 지원 후보 검토',
  author: '패스파인더 에듀 입시분석팀',
  dateText: '',       // 비우면 오늘 날짜
  comment: '',        // 컨설턴트 총평
  showPlacements: true,
  showSearch: true,
  showCards: true,
  showWhy: true,       // 카드마다 유리한 점·불리한 점·리스크(자동 산출)
  showAnalysis: true,  // AI 심층 분석(생성했을 때만)
  note: DEFAULT_NOTE,
};

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

// ⚠ 우리가 자동으로 쓴 '입결 배치 보고서'는 여기서 읽지 않는다.
//   그 글에는 "현재 내신 2.30"이 적히는데, 그건 우리가 방금 쓴 값이다. 그걸 다시 근거로 삼으면
//   원장이 슬라이더로 고친 값을 옛 보고서의 숫자가 되돌리고, 근거 표시도 '분석 본문에서 인식'이
//   되어 어디서 온 값인지 알 수 없게 된다 — 자기가 쓴 글을 자기가 읽는 순환이라 끊는다.
const isAutoReport = (r) => String(r?.title || '').startsWith('입결 배치 보고서');

function extractGradeFromRecords(s) {
  const all = (s.records || []).filter((r) => r.content && !isAutoReport(r));
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

// ── 지원 시 유의사항(SKYPASS) — 서버가 대학·전형·학과로 이미 매칭해 보낸다 ──
// scaleWarning: 그 대학 입결 등급이 '자체 환산'이라 학생의 일반 등급과 같은 자가 아니라는 뜻.
// 이 카드에서는 아래 verdict(배치 판정)가 성립하지 않는다 — 숨기지 말고 그렇다고 말해야 한다.
function skypassFor(detail, entry) {
  const sk = detail?.skypass;
  if (!sk) return null;
  const notes = sk.byEntry?.[`${entry.track}|${entry.typeName}|${entry.dept}`] || [];
  if (!sk.scaleWarning && !notes.length) return null;
  return { scaleWarning: !!sk.scaleWarning, univNotes: sk.univNotes || [], notes };
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

// ── 카드 한 장의 "왜 유리한가 / 왜 불리한가 / 어디가 리스크인가" ──
// AI 없이 원본 입결만으로 계산한다. 상담 자리에서 근거를 물었을 때 숫자로 답할 수 있어야 하고,
// AI 키가 없거나 호출이 실패해도 리포트에는 근거가 남아 있어야 하기 때문이다.
function cardSignals(card, grade, baseYear, cutPct = 70) {
  const e = card.entry;
  const CF = cutField(cutPct);
  const P = `${cutPct}%컷`;
  const pros = [], cons = [], risks = [];
  const ys = Object.keys(e.years).filter((y) => y <= baseYear).sort();
  const cut = latestWithDelta(e, CF, baseYear);
  const rate = latestWithDelta(e, 'rate', baseYear);
  const fill = latestWithDelta(e, 'fill', baseYear);
  const rec = latestWithDelta(e, 'recruit', baseYear);
  const g = grade.toFixed(2);

  // ① 내신과 합격선의 거리 — 판정의 뼈대
  if (cut.v != null) {
    const diff = Math.round((cut.v - grade) * 100) / 100;
    const dz = Math.abs(diff).toFixed(2);
    if (diff >= 0.35) pros.push(`내신 ${g}이 ${cut.y}년 ${P} ${cut.v.toFixed(2)}보다 ${dz}등급 앞섭니다 — 합격선 위 여유가 뚜렷합니다.`);
    else if (diff >= -0.05) pros.push(`내신 ${g}이 ${P} ${cut.v.toFixed(2)}과 ${dz}등급 차이 — 합격선 언저리의 경쟁권입니다.`);
    else if (diff >= -0.4) cons.push(`내신이 ${cut.y}년 ${P} ${cut.v.toFixed(2)}보다 ${dz}등급 부족합니다 — 상향 지원 구간입니다.`);
    else cons.push(`내신이 ${P} ${cut.v.toFixed(2)}보다 ${dz}등급 부족합니다 — 통상적인 지원선 밖입니다.`);
  } else {
    risks.push(`${P}이 공개되지 않은 전형입니다 — 경쟁률·충원 흐름만으로 판단해야 합니다.`);
  }

  // ② 합격선 추이 — 올해 판정이 한 단계 밀릴지의 예고
  const series = ys.map((y) => ({ y, v: e.years[y][CF] })).filter((p) => p.v != null);
  if (series.length >= 2) {
    const a = series[0], b = series[series.length - 1];
    const d = Math.round((b.v - a.v) * 100) / 100;
    if (d >= 0.1) pros.push(`합격선이 ${a.y}년 ${a.v.toFixed(2)} → ${b.y}년 ${b.v.toFixed(2)}로 ${d.toFixed(2)}등급 내려왔습니다(완화 추세).`);
    else if (d <= -0.1) cons.push(`합격선이 ${a.y}년 ${a.v.toFixed(2)} → ${b.y}년 ${b.v.toFixed(2)}로 ${Math.abs(d).toFixed(2)}등급 올라왔습니다(상승 추세) — 올해도 오르면 판정이 한 단계 밀립니다.`);
    else pros.push(`합격선이 ${a.y}~${b.y}년 ${Math.abs(d).toFixed(2)}등급 안에서 움직여 예측 가능성이 높습니다.`);
  } else if (series.length === 1) {
    risks.push(`${P} 자료가 ${series[0].y}년 한 해뿐입니다 — 추세를 볼 수 없어 판정의 근거가 얇습니다.`);
  }

  // ③ 경쟁률·충원 — 서류상 경쟁률과 실제 합격선은 다르다
  if (rate.v != null && rate.d != null) {
    if (rate.d <= -0.5) pros.push(`경쟁률이 직전 대비 ${Math.abs(rate.d).toFixed(2)} 낮아진 ${rate.v}:1입니다.`);
    else if (rate.d >= 0.5) cons.push(`경쟁률이 직전 대비 ${rate.d.toFixed(2)} 오른 ${rate.v}:1 — 지원자가 몰리는 흐름입니다.`);
  }
  if (fill.v != null && rec.v) {
    const pct = Math.round((fill.v / rec.v) * 100);
    if (pct >= 50) pros.push(`충원 ${fill.v}명으로 모집 ${rec.v}명의 ${pct}%가 추가합격 — 실질 합격선은 ${P}보다 아래로 내려갑니다.`);
    else if (pct <= 10) cons.push(`충원이 ${fill.v}명(모집 대비 ${pct}%)에 그칩니다 — 최초 합격선이 사실상 마지노선입니다.`);
  }

  // ④ 모집 규모 — 늘면 문이 넓어지고, 적으면 컷이 흔들린다
  if (rec.d != null && rec.v != null) {
    if (rec.d >= 3) pros.push(`모집인원이 직전 대비 ${rec.d}명 늘어 ${rec.v}명입니다 — 선발 폭이 넓어졌습니다.`);
    else if (rec.d <= -3) cons.push(`모집인원이 ${Math.abs(rec.d)}명 줄어 ${rec.v}명입니다 — 합격선 상승 요인입니다.`);
  }
  if (rec.v != null && rec.v <= 5) risks.push(`모집 ${rec.v}명의 소수 선발입니다 — 지원자 몇 명 차이로 합격선이 크게 흔들립니다.`);

  // ⑤ 자료의 시차 — 몇 년 전 숫자로 올해를 판단하고 있는지 밝힌다
  if (cut.y && String(cut.y) !== String(baseYear)) {
    risks.push(`가장 최근 공개 자료가 ${cut.y}년입니다 — ${baseYear} 기준 판단에 ${Number(baseYear) - Number(cut.y)}년의 시차가 있습니다.`);
  }

  // ⑥ 수능최저 — 내신이 되고도 떨어지는 자리
  if (card.sunung?.text) {
    risks.push(`수능최저가 적용되는 전형입니다 — 충족 여부가 실질 관문입니다(${card.sunung.text.replace(/\s+/g, ' ').slice(0, 60)}…).`);
  } else {
    cons.push('안내문에서 수능최저 조건이 확인되지 않습니다 — 최저 탈락 위험은 낮지만 그만큼 내신 경쟁이 치열합니다.');
  }

  // ⑦ 같은 학과 종합전형과의 문턱 차이
  const sib = card.jonghapSiblings?.[0];
  if (sib && cut.v != null) {
    const sc = latestWithDelta(sib, CF, baseYear);
    if (sc.v != null) {
      const gap = Math.round((sc.v - cut.v) * 100) / 100;
      if (gap >= 0.15) pros.push(`같은 학과 종합전형 ${P}은 ${sc.v.toFixed(2)}로 교과보다 ${gap.toFixed(2)}등급 낮은 내신도 합격했습니다 — 생기부가 강하면 종합 병행이 유리합니다.`);
      else if (gap <= -0.15) cons.push(`같은 학과 종합전형 ${P} ${sc.v.toFixed(2)}가 교과보다 ${Math.abs(gap).toFixed(2)}등급 높습니다 — 종합으로 돌리면 문턱이 더 높습니다.`);
    }
  }

  // ⑧ 지원 시 유의사항 — 숫자만 보고는 알 수 없는 것들. 다른 신호보다 먼저 읽혀야 하므로 맨 앞에 둔다.
  const sk = card.skypass;
  if (sk?.scaleWarning) {
    risks.unshift(`이 대학 입결 등급은 **대학 자체 환산등급**입니다 — 내 일반 등급(${g})과 같은 자로 잰 값이 아니라, 위 배치 판정을 그대로 믿으면 안 됩니다.`);
  }
  for (const n of (sk?.notes || [])) {
    const t = n.note.replace(/\s*\/\s*/g, ' · ');
    if (n.tags?.includes('notRecommended')) risks.unshift(`지원 시 유의: ${t}`);
    else if (n.tags?.includes('volatility') || n.tags?.includes('minimum')) risks.push(`지원 시 유의: ${t}`);
    else cons.push(`지원 시 유의: ${t}`);
  }

  return { pros, cons, risks };
}

// 저장용 스냅샷: 카드 핵심 수치를 기록 시점 그대로 보존.
// cut70은 예전 기록과 호환을 위해 항상 70%컷을 담고, 다른 백분위로 보고 있었다면 cutSel에 함께 남긴다.
// (읽는 쪽은 snapCut()으로 꺼낸다 — 옛 기록은 cutPct가 없어 70으로 읽힌다)
function buildSnapshot(entry, baseYear, cutPct = 70) {
  const cut = latestWithDelta(entry, 'grade70', baseYear);
  const sel = latestWithDelta(entry, cutField(cutPct), baseYear);
  const rate = latestWithDelta(entry, 'rate', baseYear);
  const fill = latestWithDelta(entry, 'fill', baseYear);
  const recruit = latestWithDelta(entry, 'recruit', baseYear);
  const score = latestWithDelta(entry, 'score70', baseYear);
  const pct = latestWithDelta(entry, 'pct70', baseYear);
  const series = {};
  for (let y = Number(baseYear) - 3; y <= Number(baseYear); y++) {
    const v = entry.years[String(y)]?.[cutField(cutPct)];
    if (v != null) series[y] = v;
  }
  return { cut70: cut.v, cutYear: cut.y, cutPct, cutSel: sel.v, cutSelYear: sel.y,
    rate: rate.v, fill: fill.v, recruit: recruit.v, score70: score.v, pct70: pct.v, series };
}

// 저장된 배치의 합격선 — 어느 백분위로 저장했든 그 값과 라벨을 그대로 읽는다
const snapCut = (s = {}) => ({
  pct: s.cutPct || 70,
  v: s.cutPct && s.cutSel != null ? s.cutSel : s.cut70,
  year: s.cutPct && s.cutSel != null ? (s.cutSelYear || s.cutYear) : s.cutYear,
});

function Card({ card, grade, baseYear, cutPct, onPin, pinned, student, onSave, saving, saved, onDetail, ai }) {
  const { univ, entry, sunung, jonghapSiblings } = card;
  const CF = cutField(cutPct);
  const yearsWindow = [];
  for (let y = Number(baseYear) - 3; y <= Number(baseYear); y++) yearsWindow.push(String(y));
  const series = yearsWindow.map((y) => ({ year: y, v: entry.years[y]?.[CF] ?? null }));

  const cut = latestWithDelta(entry, CF, baseYear);
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
          {v && (
            <span style={{ ...S.badge, color: v.color, background: v.bg, borderColor: v.border, ...(card.skypass?.scaleWarning ? { opacity: 0.55 } : {}) }}
              title={card.skypass?.scaleWarning ? '이 대학은 자체 환산등급이라 이 판정을 그대로 믿으면 안 됩니다' : undefined}>
              배치<br /><b style={{ fontSize: 13 }}>{v.label}</b>
            </span>
          )}
          {card.skypass?.scaleWarning && (
            <span style={S.scaleWarnBadge} title={card.skypass.univNotes.map((n) => n.note).join(' / ')}>
              ⚠ 환산등급<br /><b style={{ fontSize: 10 }}>직접 비교 불가</b>
            </span>
          )}
          {ai && (
            <span style={{ ...S.badge, color: vcolor(ai.verdict).color, background: vcolor(ai.verdict).bg, borderColor: vcolor(ai.verdict).border }}
              title={ai.reason || 'AI 종합 판정 (생기부 분석 기반)'}>
              AI<br /><b style={{ fontSize: 13 }}>{ai.verdict}</b>
            </span>
          )}
          <button style={S.pinBtn} title={pinned ? '고정 해제' : '카드 고정(다른 대학과 비교)'} onClick={() => onPin(card)}>{pinned ? '📌' : '📍'}</button>
        </div>
      </div>

      {card.skypass && (card.skypass.scaleWarning || card.skypass.notes.length > 0) && (
        <div style={S.skypassBox}>
          <div style={S.skypassHead}>📌 지원 시 유의사항</div>
          {card.skypass.scaleWarning && card.skypass.univNotes.map((n, i) => (
            <div key={`u${i}`} style={S.skypassWarn}>{n.note}</div>
          ))}
          {/* 위에 이미 나온 문장은 빼고 — 대학 경고와 전형별 유의사항에 같은 말이 겹친다 */}
          {card.skypass.notes
            .filter((n) => !(card.skypass.scaleWarning && card.skypass.univNotes.some((u) => u.note === n.note)))
            .filter((n, i, arr) => arr.findIndex((x) => x.note === n.note) === i)
            .map((n, i) => (
              <div key={i} style={S.skypassItem}>
                {n.scope === 'type' && <span style={S.skypassScope}>전형 전체</span>}
                {n.note}
              </div>
            ))}
        </div>
      )}

      <div style={S.cutRow}>
        <span style={S.cutLabel}>{entry.track} 최종등급 {cutPct}%컷 추이</span>
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
            const sc = latestWithDelta(s, CF, baseYear);
            const trend = yearsWindow.map((y) => s.years[y]?.[CF]).filter((x) => x != null).map((x) => x.toFixed(1)).join(' → ');
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
  const EXTRA = [
    { key: 'grade80', label: '등급 80%컷' }, { key: 'grade85', label: '등급 85%컷' },
    { key: 'grade90', label: '등급 90%컷' }, { key: 'grade100', label: '등급 100%컷' },
    { key: 'gradeAvg', label: '등급 평균' },
  ];
  const extraCuts = EXTRA.filter((x) => years.some((y) => entry.years[y][x.key] != null));
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

        {/* 85·90·100%컷과 평균등급은 제출한 대학이 드물다 — 값이 있는 전형에서만 열을 만든다 */}
        <div style={S.mSecTitle}>연도별 입시결과</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.mTable}>
            <thead>
              <tr>
                {['연도', '모집(최초+이월)', '경쟁률', '충원', '등급 50%컷', '등급 70%컷',
                  ...extraCuts.map((x) => x.label), '환산 50%', '환산 70%', '총점', '득점률(70%)'].map((h) => (
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
                    {extraCuts.map((x) => <td key={x.key} style={S.mTd}>{fmt(d[x.key])}</td>)}
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

// 리포트에 실을 항목 한 줄 (체크 + 코멘트).
// ReportModal 안에 두면 렌더마다 새 컴포넌트가 되어 입력 중 포커스가 튄다 — 반드시 바깥에 둔다.
function RepItem({ k, name, sub, off, memo, onToggle, onMemo }) {
  return (
    <div style={S.rpItem}>
      <label style={S.rpItemHead}>
        <input type="checkbox" checked={!off} onChange={() => onToggle(k)} />
        <span style={{ ...S.rpItemName, ...(off ? S.rpItemDim : {}) }}>{name}</span>
        <span style={S.rpItemSub}>{sub}</span>
      </label>
      <input style={S.rpMemo} value={memo} onChange={(e) => onMemo(k, e.target.value)} disabled={off}
        placeholder="이 항목에 덧붙일 코멘트 (리포트 비고란에 들어갑니다)" />
    </div>
  );
}

// 입결 리포트 편집창 — 인쇄 전에 제목·총평·포함 항목·항목별 코멘트를 직접 손본다.
// 상담 자리에서 내미는 종이라 매번 뺄 항목과 덧붙일 말이 다르다. 그래서 고정된 양식으로 뽑지 않는다.
function ReportModal({ rep, setRep, off, setOff, memo, setMemo, placements, aiSearch, cards, student, grade, baseYear,
  analysis, analyzing, analysisMsg, onAnalyze, assigningReport, assignedReport, onAssign, onClose, onPrint,
  verifyText, verifyContext, records = [], recOn, onToggleRec }) {
  const setF = (k) => (e) => setRep((r) => ({ ...r, [k]: e.target.value }));
  const setC = (k) => (e) => setRep((r) => ({ ...r, [k]: e.target.checked }));
  const onMemo = (k, v) => setMemo((m) => ({ ...m, [k]: v }));
  const onToggle = (k) => setOff((o) => ({ ...o, [k]: !o[k] }));
  const countOn = (keys) => keys.filter((k) => !off[k]).length;
  const itemProps = (k) => ({ k, off: !!off[k], memo: memo[k] || '', onToggle, onMemo });

  const plKeys = placements.map((p) => `pl-${p.id}`);
  const srKeys = (aiSearch?.results || []).map((c, i) => `sr-${i}-${c.key}`);
  const cdKeys = cards.map((c) => `cd-${c.key}`);

  return (
    <div style={S.mOverlay} onClick={onClose}>
      <div style={{ ...S.mBox, maxWidth: 780 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.mHead}>
          <div>
            <div style={{ ...S.cardDept, fontSize: 18 }}>입결 리포트 편집</div>
            <div style={S.cardType}>
              {student ? `${student.name} 학생 · ` : ''}기준 내신 {grade.toFixed(2)} · 기준 연도 {baseYear}
            </div>
          </div>
          <button style={S.mClose} onClick={onClose}>✕</button>
        </div>

        <div style={S.rpSec}>표지</div>
        <div style={S.rpGrid}>
          <label style={S.rpField}><span style={S.rpLabel}>리포트 제목</span>
            <input style={S.rpInput} value={rep.title} onChange={setF('title')} placeholder="입결 분석 리포트" /></label>
          <label style={S.rpField}><span style={S.rpLabel}>부제 · 한 줄 설명</span>
            <input style={S.rpInput} value={rep.lead} onChange={setF('lead')} placeholder="다개년 입시결과 기반 지원 후보 검토" /></label>
          <label style={S.rpField}><span style={S.rpLabel}>작성</span>
            <input style={S.rpInput} value={rep.author} onChange={setF('author')} placeholder="패스파인더 에듀 입시분석팀" /></label>
          <label style={S.rpField}><span style={S.rpLabel}>작성일 <span style={S.ctrlHint}>(비우면 오늘 날짜)</span></span>
            <input style={S.rpInput} value={rep.dateText} onChange={setF('dateText')} placeholder="2026년 8월 5일" /></label>
        </div>

        <div style={S.rpSec}>컨설턴트 총평 <span style={S.ctrlHint}>(리포트 맨 앞에 들어갑니다. 비우면 표시하지 않습니다)</span></div>
        <textarea style={S.rpArea} rows={5} value={rep.comment} onChange={setF('comment')}
          placeholder="예) 현재 내신 1.36 기준으로 지방 의약계열 교과전형은 적정~소신 구간입니다. 6장 중 2장은 안정 카드로 채우기를 권합니다." />

        <div style={S.rpSec}>분석 깊이 <span style={S.ctrlHint}>(리포트에 "왜 유리한지·왜 불리한지·어디가 리스크인지"를 넣습니다)</span></div>
        <label style={S.rpChk}><input type="checkbox" checked={rep.showWhy} onChange={setC('showWhy')} />
          카드별 판단 근거 자동 산출 <span style={S.ctrlHint}>(내신 여유·합격선 추이·경쟁률·충원율·모집 변화·자료 시차·수능최저 — AI 없이 입결 원본에서 계산)</span></label>
        <div style={S.rpAnalyBox}>
          <div style={S.rpAnalyRow}>
            <button style={{ ...S.rpAnaly, ...(analyzing ? S.rpAnalyBusy : {}) }} onClick={onAnalyze} disabled={analyzing}>
              {analyzing ? '🤖 심층 분석 중…' : analysis ? '🤖 심층 분석 다시 생성' : '🤖 AI 심층 분석 생성'}
            </button>
            <label style={{ ...S.rpChk, opacity: analysis ? 1 : 0.45 }}>
              <input type="checkbox" checked={rep.showAnalysis} onChange={setC('showAnalysis')} disabled={!analysis} />
              리포트에 포함
            </label>
            <span style={S.rpAnalyMsg}>{analysisMsg || '생기부·내신과 카드 지표를 함께 읽어 카드별 유리·불리·리스크와 6장 전체 전략을 문장으로 씁니다.'}</span>
          </div>
          {analysis?.overall && (
            <div style={S.rpAnalyPrev}>
              <b>{analysis.overall.headline || '종합 분석'}</b>
              <div>{analysis.overall.summary}</div>
              {analysis.overall.strategy && <div style={{ marginTop: 5 }}><b>지원 전략</b> {analysis.overall.strategy}</div>}
              {(analysis.overall.risks || []).length > 0 && (
                <div style={{ marginTop: 5 }}><b>전체 리스크</b> {analysis.overall.risks.join(' · ')}</div>
              )}
            </div>
          )}
        </div>

        <div style={S.rpSec}>포함할 내용</div>
        <div style={S.rpToggles}>
          <label style={S.rpChk}><input type="checkbox" checked={rep.showPlacements} onChange={setC('showPlacements')} />
            저장된 배치 기록 <span style={S.ctrlHint}>({countOn(plKeys)}/{plKeys.length}건)</span></label>
          <label style={S.rpChk}><input type="checkbox" checked={rep.showSearch} onChange={setC('showSearch')} disabled={!aiSearch} />
            AI 검색 후보 검토 <span style={S.ctrlHint}>({countOn(srKeys)}/{srKeys.length}건)</span></label>
          <label style={S.rpChk}><input type="checkbox" checked={rep.showCards} onChange={setC('showCards')} />
            전형 카드별 분석 <span style={S.ctrlHint}>({countOn(cdKeys)}/{cdKeys.length}건)</span></label>
        </div>

        {records.length > 0 && (
          <>
            <div style={S.rpSec}>학생 기록 첨부
              <span style={S.ctrlHint}> (교차 검증·반영까지 끝낸 글을 리포트 본문에 그대로 싣습니다)</span></div>
            {records.map((r) => (
              <label key={r.id} style={S.rpRecRow}>
                <input type="checkbox" checked={recOn.has(r.id)} onChange={() => onToggleRec(r.id)} />
                <span style={S.recType}>{r.type || '기록'}</span>
                <span style={S.rpRecTitle}>{r.title || '(제목 없음)'}</span>
                <span style={S.ctrlHint}>{String(r.created_at).slice(0, 10)} · {(r.content || '').length.toLocaleString()}자</span>
              </label>
            ))}
          </>
        )}

        {rep.showPlacements && placements.length > 0 && (
          <>
            <div style={S.rpSec}>배치 기록 — 뺄 항목은 체크를 풀어주세요</div>
            {placements.map((p) => {
              const s = p.snapshot || {};
              return <RepItem key={p.id} {...itemProps(`pl-${p.id}`)}
                name={`${(p.univ_name || '').replace(/\[.*\]$/, '')} ${p.dept}`}
                sub={`${p.track}(${p.type_name || '-'}) · ${snapCut(s).pct}%컷 ${snapCut(s).v != null ? Number(snapCut(s).v).toFixed(2) : '—'} · ${p.verdict || '판정 없음'}`} />;
            })}
          </>
        )}

        {rep.showSearch && (aiSearch?.results || []).length > 0 && (
          <>
            <div style={S.rpSec}>AI 검색 후보</div>
            {aiSearch.results.map((c, i) => (
              <RepItem key={`${i}-${c.key}`} {...itemProps(`sr-${i}-${c.key}`)}
                name={`${c.univ.name.replace(/\[.*\]$/, '')} ${c.entry.dept}`}
                sub={`${c.entry.track}(${c.entry.typeName}) · 70%컷 ${c.match?.cut70 ?? '—'} · ${c.match?.verdict || '판정 없음'}`} />
            ))}
          </>
        )}

        {rep.showCards && cards.length > 0 && (
          <>
            <div style={S.rpSec}>전형 카드</div>
            {cards.map((c) => (
              <RepItem key={c.key} {...itemProps(`cd-${c.key}`)}
                name={`${c.univ.name.replace(/\[.*\]$/, '')} ${c.entry.dept}`}
                sub={`${c.entry.track}(${c.entry.typeName}) · ${c.univ.region}`} />
            ))}
          </>
        )}

        <div style={S.rpSec}>하단 안내 문구</div>
        <textarea style={S.rpArea} rows={3} value={rep.note} onChange={setF('note')} />

        {/* 인쇄해서 학부모에게 내밀기 전에 한 번 거른다 — 나간 뒤에는 고칠 수 없다 */}
        <div style={S.rpSec}>내보내기 전 확인 <span style={S.ctrlHint}>(다른 회사 AI들이 이 리포트를 읽고 틀린 곳을 짚습니다)</span></div>
        <VerifyPanel kind="ipgyeol" text={verifyText} context={verifyContext} />

        <div style={S.rpFoot}>
          <button style={S.rpReset} onClick={() => { setRep({ ...DEFAULT_REPORT }); setOff({}); setMemo({}); }}>기본값으로 되돌리기</button>
          <span style={S.rpHint}>인쇄 창에서도 “✏ 직접 수정”을 켜면 글자를 바로 고칠 수 있습니다</span>
          <button style={S.rpCancel} onClick={onClose}>닫기</button>
          <button style={{ ...S.rpAssign, ...(assignedReport ? S.rpAssignDone : {}) }} onClick={onAssign}
            disabled={!student || assigningReport || assignedReport}
            title={student ? '지금 보이는 그대로(뺀 항목·코멘트·분석 포함) 학생 기록으로 저장합니다. 상담·브리핑·AI가 근거로 읽습니다.'
              : '학생을 먼저 선택하세요'}>
            {assigningReport ? '배정 중…' : assignedReport ? `✓ ${student?.name} 기록에 저장됨`
              : `📋 ${student ? `${student.name} 학생` : '학생'} 기록으로 배정`}
          </button>
          <button style={S.rpGo} onClick={onPrint}>🖨 리포트 열기</button>
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
  const [cutPct, setCutPct] = useState(70); // 기준 합격선 백분위
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
  // 기록 고치기 — AI가 만들어 둔 검색·분석 기록의 제목·본문을 이 자리에서 바로 손본다.
  // (여기서만 읽고 고치러 보드로 건너가면, 카드를 보며 판단하던 흐름이 끊긴다)
  const [editRec, setEditRec] = useState(null);   // { id, title, content }
  const [recBusy, setRecBusy] = useState(false);

  async function saveRecord() {
    if (!editRec) return;
    setRecBusy(true);
    try {
      const j = await api(`/api/board/records/${editRec.id}`, {
        method: 'PUT', body: { title: editRec.title, content: editRec.content },
      });
      if (!j.success) { alert(j.error || j.message || '저장하지 못했습니다'); return; }
      setDossier((d) => (!d ? d : {
        ...d,
        records: d.records.map((r) => (r.id === editRec.id
          ? { ...r, title: editRec.title, content: editRec.content } : r)),
      }));
      setEditRec(null);
    } catch (e) {
      if (e.auth) onAuthError?.(); else alert(e.message || '저장하지 못했습니다');
    } finally { setRecBusy(false); }
  }

  // 교차 검증에서 고쳐 쓴 글을 기록 본문에 반영한다 — 지적을 손으로 옮겨 적다 빠뜨리지 않게.
  async function applyToRecord(r, newContent) {
    const j = await api(`/api/board/records/${r.id}`, {
      method: 'PUT', body: { title: r.title || '', content: newContent },
    });
    if (!j.success) throw new Error(j.error || j.message || '저장하지 못했습니다');
    setDossier((d) => (!d ? d : {
      ...d, records: d.records.map((x) => (x.id === r.id ? { ...x, content: newContent } : x)),
    }));
  }

  // 검토자에게 함께 넘길 '근거 자료'. 이게 없으면 모델은 글만 보고 트집을 잡는다 —
  // 무엇에 비추어 틀렸는지 말하게 하려면 원본을 같이 줘야 한다.
  function verifyContextFor() {
    const d = dossier;
    const lines = [];
    if (d?.student) {
      const st = d.student;
      lines.push(`[학생] ${st.name || ''} · ${st.school || '학교 미입력'} · ${st.grade || '학년 미입력'}`
        + ` · 희망 ${st.major || '미입력'} · 목표 ${st.target_univ || '미입력'}`);
    }
    if (Number.isFinite(grade)) lines.push(`[현재 기준 내신] ${grade.toFixed(2)} (${gradeSource || '수동 입력'})`);
    if (d?.grades?.length) lines.push(`[학기 성적] ${d.grades.map((g) => `${g.term} ${g.gpa ?? '-'}`).join(' · ')}`);
    if (placements.length) {
      lines.push('[저장된 배치]');
      for (const pl of placements.slice(0, 12)) {
        const sc = snapCut(pl.snapshot || {});
        lines.push(`- ${pl.univ_name || ''} ${pl.dept} / ${pl.track}(${pl.type_name || '-'})`
          + ` · ${sc.pct}%컷 ${sc.v ?? '-'}${sc.year ? `(${sc.year})` : ''} · 판정 ${pl.verdict || '-'}`);
      }
    }
    return lines.join('\n');
  }

  async function removeRecord(r) {
    if (!confirm(`'${r.title || '(제목 없음)'}' 기록을 삭제할까요?\n\n되돌릴 수 없습니다.`)) return;
    setRecBusy(true);
    try {
      const j = await api(`/api/board/records/${r.id}`, { method: 'DELETE' });
      if (j.success === false) { alert(j.error || j.message || '삭제하지 못했습니다'); return; }
      setDossier((d) => (!d ? d : { ...d, records: d.records.filter((x) => x.id !== r.id) }));
      if (openRecId === r.id) setOpenRecId(null);
      if (editRec?.id === r.id) setEditRec(null);
    } catch (e) {
      if (e.auth) onAuthError?.(); else alert(e.message || '삭제하지 못했습니다');
    } finally { setRecBusy(false); }
  }

  // 배치 저장 카드 — 학생에게 배치되면 고정(📌)하지 않아도 카드가 뜬다
  const [univCache, setUnivCache] = useState({}); // unvCd → detail
  const [placementCards, setPlacementCards] = useState([]);
  // 배치가 바뀌면 보고서를 다시 쓴다는 표시. state 로 두면 카드 복원 이펙트와 같은 렌더에서
  // 경합해 **방금 저장한 카드만 유의사항 없이** 기록되므로, 카드 복원이 끝나는 그 자리에서
  // 직접 소비한다(ref).
  const pendingReportRef = useRef(false);
  const [plCardsLoading, setPlCardsLoading] = useState(false);

  // 리포트 편집
  const [reportOpen, setReportOpen] = useState(false);
  // 리포트에 통째로 실을 학생 기록(교차 검증까지 끝낸 입결 분석 글 등).
  // 기록은 6만 자짜리도 있어서 '고르지 않으면 안 들어간다'로 둔다 — 기본 포함은 사고가 난다.
  const [repRecOn, setRepRecOn] = useState(() => new Set());
  const [rep, setRep] = useState(() => {
    try { return { ...DEFAULT_REPORT, ...JSON.parse(localStorage.getItem(REPORT_KEY) || '{}') }; }
    catch { return { ...DEFAULT_REPORT }; }
  });
  const [repOff, setRepOff] = useState({});   // 리포트에서 뺀 항목 (기본은 전부 포함)
  const [repMemo, setRepMemo] = useState({}); // 항목별 코멘트
  useEffect(() => { try { localStorage.setItem(REPORT_KEY, JSON.stringify(rep)); } catch {} }, [rep]);

  // 리포트 심층 분석 (AI) — 카드별 유리·불리·리스크 + 6장 전체 전략
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisMsg, setAnalysisMsg] = useState('');

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
    // 대학을 열지 않았어도 학생 배치 카드가 있으면 그걸 판정 대상으로 삼는다
    const source = list?.length ? list
      : (detail ? [...pins.filter((p) => p.univ.unvCd === detail.unvCd), ...placementCards, ...unpinnedCards]
        : [...placementCards]);
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
            const snap = buildSnapshot(c.entry, baseYear, cutPct);
            return { key: c.key, univ: c.univ.name, dept: c.entry.dept, track: c.entry.track, typeName: c.entry.typeName,
              기준컷: `${cutPct}%컷`, cut: snap.cutSel ?? snap.cut70, cutYear: snap.cutSelYear || snap.cutYear,
              trend: snap.series, rate: snap.rate, fill: snap.fill, recruit: snap.recruit,
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

  // ── 리포트 심층 분석 — 카드별 유리·불리·리스크를 서술로 ──
  // 숫자 해석(cardSignals)은 코드가 먼저 끝내고, AI에는 그 지표와 생기부를 함께 넘겨 "왜"를 쓰게 한다.
  // 그래야 AI가 없는 숫자를 지어내지 않고, 실패해도 자동 지표 해설은 리포트에 남는다.
  async function runReportAnalysis(list) {
    const target = (list || []).slice(0, 12);
    if (!target.length) { setAnalysisMsg('분석할 카드가 없습니다. 배치 저장이나 대학 선택을 먼저 해주세요.'); return; }
    const creds = aiCreds();
    if (!creds.apiKey) { setAnalysisMsg('설정에서 AI API 키를 먼저 입력해 주세요.'); return; }
    const pool = dossier?.records?.length ? dossier.records : (student?.records || []);
    const analysisRec = pool.find((r) => r.type === '생기부 분석' && r.content)
      || pool.find((r) => r.type === '컨설턴트 브리핑' && r.content) || pool.find((r) => r.content);
    setAnalyzing(true); setAnalysisMsg('분석 중… 카드 수에 따라 30초~1분 걸립니다.');
    try {
      const d = await postForResult(`${API_BASE}/api/ipgyeol/report-analysis`, {
        method: 'POST',
        headers: aiHeaders(creds),
        body: JSON.stringify({
          studentProfile: student ? {
            name: student.name, school: student.school, grade: student.grade, major: student.major,
            targetUniv: student.target_univ || '', gpa: grade, analysisExcerpt: analysisRec?.content || '',
          } : { gpa: grade },
          context: rep.comment || '',
          cards: target.map((c) => {
            const snap = buildSnapshot(c.entry, baseYear, cutPct);
            const sig = cardSignals(c, grade, baseYear, cutPct);
            const v = verdict(snap.cutSel ?? snap.cut70, grade);
            return {
              key: c.key, univ: c.univ.name, region: c.univ.region, dept: c.entry.dept,
              track: c.entry.track, typeName: c.entry.typeName,
              학생내신: grade, 배치판정: v ? v.label : null,
              기준컷: `${cutPct}%컷`, cut: snap.cutSel ?? snap.cut70, cutYear: snap.cutSelYear || snap.cutYear, 연도별컷: snap.series,
              경쟁률: snap.rate, 충원: snap.fill, 모집: snap.recruit, 득점률: snap.pct70,
              수능최저: c.sunung?.text?.slice(0, 300) || null,
              자동산출지표: sig,
            };
          }),
        }),
      });
      if (!d.success) throw new Error(d.message || '분석 실패');
      setAnalysis(d.analysis);
      setAnalysisMsg(`분석 완료 — 카드 ${d.analysis.cards?.length || 0}건 + 종합 전략`);
    } catch (e) {
      setAnalysisMsg('분석 오류: ' + e.message);
    } finally { setAnalyzing(false); }
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

  // ── AI 검색 결과를 학생 기록으로 배정 ──
  // 배치(placements)는 카드 한 장씩의 수치 스냅샷이라, "왜 이 후보들을 봤는지"가 남지 않는다.
  // 검색어·해석된 조건·요약을 기록으로 남겨야 나중에 상담·브리핑이 맥락을 읽을 수 있다.
  const [assigning, setAssigning] = useState(false);
  const [assigned, setAssigned] = useState(false);

  function aiSearchToText() {
    if (!aiSearch) return '';
    const lines = [];
    lines.push(`[검색어] ${aiSearch.query}`);
    if (aiSearch.filter?.intent) lines.push(`[해석] ${aiSearch.filter.intent}`);
    const chips = filterChips(aiSearch.filter);
    if (chips.length) lines.push(`[조건] ${chips.join(' · ')}`);
    lines.push(`[기준] 기준연도 ${baseYear} · 내신 ${grade.toFixed(2)}`);
    lines.push(`[매칭] 전체 ${aiSearch.total}건 중 상위 ${aiSearch.results.length}건`);
    if (aiSearch.relaxed?.length) lines.push(`[조건 완화] ${aiSearch.relaxed.join(' · ')}`);
    if (aiSearch.summary) lines.push('', aiSearch.summary);
    if (aiSearch.results.length) {
      lines.push('', '[후보 목록]');
      aiSearch.results.forEach((c, i) => {
        const m = c.match || {};
        lines.push(`${i + 1}. ${c.univ.name.replace(/\[.*\]$/, '')} ${c.entry.dept} ${c.entry.track}(${c.entry.typeName})`
          + ` · 70%컷 ${m.cut70 ?? '-'}${m.cutYear ? `(${m.cutYear})` : ''}`
          + ` · 경쟁률 ${m.rate ?? '-'} · 모집 ${m.recruit ?? '-'}명 · 충원 ${m.fill ?? '-'}명`
          + (m.verdict ? ` · 판정 ${m.verdict}` : ''));
      });
    }
    return lines.join('\n');
  }

  async function assignSearchToStudent() {
    if (!student || !aiSearch) return;
    setAssigning(true);
    try {
      const j = await api(`/api/board/students/${student.id}/records`, {
        method: 'POST',
        body: {
          type: '입결 분석',
          title: `입결 검색 — ${aiSearch.query.slice(0, 40)}${aiSearch.query.length > 40 ? '…' : ''}`,
          content: aiSearchToText(),
        },
      });
      if (!j.success) throw new Error(j.message || '배정 실패');
      setAssigned(true);
      setTimeout(() => setAssigned(false), 3000);
    } catch (e) {
      if (e.auth) onAuthError?.(); else setError(`학생 배정 실패: ${e.message}`);
    } finally { setAssigning(false); }
  }

  // ── 리포트를 학생 기록으로 ──
  // 인쇄물은 상담이 끝나면 사라진다. 같은 내용을 글로 남겨야 다음 상담·브리핑·AI가 근거로 읽는다.
  // 인쇄본과 같은 취사선택(뺀 항목·코멘트·분석 포함 여부)을 그대로 따른다.
  // 리포트에 통째로 실을 기록. 고른 것만 들어간다.
  const attachedRecords = (dossier?.records || []).filter((r) => repRecOn.has(r.id) && String(r.content || '').trim());

  function reportToText() {
    const on = (k) => !repOff[k];
    const memoOf = (k) => (repMemo[k] || '').trim();
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const L = [];
    L.push(`[입결 리포트] ${rep.title || '입결 분석 리포트'}`);
    L.push(`작성일 ${rep.dateText?.trim() || today} · 기준 내신 ${grade.toFixed(2)} · 기준 연도 ${baseYear} · 기준 합격선 ${cutPct}%컷`
      + (student ? ` · ${student.name}${student.school ? `(${student.school})` : ''}` : ''));

    if (rep.comment?.trim()) L.push('', '[컨설턴트 총평]', rep.comment.trim());

    const ov = rep.showAnalysis ? analysis?.overall : null;
    if (ov) {
      L.push('', '[종합 분석]');
      if (ov.headline) L.push(ov.headline);
      if (ov.summary) L.push(ov.summary);
      if (ov.strategy) L.push('', `· 지원 전략: ${ov.strategy}`);
      (ov.risks || []).forEach((r) => L.push(`· 전체 리스크: ${r}`));
    }

    if (rep.showPlacements) {
      const pls = placements.filter((p) => on(`pl-${p.id}`));
      L.push('', `[저장된 배치 기록] ${pls.length}건`);
      if (!pls.length) L.push('(없음)');
      pls.forEach((p, i) => {
        const s = p.snapshot || {};
        L.push(`${i + 1}. ${(p.univ_name || '').replace(/\[.*\]$/, '')} ${p.dept} ${p.track}(${p.type_name || '-'})`
          + ` · 판정 ${p.verdict || '-'} · ${snapCut(s).pct}%컷 ${snapCut(s).v ?? '-'}${snapCut(s).year ? `(${snapCut(s).year})` : ''}`
          + ` · 경쟁률 ${s.rate ?? '-'} · 모집 ${s.recruit ?? '-'}명 · 충원 ${s.fill ?? '-'}명 · 저장내신 ${p.grade ?? '-'}`);
        if (s.aiReason) L.push(`   판정 근거: ${s.aiReason}`);
        if (memoOf(`pl-${p.id}`)) L.push(`   메모: ${memoOf(`pl-${p.id}`)}`);
      });
    }

    if (rep.showSearch && aiSearch) {
      const rs = (aiSearch.results || []).filter((c, i) => on(`sr-${i}-${c.key}`));
      L.push('', `[후보 검토] ${aiSearch.query}`);
      if (aiSearch.summary) L.push(aiSearch.summary);
      rs.forEach((c, i) => {
        const m = c.match || {};
        L.push(`${i + 1}. ${c.univ.name.replace(/\[.*\]$/, '')} ${c.entry.dept} ${c.entry.track}(${c.entry.typeName})`
          + ` · 70%컷 ${m.cut70 ?? '-'} · 경쟁률 ${m.rate ?? '-'} · 판정 ${m.verdict || '-'}`);
      });
    }

    if (rep.showCards) {
      const cds = reportCards.filter((c) => on(`cd-${c.key}`));
      const aiMap = {};
      if (rep.showAnalysis) (analysis?.cards || []).forEach((a) => { aiMap[a.key] = a; });
      L.push('', `[전형 카드별 분석] ${cds.length}건`);
      cds.forEach((c) => {
        const sig = rep.showWhy ? cardSignals(c, grade, baseYear, cutPct) : { pros: [], cons: [], risks: [] };
        const a = aiMap[c.key];
        const cut = latestWithDelta(c.entry, cutField(cutPct), baseYear);
        const v = verdict(cut.v, grade);
        L.push('', `■ ${c.univ.name.replace(/\[.*\]$/, '')} ${c.entry.dept} ${c.entry.track}(${c.entry.typeName})`
          + ` · ${cutPct}%컷 ${cut.v != null ? cut.v.toFixed(2) : '-'}${cut.y ? `(${cut.y})` : ''} · 배치 ${v ? v.label : '-'}`
          + (a?.headline ? ` — ${a.headline}` : ''));
        [...sig.pros, ...(a?.pros || [])].forEach((t) => L.push(`  [유리] ${t}`));
        [...sig.cons, ...(a?.cons || [])].forEach((t) => L.push(`  [불리] ${t}`));
        [...sig.risks, ...(a?.risks || [])].forEach((t) => L.push(`  [리스크] ${t}`));
        if (a?.watch) L.push(`  [지원 전 확인] ${a.watch}`);
        if (memoOf(`cd-${c.key}`)) L.push(`  [메모] ${memoOf(`cd-${c.key}`)}`);
        if (c.sunung?.text) L.push(`  [수능최저] ${c.sunung.text.replace(/\s+/g, ' ')}`);
      });
    }

    for (const r of attachedRecords) {
      L.push('', `[첨부 기록 — ${r.type || '기록'}] ${r.title || '(제목 없음)'}`, String(r.content || '').trim());
    }

    if (rep.note?.trim()) L.push('', rep.note.trim());
    return L.join('\n');
  }

  const [assigningReport, setAssigningReport] = useState(false);
  const [assignedReport, setAssignedReport] = useState(false);

  async function assignReportToStudent() {
    if (!student) return;
    setAssigningReport(true);
    try {
      const cnt = reportCards.filter((c) => !repOff[`cd-${c.key}`]).length;
      const j = await api(`/api/board/students/${student.id}/records`, {
        method: 'POST',
        body: {
          type: '입결 분석',
          title: `입결 리포트 — ${rep.title || '입결 분석 리포트'} (카드 ${cnt}건)`,
          content: reportToText(),
        },
      });
      if (!j.success) throw new Error(j.message || '배정 실패');
      setAssignedReport(true);
      setTimeout(() => setAssignedReport(false), 4000);
      // 자료 패널을 열어둔 경우 방금 남긴 기록이 바로 보이게 갱신
      api(`/api/board/students/${student.id}/context`).then((r) => { if (r.success) setDossier(r); }).catch(() => {});
    } catch (e) {
      if (e.auth) onAuthError?.(); else setAnalysisMsg(`기록 배정 실패: ${e.message}`);
    } finally { setAssigningReport(false); }
  }

  // ── 입결 리포트 (인쇄용 새 창) ──
  // 배치 기록과 AI 검색 결과를 한 장으로 묶는다. 상담 자리에서 학부모에게 바로 보여주는 용도라
  // 화면 조작 없이 인쇄만 하면 되게 만든다.
  // 편집창(ReportModal)에서 고른 제목·총평·포함 항목·항목별 코멘트를 그대로 반영한다.
  function buildIpgyeolReport() {
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const nl = (s) => esc(s).replace(/\n/g, '<br>');
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const VOR = ['안정', '적정', '소신', '위험'];
    const on = (k) => !repOff[k];
    const memoOf = (k) => (repMemo[k] || '').trim();

    const repPlacements = rep.showPlacements ? placements.filter((p) => on(`pl-${p.id}`)) : [];
    const repSearch = rep.showSearch ? (aiSearch?.results || []).filter((c, i) => on(`sr-${i}-${c.key}`)) : [];
    const repCardList = rep.showCards ? reportCards.filter((c) => on(`cd-${c.key}`)) : [];

    // 첨부한 학생 기록 — 줄바꿈을 살리고, [머리말]·**굵게**·번호 목록 정도만 모양을 낸다.
    // 원문을 함부로 재구성하면 검증까지 끝낸 글이 인쇄물에서 달라진다.
    const recBody = (t) => esc(String(t || '').trim())
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .split('\n')
      .map((ln) => (/^\s*\[[^\]]+\]/.test(ln)
        ? `<div class="rec-key">${ln}</div>`
        : `<div>${ln || '&nbsp;'}</div>`))
      .join('');
    const recBlocks = attachedRecords.map((r) => `<h2>${esc(r.title || '기록')}</h2>
<div class="sub" style="margin-bottom:6px">${esc(r.type || '기록')} · ${esc(String(r.created_at).slice(0, 10))}</div>
<div class="rec">${recBody(r.content)}</div>`).join('');

    const plRows = [...repPlacements].sort((a, b) => VOR.indexOf(a.verdict) - VOR.indexOf(b.verdict)).map((p) => {
      const s = p.snapshot || {};
      const sc = snapCut(s);
      const now = verdict(sc.v, grade);
      const saved = verdict(sc.v, Number(p.grade));
      const changed = now && saved && now.label !== saved.label;
      return `<tr>
        <td class="v v-${esc(p.verdict)}">${esc(p.verdict || '—')}</td>
        <td><b>${esc((p.univ_name || '').replace(/\[.*\]$/, ''))}</b> ${esc(p.dept)}<div class="sub">${esc(p.track)}(${esc(p.type_name || '-')})</div></td>
        <td class="num">${sc.v != null ? Number(sc.v).toFixed(2) : '—'}<div class="sub">${esc(sc.year || p.base_year || '')}${sc.pct !== 70 ? ` · ${sc.pct}%` : ''}</div></td>
        <td class="num">${s.rate ?? '—'}</td>
        <td class="num">${s.recruit != null ? `${s.recruit}명` : '—'}</td>
        <td class="num">${s.fill != null ? `${s.fill}명` : '—'}</td>
        <td class="num">${p.grade != null ? Number(p.grade).toFixed(2) : '—'}</td>
        <td>${changed ? `<span class="warn">현재 ${grade.toFixed(2)} 기준 → ${esc(now.label)}</span>` : ''}${s.aiReason ? `<div class="sub">판정 근거: ${esc(s.aiReason)}</div>` : ''}${memoOf(`pl-${p.id}`) ? `<div class="memo">${nl(memoOf(`pl-${p.id}`))}</div>` : ''}</td>
      </tr>`;
    }).join('');

    const srcRows = repSearch.map((c, i) => {
      const m = c.match || {};
      const mk = memoOf(`sr-${(aiSearch?.results || []).indexOf(c)}-${c.key}`);
      return `<tr>
        <td class="num">${i + 1}</td>
        <td><b>${esc(c.univ.name.replace(/\[.*\]$/, ''))}</b> ${esc(c.entry.dept)}<div class="sub">${esc(c.entry.track)}(${esc(c.entry.typeName)}) · ${esc(c.univ.region)}</div>${mk ? `<div class="memo">${nl(mk)}</div>` : ''}</td>
        <td class="num">${m.cut70 ?? '—'}<div class="sub">${esc(m.cutYear || '')}</div></td>
        <td class="num">${m.rate ?? '—'}</td>
        <td class="num">${m.recruit != null ? `${m.recruit}명` : '—'}</td>
        <td class="num">${m.fill != null ? `${m.fill}명` : '—'}</td>
        <td class="v v-${esc(m.verdict || '')}">${esc(m.verdict || '—')}</td>
      </tr>`;
    }).join('');

    const chips = aiSearch ? filterChips(aiSearch.filter).map((c) => `<span class="chip">${esc(c)}</span>`).join('') : '';

    // 카드가 리포트의 본체다 — 고정 카드 + 학생 배치 카드 + 지금 보고 있는 대학의 카드.
    // 연도별 추이까지 넣어야 "왜 이 판정인지"가 종이 위에서 읽힌다.

    // 판단 근거 — 자동 산출 지표(항상)와 AI 심층 분석(생성했을 때)을 한 덩어리로 합친다.
    // 상담에서 읽는 사람에게 필요한 건 출처별 구분이 아니라 "유리/불리/리스크"의 한 묶음이다.
    const aiCardMap = {};
    if (rep.showAnalysis) (analysis?.cards || []).forEach((a) => { aiCardMap[a.key] = a; });
    const ul = (arr) => arr.map((t) => `<li>${esc(t)}</li>`).join('');
    // AI가 자동 지표와 같은 말을 되풀이하면 종이 위에서 같은 문장이 두 번 읽힌다.
    // 프롬프트로 막고도 겹치는 문장은 여기서 걸러낸다(글자 2-gram 겹침 비율).
    const gram = (s) => {
      const n = String(s).replace(/[^가-힣0-9a-zA-Z]/g, '');
      const out = new Set();
      for (let i = 0; i < n.length - 1; i++) out.add(n.slice(i, i + 2));
      return out;
    };
    const overlaps = (s, list) => list.some((t) => {
      const A = gram(s), B = gram(t);
      if (!A.size || !B.size) return false;
      let hit = 0; A.forEach((x) => { if (B.has(x)) hit++; });
      return hit / Math.min(A.size, B.size) >= 0.5;
    });
    function whyBlock(c) {
      const sig = rep.showWhy ? cardSignals(c, grade, baseYear, cutPct) : { pros: [], cons: [], risks: [] };
      const a = aiCardMap[c.key];
      const fresh = (arr, base) => (arr || []).filter((t) => t && !overlaps(t, base));
      const pros = [...sig.pros, ...fresh(a?.pros, sig.pros)];
      const cons = [...sig.cons, ...fresh(a?.cons, sig.cons)];
      const risks = [...sig.risks, ...fresh(a?.risks, sig.risks)];
      if (!pros.length && !cons.length && !risks.length) return '';
      return `<div class="why">
        ${a?.headline ? `<div class="why-head">${esc(a.headline)}</div>` : ''}
        <div class="why-cols">
          ${pros.length ? `<div class="why-col pro"><b>유리한 점</b><ul>${ul(pros)}</ul></div>` : ''}
          ${cons.length ? `<div class="why-col con"><b>불리한 점</b><ul>${ul(cons)}</ul></div>` : ''}
          ${risks.length ? `<div class="why-col risk"><b>리스크 · 확인 사항</b><ul>${ul(risks)}</ul></div>` : ''}
        </div>
        ${a?.watch ? `<div class="why-watch"><b>지원 전 확인</b> ${esc(a.watch)}</div>` : ''}
      </div>`;
    }

    const ov = rep.showAnalysis ? analysis?.overall : null;
    const overallBlock = ov ? `<h2>종합 분석 — 현재 위치와 지원 전략</h2>
${ov.headline ? `<div class="ov-head">${esc(ov.headline)}</div>` : ''}
${ov.summary ? `<div class="summary">${esc(ov.summary)}</div>` : ''}
${ov.strategy ? `<div class="ov-sec"><b>지원 전략</b><div>${esc(ov.strategy)}</div></div>` : ''}
${(ov.risks || []).length ? `<div class="ov-sec risk"><b>전체 리스크</b><ul>${ul(ov.risks)}</ul></div>` : ''}` : '';

    const yearsWin = [];
    for (let y = Number(baseYear) - 3; y <= Number(baseYear); y++) yearsWin.push(String(y));

    const cardBlocks = repCardList.map((c) => {
      const cut = latestWithDelta(c.entry, cutField(cutPct), baseYear);
      const rate = latestWithDelta(c.entry, 'rate', baseYear);
      const fill = latestWithDelta(c.entry, 'fill', baseYear);
      const rec = latestWithDelta(c.entry, 'recruit', baseYear);
      const sc = latestWithDelta(c.entry, 'score70', baseYear);
      const pc = latestWithDelta(c.entry, 'pct70', baseYear);
      const v = verdict(cut.v, grade);
      const ai = aiJudgments[c.key];
      const trend = yearsWin.map((y) => {
        const d = c.entry.years[y];
        const cv = d?.[cutField(cutPct)];
        return `<td class="num">${cv != null ? cv.toFixed(2) : '—'}<div class="sub">${d?.rate != null ? `${d.rate}:1` : ''}</div></td>`;
      }).join('');
      return `<div class="card">
        <div class="card-head">
          <div><b>${esc(c.univ.name.replace(/\[.*\]$/, ''))}</b> <span class="sub">${esc(c.univ.region)}</span>
            <div class="card-dept">${esc(c.entry.dept)}</div>
            <div class="sub">${esc(c.entry.track)}(${esc(c.entry.typeName)})</div></div>
          <div class="card-badges">
            ${v ? `<span class="v v-${esc(v.label)}">배치 ${esc(v.label)}</span>` : ''}
            ${ai ? `<span class="v v-${esc(ai.verdict)}">종합 ${esc(ai.verdict)}</span>` : ''}
          </div>
        </div>
        <table class="mini"><thead><tr><th>연도</th>${yearsWin.map((y) => `<th class="num">${y}</th>`).join('')}</tr></thead>
        <tbody><tr><td>${cutPct}%컷 / 경쟁률</td>${trend}</tr></tbody></table>
        <div class="kv">
          <span><b>경쟁률</b> ${rate.v ?? '—'}</span>
          <span><b>충원</b> ${fill.v != null ? `${fill.v}명` : '—'}</span>
          <span><b>모집</b> ${rec.v != null ? `${rec.v}명` : '—'}</span>
          <span><b>환산(70%)</b> ${sc.v ?? '—'}</span>
          <span><b>득점률</b> ${pc.v != null ? `${pc.v}%` : '—'}</span>
        </div>
        ${whyBlock(c)}
        ${ai?.reason ? `<div class="ai">판정 근거: ${esc(ai.reason)}</div>` : ''}
        ${memoOf(`cd-${c.key}`) ? `<div class="memo">${nl(memoOf(`cd-${c.key}`))}</div>` : ''}
        ${c.sunung?.text ? `<div class="low"><b>수능최저</b> ${esc(c.sunung.text)}</div>` : ''}
      </div>`;
    }).join('');

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>입결 분석 리포트${student ? ` - ${esc(student.name)}` : ''}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1c2733;background:#fff;font-size:12.5px;line-height:1.7;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{max-width:960px;margin:0 auto;padding:28px 30px 40px}
h1{font-size:22px;font-weight:800;margin-bottom:4px}
.lead{color:#5c6b7c;font-size:12.5px;margin-bottom:16px}
.meta{display:flex;flex-wrap:wrap;gap:8px 22px;background:#f2f5f9;border:1px solid #e3e9f1;border-radius:10px;padding:12px 14px;margin-bottom:20px;font-size:12.5px}
.meta b{color:#1d4fa8}
h2{font-size:15px;font-weight:800;margin:22px 0 8px;padding-top:12px;border-top:2px solid #1d4fa8}
table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:6px}
th{background:#f2f5f9;border:1px solid #dbe3ee;padding:6px 8px;font-weight:700;text-align:left;white-space:nowrap}
td{border:1px solid #e3e9f1;padding:6px 8px;vertical-align:top}
td.num{text-align:right;white-space:nowrap}
.sub{color:#8492a5;font-size:10.5px;font-weight:500}
.v{font-weight:800;white-space:nowrap;text-align:center}
.v-안정{color:#1a7f4e;background:#e6f6ee}.v-적정{color:#1d6fd6;background:#e8f1fc}
.v-소신{color:#b7791f;background:#fdf3e2}.v-위험{color:#d64545;background:#fdeaea}
.warn{color:#d64545;font-weight:700;font-size:11px}
.chip{display:inline-block;background:#eef2f7;border:1px solid #dbe3ee;border-radius:6px;padding:1px 7px;margin:0 4px 4px 0;font-size:11px;color:#3d4a5c}
.summary{background:#f7f9fc;border:1px solid #e3e9f1;border-radius:10px;padding:12px 14px;white-space:pre-wrap;font-size:12.5px;margin-bottom:8px}
.rec{border:1px solid #e3e9f1;border-radius:10px;padding:13px 16px;font-size:12.5px;line-height:1.75;color:#2c3846;margin-bottom:10px}
.rec-key{margin-top:7px;font-weight:700;color:#1d4fa8}
.rec div:first-child{margin-top:0}
.empty{color:#8492a5;padding:10px 2px}
.note{margin-top:24px;padding-top:12px;border-top:1px solid #e3e9f1;color:#8492a5;font-size:10.5px;line-height:1.6}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.card{border:1px solid #dbe3ee;border-radius:10px;padding:10px 12px;break-inside:avoid}
.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:6px}
.card-dept{font-size:14px;font-weight:800;margin:2px 0 1px}
.card-badges{display:flex;flex-direction:column;gap:3px;align-items:flex-end}
.card-badges .v{border:1px solid #dbe3ee;border-radius:6px;padding:1px 7px;font-size:10.5px}
table.mini{margin:4px 0 6px}table.mini th,table.mini td{padding:3px 6px;font-size:11px}
.kv{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:11px;color:#3d4a5c}
.kv b{color:#8492a5;font-weight:600}
.ai{margin-top:6px;background:#f4effc;border:1px solid #e5dcf7;border-radius:7px;padding:4px 8px;font-size:11px;color:#5b3fa8}
.low{margin-top:5px;background:#fbf6df;border:1px solid #f0e6b8;border-radius:7px;padding:4px 8px;font-size:10.5px;color:#5c5322;line-height:1.5}
.memo{margin-top:5px;background:#eef7f1;border-left:3px solid #1a7f4e;border-radius:0 6px 6px 0;padding:4px 8px;font-size:11px;color:#1f5c3d;line-height:1.55}
.why{margin-top:7px;border-top:1px dashed #dbe3ee;padding-top:7px}
.why-head{font-size:12px;font-weight:800;color:#1c2733;margin-bottom:5px}
.why-cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}
.why-col{border-radius:8px;padding:6px 9px;font-size:11px;line-height:1.55}
.why-col b{display:block;font-size:10.5px;font-weight:800;margin-bottom:3px;letter-spacing:-0.2px}
.why-col ul{margin:0;padding-left:14px}
.why-col li{margin-bottom:2px}
.why-col.pro{background:#eef8f2;color:#17593a}.why-col.pro b{color:#1a7f4e}
.why-col.con{background:#fdf4ec;color:#7a4a1b}.why-col.con b{color:#b7791f}
.why-col.risk{background:#fdeef0;color:#7d2a2a}.why-col.risk b{color:#d64545}
.why-watch{margin-top:6px;background:#eef2f9;border:1px solid #dbe3ee;border-radius:7px;padding:4px 9px;font-size:11px;color:#26313e}
.why-watch b{color:#1d4fa8}
.ov-head{font-size:15px;font-weight:800;color:#1d4fa8;margin-bottom:6px}
.ov-sec{margin-top:8px;font-size:12.5px;line-height:1.75}
.ov-sec>b{display:block;font-size:11.5px;font-weight:800;color:#1d4fa8;margin-bottom:3px}
.ov-sec ul{margin:0;padding-left:16px}
.ov-sec.risk>b{color:#d64545}
.bar{position:sticky;top:0;z-index:9;display:flex;align-items:center;gap:9px;flex-wrap:wrap;background:#1c2733;color:#e8eef6;padding:9px 16px;font-size:12.5px}
.bar button{border:1px solid #4a5a6d;background:#2b3947;color:#e8eef6;border-radius:7px;padding:5px 12px;font-size:12.5px;font-weight:700;cursor:pointer}
.bar button.on{background:#2b6fe3;border-color:#2b6fe3;color:#fff}
.bar .spacer{flex:1}
.editing .page{outline:2px dashed #2b6fe3;outline-offset:-6px}
.cards.wide{grid-template-columns:1fr}
@media print{.page{padding:0}h2{break-after:avoid}tr{break-inside:avoid}.cards{grid-template-columns:1fr 1fr}.cards.wide{grid-template-columns:1fr}.no-print{display:none!important}.editing .page{outline:none}}
</style></head><body>
<div class="bar no-print">
  <span>리포트가 준비되었습니다. 문구를 고치려면 <b>✏ 직접 수정</b>을 켜고 글자를 클릭해 바로 고치세요.</span>
  <span class="spacer"></span>
  <button id="editBtn" onclick="toggleEdit()">✏ 직접 수정</button>
  <button onclick="window.print()">🖨 인쇄 / PDF 저장</button>
</div>
<div class="page">
<h1>${esc(rep.title || '입결 분석 리포트')}</h1>
${rep.lead ? `<div class="lead">${esc(rep.lead)}</div>` : ''}
<div class="meta">
  <div><b>학생</b> ${student ? esc(student.name) + (student.school ? ` · ${esc(student.school)}` : '') : '미지정'}</div>
  <div><b>기준 내신</b> ${grade.toFixed(2)}등급</div>
  <div><b>기준 연도</b> ${esc(baseYear)}</div>
  <div><b>기준 합격선</b> 최종등급 ${cutPct}%컷</div>
  <div><b>작성일</b> ${esc(rep.dateText?.trim() || today)}</div>
  ${rep.author?.trim() ? `<div><b>작성</b> ${esc(rep.author)}</div>` : ''}
</div>

${rep.comment?.trim() ? `<h2>컨설턴트 총평</h2>
<div class="summary">${esc(rep.comment.trim())}</div>` : ''}

${recBlocks}

${overallBlock}

${rep.showPlacements ? `<h2>저장된 배치 기록 (${repPlacements.length}건)</h2>
${repPlacements.length ? `<table>
<thead><tr><th>판정</th><th>대학 · 학과 · 전형</th><th>합격선</th><th>경쟁률</th><th>모집</th><th>충원</th><th>저장내신</th><th>비고</th></tr></thead>
<tbody>${plRows}</tbody></table>` : '<div class="empty">저장된 배치가 없습니다.</div>'}` : ''}

${rep.showSearch && aiSearch ? `<h2>후보 검토</h2>
<div style="margin-bottom:8px"><b>검토 조건</b> ${esc(aiSearch.query)}</div>
${aiSearch.filter?.intent ? `<div class="sub" style="margin-bottom:6px">${esc(aiSearch.filter.intent)}</div>` : ''}
<div style="margin-bottom:8px">${chips}</div>
<div class="sub" style="margin-bottom:8px">전체 ${aiSearch.total}건 중 ${repSearch.length}건 수록${aiSearch.relaxed?.length ? ` · 조건 완화: ${esc(aiSearch.relaxed.join(' · '))}` : ''}</div>
${aiSearch.summary ? `<div class="summary">${esc(aiSearch.summary)}</div>` : ''}
${srcRows ? `<table>
<thead><tr><th>#</th><th>대학 · 학과 · 전형</th><th>70%컷</th><th>경쟁률</th><th>모집</th><th>충원</th><th>판정</th></tr></thead>
<tbody>${srcRows}</tbody></table>` : ''}` : ''}

${cardBlocks ? `<h2>전형 카드별 분석 (${repCardList.length}건)</h2>
<div class="cards${rep.showWhy || Object.keys(aiCardMap).length ? ' wide' : ''}">${cardBlocks}</div>` : ''}

${rep.note?.trim() ? `<div class="note">${nl(rep.note.trim())}</div>` : ''}
</div>
<script>
function toggleEdit(){
  var p=document.querySelector('.page'), b=document.getElementById('editBtn');
  var on=p.getAttribute('contenteditable')==='true';
  p.setAttribute('contenteditable', on?'false':'true');
  document.body.classList.toggle('editing', !on);
  b.classList.toggle('on', !on);
  b.textContent = on ? '✏ 직접 수정' : '✓ 수정 끝내기';
  if(!on) p.focus();
}
<\/script>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    else setError('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.');
  }

  // ── 배치 보고서 — 카드를 붙일 때마다 저절로 쓰이고 갱신되는 글 ──
  // 배치(placements)는 카드 한 장씩의 숫자 스냅샷이라, 여섯 장을 함께 놓고 본 그림이 남지 않는다.
  // 상담 자리에서 필요한 것은 그 그림이고, 나중에 AI 브리핑·교차 검증이 읽는 것도 이 글이다.
  // 제목을 고정해 **한 건만 두고 갱신**한다 — 배치할 때마다 기록이 쌓이면 아무도 안 읽는다.
  const PLACEMENT_REPORT_TITLE = '입결 배치 보고서';

  function placementReportText(list = placements, cards = placementCards) {
    const L = [];
    const today = new Date().toISOString().slice(0, 10);
    L.push(`[입결 배치 보고서] ${student?.name || '학생'} · ${baseYear} 기준 · ${cutPct}%컷 기준`);
    L.push(`작성 ${today} · 배치 ${list.length}건`
      + (Number.isFinite(grade) ? ` · 현재 내신 ${grade.toFixed(2)}` : ''));
    if (gradeSource) L.push(`내신 근거: ${gradeSource}`);
    L.push('');

    const order = ['안정', '적정', '소신', '위험'];
    const cnt = order.map((v) => `${v} ${list.filter((p) => p.verdict === v).length}`).join(' · ');
    L.push(`[판정 분포] ${cnt}`);
    L.push('');

    const sorted = [...list].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict));
    sorted.forEach((pl, i) => {
      const sc = snapCut(pl.snapshot || {});
      const sn = pl.snapshot || {};
      L.push(`${i + 1}. ${(pl.univ_name || '').replace(/\[.*\]$/, '')} ${pl.dept} / ${pl.track}(${pl.type_name || '-'})`);
      L.push(`   ${sc.pct}%컷 ${sc.v ?? '-'}${sc.year ? `(${sc.year})` : ''}`
        + ` · 경쟁률 ${sn.rate ?? '-'} · 충원 ${sn.fill ?? '-'}명 · 모집 ${sn.recruit ?? '-'}명`
        + ` · 판정 ${pl.verdict || '-'}`);
      if (sn.aiVerdict) L.push(`   AI 판정 ${sn.aiVerdict}${sn.aiReason ? ` — ${sn.aiReason}` : ''}`);
      // 지원 시 유의사항 — 숫자만으로는 알 수 없는 것. 이 글을 읽는 사람이 가장 먼저 봐야 한다.
      const c = cards.find((x) => x.univ.unvCd === pl.unv_cd && x.entry.dept === pl.dept
        && x.entry.track === pl.track && x.entry.typeName === pl.type_name);
      // 대학 전체 경고와 전형별 유의사항에 같은 문장이 들어 있다("입결은 ○○대식 등급 평균").
      // 그대로 두면 한 카드에 같은 말이 두세 번 찍힌다 — 본 문장은 한 번만.
      const said = new Set();
      if (c?.skypass?.scaleWarning) {
        L.push(`   ⚠ 이 대학 입결 등급은 대학 자체 환산등급 — 일반 등급과 직접 비교 불가`);
        for (const n of (c.skypass.univNotes || [])) said.add(n.note);
      }
      for (const n of (c?.skypass?.notes || [])) {
        if (said.has(n.note)) continue;
        said.add(n.note);
        L.push(`   ⚠ 유의: ${n.note}`);
      }
    });

    // 6장 균형 — 컨설턴트가 실제로 보는 것은 개별 판정이 아니라 이 구성이다
    const safe = list.filter((p) => p.verdict === '안정').length;
    const risky = list.filter((p) => p.verdict === '위험' || p.verdict === '소신').length;
    L.push('');
    L.push(`[6장 구성] 안전판 ${safe}장 · 상향(소신+위험) ${risky}장 · 전체 ${list.length}장`);
    if (list.length >= 3 && safe === 0) L.push('   → 안전판이 없습니다. 최소 1~2장은 안정 카드로 채우기를 권합니다.');
    if (list.length > 6) L.push('   → 수시는 6장이 한도입니다. 지금 구성에서 덜어낼 카드를 정해야 합니다.');
    return L.join('\n');
  }

  // 저장/삭제 뒤에 보고서를 최신으로 맞춘다. 실패해도 배치 자체는 이미 저장됐으므로 조용히 넘긴다
  // (여기서 alert 를 띄우면 배치가 실패한 것처럼 보인다).
  async function syncPlacementReport(list, cards) {
    if (!student) return;
    try {
      const title = `${PLACEMENT_REPORT_TITLE} — ${student.name || '학생'}`;
      const content = placementReportText(list, cards);
      const ctx = await api(`/api/board/students/${student.id}/context`);
      if (!ctx.success) return;
      const found = (ctx.records || []).find((r) => (r.title || '').startsWith(PLACEMENT_REPORT_TITLE));
      if (!list.length && found) {
        // 배치를 다 지웠으면 보고서도 지운다 — 빈 보고서가 남아 있으면 그게 더 헷갈린다
        await api(`/api/board/records/${found.id}`, { method: 'DELETE' });
      } else if (list.length) {
        if (found) await api(`/api/board/records/${found.id}`, { method: 'PUT', body: { title, content } });
        else await api(`/api/board/students/${student.id}/records`, { method: 'POST', body: { type: '입결 분석', title, content } });
      }
      const fresh = await api(`/api/board/students/${student.id}/context`);
      if (fresh.success) setDossier(fresh);
    } catch { /* 보고서 갱신 실패가 배치를 되돌리지는 않는다 */ }
  }

  // 기록 한 편을 그대로 실어 리포트를 연다 — 검증·반영까지 끝낸 글을 인쇄물로 만드는 길.
  function openReportWithRecord(rec) {
    setRepRecOn(new Set(rec ? [rec.id] : []));
    setReportOpen(true);
  }

  // 검색 후보를 통째로 배치 기록으로 — 이래야 리포트의 배치 표·카드 분석이 채워진다.
  // 숫자는 글에서 되읽지 않고 지금 화면의 어디가 원본 값을 그대로 쓴다(AI가 손댄 수치가 섞이면 안 된다).
  const [bulkSaving, setBulkSaving] = useState(false);
  async function saveSearchAsPlacements() {
    if (!student || !aiSearch?.results?.length) return;
    const n = aiSearch.results.length;
    if (!confirm(`검색 후보 ${n}건을 ${student.name} 학생의 배치 기록으로 저장할까요?\n\n같은 대학·학과·전형이 이미 있으면 최신 값으로 바뀝니다.`)) return;
    setBulkSaving(true);
    try {
      let list = placements;
      let saved = 0;
      for (const card of aiSearch.results) {
        const snap = buildSnapshot(card.entry, baseYear, cutPct);
        const ai = aiJudgments[card.key];
        if (ai) { snap.aiVerdict = ai.verdict; snap.aiReason = ai.reason; }
        const v = verdict(snap.cutSel ?? snap.cut70, grade);
        const dup = list.find((p) => p.unv_cd === card.univ.unvCd && p.dept === card.entry.dept
          && p.track === card.entry.track && p.type_name === card.entry.typeName);
        if (dup) {
          await api(`/api/board/placements/${dup.id}`, { method: 'DELETE' });
          list = list.filter((p) => p.id !== dup.id);
        }
        const j = await api(`/api/board/students/${student.id}/placements`, { method: 'POST', body: {
          unvCd: card.univ.unvCd, univName: card.univ.name, region: card.univ.region,
          dept: card.entry.dept, track: card.entry.track, typeName: card.entry.typeName,
          baseYear, grade, verdict: v ? v.label : '', snapshot: snap,
        } });
        if (!j.success) throw new Error(j.message || '저장 실패');
        list = [j.placement, ...list];
        saved += 1;
      }
      setPlacements(list);
      pendingReportRef.current = true;
      setError('');
      setAnalysisMsg(`✓ 후보 ${saved}건을 배치 기록으로 저장했습니다. 리포트의 배치 표·카드 분석에 그대로 들어갑니다.`);
    } catch (e) {
      if (e.auth) onAuthError?.(); else setError(`배치 저장 실패: ${e.message}`);
    } finally { setBulkSaving(false); }
  }

  async function savePlacement(card) {
    if (!student) return;
    setSavingKey(card.key);
    try {
      const snap = buildSnapshot(card.entry, baseYear, cutPct);
      const ai = aiJudgments[card.key];
      if (ai) { snap.aiVerdict = ai.verdict; snap.aiReason = ai.reason; }
      const v = verdict(snap.cutSel ?? snap.cut70, grade);
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
      const next = [j.placement, ...placements.filter((p) => p.id !== dup?.id)];
      setPlacements(next);
      pendingReportRef.current = true;   // 카드 복원이 끝나는 자리에서 쓴다(유의사항까지 담기게)
    } catch (e) {
      if (e.auth) onAuthError?.(); else setError(`배치 저장 실패: ${e.message}`);
    } finally { setSavingKey(''); }
  }

  async function removePlacement(p) {
    try {
      const j = await api(`/api/board/placements/${p.id}`, { method: 'DELETE' });
      if (j.success) {
        const next = placements.filter((x) => x.id !== p.id);
        setPlacements(next);
        pendingReportRef.current = true;
      }
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
        skypass: skypassFor(detail, e),
      });
    }
    out.sort((a, b) => a.entry.dept.localeCompare(b.entry.dept, 'ko'));
    return out;
  }, [detail, track, deptQ, baseYear]);

  // 배치 기록 한 줄 → 카드 한 장. 저장된 건 수치 스냅샷뿐이라 카드로 그리려면 원본 입결을 다시 읽어야 한다.
  function cardFromPlacement(p, d) {
    if (!d) return null;
    const e = (d.entries || []).find((x) => x.dept === p.dept && x.track === p.track && x.typeName === p.type_name);
    if (!e) return null;
    const sibs = p.track === '교과'
      ? (d.entries || [])
          .filter((s) => s.dept === p.dept && s.track === '종합' && Object.values(s.years).some((y) => y.grade70 != null))
          .sort((a, b) => Object.keys(b.years).length - Object.keys(a.years).length)
          .slice(0, 2)
      : [];
    return {
      key: `${d.unvCd}|${e.dept}|${e.track}|${e.typeName}`,
      univ: { unvCd: d.unvCd, name: d.name, region: d.region },
      entry: e, sunung: sunungFor(d, p.track), jonghapSiblings: sibs,
      skypass: skypassFor(d, e),
    };
  }

  // 배치가 저장되면(또는 학생을 바꾸면) 해당 대학 입결을 받아 카드로 되살린다.
  useEffect(() => {
    if (!placements.length) { setPlacementCards([]); return; }
    let alive = true;
    (async () => {
      const codes = [...new Set(placements.map((p) => p.unv_cd).filter(Boolean))];
      const missing = codes.filter((cd) => !univCache[cd]);
      if (missing.length) setPlCardsLoading(true);
      const fetched = {};
      for (const cd of missing) {
        try { const j = await api(`/api/ipgyeol/${cd}`); if (j.success) fetched[cd] = j; }
        catch (e) { if (e.auth) onAuthError?.(); }
      }
      if (!alive) return;
      const cache = { ...univCache, ...fetched };
      if (Object.keys(fetched).length) setUnivCache(cache);
      const cards = placements.map((p) => cardFromPlacement(p, cache[p.unv_cd])).filter(Boolean);
      setPlacementCards(cards);
      setPlCardsLoading(false);
      // 방금 배치를 바꿨다면 여기서 보고서를 쓴다. 카드가 손에 있는 이 자리라야
      // 유의사항(자체 환산등급 경고 등)까지 담긴다.
      if (pendingReportRef.current) {
        pendingReportRef.current = false;
        syncPlacementReport(placements, cards);
      }
    })();
    return () => { alive = false; };
  }, [placements]);

  function togglePin(card) {
    setPins((prev) => {
      const next = prev.some((p) => p.key === card.key) ? prev.filter((p) => p.key !== card.key) : [...prev, card];
      try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }
  // 선택한 백분위 컷이 이 대학·전형에 실제로 몇 개나 공개돼 있는지 (빈 화면을 오해하지 않게)
  const cutCoverage = useMemo(
    () => cards.filter((c) => Object.values(c.entry.years).some((y) => y[cutField(cutPct)] != null)).length,
    [cards, cutPct],
  );

  const pinnedKeys = new Set(pins.map((p) => p.key));
  // 고정 카드·배치 카드는 위쪽에 이미 떠 있으므로 아래 목록에서는 뺀다(같은 카드가 두 번 보이지 않게)
  const autoKeys = new Set([...pinnedKeys, ...placementCards.map((c) => c.key)]);
  const unpinnedCards = cards.filter((c) => !autoKeys.has(c.key));
  const plOnlyCards = placementCards.filter((c) => !pinnedKeys.has(c.key));

  // 리포트에 실릴 카드 = 고정 + 배치 + 지금 화면의 카드
  const reportCards = useMemo(() => {
    const all = [...pins, ...placementCards, ...(detail ? unpinnedCards.slice(0, limit) : [])];
    return all.filter((c, i, arr) => arr.findIndex((x) => x.key === c.key) === i);
  }, [pins, placementCards, cards, limit, detail, track, deptQ]);

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
            <span style={S.ctrlLabel}>학생 내신 등급 <span style={S.ctrlHint}>(최종등급 {cutPct}%컷 대비)</span></span>
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
          <div style={S.ctrlGroup}>
            <span style={S.ctrlLabel}>기준 합격선 <span style={S.ctrlHint}>(최종등록자 백분위 컷)</span></span>
            <div style={S.segRow}>
              {CUT_OPTS.map((p) => (
                <button key={p} onClick={() => setCutPct(p)} style={{ ...S.segBtn, ...(cutPct === p ? S.segOn : {}) }}>{p}%</button>
              ))}
            </div>
            <span style={S.ctrlHint}>
              {cutPct >= 85
                ? `${cutPct}%컷은 제출한 대학이 매우 적습니다${cards.length ? ` — 이 대학 ${track} 카드 ${cards.length}개 중 ${cutCoverage}개 공개` : ''}`
                : cutPct === 50 ? '50%컷 = 합격자 절반이 이 성적 이상 (70%컷보다 문턱이 높게 보입니다)'
                  : '70%컷 = 합격자 70%가 이 성적 이상 (통상 기준선)'}
            </span>
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
              {student && (
                <button style={{ ...S.assignBtn, ...(assigned ? S.assignDone : {}) }} disabled={assigning || assigned}
                  title="검색어·조건·요약·후보 목록을 이 학생의 기록으로 저장합니다. 상담·브리핑에서 근거로 쓰입니다."
                  onClick={assignSearchToStudent}>
                  {assigning ? '배정 중…' : assigned ? `✓ ${student.name} 기록에 저장됨` : `📋 ${student.name} 학생에 배정`}
                </button>
              )}
              {student && aiSearch.results.length > 0 && (
                <button style={S.aiBtn} onClick={saveSearchAsPlacements} disabled={bulkSaving}
                  title="후보를 모두 배치 기록으로 저장합니다. 리포트의 배치 표·전형 카드 분석이 이 기록으로 채워집니다.">
                  {bulkSaving ? '🎯 배치 저장 중…' : `🎯 후보 ${aiSearch.results.length}건 배치 기록으로`}
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
                  <Card key={`ai-${c.key}`} card={c} grade={grade} baseYear={baseYear} cutPct={cutPct} onPin={togglePin}
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
                    {openRecId === r.id && (editRec?.id === r.id ? (
                      <div style={S.recEditBox}>
                        <input style={S.recEditTitle} value={editRec.title}
                          onChange={(e) => setEditRec({ ...editRec, title: e.target.value })}
                          placeholder="제목" />
                        <textarea style={S.recEditBody} value={editRec.content} rows={12}
                          onChange={(e) => setEditRec({ ...editRec, content: e.target.value })}
                          placeholder="본문" />
                        <div style={S.recBtnRow}>
                          <button style={S.recSaveBtn} onClick={saveRecord} disabled={recBusy}>
                            {recBusy ? '저장 중…' : '저장'}
                          </button>
                          <button style={S.recCancelBtn} onClick={() => setEditRec(null)} disabled={recBusy}>취소</button>
                          <span style={S.recHint}>고친 내용은 학생 기록에 그대로 저장되고, AI 판정·리포트도 이 글을 읽습니다</span>
                        </div>
                      </div>
                    ) : (
                      <div style={S.recBody}>
                        {r.content || '(본문 없음)'}
                        <div style={S.recBtnRow}>
                          <button style={S.recEditBtn}
                            onClick={() => setEditRec({ id: r.id, title: r.title || '', content: r.content || '' })}>
                            ✏ 고치기
                          </button>
                          <button style={S.recEditBtn} title="이 글을 그대로 실어 인쇄용 리포트를 만듭니다"
                            onClick={() => openReportWithRecord(r)}>📄 리포트로 만들기</button>
                          <button style={S.recDelBtn} onClick={() => removeRecord(r)} disabled={recBusy}>🗑 삭제</button>
                        </div>
                        {/* 이 글이 맞는지 다른 회사 모델들에게 물어본다 — 쓴 모델은 자기 글을 옹호한다 */}
                        <VerifyPanel kind={/입결|배치|판정/.test(r.type || '') ? 'ipgyeol' : /로드맵/.test(r.type || '') ? 'roadmap' : /분석|생기부|세특/.test(r.type || '') ? 'saenggibu' : 'record'}
                          text={r.content || ''}
                          context={`[글 제목] ${r.title || '(제목 없음)'}\n${verifyContextFor(r)}`}
                          onApply={(t) => applyToRecord(r, t)}
                          onAuthError={onAuthError} />
                      </div>
                    ))}
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
              <button style={S.aiBtn} onClick={() => runAiJudge()} disabled={aiJudging || (!detail && !placementCards.length)}
                title="학생의 생기부 분석 내용과 카드의 입결 데이터를 종합해 AI가 학과별 배치를 판정합니다">
                {aiJudging ? '🤖 AI 판정 중…' : '🤖 생기부 기반 AI 종합 판정'}
              </button>
              <button style={S.reportBtn} onClick={() => setReportOpen(true)}
                title="제목·총평·포함 항목을 고친 뒤 인쇄용 리포트를 엽니다"
                disabled={!placements.length && !aiSearch && !reportCards.length}>
                📄 입결 리포트 편집·인쇄
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
                    const sc = snapCut(snap);
                    const savedV = verdict(sc.v, Number(p.grade));
                    const nowV = verdict(sc.v, grade);
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
                          {sc.pct}%컷 {sc.v != null ? Number(sc.v).toFixed(2) : '—'}({sc.year || p.base_year}) ·
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

        {/* 배치 카드 — 배치 저장만 하면 고정하지 않아도 여기에 뜬다 */}
        {student && (plOnlyCards.length > 0 || plCardsLoading) && (
          <>
            <div style={S.pinHead}>
              🎯 {student.name} 학생 배치 카드
              <span style={S.pinHint}>배치 저장한 전형은 고정(📌)하지 않아도 자동으로 표시됩니다</span>
            </div>
            {plCardsLoading && !plOnlyCards.length && <div style={S.placeholder}>배치한 전형의 입결 카드를 불러오는 중…</div>}
            {plOnlyCards.length > 0 && (
              <div style={S.grid}>
                {plOnlyCards.map((c) => (
                  <Card key={`pl-${c.key}`} card={c} grade={grade} baseYear={baseYear} cutPct={cutPct} onPin={togglePin}
                    pinned={false} student={student} onSave={savePlacement} saving={savingKey === c.key}
                    saved={isSaved(c)} onDetail={openDetail} ai={aiJudgments[c.key]} />
                ))}
              </div>
            )}
          </>
        )}

        {/* 고정 카드 */}
        {pins.length > 0 && (
          <>
            <div style={S.pinHead}>📌 고정 카드 (대학 간 비교)</div>
            <div style={S.grid}>
              {pins.map((c) => (
                <Card key={c.key} card={c} grade={grade} baseYear={baseYear} cutPct={cutPct} onPin={togglePin} pinned
                  student={student} onSave={savePlacement} saving={savingKey === c.key} saved={isSaved(c)} onDetail={openDetail}
                  ai={aiJudgments[c.key]} />
              ))}
            </div>
          </>
        )}

        {!selected && !pins.length && !plOnlyCards.length && (
          <div style={S.placeholder}>위 검색창에서 대학을 선택하면 학과별 입결 카드가 표시됩니다.<br />
            <span style={{ fontSize: 12.5, color: '#98a4b3' }}>카드의 📍 버튼으로 고정하면 다른 대학과 나란히 비교할 수 있습니다.</span></div>
        )}
        {loading && <div style={S.placeholder}>입결 자료 불러오는 중…</div>}

        {detail && (
          <div style={S.grid}>
            {unpinnedCards.slice(0, limit).map((c) => (
              <Card key={c.key} card={c} grade={grade} baseYear={baseYear} cutPct={cutPct} onPin={togglePin} pinned={false}
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

        {reportOpen && (
          <ReportModal rep={rep} setRep={setRep} off={repOff} setOff={setRepOff} memo={repMemo} setMemo={setRepMemo}
            placements={placements} aiSearch={aiSearch} cards={reportCards} student={student}
            grade={grade} baseYear={baseYear}
            analysis={analysis} analyzing={analyzing} analysisMsg={analysisMsg}
            onAnalyze={() => runReportAnalysis(reportCards.filter((c) => !repOff[`cd-${c.key}`]))}
            assigningReport={assigningReport} assignedReport={assignedReport} onAssign={assignReportToStudent}
            verifyText={reportToText()} verifyContext={verifyContextFor()}
            records={dossier?.records || []} recOn={repRecOn}
            onToggleRec={(id) => setRepRecOn((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
            onClose={() => setReportOpen(false)}
            onPrint={() => { setReportOpen(false); buildIpgyeolReport(); }} />
        )}

        {detailCard && (
          <DetailModal card={detailCard} guide={guideCache[detailCard.univ.unvCd]}
            guideLoading={guideLoading} onClose={() => setDetailCard(null)} />
        )}

        <p style={S.footNote}>
          출처: 대학어디가(한국대학교육협의회) 공식 발표 입시결과. 2021~2025는 발표자료 취합본, 2026은 어디가 대학별
          입시결과 서비스 수집분입니다. ‘실질경쟁률(추정)’은 충원인원을 반영한 단순 추정치이며, ‘환산 득점률’은
          환산점수 70%컷 ÷ 학생부 총점입니다. 합격선은 어디가가 발표하는 백분위(50·70%, 일부 대학 85·90·100%)만
          고를 수 있고 40%·20%컷은 발표 항목 자체가 없습니다. 배치 판정(안정·적정·소신·위험)은 선택한 컷과 입력 내신의 차이에 따른
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
  rpRecRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 2px', borderBottom: '1px solid #f2f5f9', cursor: 'pointer' },
  rpRecTitle: { flex: 1, fontSize: 12.5, color: '#26313e', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
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
  assignBtn: { border: '1px solid #bfe0d6', background: '#e8f7f2', color: '#0f766e', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  assignDone: { background: '#e6f6ee', border: '1px solid #bfe8d2', color: '#1a7f4e', cursor: 'default' },
  reportBtn: { border: '1px solid #d7dfea', background: '#fff', color: '#1d4fa8', borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
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
  // 기록 고치기 — 콘솔 안에서 바로 손보는 자리
  recEditBox: { padding: '8px 10px', background: '#131a24', borderTop: '1px solid #223047' },
  recEditTitle: { width: '100%', padding: '6px 8px', marginBottom: 6, borderRadius: 6, border: '1px solid #2b3a52', background: '#0e141d', color: '#e6edf6', fontSize: 12.5 },
  recEditBody: { width: '100%', padding: '7px 9px', borderRadius: 6, border: '1px solid #2b3a52', background: '#0e141d', color: '#cdd8e6', fontSize: 12, lineHeight: 1.6, fontFamily: 'inherit', resize: 'vertical' },
  recBtnRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' },
  recSaveBtn: { padding: '5px 12px', borderRadius: 6, border: 'none', background: '#3b6fd4', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  recCancelBtn: { padding: '5px 10px', borderRadius: 6, border: '1px solid #2b3a52', background: 'transparent', color: '#8fa3bd', fontSize: 12, cursor: 'pointer' },
  recEditBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid #2b3a52', background: 'transparent', color: '#8fb4ea', fontSize: 11.5, cursor: 'pointer' },
  recDelBtn: { padding: '4px 10px', borderRadius: 6, border: '1px solid #4a2b2b', background: 'transparent', color: '#d98a8a', fontSize: 11.5, cursor: 'pointer' },
  recHint: { fontSize: 10.5, color: '#6b7c92' },
  // 지원 시 유의사항 — 숫자 위에 놓아 먼저 읽히게 한다(숫자를 어떻게 읽을지 정해 주는 말이라서)
  skypassBox: { marginTop: 8, padding: '7px 9px', borderRadius: 8, background: '#2a2118', border: '1px solid #5a4426' },
  skypassHead: { fontSize: 10.5, fontWeight: 700, color: '#d9a441', marginBottom: 4 },
  skypassWarn: { fontSize: 11.5, lineHeight: 1.5, color: '#f0c674', fontWeight: 600, marginBottom: 3 },
  skypassItem: { fontSize: 11.5, lineHeight: 1.5, color: '#cbb894', marginBottom: 2 },
  skypassScope: { fontSize: 9.5, color: '#8a7a5c', border: '1px solid #5a4426', borderRadius: 4, padding: '0 4px', marginRight: 5 },
  scaleWarnBadge: { textAlign: 'center', fontSize: 10, fontWeight: 700, lineHeight: 1.25, border: '1px solid #5a4426', borderRadius: 8, padding: '3px 8px', color: '#f0c674', background: '#2a2118' },
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
  pinHead: { fontSize: 13, fontWeight: 800, color: '#3d4a5c', margin: '2px 0 8px', display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' },
  pinHint: { fontSize: 11.5, fontWeight: 500, color: '#8492a5' },
  // 리포트 편집 모달
  rpSec: { fontSize: 12.5, fontWeight: 800, color: '#1d4fa8', margin: '16px 0 8px', paddingTop: 10, borderTop: '1px solid #eef2f7' },
  rpGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 },
  rpField: { display: 'flex', flexDirection: 'column', gap: 4 },
  rpLabel: { fontSize: 11.5, fontWeight: 700, color: '#5c6b7c' },
  rpInput: { border: '1px solid #d7dfea', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: '#fff', color: '#26313e', outline: 'none' },
  rpArea: { width: '100%', border: '1px solid #d7dfea', borderRadius: 8, padding: '9px 11px', fontSize: 13, lineHeight: 1.7, background: '#fff', color: '#26313e', outline: 'none', resize: 'vertical', fontFamily: 'inherit' },
  rpToggles: { display: 'flex', flexWrap: 'wrap', gap: 14 },
  rpChk: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, color: '#3d4a5c', cursor: 'pointer' },
  rpItem: { borderBottom: '1px solid #f2f5f9', padding: '6px 0' },
  rpItemHead: { display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' },
  rpItemName: { fontSize: 12.5, fontWeight: 700, color: '#26313e' },
  rpItemDim: { color: '#b3bdc9', textDecoration: 'line-through' },
  rpItemSub: { fontSize: 11.5, color: '#8492a5' },
  rpMemo: { width: '100%', marginTop: 4, border: '1px solid #e3e9f1', borderRadius: 7, padding: '5px 9px', fontSize: 12, background: '#fbfcfe', color: '#26313e', outline: 'none' },
  rpAnalyBox: { background: '#faf8ff', border: '1px solid #e6dcfa', borderRadius: 10, padding: '10px 12px', marginTop: 8 },
  rpAnalyRow: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  rpAnaly: { border: 'none', background: '#6b46c1', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' },
  rpAnalyBusy: { background: '#b9a8e6', cursor: 'default' },
  rpAnalyMsg: { fontSize: 11.5, color: '#8492a5', flex: 1, minWidth: 200, lineHeight: 1.5 },
  rpAnalyPrev: { marginTop: 9, fontSize: 12, lineHeight: 1.7, color: '#3d4a5c', background: '#fff', border: '1px solid #ece5fb', borderRadius: 8, padding: '9px 11px', maxHeight: 200, overflowY: 'auto' },
  rpFoot: { display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginTop: 18, paddingTop: 12, borderTop: '1px solid #eef2f7' },
  rpHint: { fontSize: 11.5, color: '#8492a5', marginLeft: 'auto' },
  rpReset: { border: '1px solid #e3e9f1', background: '#fff', color: '#8492a5', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  rpCancel: { border: '1px solid #d7dfea', background: '#fff', color: '#5c6b7c', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  rpAssign: { border: '1px solid #c3dcf7', background: '#e8f1fc', color: '#1d4fa8', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' },
  rpAssignDone: { background: '#e6f6ee', border: '1px solid #bfe8d2', color: '#1a7f4e', cursor: 'default' },
  rpGo: { border: 'none', background: '#2b6fe3', color: '#fff', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 800, cursor: 'pointer' },
  placeholder: { background: '#fff', border: '1px dashed #d7dfea', borderRadius: 12, padding: '38px 20px', textAlign: 'center', color: '#5c6b7c', fontSize: 14, lineHeight: 1.7, marginBottom: 12 },
  moreBtn: { display: 'block', margin: '0 auto 10px', border: '1px solid #d7dfea', background: '#fff', color: '#1d4fa8', borderRadius: 9, padding: '8px 22px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  error: { background: '#fdeaea', border: '1px solid #f5c6c6', color: '#b33', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12 },
  footNote: { fontSize: 11, color: '#98a4b3', lineHeight: 1.6, margin: '6px 2px 0' },
};
