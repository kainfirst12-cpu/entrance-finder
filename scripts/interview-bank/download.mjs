import fs from 'fs';
const m = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
fs.mkdirSync('pdf', { recursive: true });
const todo = m.filter(x => /\.pdf$/i.test(x.name) && x.year !== '2024');
let i = 0, fail = 0;
async function one(x) {
  const f = `pdf/${x.fileId}.pdf`;
  if (fs.existsSync(f) && fs.statSync(f).size > 1000) return;
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(x.url, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://use.go.kr/' } });
      const b = Buffer.from(await r.arrayBuffer());
      if (b.slice(0, 4).toString() !== '%PDF') throw new Error('not pdf ' + r.status);
      fs.writeFileSync(f, b); return;
    } catch (e) { if (t === 2) { fail++; console.log('FAIL', x.name, e.message); } }
  }
}
const pool = Array.from({ length: 4 }, async () => { while (i < todo.length) await one(todo[i++]); });
await Promise.all(pool);
console.log('done', todo.length, 'fail', fail);
