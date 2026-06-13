import { useState, useRef } from 'react';
import { API_BASE } from '../apiBase';

// SSE(keepalive) 또는 JSON 응답 처리
async function postForResult(url, opts) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) return res.json();
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
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}

// 아주 가벼운 마크다운 → HTML (미리보기용: 제목/굵게/표/목록/줄바꿈)
function mdPreview(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  let html = '', i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { i++; continue; }
    if (t.startsWith('|')) {
      const block = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { block.push(lines[i]); i++; }
      const rows = block.filter(l => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l) || !l.includes('-'));
      html += '<table style="border-collapse:collapse;width:100%;margin:8px 0">';
      rows.forEach((r, ri) => {
        const cells = r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        html += '<tr>' + cells.map(c => {
          const inner = esc(c).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
          return `<${ri === 0 ? 'th' : 'td'} style="border:1px solid #d8d5cc;padding:6px 9px;text-align:left;background:${ri === 0 ? '#243341' : '#fff'};color:${ri === 0 ? '#fff' : '#1a2530'}">${inner}</${ri === 0 ? 'th' : 'td'}>`;
        }).join('') + '</tr>';
      });
      html += '</table>';
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const lv = h[1].length + 1;
      html += `<h${lv} style="margin:14px 0 6px">${esc(h[2]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</h${lv}>`;
      i++; continue;
    }
    const b = t.match(/^[-*]\s+(.*)$/);
    if (b) { html += `<div style="margin:2px 0 2px 14px">• ${esc(b[1]).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</div>`; i++; continue; }
    html += `<p style="margin:6px 0">${esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`;
    i++;
  }
  return html;
}

const GRADES = ['고1', '고2', '고3', '중1', '중2', '중3'];

export default function Assessment({ getActiveKey, selectedModel, aiGroup }) {
  const [mode, setMode] = useState('create'); // create | review
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('고2');
  const [kind, setKind] = useState('');
  const [topic, setTopic] = useState('');
  const [requirements, setRequirements] = useState('');
  const [referenceText, setReferenceText] = useState('');
  const [submissionText, setSubmissionText] = useState('');
  const [rubric, setRubric] = useState('');
  const [images, setImages] = useState([]); // {name, mimeType, base64, preview}
  const [studentName, setStudentName] = useState('');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState('');
  const [verifyResult, setVerifyResult] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [reviseInput, setReviseInput] = useState('');
  const [revising, setRevising] = useState(false);

  const refFileRef = useRef(null);
  const subFileRef = useRef(null);
  const imgRef = useRef(null);

  const token = () => localStorage.getItem('ef_token');

  const fileToBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  const addImages = async (fileList) => {
    const imgs = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    const added = [];
    for (const f of imgs) {
      try { added.push({ name: f.name || 'capture.png', mimeType: f.type || 'image/png', base64: await fileToBase64(f), preview: URL.createObjectURL(f) }); }
      catch {}
    }
    if (added.length) setImages(prev => [...prev, ...added].slice(0, 8));
  };
  const removeImage = (i) => setImages(prev => { const t = prev[i]; if (t?.preview) URL.revokeObjectURL(t.preview); return prev.filter((_, idx) => idx !== i); });
  const onPaste = (e) => {
    const items = e.clipboardData?.items; if (!items) return;
    const files = [];
    for (const it of items) if (it.kind === 'file' && it.type.startsWith('image/')) { const f = it.getAsFile(); if (f) files.push(f); }
    if (files.length) { e.preventDefault(); addImages(files); }
  };

  const extractFiles = async (fileList, target) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(target);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      const res = await fetch(`${API_BASE}/api/assessment/extract`, {
        method: 'POST',
        headers: { ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
        body: fd,
      });
      const data = await res.json();
      if (data.success && data.text) {
        if (target === 'ref') setReferenceText(prev => (prev ? prev + '\n\n' : '') + data.text);
        else setSubmissionText(prev => (prev ? prev + '\n\n' : '') + data.text);
      } else {
        setError(data.message || '파일에서 텍스트를 추출하지 못했습니다');
      }
    } catch (e) { setError('파일 업로드 오류: ' + e.message); }
    finally { setUploading(''); }
  };

  const generate = async () => {
    if (!subject.trim()) { setError('과목을 입력해주세요.'); return; }
    if (mode === 'create' && !topic.trim() && images.length === 0) { setError('주제/과제 설명을 입력하거나 양식 캡처를 올려주세요.'); return; }
    if (mode === 'review' && !submissionText.trim() && images.length === 0) { setError('평가할 학생 제출물을 입력/업로드하거나 캡처를 올려주세요.'); return; }
    const apiKey = getActiveKey?.();
    if (!apiKey) { setError('선택한 AI의 API 키가 설정에 없습니다.'); return; }

    setLoading(true); setError(''); setResult('');
    try {
      const data = await postForResult(`${API_BASE}/api/assessment/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-ai-model': aiGroup || 'claude',
          'x-ai-submodel': selectedModel || 'claude',
          ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
        },
        body: JSON.stringify({
          mode, subject, grade, kind, topic, requirements, referenceText, submissionText, rubric,
          images: images.map(i => ({ mimeType: i.mimeType, base64: i.base64 })),
        }),
      });
      if (data.success) {
        setResult(data.reply || '');
        // 학생 이름이 있으면 보드에 자동 기록 (선생님 코드 로그인 시)
        if (studentName.trim() && (localStorage.getItem('ef_role') || 'user') === 'user' && token()) {
          fetch(`${API_BASE}/api/board/upsert`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
            body: JSON.stringify({ name: studentName.trim(), grade, record: { type: '수행평가', title: `${subject}${kind ? ' ' + kind : ''}${mode === 'review' ? ' (첨삭)' : ''}`, content: data.reply || '' } }),
          }).catch(() => {});
        }
      } else setError(data.message || '생성 실패');
    } catch (e) { setError('요청 실패: ' + e.message); }
    finally { setLoading(false); }
  };

  const callMode = async (body) => {
    const apiKey = getActiveKey?.();
    if (!apiKey) { setError('선택한 AI의 API 키가 설정에 없습니다.'); return null; }
    return postForResult(`${API_BASE}/api/assessment/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'x-api-key': apiKey,
        'x-ai-model': aiGroup || 'claude', 'x-ai-submodel': selectedModel || 'claude',
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: JSON.stringify(body),
    });
  };

  const verify = async () => {
    setVerifying(true); setError(''); setVerifyResult('');
    try {
      const d = await callMode({ mode: 'verify', subject, grade, kind, current: result });
      if (d?.success) setVerifyResult(d.reply || ''); else if (d) setError(d.message || '검증 실패');
    } catch (e) { setError('검증 실패: ' + e.message); }
    finally { setVerifying(false); }
  };

  const revise = async () => {
    if (!reviseInput.trim()) return;
    setRevising(true); setError('');
    try {
      const d = await callMode({ mode: 'revise', subject, grade, kind, current: result, instruction: reviseInput });
      if (d?.success) { setResult(d.reply || result); setReviseInput(''); setVerifyResult(''); }
      else if (d) setError(d.message || '수정 실패');
    } catch (e) { setError('수정 실패: ' + e.message); }
    finally { setRevising(false); }
  };

  const docTitle = () => {
    const m = result.match(/^#\s+(.+)$/m);
    if (m) return m[1].trim();
    return `${subject || '수행평가'}${kind ? '_' + kind : ''}`;
  };

  const downloadDocx = async () => {
    if (!result.trim()) return;
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}/api/assessment/docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
        body: JSON.stringify({ title: docTitle(), markdown: result }),
      });
      if (!res.ok) { setError('문서 생성 실패'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${docTitle()}.docx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setError('다운로드 오류: ' + e.message); }
    finally { setDownloading(false); }
  };

  const assignStudent = async () => {
    let nm = studentName.trim();
    if (!nm) { nm = (window.prompt('어느 학생에게 배정할까요? 학생 이름:') || '').trim(); if (!nm) return; setStudentName(nm); }
    if (!token()) { alert('로그인이 필요합니다.'); return; }
    try {
      const r = await fetch(`${API_BASE}/api/board/upsert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ name: nm, grade, record: { type: '수행평가', title: `${subject}${kind ? ' ' + kind : ''}${mode === 'review' ? ' (첨삭)' : ''}`, content: result } }),
      });
      const d = await r.json();
      if (d.success) alert(`'${nm}' 학생 보드에 배정되었습니다.\n학생 카드 → '내용 보기'에서 확인할 수 있어요.`);
      else alert('배정 실패: ' + (d.message || '다시 로그인해 주세요'));
    } catch (e) { alert('배정 오류: ' + e.message); }
  };

  const copyAll = async () => {
    await navigator.clipboard.writeText(result);
    setCopied(true); setTimeout(() => setCopied(false), 1800);
  };

  const S = STYLES;
  return (
    <div style={S.page}>
      <h2 style={S.h2}>📝 수행평가 도우미</h2>
      <p style={S.lead}>주제만 주면 결과물 초안을 완성하고, 학생 제출물은 첨삭·평가해 드립니다. 결과는 Word(.docx)로 받을 수 있어요. <b>{selectedModel}</b> 모델 사용.</p>

      <div style={S.modeRow}>
        <button style={{ ...S.modeBtn, ...(mode === 'create' ? S.modeActive : {}) }} onClick={() => setMode('create')}>✍️ 결과물 작성</button>
        <button style={{ ...S.modeBtn, ...(mode === 'review' ? S.modeActive : {}) }} onClick={() => setMode('review')}>🔍 첨삭·평가</button>
      </div>

      <div style={S.card}>
        <div style={S.grid3}>
          <div>
            <label style={S.label}>과목</label>
            <input style={S.input} value={subject} onChange={e => setSubject(e.target.value)} placeholder="예: 국어, 통합과학, 한국사" />
          </div>
          <div>
            <label style={S.label}>학년</label>
            <select style={S.input} value={grade} onChange={e => setGrade(e.target.value)}>
              {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div>
            <label style={S.label}>유형</label>
            <input style={S.input} value={kind} onChange={e => setKind(e.target.value)} placeholder="예: 보고서, 글쓰기, 발표대본, 실험보고서" />
          </div>
        </div>

        <label style={S.label}>학생 이름 <span style={S.opt}>선택 — 입력하면 학생 보드에 자동 기록</span></label>
        <input style={S.input} value={studentName} onChange={e => setStudentName(e.target.value)} placeholder="예: 유석형" />

        <label style={S.label}>주제 / 과제 설명</label>
        <textarea style={S.textarea} rows={3} value={topic} onChange={e => setTopic(e.target.value)}
          placeholder={mode === 'create' ? '예: 기후변화가 우리 지역에 미치는 영향을 조사하고 대응 방안을 제시하시오.' : '학생이 수행한 과제의 주제를 적어주세요.'} />

        <label style={S.label}>요구사항 (분량·형식 등) <span style={S.opt}>선택</span></label>
        <textarea style={S.textarea} rows={2} value={requirements} onChange={e => setRequirements(e.target.value)}
          placeholder="예: A4 1장 내외, 서론-본론-결론 구성, 표 1개 이상 포함" />

        {mode === 'create' ? (
          <>
            <label style={S.label}>참고 자료 <span style={S.opt}>선택 — 교과서 발췌·자료 등을 올리거나 붙여넣으면 반영</span></label>
            <textarea style={S.textarea} rows={3} value={referenceText} onChange={e => setReferenceText(e.target.value)} placeholder="참고할 내용을 붙여넣거나 아래에서 파일을 올리세요." />
            <div style={S.fileRow}>
              <button style={S.fileBtn} onClick={() => refFileRef.current?.click()} disabled={uploading === 'ref'}>
                {uploading === 'ref' ? '추출 중...' : '📎 참고 파일 첨부 (pdf·docx·txt)'}
              </button>
              <input ref={refFileRef} type="file" multiple accept=".pdf,.docx,.txt,.md" style={{ display: 'none' }}
                onChange={e => { extractFiles(e.target.files, 'ref'); e.target.value = ''; }} />
            </div>
          </>
        ) : (
          <>
            <label style={S.label}>학생 제출물 <span style={S.opt}>붙여넣거나 파일로 올리세요</span></label>
            <textarea style={S.textarea} rows={6} value={submissionText} onChange={e => setSubmissionText(e.target.value)} placeholder="학생이 제출한 글을 붙여넣으세요." />
            <div style={S.fileRow}>
              <button style={S.fileBtn} onClick={() => subFileRef.current?.click()} disabled={uploading === 'sub'}>
                {uploading === 'sub' ? '추출 중...' : '📎 제출물 파일 첨부 (pdf·docx·txt)'}
              </button>
              <input ref={subFileRef} type="file" multiple accept=".pdf,.docx,.txt,.md" style={{ display: 'none' }}
                onChange={e => { extractFiles(e.target.files, 'sub'); e.target.value = ''; }} />
            </div>
            <label style={S.label}>평가 기준 / 루브릭 <span style={S.opt}>선택</span></label>
            <textarea style={S.textarea} rows={2} value={rubric} onChange={e => setRubric(e.target.value)} placeholder="예: 내용 충실성 40, 논리성 30, 표현 20, 형식 10" />
          </>
        )}

        <label style={S.label}>양식·자료 캡처 / 이미지 첨부 <span style={S.opt}>선택 — 과제 안내문, 손글씨, 표 등을 사진/캡처로. AI가 직접 읽습니다 (Ctrl+V 붙여넣기 가능)</span></label>
        <div style={S.fileRow} onPaste={onPaste}>
          <button style={S.fileBtn} onClick={() => imgRef.current?.click()}>📷 이미지/캡처 첨부</button>
          <input ref={imgRef} type="file" accept="image/*" multiple capture="environment" style={{ display: 'none' }}
            onChange={e => { addImages(e.target.files); e.target.value = ''; }} />
          {images.length > 0 && (
            <div style={S.thumbs}>
              {images.map((img, i) => (
                <div key={i} style={S.thumb}>
                  <img src={img.preview} alt={img.name} style={S.thumbImg} />
                  <button style={S.thumbDel} onClick={() => removeImage(i)} title="삭제">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div style={S.error}>{error}</div>}

        <button style={{ ...S.genBtn, opacity: loading ? 0.6 : 1 }} onClick={generate} disabled={loading}>
          {loading ? '⏳ 생성 중... (최대 1~2분)' : (mode === 'create' ? '✨ 결과물 작성하기' : '🔍 첨삭·평가하기')}
        </button>
      </div>

      {result && (
        <div style={S.card}>
          <div style={S.resultHead}>
            <span style={S.resultTitle}>결과 <span style={S.opt}>아래에서 자유롭게 수정한 뒤 Word로 받으세요</span></span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={S.assignBtn} onClick={assignStudent}>📋 학생에게 배정</button>
              <button style={S.docxBtn} onClick={downloadDocx} disabled={downloading}>{downloading ? '생성 중...' : '📄 Word(.docx) 다운로드'}</button>
              <button style={S.ghostBtn} onClick={copyAll}>{copied ? '복사됨!' : '복사'}</button>
            </div>
          </div>
          <textarea style={S.resultEdit} rows={14} value={result} onChange={e => setResult(e.target.value)} />
          <div style={S.previewLabel}>미리보기</div>
          <div style={S.preview} dangerouslySetInnerHTML={{ __html: mdPreview(result) }} />

          {/* AI 검증 + 수정 요청 */}
          <div style={S.aiToolRow}>
            <button style={S.verifyBtn} onClick={verify} disabled={verifying || revising}>{verifying ? '검증 중...' : '🔍 AI 검증 (점검·보완점)'}</button>
          </div>
          {verifyResult && (
            <div style={S.verifyPanel}>
              <div style={S.verifyTitle}>검증 결과</div>
              <div style={{ fontSize: 13.5, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: mdPreview(verifyResult) }} />
              <div style={S.verifyHint}>아래 "수정 요청"에 반영할 내용을 적어 보내면 결과물이 자동으로 다듬어집니다.</div>
            </div>
          )}
          <div style={S.reviseRow}>
            <input style={S.input} value={reviseInput} onChange={e => setReviseInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && revise()} disabled={revising}
              placeholder="AI에게 수정 요청 (예: 결론을 더 강하게, 표 추가, 분량 줄이기)" />
            <button style={S.reviseBtn} onClick={revise} disabled={revising || !reviseInput.trim()}>{revising ? '수정 중...' : '✏️ 수정 요청'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

const STYLES = {
  page: { padding: '28px 32px', maxWidth: 920, margin: '0 auto', color: '#e8eef3' },
  h2: { fontSize: 22, fontWeight: 700, margin: '0 0 6px' },
  lead: { color: '#9db0bd', fontSize: 13.5, margin: '0 0 18px', lineHeight: 1.5 },
  modeRow: { display: 'flex', gap: 8, marginBottom: 16 },
  modeBtn: { flex: 1, padding: '12px', borderRadius: 10, border: '1px solid #d8d5cc', background: '#16212e', color: '#9db0bd', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' },
  modeActive: { borderColor: '#14b8a6', color: '#14b8a6', background: 'rgba(45,212,191,0.15)' },
  card: { background: '#16212e', border: '1px solid #e8e6df', borderRadius: 14, padding: 22, marginBottom: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 110px 1fr', gap: 12, marginBottom: 6 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#e8eef3', margin: '12px 0 6px' },
  opt: { fontWeight: 400, color: '#6b7d8a', fontSize: 12 },
  input: { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #d8d5cc', background: '#16212e', color: '#e8eef3', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #d8d5cc', background: '#16212e', color: '#e8eef3', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 },
  fileRow: { marginTop: 8 },
  fileBtn: { background: '#131c26', color: '#e8eef3', border: '1px solid #d8d5cc', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 },
  thumbs: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  thumb: { position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: '1px solid #d8d5cc' },
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' },
  thumbDel: { position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: '18px', padding: 0 },
  error: { background: 'rgba(248,113,113,0.14)', border: '1px solid #fca5a5', color: '#f87171', padding: '10px 14px', borderRadius: 9, fontSize: 13.5, marginTop: 14 },
  genBtn: { width: '100%', marginTop: 18, padding: '14px', borderRadius: 10, border: 'none', background: '#14b8a6', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  resultHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  resultTitle: { fontSize: 15, fontWeight: 700 },
  assignBtn: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13.5 },
  docxBtn: { background: '#34d399', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13.5 },
  ghostBtn: { background: '#131c26', color: '#e8eef3', border: '1px solid #d8d5cc', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontSize: 13.5 },
  resultEdit: { width: '100%', padding: '12px 14px', borderRadius: 9, border: '1px solid #d8d5cc', background: '#1c2937', color: '#e8eef3', fontSize: 13.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' },
  previewLabel: { fontSize: 12, color: '#6b7d8a', fontWeight: 600, margin: '16px 0 6px' },
  preview: { border: '1px solid #e8e6df', borderRadius: 9, padding: '16px 18px', background: '#16212e', fontSize: 14, lineHeight: 1.6, color: '#e8eef3' },
  aiToolRow: { display: 'flex', gap: 8, marginTop: 16 },
  verifyBtn: { background: 'rgba(144,112,216,0.16)', color: '#7c3aed', border: '1px solid #dccdf6', borderRadius: 9, padding: '10px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13.5 },
  verifyPanel: { marginTop: 12, padding: '14px 16px', borderRadius: 10, border: '1px solid #dccdf6', background: 'rgba(139,111,216,0.16)' },
  verifyTitle: { fontSize: 13.5, fontWeight: 700, color: '#7c3aed', marginBottom: 8 },
  verifyHint: { fontSize: 12, color: '#6b7d8a', marginTop: 10 },
  reviseRow: { display: 'flex', gap: 8, marginTop: 12 },
  reviseBtn: { background: '#14b8a6', color: '#fff', border: 'none', borderRadius: 9, padding: '10px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13.5, whiteSpace: 'nowrap' },
};
