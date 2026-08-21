import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ESM에는 __dirname이 없다 — import.meta.url 로 직접 만든다(안 하면 PDF 생성이 ReferenceError로 실패).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const C = {
  NAVY: '#1a2744', BLUE: '#2563eb', ACCENT: '#3b82f6',
  LIGHT: '#eff6ff', GOLD: '#f59e0b', RED: '#ef4444',
  GREEN: '#10b981', GRAY: '#6b7280', LGRAY: '#f3f4f6',
  BORDER: '#e5e7eb', WHITE: '#ffffff', BLACK: '#111827',
};

function findKoreanFont() {
  const candidates = [
    // 레포에 번들한 나눔고딕(OFL) — 맥·리눅스·Railway 어디서든 동일하게 잡히도록 최우선.
    path.join(__dirname, '../fonts/NanumGothic.ttf'),
    // 시스템 설치 폰트 폴백 (리눅스)
    '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
    '/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    // macOS(로컬 개발) 폴백
    '/System/Library/Fonts/Supplemental/AppleGothic.ttf',
    '/Library/Fonts/AppleGothic.ttf',
  ];
  for (const p of candidates) { if (fs.existsSync(p)) return p; }
  return null;
}

function scoreColor(score, max) {
  const pct = score / max;
  if (pct >= 0.7) return C.GREEN;
  if (pct >= 0.5) return C.GOLD;
  return C.RED;
}

function generateAnalysisPDF(analysisData, studentData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 20, bottom: 20, left: 20, right: 20 },
        bufferPages: true,
      });

      const fontPath = findKoreanFont();
      if (fontPath) { doc.registerFont('Korean', fontPath); doc.font('Korean'); }

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PW = doc.page.width;
      const ML = 20, MR = 20, BODY_W = PW - ML - MR;

      // ── 커버 헤더 ──
      doc.rect(0, 0, PW, 180).fill(C.NAVY);
      doc.rect(0, 0, 8, 180).fill(C.BLUE);
      doc.fontSize(8).fillColor(C.ACCENT).text('입시-Finder  |  생기부 종합 분석 리포트', ML + 8, 18);
      doc.fontSize(22).fillColor(C.WHITE).text(`${studentData.name || ''} 학생`, ML + 8, 40);
      doc.fontSize(14).fillColor('#93c5fd').text('입시 컨설팅 종합 리포트', ML + 8, 70);
      doc.moveTo(ML + 8, 92).lineTo(PW - MR, 92).strokeColor(C.ACCENT).lineWidth(1).stroke();

      const chips = [
        `학교: ${studentData.school || '-'}`,
        `학년: ${studentData.grade || '-'}`,
        `희망전공: ${studentData.major || '-'}`,
      ];
      let chipX = ML + 8;
      chips.forEach(chip => {
        const tw = doc.fontSize(7).widthOfString(chip) + 14;
        doc.roundedRect(chipX, 100, tw, 18, 3).fill('#1e3a6e');
        doc.fontSize(7).fillColor(C.WHITE).text(chip, chipX + 7, 106);
        chipX += tw + 6;
      });

      const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
      doc.fontSize(7).fillColor(C.GRAY).text(`분석일: ${dateStr}`, ML + 8, 130);
      doc.fontSize(7).fillColor('#4b5563').text('정보 출처: 합격자 사례 기반 + 일반 입시 데이터 보완', ML + 8, 143);

      let curY = 190;

      // ── Executive Summary ──
      curY = _drawSectionHeader(doc, '요약', 'EXECUTIVE SUMMARY', curY, ML, BODY_W);
      curY += 6;

      const scores = _extractScores(analysisData);
      const totalScore = Math.round(scores.reduce((s, i) => s + i.score, 0) * 10) / 10;
      const totalMax = scores.reduce((s, i) => s + i.max, 0);

      doc.roundedRect(ML, curY, BODY_W, 50, 4).fill(C.LIGHT);
      doc.fontSize(9).fillColor(C.NAVY).text('■  종합 평가 점수', ML + 12, curY + 10);
      doc.fontSize(24).fillColor(C.BLUE).text(`${totalScore} / ${totalMax}점`, PW - MR - 120, curY + 8, { width: 110, align: 'right' });
      doc.fontSize(8).fillColor(C.GRAY).text(`종합 평가: ${_gradeLabel(totalScore, totalMax)}`, ML + 12, curY + 30);
      curY += 58;

      curY = _drawScoreBars(doc, scores, ML, curY, BODY_W);
      curY += 8;

      curY = _drawStrengthWeakness(doc, analysisData, ML, curY, BODY_W);
      curY += 8;

      const strategyText = _extractStrategy(analysisData);
      doc.roundedRect(ML, curY, BODY_W, 28, 3).fill('#fef9c3');
      doc.rect(ML, curY, 4, 28).fill(C.GOLD);
      doc.fontSize(8).fillColor(C.NAVY).text(`■ 전략적 권고사항   ${strategyText}`, ML + 12, curY + 10, { width: BODY_W - 24 });
      curY += 36;

      // ── 분석 섹션들 ──
      const sections = _parseSections(analysisData);
      sections.forEach((section, idx) => {
        // 단계마다 무조건 새 페이지를 열면 앞 페이지 아래쪽이 통째로 비어 종이가 낭비된다.
        // 남은 공간이 부족할 때(헤더+최소 본문이 안 들어갈 때)만 페이지를 넘긴다.
        if (curY > 660) { doc.addPage(); curY = 20; }
        else if (idx > 0) { curY += 16; }
        curY = _drawSectionHeader(doc, `제${idx + 1}장`, section.title, curY, ML, BODY_W);
        curY += 8;

        section.items.forEach(item => {
          if (curY > 750) { doc.addPage(); curY = 20; }

          if (item.type === 'subheader') {
            curY = _drawSubHeader(doc, item.text, ML, curY, BODY_W);
            curY += 4;
          } else if (item.type === 'text') {
            const h = doc.heightOfString(item.text, { width: BODY_W });
            doc.fontSize(8.5).fillColor(C.BLACK).text(item.text, ML, curY, { width: BODY_W });
            curY += h + 6;
          } else if (item.type === 'list') {
            item.items.forEach((li, i) => {
              if (curY > 750) { doc.addPage(); curY = 20; }
              doc.roundedRect(ML, curY, BODY_W, 24, 3).fill(C.LIGHT);
              doc.circle(ML + 14, curY + 12, 9).fill(C.BLUE);
              doc.fontSize(8).fillColor(C.WHITE).text(`${i + 1}`, ML + 11, curY + 8);
              doc.fontSize(8).fillColor(C.NAVY).text(li, ML + 28, curY + 8, { width: BODY_W - 36 });
              curY += 28;
            });
            curY += 4;
          } else if (item.type === 'quote') {
            const qh = doc.heightOfString(item.text, { width: BODY_W - 30 }) + 16;
            doc.roundedRect(ML, curY, BODY_W, qh, 3).fill('#f8fafc');
            doc.rect(ML, curY, 3, qh).fill(C.BLUE);
            doc.fontSize(8).fillColor('#374151').text(item.text, ML + 12, curY + 8, { width: BODY_W - 24 });
            curY += qh + 6;
          }
        });
      });

      _drawFooters(doc, ML, PW, MR);
      doc.end();
    } catch (err) { reject(err); }
  });
}

function _drawSectionHeader(doc, chapterLabel, title, y, ml, bw) {
  doc.roundedRect(ml, y, bw, 32, 4).fill(C.NAVY);
  doc.roundedRect(ml, y, 48, 32, 4).fill(C.ACCENT);
  doc.rect(ml + 40, y, 10, 32).fill(C.ACCENT);
  doc.fontSize(8).fillColor(C.WHITE).text(chapterLabel, ml + 8, y + 12);
  doc.fontSize(12).fillColor(C.WHITE).text(title, ml + 56, y + 10);
  return y + 40;
}

function _drawSubHeader(doc, title, ml, y, bw) {
  doc.roundedRect(ml, y, bw, 22, 3).fill(C.LIGHT);
  doc.rect(ml, y, 4, 22).fill(C.BLUE);
  doc.fontSize(10).fillColor(C.NAVY).text(title, ml + 10, y + 6);
  return y + 28;
}

function _drawScoreBars(doc, scores, ml, y, bw) {
  const barW = bw - 110;
  scores.forEach(({ label, score, max }) => {
    const pct = Math.min(score / max, 1);
    const color = scoreColor(score, max);
    doc.fontSize(8).fillColor(C.BLACK).text(label, ml, y + 3, { width: 100 });
    doc.roundedRect(ml + 108, y, barW, 14, 3).fill(C.LGRAY);
    if (pct > 0) doc.roundedRect(ml + 108, y, barW * pct, 14, 3).fill(color);
    doc.fontSize(7).fillColor(C.WHITE).text(`${score}/${max}`, ml + 108 + barW * pct - 30, y + 4);
    y += 22;
  });
  return y;
}

function _drawStrengthWeakness(doc, analysisData, ml, y, bw) {
  const hw = (bw - 6) / 2;
  const strengths = _extractList(analysisData, ['강점', '유지', '강화']);
  const weaknesses = _extractList(analysisData, ['약점', '개선', '부족']);
  const maxItems = Math.max(strengths.length, weaknesses.length, 1);
  const boxH = maxItems * 16 + 28;

  doc.roundedRect(ml, y, hw, boxH, 3).fill('#f0fdf4');
  doc.fontSize(8).fillColor(C.GREEN).text('◆ 핵심 강점', ml + 10, y + 8);
  strengths.slice(0, 4).forEach((s, i) => {
    doc.fontSize(7.5).fillColor(C.BLACK).text(`✓  ${s}`, ml + 10, y + 22 + i * 16, { width: hw - 16 });
  });

  doc.roundedRect(ml + hw + 6, y, hw, boxH, 3).fill('#fef2f2');
  doc.fontSize(8).fillColor(C.RED).text('◆ 핵심 약점', ml + hw + 16, y + 8);
  weaknesses.slice(0, 4).forEach((w, i) => {
    doc.fontSize(7.5).fillColor(C.BLACK).text(`✗  ${w}`, ml + hw + 16, y + 22 + i * 16, { width: hw - 16 });
  });

  return y + boxH + 6;
}

function _extractScores(data) {
  const defaults = [
    { label: '학업역량', score: 5.5, max: 10 },
    { label: '비교과', score: 6.5, max: 10 },
    { label: '진로역량', score: 7.0, max: 10 },
    { label: '세특 질', score: 5.0, max: 10 },
    { label: '전공적합성', score: 6.0, max: 10 },
  ];
  if (!data) return defaults;
  try {
    // 원본 텍스트로 본다(JSON.stringify 하면 \n 이 이스케이프돼 줄 단위 표 파싱이 깨진다).
    const text = typeof data === 'string'
      ? data
      : Object.values(data).filter(v => typeof v === 'string').join('\n');
    // 리포트는 마크다운 표로 나온다: | 학업역량 | 7.8 / 10 | 우수 | ... 또는 | 학업역량 | 7.8 | ...
    // 강조 기호(**)가 남아 있어도 잡히도록 정리 후 매칭한다.
    const clean = text.replace(/\*\*/g, '');
    const WANT = [
      { key: '학업', label: '학업역량' },
      { key: '비교과', label: '비교과' },
      { key: '진로', label: '진로역량' },
      { key: '세특', label: '세특 질' },
      { key: '전공', label: '전공적합성' },
    ];
    const found = [];
    for (const w of WANT) {
      // 같은 줄에서 '항목명 ... 숫자[ /최대]' 를 찾는다. 표(|)·콜론·공백 구분 모두 허용.
      const re = new RegExp(`^[^\\n]*${w.key}[^\\n]*?([0-9]+(?:\\.[0-9]+)?)\\s*(?:/\\s*([0-9]+(?:\\.[0-9]+)?))?\\s*(?:점|/\\s*10)?[^\\n]*$`, 'm');
      const m = re.exec(clean);
      if (!m) continue;
      const score = parseFloat(m[1]);
      const max = m[2] ? parseFloat(m[2]) : 10;
      if (!isNaN(score) && max > 0 && score <= max) found.push({ label: w.label, score, max });
    }
    return found.length >= 3 ? found : defaults;
  } catch { return defaults; }
}

function _extractStrategy(data) {
  if (!data) return '학생부종합 3장 + 논술 3장 병행, 정시 안전망 필수';
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const m = text.match(/전략[^\n]{5,80}/);
  return m ? m[0].replace(/[*_#"\\]/g, '').trim().slice(0, 80) : '학생부종합 + 논술 병행, 정시 안전망 필수';
}

function _extractList(data, keywords) {
  if (!data) return [];
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  const lines = text.split(/\n|\\n/);
  const results = [];
  let capture = false;
  for (const line of lines) {
    const clean = line.replace(/[*_#"\\]/g, '').trim();
    if (!clean) continue;
    if (keywords.some(k => clean.includes(k))) capture = true;
    if (capture && /^[-•]/.test(clean)) {
      const item = clean.replace(/^[-•]\s*/, '').trim();
      if (item.length > 3 && item.length < 60) results.push(item);
    }
    if (results.length >= 4) break;
  }
  return results;
}

function _parseSections(data) {
  if (!data || typeof data !== 'object') return [];
  const nameMap = {
    caseMatching:   '합격자 사례 매칭',
    academic:       '학업역량 심층 분석',
    activity:       '비교과 활동 분석',
    career:         '진로 역량 및 전공 적합성',
    strategy:       '수시 지원 전략',
    roadmap:        '3년 로드맵 및 실행 계획',
    recordFeedback: '세부능력 및 특기사항 개선안',
    dashboard:      '종합 평가 및 최종 권고사항',
  };
  return Object.entries(nameMap)
    .filter(([k]) => data[k] && typeof data[k] === 'string')
    .map(([k, title]) => ({ title, items: _parseItems(data[k]) }));
}

function _parseItems(text) {
  const items = [];
  const lines = text.split(/\n|\\n/);
  let listBuf = [];
  const flush = () => { if (listBuf.length) { items.push({ type: 'list', items: [...listBuf] }); listBuf = []; } };

  for (const raw of lines) {
    const line = raw.replace(/[*_]/g, '').trim();
    if (!line) continue;
    if (/^#+\s/.test(raw)) {
      flush();
      items.push({ type: 'subheader', text: line.replace(/^#+\s*/, '') });
    } else if (/^[-•]\s/.test(raw) || /^\d+\.\s/.test(raw)) {
      const item = line.replace(/^[-•\d.]\s*/, '');
      if (item.length > 3 && item.length < 100) listBuf.push(item);
    } else {
      flush();
      if (line.length > 2) items.push({ type: 'text', text: line });
    }
  }
  flush();
  return items;
}

function _gradeLabel(score, max) {
  const pct = score / max;
  if (pct >= 0.8) return '상';
  if (pct >= 0.6) return '중하 (내신 극복 시 중상 가능)';
  return '하 (전략적 접근 필요)';
}

// ══════════════════════════════════════════════════════
// 생기부 로드맵 PDF — 커버 + 진행 현황 + 섹션별 체크리스트 + 로드맵 전문
// rm: getRoadmap() 결과 (student_name/school/grade/major 조인 포함, items 배열)
// ══════════════════════════════════════════════════════

const RM_SECTION_ORDER = ['과목별 설계', '타임라인', '남은 작업', '기타'];
const PAGE_BOTTOM = 790; // 푸터(822) 위 여백

const _rmDate = (v) => { try { return v ? new Date(v).toLocaleDateString('ko-KR') : ''; } catch { return ''; } };

// 페이지 하단(마진 안쪽)에 텍스트를 쓰면 pdfkit이 자동으로 새 페이지를 만들어 빈 장이 생긴다.
// 푸터를 쓰는 동안만 하단 마진을 0으로 내리고 lineBreak를 끈다.
function _drawFooters(doc, ml, pw, mr) {
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    const ob = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(ml, 822).lineTo(pw - mr, 822).strokeColor(C.BORDER).lineWidth(0.4).stroke();
    doc.fontSize(7).fillColor(C.GRAY).text('입시-Finder  |  패스파인더 에듀', ml, 826, { lineBreak: false });
    doc.fontSize(7).fillColor(C.GRAY).text(`${i + 1} / ${totalPages}`, pw - mr - 30, 826, { lineBreak: false });
    doc.page.margins.bottom = ob;
  }
}

function _rmEnsure(doc, y, need) {
  if (y + need > PAGE_BOTTOM) { doc.addPage(); return 20; }
  return y;
}

// 마크다운 인라인 정리 — pdfkit엔 굵게/기울임 변형 폰트가 없어 기호만 걷어낸다
const _rmInline = (s) => String(s || '')
  .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  .replace(/`([^`]+)`/g, '$1').replace(/__([^_]+)__/g, '$1');

function _rmCheckbox(doc, x, y, done) {
  if (done) {
    doc.roundedRect(x, y, 11, 11, 2.5).fill(C.GREEN);
    doc.moveTo(x + 2.5, y + 5.5).lineTo(x + 4.5, y + 8).lineTo(x + 8.5, y + 3)
      .strokeColor(C.WHITE).lineWidth(1.4).stroke();
  } else {
    doc.roundedRect(x, y, 11, 11, 2.5).strokeColor(C.GRAY).lineWidth(1).stroke();
  }
}

// 로드맵 본문(마크다운) → 제목/불릿/표 행을 단순 조판으로 흘려 그린다
function _rmDrawMarkdown(doc, md, ml, y, bw) {
  const lines = String(md || '').split('\n');
  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) { y += 4; continue; }
    if (/^-{3,}$/.test(trimmed)) {
      y = _rmEnsure(doc, y, 10);
      doc.moveTo(ml, y + 3).lineTo(ml + bw, y + 3).strokeColor(C.BORDER).lineWidth(0.5).stroke();
      y += 10; continue;
    }
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const size = level === 1 ? 13 : level === 2 ? 11 : 9.5;
      const text = _rmInline(h[2]);
      const th = doc.fontSize(size).heightOfString(text, { width: bw });
      y = _rmEnsure(doc, y, th + 14);
      y += level <= 2 ? 8 : 5;
      doc.fontSize(size).fillColor(level === 1 ? C.NAVY : C.BLUE).text(text, ml, y, { width: bw });
      y += th + 4;
      if (level <= 2) { doc.moveTo(ml, y).lineTo(ml + bw, y).strokeColor(level === 1 ? C.ACCENT : C.BORDER).lineWidth(0.6).stroke(); y += 5; }
      continue;
    }
    if (/^\|/.test(trimmed)) {
      if (/^\|[\s:|-]+\|$/.test(trimmed)) continue; // |---|---| 구분선
      const cells = trimmed.replace(/^\||\|$/g, '').split('|').map(c => _rmInline(c.trim()));
      const text = cells.filter(Boolean).join('   |   ');
      const th = doc.fontSize(7.5).heightOfString(text, { width: bw - 8 });
      y = _rmEnsure(doc, y, th + 4);
      doc.fontSize(7.5).fillColor('#374151').text(text, ml + 8, y, { width: bw - 8 });
      y += th + 3; continue;
    }
    const bullet = trimmed.match(/^[-*•]\s+(.*)$/) || trimmed.match(/^(\d+\.)\s+(.*)$/);
    if (bullet) {
      const marker = bullet.length === 3 ? bullet[1] : '·';
      const text = _rmInline(bullet[bullet.length - 1]);
      const th = doc.fontSize(8.5).heightOfString(text, { width: bw - 16 });
      y = _rmEnsure(doc, y, th + 4);
      doc.fontSize(8.5).fillColor(C.BLACK).text(marker, ml + 4, y);
      doc.fontSize(8.5).fillColor(C.BLACK).text(text, ml + 16, y, { width: bw - 16 });
      y += th + 3; continue;
    }
    const text = _rmInline(trimmed);
    const th = doc.fontSize(8.5).heightOfString(text, { width: bw });
    y = _rmEnsure(doc, y, th + 4);
    doc.fontSize(8.5).fillColor(C.BLACK).text(text, ml, y, { width: bw });
    y += th + 4;
  }
  return y;
}

function generateRoadmapPDF(rm) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margins: { top: 20, bottom: 20, left: 20, right: 20 }, bufferPages: true });
      const fontPath = findKoreanFont();
      if (fontPath) { doc.registerFont('Korean', fontPath); doc.font('Korean'); }
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PW = doc.page.width;
      const ML = 20, MR = 20, BODY_W = PW - ML - MR;
      const items = rm.items || [];
      const doneCount = items.filter(i => i.done).length;
      const progress = items.length ? Math.round((doneCount / items.length) * 100) : 0;

      // ── 커버 헤더 ──
      doc.rect(0, 0, PW, 168).fill(C.NAVY);
      doc.rect(0, 0, 8, 168).fill(C.BLUE);
      doc.fontSize(8).fillColor(C.ACCENT).text('입시-Finder  |  생기부 로드맵', ML + 8, 18);
      doc.fontSize(18).fillColor(C.WHITE).text(rm.title || '생기부 로드맵', ML + 8, 38, { width: BODY_W - 16 });
      const chips = [
        `학생: ${rm.student_name || '-'}`,
        `학교: ${rm.student_school || '-'}`,
        `학년: ${rm.student_grade || '-'}`,
        `희망 진로: ${rm.student_major || '-'}`,
      ];
      let chipX = ML + 8;
      chips.forEach(chip => {
        const tw = doc.fontSize(7).widthOfString(chip) + 14;
        doc.roundedRect(chipX, 96, tw, 18, 3).fill('#1e3a6e');
        doc.fontSize(7).fillColor(C.WHITE).text(chip, chipX + 7, 102);
        chipX += tw + 6;
      });
      const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
      doc.fontSize(7).fillColor('#93c5fd').text(`출력일: ${dateStr}${rm.created_at ? `   ·   작성일: ${_rmDate(rm.created_at)}` : ''}`, ML + 8, 126);
      // 진행률 바
      const barW = BODY_W - 120;
      doc.roundedRect(ML + 8, 140, barW, 9, 4).fill('#1e3a6e');
      if (progress > 0) doc.roundedRect(ML + 8, 140, Math.max(barW * progress / 100, 9), 9, 4).fill(progress === 100 ? C.GREEN : C.ACCENT);
      doc.fontSize(8).fillColor(C.WHITE).text(`달성 ${doneCount}/${items.length} · ${progress}%`, ML + 8 + barW + 8, 140);

      let y = 180;

      // ── 요지 ──
      if (rm.summary) {
        const sh = doc.fontSize(8.5).heightOfString(rm.summary, { width: BODY_W - 24 }) + 16;
        y = _rmEnsure(doc, y, sh + 4);
        doc.roundedRect(ML, y, BODY_W, sh, 3).fill('#f8fafc');
        doc.rect(ML, y, 3, sh).fill(C.BLUE);
        doc.fontSize(8.5).fillColor('#374151').text(rm.summary, ML + 12, y + 8, { width: BODY_W - 24 });
        y += sh + 10;
      }

      // ── 섹션별 체크리스트 ──
      const bySection = {};
      for (const it of items) (bySection[it.section || '기타'] ||= []).push(it);
      const sections = Object.keys(bySection).sort(
        (a, b) => (RM_SECTION_ORDER.indexOf(a) + 1 || 99) - (RM_SECTION_ORDER.indexOf(b) + 1 || 99));

      sections.forEach((sec, idx) => {
        y = _rmEnsure(doc, y, 80);
        if (idx > 0) y += 6;
        const secItems = bySection[sec];
        const secDone = secItems.filter(i => i.done).length;
        y = _drawSectionHeader(doc, `${secDone}/${secItems.length}`, sec, y, ML, BODY_W);
        y += 4;

        for (const it of secItems) {
          const meta = [it.subject, it.period, it.priority].filter(Boolean).join(' · ');
          const titleH = doc.fontSize(9).heightOfString(it.title || '', { width: BODY_W - 26 });
          const detailH = it.detail ? doc.fontSize(7.5).heightOfString(it.detail, { width: BODY_W - 26 }) + 3 : 0;
          const noteH = it.note ? doc.fontSize(7.5).heightOfString(`학생 메모: ${it.note}`, { width: BODY_W - 26 }) + 3 : 0;
          const metaH = meta || it.done ? 11 : 0;
          const blockH = titleH + metaH + detailH + noteH + 10;
          y = _rmEnsure(doc, y, blockH);

          _rmCheckbox(doc, ML + 2, y + 1, !!it.done);
          doc.fontSize(9).fillColor(it.done ? C.GRAY : C.BLACK).text(it.title || '', ML + 26, y, { width: BODY_W - 26, strike: !!it.done });
          let yy = y + titleH + 2;
          if (meta || it.done) {
            const parts = [];
            if (meta) parts.push(meta);
            if (it.done && it.done_at) parts.push(`✓ ${_rmDate(it.done_at)} 달성`);
            else if (it.done) parts.push('달성');
            doc.fontSize(7).fillColor(it.done ? C.GREEN : C.BLUE).text(parts.join('    '), ML + 26, yy);
            yy += 11;
          }
          if (it.detail) {
            doc.fontSize(7.5).fillColor('#4b5563').text(it.detail, ML + 26, yy, { width: BODY_W - 26 });
            yy += detailH;
          }
          if (it.note) {
            doc.fontSize(7.5).fillColor('#92400e').text(`학생 메모: ${it.note}`, ML + 26, yy, { width: BODY_W - 26 });
            yy += noteH;
          }
          y = yy + 6;
          doc.moveTo(ML + 26, y - 3).lineTo(ML + BODY_W, y - 3).strokeColor(C.LGRAY).lineWidth(0.4).stroke();
        }
        y += 4;
      });

      // ── 로드맵 전문 ──
      if (rm.body) {
        doc.addPage(); y = 20;
        y = _drawSectionHeader(doc, '전문', '로드맵 전문 (컨설팅 보고서)', y, ML, BODY_W);
        y += 6;
        y = _rmDrawMarkdown(doc, rm.body, ML, y, BODY_W);
      }

      _drawFooters(doc, ML, PW, MR);
      doc.end();
    } catch (err) { reject(err); }
  });
}

export { generateAnalysisPDF, generateRoadmapPDF };