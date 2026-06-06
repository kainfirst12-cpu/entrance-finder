// services/docxService.js — 마크다운(분석/수행평가 결과) → Word(.docx) 변환
// 생성된 docx는 MS Word와 한글(HWP) 모두에서 열립니다.
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
} from 'docx';

// **굵게** 인라인 파싱 → TextRun[]
function parseInline(text) {
  const runs = [];
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }));
    } else {
      runs.push(new TextRun(part));
    }
  }
  return runs.length ? runs : [new TextRun(text)];
}

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function buildTable(rows) {
  // rows: [['헤더1','헤더2'], ['값1','값2'], ...]
  const tableRows = rows.map((cells, ri) =>
    new TableRow({
      tableHeader: ri === 0,
      children: cells.map(c =>
        new TableCell({
          borders: CELL_BORDERS,
          shading: ri === 0 ? { fill: 'F0EEE8' } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [new Paragraph({ children: parseInline(c.trim()).map(r => {
            // 헤더는 굵게
            if (ri === 0) return new TextRun({ text: c.trim(), bold: true });
            return r;
          }) })],
        })
      ),
    })
  );
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows,
  });
}

function splitTableRow(line) {
  // | a | b | c | → ['a','b','c']
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map(x => x.trim());
}

const isTableSep = (line) => /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes('-');

export function markdownToDocxChildren(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const children = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 빈 줄
    if (!trimmed) { i++; continue; }

    // 표 블록 (| 로 시작하는 연속 줄)
    if (trimmed.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        block.push(lines[i]); i++;
      }
      const rows = block.filter(l => !isTableSep(l)).map(splitTableRow);
      if (rows.length > 0) children.push(buildTable(rows));
      children.push(new Paragraph({ text: '' }));
      continue;
    }

    // 헤딩
    const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const txt = h[2].replace(/\*\*/g, '');
      const heading = level === 1 ? HeadingLevel.HEADING_1
        : level === 2 ? HeadingLevel.HEADING_2
        : level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4;
      children.push(new Paragraph({ heading, spacing: { before: 200, after: 80 }, children: parseInline(txt) }));
      i++; continue;
    }

    // [N단계] 형식 헤더 (분석 리포트)
    const stepH = trimmed.match(/^\[(\d+단계|[^\]]+)\]\s*(.*)$/);
    if (stepH && /단계/.test(stepH[1])) {
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 100 },
        children: [new TextRun({ text: trimmed.replace(/\*\*/g, ''), bold: true })],
      }));
      i++; continue;
    }

    // 불릿
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: parseInline(bullet[1]) }));
      i++; continue;
    }

    // 번호 목록
    const num = trimmed.match(/^\d+\.\s+(.*)$/);
    if (num) {
      children.push(new Paragraph({ numbering: { reference: 'num-list', level: 0 }, children: parseInline(num[1]) }));
      i++; continue;
    }

    // 일반 문단
    children.push(new Paragraph({ spacing: { after: 80 }, children: parseInline(trimmed) }));
    i++;
  }

  return children;
}

export async function markdownToDocxBuffer(title, markdown) {
  const children = [];
  if (title) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: title, bold: true, size: 36 })],
    }));
  }
  children.push(...markdownToDocxChildren(markdown));

  const doc = new Document({
    numbering: {
      config: [{
        reference: 'num-list',
        levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
      }],
    },
    styles: {
      default: {
        document: { run: { font: '맑은 고딕', size: 22 } },
      },
    },
    sections: [{ children }],
  });

  return Packer.toBuffer(doc);
}
