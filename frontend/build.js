// build.js — Vite 빌드 후 JS 파일 난독화
import { execSync } from 'child_process';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'fs';
import { join, extname } from 'path';
import JavaScriptObfuscator from 'javascript-obfuscator';

// 1) Vite 빌드 실행
console.log('[build] Vite 빌드 시작...');
execSync('npx vite build', { stdio: 'inherit' });
console.log('[build] Vite 빌드 완료');

// 2) dist/assets/ 내 JS 파일 난독화
const distAssets = join(process.cwd(), 'dist', 'assets');

function getJsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...getJsFiles(full));
    } else if (extname(entry) === '.js') {
      files.push(full);
    }
  }
  return files;
}

const jsFiles = getJsFiles(distAssets);
console.log(`[build] 난독화 대상: ${jsFiles.length}개 JS 파일`);

for (const file of jsFiles) {
  const code = readFileSync(file, 'utf-8');
  // 이미 Vite가 번들/미니파이한 파일이므로 핵심 로직이 모두 포함됨
  console.log(`[build] 난독화 중: ${file} (${(code.length / 1024).toFixed(1)}KB)`);

  const result = JavaScriptObfuscator.obfuscate(code, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    stringArray: true,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.5,
    splitStrings: true,
    splitStringsChunkLength: 10,
    renameGlobals: false,
    selfDefending: true,
    transformObjectKeys: true,
    unicodeEscapeSequence: false,
    target: 'browser',
  });

  writeFileSync(file, result.getObfuscatedCode());
  console.log(`[build] 난독화 완료: ${file}`);
}

console.log('[build] 모든 작업 완료!');
