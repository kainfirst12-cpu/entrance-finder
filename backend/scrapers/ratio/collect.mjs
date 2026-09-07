// 실시간 경쟁률 한 바퀴 — 대학마다 대행사 페이지를 읽어 한 장의 스냅샷으로 만든다.
//
// 왜 스냅샷을 쌓나: 원서접수는 열흘이고 그 안에서 경쟁률이 계속 오른다. 상담에서 필요한 건
// "지금 3.5배"가 아니라 "**작년 이맘때 대비** 3.5배"다. 그 비교선은 시각별 기록을 쌓아야만 생긴다.
// (이투스 배포 엑셀이 파는 값이 바로 그 비교선이다 — 우리가 직접 쌓으면 내년부터는 자체 데이터다.)
//
// 예의: 한 번에 몰아치지 않는다. 몇 개씩 나눠 보내고 사이를 쉰다. 대행사 서버는 원서접수
// 기간 내내 수험생이 몰리는 곳이라 우리가 부하를 더하면 안 된다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchHtml } from './fetchHtml.mjs';
import { loadSources } from './sources.mjs';
import { parseRatioPage } from './parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SOURCES_FILE = path.join(HERE, 'sources.json');
export const OUT_DIR = path.join(HERE, '..', '..', 'data', 'ratio');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 대학 한 곳.
 *  배포 서버는 이 사이트들과 멀어서(리전이 다르다) 로컬보다 잘 끊긴다 — 실측으로
 *  로컬 실패 26곳이 서버에서 94곳이었다. 그래서 끊긴 것은 한 번 더, 더 길게 기다려 본다. */
export async function collectOne(src, { timeoutMs = 30000, retry = true } = {}) {
  const t0 = Date.now();
  try {
    let html;
    try {
      ({ html } = await fetchHtml(src.ratioUrl, { timeoutMs }));
    } catch (e) {
      const netish = /abort|timeout|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|socket/i.test(String(e?.message || e));
      if (!retry || !netish) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      ({ html } = await fetchHtml(src.ratioUrl, { timeoutMs: timeoutMs * 2 }));
    }
    const parsed = parseRatioPage(html);
    const real = parsed.units.filter((u) => !u.isTotal);
    if (!parsed.summary.length && !real.length) {
      return { ...src, ok: false, error: '표를 찾지 못함(접수 전이거나 모양이 다른 페이지)', ms: Date.now() - t0 };
    }
    return {
      ...src,
      ok: true,
      asOf: parsed.asOf,
      isFinal: parsed.isFinal,
      jeonhyeongCount: parsed.summary.filter((x) => !x.isTotal).length,
      unitCount: real.length,
      summary: parsed.summary,
      units: parsed.units,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ...src, ok: false, error: String(e?.message || e), ms: Date.now() - t0 };
  }
}

/**
 * 전체 한 바퀴.
 * @param {object} o
 * @param {number} o.concurrency 동시에 몇 곳 (기본 4 — 넉넉히 느리게)
 * @param {number} o.gapMs       묶음 사이 쉼 (기본 800ms)
 * @param {string[]} o.only      특정 대학만 (시험용)
 * @param {string[]} o.kinds     'jinhak' | 'uway' | 'own'
 */
export async function collectAll({ concurrency = 4, gapMs = 800, only = null, kinds = ['jinhak', 'uway'], onProgress } = {}) {
  let list = await loadSources();
  if (kinds) list = list.filter((s) => kinds.includes(s.kind));
  list = list.filter((s) => !!s.ratioUrl);      // 주소가 없으면 읽을 것이 없다
  if (only && only.length) list = list.filter((s) => only.includes(s.univ));

  const results = [];
  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency);
    const done = await Promise.all(batch.map(collectOne));
    results.push(...done);
    // 기다린다 — 부르는 쪽이 이 자리에서 저장하고 메모리를 비운다. 안 기다리면 저장이
    // 겹쳐 돌고, 다 받을 때까지 166곳치를 통째로 들고 있게 된다.
    if (onProgress) await onProgress(results.length, list.length, done);
    if (i + concurrency < list.length) await sleep(gapMs);
  }
  return { collectedAt: new Date().toISOString(), results };
}

/** 스냅샷 저장 — 시각별 파일 하나 + 최신 하나. 파일이 곧 기록이다. */
export async function saveSnapshot(snap) {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const stamp = snap.collectedAt.replace(/[:.]/g, '-');
  const file = path.join(OUT_DIR, `snapshot-${stamp}.json`);
  await fs.writeFile(file, JSON.stringify(snap), 'utf8');
  await fs.writeFile(path.join(OUT_DIR, 'latest.json'), JSON.stringify(snap), 'utf8');
  return file;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice(7).split(',').filter(Boolean) : null;
  const limitArg = args.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.slice(8)) : null;

  let list = await loadSources();
  if (limit) {
    const j = list.filter((s) => s.kind === 'jinhak').slice(0, Math.ceil(limit / 2));
    const u = list.filter((s) => s.kind === 'uway').slice(0, Math.floor(limit / 2));
    const names = [...j, ...u].map((s) => s.univ);
    console.log(`시험 수집 ${names.length}곳:`, names.join(', '));
    const snap = await collectAll({ only: names });
    report(snap);
  } else {
    const snap = await collectAll({
      only,
      onProgress: (n, total) => process.stdout.write(`\r수집 ${n}/${total}`),
    });
    process.stdout.write('\n');
    const file = await saveSnapshot(snap);
    report(snap);
    console.log('저장:', file);
  }
}

function report(snap) {
  const ok = snap.results.filter((r) => r.ok);
  const bad = snap.results.filter((r) => !r.ok);
  const units = ok.reduce((n, r) => n + r.unitCount, 0);
  console.log(`\n성공 ${ok.length}곳 / 실패 ${bad.length}곳 · 모집단위 ${units.toLocaleString()}줄`);
  const live = ok.filter((r) => !r.isFinal).length;
  console.log(`접수 중(최종 아님) ${live}곳 · 최종 표기 ${ok.length - live}곳`);
  for (const b of bad.slice(0, 12)) console.log(`  ✕ ${b.univ} (${b.kind}) — ${b.error}`);
}
