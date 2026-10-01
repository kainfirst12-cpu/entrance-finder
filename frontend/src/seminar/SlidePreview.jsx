// 설명회 자료 — 슬라이드 한 장 미리보기. deckModel 의 요소(인치 좌표)를 PPT 와 같은 자리에 그린다.
import { W, H, FONT, C } from './deckModel';

const hex = (c) => (c ? `#${c}` : undefined);
const CLIP = {
  triangle: 'polygon(50% 0, 100% 100%, 0 100%)',
  offpage: 'polygon(0 0, 100% 0, 100% 72%, 50% 100%, 0 72%)',
};

export default function SlidePreview({ slide, width = 520 }) {
  const k = width / W;               // 1인치 = k px
  const pt = (size) => (size * k) / 72; // pt → px
  const box = (e) => ({ position: 'absolute', left: e.x * k, top: e.y * k, width: e.w * k, height: e.h !== undefined ? e.h * k : undefined });
  return (
    <div style={{ position: 'relative', width, height: H * k, background: '#fff', overflow: 'hidden', fontFamily: `'${FONT}', 'Malgun Gothic', sans-serif`, color: hex(C.ink), borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,.25)' }}>
      {slide.els.map((e, i) => {
        if (e.t === 'text') {
          return (
            <div key={i} style={{ ...box(e), display: 'flex', flexDirection: 'column', justifyContent: e.valign === 'top' ? 'flex-start' : e.valign === 'bottom' ? 'flex-end' : 'center', textAlign: e.align || 'left', background: hex(e.fill), lineHeight: 1.25, overflow: 'hidden' }}>
              <div>
                {(e.runs || [{ text: e.text }]).map((r, j) => (
                  <span key={j}>
                    <span style={{ fontWeight: r.b ? 700 : 400, color: hex(r.color || C.ink), fontSize: pt(r.size || 12), whiteSpace: 'pre-wrap' }}>{r.text}</span>
                    {r.br && <br />}
                  </span>
                ))}
              </div>
            </div>
          );
        }
        if (e.t === 'shape') {
          let clip;
          if (CLIP[e.shape]) clip = CLIP[e.shape];
          if (e.shape === 'trapezoid') { const ins = (0.25 * Math.min(e.w, e.h)) / e.w * 100; clip = `polygon(${ins}% 0, ${100 - ins}% 0, 100% 100%, 0 100%)`; }
          return <div key={i} style={{ ...box(e), background: hex(e.fill), clipPath: clip, borderRadius: e.shape === 'roundRect' ? Math.min(e.w, e.h) * k / 2 : 0, border: e.line ? `1px solid ${hex(e.line)}` : undefined }} />;
        }
        if (e.t === 'line') {
          return <div key={i} style={{ position: 'absolute', left: e.x * k, top: e.y * k, width: e.w * k, borderTop: `${e.dash ? 1 : 2}px ${e.dash ? 'dashed' : 'solid'} ${hex(e.color || C.dim)}` }} />;
        }
        if (e.t === 'table') {
          return (
            <table key={i} style={{ position: 'absolute', left: e.x * k, top: e.y * k, width: e.w * k, borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: pt(e.size || 10) }}>
              <colgroup>{e.colW.map((w, j) => <col key={j} style={{ width: w * k }} />)}</colgroup>
              <tbody>
                {e.rows.map((r, ri) => (
                  <tr key={ri} style={{ height: e.rowH * k }}>
                    {r.map((c, ci) => (
                      <td key={ci} style={{ border: `1px solid ${hex(C.line)}`, background: hex(c.fill), color: hex(c.color || C.ink), fontWeight: c.b ? 700 : 400, textAlign: c.align || 'left', padding: `0 ${0.05 * k}px`, lineHeight: 1.2, overflow: 'hidden' }}>{c.text}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        if (e.t === 'bars') {
          const labelW = 0.8 * k;
          const legendH = 0.3 * k;
          const rowH = (e.h * k - legendH) / Math.max(e.categories.length, 1);
          return (
            <div key={i} style={box(e)}>
              <div style={{ height: legendH, display: 'flex', justifyContent: 'center', gap: 10, alignItems: 'center', fontSize: pt(10) }}>
                {e.series.map((s) => <span key={s.name}><span style={{ display: 'inline-block', width: pt(8), height: pt(8), background: hex(s.color), marginRight: 3 }} />{s.name}</span>)}
              </div>
              {e.categories.map((cat, ci) => {
                const tot = e.series.reduce((t, s) => t + (s.values[ci] || 0), 0) || 1;
                return (
                  <div key={cat} style={{ display: 'flex', alignItems: 'center', height: rowH }}>
                    <div style={{ width: labelW, textAlign: 'right', paddingRight: 6, fontSize: pt(11) }}>{cat}</div>
                    <div style={{ flex: 1, display: 'flex', height: rowH * 0.68 }}>
                      {e.series.map((s) => {
                        const v = s.values[ci] || 0;
                        return <div key={s.name} style={{ width: `${(v / tot) * 100}%`, background: hex(s.color), color: '#fff', fontSize: pt(8), display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>{v >= 5 ? Math.round(v) : ''}</div>;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}
