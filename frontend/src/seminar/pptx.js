// 설명회 자료 — 슬라이드 목록(deckModel) → 파워포인트 파일.
// 표·차트는 그림이 아니라 PPT 의 진짜 표·차트로 넣는다 — 원장님이 파워포인트에서 바로 고칠 수 있게.
// pptxgenjs(약 400KB)는 내려받기를 누를 때만 불러온다.
import { FONT, C } from './deckModel.js';

const SHAPE = { rect: 'rect', roundRect: 'roundRect', triangle: 'triangle', trapezoid: 'trapezoid', offpage: 'flowChartOffpageConnector' };

function textRuns(runs) {
  return runs.map((r) => ({
    text: r.text,
    options: { bold: !!r.b, color: r.color || C.ink, fontSize: r.size || 12, fontFace: FONT, breakLine: !!r.br },
  }));
}

export async function downloadPptx(slides, { fileName = '설명회 자료.pptx', title = '' } = {}) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';
  pptx.title = title;
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };

  for (const sl of slides) {
    const s = pptx.addSlide();
    s.background = { color: 'FFFFFF' };
    for (const e of sl.els) {
      if (e.t === 'text') {
        s.addText(textRuns(e.runs || [{ text: e.text || '' }]), {
          x: e.x, y: e.y, w: e.w, h: e.h, fontFace: FONT, align: e.align || 'left', valign: e.valign || 'middle',
          margin: e.inset ?? 2, fit: 'shrink', ...(e.fill ? { fill: { color: e.fill } } : {}),
        });
      } else if (e.t === 'image') {
        s.addImage({ data: e.src, x: e.x, y: e.y, w: e.w, h: e.h });
      } else if (e.t === 'shape' && e.shape === 'poly') {
        // 자유 도형 — 점은 상자 안 비율이라 인치로 바꿔 넣는다
        s.addShape('custGeom', {
          x: e.x, y: e.y, w: e.w, h: e.h, fill: { color: e.fill || 'FFFFFF' }, line: { type: 'none' },
          points: [...e.pts.map(([fx, fy]) => ({ x: fx * e.w, y: fy * e.h })), { close: true }],
        });
      } else if (e.t === 'shape') {
        s.addShape(SHAPE[e.shape] || 'rect', {
          x: e.x, y: e.y, w: e.w, h: e.h, fill: { color: e.fill || 'FFFFFF' },
          line: e.line ? { color: e.line, width: 0.75 } : { type: 'none' },
          ...(e.shape === 'roundRect' ? { rectRadius: 0.5 } : {}),
        });
      } else if (e.t === 'line') {
        s.addShape('line', { x: e.x, y: e.y, w: e.w, h: 0, line: { color: e.color || C.dim, width: e.dash ? 1 : 2.5, ...(e.dash ? { dashType: 'dash' } : {}) } });
      } else if (e.t === 'table') {
        const rows = e.rows.map((r) => r.map((c) => ({
          text: c.text ?? '',
          options: { bold: !!c.b, color: c.color || C.ink, align: c.align || 'left', fontFace: FONT, ...(c.fill ? { fill: { color: c.fill } } : {}) },
        })));
        s.addTable(rows, {
          x: e.x, y: e.y, w: e.w, colW: e.colW, rowH: e.rowH, fontSize: e.size || 10, fontFace: FONT, valign: 'middle',
          border: { type: 'solid', color: C.line, pt: 0.75 }, margin: 0.04,
        });
      } else if (e.t === 'bars') {
        const data = e.series.map((sr) => ({ name: sr.name, labels: e.categories, values: sr.values }));
        s.addChart('bar', data, {
          x: e.x, y: e.y, w: e.w, h: e.h, barDir: 'bar', barGrouping: 'percentStacked', barGapWidthPct: 45,
          chartColors: e.series.map((sr) => sr.color),
          catAxisOrientation: 'maxMin', catAxisLabelFontSize: 11, catAxisLabelFontFace: FONT,
          valAxisHidden: true, valGridLine: { style: 'none' },
          showLegend: true, legendPos: 't', legendFontSize: 10, legendFontFace: FONT,
          showValue: true, dataLabelFontSize: 8, dataLabelColor: 'FFFFFF', dataLabelFormatCode: '0',
        });
      }
    }
  }
  await pptx.writeFile({ fileName });
}
