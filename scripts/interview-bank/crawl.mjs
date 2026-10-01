// 울산진로진학지원센터 대입자료실(q_bbsSn=1095)의 '대학별 선행학습 영향평가 결과 보고서' 게시물 → 첨부 PDF 목록(manifest.json)
import fs from 'fs';
const rows = JSON.parse(fs.readFileSync('use-rows.json', 'utf8'));
const YEARS = (process.argv[2] || '2026,2025').split(',');
const targets = rows.filter(([, t]) => /선행학습/.test(t) && YEARS.some(y => t.startsWith(y)));
const BASE = 'https://use.go.kr/jinhak/user/bbs/';
const out = [];
for (const [doc, title] of targets) {
  const html = await (await fetch(`${BASE}BD_selectBbs.do?q_bbsSn=1095&q_bbsDocNo=${doc}`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
  const re = /href="[^"]*(ND_fileDownload\.do\?q_fileSn=(\d+)&amp;q_fileId=([0-9a-f-]+))"[^>]*>([\s\S]*?)<\/a>/g;
  const seen = new Set(); let m;
  while ((m = re.exec(html))) {
    const name = m[4].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (seen.has(m[3]) || !name) continue; seen.add(m[3]);
    out.push({ year: title.slice(0, 4), post: title, doc, fileSn: m[2], fileId: m[3], name,
      url: `https://use.go.kr/component/file/ND_fileDownload.do?q_fileSn=${m[2]}&q_fileId=${m[3]}` });
  }
  console.log(title, seen.size);
}
fs.writeFileSync('manifest.json', JSON.stringify(out, null, 1));
console.log('total', out.length);
