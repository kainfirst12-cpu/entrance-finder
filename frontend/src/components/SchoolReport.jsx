import { useEffect, useState } from 'react';
import { API_BASE } from '../apiBase';
import { mdPreview } from '../mdPreview';
import { parseReport, stripStructured } from '../reportMarkdown';

// 고교·중학 공시정보 → 입시·진학 관점 해설 보고서
//   - explainSchools(): 학교 1곳 또는 비교함(2~4곳)의 공시 수치를 백엔드 /api/schoolinfo/explain 에 보내 AI 해설(마크다운)을 받는다
//   - ReportEditor: 받은 해설을 고치고(제목·본문), 저장(DB: ef_school_reports)·Word·PDF 다운로드·삭제
//   - SavedReports: 저장된 보고서 목록(검색·열기·삭제)
// 서버 저장은 선생님(로그인 코드)별로 분리된다.

const token = () => localStorage.getItem('ef_token');
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) { const e = new Error('권한/인증'); e.auth = true; throw e; }
  return res.json();
}
// SSE(keepalive) 응답 — 해설 생성은 1~2분 걸려 프록시 타임아웃을 피하려고 서버가 event-stream 으로 준다(수행평가와 같은 패턴)
async function postForResult(url, opts) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    try { return await res.json(); } catch { return { success: false, message: `서버 응답 오류 (HTTP ${res.status})` }; }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop();
    for (const line of lines) if (line.startsWith('data: ')) { try { result = JSON.parse(line.slice(6)); } catch { /* 부분 청크 */ } }
  }
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}

// catalog 항목에서 AI 에게 보낼 필드만 추린다(전 과목 bands 는 호출 쪽이 미리 채워 넣는다)
function pickSchool(s) {
  const { id, schoolName, schoolLevel, sido, sigungu, schoolType, gender, fond, address, enrollment, edss, current, achievementChasu, bands } = s;
  return { id, schoolName, schoolLevel, sido, sigungu, schoolType, gender, fond, address, enrollment, edss, current, achievementChasu, bands };
}

// ── 수치 블록(서버 buildReportData) 그리기 — PDF·Word·나만의 패파와 같은 순서·색: 학교 카드 → 국·영·수 학년별 A~E 분포 막대 ──
const BAND = { a: '#2dd4bf', b: '#60a5fa', c: '#a78bfa', d: '#fbbf24', e: '#f87171' };
const SCHOOL_COLORS = ['#818cf8', '#2dd4bf', '#fbbf24', '#fb7185'];
const fmtN = (v, unit = '') => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('ko-KR')}${unit}`);
const shortName = (n) => String(n || '').replace(/(고등|중)학교$/, '');

export function ReportVisual({ data }) {
  const schools = data?.schools || [];
  if (!schools.length) return null;
  const many = schools.length > 1;
  const isHigh = schools.every((s) => s.level === '고등학교');
  const grades = [1, 2, 3].filter((g) => schools.some((s) => s.core?.[g]));
  return (
    <div style={V.wrap}>
      <div style={{ ...V.cards, gridTemplateColumns: `repeat(${schools.length}, minmax(0, 1fr))` }}>
        {schools.map((s, i) => {
          const color = many ? SCHOOL_COLORS[i % SCHOOL_COLORS.length] : 'var(--accent)';
          const st = s.stats;
          const cells = [
            ['재적', fmtN(st.total, '명'), `${fmtN(st.g1)}·${fmtN(st.g2)}·${fmtN(st.g3)}`],
            ...(isHigh ? [['1등급 자리', fmtN(st.seats, '개'), '1학년×10%']] : [['개설 과목', fmtN(s.subjects, '개'), `3단계 ${fmtN(s.threeStep)}개`]]),
            ['학급', fmtN(st.classes, '개'), 'EDSS'],
            ['교원', fmtN(st.teachers, '명'), st.students ? `학생 ${fmtN(st.students)}명` : ''],
          ];
          return (
            <div key={s.id || i} style={{ ...V.card, borderLeftColor: color }}>
              <div style={V.cardName}>{s.name}</div>
              <div style={V.cardChips}>{s.chips.join(' · ')}</div>
              <div style={V.statRow}>
                {cells.map(([label, val, hint]) => (
                  <div key={label}><div style={V.statLabel}>{label}</div><div style={{ ...V.statVal, color }}>{val}</div><div style={V.statLabel}>{hint}</div></div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div style={V.chartHead}>
        <span>국어·영어·수학 성취도 분포{data.year ? ` (${data.year})` : ''}</span>
        <span style={V.legend}>{['a', 'b', 'c', 'd', 'e'].map((k) => <span key={k}><i style={{ ...V.sw, background: BAND[k] }} />{k.toUpperCase()}</span>)}</span>
      </div>
      {grades.map((g) => (
        <div key={g} style={V.gradeBlock}>
          <div style={V.gradeLabel}>{isHigh ? '고' : '중'}{g}</div>
          {['국어', '영어', '수학'].filter((f) => schools.some((s) => s.core?.[g]?.[f])).map((f) => (
            <div key={f} style={V.famBlock}>
              {schools.map((s, i) => {
                const b = s.core?.[g]?.[f];
                const color = many ? SCHOOL_COLORS[i % SCHOOL_COLORS.length] : 'var(--text3)';
                const who = many ? `${shortName(s.name)} · ` : '';
                return (
                  <div key={s.id || i} style={V.barRow}>
                    <div style={V.barLabel}>{i === 0 ? f : ''}</div>
                    {b ? (
                      <>
                        <div style={V.bar}>{['a', 'b', 'c', 'd', 'e'].map((k) => (b[k] ? <div key={k} style={{ width: `${b[k]}%`, background: BAND[k], ...V.seg }}>{b[k] >= 8 ? Math.round(b[k]) : ''}</div> : null))}</div>
                        <div style={{ ...V.barMeta, color }}>{who}{b.subject.replace(/\s*\[.*\]$/, '')} · 평균 {fmtN(b.mean)}</div>
                      </>
                    ) : <div style={{ ...V.barMeta, color }}>{who}공시 없음</div>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ))}
      <div style={V.note}>막대 = A~E 성취도 비율(%, 절대평가 90/80/70/60점 기준). 같은 학년은 뒤 학기 값. 종합고는 전체계열→일반계 순.</div>
      <TrendTable data={data} />
    </div>
  );
}

// 학년별 추이 — 과목(×학교) × 학년, 칸 바탕 농도 = A 비율(상위권 두께)
function TrendTable({ data }) {
  const schools = data?.schools || [];
  const many = schools.length > 1;
  const isHigh = schools.every((s) => s.level === '고등학교');
  const grades = [1, 2, 3].filter((g) => schools.some((s) => s.core?.[g]));
  const rows = [];
  for (const f of ['국어', '영어', '수학']) schools.forEach((s, i) => { if (grades.some((g) => s.core?.[g]?.[f])) rows.push({ f, s, i }); });
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={V.chartHead}><span>학년별 추이 — A 비율(상위권 두께)과 평균</span></div>
      <table style={V.trend}>
        <thead><tr><th style={V.trendTh} /> {grades.map((g) => <th key={g} style={V.trendTh}>{isHigh ? '고' : '중'}{g}</th>)}</tr></thead>
        <tbody>
          {rows.map(({ f, s, i }) => (
            <tr key={`${f}-${i}`}>
              <td style={{ ...V.trendTd, fontWeight: 700, color: many ? SCHOOL_COLORS[i % SCHOOL_COLORS.length] : 'var(--text)', whiteSpace: 'nowrap' }}>{many ? `${f} · ${shortName(s.name)}` : f}</td>
              {grades.map((g) => { const b = s.core?.[g]?.[f]; const t = b ? Math.min(1, (Number(b.a) || 0) / 40) : 0;
                return <td key={g} style={{ ...V.trendTd, textAlign: 'center', background: b ? `rgba(45,212,191,${0.08 + 0.42 * t})` : 'transparent' }}>{b ? `A ${fmtN(b.a)}% · 평균 ${fmtN(b.mean)}${b.e === null || b.e === undefined ? '' : ` · E ${fmtN(b.e)}%`}` : '—'}</td>; })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 본문 구조 서식([지표]·[전형]·유리/불리 글머리표) → 스코어카드·막대·표. 나머지 줄은 mdPreview 로 ──
const Dots = ({ score, color }) => <span style={{ color, letterSpacing: 1 }}>{'●'.repeat(Math.round(score))}<span style={{ opacity: 0.35 }}>{'●'.repeat(5 - Math.round(score))}</span> <span style={{ fontSize: 10, opacity: 0.8 }}>{score}/5</span></span>;
export function StructuredBody({ content, data }) {
  const rep = parseReport(content);
  const schools = data?.schools || [];
  const many = schools.length > 1;
  const names = many ? schools.map((s) => shortName(s.name)) : [null];
  const colorOf = (i) => (many ? SCHOOL_COLORS[i % SCHOOL_COLORS.length] : 'var(--accent)');
  const whoIdx = (who) => Math.max(0, schools.findIndex((s) => who && (shortName(s.name).includes(who) || who.includes(shortName(s.name)))));
  return (
    <div>
      {rep.sections.map((sec, si) => {
        const isFav = /유리/.test(sec.title) && !/불리/.test(sec.title), isUnfav = /불리/.test(sec.title);
        const prose = stripStructured(sec.lines.filter((l) => !((isFav || isUnfav) && /^\s*[-*•]\s+/.test(l))).join('\n'));
        const inds = rep.indicators.filter((x) => x.section === sec.title);
        const trs = rep.tracks.filter((x) => x.section === sec.title);
        const who = isFav ? rep.favorable : isUnfav ? rep.unfavorable : [];
        return (
          <div key={si}>
            {sec.title && <div dangerouslySetInnerHTML={{ __html: mdPreview(`${'#'.repeat(sec.level)} ${sec.title}`) }} />}
            {who.length > 0 && (
              <div style={{ margin: '6px 0 10px' }}>
                {who.map((it, k) => (
                  <div key={k} style={{ ...V.whoRow, borderLeftColor: isFav ? '#2dd4bf' : '#f87171', background: isFav ? 'rgba(45,212,191,0.08)' : 'rgba(248,113,113,0.08)' }}>
                    <div style={{ ...V.whoName, color: isFav ? '#2dd4bf' : '#f87171' }}>{it.who}</div>
                    <div style={V.whoWhy}>{it.why}</div>
                  </div>
                ))}
              </div>
            )}
            {trs.length > 0 && (
              <div style={{ margin: '6px 0 10px' }}>
                <div style={V.smallHead}>전형별 적합도</div>
                {trs.map((t, k) => { const i = many ? whoIdx(t.who) : 0; const color = colorOf(i); return (
                  <div key={k} style={V.trackRow}>
                    {many && <div style={{ ...V.trackWho, color }}>{t.who || names[i]}</div>}
                    {t.scores.slice(0, 3).map((sc, j) => (
                      <div key={j} style={V.trackCell}><span style={V.trackLabel}>{sc.who}</span><span style={V.trackBar}><span style={{ ...V.trackFill, width: `${sc.score / 5 * 100}%`, background: color }} /></span><span style={V.trackScore}>{sc.score}/5</span></div>
                    ))}
                  </div>
                ); })}
              </div>
            )}
            <div dangerouslySetInnerHTML={{ __html: mdPreview(prose) }} />
            {inds.length > 0 && (
              <div style={V.scorecard}>
                {many && <div style={{ ...V.scoreRow, fontSize: 11 }}><span /> {names.map((n, i) => <span key={i} style={{ color: colorOf(i), fontWeight: 700 }}>{n}</span>)}<span /></div>}
                {inds.map((ind, k) => (
                  <div key={k} style={{ ...V.scoreRow, gridTemplateColumns: `110px repeat(${names.length}, 96px) minmax(0, 1fr)` }}>
                    <span style={V.scoreLabel}>{ind.label}</span>
                    {names.map((n, i) => { const sc = many ? ind.scores.find((x) => x.who && (n.includes(x.who) || x.who.includes(n))) || ind.scores[i] : ind.scores[0]; return <span key={i}>{sc ? <Dots score={sc.score} color={colorOf(i)} /> : '—'}</span>; })}
                    <span style={V.scoreNote}>{ind.note}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
const V = {
  wrap: { marginBottom: 14 },
  cards: { display: 'grid', gap: 8, marginBottom: 12 },
  card: { background: 'var(--surface2)', border: '1px solid var(--border)', borderLeft: '4px solid', borderRadius: 10, padding: '10px 12px', minWidth: 0 },
  cardName: { fontSize: 15, fontWeight: 800, color: 'var(--text)' },
  cardChips: { fontSize: 11, color: 'var(--text3)', marginBottom: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  statRow: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 },
  statLabel: { fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  statVal: { fontSize: 17, fontWeight: 800, lineHeight: 1.3 },
  chartHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, fontWeight: 700, color: 'var(--text)', margin: '6px 0 6px' },
  legend: { display: 'flex', gap: 10, fontSize: 10, color: 'var(--text3)', fontWeight: 400 },
  sw: { display: 'inline-block', width: 9, height: 9, borderRadius: 2, marginRight: 3, verticalAlign: -1 },
  gradeBlock: { marginBottom: 6 },
  gradeLabel: { fontSize: 11, fontWeight: 800, color: 'var(--accent)', borderBottom: '1px solid var(--border)', padding: '2px 0', marginBottom: 4 },
  famBlock: { marginBottom: 5 },
  barRow: { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) 190px', gap: 6, alignItems: 'center', marginBottom: 3 },
  barLabel: { fontSize: 12, fontWeight: 700, color: 'var(--text)' },
  bar: { display: 'flex', height: 14, borderRadius: 3, overflow: 'hidden', background: 'var(--surface2)' },
  seg: { fontSize: 9, color: '#0b1220', fontWeight: 700, paddingLeft: 3, lineHeight: '14px', overflow: 'hidden', whiteSpace: 'nowrap' },
  barMeta: { fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  note: { fontSize: 10.5, color: 'var(--text3)', marginTop: 6 },
  trend: { width: '100%', borderCollapse: 'separate', borderSpacing: 2, fontSize: 11.5 },
  trendTh: { background: 'var(--surface2)', color: 'var(--accent)', fontWeight: 800, padding: '4px 6px', borderRadius: 4, fontSize: 11 },
  trendTd: { padding: '5px 6px', borderRadius: 4, color: 'var(--text)' },
  scorecard: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', margin: '8px 0 12px' },
  scoreRow: { display: 'grid', gridTemplateColumns: '110px 96px minmax(0, 1fr)', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--border)' },
  scoreLabel: { fontSize: 12.5, fontWeight: 700, color: 'var(--text)' },
  scoreNote: { fontSize: 11, color: 'var(--text3)' },
  whoRow: { display: 'grid', gridTemplateColumns: '220px minmax(0, 1fr)', gap: 10, padding: '7px 10px', borderLeft: '3px solid', borderRadius: 6, marginBottom: 4 },
  whoName: { fontSize: 12.5, fontWeight: 800 },
  whoWhy: { fontSize: 12.5, color: 'var(--text)' },
  smallHead: { fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 4 },
  trackRow: { display: 'flex', gap: 14, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' },
  trackWho: { width: 56, fontSize: 12, fontWeight: 800 },
  trackCell: { display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 180px' },
  trackLabel: { fontSize: 11, width: 62, color: 'var(--text)' },
  trackBar: { flex: 1, height: 9, borderRadius: 5, background: 'var(--surface2)', overflow: 'hidden', display: 'block' },
  trackFill: { display: 'block', height: '100%', borderRadius: 5 },
  trackScore: { fontSize: 10.5, color: 'var(--text3)', width: 26 },
};

export async function explainSchools({ kind, schools, focus, apiKey, aiGroup, selectedModel }) {
  if (!apiKey) throw new Error('AI API 키가 없습니다 — 설정에서 키를 넣어 주세요');
  const d = await postForResult(`${API_BASE}/api/schoolinfo/explain`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', 'x-api-key': apiKey, 'x-ai-model': aiGroup || 'claude', 'x-ai-submodel': selectedModel || 'claude' },
    body: JSON.stringify({ kind, focus, schools: schools.map(pickSchool) }),
  });
  if (!d.success) throw new Error(d.message || '해설 생성 실패');
  return {
    id: null, kind: d.kind, title: d.title, content: d.content, focus: focus || '', data: d.data || null,
    schoolIds: schools.map((s) => s.id), schoolNames: schools.map((s) => s.schoolName).join(', '), snapshot: d.snapshot || {},
  };
}

async function download(report, format) {
  const res = await fetch(`${API_BASE}/api/school-reports/export`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: report.title, markdown: report.content, format, schoolNames: report.schoolNames, kind: report.kind, data: report.data || null }),
  });
  if (!res.ok) { let m = `HTTP ${res.status}`; try { m = (await res.json()).message || m; } catch { /* 본문 없음 */ } throw new Error(m); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${report.title}.${format}`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── 편집기 ──
export function ReportEditor({ report: initial, onClose, onSaved, onDeleted, onAuthError }) {
  const [r, setR] = useState(initial);
  const [dirty, setDirty] = useState(!initial.id); // 새로 만든 건 아직 저장 전
  const [mode, setMode] = useState('preview');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [sendOpen, setSendOpen] = useState(false);
  const [sendCfg, setSendCfg] = useState(null); // { enabled, target } — 나만의 패파 연동 열쇠가 서버에 있는지
  useEffect(() => { setR(initial); setDirty(!initial.id); }, [initial]);
  useEffect(() => { api('/api/school-reports/send-config').then((d) => setSendCfg(d.success ? d : { enabled: false })).catch(() => setSendCfg({ enabled: false })); }, []);

  const edit = (patch) => { setR((x) => ({ ...x, ...patch })); setDirty(true); };
  const fail = (e) => { if (e.auth) onAuthError?.(); setMsg(e.message); };
  // 저장 — 성공하면 저장된 보고서를 돌려준다(보내기 전 자동 저장에서 씀), 실패면 null
  const save = async () => {
    setBusy('save'); setMsg('');
    try {
      const d = r.id
        ? await api(`/api/school-reports/${r.id}`, { method: 'PATCH', body: { title: r.title, content: r.content, focus: r.focus } })
        : await api('/api/school-reports', { method: 'POST', body: { kind: r.kind, title: r.title, content: r.content, focus: r.focus, schoolIds: r.schoolIds, schoolNames: r.schoolNames, snapshot: r.snapshot } });
      if (!d.success) throw new Error(d.message || '저장 실패');
      const saved = { ...r, id: d.item.id, updatedAt: d.item.updated_at };
      setR(saved); setDirty(false); setMsg('저장했습니다'); onSaved?.(saved);
      return saved;
    } catch (e) { fail(e); return null; } finally { setBusy(''); }
  };
  // 학부모에게 보내기 — 저장 전이면 먼저 저장한다(버튼이 잠겨 있어 눌러도 반응이 없던 문제, 원장 제보 2026-09-20)
  const openSend = async () => {
    if (dirty || !r.id) { const saved = await save(); if (!saved) return; }
    setSendOpen(true);
  };
  const remove = async () => {
    if (!window.confirm('이 보고서를 삭제할까요? 되돌릴 수 없습니다.')) return;
    setBusy('delete');
    try {
      if (r.id) { const d = await api(`/api/school-reports/${r.id}`, { method: 'DELETE' }); if (!d.success) throw new Error(d.message || '삭제 실패'); }
      onDeleted?.(r); onClose();
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const dl = async (format) => { setBusy(format); setMsg(''); try { await download(r, format); } catch (e) { fail(e); } finally { setBusy(''); } };
  const close = () => { if (dirty && !window.confirm('저장하지 않은 수정이 있습니다. 닫을까요?')) return; onClose(); };

  return (
    <div style={S.overlay} onClick={close}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input style={S.titleInput} value={r.title} onChange={(e) => edit({ title: e.target.value })} placeholder="보고서 제목" />
            <div style={S.sub}>
              {r.kind === 'compare' ? '비교 해설' : '학교 해설'} · {r.schoolNames}{r.focus ? ` · 학생 상황: ${r.focus}` : ''}
              {r.id ? ` · 저장됨 #${r.id}` : ' · 아직 저장 전'}{dirty ? ' · 수정됨' : ''}
            </div>
          </div>
          <button style={S.btn} onClick={close}>닫기 ✕</button>
        </div>

        <div style={S.toolbar}>
          <div style={S.seg}>
            {[['preview', '미리보기'], ['edit', '수정']].map(([k, l]) => (
              <button key={k} style={{ ...S.segBtn, ...(mode === k ? S.segOn : {}) }} onClick={() => setMode(k)}>{l}</button>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          <button style={{ ...S.btn, ...S.primary }} disabled={!!busy || !dirty} onClick={save}>{busy === 'save' ? '저장 중…' : r.id ? '변경 저장' : '보관함에 저장'}</button>
          <button style={S.btn} disabled={!!busy} onClick={() => dl('docx')}>{busy === 'docx' ? '만드는 중…' : 'Word 다운로드'}</button>
          <button style={S.btn} disabled={!!busy} onClick={() => dl('pdf')}>{busy === 'pdf' ? '만드는 중…' : 'PDF 다운로드'}</button>
          <button style={S.btn} disabled={!!busy} onClick={openSend} title="저장 전이면 먼저 저장한 뒤 보냅니다">
            📨 학부모에게 보내기{r.sent?.length ? ` (${r.sent.length})` : ''}
          </button>
          <button style={{ ...S.btn, ...S.danger }} disabled={!!busy} onClick={remove}>{r.id ? '삭제' : '버리기'}</button>
        </div>
        {msg && <div style={S.msg}>{msg}</div>}

        {mode === 'edit' ? (
          <textarea style={S.textarea} value={r.content} onChange={(e) => edit({ content: e.target.value })} spellCheck={false} />
        ) : (
          <div style={S.preview}>
            {r.data && <ReportVisual data={r.data} />}
            {r.data ? <StructuredBody content={r.content} data={r.data} /> : <div dangerouslySetInnerHTML={{ __html: mdPreview(r.content) }} />}
          </div>
        )}
        {r.sent?.length > 0 && (
          <div style={S.sentLog}>
            보낸 기록: {r.sent.map((x, i) => <span key={i} style={S.sentChip}>{x.studentName} · {AUD_LABEL[x.audience] || x.audience} · {new Date(x.at).toLocaleDateString('ko-KR')}</span>)}
          </div>
        )}
        <p style={S.hint}>
          수정 탭에서 문단을 고치거나 지울 수 있습니다(마크다운: ## 제목, - 목록, | 표 |). 다운로드는 지금 화면의 내용을 그대로 담습니다 —
          보관함에 저장해 두면 나중에 다시 열어 고치거나 내려받을 수 있습니다. 학부모에게 보내면 나만의 패파(academy-video)의 그 학생 성장 리포트에 문서로 들어가고 알림이 갑니다.
        </p>
        {sendOpen && <SendDialog report={r} cfg={sendCfg} onClose={() => setSendOpen(false)} onAuthError={onAuthError}
          onSent={(sent) => { setR((x) => ({ ...x, sent: sent || x.sent })); setMsg('학부모에게 보냈습니다'); setSendOpen(false); }} />}
      </div>
    </div>
  );
}

const AUD_LABEL = { parent: '학부모', student: '학생', both: '학생+학부모' };

// ── 학부모에게 보내기 — 나만의 패파(academy-video) 성장 리포트로 발행 ──
function SendDialog({ report, cfg, onClose, onSent, onAuthError }) {
  const [studentName, setStudentName] = useState(() => (report.focus || '').match(/^[가-힣]{2,4}(?=[\s,(·])/)?.[0] || '');
  const [audience, setAudience] = useState('parent');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr('');
    try {
      const d = await api('/api/school-reports/send', { method: 'POST', body: { reportId: report.id, title: report.title, markdown: report.content, data: report.data || null, studentName, audience, memo } });
      if (!d.success) throw new Error(d.message || '전송 실패');
      onSent(d.sent);
    } catch (e) { if (e.auth) onAuthError?.(); setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div style={{ ...S.overlay, zIndex: 1200 }} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <h3 style={S.h3}>📨 학부모에게 보내기</h3>
            <div style={S.sub}>나만의 패파의 학생 이름으로 찾아 그 아이의 성장 리포트에 넣고, 알림톡·푸시로 알립니다. 학부모는 나만의 패파에 로그인해서 봅니다.</div>
          </div>
          <button style={S.btn} onClick={onClose}>✕</button>
        </div>
        {cfg && !cfg.enabled && <div style={S.warn}>서버에 나만의 패파 연동 열쇠가 없습니다. 나만의 패파 선생님 대시보드 → 연동 열쇠를 복사해 Railway 환경변수 <code style={S.code}>ACADEMY_VIDEO_INBOUND_KEY</code> 에 넣어 주세요.</div>}
        <label style={S.label}>학생 이름 (나만의 패파에 등록된 이름 그대로)</label>
        <input style={S.search} value={studentName} onChange={(e) => setStudentName(e.target.value)} placeholder="예: 김민준" autoFocus />
        <label style={S.label}>누가 보나요</label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['parent', 'both', 'student'].map((k) => <button key={k} style={{ ...S.btn, ...(audience === k ? S.primary : {}) }} onClick={() => setAudience(k)}>{AUD_LABEL[k]}</button>)}
        </div>
        <label style={S.label}>한 줄 메모 (알림에 함께 나갑니다, 선택)</label>
        <input style={S.search} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 상담 때 말씀드린 두 학교 비교입니다. 읽어 보시고 궁금한 점 연락 주세요." />
        <div style={S.sub}>보내는 문서: <b>{report.title}</b>{report.data ? ' (수치 차트 포함)' : ''}</div>
        {err && <div style={{ ...S.msg, color: '#f87171', marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button style={S.btn} onClick={onClose}>취소</button>
          <button style={{ ...S.btn, ...S.primary }} disabled={busy || !studentName.trim() || (cfg && !cfg.enabled)} onClick={send}>{busy ? '보내는 중…' : '보내기'}</button>
        </div>
      </div>
    </div>
  );
}

// ── 보관함 ──
export function SavedReports({ onOpen, onClose, onAuthError, refreshKey }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const load = async () => {
    try {
      const d = await api(`/api/school-reports${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      if (!d.success) throw new Error(d.message || '목록 로드 실패');
      setItems(d.items || []); setMsg('');
    } catch (e) { if (e.auth) onAuthError?.(); setMsg(e.message); setItems([]); }
  };
  useEffect(() => { load(); }, [q, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = async (it) => {
    try {
      const d = await api(`/api/school-reports/${it.id}`);
      if (!d.success) throw new Error(d.message || '열기 실패');
      const x = d.item;
      onOpen({ id: x.id, kind: x.kind, title: x.title, content: x.content, focus: x.focus, schoolIds: x.school_ids || [], schoolNames: x.school_names, snapshot: x.snapshot || {}, data: x.snapshot?.data || null, sent: x.sent || [], updatedAt: x.updated_at });
    } catch (e) { if (e.auth) onAuthError?.(); setMsg(e.message); }
  };
  const remove = async (it) => {
    if (!window.confirm(`"${it.title}" 을(를) 삭제할까요?`)) return;
    try { const d = await api(`/api/school-reports/${it.id}`, { method: 'DELETE' }); if (!d.success) throw new Error(d.message); load(); }
    catch (e) { if (e.auth) onAuthError?.(); setMsg(e.message); }
  };
  const when = (s) => (s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.modal, maxWidth: 760 }} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <h3 style={S.h3}>📚 저장된 입시 해설 보고서</h3>
            <div style={S.sub}>학교 해설·비교 해설을 보관합니다. 열어서 고치고 Word·PDF 로 내려받을 수 있습니다.</div>
          </div>
          <button style={S.btn} onClick={onClose}>닫기 ✕</button>
        </div>
        <input style={S.search} placeholder="제목·학교명 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        {msg && <div style={S.msg}>{msg}</div>}
        {items === null ? <p style={S.hint}>불러오는 중…</p> : !items.length ? (
          <p style={S.hint}>저장된 보고서가 없습니다. 학교 상세나 비교 화면에서 "입시 해설 생성" 후 저장해 보세요.</p>
        ) : (
          <div style={S.list}>
            {items.map((it) => (
              <div key={it.id} style={S.row}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={S.rowTitle}>{it.kind === 'compare' ? '⚖️' : '🏫'} {it.title}</div>
                  <div style={S.sub}>{it.school_names}{it.focus ? ` · ${it.focus}` : ''} · {when(it.updated_at)}</div>
                </div>
                <button style={S.btn} onClick={() => open(it)}>열기</button>
                <button style={{ ...S.btn, ...S.danger }} onClick={() => remove(it)}>삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 상세·비교 모달 안에 놓는 '해설 생성' 상자 ──
export function ExplainBox({ label, onExplain, busy, hasKey }) {
  const [focus, setFocus] = useState('');
  return (
    <section style={S.box}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={S.boxTitle}>🧭 {label}</div>
          <div style={S.sub}>공시 수치를 입시·진학 관점에서 해설하고 어떤 학생에게 유리·불리한지 정리합니다. 결과는 고쳐서 저장하고 Word·PDF 로 내려받을 수 있습니다.</div>
        </div>
        <button style={{ ...S.btn, ...S.primary }} disabled={!!busy || !hasKey} onClick={() => onExplain(focus)} title={hasKey ? '' : '설정에서 AI API 키를 먼저 넣어 주세요'}>
          {busy || '입시 해설 생성'}
        </button>
      </div>
      <input style={{ ...S.search, marginTop: 8, marginBottom: 0 }} value={focus} onChange={(e) => setFocus(e.target.value)}
        placeholder="(선택) 상담 학생 상황 — 예: 중3, 내신 상위 5%, 의대 목표, 수학 강점·국어 약점" />
    </section>
  );
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' },
  modal: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 980, boxShadow: 'var(--shadow-md)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  h3: { fontSize: 18, fontWeight: 800, margin: 0, color: 'var(--text)' },
  titleInput: { width: '100%', fontSize: 17, fontWeight: 800, background: 'transparent', color: 'var(--text)', border: 'none', borderBottom: '1px dashed var(--border)', padding: '4px 0', outline: 'none' },
  sub: { fontSize: 12, color: 'var(--text3)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' },
  toolbar: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
  seg: { display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  segBtn: { background: 'var(--surface2)', color: 'var(--text)', border: 'none', padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  segOn: { background: 'var(--accent-bg)', color: 'var(--accent)' },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 700 },
  primary: { background: 'var(--accent)', color: '#0b1220', borderColor: 'var(--accent)' },
  danger: { color: '#f87171', borderColor: 'rgba(248,113,113,0.5)' },
  msg: { fontSize: 12, color: 'var(--accent)', margin: '0 0 8px' },
  textarea: { width: '100%', minHeight: 520, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical', boxSizing: 'border-box' },
  preview: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px 14px', fontSize: 13.5, lineHeight: 1.65, color: 'var(--text)' },
  hint: { fontSize: 12, color: 'var(--text3)', marginTop: 10 },
  search: { width: '100%', boxSizing: 'border-box', background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 10 },
  list: { display: 'flex', flexDirection: 'column', gap: 6 },
  row: { display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' },
  rowTitle: { fontSize: 14, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  box: { marginTop: 18, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)' },
  label: { display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text)', margin: '8px 0 4px' },
  warn: { fontSize: 12, color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.4)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 },
  code: { fontSize: 11.5, padding: '1px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.08)' },
  sentLog: { fontSize: 12, color: 'var(--text3)', marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  sentChip: { fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'var(--surface2)', border: '1px solid var(--border)', color: 'var(--text)' },
  boxTitle: { fontSize: 14, fontWeight: 800, color: 'var(--text)' },
};
