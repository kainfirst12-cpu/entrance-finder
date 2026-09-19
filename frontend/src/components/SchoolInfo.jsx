import { useEffect, useMemo, useState } from 'react';
import DisclosureNotice from './DisclosureNotice';

// 전국 고교·중학 공시정보 — 학교알리미 교과별 학업성취(A~E 비율·평균) + 학년별 재적 + EDSS 학급·교원.
// 데이터는 /data/school-catalog.json.gz 하나(정적 파일). 서버·로그인 토큰이 필요 없어 백엔드를 건드리지 않는다.
// catalog 스키마는 bucheon-schoolinfo 와 같다 — 갱신은 scripts/schoolinfo/ 의 build_catalog.py 가 같은 형태로 만든다.

const CATALOG_URL = '/data/school-catalog.json.gz';
const SUBJECTS = ['국어', '영어', '수학'];
const BAND_KEYS = ['a', 'b', 'c', 'd', 'e'];
const BAND_COLORS = { a: '#2dd4bf', b: '#60a5fa', c: '#a78bfa', d: '#fbbf24', e: '#f87171' };
const PAGE = 60;
const MAX_COMPARE = 4;

async function fetchGzJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (${res.status})`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Vercel 은 .gz 를 그대로 내려준다(Content-Encoding 없음) → 브라우저 내장 DecompressionStream 으로 푼다.
  // 이미 풀린 JSON 이 오는 환경(로컬 dev 서버 등)도 있어 gzip 매직바이트로 구분한다.
  let text;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const ds = new DecompressionStream('gzip');
    text = await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
  } else {
    text = new TextDecoder().decode(buf);
  }
  return JSON.parse(text);
}

async function loadCatalog() {
  const cat = await fetchGzJson(CATALOG_URL);
  cat.schools = cat.schools.map((s) => ({
    ...s,
    gender: s.gender === '녀' || s.gender === '여' ? '여자' : s.gender === '남' ? '남자' : s.gender,
  }));
  return cat;
}

// catalog 의 bands 는 국·영·수만 실려 있다(전국 45만 줄을 다 실으면 84MB). 전 과목 표는 학교의 bandsFile
// (시도×급별 파일, { [school.id]: bands[] }) 에 있어 상세 모달이 열릴 때 한 번 받아 두고 같은 시도는 재사용한다.
const bandFileCache = new Map();
function loadFullBands(school) {
  if (!school.bandsFile) return Promise.resolve(null);
  const url = CATALOG_URL.replace(/[^/]+$/, school.bandsFile);
  if (!bandFileCache.has(url)) bandFileCache.set(url, fetchGzJson(url).catch((e) => { bandFileCache.delete(url); throw e; }));
  return bandFileCache.get(url).then((m) => m[school.id] || null);
}

// 과목군(국어/영어/수학)·학년의 성취도 — 같은 학년이면 뒤 학기(2학기)를 우선한다.
// 종합고·특성화고는 '과목 [일반계 / 전체학과]' 처럼 계열별 줄만 있고 전체 줄이 없는 곳이 있다(493곳) →
// 전체계열 줄 > 일반계 줄 > 나머지 순으로 고른다.
function trackRank(subject) { return !/\[/.test(subject) ? 0 : /일반계/.test(subject) ? 1 : 2; }
function pickBand(school, subject, grade) {
  const list = (school.bands || []).filter((b) => b.family === subject && b.grade === grade && b.a !== null);
  if (!list.length) return null;
  return list.sort((x, y) => trackRank(x.subject) - trackRank(y.subject) || (y.semester || 0) - (x.semester || 0))[0];
}
function seatsOf(s) {
  const g1 = s.enrollment?.grade1;
  return g1 ? Math.round(g1 * 0.1) : null;
}
function pct(v) { return v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`; }
function num(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString('ko-KR'); }
function dec1(v) { return v === null || v === undefined ? '—' : Number(v).toFixed(1); }

export default function SchoolInfo() {
  const [cat, setCat] = useState(null);
  const [err, setErr] = useState('');
  const [level, setLevel] = useState('고등학교');
  const [q, setQ] = useState('');
  const [sido, setSido] = useState('전체');
  const [sigungu, setSigungu] = useState('전체');
  const [type, setType] = useState('전체');
  const [fond, setFond] = useState('전체');
  const [gender, setGender] = useState('전체');
  const [sort, setSort] = useState('name');
  const [subject, setSubject] = useState('영어');
  const [grade, setGrade] = useState(1);
  const [limit, setLimit] = useState(PAGE);
  const [detailId, setDetailId] = useState(null);
  const [compare, setCompare] = useState([]);
  const [showCompare, setShowCompare] = useState(false);

  useEffect(() => {
    let dead = false;
    loadCatalog().then((c) => { if (!dead) setCat(c); }).catch((e) => { if (!dead) setErr(e.message || '데이터 로드 실패'); });
    return () => { dead = true; };
  }, []);

  const schools = useMemo(() => (cat?.schools || []).filter((s) => s.schoolLevel === level), [cat, level]);
  const sidos = useMemo(() => [...new Set(schools.map((s) => s.sido))].sort(), [schools]);
  const sigungus = useMemo(
    () => (sido === '전체' ? [] : [...new Set(schools.filter((s) => s.sido === sido).map((s) => s.sigungu))].sort()),
    [schools, sido],
  );
  const types = useMemo(() => [...new Set(schools.map((s) => s.schoolType))].sort(), [schools]);
  const fonds = useMemo(() => [...new Set(schools.map((s) => s.fond).filter(Boolean))].sort(), [schools]);

  useEffect(() => { setSigungu('전체'); }, [sido]);
  useEffect(() => { setLimit(PAGE); }, [level, q, sido, sigungu, type, fond, gender, sort, subject, grade]);
  useEffect(() => { setType('전체'); }, [level]);

  const filtered = useMemo(() => {
    const kw = q.trim().replace(/\s+/g, '');
    let list = schools.filter((s) =>
      (sido === '전체' || s.sido === sido) &&
      (sigungu === '전체' || s.sigungu === sigungu) &&
      (type === '전체' || s.schoolType === type) &&
      (fond === '전체' || s.fond === fond) &&
      (gender === '전체' || s.gender === gender) &&
      (!kw || s.schoolName.replace(/\s+/g, '').includes(kw)),
    );
    const key = (s) => pickBand(s, subject, grade);
    const cmpNum = (get, desc) => (x, y) => {
      const a = get(x), b = get(y);
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return desc ? b - a : a - b;
    };
    const sorters = {
      name: (x, y) => x.schoolName.localeCompare(y.schoolName, 'ko'),
      'seats-desc': cmpNum((s) => seatsOf(s), true),
      'enroll-desc': cmpNum((s) => s.enrollment?.total ?? null, true),
      'a-desc': cmpNum((s) => key(s)?.a ?? null, true),
      'a-asc': cmpNum((s) => key(s)?.a ?? null, false),
      'mean-desc': cmpNum((s) => key(s)?.mean ?? null, true),
    };
    list = [...list].sort(sorters[sort] || sorters.name);
    return list;
  }, [schools, q, sido, sigungu, type, fond, gender, sort, subject, grade]);

  const detail = detailId ? schools.find((s) => s.id === detailId) || (cat?.schools || []).find((s) => s.id === detailId) : null;
  const compareSchools = compare.map((id) => (cat?.schools || []).find((s) => s.id === id)).filter(Boolean);
  const toggleCompare = (id) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_COMPARE ? c : [...c, id]));

  const isHigh = level === '고등학교';
  const scopeLabel = [sido === '전체' ? '전국' : sido, sigungu === '전체' ? '' : sigungu].filter(Boolean).join(' ');

  if (err) return <div style={S.page}><h2 style={S.h2}>🏫 고교·중학 공시정보</h2><p style={S.err}>{err}</p></div>;
  if (!cat) return <div style={S.page}><h2 style={S.h2}>🏫 고교·중학 공시정보</h2><p style={S.lead}>학교 데이터를 불러오는 중… (전국 5,000여 개교, 처음 한 번만)</p></div>;

  return (
    <div style={S.page}>
      <div style={S.headRow}>
        <div>
          <h2 style={S.h2}>🏫 고교·중학 공시정보</h2>
          <p style={S.lead}>
            학교알리미 {cat.disclosureYear} 공시({cat.academicYear} 성취도) · 학년별 재적 · EDSS 학급·교원 — 전국 고교 {num(cat.schools.filter((s) => s.schoolLevel === '고등학교').length)}곳, 중학 {num(cat.schools.filter((s) => s.schoolLevel === '중학교').length)}곳
          </p>
        </div>
        <div style={S.levelTabs}>
          {['고등학교', '중학교'].map((l) => (
            <button key={l} style={{ ...S.tab, ...(level === l ? S.tabOn : {}) }} onClick={() => setLevel(l)}>{l}</button>
          ))}
        </div>
      </div>

      <DisclosureNotice compact />

      {/* 필터 */}
      <div style={S.filters}>
        <input style={{ ...S.input, minWidth: 220 }} placeholder="학교명 검색 (예: 부천고, 대원외고)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select style={S.select} value={sido} onChange={(e) => setSido(e.target.value)}>
          <option value="전체">시도 전체</option>
          {sidos.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select style={S.select} value={sigungu} onChange={(e) => setSigungu(e.target.value)} disabled={sido === '전체'}>
          <option value="전체">시군구 전체</option>
          {sigungus.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {isHigh && (
          <select style={S.select} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="전체">유형 전체</option>
            {types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <select style={S.select} value={fond} onChange={(e) => setFond(e.target.value)}>
          <option value="전체">설립 전체</option>
          {fonds.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select style={S.select} value={gender} onChange={(e) => setGender(e.target.value)}>
          <option value="전체">남녀 전체</option>
          <option value="남녀공학">남녀공학</option>
          <option value="남자">남자</option>
          <option value="여자">여자</option>
        </select>
        <select style={S.select} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name">이름순</option>
          {isHigh && <option value="seats-desc">1등급 자리 많은순</option>}
          <option value="enroll-desc">재적 많은순</option>
          <option value="a-desc">A비율 높은순</option>
          <option value="a-asc">A비율 낮은순</option>
          <option value="mean-desc">평균 높은순</option>
        </select>
      </div>
      <div style={S.filters}>
        <span style={S.filterLabel}>성취도 과목</span>
        {SUBJECTS.map((s) => <button key={s} style={{ ...S.chip, ...(subject === s ? S.chipOn : {}) }} onClick={() => setSubject(s)}>{s}</button>)}
        <span style={{ ...S.filterLabel, marginLeft: 12 }}>학년</span>
        {[1, 2, 3].map((g) => <button key={g} style={{ ...S.chip, ...(grade === g ? S.chipOn : {}) }} onClick={() => setGrade(g)}>{g}학년</button>)}
        <span style={{ flex: 1 }} />
        <span style={S.count}>{scopeLabel} {level} <b>{num(filtered.length)}곳</b></span>
      </div>

      {/* 목록 */}
      <div style={S.grid}>
        {filtered.slice(0, limit).map((s) => {
          const b = pickBand(s, subject, grade);
          const seats = seatsOf(s);
          const inCmp = compare.includes(s.id);
          return (
            <div key={s.id} style={S.card}>
              <div style={S.cardHead}>
                <div style={{ minWidth: 0 }}>
                  <div style={S.name} title={s.schoolName}>{s.schoolName}</div>
                  <div style={S.sub}>{s.sido} {s.sigungu} · {s.schoolType}</div>
                </div>
                <button style={{ ...S.smallBtn, ...(inCmp ? S.smallBtnOn : {}) }} onClick={() => toggleCompare(s.id)} title={inCmp ? '비교함에서 빼기' : '비교함에 담기'}>
                  {inCmp ? '담김' : '+ 비교'}
                </button>
              </div>
              <div style={S.badges}>
                {s.gender && <span style={S.badge}>{s.gender}</span>}
                {s.fond && <span style={S.badge}>{s.fond}</span>}
                {s.enrollment?.grade1 != null && <span style={S.badgeDim}>재적 {s.enrollment.grade1}·{s.enrollment.grade2 ?? '—'}·{s.enrollment.grade3 ?? '—'} (1·2·3학년)</span>}
                {s.enrollment?.grade1 == null && s.current?.students != null && <span style={S.badgeDim}>학생 {s.current.students}명 · 교원 {s.current.teachers ?? '—'}명 (2026 학교정보)</span>}
              </div>
              {isHigh && seats !== null && (
                <div style={S.seats}>1학년 {s.enrollment.grade1}명 중 1등급권 <b>{seats}자리</b> <span style={S.dim}>· 5등급제 상위 10% 가정</span></div>
              )}
              {s.edss && (s.edss.classes !== null || s.edss.teachers !== null) && (
                <div style={S.dim}>{s.edss.classes !== null ? `${s.edss.classes}학급` : ''}{s.edss.classes !== null && s.edss.teachers !== null ? ' · ' : ''}{s.edss.teachers !== null ? `교원 ${s.edss.teachers}명` : ''}</div>
              )}
              <div style={S.bandTitle}>
                {b ? <>{isHigh ? '고' : '중'}{grade} {b.subject} · {b.year} {b.semester}학기 · A <b>{pct(b.a)}</b> · 평균 <b>{dec1(b.mean)}</b></> : <span style={S.dim}>{grade}학년 {subject} 성취도 공시 없음</span>}
              </div>
              {b && <BandBar band={b} />}
              <div style={S.cardFoot}>
                <button style={S.linkBtn} onClick={() => setDetailId(s.id)}>상세 보기 →</button>
              </div>
            </div>
          );
        })}
      </div>
      {filtered.length > limit && (
        <div style={{ textAlign: 'center', margin: '18px 0' }}>
          <button style={S.moreBtn} onClick={() => setLimit((l) => l + PAGE * 2)}>더 보기 ({num(filtered.length - limit)}곳 남음)</button>
        </div>
      )}
      {filtered.length === 0 && <p style={S.lead}>조건에 맞는 학교가 없습니다.</p>}

      {/* 비교함 */}
      {compare.length > 0 && (
        <div style={S.tray}>
          <span style={{ fontWeight: 700 }}>비교함 {compare.length}/{MAX_COMPARE}</span>
          {compareSchools.map((s) => (
            <span key={s.id} style={S.trayChip}>{s.schoolName} <b style={{ cursor: 'pointer', marginLeft: 4 }} onClick={() => toggleCompare(s.id)}>×</b></span>
          ))}
          <span style={{ flex: 1 }} />
          {compare.length >= 2
            ? <button style={S.primary} onClick={() => setShowCompare(true)}>비교 보기</button>
            : <span style={S.dim}>한 곳 더 담으면 비교됩니다</span>}
          <button style={S.linkBtn} onClick={() => setCompare([])}>비우기</button>
        </div>
      )}

      {detail && <DetailModal school={detail} onClose={() => setDetailId(null)} inCompare={compare.includes(detail.id)} onToggleCompare={() => toggleCompare(detail.id)} />}
      {showCompare && compareSchools.length >= 2 && <CompareModal schools={compareSchools} subject={subject} grade={grade} onClose={() => setShowCompare(false)} />}
    </div>
  );
}

function BandBar({ band }) {
  return (
    <div>
      <div style={S.bar}>
        {BAND_KEYS.map((k) => (band[k] ? <div key={k} style={{ width: `${band[k]}%`, background: BAND_COLORS[k] }} title={`${k.toUpperCase()} ${band[k]}%`} /> : null))}
      </div>
      <div style={S.barLegend}>
        {BAND_KEYS.map((k) => <span key={k}><i style={{ ...S.dot, background: BAND_COLORS[k] }} />{k.toUpperCase()} {pct(band[k])}</span>)}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div style={S.stat}>
      <div style={S.statLabel}>{label}</div>
      <div style={S.statValue}>{value}</div>
      {hint && <div style={S.statHint}>{hint}</div>}
    </div>
  );
}

function DetailModal({ school: s, onClose, inCompare, onToggleCompare }) {
  const isHigh = s.schoolLevel === '고등학교';
  const seats = seatsOf(s);
  // 전 과목 표(기타 과목)는 열릴 때 따로 받는다 — 받기 전엔 catalog 에 실린 국·영·수만 보인다.
  const [full, setFull] = useState(null);
  const [fullState, setFullState] = useState(s.bandsFile ? 'loading' : 'none');
  useEffect(() => {
    let dead = false;
    setFull(null); setFullState(s.bandsFile ? 'loading' : 'none');
    if (!s.bandsFile) return undefined;
    loadFullBands(s).then((b) => { if (!dead) { setFull(b); setFullState(b ? 'ok' : 'none'); } }).catch(() => { if (!dead) setFullState('error'); });
    return () => { dead = true; };
  }, [s]);
  const bands = full || s.bands || [];
  // 과목군 → 학년·학기 순으로 표를 만든다. 3학년 선택과목은 A~C 만 있는 것도 있어 null 은 '—' 로 둔다.
  const families = ['국어', '영어', '수학'];
  const bandsBy = (fam) => bands.filter((b) => b.family === fam).sort((x, y) => x.grade - y.grade || x.semester - y.semester);
  const others = bands.filter((b) => !families.includes(b.family));
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 style={S.h3}>{s.schoolName}</h3>
              <span style={S.badge}>{s.schoolType}</span>{s.gender && <span style={S.badge}>{s.gender}</span>}{s.fond && <span style={S.badge}>{s.fond}</span>}
            </div>
            <div style={S.sub}>{s.sido} {s.sigungu}{s.address ? ` · ${s.address}` : ''} · 학교알리미 교과별 학업성취 공시{s.achievementChasu ? `(${s.achievementChasu.slice(0, 4)}년 ${s.achievementChasu.slice(4)}차)` : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...S.smallBtn, ...(inCompare ? S.smallBtnOn : {}) }} onClick={onToggleCompare}>{inCompare ? '비교함에서 빼기' : '+ 비교함에 담기'}</button>
            <button style={S.smallBtn} onClick={onClose}>닫기 ✕</button>
          </div>
        </div>

        <div style={S.statGrid}>
          <Stat label="전체 재적" value={s.enrollment ? `${num(s.enrollment.total)}명` : '—'} hint={s.enrollment ? `${s.enrollment.grade1 ?? '—'}·${s.enrollment.grade2 ?? '—'}·${s.enrollment.grade3 ?? '—'} (1·2·3학년)` : '재적 공시 없음'} />
          {isHigh && <Stat label="1등급권 자리" value={seats === null ? '—' : `${seats}개`} hint="1학년 인원 × 10% (2022 교육과정 5등급제, 반올림)" />}
          <Stat label="학급 수" value={s.edss?.classes != null ? `${s.edss.classes}학급` : '—'} hint={s.edss ? `${s.edss.classGrade1 ?? '—'}·${s.edss.classGrade2 ?? '—'}·${s.edss.classGrade3 ?? '—'} (1·2·3학년) · EDSS 2025` : 'EDSS 미매칭'} />
          <Stat label="교원 수" value={s.edss?.teachers != null ? `${s.edss.teachers}명` : '—'} hint={s.edss?.staff != null ? `직원 ${s.edss.staff}명` : 'EDSS 2025'} />
          <Stat label="입학생 / 졸업생" value={s.edss ? `${s.edss.entrants ?? '—'} / ${s.edss.graduates ?? '—'}` : '—'} hint="EDSS 조사년도 기준" />
          {s.current && <Stat label="현재 학생 · 교원" value={`${num(s.current.students)}명 · ${num(s.current.teachers)}명`} hint={`남 ${num(s.current.male)} · 여 ${num(s.current.female)} · 학교알리미 학교정보(2026)${s.current.founded ? ` · 개교 ${s.current.founded}` : ''}`} />}
        </div>

        {families.map((fam) => {
          const rows = bandsBy(fam);
          if (!rows.length) return null;
          return (
            <section key={fam} style={{ marginTop: 18 }}>
              <h4 style={S.h4}>{fam} 성취도 <span style={S.dim}>({rows[0].year})</span></h4>
              <BandTable rows={rows} />
            </section>
          );
        })}
        {others.length > 0 && (
          <section style={{ marginTop: 18 }}>
            <h4 style={S.h4}>기타 과목 <span style={S.dim}>({others[0].year})</span></h4>
            <BandTable rows={others.sort((x, y) => x.grade - y.grade || x.semester - y.semester)} />
          </section>
        )}
        {fullState === 'loading' && <p style={{ ...S.dim, marginTop: 14 }}>전 과목 성취도를 불러오는 중…</p>}
        {fullState === 'error' && <p style={{ ...S.dim, marginTop: 14 }}>전 과목 성취도를 불러오지 못했습니다. 국·영·수만 표시합니다.</p>}
        <p style={{ ...S.dim, marginTop: 14 }}>A~E = 성취도 비율(%). 평균·표준편차는 학교알리미 공시값. 3학년 진로선택 과목은 A·B·C 3단계만 공시됩니다.</p>
      </div>
    </div>
  );
}

function BandTable({ rows }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={S.table}>
        <thead>
          <tr>{['학년·학기', '과목', '평균', '표준편차', 'A', 'B', 'C', 'D', 'E', '분포'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((b, i) => (
            <tr key={i}>
              <td style={S.td}>{b.grade}학년 {b.semester}학기</td>
              <td style={S.td}>{b.subject}</td>
              <td style={S.tdNum}>{dec1(b.mean)}</td>
              <td style={S.tdNum}>{dec1(b.sd)}</td>
              {BAND_KEYS.map((k) => <td key={k} style={{ ...S.tdNum, color: k === 'a' ? 'var(--accent)' : undefined, fontWeight: k === 'a' ? 700 : 400 }}>{pct(b[k])}</td>)}
              <td style={{ ...S.td, minWidth: 140 }}><div style={{ ...S.bar, height: 8 }}>{BAND_KEYS.map((k) => (b[k] ? <div key={k} style={{ width: `${b[k]}%`, background: BAND_COLORS[k] }} /> : null))}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareModal({ schools, subject, grade, onClose }) {
  const isHigh = schools.every((s) => s.schoolLevel === '고등학교');
  const rowsSpec = [
    { label: '소재지', get: (s) => `${s.sido} ${s.sigungu}` },
    { label: '유형 · 성별 · 설립', get: (s) => [s.schoolType, s.gender, s.fond].filter(Boolean).join(' · ') },
    { label: '성취도 학년도', get: (s) => [...new Set((s.bands || []).map((b) => b.year).filter(Boolean))].join(', ') || '—' },
    { label: '전체 재적', get: (s) => (s.enrollment ? `${num(s.enrollment.total)}명` : '—') },
    { label: '1학년 재적', get: (s) => (s.enrollment?.grade1 != null ? `${s.enrollment.grade1}명` : '—') },
    ...(isHigh ? [{ label: '1등급권 자리', get: (s) => (seatsOf(s) === null ? '—' : `${seatsOf(s)}개`) }] : []),
    { label: '학급 · 교원', get: (s) => (s.edss ? `${s.edss.classes ?? '—'}학급 · ${s.edss.teachers ?? '—'}명` : '—') },
  ];
  const bandRows = [];
  for (const fam of SUBJECTS) {
    for (const g of [1, 2, 3]) {
      bandRows.push({ label: `${fam} ${g}학년 A비율`, get: (s) => pct(pickBand(s, fam, g)?.a ?? null), hi: fam === subject && g === grade });
      bandRows.push({ label: `${fam} ${g}학년 평균`, get: (s) => dec1(pickBand(s, fam, g)?.mean ?? null), hi: fam === subject && g === grade });
    }
  }
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 1100 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHead}>
          <h3 style={S.h3}>학교 비교 ({schools.length}곳)</h3>
          <button style={S.smallBtn} onClick={onClose}>닫기 ✕</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr><th style={S.th}></th>{schools.map((s) => <th key={s.id} style={{ ...S.th, fontSize: 14 }}>{s.schoolName}</th>)}</tr>
            </thead>
            <tbody>
              {[...rowsSpec, ...bandRows].map((r) => (
                <tr key={r.label} style={r.hi ? { background: 'var(--accent-bg)' } : undefined}>
                  <td style={{ ...S.td, color: 'var(--text2)', whiteSpace: 'nowrap' }}>{r.label}</td>
                  {schools.map((s) => <td key={s.id} style={S.tdNum}>{r.get(s)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{ ...S.dim, marginTop: 12 }}>강조 행 = 목록에서 고른 과목·학년. 같은 학년은 뒤 학기(2학기) 값을 우선합니다.</p>
      </div>
    </div>
  );
}

const S = {
  page: { padding: '28px 32px', maxWidth: 1400, margin: '0 auto' },
  headRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' },
  h2: { fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text)' },
  h3: { fontSize: 20, fontWeight: 800, margin: 0, color: 'var(--text)' },
  h4: { fontSize: 15, fontWeight: 700, margin: '0 0 8px', color: 'var(--text)' },
  lead: { fontSize: 13, color: 'var(--text2)', marginTop: 6 },
  err: { color: 'var(--red)', marginTop: 10 },
  levelTabs: { display: 'flex', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4 },
  tab: { background: 'transparent', border: 'none', color: 'var(--text2)', padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 14 },
  tabOn: { background: 'var(--accent-bg)', color: 'var(--accent)' },
  filters: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 },
  filterLabel: { fontSize: 12, color: 'var(--text3)', fontWeight: 700 },
  input: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13 },
  select: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13 },
  chip: { background: 'var(--surface)', color: 'var(--text2)', border: '1px solid var(--border)', borderRadius: 999, padding: '5px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 700 },
  chipOn: { background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' },
  count: { fontSize: 13, color: 'var(--text2)' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14, marginTop: 16 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: 'var(--shadow)' },
  cardHead: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' },
  name: { fontSize: 16, fontWeight: 800, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  sub: { fontSize: 12, color: 'var(--text2)', marginTop: 2 },
  badges: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  badge: { fontSize: 11, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-bg)', padding: '2px 8px', borderRadius: 999 },
  badgeDim: { fontSize: 11, color: 'var(--text2)', background: 'var(--surface2)', padding: '2px 8px', borderRadius: 999 },
  seats: { fontSize: 13, color: 'var(--text)' },
  dim: { fontSize: 12, color: 'var(--text3)' },
  bandTitle: { fontSize: 13, color: 'var(--text)', marginTop: 4 },
  bar: { display: 'flex', height: 10, borderRadius: 6, overflow: 'hidden', background: 'var(--surface2)' },
  barLegend: { display: 'flex', gap: 10, fontSize: 11, color: 'var(--text2)', marginTop: 5, flexWrap: 'wrap' },
  dot: { display: 'inline-block', width: 8, height: 8, borderRadius: 2, marginRight: 4, verticalAlign: 'middle' },
  cardFoot: { display: 'flex', justifyContent: 'flex-end', marginTop: 'auto' },
  linkBtn: { background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: 4 },
  smallBtn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 700 },
  smallBtnOn: { background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' },
  moreBtn: { background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 22px', cursor: 'pointer', fontWeight: 700 },
  primary: { background: 'var(--accent)', color: '#0b121b', border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 13 },
  tray: { position: 'sticky', bottom: 12, marginTop: 20, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: 'var(--navy-2)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', boxShadow: 'var(--shadow-md)' },
  trayChip: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 10px', fontSize: 12 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflowY: 'auto' },
  modal: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 960, boxShadow: 'var(--shadow-md)' },
  modalHead: { display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' },
  statGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 16 },
  stat: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px' },
  statLabel: { fontSize: 11, color: 'var(--text3)', fontWeight: 700 },
  statValue: { fontSize: 20, fontWeight: 800, color: 'var(--text)', marginTop: 2 },
  statHint: { fontSize: 11, color: 'var(--text2)', marginTop: 2 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text3)', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' },
  td: { padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text)' },
  tdNum: { padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text)', textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
};
