import { useState } from 'react';
import { renderCommonSlide, LAYOUTS, LAYOUT_LABEL } from './commonSlides';
import { toForm, fromForm, FORM_FIELDS, IMAGE_LAYOUTS, shrinkImage } from './slideForm';
import SlidePreview from './SlidePreview';

// 슬라이드 한 장 고치기 창 — ① 공통본·③ 학원 소개 공용. 왼쪽 글자 칸, 오른쪽 실시간 미리보기.
// slide = 지금 슬라이드(chapter 포함), onApply(patch) = { layout, heading, data, source }
export default function SlideEditModal({ slide, chapters, onApply, onClose, layouts = LAYOUTS }) {
  const [form, setForm] = useState(() => toForm(slide));
  const [err, setErr] = useState('');
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const onPhoto = async (file) => {
    if (!file) return;
    setErr('');
    try { const im = await shrinkImage(file); setForm((f) => ({ ...f, src: im.src, w: im.w, h: im.h })); }
    catch (e) { setErr(e.message); }
  };
  const preview = { els: renderCommonSlide({ ...slide, ...fromForm(form) }, chapters) };
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={{ ...S.row, justifyContent: 'space-between', marginBottom: 8 }}>
          <b style={{ color: 'var(--text)' }}>✏ 슬라이드 고치기</b>
          <select style={S.input} value={form.layout}
            onChange={(e) => setForm((f) => ({ ...toForm({ layout: e.target.value, data: f.src ? { src: f.src, w: f.w, h: f.h } : {} }), heading: f.heading, source: f.source }))}>
            {layouts.map((l) => <option key={l} value={l}>{LAYOUT_LABEL[l]}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            {form.layout !== 'section' && <Field label="슬라이드 제목" v={form.heading} on={(x) => set('heading', x)} />}
            {IMAGE_LAYOUTS.has(form.layout) && (
              <div style={{ marginBottom: 8 }}>
                <label style={{ ...S.btn, display: 'inline-block' }}>📷 사진 {form.src ? '바꾸기' : '올리기'}
                  <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {form.src && <button style={{ ...S.btn, marginLeft: 6 }} onClick={() => setForm((f) => ({ ...f, src: undefined, w: undefined, h: undefined }))}>사진 빼기</button>}
                <div style={S.dim}>사진은 긴 변 1600px 로 줄여서 저장합니다.</div>
              </div>
            )}
            {(FORM_FIELDS[form.layout] || []).map(([k, label, multi]) => <Field key={k} label={label} multi={multi} v={form[k] || ''} on={(x) => set(k, x)} />)}
            <Field label="출처(선택)" v={form.source} on={(x) => set('source', x)} />
            <div style={S.dim}>**굵게** 로 감싸면 초록 강조가 됩니다.</div>
            {err && <div style={{ color: '#f87171', fontSize: 12 }}>{err}</div>}
          </div>
          <div><SlidePreview slide={preview} width={420} /></div>
        </div>
        <div style={{ ...S.row, justifyContent: 'flex-end', marginTop: 10 }}>
          <button style={S.btn} onClick={onClose}>취소</button>
          <button style={{ ...S.btn, ...S.primary }} onClick={() => onApply(fromForm(form))}>적용 (저장은 💾)</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, v, on, multi }) {
  return (
    <label style={{ display: 'block', marginBottom: 8, fontSize: 12, color: 'var(--text2)', fontWeight: 700 }}>{label}
      {multi ? <textarea rows={6} style={{ ...S.input, width: '100%', marginTop: 3, resize: 'vertical' }} value={v || ''} onChange={(e) => on(e.target.value)} />
        : <input style={{ ...S.input, width: '100%', marginTop: 3 }} value={v || ''} onChange={(e) => on(e.target.value)} />}
    </label>
  );
}

const S = {
  row: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  input: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 9px', fontSize: 13, boxSizing: 'border-box' },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 11px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' },
  primary: { background: '#00b765', borderColor: '#00b765', color: '#fff' },
  dim: { fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5, marginTop: 4 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, width: 'min(1000px, 96vw)', maxHeight: '92vh', overflow: 'auto' },
};
