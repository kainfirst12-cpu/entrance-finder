import { useState, useEffect, useMemo, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import { fetchGzJson, CATALOG_URL, regionLabel } from '../schoolCatalog';
import { analyzeSchools, factsForAI, SUBJECTS, shortName } from '../seminar/analysis';
import { useAssistantAgent } from '../assistant/useAssistantAgent';
import { buildSlides, numberSlides } from '../seminar/deckModel';
import SlidePreview from '../seminar/SlidePreview';

// 📽️ 설명회 자료 만들기 — 담당 고등학교를 고르면 학교알리미 1학년 성취도로 학교별 분석·비교·분류 슬라이드를 만들고 PPT 로 내려받는다.
// 슬라이드는 저장하지 않는다. 담당 학교·옵션·문구만 저장하고 열 때마다 최신 공시 데이터로 다시 그린다
// (새 공시가 catalog 에 들어오면 같은 자료를 다시 내려받는 것만으로 숫자가 바뀐다).
// 메뉴 잠금: optIn 'seminar' — 관리자 + 관리자가 직접 체크한 학원 코드만(서버 requireMenu 가 실제로 막는다).

const token = () => localStorage.getItem('ef_token');
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  // 401 만 로그아웃, 403 은 서버 메시지만(메뉴 잠금)
  if (res.status === 401 || res.status === 403) { let m = res.status === 401 ? '로그인이 필요합니다' : '이 학원 코드에는 열려 있지 않은 기능입니다'; try { m = (await res.json()).message || m; } catch { /* 본문 없음 */ } const e = new Error(m); e.auth = res.status === 401; throw e; }
  return res.json();
}
async function postSSE(url, opts) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) { try { return await res.json(); } catch { return { success: false, message: `서버 응답 오류 (HTTP ${res.status})` }; } }
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', result = null;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) if (l.startsWith('data: ')) { try { result = JSON.parse(l.slice(6)); } catch { /* 조각 */ } }
  }
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}

const DEFAULT_OPTS = { part: 1, title: '일반고 선택의 기준', region: '', startPage: 1, semester: 'avg', includeCover: true };
const emptyDeck = () => ({ id: null, title: '설명회 자료', school_ids: [], options: { ...DEFAULT_OPTS }, notes: {} });

// 시도별 전 과목 파일 — 학교 항목의 bandsFile(공시정보 화면과 같은 파일)
const bandsCache = new Map();
function loadBandsFile(file) {
  if (!bandsCache.has(file)) bandsCache.set(file, fetchGzJson(`/data/${file}`).catch((e) => { bandsCache.delete(file); throw e; }));
  return bandsCache.get(file);
}

export default function SeminarDeck({ getActiveKey, selectedModel, aiGroup, onAuthError }) {
  const [catalog, setCatalog] = useState(null);
  const [catErr, setCatErr] = useState('');
  const [deck, setDeck] = useState(emptyDeck);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState([]);
  const [full, setFull] = useState({});        // schoolId → 전 과목 bands
  const [q, setQ] = useState('');
  const [sido, setSido] = useState('경기도');
  const [sigungu, setSigungu] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [editId, setEditId] = useState(null);   // 문구 고치는 학교
  const [big, setBig] = useState(null);         // 크게 볼 슬라이드 index

  const fail = useCallback((e) => { if (e?.auth) onAuthError?.(); setErr(e?.message || String(e)); }, [onAuthError]);

  useEffect(() => {
    fetchGzJson(CATALOG_URL).then((c) => setCatalog((c.schools || []).filter((s) => s.schoolLevel === '고등학교'))).catch((e) => setCatErr(e.message));
    api('/api/seminar/decks').then((r) => r.success && setSaved(r.items || [])).catch(fail);
  }, [fail]);

  const byId = useMemo(() => new Map((catalog || []).map((s) => [String(s.id), s])), [catalog]);
  const chosen = useMemo(() => deck.school_ids.map((id) => byId.get(String(id))).filter(Boolean), [deck.school_ids, byId]);

  // 고른 학교의 전 과목 표 불러오기(시도 파일 단위)
  useEffect(() => {
    const need = chosen.filter((s) => !full[s.id] && s.bandsFile);
    if (!need.length) return;
    let dead = false;
    Promise.all([...new Set(need.map((s) => s.bandsFile))].map((f) => loadBandsFile(f).then((m) => [f, m])))
      .then((pairs) => {
        if (dead) return;
        const files = Object.fromEntries(pairs);
        setFull((cur) => { const nx = { ...cur }; for (const s of need) nx[s.id] = files[s.bandsFile]?.[s.id] || s.bands || []; return nx; });
      }).catch((e) => !dead && setErr(`학교 성취도 파일을 불러오지 못했습니다: ${e.message}`));
    return () => { dead = true; };
  }, [chosen, full]);

  const opts = { ...DEFAULT_OPTS, ...deck.options };
  const autoRegion = useMemo(() => {
    const r = [...new Set(chosen.map((s) => s.sigungu || s.sido))];
    return r.length === 1 ? r[0].replace(/시$|군$|구$/, '') : r.length ? '우리 지역' : '';
  }, [chosen]);
  const ready = chosen.length > 0 && chosen.every((s) => full[s.id] || !s.bandsFile); // bandsFile 없는 학교는 catalog 의 국·영·수만
  const analysis = useMemo(() => (ready ? analyzeSchools(chosen.map((s) => ({ ...s, bands: full[s.id] || s.bands || [] })), { semester: opts.semester === 'avg' ? 'avg' : Number(opts.semester) }) : null), [ready, chosen, full, opts.semester]);
  const slides = useMemo(() => (analysis ? numberSlides(buildSlides({ ...opts, region: opts.region || autoRegion, notes: deck.notes }, analysis), opts.startPage) : []), [analysis, opts, autoRegion, deck.notes]);
  const skipped = analysis ? analysis.items.filter((it) => !analysis.usable.includes(it)) : [];

  const patch = (p) => { setDeck((d) => ({ ...d, ...p })); setDirty(true); };
  const setOpt = (k, v) => patch({ options: { ...opts, [k]: v } });
  const addIds = (ids) => patch({ school_ids: [...new Set([...deck.school_ids, ...ids.map(String)])] });
  const removeId = (id) => patch({ school_ids: deck.school_ids.filter((x) => x !== String(id)) });

  // 학교 찾기
  const sidos = useMemo(() => [...new Set((catalog || []).map((s) => s.sido).filter(Boolean))].sort(), [catalog]);
  const sigungus = useMemo(() => [...new Set((catalog || []).filter((s) => s.sido === sido).map((s) => s.sigungu).filter(Boolean))].sort(), [catalog, sido]);
  const hits = useMemo(() => {
    const t = q.trim(); if (!catalog || t.length < 1) return [];
    return catalog.filter((s) => s.schoolName.includes(t) && !deck.school_ids.includes(String(s.id))).slice(0, 12);
  }, [catalog, q, deck.school_ids]);
  const addRegion = () => {
    const list = (catalog || []).filter((s) => s.sido === sido && (!sigungu || s.sigungu === sigungu) && s.schoolType === '일반고등학교');
    if (!list.length) { setMsg('그 지역에는 일반고가 없습니다.'); return; }
    addIds(list.map((s) => s.id));
    setMsg(`${sigungu || sido} 일반고 ${list.length}곳을 넣었습니다.`);
  };

  // 저장·불러오기
  const save = async () => {
    setBusy('save'); setErr('');
    try {
      const body = { title: deck.title, school_ids: deck.school_ids, options: opts, notes: deck.notes };
      const r = deck.id ? await api(`/api/seminar/decks/${deck.id}`, { method: 'PUT', body }) : await api('/api/seminar/decks', { method: 'POST', body });
      if (!r.success) throw new Error(r.message || '저장 실패');
      setDeck((d) => ({ ...d, id: r.item.id })); setDirty(false); setMsg('저장했습니다.');
      const l = await api('/api/seminar/decks'); if (l.success) setSaved(l.items || []);
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const open = async (id) => {
    if (dirty && !confirm('저장하지 않은 변경이 있습니다. 버리고 열까요?')) return;
    if (!id) { setDeck(emptyDeck()); setDirty(false); return; }
    try {
      const r = await api(`/api/seminar/decks/${id}`);
      if (!r.success) throw new Error(r.message);
      const it = r.item;
      setDeck({ id: it.id, title: it.title, school_ids: (it.school_ids || []).map(String), options: { ...DEFAULT_OPTS, ...(it.options || {}) }, notes: it.notes || {} });
      setDirty(false); setMsg('');
    } catch (e) { fail(e); }
  };
  const remove = async () => {
    if (!deck.id || !confirm(`'${deck.title}' 을(를) 지울까요?`)) return;
    try { await api(`/api/seminar/decks/${deck.id}`, { method: 'DELETE' }); setSaved((l) => l.filter((x) => x.id !== deck.id)); setDeck(emptyDeck()); setDirty(false); } catch (e) { fail(e); }
  };

  // AI 해설
  const aiNotes = async () => {
    const apiKey = getActiveKey?.();
    if (!apiKey) { setErr('설정에서 AI API 키를 먼저 넣어 주세요. (키가 없어도 규칙으로 만든 해설로 PPT 는 나옵니다)'); return; }
    setBusy('ai'); setErr(''); setMsg('');
    try {
      const r = await postSSE(`${API_BASE}/api/seminar/notes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', 'x-api-key': apiKey, 'x-ai-model': aiGroup || 'claude', 'x-ai-submodel': selectedModel || 'claude' },
        body: JSON.stringify({ region: opts.region || autoRegion, schools: factsForAI(analysis) }),
      });
      if (!r.success) throw new Error(r.message || 'AI 해설 실패');
      patch({ notes: { ...deck.notes, ...r.notes } });
      setMsg(`AI 해설을 ${Object.keys(r.notes).length}개 학교에 넣었습니다. 슬라이드에서 확인하고 '문구 고치기'로 다듬으세요.`);
    } catch (e) { fail(e); } finally { setBusy(''); }
  };

  const download = async () => {
    setBusy('pptx'); setErr('');
    try {
      const { downloadPptx } = await import('../seminar/pptx');
      const name = `${deck.title || '설명회 자료'}.pptx`.replace(/[\\/:*?"<>|]/g, '_');
      await downloadPptx(slides, { fileName: name, title: deck.title });
    } catch (e) { setErr(`PPT 만들기 실패: ${e.message}`); } finally { setBusy(''); }
  };

  // 🤖 AI 선생님 도구 — "부천여고, 상동고 담당학교로 불러와줘" 같은 말로 학교를 넣고 뺀다
  const matchSchools = (names, region) => {
    const found = [], missing = [], ambiguous = [];
    const here = new Set(chosen.map((s) => s.sigungu));
    for (const raw of names || []) {
      const n = String(raw).trim().replace(/\s+/g, '');
      if (!n) continue;
      let list = (catalog || []).filter((s) => s.schoolName === n || shortName(s.schoolName) === n || s.schoolName === `${n}등학교` || s.schoolName.replace(/고등학교$/, '고') === n);
      if (region) list = list.filter((s) => `${s.sido} ${s.sigungu}`.includes(region));
      if (list.length > 1 && here.size) { const near = list.filter((s) => here.has(s.sigungu)); if (near.length) list = near; }
      if (list.length === 1) found.push(list[0]);
      else if (!list.length) missing.push(raw);
      else ambiguous.push(`${raw}(${list.slice(0, 4).map(regionLabel).join(' / ')})`);
    }
    return { found, missing, ambiguous };
  };
  useAssistantAgent('screen', {
    key: 'seminar',
    title: '설명회 자료 만들기',
    describe: () => [
      '[화면] 설명회 자료 만들기 — 담당 고등학교를 고르면 학교알리미 1학년 성취도로 학교별 분석·비교·분류 슬라이드를 만들고 PPT로 내려받는다.',
      `[자료] ${deck.title}${deck.id ? ' (저장됨)' : ' (새 자료)'}${dirty ? ' · 저장 안 한 변경 있음' : ''}`,
      `[담당 학교 ${chosen.length}곳] ${chosen.map((s) => s.schoolName).join(', ') || '없음'}`,
      `[저장된 자료] ${saved.map((d) => d.title).join(', ') || '없음'}`,
      `[슬라이드] ${slides.length}장 · 파트 ${opts.part} · 제목 ${opts.title} · 학기 ${opts.semester}`,
      '[도구] 학교 넣기 add_schools(이름 목록, 지역 선택), 빼기 remove_schools, 비우기 clear_schools, 지역 일반고 전부 add_region_schools, 설정 set_seminar_options, 저장 save_seminar_deck, PPT 내려받기 download_seminar_pptx.',
    ].join('\n'),
    examples: ['부천여고, 상동고, 송내고 담당학교로 넣어줘', '부천시 일반고 전부 넣어줘', '파트 번호 6으로 바꾸고 저장해줘'],
    tools: [
      {
        name: 'add_schools',
        description: '담당 학교를 이름으로 넣는다. 줄임말(부천여고·상동고)도 된다. 같은 이름이 여러 지역에 있으면 region(예: "부천")으로 좁힌다.',
        schema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } }, region: { type: 'string', description: '시도·시군구 일부(선택)' } }, required: ['names'] },
        run: ({ names, region }) => {
          if (!catalog) return '학교 목록을 아직 불러오는 중입니다. 잠시 뒤 다시 시도하세요.';
          const { found, missing, ambiguous } = matchSchools(names, region);
          if (found.length) addIds(found.map((s) => s.id));
          return [found.length ? `넣음: ${found.map((s) => `${s.schoolName}(${regionLabel(s)})`).join(', ')}` : '',
            missing.length ? `못 찾음: ${missing.join(', ')}` : '', ambiguous.length ? `여러 곳이라 지역을 알려 주세요: ${ambiguous.join(', ')}` : ''].filter(Boolean).join('\n');
        },
      },
      {
        name: 'remove_schools',
        description: '담당 학교에서 이름으로 뺀다.',
        schema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'] },
        run: ({ names }) => {
          const want = (names || []).map((n) => String(n).replace(/\s+/g, ''));
          const out = chosen.filter((s) => want.some((n) => s.schoolName === n || shortName(s.schoolName) === n));
          patch({ school_ids: deck.school_ids.filter((id) => !out.some((s) => String(s.id) === id)) });
          return out.length ? `뺌: ${out.map((s) => s.schoolName).join(', ')}` : '담당 학교 중에 그 이름이 없습니다.';
        },
      },
      { name: 'clear_schools', description: '담당 학교를 모두 뺀다.', schema: { type: 'object', properties: {} }, confirm: '담당 학교를 모두 뺄까요?', run: () => { patch({ school_ids: [] }); return '모두 뺐습니다.'; } },
      {
        name: 'add_region_schools',
        description: '한 시군구(또는 시도)의 일반고를 전부 넣는다.',
        schema: { type: 'object', properties: { sido: { type: 'string', description: '예: 경기도' }, sigungu: { type: 'string', description: '예: 부천시(없으면 시도 전체)' } }, required: ['sido'] },
        run: ({ sido: sd, sigungu: sg }) => {
          const list = (catalog || []).filter((s) => (s.sido || '').includes(sd) && (!sg || (s.sigungu || '').includes(sg)) && s.schoolType === '일반고등학교');
          if (!list.length) return '그 지역에서 일반고를 찾지 못했습니다.';
          addIds(list.map((s) => s.id));
          return `${list.length}곳을 넣었습니다.`;
        },
      },
      {
        name: 'set_seminar_options',
        description: '슬라이드 설정을 바꾼다. part(파트 번호), title(제목), region(지역 이름), startPage(시작 쪽번호), semester("avg"|1|2), includeCover(파트 표지), deckTitle(자료 제목).',
        schema: { type: 'object', properties: { part: { type: 'number' }, title: { type: 'string' }, region: { type: 'string' }, startPage: { type: 'number' }, semester: { type: ['string', 'number'] }, includeCover: { type: 'boolean' }, deckTitle: { type: 'string' } } },
        run: (inp) => {
          const { deckTitle, ...rest } = inp || {};
          const next = { ...opts };
          for (const k of ['part', 'title', 'region', 'startPage', 'includeCover']) if (rest[k] !== undefined) next[k] = rest[k];
          if (rest.semester !== undefined) next.semester = rest.semester === 'avg' ? 'avg' : Number(rest.semester) || 'avg';
          patch({ options: next, ...(deckTitle ? { title: deckTitle } : {}) });
          return '설정을 바꿨습니다.';
        },
      },
      { name: 'save_seminar_deck', description: '지금 자료(담당 학교·설정·문구)를 저장한다.', schema: { type: 'object', properties: {} }, run: async () => { await save(); return '저장을 요청했습니다.'; } },
      { name: 'download_seminar_pptx', description: '지금 슬라이드를 PPT 파일로 내려받는다.', schema: { type: 'object', properties: {} }, run: async () => { if (!slides.length) return '담당 학교가 없어 만들 슬라이드가 없습니다.'; await download(); return `${slides.length}장 PPT 내려받기를 시작했습니다.`; } },
    ],
  });

  const setNote = (id, p) => patch({ notes: { ...deck.notes, [id]: { ...(deck.notes[id] || {}), ...p } } });
  const editItem = editId && analysis?.usable.find((x) => x.id === editId);

  return (
    <div style={S.page}>
      <h2 style={S.h2}>📽️ 설명회 자료 만들기</h2>
      <p style={S.lead}>담당 고등학교를 고르면 학교알리미 1학년 성취도(A~E)로 학교별 분석 · 과목별 비교 · 유형 분류 슬라이드를 만들어 PPT로 내려받습니다.
        표·차트는 파워포인트에서 바로 고칠 수 있는 진짜 표·차트로 들어갑니다. 담당 학교 묶음을 저장해 두면, 새 공시가 반영된 뒤 다시 내려받는 것만으로 숫자가 바뀝니다.</p>

      {catErr && <div style={S.err}>학교 목록을 불러오지 못했습니다: {catErr}</div>}
      {err && <div style={S.err} onClick={() => setErr('')}>{err}</div>}
      {msg && <div style={S.ok} onClick={() => setMsg('')}>{msg}</div>}

      <div style={S.layout}>
        {/* ── 왼쪽: 설정 ── */}
        <div style={S.side}>
          <section style={S.card}>
            <div style={S.secTitle}>저장된 자료</div>
            <div style={S.row}>
              <select style={{ ...S.input, flex: 1 }} value={deck.id || ''} onChange={(e) => open(e.target.value ? Number(e.target.value) : null)}>
                <option value="">+ 새 자료</option>
                {saved.map((d) => <option key={d.id} value={d.id}>{d.title} ({(d.school_ids || []).length}곳)</option>)}
              </select>
            </div>
            <input style={{ ...S.input, width: '100%', marginTop: 8 }} value={deck.title} onChange={(e) => patch({ title: e.target.value })} placeholder="자료 제목 (예: 2026 부천 고입설명회)" />
            <div style={{ ...S.row, marginTop: 8 }}>
              <button style={{ ...S.btn, ...S.btnPrimary }} onClick={save} disabled={busy === 'save'}>{busy === 'save' ? '저장 중…' : dirty ? '💾 저장*' : '💾 저장'}</button>
              {deck.id && <button style={S.btn} onClick={remove}>지우기</button>}
            </div>
          </section>

          <section style={S.card}>
            <div style={S.secTitle}>담당 학교 ({chosen.length}곳)</div>
            <input style={{ ...S.input, width: '100%' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="학교 이름으로 찾기 (예: 상동)" disabled={!catalog} />
            {hits.length > 0 && (
              <div style={S.hits}>
                {hits.map((s) => (
                  <button key={s.id} style={S.hit} onClick={() => { addIds([s.id]); setQ(''); }}>
                    <b>{s.schoolName}</b> <span style={S.dim}>{regionLabel(s)} · {s.schoolType?.replace('고등학교', '고')}</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ ...S.row, marginTop: 8 }}>
              <select style={S.input} value={sido} onChange={(e) => { setSido(e.target.value); setSigungu(''); }}>{sidos.map((x) => <option key={x}>{x}</option>)}</select>
              <select style={{ ...S.input, flex: 1 }} value={sigungu} onChange={(e) => setSigungu(e.target.value)}>
                <option value="">시군구 전체</option>
                {sigungus.map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
            <button style={{ ...S.btn, width: '100%', marginTop: 6 }} onClick={addRegion} disabled={!catalog}>이 지역 일반고 전부 넣기</button>
            <div style={S.chips}>
              {chosen.map((s) => (
                <span key={s.id} style={S.chip}>{s.schoolName.replace(/고등학교$/, '고')}<button style={S.x} onClick={() => removeId(s.id)} title="빼기">×</button></span>
              ))}
              {chosen.length > 0 && <button style={{ ...S.x, fontSize: 12 }} onClick={() => patch({ school_ids: [] })}>모두 빼기</button>}
            </div>
            {skipped.length > 0 && <div style={S.dim}>성취도 공시가 없어 빠진 학교: {skipped.map((s) => s.short).join(', ')}</div>}
          </section>

          <section style={S.card}>
            <div style={S.secTitle}>슬라이드 설정</div>
            <label style={S.lbl}>파트 번호 <input type="number" min={1} style={{ ...S.input, width: 70 }} value={opts.part} onChange={(e) => setOpt('part', Number(e.target.value) || 1)} /></label>
            <label style={S.lbl}>제목 <input style={{ ...S.input, flex: 1 }} value={opts.title} onChange={(e) => setOpt('title', e.target.value)} /></label>
            <label style={S.lbl}>지역 이름 <input style={{ ...S.input, flex: 1 }} value={opts.region} placeholder={autoRegion || '예: 부천'} onChange={(e) => setOpt('region', e.target.value)} /></label>
            <label style={S.lbl}>시작 쪽번호 <input type="number" min={1} style={{ ...S.input, width: 80 }} value={opts.startPage} onChange={(e) => setOpt('startPage', Number(e.target.value) || 1)} /></label>
            <label style={S.lbl}>학기
              <select style={S.input} value={opts.semester} onChange={(e) => setOpt('semester', e.target.value === 'avg' ? 'avg' : Number(e.target.value))}>
                <option value="avg">1·2학기 평균</option><option value={1}>1학기만</option><option value={2}>2학기만</option>
              </select>
            </label>
            <label style={S.lbl}><input type="checkbox" checked={opts.includeCover !== false} onChange={(e) => setOpt('includeCover', e.target.checked)} /> 파트 표지 넣기</label>
            <div style={S.dim}>학교마다 그 학교의 가장 최근 공시 학년도를 씁니다. 분류(강세·성취도 층)는 고른 학교들끼리 비교한 결과라, 묶음이 바뀌면 달라질 수 있습니다.</div>
          </section>

          <section style={S.card}>
            <div style={S.secTitle}>만들기</div>
            <button style={{ ...S.btn, width: '100%' }} onClick={aiNotes} disabled={!analysis || busy === 'ai'}>{busy === 'ai' ? '🤖 해설 쓰는 중… (1~2분)' : '🤖 AI로 해설 문구 다듬기'}</button>
            <div style={{ ...S.dim, margin: '4px 0 8px' }}>키가 없어도 규칙으로 만든 해설이 들어갑니다. AI는 문구만 다듬고 숫자·분류는 바꾸지 않습니다.</div>
            <button style={{ ...S.btn, ...S.btnPrimary, width: '100%', padding: '11px 14px', fontSize: 14 }} onClick={download} disabled={!slides.length || busy === 'pptx'}>
              {busy === 'pptx' ? 'PPT 만드는 중…' : `⬇ PPT 내려받기 (${slides.length}장)`}
            </button>
          </section>
        </div>

        {/* ── 오른쪽: 미리보기 ── */}
        <div style={S.main}>
          {!chosen.length && <div style={S.empty}>왼쪽에서 담당 학교를 고르세요. 학교 이름으로 찾거나 '이 지역 일반고 전부 넣기'를 누르면 됩니다.</div>}
          {chosen.length > 0 && !ready && <div style={S.empty}>학교 성취도 파일을 불러오는 중…</div>}
          <div style={S.grid}>
            {slides.map((sl, i) => {
              const sid = sl.key.startsWith('school:') ? sl.key.slice(7) : null;
              return (
                <div key={sl.key} style={S.slideWrap}>
                  <div onClick={() => setBig(i)} style={{ cursor: 'zoom-in' }}><SlidePreview slide={sl} width={400} /></div>
                  <div style={S.slideCap}>
                    <span>{i + (Number(opts.startPage) || 1)}. {sl.title}{sid && deck.notes[sid]?.ai ? ' · 🤖' : ''}</span>
                    {sid && <button style={S.linkBtn} onClick={() => setEditId(sid)}>✏ 문구 고치기</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {big !== null && slides[big] && (
        <div style={S.overlay} onClick={() => setBig(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
            <SlidePreview slide={slides[big]} width={Math.min(1100, window.innerWidth - 60)} />
            <div style={S.row}>
              <button style={S.btn} disabled={big === 0} onClick={() => setBig(big - 1)}>◀ 이전</button>
              <span style={{ color: '#fff', fontSize: 13 }}>{big + 1} / {slides.length}</span>
              <button style={S.btn} disabled={big === slides.length - 1} onClick={() => setBig(big + 1)}>다음 ▶</button>
              <button style={S.btn} onClick={() => setBig(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {editItem && (
        <div style={S.overlay} onClick={() => setEditId(null)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.secTitle}>✏ {editItem.name} — 슬라이드 문구</div>
            {SUBJECTS.filter((x) => editItem.rows[x.key]).map((x) => (
              <label key={x.key} style={S.lbl}><span style={{ width: 64 }}>{x.label}</span>
                <input style={{ ...S.input, flex: 1 }} value={deck.notes[editItem.id]?.subjects?.[x.key] ?? editItem.rows[x.key].note}
                  onChange={(e) => setNote(editItem.id, { subjects: { ...(deck.notes[editItem.id]?.subjects || {}), [x.key]: e.target.value } })} />
              </label>
            ))}
            <label style={S.lbl}><span style={{ width: 64 }}>강점 과목</span>
              <input style={{ ...S.input, flex: 1 }} value={deck.notes[editItem.id]?.strong ?? editItem.message.strong ?? ''} placeholder="비우면 문장 생략" onChange={(e) => setNote(editItem.id, { strong: e.target.value || null })} /></label>
            <label style={S.lbl}><span style={{ width: 64 }}>보완 과목</span>
              <input style={{ ...S.input, flex: 1 }} value={deck.notes[editItem.id]?.weak ?? editItem.message.weak ?? ''} placeholder="비우면 문장 생략" onChange={(e) => setNote(editItem.id, { weak: e.target.value || null })} /></label>
            <label style={S.lbl}><span style={{ width: 64 }}>유형 한 줄</span>
              <input style={{ ...S.input, flex: 1 }} value={deck.notes[editItem.id]?.typeLine ?? editItem.typeLine} onChange={(e) => setNote(editItem.id, { typeLine: e.target.value })} /></label>
            <div style={{ ...S.row, justifyContent: 'space-between', marginTop: 10 }}>
              <button style={S.btn} onClick={() => { const n = { ...deck.notes }; delete n[editItem.id]; patch({ notes: n }); }}>규칙 문구로 되돌리기</button>
              <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => setEditId(null)}>닫기 (저장은 💾)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  page: { padding: '24px 28px', maxWidth: 1500 },
  h2: { fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text)' },
  lead: { fontSize: 13, color: 'var(--text2)', margin: '6px 0 14px', lineHeight: 1.6, maxWidth: 980 },
  layout: { display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' },
  side: { flex: '0 0 330px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: '100%' },
  main: { flex: 1, minWidth: 420 },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, boxShadow: 'var(--shadow)' },
  secTitle: { fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 },
  row: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  input: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', fontSize: 13, boxSizing: 'border-box' },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  btnPrimary: { background: '#00b765', borderColor: '#00b765', color: '#fff' },
  lbl: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text2)', fontWeight: 600, marginBottom: 7 },
  dim: { fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5, marginTop: 6 },
  hits: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: 6, maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 4 },
  hit: { textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text)', padding: '5px 6px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 10 },
  chip: { display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12, fontWeight: 700, color: 'var(--accent)', background: 'var(--accent-bg)', borderRadius: 999, padding: '3px 4px 3px 10px' },
  x: { background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 14, padding: '0 5px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 16 },
  slideWrap: { display: 'flex', flexDirection: 'column', gap: 5 },
  slideCap: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text2)', width: 400 },
  linkBtn: { background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
  empty: { padding: 40, textAlign: 'center', color: 'var(--text2)', border: '1px dashed var(--border)', borderRadius: 12 },
  err: { background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#f87171', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12, cursor: 'pointer' },
  ok: { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(640px, 94vw)', maxHeight: '90vh', overflow: 'auto' },
};
