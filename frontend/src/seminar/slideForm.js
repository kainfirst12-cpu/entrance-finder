// 공통본 슬라이드 ↔ 고치기 폼(글자 칸). 목록은 한 줄에 하나, 표·카드는 ' | ' 로 칸을 나눈다.
const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
const paras = (v) => String(v || '').split(/\n\s*\n/).map((x) => x.replace(/\n/g, ' ').trim()).filter(Boolean);
const cells = (line) => line.split('|').map((x) => x.trim());

export function toForm(s) {
  const d = s.data || {};
  const f = { layout: s.layout, heading: s.heading || '', source: s.source || '' };
  switch (s.layout) {
    case 'section': f.title = d.title || ''; break;
    case 'statement': f.kicker = d.kicker || ''; f.lines = (d.lines || []).join('\n'); break;
    case 'qa': f.q = d.q || ''; f.a = (d.a || []).join('\n\n'); break;
    case 'cards': f.cards = (d.cards || []).map((c) => `${c.title} | ${c.body}`).join('\n'); break;
    case 'bullets': f.lead = d.lead || ''; f.items = (d.items || []).join('\n'); f.note = d.note || ''; break;
    case 'table': f.columns = (d.columns || []).join(' | '); f.rows = (d.rows || []).map((r) => r.join(' | ')).join('\n'); f.note = d.note || ''; break;
    case 'compare': f.leftTitle = d.left?.title || ''; f.leftItems = (d.left?.items || []).join('\n'); f.rightTitle = d.right?.title || ''; f.rightItems = (d.right?.items || []).join('\n'); break;
    case 'figure': f.caption = d.caption || ''; f.note = d.note || ''; break;
    case 'image': f.caption = d.caption || ''; f.note = d.note || ''; break;
    case 'imageText': f.lead = d.lead || ''; f.items = (d.items || []).join('\n'); break;
    default: break;
  }
  // 사진은 글자 칸이 아니라 그대로 들고 다닌다(편집 창의 '사진 올리기'가 바꾼다)
  if (d.src) { f.src = d.src; f.w = d.w; f.h = d.h; }
  return f;
}

export function fromForm(f) {
  let data;
  switch (f.layout) {
    case 'section': data = { title: f.title || '' }; break;
    case 'statement': data = { ...(f.kicker ? { kicker: f.kicker } : {}), lines: lines(f.lines) }; break;
    case 'qa': data = { q: f.q || '', a: paras(f.a) }; break;
    case 'cards': data = { cards: lines(f.cards).map((l) => { const [title, ...rest] = cells(l); return { title, body: rest.join(' | ') }; }) }; break;
    case 'bullets': data = { ...(f.lead ? { lead: f.lead } : {}), items: lines(f.items), ...(f.note ? { note: f.note } : {}) }; break;
    case 'table': data = { columns: cells(f.columns || ''), rows: lines(f.rows).map(cells), ...(f.note ? { note: f.note } : {}) }; break;
    case 'compare': data = { left: { title: f.leftTitle || '', items: lines(f.leftItems) }, right: { title: f.rightTitle || '', items: lines(f.rightItems) } }; break;
    case 'figure': data = { caption: f.caption || '', ...(f.note ? { note: f.note } : {}) }; break;
    case 'image': data = { ...(f.caption ? { caption: f.caption } : {}), ...(f.note ? { note: f.note } : {}) }; break;
    case 'imageText': data = { ...(f.lead ? { lead: f.lead } : {}), items: lines(f.items) }; break;
    default: data = {};
  }
  if ((f.layout === 'image' || f.layout === 'imageText') && f.src) Object.assign(data, { src: f.src, w: f.w, h: f.h });
  return { layout: f.layout, heading: f.heading || '', data, ...(f.source ? { source: f.source } : { source: undefined }) };
}

// 레이아웃별 입력 칸 [키, 이름, 여러 줄?, 도움말]
export const FORM_FIELDS = {
  section: [['title', '장 제목']],
  statement: [['kicker', '작은 머리말(선택)'], ['lines', '문장 (한 줄에 하나)', true]],
  qa: [['q', '질문'], ['a', '답 (문단 사이 빈 줄)', true]],
  cards: [['cards', '카드 (한 줄에 하나: 제목 | 본문)', true]],
  bullets: [['lead', '머리 문장(선택)'], ['items', '항목 (한 줄에 하나)', true], ['note', '아래 강조 문장(선택)']],
  table: [['columns', '열 이름 (| 로 나눔)'], ['rows', '행 (한 줄에 하나, | 로 칸 나눔)', true], ['note', '아래 문장(선택)']],
  compare: [['leftTitle', '왼쪽 제목'], ['leftItems', '왼쪽 항목 (한 줄에 하나)', true], ['rightTitle', '오른쪽 제목'], ['rightItems', '오른쪽 항목 (한 줄에 하나)', true]],
  figure: [['caption', '그림 설명'], ['note', '아래 문장(선택)']],
  image: [['caption', '사진 설명(선택)'], ['note', '덧붙이는 말(선택)']],
  imageText: [['lead', '머리 문장(선택)'], ['items', '설명 (한 줄에 하나)', true]],
};
export const IMAGE_LAYOUTS = new Set(['image', 'imageText']);

// 사진 줄이기 — 긴 변 1600px JPEG(0.85). 학원 소개는 DB 에 들어가고 PPT·공유 링크에도 실리므로 원본을 그대로 두지 않는다.
export function shrinkImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * k), h = Math.round(img.height * k);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve({ src: c.toDataURL('image/jpeg', 0.85), w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('사진을 읽지 못했습니다')); };
    img.src = url;
  });
}
