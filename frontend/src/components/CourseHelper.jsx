import { useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../apiBase';
import { fetchGzJson } from '../schoolCatalog';
import { resolve, AFTER, KIND_COLOR, SEMESTERS } from '../course/curriculum';
import { Term } from '../schoolTerms';
import StudentPicker from './StudentPicker';

// 🧭 과목 선택 보조(고1) — 목표 대학·모집단위의 2028 권장과목(핵심·권장)을 모아 2·3학년 이수 계획을 짠다.
// 데이터: /data/recommended-2028.json.gz (원장 지식베이스의 대교협 자료집 기반 정리 엑셀 → scripts/recommended/parse.py)
// 점검: 핵심과목 빠짐 · 먼저 들을 과목(위계) · 석차등급 없는 과목(융합선택 사회·과학 등). 학교 편제(개설 여부)는 편제 데이터가 들어오면 붙인다.

const DATA_URL = '/data/recommended-2028.json.gz';
const PLACES = [...SEMESTERS, '학교지정', '공동교육과정'];
const PLACE_LABEL = { '2-1': '2학년 1학기', '2-2': '2학년 2학기', '3-1': '3학년 1학기', '3-2': '3학년 2학기', 학교지정: '학교지정(자동 이수)', 공동교육과정: '공동교육과정·온라인' };
const ORDER = { '2-1': 1, '2-2': 2, '3-1': 3, '3-2': 4, 학교지정: 0 };
const PLAN_KEY = 'ef_course_plan';

export default function CourseHelper({ onAuthError }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [targets, setTargets] = useState(() => { try { return JSON.parse(localStorage.getItem(PLAN_KEY))?.targets || []; } catch { return []; } });
  const [plan, setPlan] = useState(() => { try { return JSON.parse(localStorage.getItem(PLAN_KEY))?.plan || {}; } catch { return {}; } });
  const [univ, setUniv] = useState('');
  const [unitQ, setUnitQ] = useState('');
  const [student, setStudent] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => { fetchGzJson(DATA_URL).then(setData).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { try { localStorage.setItem(PLAN_KEY, JSON.stringify({ targets, plan })); } catch { /* 저장소 막힘 */ } }, [targets, plan]);

  const univObj = data?.univs.find((u) => u.name === univ);
  const units = useMemo(() => (univObj?.units || []).filter((x) => !unitQ.trim() || x.name.includes(unitQ.trim())), [univObj, unitQ]);
  const addTarget = (u, x) => { if (targets.length >= 3 || targets.some((t) => t.univ === u.name && t.unit === x.name)) return; setTargets([...targets, { univ: u.name, unit: x.name, core: x.core, rec: x.rec, note: x.note }]); };

  // 목표들의 과목 합치기 — 과목마다 어느 목표에서 핵심/권장인지
  const merged = useMemo(() => {
    const m = new Map(); const areas = [];
    targets.forEach((t, ti) => {
      for (const [kind, list] of [['core', t.core.items], ['rec', t.rec.items]]) {
        for (const tok of list) {
          const r = resolve(tok);
          if (!r.subject) { areas.push({ ...r, kind, ti }); continue; }
          const cur = m.get(r.name) || { ...r, core: [], rec: [] };
          cur[kind].push(ti); m.set(r.name, cur);
        }
      }
    });
    // 위계상 먼저 들을 과목도 계획 줄로 넣는다(권장과목이 아니어도) — 순서 점검이 되게
    for (const x of [...m.values()]) for (const p of AFTER[x.name] || []) if (!m.has(p)) { const r = resolve(p); if (r.subject) m.set(p, { ...r, core: [], rec: [], pre: true }); }
    const list = [...m.values()].filter((x) => x.subject.kind !== '공통');
    list.sort((a, b) => (b.core.length - a.core.length) || (b.core.length + b.rec.length - a.core.length - a.rec.length) || a.subject.area.localeCompare(b.subject.area, 'ko'));
    return { list, areas };
  }, [targets]);

  // 점검
  const checks = useMemo(() => {
    const out = [];
    for (const x of merged.list) {
      const at = plan[x.name];
      if (x.core.length && !at) out.push({ lv: 'warn', text: `핵심과목 ‘${x.name}’이(가) 아직 계획에 없습니다.` });
      const pre = AFTER[x.name];
      if (at && pre && at !== '공동교육과정') {
        for (const p of pre) {
          const pa = plan[p];
          if (!pa) out.push({ lv: 'info', text: `‘${x.name}’은(는) 보통 ‘${p}’을(를) 먼저 듣습니다 — ${p}도 계획에 넣을지 확인하세요.` });
          else if (ORDER[pa] !== undefined && ORDER[at] !== undefined && ORDER[pa] > ORDER[at]) out.push({ lv: 'warn', text: `‘${p}’(${PLACE_LABEL[pa]})이 ‘${x.name}’(${PLACE_LABEL[at]})보다 늦습니다.` });
        }
      }
      if (at && x.subject.grading === 'abs') out.push({ lv: 'info', text: `‘${x.name}’은(는) 석차등급 없이 성취도(A~E)만 기록됩니다.` });
    }
    return out;
  }, [merged, plan]);
  const perSem = SEMESTERS.map((s) => ({ s, n: Object.values(plan).filter((v) => v === s).length }));

  const markdown = () => [
    `# 2·3학년 과목 이수 계획${student ? ` — ${student.name}` : ''}`,
    '', `목표: ${targets.map((t) => `${t.univ} ${t.unit}`).join(' / ') || '(없음)'}`,
    '', '| 과목 | 구분 | 목표에서 | 계획 |', '|---|---|---|---|',
    ...merged.list.map((x) => `| ${x.name} | ${x.subject.area} ${x.subject.kind}${x.subject.grading === 'abs' ? ' (성취도만)' : ''} | ${x.core.length ? '핵심' : '권장'} | ${PLACE_LABEL[plan[x.name]] || '—'} |`),
    '', ...(checks.length ? ['## 점검', ...checks.map((c) => `- ${c.lv === 'warn' ? '⚠' : 'ℹ'} ${c.text}`)] : []),
    '', `※ ${data?.source || ''}. 권장과목은 지원 자격이 아니라 평가 참고 자료이며, 학교 편제·수요조사에 따라 개설 과목이 달라질 수 있습니다.`,
  ].join('\n');
  const saveToStudent = async () => {
    if (!student) return;
    try {
      const res = await fetch(`${API_BASE}/api/board/students/${student.id}/records`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('ef_token')}` }, body: JSON.stringify({ type: '과목계획', title: `과목 이수 계획 (${targets.map((t) => t.univ).join('·') || '목표 없음'})`, content: markdown() }) });
      if (res.status === 401) { onAuthError?.(); return; }
      const j = await res.json(); if (!j.success) throw new Error(j.message || '저장 실패');
      setMsg(`${student.name} 학생 기록에 저장했습니다.`);
    } catch (e) { setErr(e.message); }
  };

  if (!data) return <div style={S.page}><h2 style={S.h2}>🧭 과목 선택 보조</h2><p style={S.lead}>{err || '권장과목 자료를 불러오는 중…'}</p></div>;
  return (
    <div style={S.page}>
      <h2 style={S.h2}>🧭 과목 선택 보조 (고1)</h2>
      <p style={S.lead}>목표 대학·모집단위(최대 3곳)의 2028 <Term k="권장과목" />을 모아 2·3학년 이수 계획을 짭니다. 핵심과목이 빠졌는지, 먼저 들을 과목 순서가 맞는지, 석차등급 없는 과목(<Term k="융합선택" />)인지 짚어 줍니다.
        <br /><span style={S.dim}>출처: {data.source} · {data.univs.length}개 대학. 권장과목은 지원 자격이 아니라 평가 참고 자료입니다. 우리 학교에 없는 과목은 <Term k="공동교육과정" />으로 채울 수 있습니다.</span></p>
      {err && <div style={S.err} onClick={() => setErr('')}>{err}</div>}
      {msg && <div style={S.ok} onClick={() => setMsg('')}>{msg}</div>}

      <div style={S.layout}>
        <section style={S.card}>
          <div style={S.secTitle}>목표 고르기 ({targets.length}/3)</div>
          <select style={{ ...S.input, width: '100%' }} value={univ} onChange={(e) => { setUniv(e.target.value); setUnitQ(''); }}>
            <option value="">대학 선택</option>
            {data.univs.map((u) => <option key={u.name} value={u.name}>{u.name} ({u.units.length})</option>)}
          </select>
          {univObj && <>
            <input style={{ ...S.input, width: '100%', marginTop: 6 }} placeholder="모집단위 찾기 (예: 전기, 의예, 경영)" value={unitQ} onChange={(e) => setUnitQ(e.target.value)} />
            <div style={S.unitList}>
              {units.map((x) => (
                <button key={x.name} style={S.unitBtn} onClick={() => addTarget(univObj, x)} disabled={targets.length >= 3}>
                  <b>{x.name}</b>
                  <span style={S.dim}>{x.core.items.length ? `핵심 ${x.core.items.length}` : ''}{x.core.items.length && x.rec.items.length ? ' · ' : ''}{x.rec.items.length ? `권장 ${x.rec.items.length}` : ''}{!x.core.items.length && !x.rec.items.length ? (x.core.raw || x.rec.raw || '과목 제시 없음').slice(0, 30) : ''}</span>
                </button>
              ))}
            </div>
          </>}
          <div style={{ borderTop: '1px solid var(--border)', margin: '10px 0', paddingTop: 8 }}>
            <div style={S.secTitle}>학생</div>
            <StudentPicker value={student} onChange={setStudent} placeholder="학생 선택 안 함 (저장하려면 선택)" />
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button style={S.btn} onClick={() => navigator.clipboard?.writeText(markdown()).then(() => setMsg('계획을 복사했습니다.'))} disabled={!targets.length}>📋 계획 복사</button>
              <button style={{ ...S.btn, ...S.primary }} onClick={saveToStudent} disabled={!student || !targets.length}>💾 학생 기록에 저장</button>
              <button style={S.btn} onClick={() => { if (confirm('목표와 계획을 모두 지울까요?')) { setTargets([]); setPlan({}); } }}>비우기</button>
            </div>
          </div>
        </section>

        <div style={{ flex: 1, minWidth: 380 }}>
          {targets.map((t, ti) => (
            <section key={`${t.univ}|${t.unit}`} style={S.card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={S.secTitle}>목표 {ti + 1}. {t.univ} · {t.unit}</div>
                <button style={S.x} onClick={() => setTargets(targets.filter((_, i) => i !== ti))}>×</button>
              </div>
              <Row label="핵심과목" raw={t.core.raw} items={t.core.items} strong />
              <Row label="권장과목" raw={t.rec.raw} items={t.rec.items} />
              {t.note && <div style={S.note}>비고: {t.note}</div>}
            </section>
          ))}
          {!targets.length && <div style={S.empty}>왼쪽에서 대학을 고르고 모집단위를 누르면 목표로 들어갑니다(최대 3곳).</div>}

          {merged.list.length > 0 && (
            <section style={S.card}>
              <div style={S.secTitle}>이수 계획 — 과목마다 들을 학기를 고르세요</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                {perSem.map(({ s, n }) => <span key={s} style={S.semBadge}>{PLACE_LABEL[s]} {n}과목</span>)}
              </div>
              <table style={S.table}>
                <thead><tr><th style={S.th}>과목</th><th style={S.th}>구분</th><th style={S.th}>목표에서</th><th style={S.th}>먼저 들을 과목</th><th style={S.th}>계획</th></tr></thead>
                <tbody>
                  {merged.list.map((x) => (
                    <tr key={x.name}>
                      <td style={S.td}><b>{x.name}</b></td>
                      <td style={S.td}><span style={{ ...S.kind, background: KIND_COLOR[x.subject.kind] }}>{x.subject.area} {x.subject.kind}</span>{x.subject.grading === 'abs' && <span style={S.abs}>성취도만</span>}</td>
                      <td style={S.td}>{x.core.length ? <span style={S.core}>핵심 {x.core.map((i) => i + 1).join('·')}</span> : null} {x.rec.length ? <span style={S.dim}>권장 {x.rec.map((i) => i + 1).join('·')}</span> : null}{x.pre ? <span style={S.dim}>먼저 들을 과목</span> : null}</td>
                      <td style={S.td}><span style={S.dim}>{(AFTER[x.name] || []).join(', ') || '—'}</span></td>
                      <td style={S.td}>
                        <select style={S.input} value={plan[x.name] || ''} onChange={(e) => setPlan({ ...plan, [x.name]: e.target.value || undefined })}>
                          <option value="">— 안 정함</option>
                          {PLACES.map((p) => <option key={p} value={p}>{PLACE_LABEL[p]}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {merged.areas.length > 0 && <div style={S.note}>교과 단위로 제시된 것(과목 지정 없음): {[...new Set(merged.areas.map((a) => `${a.token} (목표 ${a.ti + 1})`))].join(', ')}</div>}
            </section>
          )}

          {checks.length > 0 && (
            <section style={S.card}>
              <div style={S.secTitle}>점검 ({checks.filter((c) => c.lv === 'warn').length}개 확인 필요)</div>
              {checks.map((c, i) => <div key={i} style={{ fontSize: 13, color: c.lv === 'warn' ? '#d6a24a' : 'var(--text2)', margin: '3px 0' }}>{c.lv === 'warn' ? '⚠ ' : 'ℹ '}{c.text}</div>)}
            </section>
          )}
          {targets.length > 0 && <div style={S.dim}>우리 학교에 그 과목이 열리는지(편제)는 학교별 편제 데이터를 모으는 중입니다. 들어오면 학교를 골라 ✓/✗ 와 같은 선택군 충돌까지 함께 보여 드립니다.</div>}
        </div>
      </div>
    </div>
  );
}

function Row({ label, raw, items, strong }) {
  if (!raw) return <div style={{ ...S.dim, margin: '4px 0' }}>{label}: 제시 없음</div>;
  return (
    <div style={{ margin: '6px 0' }}>
      <span style={{ ...S.lbl, color: strong ? '#e05b5b' : 'var(--text2)' }}>{label}</span>
      {items.length ? items.map((tok) => {
        const r = resolve(tok);
        return <span key={tok} style={{ ...S.chip, borderColor: r.subject ? KIND_COLOR[r.subject.kind] : 'var(--border)', color: r.subject ? 'var(--text)' : 'var(--text2)' }}>{r.name}{r.subject?.grading === 'abs' ? ' ·성취도만' : ''}</span>;
      }) : <span style={{ fontSize: 13, color: 'var(--text)' }}>{raw}</span>}
    </div>
  );
}

const S = {
  page: { padding: '24px 28px', maxWidth: 1400 },
  h2: { fontSize: 22, fontWeight: 800, margin: 0, color: 'var(--text)' },
  lead: { fontSize: 13, color: 'var(--text2)', margin: '6px 0 14px', lineHeight: 1.7, maxWidth: 1000 },
  layout: { display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, marginBottom: 12, flex: '0 0 auto' },
  secTitle: { fontSize: 14, fontWeight: 800, color: 'var(--text)', marginBottom: 8 },
  input: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  primary: { background: '#00b765', borderColor: '#00b765', color: '#fff' },
  unitList: { display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 360, overflow: 'auto', marginTop: 6, width: 300 },
  unitBtn: { textAlign: 'left', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', color: 'var(--text)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12.5 },
  lbl: { display: 'inline-block', width: 64, fontSize: 12, fontWeight: 800 },
  chip: { display: 'inline-block', fontSize: 12, border: '1.5px solid', borderRadius: 999, padding: '2px 9px', margin: '2px 4px 2px 0' },
  note: { fontSize: 12, color: 'var(--text2)', background: 'var(--surface2)', borderRadius: 8, padding: '6px 9px', marginTop: 6, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  dim: { fontSize: 11.5, color: 'var(--text3)' },
  x: { background: 'transparent', border: 'none', color: 'var(--text2)', cursor: 'pointer', fontSize: 16 },
  empty: { padding: 30, textAlign: 'center', color: 'var(--text2)', border: '1px dashed var(--border)', borderRadius: 12, marginBottom: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text2)', fontWeight: 700 },
  td: { padding: '6px 8px', borderBottom: '1px solid var(--border)', color: 'var(--text)', verticalAlign: 'middle' },
  kind: { display: 'inline-block', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '1px 7px' },
  abs: { display: 'inline-block', marginLeft: 4, fontSize: 10.5, color: '#0d9488', border: '1px solid #0d9488', borderRadius: 6, padding: '0 5px' },
  core: { fontSize: 11.5, fontWeight: 800, color: '#e05b5b' },
  semBadge: { fontSize: 12, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '3px 8px', color: 'var(--text)' },
  err: { background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#f87171', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 10, cursor: 'pointer' },
  ok: { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 10, cursor: 'pointer' },
};
