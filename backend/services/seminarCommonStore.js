// services/seminarCommonStore.js — 설명회 ① 제도 설명 '공통본' 판(version) 보관
//   관리자만 만들고 고친다. 발행(published)한 판 하나를 설명회 메뉴가 열린 학원 코드가 받아 쓴다.
//   slides[] 의 proposal 칸 = AI 가 제안한 변경(승인 전). 승인하면 화면이 내용에 반영하고 proposal 을 지운다.
import { getPool, dbEnabled } from './db.js';
import { SEED_2025 } from './seminarCommonSeed.js';

export async function ensureSeminarCommonTable() {
  if (!dbEnabled()) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ef_seminar_common (
      id           SERIAL PRIMARY KEY,
      title        TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'draft',          -- draft | published | archived
      meta         JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { goipYear, daeipYear, basedOn, notes }
      chapters     JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { "1": "고교학점제에 대하여", … }
      slides       JSONB NOT NULL DEFAULT '[]'::jsonb,
      base_id      INTEGER,
      updates      JSONB NOT NULL DEFAULT '[]'::jsonb,     -- AI 갱신 기록 [{chapter, at, summary, kbHits, extra}]
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      published_at TIMESTAMPTZ
    );
  `);
  // 처음 한 번 — 2025 설명회 원본을 넣어 둔다(새 판의 바탕)
  //   부팅 때 ensure 가 두 번(onDbReady·initDb 뒤) 돌 수 있어 '비어 있을 때만' 을 한 문장으로 건다.
  await pool.query(
    `INSERT INTO ef_seminar_common (title, status, meta, chapters, slides)
     SELECT $1, 'archived', $2::jsonb, $3::jsonb, $4::jsonb WHERE NOT EXISTS (SELECT 1 FROM ef_seminar_common)`,
    [SEED_2025.title, JSON.stringify(SEED_2025.meta), JSON.stringify(SEED_2025.chapters), JSON.stringify(SEED_2025.slides)]);
}

const LIST_COLS = `id, title, status, meta, base_id, updated_at, published_at, jsonb_array_length(slides) AS slide_count,
  (SELECT count(*) FROM jsonb_array_elements(slides) x WHERE x ? 'proposal')::int AS pending`;

export async function listCommon() {
  const { rows } = await getPool().query(`SELECT ${LIST_COLS} FROM ef_seminar_common ORDER BY id DESC`);
  return rows;
}
export async function getCommon(id) {
  const { rows } = await getPool().query(`SELECT * FROM ef_seminar_common WHERE id = $1`, [id]);
  return rows[0] || null;
}
export async function getPublishedCommon() {
  const { rows } = await getPool().query(`SELECT id, title, meta, chapters, slides, published_at FROM ef_seminar_common WHERE status = 'published' ORDER BY published_at DESC NULLS LAST LIMIT 1`);
  const v = rows[0];
  if (!v) return null;
  // 승인 안 된 제안·새 슬라이드는 내보내지 않는다
  v.slides = (v.slides || []).filter((s) => !s.removed && !s.pendingNew).map(({ proposal, ...s }) => s);
  return v;
}
export async function createCommonFrom(baseId, { title, meta } = {}) {
  const base = await getCommon(baseId);
  if (!base) throw new Error('바탕 판을 찾지 못했습니다');
  // 바탕의 미승인 제안·삭제 표시는 버리고 확정 내용만 복사
  const slides = (base.slides || []).filter((s) => !s.removed && !s.pendingNew).map(({ proposal, ...s }) => s);
  const { rows } = await getPool().query(
    `INSERT INTO ef_seminar_common (title, status, meta, chapters, slides, base_id) VALUES ($1, 'draft', $2::jsonb, $3::jsonb, $4::jsonb, $5) RETURNING *`,
    [String(title || `${base.title} 사본`).slice(0, 200), JSON.stringify({ ...(base.meta || {}), ...(meta || {}) }), JSON.stringify(base.chapters || {}), JSON.stringify(slides), base.id]);
  return rows[0];
}
export async function saveCommon(id, { title, meta, chapters, slides }) {
  const { rows } = await getPool().query(
    `UPDATE ef_seminar_common SET title = COALESCE($2, title), meta = COALESCE($3::jsonb, meta), chapters = COALESCE($4::jsonb, chapters),
       slides = COALESCE($5::jsonb, slides), updated_at = now() WHERE id = $1 RETURNING *`,
    [id, title ? String(title).slice(0, 200) : null, meta ? JSON.stringify(meta) : null, chapters ? JSON.stringify(chapters) : null, Array.isArray(slides) ? JSON.stringify(slides) : null]);
  return rows[0] || null;
}
export async function appendCommonUpdate(id, entry) {
  await getPool().query(`UPDATE ef_seminar_common SET updates = updates || $2::jsonb WHERE id = $1`, [id, JSON.stringify([entry])]);
}
export async function publishCommon(id) {
  const pool = getPool();
  await pool.query(`UPDATE ef_seminar_common SET status = 'archived' WHERE status = 'published' AND id <> $1`, [id]);
  const { rows } = await pool.query(`UPDATE ef_seminar_common SET status = 'published', published_at = now() WHERE id = $1 RETURNING id`, [id]);
  return !!rows[0];
}
export async function deleteCommon(id) {
  await getPool().query(`DELETE FROM ef_seminar_common WHERE id = $1 AND status <> 'published'`, [id]);
}

// ── AI 제안 끼워 넣기(순수 함수) ─────────────────────────────────────────────
// parsed = { slides:[{id, action:keep|update|remove|new, after?, layout, heading, data, source, reason, evidence}] }
// 내용은 바꾸지 않고 slides[].proposal 에만 넣는다. 새 슬라이드는 pendingNew 로 끼워 두고 승인 전엔 출력에서 빠진다.
export const COMMON_LAYOUTS = new Set(['section', 'statement', 'qa', 'cards', 'bullets', 'table', 'compare', 'figure']);
export function okCommonData(layout, d) {
  if (!d || typeof d !== 'object') return false;
  if (layout === 'section') return typeof d.title === 'string';
  if (layout === 'statement') return Array.isArray(d.lines) && d.lines.length > 0;
  if (layout === 'qa') return typeof d.q === 'string' && Array.isArray(d.a);
  if (layout === 'cards') return Array.isArray(d.cards) && d.cards.length > 0;
  if (layout === 'bullets') return Array.isArray(d.items) && d.items.length > 0;
  if (layout === 'table') return Array.isArray(d.columns) && Array.isArray(d.rows);
  if (layout === 'compare') return !!(d.left && d.right && Array.isArray(d.left.items) && Array.isArray(d.right.items));
  if (layout === 'figure') return typeof d.caption === 'string';
  return false;
}
export function applyCommonProposals(current, chapter, parsed) {
  const slides = [...current];
  const index = () => new Map(slides.map((s, i) => [s.id, i]));
  let byId = index();
  const counts = { update: 0, remove: 0, new: 0 };
  let seq = Date.now() % 100000;
  const inChapter = (i) => i !== undefined && Number(slides[i].chapter) === Number(chapter);
  for (const p of Array.isArray(parsed?.slides) ? parsed.slides : []) {
    const reason = String(p.reason || '').slice(0, 400), evidence = String(p.evidence || '').slice(0, 300);
    const i = byId.get(p.id);
    if (p.action === 'update' && inChapter(i) && COMMON_LAYOUTS.has(p.layout) && okCommonData(p.layout, p.data)) {
      slides[i] = { ...slides[i], proposal: { action: 'update', layout: p.layout, heading: String(p.heading || '').slice(0, 120), data: p.data, source: p.source ? String(p.source).slice(0, 200) : '', reason, evidence } };
      counts.update++;
    } else if (p.action === 'remove' && inChapter(i)) {
      slides[i] = { ...slides[i], proposal: { action: 'remove', reason, evidence } };
      counts.remove++;
    } else if (p.action === 'new' && COMMON_LAYOUTS.has(p.layout) && okCommonData(p.layout, p.data)) {
      const sl = { id: `n${chapter}_${seq++}`, chapter: Number(chapter), layout: p.layout, heading: String(p.heading || '').slice(0, 120), data: p.data,
        ...(p.source ? { source: String(p.source).slice(0, 200) } : {}), pendingNew: true, proposal: { action: 'new', reason, evidence } };
      // after 뒤(같은 장일 때만), 아니면 그 장의 끝
      const a = byId.get(p.after);
      const at = inChapter(a) ? a + 1 : slides.reduce((last, s, k) => (Number(s.chapter) === Number(chapter) ? k + 1 : last), slides.length);
      slides.splice(at, 0, sl);
      byId = index();
      counts.new++;
    }
  }
  return { slides, counts };
}
