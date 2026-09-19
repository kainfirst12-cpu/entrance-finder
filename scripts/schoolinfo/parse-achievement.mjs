// captcha-runner 가 저장한 표 그리드(out/achievement-raw/<id>.json) → 밴드 배열(catalog 의 bands 스키마)
//   bands[] = { grade, semester, subject, credit, family, year, mean, sd, a, b, c, d, e }
// 표 한 줄 = [계열(학과), 과목(단위), 1학기 평균, A, B, C, D, E, 2학기 평균, A, B, C, D, E]
//   - 1학기 칸이 비어 있으면 그 과목은 2학기만 운영(2022 교육과정 공통국어1/2 처럼 학기 분리)
//   - 3단계(A·B·C)만 공시되는 진로선택·체육예술 과목은 D·E 가 빈칸 → null
//   - 표준편차는 2026년 공시 표에 없다 → sd: null (예전 catalog 는 있었음)
//   - 계열이 '전체계열 / 전체학과' 가 아닌 줄(특성화고 학과별 산출)은 계열명을 subject 뒤에 붙여 구분한다
import fs from 'node:fs';
import path from 'node:path';

export function familyOf(subject) {
  const s = subject.replace(/\s+/g, '');
  if (/중국어|일본어|독일어|프랑스어|스페인어|러시아어|아랍어|베트남어|한문/.test(s)) return null;
  if (/영어|영미/.test(s)) return '영어';
  if (/수학|미적분|확률과통계|기하|대수|경제수학|인공지능수학/.test(s)) return '수학';
  if (/국어|문학|독서|화법|작문|언어와매체|매체/.test(s)) return '국어';
  return null;
}
const num = (v) => { const t = String(v ?? '').trim(); if (t === '' || t === '-') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };

export function parseRecord(rec) {
  const bands = [];
  for (const [gk, g] of Object.entries(rec.grades || {})) {
    const grade = parseInt(gk, 10); if (!grade) continue;
    const year = g.year || null;
    for (const row of g.rows || []) {
      if (!row || row.length < 8 || row[1] === '과 목' || row[0] === '계열(학과)') continue;
      const track = (row[0] || '').trim();
      const m = (row[1] || '').trim().match(/^(.*?)\s*\((\d+(?:\.\d+)?)\)\s*$/);
      const subjectName = m ? m[1].trim() : (row[1] || '').trim();
      const credit = m ? Number(m[2]) : null;
      if (!subjectName) continue;
      const suffix = track && !/전체계열\s*\/\s*전체학과/.test(track) ? ` [${track}]` : '';
      const subject = subjectName + suffix;
      for (const sem of [1, 2]) {
        const o = sem === 1 ? 2 : 8;
        const mean = num(row[o]);
        const a = num(row[o + 1]), b = num(row[o + 2]), c = num(row[o + 3]), d = num(row[o + 4]), e = num(row[o + 5]);
        if (mean === null && a === null && b === null && c === null) continue; // 해당 학기 미운영
        bands.push({ grade, semester: sem, subject, credit, family: familyOf(subjectName), year, mean, sd: null, a, b, c, d, e });
      }
    }
  }
  return bands;
}

export function loadAll(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const rec = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    out.push({ id: rec.id, name: rec.name, chasu: rec.chasu, capturedAt: rec.capturedAt, bands: parseRecord(rec) });
  }
  return out;
}

if (process.argv[1] && /parse-achievement\.mjs$/.test(process.argv[1])) {
  const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const dir = process.argv[2] || path.join(here, 'out', 'achievement-raw');
  const all = loadAll(dir);
  for (const s of all) {
    const g1e = s.bands.find((b) => b.grade === 1 && b.family === '영어' && b.semester === 2) || s.bands.find((b) => b.grade === 1 && b.family === '영어');
    console.log(`${s.name}\t밴드 ${s.bands.length}\t고1 영어: ${g1e ? `${g1e.subject} A ${g1e.a}% 평균 ${g1e.mean}` : '없음'}`);
  }
  fs.writeFileSync(path.join(here, 'out', 'achievement-parsed.json'), JSON.stringify(all), 'utf8');
  console.log(`→ out/achievement-parsed.json (${all.length}곳)`);
}
