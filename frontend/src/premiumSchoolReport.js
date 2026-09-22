// premiumSchoolReport.js — 학교 입시 해설 보고서 '프리미엄 디자인'(A4 세로 매거진형 HTML)
//
// 같은 보고서(제목 + 마크다운 본문 + 수치 블록 data)를 두 가지 디자인으로 낸다:
//   · 베이직  — 화면 미리보기(ReportVisual/StructuredBody)와 서버 PDF·Word (기존 그대로)
//   · 프리미엄 — 이 파일. 표지·성취도 화보·유리/불리 카드·마무리 페이지로 짜인 A4 인쇄용 HTML 한 벌
//
// 내용은 AI 본문을 그대로 쓴다 — 여기서 새 문장을 지어내지 않는다.
//   ## 한눈에 보기        → 표지(요약 + [지표] 스코어카드)
//   data.schools          → 표지 학교 카드 · 2쪽 성취도 화보(국·영·수 A~E 분포, 학년별 추이)
//   나머지 ##/### 섹션     → 3쪽부터 흘려 담는다(유리/불리는 색 카드, 표는 표, [전형]은 막대)
//   ## 유의사항           → 마지막 쪽 어두운 상자 + 브랜드 마무리
//
// 인쇄(브라우저 → PDF 저장)를 전제로 만든 문서다. 쪽이 넘치면 그 쪽이 자연스럽게 나뉘도록
// .page 는 flex 세로 + min-height 로만 잡고(고정 height·overflow:hidden 금지) 꼬리말을 아래에 붙인다.
import { parseReport } from './reportMarkdown';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
const pad2 = (n) => String(n).padStart(2, '0');
const fmtN = (v, unit = '') => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('ko-KR')}${unit}`);
// 평균 점수는 소수 첫째 자리까지 — 70 이 '70.0' 으로 보여야 공시 표와 같은 눈금으로 읽힌다
const fmt1 = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '—' : Number(v).toFixed(1));
const shortName = (n) => String(n || '').replace(/(고등|중)학교$/, '');

// 학교 색 — 화면(SCHOOL_COLORS)과 같은 순서, 밝은 종이에 맞춘 톤
const COLORS = ['#2d6fd2', '#15977f', '#b4770e', '#b3445c'];
const BAND = { a: '#1f5fb8', b: '#6f9fda', c: '#aec6e4', d: '#efc178', e: '#e28b84' };
const FAMILIES = ['국어', '영어', '수학'];

// 섹션 제목 → 쪽 머리(영문 눈썹)
const EYEBROW = [
  [/항목별|비교/, 'SIDE BY SIDE'],
  [/성취도/, 'ACADEMIC PROFILE'],
  [/규모|등급 구조/, 'SCALE & GRADES'],
  [/과목|교육과정|선택/, 'CURRICULUM & PATHWAY'],
  [/추천|학생 유형/, 'STUDENT FIT'],
  [/유리/, 'GOOD FIT'],
  [/불리/, 'WATCH OUT'],
  [/전략/, 'STRATEGY'],
  [/유의|한계/, 'FINAL CHECK'],
];
const eyebrowOf = (title) => (EYEBROW.find(([re]) => re.test(title || ''))?.[1]) || 'SCHOOL REPORT';

// ── 본문 조각 ─────────────────────────────────────────────────
// 마크다운 한 덩어리(문단·목록·표)를 밝은 테마 HTML 로. 제목(#)은 섹션 렌더러가 따로 그린다.
function mdBlock(lines) {
  const out = [];
  let i = 0, para = [];
  const flush = () => { if (para.length) { out.push(`<p class="pp">${inline(para.join(' '))}</p>`); para = []; } };
  while (i < lines.length) {
    const t = String(lines[i] ?? '').trim();
    if (!t) { flush(); i++; continue; }
    if (t.startsWith('|')) {
      flush();
      const block = [];
      while (i < lines.length && String(lines[i]).trim().startsWith('|')) { block.push(lines[i]); i++; }
      out.push(tableHtml(block));
      continue;
    }
    if (/^\s*[-*•]\s+/.test(t)) {
      flush();
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(String(lines[i]).trim())) { items.push(String(lines[i]).trim().replace(/^[-*•]\s+/, '')); i++; }
      out.push(`<ul class="list">${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    para.push(t); i++;
  }
  flush();
  return out.join('');
}

function tableHtml(block) {
  const rows = block.filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l)).map((r) => r.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim()));
  if (!rows.length) return '';
  const head = rows[0], body = rows.slice(1);
  return `<table class="tbl"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`
    + `<tbody>${body.map((r) => `<tr>${r.map((c, ci) => `<td${ci === 0 ? ' class="k"' : ''}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

// "- **학생 유형** — 근거" 꼴 글머리표 → 색 카드(유리=초록, 불리=주황)
const bulletOf = (line) => {
  const m = String(line).match(/^\s*[-*•]\s+(?:\*\*(.+?)\*\*|(.+?))\s*(?:[—–:]\s*|$)(.*)$/);
  if (!m) return null;
  const who = (m[1] || m[2] || '').trim(), why = (m[3] || '').trim();
  return who ? { who, why } : null;
};
function fitCards(items, kind) {
  if (!items.length) return '';
  return `<div class="fitgrid">${items.map((it) => `
    <div class="fit ${kind}">
      <div class="fit-mark">${kind === 'good' ? '유리' : '유의'}</div>
      <div class="fit-who">${inline(it.who)}</div>
      ${it.why ? `<div class="fit-why">${inline(it.why)}</div>` : ''}
    </div>`).join('')}</div>`;
}

// [전형] 줄 → 막대
function trackHtml(line, names) {
  const m = String(line).match(/^\s*\[전형\]\s*(?:([^:：]{1,20})[:：]\s*)?(.+)$/);
  if (!m) return null;
  const parts = m[2].split(/\s*[·,]\s*/).map((p) => p.trim()).filter(Boolean);
  const scores = parts.map((p) => { const s = p.match(/(\d(?:\.\d)?)\s*\/\s*5/); return s ? { who: p.slice(0, s.index).trim(), score: Number(s[1]) } : null; }).filter(Boolean);
  if (!scores.length) return null;
  const idx = m[1] ? Math.max(0, names.findIndex((n) => n.includes(m[1]) || m[1].includes(n))) : 0;
  const color = COLORS[idx % COLORS.length];
  return `<div class="trk">${m[1] ? `<div class="trk-who" style="color:${color}">${esc(m[1])}</div>` : ''}
    ${scores.map((s) => `<div class="trk-cell"><span class="trk-label">${esc(s.who)}</span><span class="trk-bar"><i style="width:${(s.score / 5 * 100).toFixed(0)}%;background:${color}"></i></span><span class="trk-score">${s.score}/5</span></div>`).join('')}</div>`;
}

// [지표] 스코어카드(학교마다 점 5개)
function indicatorsHtml(inds, names) {
  if (!inds.length) return '';
  const many = names.length > 1;
  const dots = (score, color) => {
    const on = Math.round(Math.max(0, Math.min(5, score)));
    return `<span class="dots" style="color:${color}">${'●'.repeat(on)}<span class="off">${'●'.repeat(5 - on)}</span> <em>${score}/5</em></span>`;
  };
  return `<div class="score">
    ${inds.map((ind) => `<div class="score-row" style="grid-template-columns:120px repeat(${names.length}, 108px) minmax(0,1fr)">
      <span class="score-label">${inline(ind.label)}</span>
      ${names.map((n, i) => {
        const sc = many ? (ind.scores.find((x) => x.who && (n.includes(x.who) || x.who.includes(n))) || ind.scores[i]) : ind.scores[0];
        return `<span>${sc ? dots(sc.score, COLORS[i % COLORS.length]) : '—'}</span>`;
      }).join('')}
      <span class="score-note">${inline(ind.note || '')}</span>
    </div>`).join('')}
  </div>`;
}

// ── 1쪽: 표지 ─────────────────────────────────────────────────
function coverPage({ rep, data, brand, kind, focus, names, title }) {
  const schools = data.schools;
  const isHigh = schools.every((s) => s.level === '고등학교');
  const summarySec = rep.sections.find((s) => /한눈에/.test(s.title));
  const summary = (summarySec?.lines || []).filter((l) => l.trim() && !/^\s*\[(지표|전형)\]/.test(l)).join(' ').replace(/^\s*[-*•]\s+/gm, '').trim();
  const inds = rep.indicators.filter((x) => /한눈에/.test(x.section) || !x.section);
  const heads = schools.map((s, i) => `<span style="color:${COLORS[i % COLORS.length]}">${esc(s.name)}</span>`).join('<span class="vs">VS</span>');

  const card = (s, i) => {
    const st = s.stats || {};
    const cells = [
      ['전체 재적', fmtN(st.total, '명'), [st.g1, st.g2, st.g3].map((x) => fmtN(x)).join('·')],
      [`${isHigh ? '고' : '중'}1 재적`, fmtN(st.g1, '명'), '1학년'],
      isHigh ? ['1등급 예상 인원', st.seats ? `약 ${fmtN(st.seats)}명` : '—', '5등급제 10%'] : ['개설 과목', fmtN(s.subjects, '개'), '공시 기준'],
      ['학급 수', fmtN(st.classes, '개'), ''],
      ['교원 수', fmtN(st.teachers, '명'), st.students ? `학생 ${fmtN(st.students)}명` : ''],
      ['3단계 과목', fmtN(s.threeStep, '개'), 'A·B·C 공시'],
    ];
    return `<div class="card" style="border-top-color:${COLORS[i % COLORS.length]}">
      <div class="school">${esc(s.name)}</div>
      <div class="meta">${esc((s.chips || []).join(' · '))}</div>
      <div class="stats">${cells.map(([l, v, h]) => `<div class="stat"><span>${esc(l)}</span><b style="color:${COLORS[i % COLORS.length]}">${esc(v)}</b><span>${esc(h)}</span></div>`).join('')}</div>
    </div>`;
  };

  return `<section class="page hero">
  <div class="eyebrow">${esc(brand.reportTitle || 'SCHOOL REPORT')}</div><div class="num">01</div>
  <div class="page-main">
    <div class="kicker">${kind === 'compare' ? '고교·중학 공시정보 입시 비교 리포트' : '고교·중학 공시정보 입시 해설 리포트'}</div>
    <h1 class="title cover-title">${heads}</h1>
    ${summary ? `<p class="subtitle">${inline(summary.slice(0, 260))}</p>` : `<p class="subtitle">학교 선택에서 중요한 것은 ‘어느 학교가 더 좋은가’가 아니라 <b>어떤 환경이 우리 아이에게 맞는가</b>입니다.</p>`}
    ${focus ? `<div class="chip">상담 대상 · ${esc(focus).slice(0, 90)}</div>` : ''}
    <div class="rule"></div>
    <div class="grid" style="grid-template-columns:repeat(${Math.min(schools.length, 2)}, minmax(0,1fr))">${schools.map(card).join('')}</div>
    ${inds.length ? `<div class="callout"><strong>한눈에 보는 다섯 가지 지표</strong>${indicatorsHtml(inds, names)}<div class="callout-fine">점이 많을수록 그 성질이 강하다는 뜻입니다. 좋고 나쁨이 아니라 ‘어떤 학생에게 맞는가’를 읽는 눈금입니다.</div></div>` : ''}
    <p class="bigline">“숫자는 학교를 서열화하기 위한 것이 아니라,<br>우리 아이에게 맞는 환경을 더 정확히 보기 위한 자료입니다.”</p>
  </div>
  ${footer(brand, 1, title)}
</section>`;
}

// ── 2쪽: 성취도 화보 ───────────────────────────────────────────
function profilePage({ data, brand, names, title, pageNo, total }) {
  const schools = data.schools;
  const many = schools.length > 1;
  const isHigh = schools.every((s) => s.level === '고등학교');
  const grades = [1, 2, 3].filter((g) => schools.some((s) => s.core?.[g]));
  if (!grades.length) return '';
  const g0 = grades[0];
  const label = (g) => `${isHigh ? '고' : '중'}${g}`;

  const bandBar = (b) => `<div class="bar">${['a', 'b', 'c', 'd', 'e'].map((k) => (b[k] ? `<i style="width:${b[k]}%;background:${BAND[k]}">${b[k] >= 9 ? Math.round(b[k]) : ''}</i>` : '')).join('')}</div>`;
  const cell = (s, f) => {
    const b = s.core?.[g0]?.[f];
    if (!b) return `<div class="cmp-cell"><span class="fine">공시 없음</span></div>`;
    return `<div class="cmp-cell">
      <b class="mean">평균 ${fmt1(b.mean)}</b>
      ${bandBar(b)}
      <span class="fine">${esc(b.subject.replace(/\s*\[.*\]$/, ''))} · A ${fmtN(b.a)}%${b.e === null || b.e === undefined ? '' : ` · E ${fmtN(b.e)}%`}</span>
    </div>`;
  };

  const trendCard = (f) => {
    const rows = schools.map((s, i) => {
      const series = grades.map((g) => (s.core?.[g]?.[f] ? fmt1(s.core[g][f].mean) : '—')).join(' → ');
      return `<div class="trend-row" style="color:${COLORS[i % COLORS.length]}"><b>${esc(many ? shortName(s.name) : label(grades[0]) + '~')}</b> ${esc(series)}</div>`;
    }).join('');
    return `<div class="mini"><h3>${f}</h3>${rows}<div class="fine">${grades.map(label).join(' → ')} 평균</div></div>`;
  };

  return `<section class="page">
  <div class="eyebrow">ACADEMIC PROFILE</div><div class="num">${pad2(pageNo)}</div>
  <div class="page-main">
    <h2 class="title mid">실제 학업성취도로 보는<br>${many ? '학교별 차이' : '이 학교의 분포'}</h2>
    <p class="section-desc">${data.year ? `${esc(data.year)} 공시 기준 · ` : ''}A~E는 절대평가 성취도이며 1~5등급(상대평가)과 다른 지표입니다.</p>
    <div class="legend">${['a', 'b', 'c', 'd', 'e'].map((k) => `<span><i style="background:${BAND[k]}"></i>${k.toUpperCase()}</span>`).join('')}<span class="fine">막대 = A~E 비율(%)</span></div>
    <div class="cmp" style="grid-template-columns:110px repeat(${schools.length}, minmax(0,1fr))">
      <div class="cmp-head">${label(g0)} 주요 과목</div>
      ${schools.map((s, i) => `<div class="cmp-head" style="color:${COLORS[i % COLORS.length]}">${esc(s.name)}</div>`).join('')}
      ${FAMILIES.filter((f) => schools.some((s) => s.core?.[g0]?.[f])).map((f) => `
        <div class="cmp-key"><b>${f}</b></div>
        ${schools.map((s) => cell(s, f)).join('')}`).join('')}
    </div>
    ${grades.length > 1 ? `<h3 class="section-title">학년별 평균 점수</h3><div class="grid3">${FAMILIES.filter((f) => schools.some((s) => grades.some((g) => s.core?.[g]?.[f]))).map(trendCard).join('')}</div>` : ''}
    <div class="callout">
      <strong>읽는 법이 중요합니다.</strong>
      <p>평균이 높다고 내신이 반드시 불리하거나 유리한 것은 아닙니다. A 비율 역시 1등급 비율이 아닙니다. 시험 난도와 학생 구성, 선택과목 수강자에 따라 분포가 달라지므로 <b>평균 · A/E 비율 · 학생 규모를 함께</b> 봐야 합니다.</p>
    </div>
    <p class="fine">같은 학년은 뒤 학기 값입니다. 종합고는 전체계열 → 일반계 순으로 읽었습니다. 막대 안 숫자는 비율(%)입니다.</p>
  </div>
  ${footer(brand, pageNo, title)}
</section>`;
}

// ── 3쪽 이후: AI 본문 섹션 흘려 담기 ────────────────────────────
function sectionHtml(sec, names, hideTitle) {
  const isFav = /유리/.test(sec.title) && !/불리/.test(sec.title);
  const isUnfav = /불리/.test(sec.title);
  const lines = sec.lines || [];
  const tracks = lines.map((l) => trackHtml(l, names)).filter(Boolean);
  const body = lines.filter((l) => !/^\s*\[(지표|전형)\]/.test(l));
  let inner = '';
  if (isFav || isUnfav) {
    const items = body.map(bulletOf).filter(Boolean);
    const rest = body.filter((l) => !/^\s*[-*•]\s+/.test(l));
    inner = mdBlock(rest) + fitCards(items, isFav ? 'good' : 'watch');
  } else {
    inner = mdBlock(body);
  }
  // 쪽 제목으로 이미 크게 찍은 섹션은 본문에서 제목을 숨긴다(제목 자체는 지우지 않는다 — 유리/불리 판단에 쓰인다)
  const head = sec.title && !hideTitle
    ? (sec.level >= 3 ? `<h4 class="sub-head">${inline(sec.title)}</h4>` : `<h3 class="section-title">${inline(sec.title)}</h3>`)
    : '';
  return `<div class="blk">${head}${tracks.join('')}${inner}</div>`;
}

const weightOf = (sec) => (sec.lines || []).reduce((n, l) => n + String(l).length + (/^\s*[-*•|]/.test(l) ? 40 : 0), 0) + (sec.title ? 90 : 0);

function flowPages({ rep, brand, names, title, startNo }) {
  const skip = (t) => /한눈에/.test(t) || /유의|한계/.test(t);
  const secs = rep.sections.filter((s) => !skip(s.title) && ((s.lines || []).some((l) => l.trim()) || s.title));
  const pages = [];
  let cur = [], w = 0;
  for (const sec of secs) {
    const ww = weightOf(sec);
    // 한 쪽에 1,400자 남짓 — 넘치면 인쇄가 자연스럽게 나눠 준다(잘리지 않는다)
    if (cur.length && w + ww > 1400 && sec.level <= 2) { pages.push(cur); cur = []; w = 0; }
    cur.push(sec); w += ww;
  }
  if (cur.length) pages.push(cur);
  return pages.map((group, k) => {
    const lead = group.find((s) => s.level <= 2) || group[0];
    const no = startNo + k;
    return `<section class="page">
  <div class="eyebrow">${esc(eyebrowOf(lead.title))}</div><div class="num">${pad2(no)}</div>
  <div class="page-main">
    <h2 class="title mid">${inline(lead.title || '해설')}</h2>
    ${group.map((s) => sectionHtml(s, names, s === lead)).join('')}
  </div>
  ${footer(brand, no, title)}
</section>`;
  });
}

// ── 마지막 쪽: 유의사항 + 마무리 ───────────────────────────────
function closingPage({ rep, brand, title, pageNo }) {
  const sec = rep.sections.find((s) => /유의|한계/.test(s.title));
  const body = sec ? mdBlock((sec.lines || []).filter((l) => !/^\s*\[(지표|전형)\]/.test(l))) : '';
  return `<section class="page hero">
  <div class="eyebrow">FINAL CHECK</div><div class="num">${pad2(pageNo)}</div>
  <div class="page-main">
    <h2 class="title mid">결정하기 전,<br>반드시 확인해야 할 것</h2>
    <p class="section-desc">공시자료는 중요한 출발점이지만 학교 선택의 전부는 아닙니다.</p>
    <div class="grid2">
      ${[['① 최근 과목별 등급컷', '성취도 A~E와 실제 상대평가 등급은 다릅니다. 최근 1학년 주요 과목의 실제 등급 형성 수준을 확인합니다.'],
      ['② 수행평가 · 서술형', '지필평가 외 수행평가 비중과 평가 방식, 서술형 난도도 내신에 큰 영향을 줍니다.'],
      ['③ 선택과목 수강 인원', '관심 과목이 실제 개설되는지, 몇 명이 수강하는지 학교 설명회와 교육과정 자료에서 확인합니다.'],
      ['④ 세특 운영 방식', '수업 참여와 탐구 결과를 어떻게 학생부에 연결하는지 재학생 경험과 학교 안내를 함께 봅니다.'],
      ['⑤ 학습 분위기', '자율학습, 방과후, 친구 관계 등 학생이 실제로 생활하게 될 환경도 중요합니다.'],
      ['⑥ 통학과 생활 리듬', '통학시간은 3년간 반복됩니다. 수면 · 자습시간 · 학원 이동까지 포함해 현실적으로 계산합니다.']]
      .map(([h, p]) => `<div class="mini"><h3>${h}</h3><p>${p}</p></div>`).join('')}
    </div>
    ${body ? `<div class="callout"><strong>자료 해석 시 유의사항</strong>${body}</div>` : ''}
    <div class="closing">
      <div class="eyebrow">THE RIGHT ENVIRONMENT FOR THE RIGHT STUDENT</div>
      <h2>좋은 학교를 찾는 것보다,<br>나에게 맞는 학교를 찾는 것이 먼저입니다.</h2>
      <p>현재 성취 수준 · 학습 성향 · 희망 진로 · 과목 선택 · 실제 생활 환경.<br>이 다섯 가지를 함께 놓고 판단하세요.</p>
      <div class="rule narrow"></div>
      <div class="brandmark">${esc(brand.name || '')}</div>
      <p class="fine">${esc(brand.sub || '')}</p>
    </div>
  </div>
  ${footer(brand, pageNo, title, '자료 기준: 학교알리미 교과별 학업성취 · 재적 · 학급/교원 공시')}
</section>`;
}

const footer = (brand, no, title, left) => `<div class="footer"><span class="brandmark small">${esc(left || brand.name || title || '')}</span><span>${no}</span></div>`;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&family=Noto+Serif+KR:wght@600;700&display=swap');
:root{--navy:#102a49;--blue:#2d6fd2;--green:#15977f;--ink:#17304c;--muted:#63758b;--line:#dbe2e7}
*{box-sizing:border-box}
body{margin:0;background:#d9dde1;color:var(--ink);font-family:'Noto Sans KR','Malgun Gothic',sans-serif;word-break:keep-all}
.page{width:210mm;min-height:297mm;margin:14px auto;background:#fff;padding:16mm 15mm 12mm;position:relative;box-shadow:0 10px 35px #0002;display:flex;flex-direction:column;page-break-after:always}
.page:last-child{page-break-after:auto}
.page-main{flex:1}
.hero{background:linear-gradient(160deg,#f8fafb 0%,#fff 52%,#eef3f7 100%)}
.eyebrow{font-size:10px;letter-spacing:.18em;color:#75869a;font-weight:700}
.num{font-family:'Noto Serif KR',serif;font-size:42px;color:#c6d2df;position:absolute;right:15mm;top:13mm;line-height:1}
.kicker{font-size:13px;color:#46627e;margin-top:6px}
.title{font-family:'Noto Serif KR',serif;font-size:32px;line-height:1.28;color:#0e2a4b;margin:12px 0 6px}
.title.mid{font-size:27px;margin-top:6px}
.cover-title span{display:block}
.cover-title .vs{font-size:20px;color:#8190a1;font-family:'Noto Sans KR',sans-serif;font-weight:700;margin:2px 0}
.subtitle{font-size:13.5px;line-height:1.75;color:#4e6279;margin:8px 0 0}
.chip{display:inline-block;margin-top:8px;padding:4px 10px;border-radius:999px;font-size:10.5px;font-weight:700;background:#edf3f8;color:#35516f}
.rule{height:1px;background:#cad5df;margin:14px 0}
.rule.narrow{width:80px;margin:22px auto}
.grid{display:grid;gap:12px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.card{border:1px solid #e0e6eb;border-top:4px solid var(--blue);border-radius:16px;padding:14px 16px;background:linear-gradient(145deg,#fff,#f7f9fb)}
.school{font-family:'Noto Serif KR',serif;font-size:21px;font-weight:700}
.meta{font-size:11px;color:#6a7b8e;margin:3px 0 10px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.stat{padding:9px 6px;border-radius:10px;background:#fff;border:1px solid #e8edf1;text-align:center}
.stat b{display:block;font-size:18px;margin:3px 0}
.stat span{font-size:9px;color:#6c7b8c;display:block;line-height:1.4}
.callout{background:var(--navy);color:#fff;border-radius:16px;padding:16px 20px;margin:14px 0}
.callout strong{font-family:'Noto Serif KR',serif;font-size:18px;display:block;margin-bottom:8px}
.callout p,.callout .pp{font-size:11.5px;line-height:1.8;margin:0 0 6px;color:#e7eef6}
.callout .list{color:#e7eef6;font-size:11.5px}
.callout-fine{font-size:10px;color:#a9bed4;margin-top:8px}
.bigline{font-family:'Noto Serif KR',serif;font-size:16px;text-align:center;line-height:1.85;margin:16px 20px 0;color:#1d3a5c}
.section-title{font-size:19px;font-weight:800;margin:16px 0 8px;color:#12335a}
.sub-head{font-size:14px;font-weight:800;margin:12px 0 5px;color:#1c4574}
.section-desc{font-size:12px;color:#65778a;margin:2px 0 12px}
.pp{font-size:12px;line-height:1.78;margin:0 0 7px}
.list{margin:6px 0 8px;padding-left:17px}
.list li{font-size:12px;line-height:1.72;margin:4px 0}
.fine{font-size:9.5px;color:#788797;line-height:1.6;display:block}
code{background:#eef2f6;border-radius:4px;padding:1px 4px;font-size:11px}
.legend{display:flex;gap:12px;align-items:center;font-size:10px;color:#6c7b8c;margin-bottom:6px}
.legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.cmp{display:grid;border:1px solid #e0e6eb;border-radius:14px;overflow:hidden}
.cmp>div{padding:10px 11px;border-bottom:1px solid #e7ebef}
.cmp-head{font-weight:800;background:#f2f5f7;font-size:13px}
.cmp-key{font-size:13px}
.cmp-cell{background:#fbfcfd}
.mean{font-size:14px;display:block}
.bar{display:flex;height:13px;border-radius:4px;overflow:hidden;background:#edf1f4;margin:6px 0 4px}
.bar i{font-style:normal;font-size:8.5px;color:#fff;font-weight:700;line-height:13px;text-align:center;overflow:hidden}
.mini{border:1px solid #e0e6eb;border-radius:14px;padding:12px 14px;background:#fff}
.mini h3{font-size:13.5px;margin:0 0 7px;color:#12335a}
.mini p{font-size:11px;line-height:1.7;margin:0;color:#5f7184}
.trend-row{font-size:11.5px;line-height:1.75}
.trend-row b{font-weight:800}
.score{margin-top:4px}
.score-row{display:grid;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #ffffff22}
.score-row:last-child{border-bottom:0}
.score-label{font-size:12px;font-weight:700;color:#fff}
.score-note{font-size:10.5px;color:#a9bed4}
.dots{letter-spacing:1px;font-size:12px;white-space:nowrap}
.dots .off{opacity:.3}
.dots em{font-style:normal;font-size:10px;opacity:.85}
.fitgrid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:8px 0 4px}
.fit{border:1px solid #e0e6eb;border-radius:13px;padding:11px 13px;background:#fff;border-left:4px solid}
.fit.good{border-left-color:var(--green);background:#f3fbf8}
.fit.watch{border-left-color:#d98324;background:#fdf7ef}
.fit-mark{font-size:9px;font-weight:800;letter-spacing:.08em;margin-bottom:4px}
.fit.good .fit-mark{color:var(--green)}
.fit.watch .fit-mark{color:#b9701c}
.fit-who{font-size:12.5px;font-weight:800;color:#12335a;line-height:1.45}
.fit-why{font-size:11px;line-height:1.65;color:#5f7184;margin-top:4px}
.trk{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:6px 0}
.trk-who{width:58px;font-size:12px;font-weight:800}
.trk-cell{display:flex;align-items:center;gap:6px;flex:1 1 160px}
.trk-label{font-size:10.5px;width:66px;color:#4e6279}
.trk-bar{flex:1;height:8px;border-radius:5px;background:#e8edf2;overflow:hidden}
.trk-bar i{display:block;height:100%}
.trk-score{font-size:10px;color:#788797;width:24px}
.tbl{width:100%;border-collapse:separate;border-spacing:0;font-size:11.5px;border:1px solid #e0e6eb;border-radius:12px;overflow:hidden;margin:8px 0}
.tbl th{background:var(--navy);color:#fff;padding:8px 10px;text-align:left;font-size:11px}
.tbl td{padding:8px 10px;border-top:1px solid #e7ebef;vertical-align:top;line-height:1.6}
.tbl td.k{font-weight:700;color:#12335a;white-space:nowrap}
.tbl tr:nth-child(even) td{background:#fafbfc}
.blk{margin-bottom:6px}
.closing{text-align:center;padding:26px 15px 6px}
.closing h2{font-family:'Noto Serif KR',serif;font-size:25px;margin:10px 0;color:#0e2a4b;line-height:1.4}
.closing p{font-size:12px;line-height:1.8;color:#5d7185;margin:0}
.brandmark{font-weight:800;letter-spacing:.14em;color:#173758;font-size:15px}
.brandmark.small{font-size:8.5px;letter-spacing:.08em;color:#8290a0;font-weight:800}
.footer{border-top:1px solid #d9e0e6;padding-top:7px;margin-top:10px;display:flex;justify-content:space-between;font-size:8.5px;color:#8290a0;letter-spacing:.08em}
.print-bar{position:sticky;top:0;z-index:9;display:flex;gap:8px;align-items:center;justify-content:center;padding:9px 14px;background:#102a49ee;color:#fff;font-size:12px;backdrop-filter:blur(4px)}
.print-bar button{border:1px solid #ffffff55;background:#ffffff14;color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer}
@media print{body{background:#fff}.page{margin:0;box-shadow:none;width:210mm;min-height:297mm;break-after:page}.page:last-child{break-after:auto}.no-print{display:none}@page{size:A4;margin:0}}
@media screen and (max-width:820px){.page{width:100%;min-height:auto;padding:22px}.grid,.grid2,.grid3,.fitgrid{grid-template-columns:1fr!important}.num{position:static;text-align:right}}
`;

/**
 * 보고서(제목·마크다운·수치 블록) → 프리미엄 디자인 A4 HTML 한 벌
 * @param {{title,kind,focus,schoolNames,content,data}} report
 * @param {{name,sub,reportTitle}} brand  설정 → 브랜드
 * @param {{printBar?:boolean}} opts      printBar: 새 창으로 열 때 위에 붙는 인쇄 막대
 */
export function buildPremiumHtml(report, brand = {}, opts = {}) {
  const rep = parseReport(report?.content || '');
  const data = report?.data && Array.isArray(report.data.schools) && report.data.schools.length
    ? report.data
    : { schools: [], kind: report?.kind, year: null };
  const names = data.schools.map((s) => shortName(s.name));
  const title = report?.title || '학교 입시 해설';
  const b = { name: brand.name || 'PATHFINDER EDU', sub: brand.sub || '', reportTitle: brand.reportTitle || 'SCHOOL REPORT' };

  const pages = [];
  if (data.schools.length) pages.push(coverPage({ rep, data, brand: b, kind: report?.kind, focus: report?.focus, names, title }));
  const profile = data.schools.length ? profilePage({ data, brand: b, names, title, pageNo: pages.length + 1 }) : '';
  if (profile) pages.push(profile);
  pages.push(...flowPages({ rep, brand: b, names: names.length ? names : [''], title, startNo: pages.length + 1 }));
  pages.push(closingPage({ rep, brand: b, title, pageNo: pages.length + 1 }));

  // 쪽 번호 꼬리말의 "n" 을 "n / 총쪽" 으로 — 쪽 수가 보고서마다 달라 마지막에 채운다
  const total = pages.length;
  const html = pages.join('\n').replace(/<span>(\d+)<\/span><\/div>\n?<\/section>/g, (m, n) => m.replace(`<span>${n}</span>`, `<span>${n} / ${total}</span>`));

  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body>
${opts.printBar ? `<div class="print-bar no-print"><span>프리미엄 디자인 리포트가 준비되었습니다</span><button onclick="window.print()">🖨 인쇄 / PDF 저장</button><button onclick="window.close()">닫기</button></div>` : ''}
${html}
</body></html>`;
}

/** 새 창으로 열어 인쇄(PDF 저장)까지 — 팝업이 막히면 false */
export function openPremiumWindow(report, brand) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(buildPremiumHtml(report, brand, { printBar: true }));
  w.document.close();
  return true;
}
