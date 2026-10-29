import { useState, useEffect } from 'react';
import { API_BASE } from '../apiBase';
import { univLabel, campusBadge, sortByCampus } from '../univName';

const token = () => localStorage.getItem('ef_token');
async function api(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token()}` } });
  // 401(세션 만료)만 로그아웃으로 이어진다. 403 은 '이 학원 코드에 안 열린 메뉴·관리자 전용' 이라 서버 메시지만 보여 준다 —
  // 403 까지 auth 로 보던 시절엔 잠긴 보관함에 저장이 막히는 순간 로그인 화면으로 튕겼다(원장 제보 2026-09-22).
  if (res.status === 401 || res.status === 403) { let m = res.status === 401 ? '로그인이 필요합니다' : '이 학원 코드에는 열려 있지 않은 기능입니다'; try { m = (await res.json()).message || m; } catch { /* 본문 없음 */ } const e = new Error(m); e.auth = res.status === 401; throw e; }
  return res.json();
}

function DataTable({ rows }) {
  if (!rows?.length) return null;
  return (
    <table style={S.table}>
      <tbody>
        {rows.map((cells, ri) => (
          <tr key={ri}>
            {cells.map((c, ci) => (
              <td key={ci} style={{ ...S.td, ...(ci === 0 ? S.tdHead : {}) }}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Section({ title, count, children }) {
  return (
    <section style={{ marginBottom: 26 }}>
      <h3 style={S.secTitle}>{title} {count != null && <span style={S.secCount}>({count})</span>}</h3>
      {children}
    </section>
  );
}

// 인서울 주요대 정리 자료(원장 지식베이스) — 학종 서류평가 요소·비율, 교과 5등급제 반영
const GUIDE_LABEL = { hakjong: '학종 서류평가 요소·비율', gyogwa: '학생부교과 5등급제 반영' };
const BIG3_COLOR = { 학업: '#3b82f6', 진로: '#00b765', 공동체: '#d6a24a' };

function RatioBar({ ratios }) {
  if (!ratios?.length) return null;
  const palette = ['#3b82f6', '#00b765', '#d6a24a', '#a855f7', '#ef4444'];
  return (
    <div style={S.bar}>
      {ratios.map((r, i) => (
        <div key={r.item} title={`${r.item} ${r.pct}%`} style={{ width: `${r.pct}%`, background: BIG3_COLOR[r.item.replace(/역량$/, '')] || palette[i % palette.length], ...S.barSeg }}>
          {r.pct >= 12 ? `${r.item.replace(/역량$/, '')} ${r.pct}` : r.pct}
        </div>
      ))}
    </div>
  );
}

function GuideSection({ g }) {
  const u = g.univ;
  return (
    <Section title={`${GUIDE_LABEL[g.kind] || g.title}${g.targetYear ? ` (${g.targetYear})` : ''}`} count={`전형 ${u.tracks?.length || 0}개`}>
      {(u.tracks || []).map((t, i) => (
        <div key={i} style={S.guideTrack}>
          <div style={{ fontWeight: 800, fontSize: 13.5 }}>{t.name}{t.unit && <span style={S.region}>{t.unit}</span>}</div>
          {g.kind === 'hakjong' ? (
            t.ratios?.length ? <><RatioBar ratios={t.ratios} /><div style={S.muted}>{t.ratioText}</div></>
              : <div style={S.muted}>{t.ratioText || '항목별 수치 비율을 밝히지 않음 — 대학이 글로 풀어 둔 평가 내용을 읽어야 합니다(0%·균등 분할로 계산하지 마세요).'}</div>
          ) : <DataTable rows={t.rows} />}
        </div>
      ))}
      {u.note && <div style={S.guideNote}>{u.note}</div>}
      <div style={S.source}>출처: {g.title}{g.author ? ` · ${g.author}` : ''}{g.asOf ? ` · ${g.asOf} 기준` : ''}</div>
    </Section>
  );
}

// 27개 대학 학종 서류평가 비교 — 학업·진로·공동체로 딱 나뉘는 전형은 막대, 나머지는 원문 표기
function HakjongCompare({ guide, onClose }) {
  const [only3, setOnly3] = useState(false);
  const rows = guide.univs.flatMap((u) => u.tracks.map((t) => ({ u, t }))).filter(({ t }) => !only3 || t.big3);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={S.univName}>📊 {guide.title}</h1>
        <button style={S.cmpBtn} onClick={onClose}>닫기</button>
      </div>
      <ul style={S.blockList}>{(guide.cautions || []).map((c, i) => <li key={i} style={{ marginBottom: 4 }}>{c}</li>)}</ul>
      <label style={{ fontSize: 12.5, color: 'var(--text2)' }}><input type="checkbox" checked={only3} onChange={(e) => setOnly3(e.target.checked)} /> 학업·진로·공동체 3역량으로 나뉘는 전형만</label>
      <table style={{ ...S.table, marginTop: 8 }}>
        <tbody>
          {rows.map(({ u, t }, i) => (
            <tr key={i}>
              <td style={{ ...S.td, ...S.tdHead, whiteSpace: 'nowrap' }}>{u.name.replace('대학교', '대')}{u.campus ? ` (${u.campus})` : ''}</td>
              <td style={S.td}>{t.name}{t.unit ? <span style={S.region}>{t.unit}</span> : null}</td>
              <td style={{ ...S.td, minWidth: 260 }}>{t.ratios?.length ? <RatioBar ratios={t.ratios} /> : <span style={S.muted}>{t.ratioText || '비율 미공개'}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {guide.checklist?.length > 0 && <Section title="우리 아이 학생부 점검표"><ul style={S.blockList}>{guide.checklist.map((c, i) => <li key={i} style={{ marginBottom: 4 }}>{c}</li>)}</ul></Section>}
      {guide.faq?.length > 0 && <Section title="학부모가 자주 묻는 질문">{guide.faq.map((f, i) => <div key={i} style={{ marginBottom: 10, fontSize: 13 }}><b>Q. {f.q}</b><div style={{ color: 'var(--text2)', marginTop: 3 }}>{f.a}</div></div>)}</Section>}
      <div style={S.source}>출처: {guide.title}{guide.author ? ` · ${guide.author}` : ''}{guide.asOf ? ` · ${guide.asOf} 기준` : ''}. 서류평가 안에서의 비중이며, 서류·면접 합산 비율과 다릅니다.</div>
    </div>
  );
}

// 교과 5등급제 반영 — 원문의 비교표(빠른 비교·등급별 점수·계산 예시)와 공통 주의점
function GyogwaCompare({ guide, onClose }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={S.univName}>📘 {guide.title}</h1>
        <button style={S.cmpBtn} onClick={onClose}>닫기</button>
      </div>
      {guide.scope && <p style={S.lead}>{guide.scope}{guide.targetYear ? ` (${guide.targetYear} 기준)` : ''}</p>}
      {(guide.compare || []).map((c, i) => (
        <Section key={i} title={c.title}>
          <DataTable rows={c.rows} />
          {c.note && <div style={S.muted}>{Array.isArray(c.note) ? c.note.join(' ') : c.note}</div>}
        </Section>
      ))}
      {guide.cautions?.length > 0 && <Section title="읽을 때 주의할 점"><ul style={S.blockList}>{guide.cautions.map((c, i) => <li key={i} style={{ marginBottom: 4 }}>{c}</li>)}</ul></Section>}
      <div style={S.source}>출처: {guide.title}{guide.author ? ` · ${guide.author}` : ''}{guide.asOf ? ` · ${guide.asOf} 기준` : ''}. 대학별 상세는 왼쪽에서 대학을 고르면 함께 나옵니다.</div>
    </div>
  );
}

export default function UnivInfo({ onAuthError }) {
  const [universities, setUniversities] = useState([]);
  const [meta, setMeta] = useState(null);
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState('');
  const [guides, setGuides] = useState([]);
  const [compare, setCompare] = useState(false);

  useEffect(() => {
    api('/api/univ-info/list')
      .then((j) => {
        if (!j.success) throw new Error(j.error || '목록 로드 실패');
        setUniversities(j.universities || []);
        setMeta({ source: j.source, years: j.years, count: j.count });
      })
      .catch((e) => { if (e.auth) onAuthError?.(); else setError(e.message); })
      .finally(() => setLoadingList(false));
    api('/api/univ-info/guides').then((j) => j.success && setGuides(j.guides || [])).catch(() => {});
  }, []);
  const hakjongGuide = guides.find((g) => g.kind === 'hakjong');
  const gyogwaGuide = guides.find((g) => g.kind === 'gyogwa');

  function openUniv(u) {
    setCompare(false); setSelected(u); setDetail(null); setLoadingDetail(true); setError('');
    api(`/api/univ-info/${u.unvCd}`)
      .then((j) => { if (!j.success) throw new Error(j.error); setDetail(j); })
      .catch((e) => { if (e.auth) onAuthError?.(); else setError(e.message); })
      .finally(() => setLoadingDetail(false));
  }

  const nfc = (s) => (s || '').normalize('NFC');
  // 같은 대학의 본캠·지역캠(분교·제N캠퍼스)이 목록에서 흩어지지 않게 붙여 두고 본캠을 먼저 놓는다.
  const filtered = sortByCampus(q.trim()
    ? universities.filter((u) => nfc(u.name).includes(nfc(q)) || nfc(u.region).includes(nfc(q)))
    : universities);

  return (
    <div style={S.page}>
      <h2 style={S.h2}>🏫 대학별 입시정보</h2>
      <p style={S.lead}>
        대학어디가 공식 자료 기반 — 전형방법·전년도 입시결과·장애인전형을 대학별로 조회합니다.
        {meta && <> 현재 <b>{meta.count}개 대학</b> · 입시가이드 {meta.years?.guide} · 결과 {meta.years?.criteria}.</>}
      </p>

      <div style={S.layout}>
        {/* 좌: 대학 목록 */}
        <div style={S.listCol}>
          {hakjongGuide && <button style={{ ...S.cmpBtn, width: '100%', marginBottom: 8 }} onClick={() => { setCompare('hakjong'); setSelected(null); }}>📊 인서울 {hakjongGuide.univs.length}개 대학 학종 서류평가 비교</button>}
          {gyogwaGuide && <button style={{ ...S.cmpBtn, width: '100%', marginBottom: 8, background: '#3b82f6' }} onClick={() => { setCompare('gyogwa'); setSelected(null); }}>📘 교과 5등급제 반영 비교 ({gyogwaGuide.univs.length}개 대학)</button>}
          <input style={S.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="대학명·지역 검색" />
          <div style={S.listScroll}>
            {loadingList && <div style={S.muted}>불러오는 중…</div>}
            {!loadingList && filtered.map((u) => (
              <button key={u.unvCd} onClick={() => openUniv(u)}
                style={{ ...S.listItem, ...(selected?.unvCd === u.unvCd ? S.listItemActive : {}) }}>
                {univLabel(u.name)}
                {campusBadge(u.name) && <span style={S.campusTag}>{campusBadge(u.name)}</span>}
                <span style={S.region}>{u.region}</span>
              </button>
            ))}
            {!loadingList && !filtered.length && <div style={S.muted}>검색 결과 없음</div>}
          </div>
        </div>

        {/* 우: 상세 */}
        <div style={S.detailCol}>
          {error && <div style={S.error}>⚠ {error}</div>}
          {compare === 'gyogwa' && gyogwaGuide && <GyogwaCompare guide={gyogwaGuide} onClose={() => setCompare(false)} />}
          {compare === 'hakjong' && hakjongGuide && <HakjongCompare guide={hakjongGuide} onClose={() => setCompare(false)} />}
          {!selected && !compare && <div style={S.placeholder}>왼쪽에서 대학을 선택하세요.</div>}
          {selected && (
            <>
              <h1 style={S.univName}>
                {univLabel(selected.name)}
                {campusBadge(selected.name) && <span style={S.campusTag}>{campusBadge(selected.name)}</span>}
                <span style={S.region}>{selected.region}</span>
              </h1>
              {loadingDetail && <div style={S.muted}>상세 불러오는 중…</div>}
              {detail && (
                <>
                  {(detail.guides || []).map((g) => <GuideSection key={g.kind} g={g} />)}
                  {detail.guide?.tables?.length > 0 && (
                    <Section title={`전형방법 (입시가이드 ${detail.guide.syr}학년도)`} count={`전형 ${detail.guide.tables.length}개`}>
                      {detail.guide.tables.map((t, i) => <DataTable key={i} rows={t} />)}
                    </Section>
                  )}
                  {detail.criteria?.sections?.length > 0 && (
                    <Section title={`전형평가기준·전년도결과 (${detail.criteria.syr}학년도)`} count={`구분 ${detail.criteria.sections.length}개`}>
                      {detail.criteria.sections.map((s, i) => (
                        <div key={i} style={{ marginBottom: 14 }}>
                          {s.tables.map((t, j) => <DataTable key={j} rows={t} />)}
                        </div>
                      ))}
                    </Section>
                  )}
                  {(detail.disabled?.blocks?.length > 0 || detail.disabled?.tables?.length > 0) && (
                    <Section title={`장애인전형 (${detail.disabled.syr}학년도)`}>
                      {detail.disabled.tables?.map((t, i) => <DataTable key={i} rows={t} />)}
                      {detail.disabled.blocks?.length > 0 && (
                        <ul style={S.blockList}>
                          {detail.disabled.blocks.map((b, i) => <li key={i} style={{ marginBottom: 4 }}>{b}</li>)}
                        </ul>
                      )}
                    </Section>
                  )}
                  {!detail.guide?.tables?.length && !detail.criteria?.sections?.length && !detail.disabled?.blocks?.length && (
                    <div style={S.muted}>공개된 상세 정보가 없습니다.</div>
                  )}
                  <div style={S.source}>출처: {detail.source}</div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const S = {
  page: { padding: '24px 28px', maxWidth: 1100, margin: '0 auto', color: '#e8eef3', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 },
  h2: { fontSize: 22, fontWeight: 700, margin: '0 0 6px' },
  lead: { color: '#9db0bd', fontSize: 13.5, margin: '0 0 16px', lineHeight: 1.5 },
  layout: { display: 'flex', gap: 20, flex: 1, minHeight: 0 },
  listCol: { width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', minHeight: 0 },
  input: { padding: '10px 12px', borderRadius: 9, border: '1px solid #2a3a4a', background: '#16212e', color: '#e8eef3', fontSize: 14, outline: 'none', marginBottom: 10, boxSizing: 'border-box' },
  listScroll: { overflowY: 'auto', flex: 1, paddingRight: 4 },
  listItem: { display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 4, border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, background: '#16212e', color: '#cdd9e2' },
  listItemActive: { background: '#14b8a6', color: '#fff' },
  region: { fontSize: 11, opacity: 0.7 },
  campusTag: { margin: '0 6px', fontSize: 10.5, fontWeight: 800, color: '#9a5b00', background: '#fff4e0', border: '1px solid #f3ddb4', borderRadius: 6, padding: '1px 6px' },
  detailCol: { flex: 1, overflowY: 'auto', minWidth: 0, paddingRight: 6 },
  placeholder: { color: '#6b7d8a', marginTop: 40, textAlign: 'center' },
  univName: { fontSize: 22, fontWeight: 800, margin: '0 0 16px' },
  secTitle: { fontSize: 16, fontWeight: 700, margin: '0 0 12px', paddingBottom: 6, borderBottom: '2px solid #14b8a6', color: '#e8eef3' },
  secCount: { fontSize: 12, color: '#9db0bd', fontWeight: 400 },
  bar: { display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', margin: '5px 0 3px', maxWidth: 520 },
  barSeg: { color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap', overflow: 'hidden' },
  guideTrack: { padding: '8px 0', borderBottom: '1px dashed var(--border, #2a3a4a)' },
  guideNote: { fontSize: 12.5, lineHeight: 1.6, color: 'var(--text2)', background: 'var(--surface2, rgba(127,127,127,0.08))', borderRadius: 8, padding: '8px 10px', marginTop: 8 },
  cmpBtn: { background: '#00b765', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  table: { borderCollapse: 'collapse', width: '100%', fontSize: 13, marginBottom: 10 },
  td: { border: '1px solid #2a3a4a', padding: '6px 8px', verticalAlign: 'top', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#e8eef3' },
  tdHead: { background: '#1c2937', fontWeight: 600, color: '#9db0bd' },
  blockList: { fontSize: 13, lineHeight: 1.6, paddingLeft: 18, margin: 0, color: '#cdd9e2' },
  muted: { color: '#6b7d8a', fontSize: 14, padding: '8px 4px' },
  error: { background: 'rgba(248,113,113,0.14)', border: '1px solid #fca5a5', color: '#f87171', padding: '10px 14px', borderRadius: 9, fontSize: 13.5, marginBottom: 12 },
  source: { marginTop: 24, paddingTop: 12, borderTop: '1px solid #2a3a4a', fontSize: 11, color: '#6b7d8a' },
};
