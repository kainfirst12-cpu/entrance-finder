import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';

// 🗺 공시정보 지도 — 지금 목록의 학교(최대 300곳)와 출발 중학교를 OpenStreetMap 위에 찍는다.
// leaflet 은 이 창을 열 때만 불러온다(목록 화면 번들에 넣지 않음). 점 색 = 4년제 진학률(고교) 또는 학교 층.
const MAX = 300;

function colorOf(s) {
  const u = s.extra?.career?.[0]?.univ;
  if (typeof u !== 'number') return '#9ca3af';
  return u >= 60 ? '#16a34a' : u >= 45 ? '#2dd4bf' : u >= 30 ? '#d6a24a' : '#f87171';
}

export default function SchoolMap({ schools, origin, onClose, onOpen }) {
  const box = useRef(null);
  useEffect(() => {
    let map = null, dead = false;
    import('leaflet').then(({ default: L }) => {
      if (dead || !box.current) return;
      const pts = schools.filter((s) => s.loc).slice(0, MAX);
      map = L.map(box.current, { zoomControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(map);
      const bounds = [];
      for (const s of pts) {
        const m = L.circleMarker(s.loc, { radius: 7, color: '#fff', weight: 1.5, fillColor: colorOf(s), fillOpacity: 0.9 }).addTo(map);
        const u = s.extra?.career?.[0]?.univ;
        m.bindTooltip(`${s.schoolName}${typeof u === 'number' ? ` · 4년제 ${u}%` : ''}${s.dist != null ? ` · ${s.dist.toFixed(1)}km` : ''}`);
        m.on('click', () => onOpen?.(s.id));
        bounds.push(s.loc);
      }
      if (origin?.loc) {
        L.circleMarker(origin.loc, { radius: 9, color: '#111827', weight: 3, fillColor: '#fbbf24', fillOpacity: 1 }).addTo(map).bindTooltip(`출발: ${origin.schoolName}`, { permanent: true, direction: 'top' });
        bounds.push(origin.loc);
      }
      // 모달이 펼쳐지기 전에 만들어지면 지도가 크기를 0으로 잡아 타일이 한 장만 뜬다 → 한 박자 뒤 크기를 다시 재고 맞춘다
      const fit = () => { if (!map) return; map.invalidateSize(); if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 14 }); else map.setView([36.5, 127.8], 7); };
      fit();
      setTimeout(fit, 120);
    });
    return () => { dead = true; if (map) map.remove(); };
  }, [schools, origin, onOpen]);

  const shown = schools.filter((s) => s.loc).length;
  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.head}>
          <div>
            <h3 style={S.h3}>🗺 지도로 보기</h3>
            <div style={S.sub}>지금 목록 {schools.length}곳 중 위치를 아는 {Math.min(shown, MAX)}곳{shown > MAX ? ` (${MAX}곳까지 — 시도·시군구로 좁혀 주세요)` : ''} · 점을 누르면 상세가 열립니다</div>
          </div>
          <button style={S.btn} onClick={onClose}>✕</button>
        </div>
        <div ref={box} style={{ height: 'min(70vh, 620px)', borderRadius: 10, overflow: 'hidden', background: '#e5e7eb' }} />
        <div style={S.legend}>
          {[['#16a34a', '4년제 60%+'], ['#2dd4bf', '45~60%'], ['#d6a24a', '30~45%'], ['#f87171', '30% 미만'], ['#9ca3af', '진로 공시 없음'], ['#fbbf24', '출발 중학교']].map(([c, t]) => (
            <span key={t}><i style={{ ...S.dot, background: c }} />{t}</span>
          ))}
          <span style={{ marginLeft: 'auto' }}>위치: 공공데이터포털 전국초중등학교위치표준데이터 · 거리 = 직선거리</span>
        </div>
      </div>
    </div>
  );
}

const S = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 },
  modal: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16, width: 'min(1100px, 97vw)', maxHeight: '94vh', overflow: 'auto' },
  head: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', marginBottom: 10 },
  h3: { margin: 0, fontSize: 18, color: 'var(--text)' },
  sub: { fontSize: 12, color: 'var(--text2)', marginTop: 4 },
  btn: { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' },
  legend: { display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 11.5, color: 'var(--text2)', marginTop: 8, alignItems: 'center' },
  dot: { display: 'inline-block', width: 10, height: 10, borderRadius: 999, marginRight: 4, verticalAlign: 'middle' },
};
