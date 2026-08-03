import { useState } from 'react';

// 생기부 로드맵 체크리스트 — 학생 페이지(라이트)와 선생님 보드(다크) 공용.
// 데이터는 부모가 들고 있고, 이 컴포넌트는 핸들러만 호출한다(호출 후 부모가 새로 고침).

const SECTION_ORDER = ['과목별 설계', '타임라인', '남은 작업', '기타'];
const SECTION_ICON = { '과목별 설계': '📘', '타임라인': '🗓', '남은 작업': '📌', '기타': '📎' };

const THEME = {
  light: {
    card: '#fff', border: '#e3e9f1', soft: '#f7f9fc', text: '#26313e', dim: '#8492a5',
    head: '#1c2733', accent: '#1d6fd6', accentSoft: '#e8f1fc', done: '#1a7f4e', doneSoft: '#e6f6ee',
    input: '#fff', inputBorder: '#d7dfea', chip: '#eef2f7', danger: '#d64545',
  },
  dark: {
    card: 'rgba(255,255,255,0.03)', border: '#2a3a48', soft: 'rgba(255,255,255,0.04)', text: '#cdd9e2', dim: '#6b7d8a',
    head: '#e8eef3', accent: '#2dd4bf', accentSoft: 'rgba(45,212,191,0.12)', done: '#34d399', doneSoft: 'rgba(52,211,153,0.12)',
    input: 'rgba(255,255,255,0.06)', inputBorder: '#2a3a48', chip: 'rgba(255,255,255,0.06)', danger: '#f87171',
  },
};

const pct = (items) => (items.length ? Math.round((items.filter(i => i.done).length / items.length) * 100) : 0);

function ProgressBar({ items, t, big }) {
  const p = pct(items);
  const done = items.filter(i => i.done).length;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 160 }}>
      <div style={{ flex: 1, height: big ? 10 : 6, borderRadius: 99, background: t.chip, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', borderRadius: 99, background: p === 100 ? t.done : t.accent, transition: 'width .25s' }} />
      </div>
      <span style={{ fontSize: big ? 13 : 12, fontWeight: 800, color: p === 100 ? t.done : t.accent, whiteSpace: 'nowrap' }}>
        {done}/{items.length} · {p}%
      </span>
    </div>
  );
}

function ItemRow({ item, t, editable, onToggle, onSave, onDelete }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: item.title, detail: item.detail || '', note: item.note || '' });
  const [busy, setBusy] = useState(false);

  const run = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const startEdit = () => { setForm({ title: item.title, detail: item.detail || '', note: item.note || '' }); setEditing(true); setOpen(true); };
  const save = () => run(async () => { await onSave(item, form); setEditing(false); });

  const inputS = { width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${t.inputBorder}`, background: t.input, color: t.text, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' };

  return (
    <div style={{ border: `1px solid ${item.done ? 'transparent' : t.border}`, background: item.done ? t.doneSoft : t.card, borderRadius: 10, marginBottom: 6, opacity: busy ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px' }}>
        <button
          onClick={() => run(() => onToggle(item))}
          title={item.done ? '달성 취소' : '달성 체크'}
          style={{
            flex: '0 0 20px', width: 20, height: 20, marginTop: 1, borderRadius: 6, cursor: 'pointer',
            border: `2px solid ${item.done ? t.done : t.dim}`, background: item.done ? t.done : 'transparent',
            color: '#fff', fontSize: 12, fontWeight: 900, lineHeight: '16px', padding: 0,
          }}>{item.done ? '✓' : ''}</button>

        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <input style={inputS} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="할 일" />
          ) : (
            <div onClick={() => setOpen(o => !o)} style={{ cursor: 'pointer', fontSize: 13.5, fontWeight: 600, lineHeight: 1.5, color: item.done ? t.dim : t.head, textDecoration: item.done ? 'line-through' : 'none' }}>
              {item.title}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {[item.subject, item.period, item.priority].filter(Boolean).map((v, i) => (
              <span key={i} style={{ fontSize: 10.5, fontWeight: 700, color: t.accent, background: t.accentSoft, borderRadius: 5, padding: '1px 7px' }}>{v}</span>
            ))}
            {item.note && !open && <span style={{ fontSize: 11, color: t.dim }}>✎ 내 메모 있음</span>}
            {item.done && item.done_at && <span style={{ fontSize: 11, color: t.done }}>✓ {String(item.done_at).slice(0, 10)}</span>}
            {(item.detail || item.note) && !editing && (
              <button onClick={() => setOpen(o => !o)} style={{ ...linkBtn(t), marginLeft: 'auto' }}>{open ? '접기 ▲' : '자세히 ▼'}</button>
            )}
          </div>
        </div>

        {editable && !editing && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button onClick={startEdit} style={linkBtn(t)}>수정</button>
            <button onClick={() => { if (confirm('이 항목을 삭제할까요?')) run(() => onDelete(item)); }} style={{ ...linkBtn(t), color: t.danger }}>삭제</button>
          </div>
        )}
      </div>

      {open && (
        <div style={{ padding: '2px 11px 11px 40px', fontSize: 12.5, lineHeight: 1.7, color: t.text }}>
          {editing ? (
            <>
              <textarea style={{ ...inputS, minHeight: 66, marginBottom: 6 }} value={form.detail} onChange={e => setForm(f => ({ ...f, detail: e.target.value }))} placeholder="어떻게 하는지 설명" />
              <textarea style={{ ...inputS, minHeight: 48 }} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="내 메모 (진행 상황, 막힌 점 등)" />
              <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                <button onClick={save} style={primaryBtn(t)}>저장</button>
                <button onClick={() => setEditing(false)} style={linkBtn(t)}>취소</button>
              </div>
            </>
          ) : (
            <>
              {item.detail && <div style={{ whiteSpace: 'pre-wrap' }}>{item.detail}</div>}
              {item.note && (
                <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 8, background: t.soft, border: `1px dashed ${t.border}` }}>
                  <b style={{ color: t.accent, fontSize: 11.5 }}>내 메모</b>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: 3 }}>{item.note}</div>
                </div>
              )}
              {editable && <button onClick={startEdit} style={{ ...linkBtn(t), marginTop: 7 }}>✎ 메모 쓰기 / 수정</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function AddItemForm({ section, t, onAdd }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', detail: '', subject: '' });
  const [busy, setBusy] = useState(false);
  const inputS = { width: '100%', padding: '7px 10px', borderRadius: 8, border: `1px solid ${t.inputBorder}`, background: t.input, color: t.text, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' };

  if (!open) return <button onClick={() => setOpen(true)} style={{ ...linkBtn(t), margin: '2px 0 10px' }}>+ 항목 직접 추가</button>;
  const add = async () => {
    if (!f.title.trim()) return;
    setBusy(true);
    try {
      await onAdd({ ...f, section, [section === '타임라인' ? 'period' : 'subject']: f.subject });
      setF({ title: '', detail: '', subject: '' }); setOpen(false);
    } finally { setBusy(false); }
  };
  return (
    <div style={{ border: `1px dashed ${t.border}`, borderRadius: 10, padding: 10, margin: '2px 0 10px', background: t.soft }}>
      <input style={{ ...inputS, marginBottom: 6 }} value={f.title} onChange={e => setF(v => ({ ...v, title: e.target.value }))} placeholder="할 일 (예: GBIF에서 CSV 내려받기)" />
      <input style={{ ...inputS, marginBottom: 6 }} value={f.subject} onChange={e => setF(v => ({ ...v, subject: e.target.value }))} placeholder={section === '타임라인' ? '시기 (예: 9월)' : '과목 (선택)'} />
      <textarea style={{ ...inputS, minHeight: 52 }} value={f.detail} onChange={e => setF(v => ({ ...v, detail: e.target.value }))} placeholder="설명 (선택)" />
      <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
        <button onClick={add} disabled={busy} style={primaryBtn(t)}>{busy ? '추가 중…' : '추가'}</button>
        <button onClick={() => setOpen(false)} style={linkBtn(t)}>취소</button>
      </div>
    </div>
  );
}

export default function RoadmapView({ roadmaps = [], dark = false, editable = true, renderMd, onToggle, onSaveItem, onDeleteItem, onAddItem, onDeleteRoadmap, onViewBody }) {
  const t = dark ? THEME.dark : THEME.light;
  const [openSummary, setOpenSummary] = useState({});
  const [openBody, setOpenBody] = useState({});

  if (!roadmaps.length) return null;

  return (
    <div>
      {roadmaps.map((rm) => {
        const items = rm.items || [];
        const bySection = {};
        for (const it of items) (bySection[it.section || '기타'] ||= []).push(it);
        const sections = Object.keys(bySection).sort(
          (a, b) => (SECTION_ORDER.indexOf(a) + 1 || 99) - (SECTION_ORDER.indexOf(b) + 1 || 99));

        return (
          <div key={rm.id} style={{ border: `1px solid ${t.border}`, borderRadius: 14, padding: '14px 16px', marginBottom: 14, background: t.card }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <b style={{ fontSize: 15, color: t.head }}>🗺 {rm.title}</b>
              {onDeleteRoadmap && (
                <button onClick={() => { if (confirm(`'${rm.title}' 로드맵을 삭제할까요? 체크 기록도 함께 사라집니다.`)) onDeleteRoadmap(rm); }}
                  style={{ ...linkBtn(t), color: t.danger }}>로드맵 삭제</button>
              )}
              <ProgressBar items={items} t={t} big />
            </div>

            {(rm.summary || rm.body) && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {rm.summary && (
                    <button onClick={() => setOpenSummary(s => ({ ...s, [rm.id]: !s[rm.id] }))} style={linkBtn(t)}>
                      {openSummary[rm.id] ? '요지 접기 ▲' : '이 로드맵의 요지 보기 ▼'}
                    </button>
                  )}
                  {rm.body && (
                    onViewBody
                      ? <button onClick={() => onViewBody(rm)} style={linkBtn(t)}>🔍 로드맵 전문 크게 보기</button>
                      : <button onClick={() => setOpenBody(s => ({ ...s, [rm.id]: !s[rm.id] }))} style={linkBtn(t)}>
                          {openBody[rm.id] ? '전문 접기 ▲' : '로드맵 전문 보기 ▼'}
                        </button>
                  )}
                </div>
                {openSummary[rm.id] && rm.summary && (
                  <div style={{ marginTop: 7, padding: '11px 13px', borderRadius: 10, background: t.soft, border: `1px solid ${t.border}`, fontSize: 13, lineHeight: 1.75, color: t.text, whiteSpace: 'pre-wrap' }}>
                    {rm.summary}
                  </div>
                )}
                {openBody[rm.id] && rm.body && (
                  renderMd
                    ? <div style={{ marginTop: 7, padding: '11px 15px', borderRadius: 10, background: t.soft, border: `1px solid ${t.border}`, fontSize: 13, lineHeight: 1.75, color: t.text, maxHeight: 460, overflowY: 'auto' }}
                        dangerouslySetInnerHTML={{ __html: renderMd(rm.body) }} />
                    : <div style={{ marginTop: 7, padding: '11px 15px', borderRadius: 10, background: t.soft, border: `1px solid ${t.border}`, fontSize: 13, lineHeight: 1.75, color: t.text, whiteSpace: 'pre-wrap', maxHeight: 460, overflowY: 'auto' }}>{rm.body}</div>
                )}
              </div>
            )}

            {sections.map((sec) => (
              <div key={sec} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 0 8px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 800, color: t.head }}>{SECTION_ICON[sec] || '📎'} {sec}</span>
                  <ProgressBar items={bySection[sec]} t={t} />
                </div>
                {bySection[sec].map((it) => (
                  <ItemRow key={it.id} item={it} t={t} editable={editable}
                    onToggle={onToggle} onSave={onSaveItem} onDelete={onDeleteItem} />
                ))}
                {editable && onAddItem && <AddItemForm section={sec} t={t} onAdd={(f) => onAddItem(rm, f)} />}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const linkBtn = (t) => ({ border: 'none', background: 'transparent', color: t.accent, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '2px 4px', fontFamily: 'inherit' });
const primaryBtn = (t) => ({ border: `1px solid ${t.accent}`, background: t.accentSoft, color: t.accent, borderRadius: 8, padding: '6px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' });
