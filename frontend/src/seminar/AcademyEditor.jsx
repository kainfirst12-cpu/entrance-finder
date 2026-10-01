import { useState, useEffect, useCallback } from 'react';
import { api } from './api';
import { renderCommonSlide, LAYOUT_LABEL } from './commonSlides';
import { numberSlides } from './deckModel';
import SlideEditModal from './SlideEditModal';
import SlidePreview from './SlidePreview';

// ③ 학원 소개 — 학원 코드마다 한 벌. 설명회 자료의 맨 뒤(학교별 분석 다음)에 붙고, 마무리 슬라이드에 연락처가 들어간다.
// 처음 열면 관리자는 2025 패스파인더 소개, 다른 학원은 빈 틀로 시작한다(💾 저장해야 남는다).

const ADD_LAYOUTS = ['imageText', 'cards', 'statement', 'bullets', 'image', 'compare', 'qa', 'table'];
const PREVIEW_CH = 8; // 미리보기 머리 번호(실제 번호는 설명회 자료에서 학교별 다음 번호로 매긴다)

export default function AcademyEditor({ onAuthError }) {
  const [a, setA] = useState(null);
  const [seeded, setSeeded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null);
  const [addLayout, setAddLayout] = useState('imageText');

  const fail = useCallback((e) => { if (e?.auth) onAuthError?.(); setErr(e?.message || String(e)); }, [onAuthError]);
  useEffect(() => {
    api('/api/seminar/academy').then((r) => { if (!r.success) throw new Error(r.message); setA(r.item); setSeeded(!!r.seeded); }).catch(fail);
  }, [fail]);
  if (!a) return <div style={S.empty}>{err || '학원 소개를 불러오는 중…'}</div>;

  const chapters = { [PREVIEW_CH]: a.title };
  const upd = (p) => { setA((cur) => ({ ...cur, ...p })); setDirty(true); };
  const setSlides = (fn) => upd({ slides: fn(a.slides || []) });
  const save = async () => {
    setBusy('save'); setErr('');
    try {
      const r = await api('/api/seminar/academy', { method: 'PUT', body: { title: a.title, info: a.info, slides: a.slides } });
      if (!r.success) throw new Error(r.message);
      setA(r.item); setDirty(false); setSeeded(false); setMsg('저장했습니다. 설명회 자료에서 ‘③ 학원 소개 넣기’를 켜면 들어갑니다.');
    } catch (e) { fail(e); } finally { setBusy(''); }
  };
  const add = () => {
    const id = `a${Date.now() % 1000000}`;
    const data = { imageText: { items: ['설명을 적어 주세요'] }, cards: { cards: [{ title: '제목', body: '내용' }] }, statement: { lines: ['문장을 적어 주세요'] }, bullets: { items: ['항목'] },
      image: { caption: '' }, compare: { left: { title: '왼쪽', items: ['항목'] }, right: { title: '오른쪽', items: ['항목'] } }, qa: { q: '질문', a: ['답'] }, table: { columns: ['항목', '내용'], rows: [['', '']] } }[addLayout];
    setSlides((ss) => [...ss, { id, layout: addLayout, heading: '새 슬라이드', data }]);
    setEdit(id);
  };
  const move = (id, dir) => setSlides((ss) => { const i = ss.findIndex((s) => s.id === id), j = i + dir; if (j < 0 || j >= ss.length) return ss; const n = [...ss]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const remove = (id) => { if (confirm('이 슬라이드를 뺄까요?')) setSlides((ss) => ss.filter((s) => s.id !== id)); };
  const info = a.info || {};
  const setInfo = (k, v) => upd({ info: { ...info, [k]: v } });
  const slides = numberSlides((a.slides || []).map((s) => ({ key: s.id, els: renderCommonSlide({ ...s, chapter: PREVIEW_CH }, chapters) })), 1);
  const editing = edit && (a.slides || []).find((s) => s.id === edit);

  return (
    <div>
      <p style={S.lead}>설명회 마지막에 붙는 <b>우리 학원 소개</b>입니다. 수업 방식·관리 시스템을 카드·사진으로 정리해 두면, 설명회 자료를 만들 때마다 그대로 붙습니다.
        학원 이름과 로고는 <b>설정 → 브랜드</b>의 값이 표지·마무리에 들어갑니다.</p>
      {seeded && <div style={S.note}>처음 모양입니다. 고친 뒤 <b>💾 저장</b>해야 남습니다.</div>}
      {err && <div style={S.err} onClick={() => setErr('')}>{err}</div>}
      {msg && <div style={S.ok} onClick={() => setMsg('')}>{msg}</div>}

      <div style={S.card}>
        <div style={S.row}>
          <label style={S.lbl}>파트 제목 <input style={{ ...S.input, width: 240 }} value={a.title} onChange={(e) => upd({ title: e.target.value })} /></label>
          <button style={{ ...S.btn, ...S.primary }} onClick={save} disabled={busy === 'save' || (!dirty && !seeded)}>{dirty || seeded ? '💾 저장*' : '💾 저장'}</button>
        </div>
        <div style={{ ...S.row, marginTop: 8 }}>
          <span style={S.sub}>마무리 슬라이드 연락처</span>
          <input style={{ ...S.input, width: 150 }} placeholder="전화" value={info.phone || ''} onChange={(e) => setInfo('phone', e.target.value)} />
          <input style={{ ...S.input, width: 220 }} placeholder="주소" value={info.address || ''} onChange={(e) => setInfo('address', e.target.value)} />
          <input style={{ ...S.input, width: 160 }} placeholder="SNS·블로그" value={info.sns || ''} onChange={(e) => setInfo('sns', e.target.value)} />
          <input style={{ ...S.input, flex: 1, minWidth: 220 }} placeholder="감사 인사 아래 한 줄" value={info.closing || ''} onChange={(e) => setInfo('closing', e.target.value)} />
        </div>
      </div>

      <div style={S.grid}>
        {slides.map((sl, i) => {
          const s = a.slides[i];
          return (
            <div key={s.id} style={S.slide}>
              <SlidePreview slide={sl} width={300} />
              <div style={{ ...S.row, marginTop: 6 }}>
                <span style={S.sub}>{i + 1}. {LAYOUT_LABEL[s.layout]}</span>
                <button style={S.mini} onClick={() => setEdit(s.id)}>✏ 고치기</button>
                <button style={S.mini} onClick={() => move(s.id, -1)}>↑</button>
                <button style={S.mini} onClick={() => move(s.id, 1)}>↓</button>
                <button style={S.mini} onClick={() => remove(s.id)}>🗑</button>
              </div>
            </div>
          );
        })}
        <div style={{ ...S.slide, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', alignItems: 'center', minWidth: 300, minHeight: 170 }}>
          <select style={S.input} value={addLayout} onChange={(e) => setAddLayout(e.target.value)}>
            {ADD_LAYOUTS.map((l) => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}
          </select>
          <button style={S.btn} onClick={add}>＋ 슬라이드 넣기</button>
        </div>
      </div>

      {editing && <SlideEditModal slide={{ ...editing, chapter: PREVIEW_CH }} chapters={chapters}
        onApply={(patch) => { setSlides((ss) => ss.map((s) => (s.id === edit ? { ...s, ...patch, ...(patch.source ? {} : { source: undefined }) } : s))); setEdit(null); }}
        onClose={() => setEdit(null)} />}
    </div>
  );
}

const S = {
  lead: { fontSize: 13, color: 'var(--text2)', margin: '0 0 12px', lineHeight: 1.6, maxWidth: 1000 },
  row: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  card: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, margin: '10px 0' },
  input: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', fontSize: 13, boxSizing: 'border-box' },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  mini: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, padding: '3px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  primary: { background: '#00b765', borderColor: '#00b765', color: '#fff' },
  lbl: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text2)', fontWeight: 600 },
  sub: { fontSize: 12, color: 'var(--text2)', fontWeight: 700 },
  grid: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  slide: { border: '1px solid var(--border)', borderRadius: 10, padding: 8, background: 'var(--surface2)' },
  note: { background: 'rgba(214,162,74,0.12)', border: '1px solid rgba(214,162,74,0.4)', color: '#d6a24a', borderRadius: 10, padding: '8px 12px', fontSize: 13, marginBottom: 10 },
  empty: { padding: 40, textAlign: 'center', color: 'var(--text2)' },
  err: { background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#f87171', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 10, cursor: 'pointer' },
  ok: { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 10, cursor: 'pointer' },
};
