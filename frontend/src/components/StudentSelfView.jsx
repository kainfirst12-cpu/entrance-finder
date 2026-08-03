import { useState, useRef } from 'react';
import { API_BASE } from '../apiBase';
import RoadmapView from './RoadmapView';

// 학생 셀프 페이지 — 선생님이 발급한 열람 코드만으로 본인 내용을 본다.
// 기록·배치는 읽기 전용이고, 로드맵 체크·수정과 내 자료 올리기는 학생이 직접 한다.
// 로그인 화면에서 진입. 토큰/계정 불필요 (코드 자체가 인증).

function mdPreview(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    if (/^[-=*]{3,}$/.test(t)) { html += '<hr style="border:none;border-top:1px solid #e3e9f1;margin:12px 0"/>'; i++; continue; }
    if (t.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i]); i++; }
      const rows = block.filter(l => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l));
      html += '<table style="border-collapse:collapse;width:100%;margin:8px 0">';
      rows.forEach((r, ri) => {
        const cells = r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        html += '<tr>' + cells.map(c =>
          `<${ri === 0 ? 'th' : 'td'} style="border:1px solid #d7dfea;padding:6px 9px;text-align:left;background:${ri === 0 ? '#f2f5f9' : '#fff'}">${inline(c)}</${ri === 0 ? 'th' : 'td'}>`).join('') + '</tr>';
      });
      html += '</table>';
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { html += `<h${h[1].length + 1} style="margin:14px 0 6px">${inline(h[2])}</h${h[1].length + 1}>`; i++; continue; }
    const b = t.match(/^[-*]\s+(.*)$/);
    if (b) { html += `<div style="margin:2px 0 2px 14px">• ${inline(b[1])}</div>`; i++; continue; }
    html += `<p style="margin:6px 0">${inline(t)}</p>`;
    i++;
  }
  return html;
}

const VERDICT_COLOR = {
  '안정': { color: '#1a7f4e', bg: '#e6f6ee', border: '#bfe8d2' },
  '적정': { color: '#1d6fd6', bg: '#e8f1fc', border: '#c3dcf7' },
  '소신': { color: '#b7791f', bg: '#fdf3e2', border: '#f3ddb0' },
  '위험': { color: '#d64545', bg: '#fdeaea', border: '#f5c6c6' },
};

export default function StudentSelfView({ onBack }) {
  const [code, setCode] = useState('');
  const [activeCode, setActiveCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null);
  const [openRec, setOpenRec] = useState(null);
  // 내 자료 올리기 (생기부 등) — 코드가 곧 인증
  const [upKind, setUpKind] = useState('생기부');
  const [uploading, setUploading] = useState(false);
  const [upMsg, setUpMsg] = useState('');
  const upRef = useRef(null);
  const [rmMsg, setRmMsg] = useState('');

  const fetchData = async (c) => {
    const res = await fetch(`${API_BASE}/api/student-view/${encodeURIComponent(c)}`);
    const j = await res.json();
    if (!j.success) throw new Error(j.message || '조회 실패');
    return j;
  };

  const lookup = async () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setLoading(true); setError('');
    try {
      setData(await fetchData(c));
      setActiveCode(c);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  // 로드맵 — 학생이 직접 체크·수정·삭제·추가 (코드가 곧 인증)
  const reload = async () => { try { setData(await fetchData(activeCode)); } catch (e) { setRmMsg('⚠ ' + e.message); } };
  const rmCall = async (path, opts = {}) => {
    setRmMsg('');
    const res = await fetch(`${API_BASE}/api/student-view/${encodeURIComponent(activeCode)}${path}`, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await res.json().catch(() => ({ success: false, message: '서버 응답 오류' }));
    if (!j.success) { setRmMsg('⚠ ' + (j.message || '처리 실패')); return false; }
    await reload();
    return true;
  };
  const rmToggle = (item) => rmCall(`/roadmap-items/${item.id}`, { method: 'PATCH', body: { done: !item.done } });
  const rmSaveItem = (item, form) => rmCall(`/roadmap-items/${item.id}`, { method: 'PATCH', body: form });
  const rmDeleteItem = (item) => rmCall(`/roadmap-items/${item.id}`, { method: 'DELETE' });
  const rmAddItem = (rm, f) => rmCall(`/roadmaps/${rm.id}/items`, { method: 'POST', body: f });

  if (!data) {
    return (
      <div style={S.center}>
        <div style={S.loginBox}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 34, marginBottom: 8 }}>🎒</div>
            <h1 style={{ color: '#fff', fontSize: 20, fontWeight: 700, margin: '0 0 6px' }}>내 기록 보기</h1>
            <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13, margin: 0 }}>
              선생님께 받은 학생 열람 코드를 입력하세요
            </p>
          </div>
          <input value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()}
            placeholder="예: S3F9A2C1B" style={S.codeInput} />
          {error && <p style={{ color: '#ff6b6b', fontSize: 13, margin: '10px 0 0', textAlign: 'center' }}>{error}</p>}
          <button onClick={lookup} disabled={loading} style={S.goBtn}>{loading ? '확인 중…' : '내 기록 보기'}</button>
          <button onClick={onBack} style={S.backLink}>← 선생님 로그인으로</button>
        </div>
      </div>
    );
  }

  const codeNow = () => (data?.student?.student_code || code).trim().toUpperCase();

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true); setUpMsg('');
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('kind', upKind);
      const res = await fetch(`${API_BASE}/api/student-view/${encodeURIComponent(codeNow())}/upload`, { method: 'POST', body: fd });
      const j = await res.json();
      if (!j.success) throw new Error(j.message || '업로드 실패');
      const failed = (j.files || []).filter((f) => f.error);
      setUpMsg(failed.length ? `일부 실패: ${failed.map(f => `${f.name}(${f.error})`).join(', ')}` : '✓ 업로드 완료 — 선생님이 확인 후 분석해 드려요');
      await lookup(); // 목록 갱신
    } catch (e) { setUpMsg('업로드 오류: ' + e.message); }
    finally { setUploading(false); if (upRef.current) upRef.current.value = ''; }
  };

  const deleteUpload = async (fileId) => {
    if (!window.confirm('이 파일을 삭제할까요?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/student-view/${encodeURIComponent(codeNow())}/files/${fileId}`, { method: 'DELETE' });
      const j = await res.json();
      if (!j.success) throw new Error(j.message || '삭제 실패');
      await lookup();
    } catch (e) { setUpMsg('삭제 오류: ' + e.message); }
  };

  const fmtSize = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

  const { student, records, placements, uploads = [], roadmaps = [] } = data;
  const allItems = roadmaps.flatMap(r => r.items || []);
  const doneCount = allItems.filter(i => i.done).length;
  return (
    <div style={S.viewPage}>
      <div style={S.viewShell}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 800, margin: 0, color: '#1c2733' }}>🎒 {student.name} 학생 페이지</h1>
            <p style={{ color: '#5c6b7c', fontSize: 13, margin: '4px 0 0' }}>
              {[student.school, student.grade, student.major && `희망 ${student.major}`, student.target_univ && `목표 ${student.target_univ}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={() => { setData(null); setCode(''); setActiveCode(''); }} style={S.outBtn}>나가기</button>
        </div>

        {roadmaps.length > 0 && (
          <>
            <div style={S.secTitle}>
              🗺 생기부 로드맵 — 하나씩 해내고 체크하세요
              <span style={{ float: 'right', fontSize: 12.5, fontWeight: 700, color: doneCount === allItems.length ? '#1a7f4e' : '#1d6fd6' }}>
                전체 {doneCount}/{allItems.length} 달성
              </span>
            </div>
            {rmMsg && <div style={{ color: '#d64545', fontSize: 12.5, margin: '0 0 8px' }}>{rmMsg}</div>}
            <RoadmapView
              roadmaps={roadmaps}
              renderMd={mdPreview}
              onToggle={rmToggle}
              onSaveItem={rmSaveItem}
              onDeleteItem={rmDeleteItem}
              onAddItem={rmAddItem}
            />
          </>
        )}

        {placements.length > 0 && (
          <>
            <div style={S.secTitle}>📈 배치 현황 (선생님이 저장한 지원 판정)</div>
            <div style={S.plList}>
              {placements.map((p) => {
                const v = VERDICT_COLOR[p.verdict] || { color: '#5c6b7c', bg: '#f2f5f9', border: '#e3e9f1' };
                const snap = p.snapshot || {};
                return (
                  <div key={p.id} style={S.plRow}>
                    <span style={{ ...S.plChip, color: v.color, background: v.bg, borderColor: v.border }}>{p.verdict || '—'}</span>
                    <span style={{ fontWeight: 700 }}>{String(p.univ_name).replace(/\[.*\]$/, '')}</span>
                    <span>{p.dept}</span>
                    <span style={{ color: '#8492a5', fontSize: 12 }}>{p.track}{p.type_name ? ` · ${p.type_name}` : ''}</span>
                    <span style={{ marginLeft: 'auto', color: '#8492a5', fontSize: 12 }}>
                      70%컷 {snap.cut70 != null ? Number(snap.cut70).toFixed(2) : '—'} · 내 내신 {p.grade != null ? Number(p.grade).toFixed(2) : '—'}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div style={S.secTitle}>📤 내 자료 올리기 (생기부 · 성적표)</div>
        <div style={{ background: '#f7f9fc', border: '1px solid #e3e9f1', borderRadius: 12, padding: '14px 16px' }}>
          <p style={{ fontSize: 13, color: '#5c6b7c', margin: '0 0 10px' }}>
            생활기록부(PDF 권장)나 성적표를 올리면 <b>선생님이 확인 후 분석</b>해 드려요. 분석 결과는 이 페이지의 기록으로 배정됩니다.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <select value={upKind} onChange={(e) => setUpKind(e.target.value)}
              style={{ padding: '8px 10px', borderRadius: 9, border: '1px solid #d7dfea', background: '#fff', fontSize: 13, color: '#26313e' }}>
              <option value="생기부">생기부</option>
              <option value="성적표">성적표</option>
              <option value="기타">기타 자료</option>
            </select>
            <button onClick={() => upRef.current?.click()} disabled={uploading}
              style={{ ...S.goBtn, width: 'auto', marginTop: 0, padding: '9px 18px', fontSize: 13.5 }}>
              {uploading ? '올리는 중…' : '📎 파일 선택해서 올리기'}
            </button>
            <input ref={upRef} type="file" multiple accept=".pdf,.docx,.hwp,.hwpx,.txt,image/*" style={{ display: 'none' }}
              onChange={(e) => uploadFiles(e.target.files)} />
            <span style={{ fontSize: 11.5, color: '#98a4b3' }}>파일당 30MB · PDF/워드/한글/사진</span>
          </div>
          {upMsg && <p style={{ fontSize: 12.5, margin: '8px 0 0', color: upMsg.startsWith('✓') ? '#1a7f4e' : '#d64545' }}>{upMsg}</p>}
          {uploads.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {uploads.map((f) => (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, background: '#fff', border: '1px solid #e3e9f1', borderRadius: 8, padding: '6px 10px' }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: '#1d6fd6', background: '#e8f1fc', borderRadius: 5, padding: '1px 7px', whiteSpace: 'nowrap' }}>
                    {String(f.kind || '').replace('학생업로드-', '') || '자료'}
                  </span>
                  <span style={{ flex: 1, fontWeight: 600, wordBreak: 'break-all' }}>{f.name}</span>
                  <span style={{ color: '#8492a5', whiteSpace: 'nowrap' }}>{fmtSize(f.size)} · {String(f.created_at).slice(0, 10)}</span>
                  <button onClick={() => deleteUpload(f.id)}
                    style={{ border: 'none', background: 'transparent', color: '#d64545', cursor: 'pointer', fontSize: 12 }}>삭제</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={S.secTitle}>📚 나에게 배정된 기록 ({records.length}건)</div>
        {!records.length && <div style={{ color: '#8492a5', fontSize: 13.5, padding: '8px 2px' }}>아직 배정된 기록이 없습니다.</div>}
        {records.map((r) => (
          <div key={r.id} style={S.recBox}>
            <div style={S.recHead} onClick={() => setOpenRec(openRec === r.id ? null : r.id)}>
              <span style={S.recType}>{r.type}</span>
              <span style={{ flex: 1, fontWeight: 700 }}>{r.title}</span>
              <span style={{ color: '#8492a5', fontSize: 12 }}>{String(r.created_at).slice(0, 10)}</span>
              <span style={{ color: '#1d6fd6', fontSize: 12, fontWeight: 700 }}>{openRec === r.id ? '닫기 ▲' : '펼치기 ▼'}</span>
            </div>
            {openRec === r.id && r.content && (
              <div style={S.recBody} dangerouslySetInnerHTML={{ __html: mdPreview(r.content) }} />
            )}
          </div>
        ))}

        <p style={{ fontSize: 11.5, color: '#98a4b3', marginTop: 18 }}>
          로드맵 체크·수정과 내 자료 올리기는 직접 할 수 있고, 선생님이 남긴 기록과 배치 현황은 읽기 전용입니다. 내용에 대한 질문은 선생님께 문의하세요. — 패스파인더 에듀
        </p>
      </div>
    </div>
  );
}

const S = {
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'linear-gradient(135deg, #0f1724 0%, #1a2a3a 100%)' },
  loginBox: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '44px 38px', width: 360, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' },
  codeInput: { width: '100%', padding: '14px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 16, letterSpacing: 2, textAlign: 'center', outline: 'none', boxSizing: 'border-box', textTransform: 'uppercase' },
  goBtn: { width: '100%', padding: 14, marginTop: 14, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, #5b86d6, #3a63b5)', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  backLink: { width: '100%', marginTop: 12, border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.45)', fontSize: 13, cursor: 'pointer' },
  viewPage: { minHeight: '100vh', background: '#eef2f7', padding: '26px 14px' },
  viewShell: { maxWidth: 820, margin: '0 auto', background: '#fff', borderRadius: 18, padding: '26px 28px', boxShadow: '0 8px 30px rgba(20,40,80,0.08)', color: '#26313e' },
  outBtn: { border: '1px solid #d7dfea', background: '#f7f9fc', color: '#5c6b7c', borderRadius: 9, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  secTitle: { fontSize: 14.5, fontWeight: 800, color: '#1c2733', margin: '22px 0 10px', paddingBottom: 6, borderBottom: '2px solid #eef2f7' },
  plList: { display: 'flex', flexDirection: 'column', gap: 6 },
  plRow: { display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, padding: '8px 10px', background: '#f7f9fc', border: '1px solid #eef2f7', borderRadius: 10, flexWrap: 'wrap' },
  plChip: { fontSize: 11.5, fontWeight: 800, borderWidth: 1, borderStyle: 'solid', borderRadius: 7, padding: '2px 9px' },
  recBox: { border: '1px solid #e3e9f1', borderRadius: 12, marginBottom: 8, overflow: 'hidden' },
  recHead: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer', background: '#fff', fontSize: 13.5, flexWrap: 'wrap' },
  recType: { fontSize: 11, fontWeight: 800, color: '#7a5fd0', background: '#f1edfc', borderRadius: 6, padding: '2px 8px', whiteSpace: 'nowrap' },
  recBody: { padding: '12px 18px', borderTop: '1px solid #eef2f7', background: '#fbfcfe', fontSize: 13.5, lineHeight: 1.75, color: '#333' },
};
