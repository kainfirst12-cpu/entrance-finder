/**
 * SKYPASS 2027 지원 시 유의사항 → 입결 카드에 붙이기
 *
 * 왜 필요한가
 *   입결 콘솔은 학생의 일반 등급과 어디가 grade70 의 거리로 안정/적정/소신/위험을 매긴다.
 *   그런데 매칭된 156개 대학 중 **123개가 "그 등급은 우리 대학 환산이라 일반 등급과
 *   같은 자가 아니다"** 라고 적혀 있다. 그 대학들에서 지금 판정은 성립하지 않는다.
 *   이 모듈은 그 사실을 카드마다 실어 보내, 화면이 "판정은 나왔지만 이 자로 잰 것이
 *   아니다"라고 말할 수 있게 한다.
 *
 * 붙이는 단위는 세 겹이다(넓은 것 → 좁은 것).
 *   univ    : 대학 전체에 걸리는 말 ("○○대식 환산등급으로 판단할 것")
 *   type    : 그 전형 전체 (모집단위가 '전형 전체')
 *   dept    : 특정 학과
 * 좁을수록 그 카드에 정확히 해당하므로 화면에서 먼저 보여준다.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'skypass', '2027-notes.json');

let _cache = null;
function load() {
  if (_cache !== null) return _cache;
  try {
    _cache = existsSync(DATA) ? JSON.parse(readFileSync(DATA, 'utf8')) : { byUniv: {} };
  } catch (err) {
    console.warn('[skypass] 유의사항 자료를 읽지 못했습니다:', err.message);
    _cache = { byUniv: {} };   // 없으면 조용히 비활성 — 입결 조회 자체가 막히면 안 된다
  }
  return _cache;
}

/** 전형명 비교용 정규화 — "학생부교과(학생부우수자)"·"학생부우수자전형" → "학생부우수자" */
const normType = (s) => String(s || '')
  .replace(/^학생부\s*(교과|종합)\s*[([]?/, '')
  .replace(/[)\]]\s*$/, '')
  .replace(/전형\s*$/, '')
  .replace(/[\s()[\]·・,]/g, '')
  .toLowerCase();

/** 학과명 비교용 — 괄호 속 세부전공까지 떼면 "경영대학(경영,회계)" 과 "경영대학" 이 만난다 */
const normDept = (s) => String(s || '').replace(/\(.*?\)/g, '').replace(/[\s·・]/g, '').toLowerCase();

function typeMatches(noteType, entryType) {
  const a = normType(noteType), b = normType(entryType);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function deptMatches(note, entryDept) {
  if (note.unitAll) return true;                       // '전형 전체'
  const d = normDept(entryDept);
  if (!d) return false;
  return (note.units || []).some((u) => {
    const n = normDept(u);
    return n && (n === d || n.includes(d) || d.includes(n));
  });
}

/**
 * 이 대학의 유의사항을 entries 각각에 붙인다.
 * @returns {{ univNotes, flags, byEntry: Map<entryKey, notes[]> }}
 */
export function attachSkypassNotes(unvCd, entries = []) {
  const rec = load().byUniv?.[unvCd];
  if (!rec) return null;

  const notes = rec.notes || [];
  // 대학 전체에 걸리는 말 — 어느 카드를 보든 항상 따라다녀야 하는 경고.
  // 같은 문장이 전형마다 반복되므로(“○○대식 환산등급으로 판단할 것”) 문장 단위로 접는다.
  const univLevel = [];
  const seen = new Set();
  for (const n of notes) {
    if (!n.tags?.includes('scaleWarning')) continue;
    if (seen.has(n.note)) continue;
    seen.add(n.note);
    univLevel.push({ note: n.note, tags: n.tags });
  }

  const byEntry = {};
  for (const e of entries) {
    const key = `${e.track}|${e.typeName}|${e.dept}`;
    const hits = [];
    for (const n of notes) {
      if (n.track && e.track && n.track !== e.track) continue;
      if (!typeMatches(n.typeName, e.typeName)) continue;
      if (!deptMatches(n, e.dept)) continue;
      hits.push({
        note: n.note, tags: n.tags, cutValues: n.cutValues,
        scope: n.unitAll ? 'type' : 'dept',
        typeName: n.typeName, unitRaw: n.unitRaw,
      });
    }
    // 학과 지정이 전형 전체보다 구체적이므로 먼저 보여준다
    hits.sort((a, b) => (a.scope === 'dept' ? -1 : 1) - (b.scope === 'dept' ? -1 : 1));
    if (hits.length) byEntry[key] = hits;
  }

  const flags = {};
  for (const n of notes) for (const t of (n.tags || [])) flags[t] = true;

  return {
    source: load().source,
    year: load().year,
    univName: rec.rawNames?.join(' · ') || rec.rawName,
    total: notes.length,
    scaleWarning: univLevel.length > 0,   // ★ 등급 직접 비교가 성립하지 않는 대학인가
    univNotes: univLevel,
    flags,
    byEntry,
  };
}

/** 그 대학이 '자체 환산등급' 경고 대상인지만 빠르게 (목록 화면용) */
export function hasScaleWarning(unvCd) {
  const rec = load().byUniv?.[unvCd];
  return !!rec?.notes?.some((n) => n.tags?.includes('scaleWarning'));
}

export function skypassLoaded() {
  const d = load();
  return { count: d.count || 0, univCount: Object.keys(d.byUniv || {}).length };
}
