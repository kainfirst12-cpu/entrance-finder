// interviewReport.js — 면접 전략 JSON → A4 가로 HTML (사용설명서·예시 리포트와 같은 디자인)
//
// 디자인은 '정은진_2027_법학과_대학별면접전략.html' 예시를 그대로 옮긴 것이다. 페이지 순서:
//   표지 → 지원 카드 지도 → 학생부 소재 → (면접 카드마다) 문항 → (면접 카드마다) 예시 답안 ×2
//   → 평가표 매핑 → 진위 검증 → 학생용·교사용 → 2주 로드맵 → (면접 없는 카드) 서류 트랙 → 최종 로드맵
// 모든 AI 문자열은 esc() 로 감싼다 — 모델이 태그를 섞어 보내도 그대로 글자로 찍힌다.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad2 = (n) => String(n).padStart(2, '0');
const arr = (x) => (Array.isArray(x) ? x : []);

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800;900&display=swap');
:root{--ink:#17202f;--navy:#13243b;--blue:#275aa8;--sky:#eaf2ff;--gold:#c69a4b;--cream:#fbf8f1;--line:#dfe5ed;--muted:#657184;--green:#25736b;--red:#b34c57;--paper:#fff}
*{box-sizing:border-box} body{margin:0;background:#e9edf2;color:var(--ink);font-family:'Noto Sans KR','Malgun Gothic',sans-serif;word-break:keep-all}
.page{position:relative;width:297mm;min-height:210mm;margin:14px auto;background:var(--paper);padding:14mm 16mm 13mm;overflow:hidden;box-shadow:0 12px 36px #18263d1f;page-break-after:always}
.page:last-child{page-break-after:auto}.topline{position:absolute;left:0;right:0;top:0;height:6px;background:linear-gradient(90deg,var(--navy),var(--blue) 60%,var(--gold))}
.eyebrow{font-size:11px;font-weight:800;letter-spacing:.16em;color:var(--blue);text-transform:uppercase}.title{font-size:31px;line-height:1.2;margin:8px 0 10px;font-weight:900;letter-spacing:-.045em}.subtitle{font-size:14px;line-height:1.7;color:var(--muted)}
h2{font-size:22px;margin:0 0 10px;letter-spacing:-.035em} h3{font-size:15px;margin:0 0 7px} p{margin:0;line-height:1.62}.small{font-size:10px;color:var(--muted)}
.grid{display:grid;gap:10px}.g2{grid-template-columns:1fr 1fr}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}.g5{grid-template-columns:repeat(5,1fr)}.g6{grid-template-columns:repeat(6,1fr)}
.card{border:1px solid var(--line);border-radius:13px;padding:13px 15px;background:#fff}.card.tint{background:var(--cream)}.card.blue{background:var(--sky);border-color:#cadcff}.card.dark{background:var(--navy);color:#fff;border:0}.card.green{background:#e9f5f2;border-color:#c8e4dd}.card.red{background:#fff0f1;border-color:#f0cbd0}
.tag{display:inline-flex;align-items:center;border-radius:99px;padding:4px 9px;font-size:9px;font-weight:800;background:#edf1f6;color:#42506a}.tag.on{background:#dff3ed;color:#16645c}.tag.off{background:#f4e7e9;color:#9b3945}.tag.gold{background:#f7eddb;color:#79581e}
.metric{font-size:28px;font-weight:900;line-height:1;color:var(--blue)}.label{font-size:10px;color:var(--muted);margin-top:5px}.bar{height:7px;background:#edf0f4;border-radius:9px;overflow:hidden;margin-top:8px}.bar i{display:block;height:100%;background:var(--blue);border-radius:9px}
.flow{display:flex;align-items:center;gap:8px;margin:14px 0}.node{flex:1;padding:12px;border-radius:12px;background:#f2f5f9;text-align:center;font-size:12px;font-weight:800}.arrow{color:var(--gold);font-size:20px;font-weight:900}
.quote{border-left:4px solid var(--gold);background:var(--cream);padding:13px 16px;border-radius:0 11px 11px 0;font-size:13px;line-height:1.68}
.q{display:grid;grid-template-columns:34px 1fr;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)}.q:last-child{border:0}.qn{width:31px;height:31px;border-radius:9px;background:var(--navy);color:#fff;display:grid;place-items:center;font-size:10px;font-weight:900}.qt{font-size:12px;font-weight:700;line-height:1.52}.follow{font-size:9px;color:var(--muted);margin-top:3px}
.answer-card{border:1px solid var(--line);border-radius:12px;padding:9px 12px;background:#fff}.answer-card+.answer-card{margin-top:7px}.answer-head{display:flex;align-items:flex-start;gap:8px}.answer-head b{font-size:11px;line-height:1.45}.intent{font-size:8.5px;color:var(--blue);font-weight:800;margin:4px 0 3px}.sample{font-size:9.4px;line-height:1.48;color:#303a4b}.answer-foot{display:grid;grid-template-columns:1.3fr .7fr;gap:8px;margin-top:5px;padding-top:5px;border-top:1px dashed var(--line);font-size:8px;line-height:1.4;color:var(--muted)}.answer-foot b{color:var(--ink)}
table{width:100%;border-collapse:separate;border-spacing:0;font-size:10px;line-height:1.45;border:1px solid var(--line);border-radius:11px;overflow:hidden}th{background:var(--navy);color:#fff;padding:8px;text-align:left}td{padding:8px;border-top:1px solid var(--line);vertical-align:top}tr:nth-child(even) td{background:#fafbfc}
.footer{position:absolute;left:16mm;right:16mm;bottom:7mm;display:flex;justify-content:space-between;font-size:8px;color:#8993a3}.num{font-weight:900;color:var(--navy)}
.hero{display:grid;grid-template-columns:1.22fr .78fr;gap:25px;align-items:center;min-height:155mm}.hero-art{height:142mm;border-radius:24px;background:linear-gradient(150deg,#13243b,#244f86);overflow:hidden;position:relative}.hero-art svg{width:100%;height:100%}
.section-note{font-size:10px;color:var(--muted);margin:-4px 0 10px}.list{margin:0;padding-left:18px;font-size:11px;line-height:1.65}.list li{margin:3px 0}.callout{display:flex;gap:10px;align-items:flex-start}.icon{width:28px;height:28px;border-radius:8px;background:var(--sky);color:var(--blue);display:grid;place-items:center;font-weight:900;flex:0 0 auto}
.strategy{border-left:4px solid var(--blue);padding-left:10px;font-size:11px;line-height:1.55}.sources{font-size:8px;line-height:1.55;color:#717d8f}.sources a{color:#4a648b;text-decoration:none}
.toolbar{position:sticky;top:0;z-index:9;display:flex;gap:8px;align-items:center;justify-content:center;padding:9px 14px;background:#13243bee;color:#fff;font-family:'Noto Sans KR','Malgun Gothic',sans-serif;font-size:12px;backdrop-filter:blur(4px)}.toolbar button{border:1px solid #ffffff55;background:#ffffff14;color:#fff;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer}.toolbar button.on{background:#c69a4b;border-color:#c69a4b;color:#13243b}.toolbar span{opacity:.75;margin-left:6px}
@media print{@page{size:297mm 210mm;margin:0}html,body{width:297mm;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}.page{margin:0;box-shadow:none;width:297mm;height:210mm;min-height:210mm;overflow:hidden;break-inside:avoid;page-break-inside:avoid}.page:last-child{page-break-after:auto}.no-print{display:none}}
@media screen and (max-width:900px){.page{width:100%;min-height:auto;margin:0 0 12px;padding:24px}.g6,.g5,.g4,.g3,.g2,.hero{grid-template-columns:1fr}.hero-art{height:420px}.footer{position:static;margin-top:20px}}
`;

const HERO_SVG = (text) => `<svg viewBox="0 0 420 580" role="img" aria-label="표지 그래픽">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7eb4ff"/><stop offset="1" stop-color="#c69a4b"/></linearGradient></defs>
  <circle cx="310" cy="115" r="125" fill="#ffffff0d"/><circle cx="80" cy="470" r="160" fill="#ffffff08"/>
  <path d="M210 70v370" stroke="url(#g)" stroke-width="6"/><path d="M92 166h236" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
  <path d="M125 166l-52 120h104zM295 166l-52 120h104z" fill="none" stroke="#e9d4a9" stroke-width="4"/>
  <circle cx="210" cy="160" r="18" fill="#fff"/><path d="M145 440h130M174 406h72" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
  <g fill="#9fc5ff"><circle cx="82" cy="95" r="6"/><circle cx="342" cy="365" r="8"/><circle cx="70" cy="375" r="4"/></g>
  <text x="210" y="525" text-anchor="middle" fill="#fff" font-size="20" font-weight="800">${esc(text)}</text>
</svg>`;

const flow = (nodes, extra = '') => `<div class="flow"${extra}>${arr(nodes).map(n => `<div class="node">${esc(n)}</div>`).join('<div class="arrow">›</div>')}</div>`;
const gridClass = (n) => (n <= 6 ? `g${Math.max(n, 1)}` : 'g4');
const cardName = (c) => `${esc(c.univ)} ${esc(c.track)}`.trim();
const kindTag = (c) => {
  if (!c.interview) return '<span class="tag off">면접 없음</span>';
  if (c.kind === '교과면접') return '<span class="tag gold">교과면접</span>';
  if (c.kind === '제시문') return '<span class="tag gold">제시문 면접</span>';
  return '<span class="tag on">면접 있음</span>';
};
const cardColor = (c) => (!c.interview ? 'red' : c.kind === '교과면접' ? 'tint' : c.kind === '제시문' ? 'tint' : 'blue');
const metricColor = (c) => (!c.interview ? 'var(--red)' : c.kind === '교과면접' ? '#8a6728' : c.priority === 2 ? 'var(--green)' : 'var(--blue)');
const weightsLine = (c) => arr(c.weights).map(w => `${esc(w.name)} ${esc(w.pct)}`).join(' · ');
const footer = (left, n) => `<div class="footer"><span>${esc(left)}</span><span class="num">${pad2(n)}</span></div>`;

export function buildInterviewHtml(d, opts = {}) {
  const cards = arr(d.cards);
  const interviews = arr(d.interviews);
  const ivCards = cards.filter(c => c.interview);
  const docCards = cards.filter(c => !c.interview);
  const name = d.studentName || opts.studentName || '';
  const major = d.major || opts.major || cards[0]?.dept || '';
  const year = d.year || '2027';
  const brand = opts.brand || '입시-Finder · 학생부 기반 면접 LAB';
  const title = `${name ? `${name} 학생 ` : ''}${major} 대학별 면접 전략`.trim();
  const pages = [];
  const P = (eyebrow, h2, body, foot) => pages.push({ eyebrow, h2, body, foot });

  // 1. 표지
  P(null, null, `
  <div class="hero">
    <div>
      <div class="eyebrow">${esc(d.eyebrow || `${year} ADMISSIONS · INTERVIEW LAB v3.0`)}</div>
      <h1 class="title">${name ? `${esc(name)} 학생<br>` : ''}${esc(major)} 대학별 면접 전략</h1>
      <p class="subtitle">${esc(d.subtitle)}</p>
      ${flow(d.themes)}
      <div class="quote">“${esc(d.quote)}”</div>
      <div style="margin-top:18px" class="grid g3">
        <div><div class="metric">${ivCards.length}</div><div class="label">실제 면접 전형</div></div>
        <div><div class="metric">${docCards.length}</div><div class="label">서류 100% 전형</div></div>
        <div><div class="metric">${arr(d.topics).length}</div><div class="label">핵심 학생부 소재</div></div>
      </div>
    </div>
    <div class="hero-art">${HERO_SVG(d.artText || 'INTERVIEW LAB')}</div>
  </div>`, brand);

  // 2. 지원 카드 지도
  const numKo = ['', '한', '두', '세', '네', '다섯', '여섯', '일곱', '여덟'][cards.length] || cards.length;
  const styleKinds = new Set(ivCards.map(c => c.style)).size;
  P('APPLICATION MAP', `${numKo} 지원 카드, 준비 방식은 ${['', '한', '두', '세', '네', '다섯'][styleKinds] || styleKinds} 갈래입니다`, `
  <p class="section-note">${esc(year)}학년도 공식 모집요강 기준. ‘면접이 없는 전형’에는 면접 문항을 만들지 않고 서류평가 관점으로 관리합니다.</p>
  <div class="grid ${gridClass(cards.length)}">
    ${cards.map(c => `<div class="card ${cardColor(c)}">${kindTag(c)}<h3 style="margin-top:9px">${cardName(c)}</h3><p class="small">${esc(c.dept)}${c.quota ? ` · ${esc(c.quota)}` : ''}</p>
      <div class="metric" style="margin-top:12px;color:${metricColor(c)}">${c.interview ? `${esc(c.minutes || '?')}분` : '100%'}</div>
      <div class="label">${esc(c.format || (c.interview ? c.kind : '서류 종합평가'))}</div>
      <div class="bar"><i style="width:${c.interview ? Math.max(25, Math.min(90, Number(c.minutes || 10) * 4)) : 100}%;background:${metricColor(c)}"></i></div>
      <p class="small">${weightsLine(c) || esc(c.stage)}</p></div>`).join('')}
  </div>
  ${ivCards.length ? `<div class="grid ${gridClass(ivCards.length)}" style="margin-top:14px">
    ${ivCards.map(c => `<div class="card"><div class="callout"><div class="icon">${esc(c.styleChar || '問')}</div><div><h3>${esc(c.styleTitle || `${c.univ} = ${c.style}`)}</h3><p class="small">${esc(c.styleDesc)}</p></div></div></div>`).join('')}
  </div>` : ''}
  <div class="card dark" style="margin-top:13px;display:grid;grid-template-columns:160px 1fr;gap:16px;align-items:center"><div style="font-size:18px;font-weight:900">핵심 결론</div><p style="font-size:12px">${esc(d.conclusion)}</p></div>`,
  `${year}학년도 전형 구조 요약`);

  // 3. 학생부 소재
  P('STUDENT RECORD MAP', `${esc(major)} 면접의 중심이 될 학생부 소재`, `
  <div class="grid g2">
    <div>
      <table><thead><tr><th>우선</th><th>학생부 소재</th><th>면접에서 확인할 핵심</th></tr></thead><tbody>
        ${arr(d.topics).map((t, i) => `<tr><td>${pad2(i + 1)}</td><td><b>${esc(t.title)}</b></td><td>${esc(t.focus)}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="grid" style="gap:11px">
      <div class="card blue"><h3>가장 강한 연결축</h3>${flow(d.axis, ' style="margin:9px 0 0"')}</div>
      <div class="card"><h3>면접관이 의심할 수 있는 지점</h3><ul class="list">${arr(d.doubts).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div class="card tint"><h3>답변을 관통할 기준</h3><p class="strategy">${esc(d.principle)}</p></div>
      <div class="card red"><h3>반드시 다시 확인할 사실</h3><p class="small">${esc(d.recheck)}</p></div>
    </div>
  </div>`, d.recordNote || '학생부 분석 기반');

  // 4. 면접 카드별 문항
  const univEye = (c) => `${esc(c.univ)}`.toUpperCase();
  for (const iv of interviews) {
    const c = cards[iv.cardIndex]; if (!c) continue;
    const qs = arr(iv.questions);
    const half = Math.ceil(qs.length / 2);
    const qItem = (q, i) => `<div class="q"><div class="qn">${pad2(i + 1)}</div><div><div class="qt">${esc(q.q)}</div>${q.follow ? `<div class="follow">${esc(q.followType || '꼬리')} · ${esc(q.follow)}</div>` : ''}</div></div>`;
    const isPrep = c.kind === '교과면접' && arr(c.prep).length;
    const left = isPrep
      ? `<div class="card dark"><h3 style="color:#fff">${esc(c.prepTitle || '면접기초자료 예상')}</h3><ol class="list" style="color:#e8eef7">${arr(c.prep).map(p => `<li>${esc(p)}</li>`).join('')}</ol></div>
         <div class="card" style="margin-top:10px"><h3>${esc(c.minutes || '')}분 실전 질문</h3>${qs.slice(0, half).map(qItem).join('')}</div>`
      : `<div class="card">${qs.slice(0, half).map(qItem).join('')}</div>`;
    const right = isPrep
      ? `<div class="card"><h3>실전 질문 ${half + 1}~${qs.length}</h3>${qs.slice(half).map((q, i) => qItem(q, i + half)).join('')}</div>
         <div class="card green" style="margin-top:10px"><h3>${esc(c.answerSeconds || 30)}초 답변 틀</h3>${flow(String(c.formula || '결론 → 한 장면 → 배운 점').split('→').map(s => s.trim()), ' style="margin:9px 0 0"')}<p class="small" style="margin-top:8px">${esc(c.styleDesc)}</p></div>`
      : `<div class="card">${qs.slice(half).map((q, i) => qItem(q, i + half)).join('')}</div>`;
    P(univEye(c), `${cardName(c)} ${esc(c.dept)} · ${esc(c.minutes || '?')}분 ${esc(c.style || '')}`, `
    <div class="grid g3" style="margin-bottom:9px">
      ${arr(c.weights).slice(0, 2).map((w, i) => `<div class="card ${i === 0 ? (c.priority === 2 ? 'green' : 'blue') : 'tint'}"><h3>${esc(w.name)} ${esc(w.pct)}%</h3><p class="small">${esc(w.detail)}</p></div>`).join('')}
      ${arr(c.weights).length > 2 ? `<div class="card"><h3>${esc(c.weights[2].name)} ${esc(c.weights[2].pct)}%</h3><p class="small">${esc(c.weights[2].detail)}</p></div>` : `<div class="card"><h3>핵심 화법</h3><p class="small">${esc(c.styleDesc)}</p></div>`}
    </div>
    <div class="grid g2"><div>${left}</div><div>${right}</div></div>
    ${!isPrep ? `<div class="quote" style="margin-top:10px"><b>${esc(c.univ)} 답변 공식</b> · ${esc(c.formula)}</div>` : ''}`,
    c.formatNote || c.stage || '');
  }

  // 5. 면접 카드별 예시 답안
  for (const iv of interviews) {
    const c = cards[iv.cardIndex]; if (!c) continue;
    const ans = arr(iv.answers);
    // 한 쪽에 최대 5개, 쪽마다 고르게(12개 → 4·4·4, 10개 → 5·5) — 마지막 쪽만 텅 비지 않게
    const perPage = Math.ceil(ans.length / Math.max(1, Math.ceil(ans.length / 5)));
    const chunks = [];
    for (let i = 0; i < ans.length; i += perPage) chunks.push(ans.slice(i, i + perPage));
    chunks.forEach((chunk, pi) => {
      const offset = pi * perPage;
      const aCard = (a, i) => `<div class="answer-card"><div class="answer-head"><span class="tag gold">${pad2(offset + i + 1)}</span><b>${esc(a.q)}</b></div><div class="intent">의도 · ${esc(a.intent)}</div><p class="sample">${esc(a.sample)}</p>
        ${arr(a.foot).length ? `<div class="answer-foot">${arr(a.foot).slice(0, 2).map(f => `<span><b>${esc(f.k)}</b> ${esc(f.v)}</span>`).join('')}</div>` : ''}</div>`;
      const l = Math.ceil(chunk.length / 2);
      const last = pi === chunks.length - 1;
      const note = last && iv.studentNote ? `<div class="card blue" style="margin-top:8px"><h3>학생용 수정 지시</h3><p class="small">${esc(iv.studentNote)}</p></div>`
        : (pi === 0 && c.prepHow ? `<div class="card blue" style="margin-top:8px"><h3>면접기초자료 작성법</h3><p class="small">${esc(c.prepHow)}</p></div>` : '');
      const sub = arr(iv.answerPageTitles)[pi] || (pi === 0 ? '핵심 문항' : '심화 문항');
      P(`${univEye(c)} · SAMPLE ANSWERS ${pad2(pi + 1)}`, `${cardName(c)} ${esc(c.style || '')} 예시 답안 · ${esc(sub)}`, `
      <div class="grid g2">
        <div>${chunk.slice(0, l).map(aCard).join('')}</div>
        <div>${chunk.slice(l).map((a, i) => aCard(a, i + l)).join('')}${note}</div>
      </div>`,
      c.kind === '교과면접' ? String(c.formula || '결론 → 한 장면 → 배운 점') : `예시 답안은 암기본이 아니라 ${c.answerSeconds || 60}초 답변 설계도`);
    });
  }

  // 6. 평가표 매핑
  const m = d.mapping || {};
  P('EVALUATION MAPPING', `${numKo} 지원 카드의 평가표에 학생부를 배치합니다`, `
  <table><thead><tr><th style="width:18%">지원 카드</th><th style="width:22%">가장 중요한 평가축</th><th>${name ? `${esc(name)} 학생부의` : '학생부의'} 대표 근거</th><th style="width:23%">준비 초점</th></tr></thead><tbody>
    ${arr(m.rows).map(r => { const c = cards[r.cardIndex] || {}; return `<tr><td><b>${cardName(c)}<br>${esc(c.dept)}</b></td><td>${esc(r.axis)}</td><td>${esc(r.evidence)}</td><td>${esc(r.focus)}</td></tr>`; }).join('')}
  </tbody></table>
  <div class="grid g3" style="margin-top:12px"><div class="card blue"><h3>가장 강한 평가축</h3><p class="small">${esc(m.strongest)}</p></div><div class="card tint"><h3>보완이 필요한 축</h3><p class="small">${esc(m.weakest)}</p></div><div class="card red"><h3>공통 위험</h3><p class="small">${esc(m.risk)}</p></div></div>
  <div class="quote" style="margin-top:11px">${esc(m.quote)}</div>`, '평가표를 먼저 보고 같은 활동의 답변 초점을 변경');

  // 7. 진위 검증
  const v = d.verification || {};
  const vItem = (x, i) => `<div class="q"><div class="qn">${pad2(i + 1)}</div><div><div class="qt">${esc(x.q)}</div><div class="follow">${esc(x.check)}</div></div></div>`;
  P('RECORD VERIFICATION', '면접 전에 반드시 복기할 학생부 진위·전문개념', `
  <div class="grid g2">
    <div class="card"><h3>${esc(v.conceptTitle || '전공 개념 검증')}</h3>${arr(v.concept).map(vItem).join('')}</div>
    <div class="card blue"><h3>${esc(v.dataTitle || '연구·데이터 검증')}</h3>${arr(v.data).map((x, i) => vItem(x, i + arr(v.concept).length)).join('')}</div>
  </div>
  <div class="grid g3" style="margin-top:11px"><div class="card green"><h3>답할 수 있음</h3><p class="small">정의·자료·본인 행동을 30초 안에 설명하고 실제 기록과 일치</p></div><div class="card tint"><h3>다시 확인</h3><p class="small">핵심 방향은 기억하지만 사건명·수치·역할이 불명확해 원자료 복기가 필요</p></div><div class="card red"><h3>사용 금지</h3><p class="small">예시 답안에 있다는 이유로 학생이 실제 하지 않은 자료 조사·대화·역할을 추가</p></div></div>`,
  '서류면접의 첫 번째 관문은 화려함보다 신뢰성');

  // 8. 학생용·교사용
  const secLine = ivCards.map(c => `${esc(c.univ)} ${esc(c.answerSeconds || 60)}초`).join(' · ');
  P('STUDENT & TEACHER PACK', '학생용 문제편과 교사용 해설·평가표를 분리합니다', `
  <div class="grid g2"><div class="card blue"><span class="tag on">학생용</span><h3 style="margin-top:8px">실전 질문지</h3><ul class="list"><li>대학별 핵심 문항만 제시</li><li>예시 답안과 질문 의도는 숨김</li><li>답변 핵심어 2~3개 메모란</li><li>${secLine || '답변 시간은 대학별 규칙대로'}</li><li>답변 후 자기점검: 결론·근거·장면·시간</li></ul><div class="quote" style="margin-top:10px">학생은 완성문장을 외우지 않고 핵심어만 보고 자신의 말로 답합니다.</div></div><div class="card tint"><span class="tag gold">교사용</span><h3 style="margin-top:8px">질문 의도와 평가</h3><ul class="list"><li>학생부 출처와 확인할 사실</li><li>대학 평가요소와 문항의 연결</li><li>예시 답안의 핵심 논리</li><li>탐구·호기심·비판·전공·윤리 꼬리질문</li><li>감점 신호와 다음 회차 목표</li></ul><div class="quote" style="margin-top:10px">예시 답안과 다른 결론이라도 근거가 타당하면 학생의 답변 축을 살립니다.</div></div></div>
  ${ivCards.length ? `<div class="card dark" style="margin-top:12px"><h3 style="color:#fff">대학별 모의면접 세트</h3><div class="grid ${gridClass(ivCards.length)}">${ivCards.map(c => { const iv = interviews.find(x => cards[x.cardIndex] === c); return `<div><p style="font-size:11px"><b>${esc(c.univ)} ${esc(c.minutes || '?')}분</b></p><p class="small" style="color:#dce7f4">${esc(iv?.teacherNote || c.formula || '')}</p></div>`; }).join('')}</div></div>` : ''}
  <div class="grid g3" style="margin-top:12px"><div class="card"><h3>내용 50</h3><p class="small">질문 적합성·학생부 정확성·전공 개념·논리 근거</p></div><div class="card"><h3>전달 30</h3><p class="small">두괄식·시간·말하기 속도·질문 전체에 대한 응답</p></div><div class="card"><h3>태도 20</h3><p class="small">경청·정직성·반론 수용·공동체 관점. 연습용 공통표이며 대학 공식 배점과 별도</p></div></div>`,
  '힌트 없이 답변한 뒤 해설과 대조');

  // 9. 2주 로드맵
  const pr = d.practice || {};
  P('14-DAY PRACTICE RECORD', '지원 카드별 2주 실전 로드맵', `
  <table><thead><tr><th style="width:12%">기간</th><th>학습 과제</th><th style="width:25%">결과물·통과 기준</th><th style="width:22%">기록 항목</th></tr></thead><tbody>
    ${arr(pr.plan).map(p => `<tr><td><b>${esc(p.period)}</b></td><td>${esc(p.task)}</td><td>${esc(p.output)}</td><td>${esc(p.log)}</td></tr>`).join('')}
  </tbody></table>
  <div class="grid g3" style="margin-top:12px"><div class="card blue"><h3>회차 기록</h3><p class="small">날짜 · 대학 · 질문 · 답변시간 · 평가자 · 잘한 점 · 부족한 점</p></div><div class="card tint"><h3>실제 면접 후기</h3><p class="small">받은 질문 · 꼬리질문 · 분위기 · 예상 밖 문항 · 다음 대학 보완점</p></div><div class="card red"><h3>비언어 지표</h3><p class="small">시선·자세·표정·성량은 연습 참고값이며 실제 대학 평가점수로 해석하지 않음</p></div></div>
  <div class="quote" style="margin-top:11px"><b>운영 원칙:</b> 학생 혼자 연습 → 가족·친구와 무작위 질문 → 충분히 준비된 뒤 교사 모의면접. 교사와의 제한된 연습 기회는 최종 피드백에 사용합니다.</div>`,
  '생성 → 말하기 → 피드백 → 재연습 → 실제 후기');

  // 10. 면접 없는 카드 — 서류 트랙
  if (docCards.length) {
    const dc = d.docOnly || {};
    P('DOCUMENT-ONLY TRACKS', `면접이 없는 ${['', '한', '두', '세', '네', '다섯'][docCards.length] || docCards.length} 카드 · 학생부 평가 포인트`, `
    <div class="grid ${docCards.length === 1 ? 'g2' : gridClass(docCards.length)}">
      ${docCards.map(c => `<div class="card red"><span class="tag off">서류 100%</span><h3 style="font-size:18px;margin-top:10px">${cardName(c)} ${esc(c.dept)}</h3>
        ${arr(c.weights).length ? `<div class="grid g3" style="margin:14px 0">${arr(c.weights).slice(0, 3).map(w => `<div><div class="metric" style="color:var(--red)">${esc(w.pct)}</div><div class="label">${esc(w.name)}</div></div>`).join('')}</div>` : '<div style="height:14px"></div>'}
        <ul class="list">${arr(c.docPoints).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}
      ${docCards.length === 1 ? `<div class="card"><h3>서류평가 관점</h3><div class="quote" style="margin-top:8px">면접형용 답변을 준비하는 것과 별개로, 서류 안에서 활동의 동기·과정·결과·성장이 읽히는지를 점검해야 합니다.</div></div>` : ''}
    </div>
    <div class="card dark" style="margin-top:12px"><h3 style="color:#fff">공통 서류 진단</h3><p style="font-size:12px">${esc(dc.diagnosis)}</p></div>
    <div class="grid g3" style="margin-top:12px"><div class="card"><h3>강점</h3><p class="small">${esc(dc.strengths)}</p></div><div class="card"><h3>보완</h3><p class="small">${esc(dc.gaps)}</p></div><div class="card"><h3>금지</h3><p class="small">${esc(dc.forbidden)}</p></div></div>`,
    '면접 미실시 전형은 서류평가 전략으로 분리');
  }

  // 11. 최종 로드맵
  const prio = [...ivCards].sort((a, b) => (a.priority || 9) - (b.priority || 9));
  const ck = arr(pr.checklist);
  const third = Math.ceil(ck.length / 3);
  const baseDate = (d.generatedAt || new Date().toISOString()).slice(0, 10).replace(/-/g, '.');
  P('PRACTICE PLAN', '최종 준비 로드맵', `
  <div class="grid ${gridClass(prio.length || 1)}">
    ${prio.map((c, i) => `<div class="card ${['blue', 'green', 'tint'][i % 3]}"><span class="tag ${i === 2 ? 'gold' : 'on'}">${i + 1}순위</span><h3 style="margin-top:9px">${esc(c.univ)} · ${esc((c.styleTitle || '').split('=')[1] || c.style)}</h3><ul class="list">${arr(c.priorityItems).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}
  </div>
  <div class="card" style="margin-top:13px"><h3>학생 확인 체크리스트</h3><div class="grid g3">${[0, 1, 2].map(k => `<ul class="list">${ck.slice(k * third, (k + 1) * third).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}</div></div>
  <div class="quote" style="margin-top:12px"><b>면접 답변의 원칙</b> · ${esc(pr.principle)}</div>
  <div class="sources" style="margin-top:14px"><b>공식 전형 근거</b><br>
    ${arr(d.sources).map(s => `${esc(s.label)}${s.url ? ` · <a href="${esc(s.url)}">입학처</a>` : ''}`).join('<br>')}<br>
    기준일 ${esc(baseDate)} · 최종 면접 시간·장소·유의사항은 대학 입학처 공지를 다시 확인해야 합니다.
  </div>`,
  `학생부 기반 면접 LAB · 대학별 맞춤형 v3.0 · ${cards.length}개 ${esc(major)} 통합판`);

  const body = pages.map((p, i) => `<section class="page">
  <div class="topline"></div>${p.eyebrow ? `<div class="eyebrow">${esc(p.eyebrow)}</div><h2>${p.h2}</h2>` : ''}
  ${p.body}
  ${footer(p.foot, i + 1)}
</section>`).join('\n\n');

  const toolbar = opts.toolbar === false ? '' : `<div class="toolbar no-print">
  <button onclick="window.print()">🖨 인쇄 / PDF 저장</button>
  <button id="edit-toggle" onclick="var on=document.body.contentEditable!=='true';document.body.contentEditable=on?'true':'false';this.classList.toggle('on',on);this.textContent=on?'✏ 수정 중 (클릭해 잠금)':'✏ 직접 수정'">✏ 직접 수정</button>
  <span>A4 가로 · ${pages.length}쪽 · 인쇄 대화상자에서 ‘배경 그래픽’을 켜세요</span>
</div>`;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${toolbar}
${body}
</body></html>`;
}
