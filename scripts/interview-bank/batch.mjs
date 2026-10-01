import 'dotenv/config'; import fs from 'fs'; import Anthropic from '@anthropic-ai/sdk'; import { params } from './prompt.mjs';
const client = new Anthropic();
const cmd = process.argv[2];
if (cmd === 'submit') {
  const chunks = JSON.parse(fs.readFileSync('chunks.json','utf8')); const CTX = JSON.parse(fs.readFileSync('ctx.json','utf8'));
  const requests = chunks.map((c, i) => ({ c, i })).filter(({ c }) => (CTX[c.id]?.iv || 0) > 0)
    .map(({ c, i }) => ({ custom_id: `c${i}`, params: params(c, CTX[c.id]) }));
  const b = await client.messages.batches.create({ requests });
  fs.writeFileSync('batch-id.txt', b.id); console.log('batch', b.id, requests.length);
} else if (cmd === 'status') {
  const b = await client.messages.batches.retrieve(fs.readFileSync('batch-id.txt','utf8').trim());
  console.log(b.processing_status, JSON.stringify(b.request_counts));
} else if (cmd === 'fetch') {
  const id = fs.readFileSync('batch-id.txt','utf8').trim(); const out = {}; let tin=0, tout=0, bad=0;
  for await (const r of await client.messages.batches.results(id)) {
    if (r.result.type !== 'succeeded') { out[r.custom_id] = { error: r.result.type }; bad++; continue; }
    const m = r.result.message; tin += m.usage.input_tokens + (m.usage.cache_read_input_tokens||0) + (m.usage.cache_creation_input_tokens||0); tout += m.usage.output_tokens;
    const t = m.content.find(b => b.type === 'text')?.text || '';
    try { out[r.custom_id] = { stop: m.stop_reason, ...JSON.parse(t) }; } catch { out[r.custom_id] = { error: 'parse', stop: m.stop_reason }; bad++; }
  }
  fs.writeFileSync('results.json', JSON.stringify(out)); console.log('results', Object.keys(out).length, 'bad', bad, 'in', tin, 'out', tout);
}
