const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const C = {
  NAVY: '#1a2744', BLUE: '#2563eb', ACCENT: '#3b82f6',
  LIGHT: '#eff6ff', GOLD: '#f59e0b', RED: '#ef4444',
  GREEN: '#10b981', GRAY: '#6b7280', LGRAY: '#f3f4f6',
  BORDER: '#e5e7eb', WHITE: '#ffffff', BLACK: '#111827',
};

function findKoreanFont() {
  const candidates = [
    '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
    '/usr/share/fonts/truetype/nanum/NanumBarunGothic.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    path.join(__dirname, '../fonts/NanumGothic.ttf'),
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
      doc.fontSize(8).fillColor(C.ACCENT).text('입시-Finder  |  AI 생기부 분석 리포트', ML + 8, 18);
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
      doc.fontSize(7).fillColor('#4b5563').text('정보 출처: AI 드라이브 합격자 사례 기반 + 일반 입시 데이터 보완', ML + 8, 143);

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
        doc.addPage();
        curY = 20;
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

      // ── 푸터 ──
      const totalPages = doc.bufferedPageRange().count;
      for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        doc.moveTo(ML, 822).lineTo(PW - MR, 822).strokeColor(C.BORDER).lineWidth(0.4).stroke();
        doc.fontSize(7).fillColor(C.GRAY).text('입시-Finder  |  패스파인더 에듀', ML, 826);
        doc.fontSize(7).fillColor(C.GRAY).text(`${i + 1} / ${totalPages}`, PW - MR - 30, 826);
      }

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
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    const pat = /([가-힣a-zA-Z\s]{2,8})[:\s]+([\d.]+)\s*[\/]\s*([\d.]+)/g;
    const found = [];
    let m;
    while ((m = pat.exec(text)) !== null && found.length < 5) {
      const score = parseFloat(m[2]), max = parseFloat(m[3]);
      if (!isNaN(score) && !isNaN(max) && max > 0 && score <= max)
        found.push({ label: m[1].trim().slice(-5), score, max });
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
    caseMatching:   'AI 드라이브 합격자 사례 매칭',
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

export { generateAnalysisPDF };