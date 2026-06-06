// services/admissionStore.js — 대학 입결(어디가 등 공식자료) 업로드/검색
import * as XLSX from 'xlsx';
import { getPool, dbEnabled } from './db.js';

// 헤더 키워드로 값 찾기
function pick(row, keywords) {
  for (const [k, v] of Object.entries(row)) {
    const key = String(k);
    if (keywords.some(kw => key.includes(kw))) {
      const val = String(v ?? '').trim();
      if (val) return val;
    }
  }
  return '';
}

// 엑셀/CSV 버퍼 → 행 객체 배열 (첫 시트, 헤더=가장 셀이 많은 상단 행 기준)
export function parseSheet(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  // 전체를 배열의 배열로 읽어 헤더 행 자동 감지
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  if (aoa.length === 0) return [];
  // 비어있지 않은 셀이 가장 많은 상위 5행 중 하나를 헤더로
  let headerIdx = 0, best = -1;
  for (let i = 0; i < Math.min(aoa.length, 6); i++) {
    const cnt = aoa[i].filter(c => String(c).trim()).length;
    if (cnt > best) { best = cnt; headerIdx = i; }
  }
  const headers = aoa[headerIdx].map((h, i) => String(h).trim() || `col${i}`);
  const rows = [];
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const arr = aoa[r];
    if (!arr.some(c => String(c).trim())) continue;
    const obj = {};
    headers.forEach((h, i) => { obj[h] = arr[i] ?? ''; });
    rows.push(obj);
  }
  return rows;
}

// 행들을 ef_admissions에 저장. meta: {year, univType, track}
export async function ingestRows(rows, meta = {}) {
  if (!dbEnabled()) throw new Error('DB 비활성 상태입니다');
  const pool = getPool();
  const records = [];
  for (const row of rows) {
    const univ = pick(row, ['대학교', '대학명', '대학']);
    const dept = pick(row, ['모집단위', '학과', '전공', '계열']);
    const admissionType = pick(row, ['전형명', '전형유형', '전형구분', '전형']);
    if (!univ && !dept) continue; // 빈/푸터 행 스킵
    const yearStr = pick(row, ['학년도', '연도', '년도']);
    const year = parseInt(String(yearStr).replace(/[^0-9]/g, ''), 10) || meta.year || null;
    records.push({ year, univType: meta.univType || '', track: meta.track || '', univ, dept, admissionType, raw: row });
  }
  if (records.length === 0) return 0;

  let inserted = 0;
  const BATCH = 200;
  for (let i = 0; i < records.length; i += BATCH) {
    const slice = records.slice(i, i + BATCH);
    const values = [], params = [];
    slice.forEach((r, j) => {
      const b = j * 7;
      values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7}::jsonb)`);
      params.push(r.year, r.univType, r.track, r.univ, r.dept, r.admissionType, JSON.stringify(r.raw));
    });
    await pool.query(
      `INSERT INTO ef_admissions (year, univ_type, track, univ, dept, admission_type, raw) VALUES ${values.join(',')}`,
      params
    );
    inserted += slice.length;
  }
  return inserted;
}

export async function searchAdmissions({ univ, dept, track, year, univType, limit = 300 }) {
  if (!dbEnabled()) return [];
  const pool = getPool();
  const where = [], params = [];
  const add = (cond, val) => { params.push(val); where.push(cond.replace('?', `$${params.length}`)); };
  if (univ) add(`univ ILIKE ?`, `%${univ}%`);
  if (dept) add(`dept ILIKE ?`, `%${dept}%`);
  if (track) add(`track = ?`, track);
  if (univType) add(`univ_type = ?`, univType);
  if (year) add(`year = ?`, Number(year));
  const sql = `SELECT * FROM ef_admissions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY univ, dept LIMIT ${Math.min(Number(limit) || 300, 1000)}`;
  const { rows } = await pool.query(sql, params);
  return rows;
}

export async function admissionStats() {
  if (!dbEnabled()) return { total: 0 };
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(DISTINCT univ)::int AS univ_count,
           MIN(year) AS min_year, MAX(year) AS max_year
    FROM ef_admissions`);
  const { rows: yrs } = await pool.query(`SELECT DISTINCT year FROM ef_admissions WHERE year IS NOT NULL ORDER BY year DESC`);
  return { ...rows[0], years: yrs.map(r => r.year) };
}

export async function clearAdmissions() {
  if (!dbEnabled()) throw new Error('DB 비활성 상태입니다');
  await getPool().query(`TRUNCATE ef_admissions RESTART IDENTITY`);
}
