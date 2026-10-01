// 한 파일로 묶기 — 플러그인에는 node 만 있으면 된다(npm install 불필요).
// 엔진은 frontend/src/seminar/*.js 를 그대로 가져온다(웹과 같은 결과). pptxgenjs·MCP SDK·zod 는 이 폴더 node_modules 에서.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, 'src/server.mjs')],
  outfile: path.join(here, 'plugin/servers/seminar-mcp.mjs'),
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  nodePaths: [path.join(here, 'node_modules')],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  legalComments: 'none', logLevel: 'warning',
});
console.log('built plugin/servers/seminar-mcp.mjs');
