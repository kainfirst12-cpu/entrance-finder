import { useEffect, useState } from 'react';
import { API_BASE } from '../apiBase';
import { readBrand } from '../brand';
import { mdPreview } from '../mdPreview';

// 🗄 전체 자료함 (관리자 전용) — 학원 코드마다 따로 쌓이는 자료를 한자리에서 본다.
//   · 무엇을: 학교 입시 해설 · 수행평가 아카이브 · 면접 전략 · 생기부 로드맵 · 학생 기록/분석
//   · 무엇을 할 수 있나: 열어 보기 → ✏️ 수정 · 🗑 삭제(관리자만, 그 학원 화면에도 그대로 반영) →
//     📥 내 보관함으로 복사(원본은 그대로) → 💾 Word/PDF·📁 JSON 으로 따로 저장
//   · 남의 자료를 직접 고치고 지우는 자리이므로 화면이 한 번 더 묻고, 서버가 누가 무엇을 했는지 기록(events)에 남긴다.
//   · 참고: '입시 해설 보고서 보관함'은 코드마다 기본 잠금이라, 열어 주지 않은 학원의 학교 해설은 애초에 서버에 쌓이지 않는다.

const token = () => localStorage.getItem('ef_token');
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

const KIND_LABEL = { report: '학교 해설', suhaeng: '수행평가', interview: '면접 전략', roadmap: '로드맵', record: '학생 기록' };
const KIND_COLOR = { report: '#2dd4bf', suhaeng: '#818cf8', interview: '#fbbf24', roadmap: '#fb7185', record: '#9aa4b2' };
const when = (s) => (s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export default function AdminLibrary() {
  const [kind, setKind] = useState('');
  const [owner, setOwner] = useState('');
  const [q, setQ] = useState('');
  // 기본은 '전체' — 다른 학원만 켜면 내 자료가 빠져 '아무것도 없다'로 보인다(학교 해설은 보관함이 기본 잠금이라 남의 코드엔 거의 없다)
  const [others, setOthers] = useState(false);
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [hiddenMine, setHiddenMine] = useState(0);
  const [owners, setOwners] = useState([]);
  const [msg, setMsg] = useState('');
  const [open, setOpen] = useState(null); // 열어 본 자료

  const load = async () => {
    setMsg('');
    try {
      const p = new URLSearchParams();
      if (kind) p.set('kind', kind);
      if (owner) p.set('owner', owner);
      if (q.trim()) p.set('q', q.trim());
      if (others) p.set('others', '1');
      const d = await api(`/api/admin/library?${p.toString()}`);
      if (!d.success) throw new Error(d.message || '목록을 불러오지 못했습니다');
      setItems(d.items || []); setTotal(d.total || 0); setCounts(d.counts || {}); setHiddenMine(d.hiddenMine || 0);
    } catch (e) { setMsg(e.message); setItems([]); }
  };
  useEffect(() => { api('/api/admin/library/owners').then((d) => setOwners(d.owners || [])).catch(() => setOwners([])); }, []);
  useEffect(() => { const t = setTimeout(load, q ? 350 : 0); return () => clearTimeout(t); }, [kind, owner, q, others]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section style={S.card}>
      <div style={S.head}>
        <div>
          <h2 style={S.h2}>🗄 전체 자료함</h2>
          <p style={S.sub}>학원 코드마다 만든 자료를 모두 봅니다. 열어서 <b>수정·삭제</b>하거나(그 학원 원본이 바뀝니다), <b>내 보관함으로 복사</b>하거나(원본은 그대로), Word·PDF·JSON으로 따로 저장하세요.</p>
        </div>
        <button style={S.btn} onClick={load}>새로고침</button>
      </div>

      {owners.length > 0 && (
        <div style={S.chips}>
          {owners.map((o) => (
            <button key={o.owner_id || 'none'} style={{ ...S.chip, ...(String(owner) === String(o.owner_id) ? S.chipOn : {}) }}
              onClick={() => setOwner(String(owner) === String(o.owner_id) ? '' : String(o.owner_id))}>
              {o.owner_name || '(주인 없음)'}{o.owner_role === 'admin' ? ' · 나' : ''} <b>{o.n}</b>
            </button>
          ))}
        </div>
      )}

      <div style={S.filters}>
        <div style={S.seg}>
          {[['', '전체'], ...Object.entries(KIND_LABEL)].map(([k, l]) => {
            const n = k ? (counts[k] || 0) : Object.values(counts).reduce((a, b) => a + b, 0);
            return (
              <button key={k || 'all'} style={{ ...S.segBtn, ...(kind === k ? S.segOn : {}), ...(k && !n ? S.segEmpty : {}) }} onClick={() => setKind(k)}>
                {l} <b style={{ opacity: 0.75 }}>{n}</b>
              </button>
            );
          })}
        </div>
        <input style={S.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·학생·학교·본문 검색" />
        <label style={S.check}>
          <input type="checkbox" checked={others} onChange={(e) => setOthers(e.target.checked)} /> 다른 학원 자료만
        </label>
      </div>

      {msg && <div style={S.err}>{msg}</div>}
      {others && hiddenMine > 0 && (
        <div style={S.hint}>
          ‘다른 학원 자료만’으로 보는 중입니다 — 내 자료 <b>{hiddenMine}건</b>이 빠져 있습니다.{' '}
          <button style={S.linkBtn} onClick={() => setOthers(false)}>내 자료도 함께 보기</button>
        </div>
      )}
      {kind === 'report' && !counts.report && (
        <div style={S.hint}>
          학교 해설이 안 보이나요? <b>입시 해설 보고서 보관함</b>은 코드마다 기본 잠금이라, 열어 주지 않은 학원은 해설을 만들어도 서버에 저장되지 않습니다(그 학원에서 Word·PDF로만 내려받습니다).
          아래 <b>이용자 코드</b> 표에서 그 코드의 메뉴를 열어 주면 그때부터 여기에 쌓입니다.
        </div>
      )}
      {items === null ? <p style={S.sub}>불러오는 중…</p> : !items.length ? <p style={S.sub}>조건에 맞는 자료가 없습니다.</p> : (
        <>
          <div style={S.sub}>{total.toLocaleString('ko-KR')}건 중 {items.length}건</div>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr><th style={S.th}>종류</th><th style={S.th}>제목</th><th style={S.th}>학원</th><th style={S.th}>학생</th><th style={S.th}>날짜</th><th style={S.th} /></tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={`${it.kind}-${it.id}`}>
                    <td style={S.td}><span style={{ ...S.tag, color: KIND_COLOR[it.kind], borderColor: KIND_COLOR[it.kind] }}>{KIND_LABEL[it.kind] || it.kind}</span></td>
                    <td style={S.td}>
                      <div style={S.title}>{it.title}</div>
                      {(it.sub || it.snippet) && <div style={S.snippet}>{it.sub ? `${it.sub} · ` : ''}{(it.snippet || '').replace(/[#*|>-]/g, ' ').replace(/\s+/g, ' ').slice(0, 90)}</div>}
                    </td>
                    <td style={S.td}>{it.owner_name || '—'}{it.owner_role === 'admin' ? <span style={S.mine}>내 자료</span> : ''}</td>
                    <td style={S.td}>{it.student_name || '—'}</td>
                    <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{when(it.at)}</td>
                    <td style={S.td}><button style={S.btn} onClick={() => setOpen({ kind: it.kind, id: it.id })}>열기</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {open && (
        <Viewer kind={open.kind} id={open.id}
          onClose={() => setOpen(null)}
          onCopied={(w) => setMsg(`내 ${w}(으)로 복사했습니다`)}
          onChanged={(what) => { setMsg(what); load(); }}
          onDeleted={() => { setOpen(null); setMsg('삭제했습니다'); load(); }} />
      )}
    </section>
  );
}

// ── 한 건 열어 보기 · 고치기 · 지우기 ──
function Viewer({ kind, id, onClose, onCopied, onChanged, onDeleted }) {
  const [item, setItem] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState('preview');       // preview | edit
  const [draft, setDraft] = useState({ title: '', markdown: '' });
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    api(`/api/admin/library/${kind}/${id}`).then((d) => {
      if (!d.success) { setMsg(d.message || '열지 못했습니다'); setItem({}); return; }
      setItem(d.item); setDraft({ title: d.item.title || '', markdown: d.item.markdown || '' }); setDirty(false);
    }).catch((e) => { setMsg(e.message); setItem({}); });
  }, [kind, id]);

  const edit = (patch) => { setDraft((x) => ({ ...x, ...patch })); setDirty(true); };
  // 저장 — 남의 학원 자료를 그 자리에서 바꾼다. 면접 전략은 본문이 구조화 JSON 이라 제목만 간다.
  const save = async () => {
    setBusy('save'); setMsg('');
    try {
      const body = { title: draft.title };
      if (item.bodyEditable) body.markdown = draft.markdown;
      const d = await api(`/api/admin/library/${kind}/${id}`, { method: 'PATCH', body });
      if (!d.success) throw new Error(d.message || '저장 실패');
      setItem((x) => ({ ...x, title: draft.title, markdown: item.bodyEditable ? draft.markdown : x.markdown }));
      setDirty(false); setMsg('저장했습니다 — 그 학원 화면에도 바뀐 내용이 보입니다');
      onChanged?.('자료를 수정했습니다');
    } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  // 삭제 — 되돌릴 수 없다. 제목·학원을 보여 주고 한 번 더 확인한다.
  const remove = async () => {
    if (!window.confirm(`정말 삭제할까요?\n\n${item.title}\n${item.ownerName} 학원의 자료입니다. 그 학원 화면에서도 사라지고 되돌릴 수 없습니다.`)) return;
    setBusy('delete'); setMsg('');
    try {
      const d = await api(`/api/admin/library/${kind}/${id}`, { method: 'DELETE' });
      if (!d.success) throw new Error(d.message || '삭제 실패');
      onDeleted?.();
    } catch (e) { setMsg(e.message); setBusy(''); }
  };
  const close = () => { if (dirty && !window.confirm('저장하지 않은 수정이 있습니다. 닫을까요?')) return; onClose(); };

  const copy = async () => {
    setBusy('copy'); setMsg('');
    try {
      const d = await api(`/api/admin/library/${kind}/${id}/copy`, { method: 'POST' });
      if (!d.success) throw new Error(d.message || '복사 실패');
      onCopied?.(d.where); setMsg(`내 ${d.where}(으)로 복사했습니다`);
    } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  // Word·PDF 는 보고서 내보내기(서버)를 그대로 쓴다 — 어느 종류든 마크다운 한 벌이면 같은 문서가 나온다
  const dl = async (format) => {
    setBusy(format); setMsg('');
    try {
      const res = await fetch(`${API_BASE}/api/school-reports/export`, {
        method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: item.title, markdown: item.markdown || '(본문 없음)', format, schoolNames: item.ownerName, kind: 'school', data: item.data || null, brand: readBrand() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `${item.title}.${format}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  // 📁 JSON — 원본 그대로 따로 보관하거나 다른 PC 로 옮길 때
  const saveJson = () => {
    const blob = new Blob([JSON.stringify({ format: 'ef-library/v1', savedAt: new Date().toISOString(), item }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${item.ownerName}_${item.title}`.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80) + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        {!item ? <p style={S.sub}>불러오는 중…</p> : (
          <>
            <div style={S.head}>
              <div style={{ minWidth: 0 }}>
                <h3 style={S.h3}>{item.title || '자료'}</h3>
                <div style={S.sub}>
                  {KIND_LABEL[kind]} · {item.ownerName}{item.ownerCode ? ` (${item.ownerCode})` : ''} · {when(item.at)}
                  {item.meta?.length ? ` · ${item.meta.join(' · ')}` : ''}
                </div>
              </div>
              <button style={S.btn} onClick={close}>닫기 ✕</button>
            </div>
            <div style={S.toolbar}>
              <div style={S.seg}>
                {[['preview', '미리보기'], ['edit', '✏️ 수정']].map(([k, l]) => (
                  <button key={k} style={{ ...S.segBtn, ...(mode === k ? S.segOn : {}) }} onClick={() => setMode(k)}>{l}</button>
                ))}
              </div>
              {mode === 'edit' && <button style={{ ...S.btn, ...S.primary }} disabled={!!busy || !dirty} onClick={save}>{busy === 'save' ? '저장 중…' : '변경 저장'}</button>}
              <button style={{ ...S.btn, ...S.primary }} disabled={!!busy} onClick={copy}>{busy === 'copy' ? '복사 중…' : '📥 내 보관함으로 복사'}</button>
              <button style={S.btn} disabled={!!busy} onClick={() => dl('docx')}>{busy === 'docx' ? '만드는 중…' : '💾 Word'}</button>
              <button style={S.btn} disabled={!!busy} onClick={() => dl('pdf')}>{busy === 'pdf' ? '만드는 중…' : '💾 PDF'}</button>
              <button style={S.btn} onClick={saveJson}>📁 JSON 저장</button>
              <div style={{ flex: 1 }} />
              <button style={{ ...S.btn, ...S.danger }} disabled={!!busy} onClick={remove}>{busy === 'delete' ? '삭제 중…' : '🗑 삭제'}</button>
            </div>
            {msg && <div style={S.msg}>{msg}</div>}
            {mode === 'edit' ? (
              <>
                <input style={S.titleInput} value={draft.title} onChange={(e) => edit({ title: e.target.value })} placeholder="제목" />
                {item.bodyEditable ? (
                  <textarea style={S.textarea} value={draft.markdown} onChange={(e) => edit({ markdown: e.target.value })} spellCheck={false} />
                ) : (
                  <div style={S.hint}>이 자료는 본문이 구조화된 저장본(면접 전략)이라 여기서는 <b>제목만</b> 고칠 수 있습니다. 본문은 면접 전략 화면에서 다시 만들어 주세요.</div>
                )}
              </>
            ) : (
              <div style={S.preview}>
                {item.markdown ? <div dangerouslySetInnerHTML={{ __html: mdPreview(item.markdown) }} /> : <p style={S.sub}>본문이 없는 자료입니다(첨부·구조 자료).</p>}
              </div>
            )}
            <p style={S.sub}>
              수정·삭제는 <b>그 학원의 원본</b>을 바로 바꿉니다(되돌릴 수 없고, 그 학원 화면에도 그대로 보입니다).
              건드리지 않고 가져오려면 📥 복사를 쓰세요 — 복사본만 내 보관함에 새로 만들어집니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const S = {
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 18, marginBottom: 18 },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  h2: { fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text)' },
  h3: { fontSize: 17, fontWeight: 800, margin: 0, color: 'var(--text)' },
  sub: { fontSize: 12, color: 'var(--text3)', margin: '4px 0 0' },
  chips: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 10px' },
  chip: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 999, padding: '4px 10px', fontSize: 11.5, cursor: 'pointer' },
  chipOn: { background: 'var(--accent-bg)', color: 'var(--accent)', borderColor: 'var(--accent)' },
  filters: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 },
  seg: { display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  segBtn: { background: 'var(--surface2)', color: 'var(--text)', border: 'none', padding: '6px 11px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  segOn: { background: 'var(--accent-bg)', color: 'var(--accent)' },
  search: { flex: '1 1 220px', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 13 },
  check: { fontSize: 12, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' },
  tableWrap: { overflowX: 'auto', marginTop: 6 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '7px 8px', color: 'var(--text3)', fontSize: 11, fontWeight: 700, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' },
  td: { padding: '8px', borderBottom: '1px solid var(--border)', color: 'var(--text)', verticalAlign: 'top' },
  title: { fontWeight: 700, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' },
  snippet: { fontSize: 11, color: 'var(--text3)', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tag: { fontSize: 10.5, fontWeight: 800, border: '1px solid', borderRadius: 999, padding: '2px 8px', whiteSpace: 'nowrap' },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 700 },
  primary: { background: 'var(--accent)', color: '#0b1220', borderColor: 'var(--accent)' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 1150, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' },
  modal: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 16, padding: 22, width: '100%', maxWidth: 900, boxShadow: 'var(--shadow-md)' },
  toolbar: { display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0' },
  preview: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', fontSize: 13.5, lineHeight: 1.65, color: 'var(--text)', maxHeight: '60vh', overflowY: 'auto' },
  msg: { fontSize: 12, color: 'var(--accent)', margin: '0 0 8px' },
  err: { fontSize: 12, color: '#f87171', margin: '6px 0' },
  segEmpty: { opacity: 0.45 },
  hint: { fontSize: 12, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 11px', margin: '4px 0 8px', lineHeight: 1.7 },
  linkBtn: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: 0, textDecoration: 'underline' },
  mine: { fontSize: 10, marginLeft: 6, padding: '1px 6px', borderRadius: 999, background: 'var(--accent-bg)', color: 'var(--accent)', fontWeight: 700, whiteSpace: 'nowrap' },
  danger: { color: '#f87171', borderColor: 'rgba(248,113,113,0.5)' },
  textarea: { width: '100%', boxSizing: 'border-box', minHeight: 360, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 1.6, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical' },
  titleInput: { width: '100%', boxSizing: 'border-box', fontSize: 15, fontWeight: 800, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', marginBottom: 8 },
};
