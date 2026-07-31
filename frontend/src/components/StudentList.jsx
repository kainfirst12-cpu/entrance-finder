// src/components/StudentList.jsx — 학생 관리 (학생 보드 기반)
// 보드(ef_students)의 학생을 그대로 보여주고, 신규 등록·기록 추가·AI 컨설턴트 브리핑까지 한 화면에서.
import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../apiBase';

const token = () => localStorage.getItem('ef_token');

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) { const e = new Error('권한/인증'); e.auth = true; throw e; }
  return res.json();
}

async function postForResult(url, opts) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) {
    try { return await res.json(); }
    catch { return { success: false, message: `서버 응답 오류 (HTTP ${res.status}) — 서버 업데이트 적용 중일 수 있습니다. 잠시 후 다시 시도해주세요.` }; }
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', result = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('data: ')) { try { result = JSON.parse(line.slice(6)); } catch {} }
    }
  }
  return result || { success: false, message: '서버 응답이 비었습니다' };
}

// 가벼운 마크다운 → HTML (다크)
function mdToHtml(md) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b style="color:#e8eef3">$1</b>');
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    if (t.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i]); i++; }
      const rows = block.filter(l => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l));
      html += '<table style="border-collapse:collapse;width:100%;margin:8px 0">';
      rows.forEach((r, ri) => {
        const cells = r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        html += '<tr>' + cells.map(c =>
          `<${ri === 0 ? 'th' : 'td'} style="border:1px solid #2a3a48;padding:6px 9px;text-align:left;background:${ri === 0 ? '#243341' : '#1c2937'};color:#e8eef3">${inline(c)}</${ri === 0 ? 'th' : 'td'}>`).join('') + '</tr>';
      });
      html += '</table>';
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { html += `<h${h[1].length + 1} style="margin:14px 0 6px;color:#e8eef3">${inline(h[2])}</h${h[1].length + 1}>`; i++; continue; }
    const b = t.match(/^[-*]\s+(.*)$/);
    if (b) { html += `<div style="margin:2px 0 2px 14px">• ${inline(b[1])}</div>`; i++; continue; }
    html += `<p style="margin:6px 0">${inline(t)}</p>`;
    i++;
  }
  return html;
}

const REC_TYPES = ['수행평가', '상담', '생기부 분석', '보완', '기타'];

export default function StudentList({ onNewAnalysis, onAuthError }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // 신규 등록
  const [showAdd, setShowAdd] = useState(false);
  const [nf, setNf] = useState({ name: '', school: '', grade: '', major: '', targetUniv: '' });
  const [adding, setAdding] = useState(false);

  // 카드 확장/기록 추가/브리핑
  const [openId, setOpenId] = useState(null);
  const [openRec, setOpenRec] = useState(null);
  const [rec, setRec] = useState({ type: '수행평가', title: '', content: '' });
  const [briefingId, setBriefingId] = useState(null);

  const load = useCallback(() => {
    api('/api/board/students')
      .then((j) => {
        if (j.success) { setStudents(j.students || []); setError(''); }
        else setError(j.message || '학생 보드를 불러올 수 없습니다');
      })
      .catch((e) => { if (e.auth) onAuthError?.(); else setError(e.message); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const nfc = (s) => (s || '').normalize('NFC');
  const filtered = students.filter((s) =>
    [s.name, s.school, s.grade, s.major, s.target_univ].some((v) => nfc(v).includes(nfc(search))));

  const addStudent = async () => {
    if (!nf.name.trim()) return;
    setAdding(true);
    try {
      const j = await api('/api/board/students', { method: 'POST', body: nf });
      if (!j.success) throw new Error(j.message || '등록 실패');
      setNf({ name: '', school: '', grade: '', major: '', targetUniv: '' });
      setShowAdd(false); load();
    } catch (e) { if (e.auth) onAuthError?.(); else alert('등록 오류: ' + e.message); }
    finally { setAdding(false); }
  };

  const addRecordTo = async (s) => {
    if (!rec.title.trim() && !rec.content.trim()) { alert('제목 또는 내용을 입력하세요.'); return; }
    try {
      const j = await api(`/api/board/students/${s.id}/records`, { method: 'POST', body: { type: rec.type, title: rec.title || rec.type, content: rec.content } });
      if (!j.success) throw new Error(j.message || '추가 실패');
      setRec({ type: rec.type, title: '', content: '' }); load();
    } catch (e) { if (e.auth) onAuthError?.(); else alert('기록 추가 오류: ' + e.message); }
  };

  const runBrief = async (s) => {
    const apiKeys = { claude: localStorage.getItem('ef_apikey'), gemini: localStorage.getItem('ef_geminikey'), gpt: localStorage.getItem('ef_gptkey') };
    const model = localStorage.getItem('ef_model') || 'claude';
    const group = model.startsWith('gemini') ? 'gemini' : model.startsWith('gpt') || model === 'o3' || model === 'o4-mini' ? 'gpt' : 'claude';
    const apiKey = apiKeys[group];
    if (!apiKey) { alert('설정에서 AI API 키를 먼저 입력해 주세요.'); return; }
    setBriefingId(s.id);
    try {
      const d = await postForResult(`${API_BASE}/api/board/students/${s.id}/brief`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'x-ai-model': group, 'x-ai-submodel': model, Authorization: `Bearer ${token()}` },
      });
      if (!d.success) throw new Error(d.message || '브리핑 생성 실패');
      await load();
      setOpenId(s.id);
      if (d.record?.id) setOpenRec(d.record.id);
    } catch (e) { if (e.auth) onAuthError?.(); else alert('브리핑 오류: ' + e.message); }
    finally { setBriefingId(null); }
  };

  const typeCounts = (s) => {
    const c = {};
    (s.records || []).forEach((r) => { c[r.type] = (c[r.type] || 0) + 1; });
    return c;
  };
  const latestGpa = (s) => {
    const g = (s.grades || []).filter((x) => x.gpa != null);
    return g.length ? Number(g[g.length - 1].gpa) : null;
  };
  const latestBrief = (s) => (s.records || []).find((r) => r.type === '컨설턴트 브리핑');

  return (
    <div className="list-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">학생 관리</h1>
          <p className="page-desc">학생 보드와 연동 · 총 {students.length}명</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-analyze" style={{ background: 'rgba(255,255,255,0.08)', color: '#e8eef3' }} onClick={() => setShowAdd((v) => !v)}>
            ➕ 새 학생 등록
          </button>
          <button className="btn-analyze" onClick={onNewAnalysis}>✨ 새 분석 시작</button>
        </div>
      </div>

      {error && <div style={S.error}>⚠ {error}</div>}

      {/* 신규 등록 — 생기부 분석 없이도 학생을 만들고 수행평가부터 쌓을 수 있음 */}
      {showAdd && (
        <div style={S.addBox}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#e8eef3', marginBottom: 8 }}>새 학생 등록</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input style={S.input} value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="이름 *" />
            <input style={S.input} value={nf.school} onChange={(e) => setNf({ ...nf, school: e.target.value })} placeholder="학교" />
            <input style={{ ...S.input, width: 90 }} value={nf.grade} onChange={(e) => setNf({ ...nf, grade: e.target.value })} placeholder="학년(고2)" />
            <input style={S.input} value={nf.major} onChange={(e) => setNf({ ...nf, major: e.target.value })} placeholder="희망 전공" />
            <input style={S.input} value={nf.targetUniv} onChange={(e) => setNf({ ...nf, targetUniv: e.target.value })} placeholder="목표 대학" />
            <button style={S.primaryBtn} onClick={addStudent} disabled={adding || !nf.name.trim()}>{adding ? '등록 중…' : '등록'}</button>
          </div>
          <div style={{ fontSize: 12, color: '#6b7d8a', marginTop: 6 }}>
            등록 후 카드에서 바로 수행평가·상담 기록을 추가할 수 있습니다. 생기부 분석은 나중에 해도 됩니다.
          </div>
        </div>
      )}

      <div className="search-wrap">
        <input className="search-input" placeholder="🔍 이름 · 학교 · 학년 · 전공 · 목표대학 검색"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="loading-wrap"><div className="spinner" /><p>학생 보드 불러오는 중...</p></div>
      ) : filtered.length === 0 ? (
        <div className="empty-wrap">
          <div className="empty-icon">👥</div>
          <p className="empty-title">{students.length ? '검색 결과가 없습니다' : '아직 등록된 학생이 없어요'}</p>
          {!students.length && (
            <>
              <p className="empty-desc">'새 학생 등록'으로 바로 등록하거나, 새 분석을 시작하면 자동으로 추가됩니다.</p>
              <button className="btn-analyze" onClick={() => setShowAdd(true)}>➕ 첫 학생 등록</button>
            </>
          )}
        </div>
      ) : (
        <div style={S.grid}>
          {filtered.map((s) => {
            const counts = typeCounts(s);
            const gpa = latestGpa(s);
            const brief = latestBrief(s);
            const open = openId === s.id;
            return (
              <div key={s.id} style={S.card}>
                <div style={S.cardHead}>
                  <div style={S.avatar}>{s.name?.charAt(0) || '?'}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={S.name}>{s.name} <span style={S.status}>{s.status}</span></div>
                    <div style={S.meta}>{[s.school, s.grade, s.major].filter(Boolean).join(' · ') || '정보 미입력'}</div>
                  </div>
                  {gpa != null && <span style={S.gpa}>내신 {gpa}</span>}
                </div>

                <div style={S.infoRow}><span style={S.infoLabel}>목표 대학</span><span style={S.infoValue}>{s.target_univ || '미입력'}</span></div>
                <div style={S.chips}>
                  {Object.entries(counts).map(([t, n]) => (
                    <span key={t} style={{ ...S.chip, ...(t === '컨설턴트 브리핑' ? S.chipBrief : {}) }}>{t} {n}</span>
                  ))}
                  {!(s.records || []).length && <span style={{ fontSize: 12, color: '#6b7d8a' }}>기록 없음 — 아래에서 바로 추가</span>}
                </div>

                <div style={S.btnRow}>
                  <button style={S.smBtn} onClick={() => { setOpenId(open ? null : s.id); setOpenRec(null); }}>
                    {open ? '접기 ▲' : `기록·브리핑 보기 (${(s.records || []).length}) ▼`}
                  </button>
                  <button style={{ ...S.smBtn, ...S.briefBtn }} onClick={() => runBrief(s)} disabled={briefingId === s.id}
                    title="쌓인 기록 전체를 AI가 컨설턴트 관점(강점·보완점·전략·체크리스트)으로 정리해 기록으로 저장합니다">
                    {briefingId === s.id ? '🤖 정리 중…' : brief ? '🤖 브리핑 재생성' : '🤖 컨설턴트 브리핑'}
                  </button>
                </div>

                {open && (
                  <div style={S.openBox}>
                    {(s.records || []).map((r) => (
                      <div key={r.id}>
                        <div style={S.recRow} onClick={() => setOpenRec(openRec === r.id ? null : r.id)}>
                          <span style={{ ...S.recType, ...(r.type === '컨설턴트 브리핑' ? S.chipBrief : {}) }}>{r.type}</span>
                          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                          <span style={{ color: '#6b7d8a', fontSize: 11.5 }}>{String(r.created_at).slice(0, 10)}</span>
                          <span style={{ color: '#5b86d6', fontSize: 11.5 }}>{openRec === r.id ? '닫기' : '보기'}</span>
                        </div>
                        {openRec === r.id && (
                          r.content
                            ? <div style={S.recContent} dangerouslySetInnerHTML={{ __html: mdToHtml(r.content) }} />
                            : <div style={{ ...S.recContent, color: '#6b7d8a' }}>
                                {r.detail ? r.detail : '저장된 본문이 없는 기록입니다.'}
                                {r.type === '입시상담' && ' — 상담 화면에서 학생을 선택한 뒤 💾 대화 저장을 누르면 전체 대화가 함께 저장됩니다.'}
                              </div>
                        )}
                      </div>
                    ))}

                    {/* 기록 바로 추가 — 수행평가부터 하나씩 */}
                    <div style={S.addRec}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <select style={{ ...S.input, width: 110, padding: '6px 8px' }} value={rec.type} onChange={(e) => setRec({ ...rec, type: e.target.value })}>
                          {REC_TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <input style={{ ...S.input, flex: 1, padding: '6px 8px' }} value={rec.title} onChange={(e) => setRec({ ...rec, title: e.target.value })} placeholder="제목 (예: 통합과학 실험보고서)" />
                        <button style={S.smBtn} onClick={() => addRecordTo(s)}>+ 추가</button>
                      </div>
                      <textarea style={{ ...S.input, width: '100%', boxSizing: 'border-box', resize: 'vertical' }} rows={2}
                        value={rec.content} onChange={(e) => setRec({ ...rec, content: e.target.value })}
                        placeholder="내용/메모 (선택) — 수행평가 결과물, 상담 내용 등을 붙여넣어 보관" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const S = {
  error: { background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#f87171', borderRadius: 10, padding: '9px 13px', fontSize: 13, margin: '0 0 12px' },
  addBox: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 12, padding: '14px 16px', marginBottom: 14 },
  input: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, color: '#e8eef3', padding: '8px 10px', fontSize: 13 },
  primaryBtn: { border: 'none', background: '#14b8a6', color: '#fff', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', gap: 12 },
  card: { background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '14px 16px' },
  cardHead: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 },
  avatar: { width: 38, height: 38, borderRadius: '50%', background: 'rgba(91,134,214,0.25)', color: '#8fb8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 16, flexShrink: 0 },
  name: { fontSize: 15.5, fontWeight: 800, color: '#e8eef3' },
  status: { fontSize: 11, fontWeight: 600, color: '#9db0bd', background: 'rgba(255,255,255,0.07)', borderRadius: 6, padding: '1px 7px', marginLeft: 4 },
  meta: { fontSize: 12, color: '#9db0bd', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  gpa: { fontSize: 12.5, fontWeight: 800, color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)', borderRadius: 7, padding: '3px 8px', whiteSpace: 'nowrap' },
  infoRow: { display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 6 },
  infoLabel: { color: '#6b7d8a' },
  infoValue: { color: '#cfd8e0', fontWeight: 600 },
  chips: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10, minHeight: 20 },
  chip: { fontSize: 11, fontWeight: 700, color: '#9db0bd', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 6, padding: '1px 7px' },
  chipBrief: { color: '#c9b8f0', borderColor: 'rgba(139,111,216,0.5)', background: 'rgba(139,111,216,0.12)' },
  btnRow: { display: 'flex', gap: 6, flexWrap: 'wrap' },
  smBtn: { border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.05)', color: '#cfd8e0', borderRadius: 8, padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  briefBtn: { color: '#c9b8f0', borderColor: 'rgba(139,111,216,0.5)', background: 'rgba(139,111,216,0.1)' },
  openBox: { marginTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 8 },
  recRow: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12.5, color: '#cfd8e0', padding: '5px 2px', cursor: 'pointer' },
  recType: { fontSize: 10.5, fontWeight: 700, color: '#9db0bd', border: '1px solid rgba(255,255,255,0.16)', borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap' },
  recContent: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 9, padding: '10px 14px', fontSize: 12.5, lineHeight: 1.7, color: '#cfd8e0', maxHeight: 300, overflowY: 'auto', margin: '4px 0 8px' },
  addRec: { marginTop: 8, borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: 8 },
};
