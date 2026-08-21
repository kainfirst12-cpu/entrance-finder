// services/roadmapDocx.js — 생기부 로드맵을 워드(.docx)로 생성 (프리미엄·관리자 전용 다운로드)
// 마크다운 파싱은 pdfService.parseRoadmapMarkdown 공용. 표는 실제 워드 표로 옮긴다.
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, AlignmentType, ShadingType, PageBreak,
} from 'docx';
import { parseRoadmapMarkdown } from './pdfService.js';

const NAVY = '1A2744', BLUE = '2563EB', GRAY = '6B7280', AMBER = '92400E';
const FONT = '맑은 고딕';

const run = (text, opts = {}) => new TextRun({ text, font: FONT, size: 20, ...opts }); // size는 half-point (20=10pt)
const para = (children, opts = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], spacing: { after: 80 }, ...opts });

const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' };
const cellBorders = { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder };

function mdTable(rows) {
  const cols = Math.max(...rows.map(r => r.length));
  const norm = rows.map(r => Array.from({ length: cols }, (_, i) => r[i] || ''));
  const [head, ...body] = norm;
  const mk = (cells, header) => new TableRow({
    children: cells.map(c => new TableCell({
      borders: cellBorders,
      shading: header ? { type: ShadingType.CLEAR, fill: 'EFF6FF' } : undefined,
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      children: [new Paragraph({ children: [run(c, { bold: header, size: 18, color: header ? NAVY : '374151' })], spacing: { after: 0 } })],
    })),
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [mk(head, true), ...body.map(r => mk(r, false))],
  });
}

// 마크다운 블록 → 워드 요소들
function mdToDocx(md) {
  const out = [];
  for (const b of parseRoadmapMarkdown(md)) {
    if (b.type === 'gap') continue;
    if (b.type === 'hr') {
      out.push(new Paragraph({ spacing: { after: 120 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' } } }));
    } else if (b.type === 'h') {
      const size = b.level === 1 ? 30 : b.level === 2 ? 26 : 22;
      out.push(new Paragraph({
        children: [run(b.text, { bold: true, size, color: b.level === 1 ? NAVY : BLUE })],
        spacing: { before: b.level <= 2 ? 240 : 160, after: 100 },
        border: b.level <= 2 ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: b.level === 1 ? '3B82F6' : 'E5E7EB' } } : undefined,
      }));
    } else if (b.type === 'table') {
      out.push(mdTable(b.rows));
      out.push(new Paragraph({ spacing: { after: 80 } }));
    } else if (b.type === 'li') {
      out.push(para(run(`${b.marker === '·' ? '•' : b.marker}  ${b.text}`), { indent: { left: 240 }, spacing: { after: 40 } }));
    } else {
      out.push(para(run(b.text)));
    }
  }
  return out;
}

const RM_SECTION_ORDER = ['과목별 설계', '타임라인', '남은 작업', '기타'];
const fmtDate = (v) => { try { return v ? new Date(v).toLocaleDateString('ko-KR') : ''; } catch { return ''; } };

export async function generateRoadmapDocx(rm) {
  const items = rm.items || [];
  const doneCount = items.filter(i => i.done).length;
  const progress = items.length ? Math.round((doneCount / items.length) * 100) : 0;
  const dateStr = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  const children = [];

  // ── 표지 머리 ──
  children.push(new Paragraph({ children: [run('입시-Finder  |  생기부 로드맵', { size: 16, color: BLUE, bold: true })], spacing: { after: 60 } }));
  children.push(new Paragraph({
    children: [run(rm.title || '생기부 로드맵', { size: 40, bold: true, color: NAVY })],
    spacing: { after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: '3B82F6' } },
  }));
  const info = [
    `학생: ${rm.student_name || '-'}`, `학교: ${rm.student_school || '-'}`, `학년: ${rm.student_grade || '-'}`,
    `희망 진로: ${rm.student_major || '-'}`,
  ].join('    ·    ');
  children.push(para(run(info, { size: 18, color: GRAY })));
  children.push(para(run(`출력일: ${dateStr}${rm.created_at ? `    ·    작성일: ${fmtDate(rm.created_at)}` : ''}    ·    달성 ${doneCount}/${items.length} (${progress}%)`, { size: 18, color: GRAY }), { spacing: { after: 200 } }));

  if (rm.summary) {
    children.push(new Paragraph({
      children: [run(rm.summary, { size: 19, color: '374151' })],
      spacing: { after: 240 },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: BLUE } },
      indent: { left: 160 },
    }));
  }

  // ── 섹션별 체크리스트 ──
  const bySection = {};
  for (const it of items) (bySection[it.section || '기타'] ||= []).push(it);
  const sections = Object.keys(bySection).sort(
    (a, b) => (RM_SECTION_ORDER.indexOf(a) + 1 || 99) - (RM_SECTION_ORDER.indexOf(b) + 1 || 99));

  for (const sec of sections) {
    const secItems = bySection[sec];
    const secDone = secItems.filter(i => i.done).length;
    children.push(new Paragraph({
      children: [run(`${sec}  (${secDone}/${secItems.length})`, { bold: true, size: 26, color: 'FFFFFF' })],
      shading: { type: ShadingType.CLEAR, fill: NAVY },
      spacing: { before: 240, after: 120 },
    }));
    for (const it of secItems) {
      const meta = [it.subject, it.period, it.priority].filter(Boolean).join(' · ');
      const headRuns = [
        run(it.done ? '☑  ' : '☐  ', { size: 22, color: it.done ? '10B981' : GRAY }),
        run(it.title || '', { bold: true, size: 21, strike: !!it.done, color: it.done ? GRAY : '111827' }),
      ];
      children.push(new Paragraph({ children: headRuns, spacing: { before: 120, after: 30 } }));
      const metaParts = [];
      if (meta) metaParts.push(run(meta, { size: 16, color: BLUE, bold: true }));
      if (it.done) metaParts.push(run(`${meta ? '      ' : ''}✓ ${it.done_at ? fmtDate(it.done_at) + ' ' : ''}달성`, { size: 16, color: '10B981', bold: true }));
      if (metaParts.length) children.push(new Paragraph({ children: metaParts, indent: { left: 340 }, spacing: { after: 30 } }));
      if (it.detail) children.push(new Paragraph({ children: [run(it.detail, { size: 18, color: '4B5563' })], indent: { left: 340 }, spacing: { after: 30 } }));
      if (it.note) children.push(new Paragraph({ children: [run(`학생 메모: ${it.note}`, { size: 18, color: AMBER })], indent: { left: 340 }, spacing: { after: 30 } }));
    }
  }

  // ── 로드맵 전문 ──
  if (rm.body) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      children: [run('로드맵 전문 (컨설팅 보고서)', { bold: true, size: 30, color: 'FFFFFF' })],
      shading: { type: ShadingType.CLEAR, fill: NAVY },
      spacing: { after: 160 },
    }));
    children.push(...mdToDocx(rm.body));
  }

  const doc = new Document({
    creator: '입시-Finder | 패스파인더 에듀',
    title: rm.title || '생기부 로드맵',
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: [{
      properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}
