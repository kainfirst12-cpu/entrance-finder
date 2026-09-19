// 가벼운 마크다운 미리보기 (다크 테마) — 수행평가 아카이브·학교 입시 해설 보고서 공용
export function mdPreview(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b style="color:#e8eef3">$1</b>');
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    if (t.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i]); i++; }
      const rows = block.filter(l => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l));
      html += '<table style="border-collapse:collapse;width:100%;margin:8px 0">';
      rows.forEach((r, ri) => {
        const cells = r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        html += '<tr>' + cells.map(c =>
          `<${ri === 0 ? 'th' : 'td'} style="border:1px solid #2a3a48;padding:6px 9px;text-align:left;background:${ri === 0 ? '#243341' : '#1c2937'};color:#e8eef3">${inline(c)}</${ri === 0 ? 'th' : 'td'}>`).join('') + '</tr>';
      });
      html += '</table>';
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { html += `<h${h[1].length + 1} style="margin:14px 0 6px;color:#e8eef3">${inline(h[2])}</h${h[1].length + 1}>`; i++; continue; }
    const b = t.match(/^[-*]\s+(.*)$/);
    if (b) { html += `<div style="margin:2px 0 2px 14px">• ${inline(b[1])}</div>`; i++; continue; }
    html += `<p style="margin:6px 0">${inline(t)}</p>`;
    i++;
  }
  return html;
}
