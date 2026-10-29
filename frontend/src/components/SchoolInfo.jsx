import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { CATALOG_URL, fetchGzJson } from '../schoolCatalog';
import DisclosureNotice from './DisclosureNotice';
import { explainSchools, ReportEditor, SavedReports, ExplainBox, findReviewed, reviewedAsReport, ReviewedOffer } from './SchoolReport';
import { menuAllowed, readMenus } from '../menus';
import { Term, LAYERS, layerOf, genderOk, DISTRICTS, districtOf, aDifficulty, aGradeSpan, grade1Type, enrollmentTrend } from '../schoolTerms';
import StudentFit from './StudentFit';
import { loadSeoulGuide, seoulGuideOf, loadExtra, loadLocations, distanceKm, careerSummary, gradLabel, SORT_GETTERS } from '../schoolExtra';
const SchoolMap = lazy(() => import('./SchoolMap')); // leaflet 은 지도를 열 때만
import { loadOfferings, offerStatus, MARK_COLOR, PICKABLE, TRACK_PRESETS } from '../course/offerings';

// A 난이도(A 비율의 전국 위치) — scripts/schoolinfo/build-weights.mjs 가 미리 계산한 파일. 없으면(옛 배포) 조용히 숨긴다.
const WEIGHTS_URL = CATALOG_URL.replace(/[^/]+$/, 'school-weights.json.gz');
let weightsP = null;
export function loadWeights() {
  if (!weightsP) weightsP = fetchGzJson(WEIGHTS_URL).catch(() => { weightsP = null; return null; });
  return weightsP;
}

// 전국 고교·중학 공시정보 — 학교알리미 교과별 학업성취(A~E 비율·평균) + 학년별 재적 + EDSS 학급·교원.
// 데이터는 /data/school-catalog.json.gz 하나(정적 파일). 서버·로그인 토큰이 필요 없어 백엔드를 건드리지 않는다.
// catalog 스키마는 bucheon-schoolinfo 와 같다 — 갱신은 scripts/schoolinfo/ 의 build_catalog.py 가 같은 형태로 만든다.

const SUBJECTS = ['국어', '영어', '수학'];
const BAND_KEYS = ['a', 'b', 'c', 'd', 'e'];
const BAND_COLORS = { a: '#2dd4bf', b: '#60a5fa', c: '#a78bfa', d: '#fbbf24', e: '#f87171' };
const PAGE = 60;
const MAX_COMPARE = 4;

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
const yearNum = (y) => parseInt(String(y || ''), 10) || 0;
function trackRank(subject) { return !/\[/.test(subject) ? 0 : /일반계/.test(subject) ? 1 : 2; }
function pickBand(school, subject, grade) {
  const list = (school.bands || []).filter((b) => b.family === subject && b.grade === grade && b.a !== null);
  if (!list.length) return null;
  // 학년도가 여럿 섞여 있다(1차 공시 = 전년도 1·2학기, 3차 공시 = 올해 1학기) → 가장 최근 학년도 먼저, 같은 해면 뒤 학기
  return list.sort((x, y) => yearNum(y.year) - yearNum(x.year) || trackRank(x.subject) - trackRank(y.subject) || (y.semester || 0) - (x.semester || 0))[0];
}
function seatsOf(s) {
  const g1 = s.enrollment?.grade1;
  return g1 ? Math.round(g1 * 0.1) : null;
}
function pct(v) { return v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}%`; }
function num(v) { return v === null || v === undefined ? '—' : Number(v).toLocaleString('ko-KR'); }
function dec1(v) { return v === null || v === undefined ? '—' : Number(v).toFixed(1); }

export default function SchoolInfo({ getActiveKey, selectedModel, aiGroup, onAuthError }) {
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
  const [layer, setLayer] = useState('전체');
  const [district, setDistrict] = useState('전체');   // 평준화 학군(학군표가 있는 시도만)           // 학교 층 — 뽑는 범위가 다른 학교끼리는 따로 본다
  const [weights, setWeights] = useState(null);         // { [id]: { 국어:{a,pct,mean}, … } }
  const [fitOpen, setFitOpen] = useState(false);
  const [offers, setOffers] = useState(null);           // 2026 나이스 시간표 개설 과목 { [id]: { g2, g3 } }
  const [want, setWant] = useState([]);                // 듣고 싶은 2·3학년 과목
  const [wantAll, setWantAll] = useState(false);       // 고른 과목이 모두 열리는(가능성 포함) 학교만
  const [showCompare, setShowCompare] = useState(false);
  // 입시 해설 보고서 — 생성 중 표시, 열려 있는 편집기, 보관함
  const [explaining, setExplaining] = useState('');
  const [report, setReport] = useState(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [savedKey, setSavedKey] = useState(0);
  const [explainErr, setExplainErr] = useState('');
  const [extraAreas, setExtraAreas] = useState(null); // 학교알리미 추가 항목의 지역 평균 — 학교에는 s.extra 로 붙인다
  const [locReady, setLocReady] = useState(false);     // 학교 위치 — 학교에는 s.loc = [위도, 경도]
  const [originQ, setOriginQ] = useState('');          // 출발 중학교(통학 거리 기준)
  const [radius, setRadius] = useState('all');
  const [mapOpen, setMapOpen] = useState(false);
  const [offer, setOffer] = useState(null); // 검토된 대표본 안내 { item, kind, list, focus }
  const hasKey = !!getActiveKey?.();

  useEffect(() => {
    let dead = false;
    loadCatalog().then((c) => { if (!dead) setCat(c); }).catch((e) => { if (!dead) setErr(e.message || '데이터 로드 실패'); });
    loadWeights().then((w) => { if (!dead && w) setWeights(w.schools); });
    loadOfferings().then((o) => { if (!dead && o) setOffers(o.schools); });
    return () => { dead = true; };
  }, []);
  // 졸업생 진로·교육 여건 — catalog 가 뜬 뒤 학교 객체에 extra 를 붙인다(비교·AI 해설에도 그대로 실린다)
  useEffect(() => {
    if (!cat) return undefined;
    let dead = false;
    loadExtra().then((ex) => {
      if (dead || !ex) return;
      for (const s of cat.schools) s.extra = (s.shlIdfCd && ex.schools[s.shlIdfCd]) || null;
      setExtraAreas(ex.areas || {});
    });
    loadLocations().then((lc) => {
      if (dead || !lc) return;
      for (const s of cat.schools) s.loc = (s.shlIdfCd && lc.schools[s.shlIdfCd]) || null;
      setLocReady(true);
    });
    return () => { dead = true; };
  }, [cat]);
  // 출발 중학교 — '학교명 (시군구)' 로 고른다. 거리는 직선거리(실제 통학은 더 길다)
  const middles = useMemo(() => (locReady ? (cat?.schools || []).filter((s) => s.schoolLevel === '중학교' && s.loc && (sido === '전체' || s.sido === sido)) : []), [cat, locReady, sido]);
  const middleLabel = (s) => `${s.schoolName} (${s.sido} ${s.sigungu})`;
  const origin = useMemo(() => middles.find((s) => middleLabel(s) === originQ) || null, [middles, originQ]);

  const schools = useMemo(() => (cat?.schools || []).filter((s) => s.schoolLevel === level), [cat, level]);
  const sidos = useMemo(() => [...new Set(schools.map((s) => s.sido))].sort(), [schools]);
  const sigungus = useMemo(
    () => (sido === '전체' ? [] : [...new Set(schools.filter((s) => s.sido === sido).map((s) => s.sigungu))].sort()),
    [schools, sido],
  );
  const types = useMemo(() => [...new Set(schools.map((s) => s.schoolType))].sort(), [schools]);
  const fonds = useMemo(() => [...new Set(schools.map((s) => s.fond).filter(Boolean))].sort(), [schools]);

  useEffect(() => { setSigungu('전체'); setDistrict('전체'); }, [sido]);
  useEffect(() => { setLimit(PAGE); }, [level, q, sido, sigungu, type, fond, gender, sort, subject, grade, layer, district]);
  useEffect(() => { setType('전체'); }, [level]);

  const filtered = useMemo(() => {
    const kw = q.trim().replace(/\s+/g, '');
    for (const s of schools) s.dist = origin ? distanceKm(origin.loc, s.loc) : null;
    const maxKm = origin && radius !== 'all' ? Number(radius) : null;
    let list = schools.filter((s) =>
      (maxKm === null || (s.dist !== null && s.dist <= maxKm)) &&
      (sido === '전체' || s.sido === sido) &&
      (sigungu === '전체' || s.sigungu === sigungu) &&
      (district === '전체' || (district === '비평준화' ? !districtOf(s) : districtOf(s)?.name === district)) &&
      (type === '전체' || s.schoolType === type) &&
      (fond === '전체' || s.fond === fond) &&
      (gender === '전체' || (gender === '남학생' || gender === '여학생' ? genderOk(s, gender) : s.gender === gender)) &&
      (level !== '고등학교' || layer === '전체' || layerOf(s) === layer) &&
      (!wantAll || !want.length || want.every((w) => ['yes', 'maybe'].includes(offerStatus(offers?.[s.id], w).mark))) &&
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
      'weight-asc': cmpNum((s) => weights?.[s.id]?.[subject]?.pct ?? null, false),
      ...Object.fromEntries(Object.entries(SORT_GETTERS).map(([k, get]) => [k, cmpNum((s) => get(s.extra), k.endsWith('-desc'))])),
      'near-asc': cmpNum((s) => s.dist, false),
    };
    list = [...list].sort(sorters[sort] || sorters.name);
    return list;
  }, [schools, q, sido, sigungu, type, fond, gender, sort, subject, grade, layer, weights, district, want, wantAll, offers, extraAreas, origin, radius]);

  const detail = detailId ? schools.find((s) => s.id === detailId) || (cat?.schools || []).find((s) => s.id === detailId) : null;
  const compareSchools = compare.map((id) => (cat?.schools || []).find((s) => s.id === id)).filter(Boolean);
  const toggleCompare = (id) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_COMPARE ? c : [...c, id]));

  // 학교 1곳(kind school) 또는 비교함(kind compare) → 전 과목 표를 채워 AI 해설을 받는다
  const startExplain = async (kind, list, focus, { skipReviewed = false } = {}) => {
    setExplainErr('');
    // 같은 학교(묶음)에 원장이 검토한 대표본이 있으면 먼저 보여 준다 — 1~2분 기다림·AI 사용량을 아낀다
    if (!skipReviewed) {
      setExplaining('검토된 해설 확인 중…');
      const item = await findReviewed(list);
      setExplaining('');
      if (item) { setOffer({ item, kind, list, focus }); return; }
    }
    setExplaining(kind === 'compare' ? `비교 해설 생성 중… (${list.length}곳, 1~2분)` : '해설 생성 중… (1~2분)');
    try {
      const full = await Promise.all(list.map(async (s) => ({ ...s, bands: (await loadFullBands(s).catch(() => null)) || s.bands || [] })));
      const r = await explainSchools({ kind, schools: full, focus, apiKey: getActiveKey?.(), aiGroup, selectedModel });
      setReport(r);
    } catch (e) {
      if (e.auth) onAuthError?.();
      setExplainErr(e.message || '해설 생성 실패');
    } finally { setExplaining(''); }
  };

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* 보관함(서버 저장)은 관리자가 코드마다 열어 준 경우만 — 용량 때문에 기본 잠금(2026-09-21) */}
          {menuAllowed(readMenus(), localStorage.getItem('ef_role'), 'schoolreports') && (
            <button style={S.smallBtn} onClick={() => setSavedOpen(true)}>📚 해설 보고서 보관함</button>
          )}
          <div style={S.levelTabs}>
            {['고등학교', '중학교'].map((l) => (
              <button key={l} style={{ ...S.tab, ...(level === l ? S.tabOn : {}) }} onClick={() => setLevel(l)}>{l}</button>
            ))}
          </div>
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
        {isHigh && DISTRICTS[sido] && (
          <select style={S.select} value={district} onChange={(e) => { setDistrict(e.target.value); setSigungu('전체'); }} title={DISTRICTS[sido].source}>
            <option value="전체">평준화 학군 전체</option>
            {DISTRICTS[sido].list.map((d) => <option key={d.name} value={d.name}>{d.name} 학군 ({d.sigungu.join('·')})</option>)}
            {!DISTRICTS[sido].allLevelled && <option value="비평준화">비평준화 지역</option>}
          </select>
        )}
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
          <option value="남학생">남학생 지원 가능 (여고 제외)</option>
          <option value="여학생">여학생 지원 가능 (남고 제외)</option>
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
          {isHigh && weights && <option value="weight-asc">A 난이도 높은 순 (A 받기 어려운 학교부터)</option>}
          {extraAreas && isHigh && <option value="univ-desc">4년제 진학률 높은순 (최근 졸업)</option>}
          {extraAreas && isHigh && <option value="univ3-desc">4년제 진학률 높은순 (3년 평균)</option>}
          {extraAreas && isHigh && <option value="etc-desc">&apos;기타&apos;(재수 등) 비율 높은순</option>}
          {extraAreas && !isHigh && <option value="select-desc">과학·외고·국제·예체·자사고 진학 많은순</option>}
          {extraAreas && <option value="perclass-asc">학급당 학생 수 적은순</option>}
          {extraAreas && <option value="perteacher-asc">교원 1인당 학생 수 적은순</option>}
          {origin && <option value="near-asc">출발 중학교에서 가까운순</option>}
        </select>
      </div>
      {isHigh && DISTRICTS[sido]?.note && <div style={{ ...S.dim, margin: '-4px 0 8px' }}>🧭 {DISTRICTS[sido].note}</div>}
      {isHigh && (
        <div style={S.filters}>
          <span style={S.filterLabel}><Term k="학교 층" /></span>
          {['전체', ...LAYERS.map((l) => l.key)].map((k) => {
            const L = LAYERS.find((l) => l.key === k);
            return <button key={k} title={L?.hint || ''} style={{ ...S.chip, ...(layer === k ? S.chipOn : {}) }} onClick={() => setLayer(k)}>{L ? L.label : '전체'}</button>;
          })}
          <span style={{ ...S.dim, marginLeft: 6 }}>뽑는 범위가 다른 학교끼리는 학생 집단이 달라 따로 보세요.</span>
        </div>
      )}
      {isHigh && locReady && (
        <div style={S.filters}>
          <span style={S.filterLabel}>📍 출발 중학교</span>
          <input list="ef-middles" style={{ ...S.input, minWidth: 260 }} placeholder={sido === '전체' ? '시도를 먼저 고르면 찾기 쉬워요 (예: 부천중)' : '중학교 이름 (예: 부천중)'} value={originQ}
            onChange={(e) => { setOriginQ(e.target.value); if (middles.some((s) => middleLabel(s) === e.target.value)) setSort('near-asc'); }} />
          <datalist id="ef-middles">{middles.map((s) => <option key={s.id} value={middleLabel(s)} />)}</datalist>
          {origin && <>
            <select style={S.select} value={radius} onChange={(e) => setRadius(e.target.value)}>
              <option value="all">거리 제한 없음</option>
              {[3, 5, 7, 10, 15, 20].map((k) => <option key={k} value={k}>직선 {k}km 이내</option>)}
            </select>
            <button style={S.linkBtn} onClick={() => { setOriginQ(''); setRadius('all'); if (sort === 'near-asc') setSort('name'); }}>지우기</button>
          </>}
          <button style={S.smallBtn} onClick={() => setMapOpen(true)}>🗺 지도로 보기</button>
          <span style={{ ...S.dim, flexBasis: '100%' }}>거리는 학교 사이 직선거리입니다(공공데이터포털 학교 위치). 실제 통학 시간은 길·교통에 따라 더 걸려요. 평준화 지역은 거리보다 배정 방식이 먼저입니다.</span>
        </div>
      )}
      {isHigh && offers && (
        <div style={S.filters}>
          <span style={S.filterLabel}>듣고 싶은 2·3학년 과목</span>
          {TRACK_PRESETS.map((t) => <button key={t.label} title={`${t.label} 계열에서 자주 보는 과목: ${t.courses.join(', ')}`} style={S.linkBtn} onClick={() => setWant(t.courses)}>{t.label}</button>)}
          <span style={{ flexBasis: '100%', height: 0 }} />
          {PICKABLE.map((w) => <button key={w} style={{ ...S.chip, ...(want.includes(w) ? S.chipOn : {}) }} onClick={() => setWant((cur) => (cur.includes(w) ? cur.filter((x) => x !== w) : [...cur, w]))}>{w}</button>)}
          {want.length > 0 && <>
            <label style={{ ...S.dim, display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6 }}><input type="checkbox" checked={wantAll} onChange={(e) => setWantAll(e.target.checked)} /> 모두 열리는(가능성 포함) 학교만</label>
            <button style={S.linkBtn} onClick={() => { setWant([]); setWantAll(false); }}>지우기</button>
          </>}
          <span style={{ ...S.dim, flexBasis: '100%' }}>2026 나이스 시간표로 확인: ✓ 실제 수업 중 · △ 3학년 가능성(2026 3학년은 아직 2015 교육과정이라 같은 계열 옛 과목이 있으면) · ✗ 2026 시간표엔 없음. 수강 신청에 따라 달라질 수 있어요.</span>
        </div>
      )}
      <div style={S.filters}>
        <span style={S.filterLabel}>성취도 과목</span>
        {SUBJECTS.map((s) => <button key={s} style={{ ...S.chip, ...(subject === s ? S.chipOn : {}) }} onClick={() => setSubject(s)}>{s}</button>)}
        <span style={{ ...S.filterLabel, marginLeft: 12 }}>학년</span>
        {[1, 2, 3].map((g) => <button key={g} style={{ ...S.chip, ...(grade === g ? S.chipOn : {}) }} onClick={() => setGrade(g)}>{g}학년</button>)}
        <span style={{ flex: 1 }} />
        {isHigh && weights && <button style={S.smallBtn} onClick={() => setFitOpen(true)} title="학생 석차 백분위로 학교별 A 가능·경계·B 이하 어림">🎯 지망 판단 보조</button>}
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
                  <div style={S.sub}>{s.sido} {s.sigungu} · {s.schoolType}{isHigh && districtOf(s) && layerOf(s) === 'local' ? ` · ${districtOf(s).name} 학군` : ''}</div>
                </div>
                <button style={{ ...S.smallBtn, ...(inCmp ? S.smallBtnOn : {}) }} onClick={() => toggleCompare(s.id)} title={inCmp ? '비교함에서 빼기' : '비교함에 담기'}>
                  {inCmp ? '담김' : '+ 비교'}
                </button>
              </div>
              <div style={S.badges}>
                {s.dist != null && <span style={{ ...S.badge, background: '#fbbf24', color: '#111827' }} title={`${origin?.schoolName || '출발 중학교'}에서 직선거리`}>📍 {s.dist.toFixed(1)}km</span>}
                {s.gender && <span style={S.badge}>{s.gender}</span>}
                {s.fond && <span style={S.badge}>{s.fond}</span>}
                {s.enrollment?.grade1 != null && <span style={S.badgeDim}>재적 {s.enrollment.grade1}·{s.enrollment.grade2 ?? '—'}·{s.enrollment.grade3 ?? '—'} (1·2·3학년, 2025 공시)</span>}
                {isHigh && (() => { const t = enrollmentTrend(s.enrollment); return t && t.label !== '신입생 유지' ? <span style={{ ...S.badgeDim, color: t.color }} title="1학년 재적 vs 3학년 재적">{t.label} {t.pct}</span> : null; })()}
                {s.enrollment?.grade1 == null && s.current?.students != null && <span style={S.badgeDim}>학생 {s.current.students}명 · 교원 {s.current.teachers ?? '—'}명 (2026 학교정보)</span>}
              </div>
              {isHigh && seats !== null && (
                <div style={S.seats}>1학년 {s.enrollment.grade1}명 중 <Term k="1등급 자리">1등급권</Term> <b>{seats}자리</b> <span style={S.dim}>· 5등급제 상위 10% 가정</span></div>
              )}
              {s.edss && (s.edss.classes !== null || s.edss.teachers !== null) && (
                <div style={S.dim}>{s.edss.classes !== null ? `${s.edss.classes}학급` : ''}{s.edss.classes !== null && (s.current?.teachers ?? s.edss.teachers) !== null ? ' · ' : ''}{(s.current?.teachers ?? s.edss.teachers) != null ? `교원 ${s.current?.teachers ?? s.edss.teachers}명` : ''}</div>
              )}
              {s.extra && <CareerLine s={s} />}
              <div style={S.bandTitle}>
                {b ? <>{isHigh ? '고' : '중'}{grade} {b.subject} · {b.year} {b.semester}학기 · A <b>{pct(b.a)}</b> · 평균 <b>{dec1(b.mean)}</b></> : <span style={S.dim}>{grade}학년 {subject} 성취도 공시 없음</span>}
              </div>
              {b && <BandBar band={b} />}
              {isHigh && grade === 1 && weights?.[s.id]?.[subject] && (
                <div style={S.weight}>
                  {(() => { const d = aDifficulty(weights[s.id][subject].pct); return <><Term k="A 난이도" /> · 1학년 {subject} A {weights[s.id][subject].a}% → <b style={{ color: d.color }}>{d.label}</b> <span style={S.dim}>({d.text})</span>{aGradeSpan(weights[s.id][subject].a) && <> · <Term k="A면 몇 등급">A면 {aGradeSpan(weights[s.id][subject].a).span}</Term></>}</>; })()}
                </div>
              )}
              {want.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {want.map((w) => { const st = offerStatus(offers?.[s.id], w); return <span key={w} title={st.text} style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: MARK_COLOR[st.mark], borderRadius: 999, padding: '1px 8px' }}>{st.mark === 'yes' ? '✓' : st.mark === 'maybe' ? '△' : st.mark === 'no' ? '✗' : '?'} {w}</span>; })}
                </div>
              )}
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

      {mapOpen && <Suspense fallback={null}><SchoolMap schools={filtered} origin={origin} onClose={() => setMapOpen(false)} onOpen={(id) => { setMapOpen(false); setDetailId(id); }} /></Suspense>}
      {fitOpen && <StudentFit schools={filtered} weights={weights} onClose={() => setFitOpen(false)} />}
      {detail && <DetailModal areas={extraAreas} school={detail} weights={weights?.[detail.id]} offer={offers ? offers[detail.id] || 'none' : null} onClose={() => setDetailId(null)} inCompare={compare.includes(detail.id)} onToggleCompare={() => toggleCompare(detail.id)}
        explain={{ busy: explaining, err: explainErr, hasKey, run: (focus) => startExplain('school', [detail], focus) }} />}
      {showCompare && compareSchools.length >= 2 && <CompareModal schools={compareSchools} subject={subject} grade={grade} onClose={() => setShowCompare(false)}
        explain={{ busy: explaining, err: explainErr, hasKey, run: (focus) => startExplain('compare', compareSchools, focus) }} />}
      {report && <ReportEditor report={report} onClose={() => setReport(null)} onAuthError={onAuthError}
        onSaved={() => setSavedKey((k) => k + 1)} onDeleted={() => setSavedKey((k) => k + 1)} />}
      {offer && <ReviewedOffer item={offer.item} focus={offer.focus} onClose={() => setOffer(null)}
        onUse={() => { setReport(reviewedAsReport(offer.item)); setOffer(null); }}
        onNew={() => { const o = offer; setOffer(null); startExplain(o.kind, o.list, o.focus, { skipReviewed: true }); }} />}
      {savedOpen && <SavedReports refreshKey={savedKey} onAuthError={onAuthError} onClose={() => setSavedOpen(false)} onOpen={(r) => { setReport(r); setSavedOpen(false); }} />}
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

function DetailModal({ areas, school: s, weights: w, offer: of, onClose, inCompare, onToggleCompare, explain }) {
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
  // 최근 학년도부터(3차 2026학년도 1학기 → 1차 2025학년도 1·2학기), 그 안에서 학년·학기 순
  const bandsBy = (fam) => bands.filter((b) => b.family === fam).sort((x, y) => yearNum(y.year) - yearNum(x.year) || x.grade - y.grade || x.semester - y.semester);
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
          {/* 학년별 재적은 학교알리미 공개용데이터(2025년 공시) — 학교정보 팝업(2026)의 현재 학생수와 한 해 차이가 난다. 어느 해 숫자인지 적는다. */}
          <Stat label="학년별 재적 (2025 공시)" value={s.enrollment?.grade1 != null ? `${num(s.enrollment.total)}명` : '—'} hint={s.enrollment?.grade1 != null ? `${s.enrollment.grade1 ?? '—'}·${s.enrollment.grade2 ?? '—'}·${s.enrollment.grade3 ?? '—'} (1·2·3학년)${s.current?.students != null && s.current.students !== s.enrollment.total ? ` · 2026 현재 ${num(s.current.students)}명` : ''}` : '학년별 재적 공시 없음'} />
          {isHigh && enrollmentTrend(s.enrollment) && <Stat label="신입생 추세" value={`${enrollmentTrend(s.enrollment).label.replace('신입생 ', '')} ${enrollmentTrend(s.enrollment).pct}`} hint="1학년 재적 vs 3학년 재적 (±5% 기준) — 줄면 1등급 자리도 줄어요" />}
          {isHigh && <Stat label="1등급권 자리" value={seats === null ? '—' : `${seats}개`} hint="2025 공시 1학년 인원 × 10% (2022 교육과정 5등급제, 반올림)" />}
          <Stat label="학급 수" value={s.edss?.classes != null ? `${s.edss.classes}학급` : '—'} hint={s.edss ? `${s.edss.classGrade1 ?? '—'}·${s.edss.classGrade2 ?? '—'}·${s.edss.classGrade3 ?? '—'} (1·2·3학년) · EDSS 2025` : 'EDSS 미매칭'} />
          {/* 교원 수: 학교알리미 학교정보(2026)가 최신. EDSS(2025 조사)는 한 해 전 값이라 힌트로만 — 가곡고 7명(EDSS) vs 8명(학교알리미) 같은 차이가 그것이다. */}
          <Stat label="교원 수" value={s.current?.teachers != null ? `${num(s.current.teachers)}명` : s.edss?.teachers != null ? `${s.edss.teachers}명` : '—'}
            hint={s.current?.teachers != null ? `학교알리미 학교정보(2026)${s.edss?.teachers != null ? ` · EDSS 2025: ${s.edss.teachers}명${s.edss.staff != null ? `·직원 ${s.edss.staff}명` : ''}` : ''}` : s.edss ? `EDSS 2025${s.edss.staff != null ? ` · 직원 ${s.edss.staff}명` : ''}` : 'EDSS 미매칭'} />
          <Stat label="입학생 / 졸업생" value={s.edss ? `${s.edss.entrants ?? '—'} / ${s.edss.graduates ?? '—'}` : '—'} hint="EDSS 조사년도 기준" />
          {s.current && <Stat label="현재 학생 · 교원" value={`${num(s.current.students)}명 · ${num(s.current.teachers)}명`} hint={`남 ${num(s.current.male)} · 여 ${num(s.current.female)} · 학교알리미 학교정보(2026)${s.current.founded ? ` · 개교 ${s.current.founded}` : ''}`} />}
        </div>

        {isHigh && w && (
          <section style={{ marginTop: 16 }}>
            <h4 style={S.h4}><Term k="A 난이도" /> <span style={S.dim}>· 1학년 핵심 과목에서 A 받기가 전국 일반고 중 얼마나 어려운지 ({w.year} 최신 공시, 공시된 학기 평균)</span></h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['국어', '수학', '영어', '통합사회', '통합과학'].filter((k) => w[k]).map((k) => (
                <div key={k} style={S.weightBox}>
                  <div style={S.statLabel}>{k}</div>
                  <div style={S.statValue}>A {w[k].a}%</div>
                  <div style={{ ...S.statHint, color: aDifficulty(w[k].pct).color, fontWeight: 700 }}>{aDifficulty(w[k].pct).label}</div>
                  <div style={S.statHint}>{aDifficulty(w[k].pct).text} · 평균 {w[k].mean}</div>
                  {aGradeSpan(w[k].a) && <div style={{ ...S.statHint, color: 'var(--text)' }}>{aGradeSpan(w[k].a).text}</div>}
                </div>
              ))}
            </div>
            {(() => {
              const as = ['국어', '수학', '영어'].map((k) => w[k]?.a).filter((v) => typeof v === 'number');
              const t = as.length ? grade1Type(as.reduce((x, y) => x + y, 0) / as.length) : null;
              return t ? <div style={{ fontSize: 12.5, color: 'var(--text)', margin: '6px 0' }}><Term k="1등급 문턱" /> · 국·수·영 A 평균 {(as.reduce((x, y) => x + y, 0) / as.length).toFixed(1)}% → <b style={{ color: t.color }}>{t.label}</b> <span style={S.dim}>· <Term k="A면 몇 등급" /></span></div> : null;
            })()}
            <div style={S.dim}>A 난이도가 높을수록 A가 드문 학교입니다 — 받기는 어렵지만 받으면 대학이 무겁게 읽습니다. 평균과 A 비율은 따로 움직일 때가 많아 함께 봅니다.</div>
          </section>
        )}

        {s.extra && <ExtraSection s={s} areas={areas} />}
        {isHigh && s.sido === '서울특별시' && <SeoulGuideSection s={s} />}

        {isHigh && of && (
          <section style={{ marginTop: 16 }}>
            <h4 style={S.h4}>2026 실제 수업 과목 <span style={S.dim}>· 나이스 시간표(1·2학기 각 2주) — 2학년은 2022 개정, 3학년은 2015 개정 과목명</span></h4>
            {of === 'none' ? <div style={S.dim}>나이스 시간표에서 이 학교를 찾지 못했습니다.</div> : <>
              <div style={{ fontSize: 12.5, color: 'var(--text)', margin: '4px 0' }}><b>2학년</b> ({of.g2.length}) {of.g2.join(' · ') || '—'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text)', margin: '4px 0' }}><b>3학년</b> ({of.g3.length}) {of.g3.join(' · ') || '—'}</div>
              <div style={S.dim}>시간표에 잡힌 과목만 모았습니다. 학교 편제표에 있어도 수강 신청이 적어 열리지 않은 과목은 빠질 수 있어요.</div>
            </>}
          </section>
        )}

        {families.map((fam) => {
          const rows = bandsBy(fam);
          if (!rows.length) return null;
          return (
            <section key={fam} style={{ marginTop: 18 }}>
              <h4 style={S.h4}>{fam} 성취도 <span style={S.dim}>({[...new Set(rows.map((r) => r.year))].sort().reverse().join(' · ')})</span></h4>
              <BandTable rows={rows} />
            </section>
          );
        })}
        {others.length > 0 && (
          <section style={{ marginTop: 18 }}>
            <h4 style={S.h4}>기타 과목 <span style={S.dim}>({[...new Set(others.map((r) => r.year))].sort().reverse().join(' · ')})</span></h4>
            <BandTable rows={others.sort((x, y) => yearNum(y.year) - yearNum(x.year) || x.grade - y.grade || x.semester - y.semester)} />
          </section>
        )}
        {explain && (
          <>
            <ExplainBox label={`${s.schoolName} 입시·진학 해설`} busy={explain.busy} hasKey={explain.hasKey} onExplain={explain.run} />
            {explain.err && <p style={{ ...S.dim, color: '#f87171', marginTop: 6 }}>{explain.err}</p>}
          </>
        )}
        {fullState === 'loading' && <p style={{ ...S.dim, marginTop: 14 }}>전 과목 성취도를 불러오는 중…</p>}
        {fullState === 'error' && <p style={{ ...S.dim, marginTop: 14 }}>전 과목 성취도를 불러오지 못했습니다. 국·영·수만 표시합니다.</p>}
        <p style={{ ...S.dim, marginTop: 14 }}>A~E = 성취도 비율(%). 평균·표준편차는 학교알리미 공시값. 3학년 진로선택 과목은 A·B·C 3단계만 공시됩니다.</p>
      </div>
    </div>
  );
}

// 목록 카드 한 줄 — 고교: 최근 졸업생 4년제·'기타'(재수 등), 특성화고: 취업률, 중학교: 특목·자사고 진학
function CareerLine({ s }) {
  const high = s.schoolLevel === '고등학교';
  const c = careerSummary(s.extra, s.schoolLevel);
  const st = s.extra?.status;
  const parts = [];
  if (c && high && c.voc) parts.push(<span key="v">취업률 <b>{pct(c.last.jobRate)}</b> · 진학 {pct((c.last.univ || 0) + (c.last.college || 0))}</span>);
  else if (c && high) parts.push(<span key="u"><Term k="4년제 진학률">4년제</Term> <b>{pct(c.last.univ)}</b> · 전문대 {pct(c.last.college)} · <Term k="기타(재수 등)">기타</Term> {pct(c.last.etc)}</span>);
  else if (c) parts.push(<span key="m"><Term k="특목·자사고 진학">특목·자사고</Term> <b>{pct(c.select)}</b> · 일반고 {pct(c.last.general)}</span>);
  if (st?.perClass != null) parts.push(<span key="p">학급당 {st.perClass}명</span>);
  if (!parts.length) return null;
  return <div style={{ fontSize: 12, color: 'var(--text2)' }}>🎓 {parts.reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}{c ? <span style={S.dim}> ({gradLabel(c.last.y)})</span> : null}</div>;
}

// 상세 — 졸업생 진로(3개년) + 교육 여건(지역 평균과 나란히)
// 서울 고입 안내 — 학교 유형·선발 방식(자사·특목은 자세히)·생활권·배정 방식·유형별 진학 경로
function SeoulGuideSection({ s }) {
  const [g, setG] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { loadSeoulGuide().then(setG); }, []);
  const hit = seoulGuideOf(g, s);
  if (!hit) return null;
  const { school: sc, area } = hit;
  const general = !sc || sc.type === '일반고';
  const path = g.paths?.byType?.find((p) => sc && (p.type === sc.type || p.type.includes(sc.type)));
  // 2027 고입 원서 일정(유형별 전기·후기) — 자료의 selection 표
  const sel = sc && g.selection?.rows?.find((r) => r[0] === sc.type || r[0].includes(sc.type));
  return (
    <section style={{ marginTop: 16 }}>
      <h4 style={S.h4}>🧭 서울 고입 안내 <span style={S.dim}>· 고1 입시스타터팩(유니브) 정리</span></h4>
      {sc && (
        <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6 }}>
          <b>{sc.type}</b>{area ? ` · ${area.name}` : ''}{sc.district ? ` · ${sc.district}` : ''}
          {(sc.tags || []).map((t) => <span key={t} style={{ display: 'inline-block', fontSize: 11, border: '1px solid var(--border)', borderRadius: 999, padding: '1px 7px', marginLeft: 5, color: 'var(--text2)' }}>{t}</span>)}
        </div>
      )}
      {sc?.rows?.length > 0 && (
        <table style={S.table}><tbody>{sc.rows.map(([k, v], i) => <tr key={i}><td style={{ ...S.td, fontWeight: 700, whiteSpace: 'nowrap', width: 120 }}>{k}</td><td style={S.td}>{v}</td></tr>)}</tbody></table>
      )}
      {sel && <div style={{ fontSize: 12.5, color: 'var(--text)', margin: '6px 0' }}>📅 {sel[0]} {sel.slice(1).filter((v) => v && v !== '-').join(' · ')} <span style={S.dim}>({g.selection.title})</span></div>}
      {sc?.note && <div style={{ fontSize: 12.5, color: 'var(--text2)', margin: '6px 0', lineHeight: 1.6 }}>{sc.note}</div>}
      {path?.points?.length > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--text)', margin: '8px 0', lineHeight: 1.6 }}>
          <b>{path.type}에서 서울권 대학 가는 길</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{path.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </div>
      )}
      {(general || area) && (
        <button style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: 'var(--text)', cursor: 'pointer', marginTop: 4 }} onClick={() => setOpen(!open)}>
          {open ? '접기' : `${general ? '일반고 1·2·3단계 배정 방식' : ''}${general && area ? ' · ' : ''}${area ? `${area.name} 한눈에 보기` : ''}`}
        </button>
      )}
      {open && (
        <div style={{ marginTop: 8 }}>
          {general && g.assignment && (
            <>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)' }}>{g.assignment.title}</div>
              <table style={S.table}><tbody>{(g.assignment.rows || []).map(([k, v], i) => <tr key={i}><td style={{ ...S.td, fontWeight: 700, width: 70 }}>{k}</td><td style={S.td}>{v}</td></tr>)}</tbody></table>
              <ul style={{ fontSize: 12, color: 'var(--text2)', paddingLeft: 18, lineHeight: 1.6 }}>{[...(g.assignment.notes || []), ...(g.assignment.special || [])].map((n, i) => <li key={i}>{n}</li>)}</ul>
            </>
          )}
          {area && (
            <>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text)', marginTop: 6 }}>{area.name} ({(area.gus || []).join('·')})</div>
              {area.summary && <div style={{ fontSize: 12.5, color: 'var(--text2)', margin: '4px 0', lineHeight: 1.6 }}>{area.summary}</div>}
              {area.rows?.length > 0 && <table style={S.table}><tbody>{area.rows.map(([k, v], i) => <tr key={i}><td style={{ ...S.td, fontWeight: 700, width: 170 }}>{k}</td><td style={S.td}>{v}</td></tr>)}</tbody></table>}
            </>
          )}
        </div>
      )}
      <div style={S.dim}>출처: {(g.sources || []).map((x) => x.title).join(' · ')}. 배정 비율은 학교별 정원 중 그 단계 몫이지 배정 확률이 아닙니다.</div>
    </section>
  );
}

function ExtraSection({ s, areas }) {
  const x = s.extra;
  const high = s.schoolLevel === '고등학교';
  const c = careerSummary(x, s.schoolLevel);
  const area = (i) => { const name = x.area?.[i]; return name ? { name, ...(areas?.[`${s.schoolLevel}|${name}`] || {}) } : null; };
  const A = [area(0), area(1), area(2)].filter(Boolean);
  const cmp = (key, fmt = (v) => v) => A.map((a) => `${a.name} ${a[key] != null ? fmt(a[key]) : '—'}`).join(' · ');
  const pcAvg = (a) => (Array.isArray(a) ? (a.reduce((p, q) => p + (q || 0), 0) / a.length).toFixed(1) : a);
  const st = x.status, mv = x.moves, sf = x.staff, cl = x.clubs;
  const highCols = ['univ', 'college', 'abroad', 'job', ...(c?.voc ? ['jobRate'] : []), 'etc'];
  const midCols = ['general', 'vocational', 'science', 'foreign', 'arts', 'meister', 'jasa', 'jagong', 'other'];
  return (
    <>
      {c && (
        <section style={{ marginTop: 16 }}>
          <h4 style={S.h4}>🎓 졸업생 진로 <span style={S.dim}>· 학교알리미 {c.voc ? '13-라(특성화·마이스터 취업 등 진로)' : '13-다 졸업생의 진로 현황'} · 최근 {c.years}개년</span></h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead><tr>{(high
                ? ['졸업', '졸업자', '4년제', '전문대', '국외', '취업', ...(c.voc ? ['취업률'] : []), '기타(재수 등)']
                : ['졸업', '졸업자', '일반고', '특성화고', '과학고', '외고·국제고', '예고·체고', '마이스터고', '자사고', '자공고', '기타']).map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>
                {x.career.map((r) => (
                  <tr key={r.y}>
                    <td style={S.td}>{gradLabel(r.y)}</td>
                    <td style={S.tdNum}>{r.grad}명</td>
                    {(high ? highCols : midCols).map((k) => <td key={k} style={{ ...S.tdNum, ...(k === 'univ' || k === 'jobRate' ? { color: 'var(--accent)', fontWeight: 700 } : {}) }}>{pct(r[k])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={S.dim}>
            {high
              ? <>3년 평균 4년제 {pct(c.univ3)} · 전문대 {pct(c.college3)} · 기타 {pct(c.etc3)}{c.univTrend != null ? ` · 4년제 ${c.univTrend >= 0 ? '+' : ''}${c.univTrend}%p (${c.years}년 사이)` : ''}. <Term k="기타(재수 등)" />는 재수·군입대·미상 등 진학·취업이 아닌 졸업생입니다. 등록 기준이라 합격 실적과는 다릅니다.</>
              : <>과학고·외고·국제고·예고·체고·자사고 진학 합계 {pct(c.select)} (3년 평균 {pct(c.select3)}).</>}
          </div>
        </section>
      )}
      {(st || mv || sf || cl) && (
        <section style={{ marginTop: 16 }}>
          <h4 style={S.h4}>🏫 교육 여건 <span style={S.dim}>· 학교알리미 2026년 5월 공시 · 괄호 = 지역 평균</span></h4>
          <div style={S.statGrid}>
            {st?.perClass != null && <Stat label="학급당 학생 수" value={`${st.perClass}명`} hint={`${st.perClassGrade ? `1·2·3학년 ${st.perClassGrade.join('·')}` : ''}${A.length ? ` (${cmp('perClass', pcAvg)})` : ''}`} />}
            {st?.perTeacher != null && <Stat label={<Term k="수업교원 1인당 학생 수" />} value={`${st.perTeacher}명`} hint={`수업교원 ${st.classTeachers ?? '—'}명 · 학생 ${st.students ?? '—'}명${A.length ? ` (${cmp('perTeacher')})` : ''}`} />}
            {sf && <Stat label={<Term k="기간제 교사 비율" />} value={pct(sf.tempRatio)} hint={`교원 ${sf.total}명 중 기간제 ${sf.temp ?? 0}명${sf.lecturer ? ` · 강사 ${sf.lecturer}명` : ''}`} />}
            {mv && <Stat label="전입 · 전출 (작년)" value={`${mv.in} · ${mv.out}명`} hint={`학생 대비 ${pct(mv.inRate)} · ${pct(mv.outRate)}${A.length ? ` (전입 ${cmp('inRate', (v) => `${v}%`)})` : ''}`} />}
            {mv && <Stat label={<Term k="학업중단율" />} value={pct(mv.dropoutRate)} hint={`${mv.y}학년도 ${mv.dropout}명${A.length ? ` (${cmp('dropoutRate', (v) => `${v}%`)})` : ''}`} />}
            {cl && <Stat label="동아리" value={`${cl.clubs}개`} hint={`참여 ${num(cl.members)}명${cl.self ? ` · 자율동아리 ${cl.self}개(${num(cl.selfMembers)}명)` : ''} · ${cl.y}학년도`} />}
          </div>
          <div style={S.dim}>전입이 전출보다 많으면 일부러 찾아오는 학교일 수 있고, 전출·학업중단이 지역보다 높으면 이유를 상담에서 확인해 보세요. 학급당·교원 1인당 학생 수가 적을수록 수업·상담이 촘촘한 편입니다.</div>
        </section>
      )}
    </>
  );
}

function BandTable({ rows }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={S.table}>
        <thead>
          <tr>{['학년도', '학년·학기', '과목', '평균', '표준편차', 'A', 'B', 'C', 'D', 'E', '분포'].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((b, i) => (
            <tr key={i}>
              <td style={S.td}>{String(b.year || '').replace('학년도', '')}</td>
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

function CompareModal({ schools, subject, grade, onClose, explain }) {
  const isHigh = schools.every((s) => s.schoolLevel === '고등학교');
  const rowsSpec = [
    { label: '소재지', get: (s) => `${s.sido} ${s.sigungu}` },
    { label: '유형 · 성별 · 설립', get: (s) => [s.schoolType, s.gender, s.fond].filter(Boolean).join(' · ') },
    { label: '성취도 학년도', get: (s) => [...new Set((s.bands || []).map((b) => b.year).filter(Boolean))].join(', ') || '—' },
    { label: '전체 재적', get: (s) => (s.enrollment ? `${num(s.enrollment.total)}명` : '—') },
    { label: '1학년 재적', get: (s) => (s.enrollment?.grade1 != null ? `${s.enrollment.grade1}명` : '—') },
    ...(isHigh ? [{ label: '1등급권 자리', get: (s) => (seatsOf(s) === null ? '—' : `${seatsOf(s)}개`) }] : []),
    { label: '학급 · 교원', get: (s) => `${s.edss?.classes ?? '—'}학급 · ${s.current?.teachers ?? s.edss?.teachers ?? '—'}명` },
    ...(schools.some((s) => s.extra) ? [
      ...(isHigh ? [
        { label: '4년제 진학 (최근 · 3년 평균)', get: (s) => { const c = careerSummary(s.extra, '고등학교'); return c ? `${pct(c.last.univ)} · ${pct(c.univ3)}` : '—'; } },
        { label: '전문대 진학 (최근)', get: (s) => pct(careerSummary(s.extra, '고등학교')?.last.college ?? null) },
        { label: "'기타'(재수 등) · 취업", get: (s) => { const c = careerSummary(s.extra, '고등학교'); return c ? `${pct(c.last.etc)} · ${pct(c.last.job)}` : '—'; } },
      ] : [
        { label: '과학·외고·국제·예체·자사고 진학', get: (s) => pct(careerSummary(s.extra, '중학교')?.select ?? null) },
        { label: '일반고 · 특성화고 진학', get: (s) => { const c = careerSummary(s.extra, '중학교'); return c ? `${pct(c.last.general)} · ${pct(c.last.vocational)}` : '—'; } },
      ]),
      { label: '학급당 학생 수', get: (s) => (s.extra?.status?.perClass != null ? `${s.extra.status.perClass}명` : '—') },
      { label: '수업교원 1인당 학생 수', get: (s) => (s.extra?.status?.perTeacher != null ? `${s.extra.status.perTeacher}명` : '—') },
      { label: '기간제 교사 비율', get: (s) => pct(s.extra?.staff?.tempRatio ?? null) },
      { label: '전입 · 전출 · 학업중단', get: (s) => { const m = s.extra?.moves; return m ? `${m.in}·${m.out}·${m.dropout}명` : '—'; } },
      { label: '동아리', get: (s) => (s.extra?.clubs ? `${s.extra.clubs.clubs}개${s.extra.clubs.self ? ` + 자율 ${s.extra.clubs.self}` : ''}` : '—') },
    ] : []),
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
        {explain && (
          <>
            <ExplainBox label={`${schools.length}개 학교 입시 비교 해설`} busy={explain.busy} hasKey={explain.hasKey} onExplain={explain.run} />
            {explain.err && <p style={{ ...S.dim, color: '#f87171', marginTop: 6 }}>{explain.err}</p>}
          </>
        )}
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
  weight: { fontSize: 12, color: 'var(--text2)', marginTop: 2 },
  weightBox: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', minWidth: 120 },
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
