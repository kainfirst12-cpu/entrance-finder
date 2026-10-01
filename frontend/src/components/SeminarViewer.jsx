import { useEffect, useState } from 'react';
import { API_BASE } from '../apiBase';
import SlidePreview from '../seminar/SlidePreview';

// 🔗 설명회 자료 공유 링크 보기 — /deck/<token>. 로그인 없이 학부모님·학생이 휴대폰으로 슬라이드를 넘겨 본다.
// 슬라이드는 링크를 만든 순간 얼려 둔 요소 목록이라, 화면이 그대로 그린다(SlidePreview).
export default function SeminarViewer({ token }) {
  const [item, setItem] = useState(null);
  const [err, setErr] = useState('');
  const [w, setW] = useState(() => Math.min(1000, window.innerWidth - 24));
  const [one, setOne] = useState(null); // 크게 보는 슬라이드 번호(발표 보기)

  useEffect(() => {
    fetch(`${API_BASE}/api/public/seminar-share/${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((j) => { if (!j.success) throw new Error(j.message || '자료를 열지 못했습니다'); setItem(j.item); document.title = j.item.title; })
      .catch((e) => setErr(e.message));
    const onResize = () => setW(Math.min(1000, window.innerWidth - 24));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [token]);
  useEffect(() => {
    if (one === null || !item) return undefined;
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') setOne((i) => Math.min(item.slides.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setOne((i) => Math.max(0, i - 1));
      if (e.key === 'Escape') setOne(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [one, item]);

  if (err) return <div style={S.page}><div style={S.msg}>{err}</div></div>;
  if (!item) return <div style={S.page}><div style={S.msg}>불러오는 중…</div></div>;
  const big = Math.min(window.innerWidth - 16, (window.innerHeight - 70) * (16 / 9));
  return (
    <div style={S.page}>
      <header style={S.head}>
        <div style={S.title}>{item.title}</div>
        <div style={S.sub}>{item.academy ? `${item.academy} · ` : ''}{item.slides.length}장 · 슬라이드를 누르면 크게 봅니다</div>
      </header>
      <div style={S.list}>
        {item.slides.map((sl, i) => (
          <div key={i} onClick={() => setOne(i)} style={{ cursor: 'zoom-in' }}>
            <SlidePreview slide={sl} width={w} />
          </div>
        ))}
      </div>
      {one !== null && (
        <div style={S.overlay} onClick={() => setOne(null)}>
          <div onClick={(e) => e.stopPropagation()}><SlidePreview slide={item.slides[one]} width={big} /></div>
          <div style={S.nav} onClick={(e) => e.stopPropagation()}>
            <button style={S.btn} disabled={one === 0} onClick={() => setOne(one - 1)}>◀</button>
            <span style={{ color: '#fff', fontSize: 14 }}>{one + 1} / {item.slides.length}</span>
            <button style={S.btn} disabled={one === item.slides.length - 1} onClick={() => setOne(one + 1)}>▶</button>
            <button style={S.btn} onClick={() => setOne(null)}>닫기</button>
          </div>
        </div>
      )}
    </div>
  );
}

const S = {
  page: { minHeight: '100vh', background: '#eef0f3', padding: '12px 0 40px', fontFamily: "'Malgun Gothic', sans-serif" },
  head: { maxWidth: 1000, margin: '0 auto 12px', padding: '0 12px' },
  title: { fontSize: 20, fontWeight: 800, color: '#111' },
  sub: { fontSize: 13, color: '#666', marginTop: 4 },
  list: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  msg: { textAlign: 'center', marginTop: 80, color: '#555', fontSize: 15 },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 10 },
  nav: { display: 'flex', gap: 10, alignItems: 'center' },
  btn: { background: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
};
