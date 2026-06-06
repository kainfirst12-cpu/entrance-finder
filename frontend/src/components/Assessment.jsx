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
          return `<${ri === 0 ? 'th' : 'td'} style="border:1px solid #d8d5cc;padding:6px 9px;text-align:left;background:${ri === 0 ? '#f0eee8' : '#fff'}">${inner}</${ri === 0 ? 'th' : 'td'}>`;
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

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState('');

  const refFileRef = useRef(null);
  const subFileRef = useRef(null);

  const token = () => localStorage.getItem('ef_token');

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
    if (mode === 'create' && !topic.trim()) { setError('주제/과제 설명을 입력해주세요.'); return; }
    if (mode === 'review' && !submissionText.trim()) { setError('평가할 학생 제출물을 입력하거나 파일로 올려주세요.'); return; }
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
        body: JSON.stringify({ mode, subject, grade, kind, topic, requirements, referenceText, submissionText, rubric }),
      });
      if (data.success) setResult(data.reply || '');
      else setError(data.message || '생성 실패');
    } catch (e) { setError('요청 실패: ' + e.message); }
    finally { setLoading(false); }
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
              <button style={S.docxBtn} onClick={downloadDocx} disabled={downloading}>{downloading ? '생성 중...' : '📄 Word(.docx) 다운로드'}</button>
              <button style={S.ghostBtn} onClick={copyAll}>{copied ? '복사됨!' : '복사'}</button>
            </div>
          </div>
          <textarea style={S.resultEdit} rows={14} value={result} onChange={e => setResult(e.target.value)} />
          <div style={S.previewLabel}>미리보기</div>
          <div style={S.preview} dangerouslySetInnerHTML={{ __html: mdPreview(result) }} />
        </div>
      )}
    </div>
  );
}

const STYLES = {
  page: { padding: '28px 32px', maxWidth: 920, margin: '0 auto', color: '#1a1916' },
  h2: { fontSize: 22, fontWeight: 700, margin: '0 0 6px' },
  lead: { color: '#6b6860', fontSize: 13.5, margin: '0 0 18px', lineHeight: 1.5 },
  modeRow: { display: 'flex', gap: 8, marginBottom: 16 },
  modeBtn: { flex: 1, padding: '12px', borderRadius: 10, border: '1px solid #d8d5cc', background: '#fff', color: '#6b6860', fontSize: 14.5, fontWeight: 600, cursor: 'pointer' },
  modeActive: { borderColor: '#2d5be3', color: '#2d5be3', background: '#eef1fc' },
  card: { background: '#fff', border: '1px solid #e8e6df', borderRadius: 14, padding: 22, marginBottom: 18, boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  grid3: { display: 'grid', gridTemplateColumns: '1fr 110px 1fr', gap: 12, marginBottom: 6 },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#1a1916', margin: '12px 0 6px' },
  opt: { fontWeight: 400, color: '#9b9890', fontSize: 12 },
  input: { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #d8d5cc', background: '#fff', color: '#1a1916', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #d8d5cc', background: '#fff', color: '#1a1916', fontSize: 14, outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 },
  fileRow: { marginTop: 8 },
  fileBtn: { background: '#f5f4f0', color: '#1a1916', border: '1px solid #d8d5cc', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontSize: 13 },
  error: { background: '#fef2f2', border: '1px solid #fca5a5', color: '#dc2626', padding: '10px 14px', borderRadius: 9, fontSize: 13.5, marginTop: 14 },
  genBtn: { width: '100%', marginTop: 18, padding: '14px', borderRadius: 10, border: 'none', background: '#2d5be3', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  resultHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 },
  resultTitle: { fontSize: 15, fontWeight: 700 },
  docxBtn: { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 13.5 },
  ghostBtn: { background: '#f5f4f0', color: '#1a1916', border: '1px solid #d8d5cc', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', fontSize: 13.5 },
  resultEdit: { width: '100%', padding: '12px 14px', borderRadius: 9, border: '1px solid #d8d5cc', background: '#fcfbf9', color: '#1a1916', fontSize: 13.5, outline: 'none', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' },
  previewLabel: { fontSize: 12, color: '#9b9890', fontWeight: 600, margin: '16px 0 6px' },
  preview: { border: '1px solid #e8e6df', borderRadius: 9, padding: '16px 18px', background: '#fff', fontSize: 14, lineHeight: 1.6, color: '#1a1916' },
};
