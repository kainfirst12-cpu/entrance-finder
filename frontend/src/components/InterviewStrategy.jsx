import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../apiBase';
import SendToPapa from './SendToPapa';
import StudentPicker from './StudentPicker';
import { univLabel } from '../univName';
import { buildInterviewHtml } from '../interviewReport';
import guideHtml from '../interview/guide.html?raw';
import exampleHtml from '../interview/example.html?raw';

// 면접 전략 — 학생부 + 지원 카드(대학·학과·전형) → 대학별 면접 문항·예시 답안·평가표 매핑 리포트.
// 결과는 사용설명서·예시 리포트와 같은 A4 가로 디자인(interviewReport.js)으로 그려 인쇄·저장한다.

const token = () => localStorage.getItem('ef_token');

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  // 401(세션 만료)만 로그아웃으로 이어진다. 403 은 '이 학원 코드에 안 열린 메뉴·관리자 전용' 이라 서버 메시지만 보여 준다 —
  // 403 까지 auth 로 보던 시절엔 잠긴 보관함에 저장이 막히는 순간 로그인 화면으로 튕겼다(원장 제보 2026-09-22).
  if (res.status === 401 || res.status === 403) { let m = res.status === 401 ? '로그인이 필요합니다' : '이 학원 코드에는 열려 있지 않은 기능입니다'; try { m = (await res.json()).message || m; } catch { /* 본문 없음 */ } const e = new Error(m); e.auth = res.status === 401; throw e; }
  return res.json();
}

// SSE(keepalive) 응답 — 마지막 data 를 결과로, 중간 data 는 onEvent 로
async function postSSE(url, opts, onEvent) {
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
      if (!line.startsWith('data: ')) continue;
      try { const d = JSON.parse(line.slice(6)); result = d; onEvent?.(d); } catch {}
    }
  }
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}

const emptyCard = () => ({ univ: '', dept: '', track: '', interview: 'auto', memo: '' });

// 배치 기록(입결 콘솔 저장분)을 지원 카드로 — 같은 대학·학과·전형은 한 번만
function cardsFromPlacements(placements = []) {
  const seen = new Set(), out = [];
  for (const p of placements) {
    const univ = univLabel(p.univ_name || '').replace(/대학교$/, '대');
    const track = [p.track, p.type_name].filter(Boolean).join(' ');
    const key = `${univ}|${p.dept}|${track}`;
    if (!univ || seen.has(key)) continue;
    seen.add(key);
    out.push({ univ, dept: p.dept || '', track, interview: 'auto', memo: '' });
  }
  return out.slice(0, 6);
}

export default function InterviewStrategy({ getActiveKey, selectedModel, aiGroup, onAuthError }) {
  // 학생·자료
  const [student, setStudent] = useState(null);
  const [profile, setProfile] = useState({ name: '', school: '', grade: '', major: '' });
  const [recordText, setRecordText] = useState('');
  const [recordSource, setRecordSource] = useState('');
  const [extracting, setExtracting] = useState(false);
  const fileRef = useRef(null);
  // 지원 카드·옵션
  const [cards, setCards] = useState([emptyCard(), emptyCard(), emptyCard()]);
  const [univs, setUnivs] = useState([]);
  const [questionCount, setQuestionCount] = useState(10);
  const [year, setYear] = useState('2027');
  // 생성
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);   // { data, savedId, studentId, studentName }
  const [html, setHtml] = useState('');
  // 보관 목록·문서 보기
  const [items, setItems] = useState([]);
  const [listMsg, setListMsg] = useState('');
  const [doc, setDoc] = useState(null); // { title, html }

  const load = useCallback(() => {
    api('/api/interview')
      .then((j) => { if (j.success) { setItems(j.items || []); setListMsg(''); } else setListMsg(j.message || '목록 로드 실패'); })
      .catch((e) => { if (e.auth) onAuthError?.(); else setListMsg(e.message); });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api('/api/univ-info/list').then((j) => { if (j.success) setUnivs((j.universities || []).map((u) => univLabel(u.name))); }).catch(() => {});
  }, []);

  // ── 학생 선택 → 생기부 분석 기록·배치를 불러와 미리 채운다 ──
  const pickStudent = async (s) => {
    setStudent(s);
    if (!s) return;
    setProfile({ name: s.name || '', school: s.school || '', grade: s.grade || '', major: s.major || '' });
    try {
      const j = await api(`/api/board/students/${s.id}/context`);
      if (!j.success) return;
      const rec = (j.records || []).find((r) => r.type === '생기부 분석' && r.content)
        || (j.records || []).find((r) => r.type === '컨설턴트 브리핑' && r.content);
      if (rec) {
        setRecordText(rec.content);
        setRecordSource(`${rec.type} · ${rec.title} (${String(rec.created_at).slice(0, 10)})`);
      } else {
        setRecordSource('이 학생에게 저장된 생기부 분석이 없습니다 — 생기부 PDF를 올리거나 내용을 붙여넣어 주세요.');
      }
      const fromP = cardsFromPlacements(j.placements || []);
      if (fromP.length) setCards(fromP);
    } catch (e) { if (e.auth) onAuthError?.(); }
  };

  // ── 생기부 PDF/문서 → 텍스트 ──
  const onFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setExtracting(true); setError('');
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      const apiKey = getActiveKey?.();
      const d = await postSSE(`${API_BASE}/api/assessment/extract`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, ...(apiKey ? { 'x-api-key': apiKey, 'x-ai-model': aiGroup || 'claude', 'x-ai-submodel': selectedModel || 'claude' } : {}) },
        body: fd,
      });
      if (!d.success) throw new Error(d.message || '추출 실패');
      if (!d.text?.trim()) throw new Error('텍스트를 추출하지 못했습니다 (스캔본이면 설정에 AI 키를 등록해 주세요)');
      setRecordText((prev) => (prev ? prev + '\n\n' : '') + d.text);
      setRecordSource(`업로드: ${files.map((f) => f.name).join(', ')}`);
    } catch (e) { setError('추출 오류: ' + e.message); }
    finally { setExtracting(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const setCard = (i, patch) => setCards((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const removeCard = (i) => setCards((cs) => cs.filter((_, k) => k !== i));

  // ── 생성 — 서버 백그라운드 작업을 걸고 상태를 폴링한다 ──
  // 카드 6장이면 10분이 넘는다. 한 연결에 매달지 않으므로 화면을 옮기거나 새로고침해도 이어서 받는다(JOB_KEY).
  const JOB_KEY = 'ef_interview_job';
  const pollJob = async (jobId) => {
    setRunning(true); setError('');
    try { localStorage.setItem(JOB_KEY, jobId); } catch {}
    let misses = 0;
    while (true) {
      let j;
      try { j = await api(`/api/interview/jobs/${jobId}`); }
      catch (e) {
        if (e.auth) { onAuthError?.(); return; }
        if (++misses > 20) throw new Error('서버 상태를 오래 받지 못했습니다 — 보관함 목록을 새로고침해 저장된 리포트를 확인해 주세요.');
        await new Promise((r) => setTimeout(r, 5000)); continue;
      }
      if (!j.success) throw new Error(j.message || '작업 상태를 받지 못했습니다');
      const job = j.job;
      if (job.status === 'running') {
        const mins = Math.round((Date.now() - job.startedAt) / 60000);
        setProgress(`${job.message || '작업 중…'}${mins ? ` · ${mins}분 경과` : ''}`);
        await new Promise((r) => setTimeout(r, 3000)); continue;
      }
      try { localStorage.removeItem(JOB_KEY); } catch {}
      if (job.status === 'done' && job.data) {
        const data = job.data;
        setResult({ data, savedId: job.savedId || null, studentId: student?.id || null, studentName: data.studentName || profile.name });
        setHtml(buildInterviewHtml(data));
        setNotice(job.savedId ? '✓ 리포트가 만들어졌고 보관함에 저장됐습니다. 아래에서 확인하고 인쇄하세요.' : '✓ 리포트가 만들어졌습니다. 아래에서 확인하고 인쇄하거나 저장하세요.');
        load();
        return;
      }
      const p = job.partial || {};
      throw new Error(`${job.error || '생성 실패'}${p.overview ? ` (개요와 면접 ${p.interviews?.length || 0}개 카드까지는 만들어졌으나 저장되지 않았습니다 — 다시 시도해 주세요)` : ''}`);
    }
  };

  const generate = async () => {
    const list = cards.filter((c) => c.univ.trim());
    if (!list.length) { setError('지원 카드에 대학을 하나 이상 적어 주세요.'); return; }
    const apiKey = getActiveKey?.();
    if (!apiKey) { setError('선택한 AI의 API 키가 설정에 없습니다.'); return; }
    setRunning(true); setError(''); setNotice(''); setResult(null); setHtml('');
    setProgress('시작하는 중…');
    try {
      const d = await api('/api/interview/generate', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'x-ai-model': aiGroup || 'claude', 'x-ai-submodel': selectedModel || 'claude' },
        body: {
          student: { ...profile, id: student?.id || null },
          cards: list.map((c) => ({ univ: c.univ.trim(), dept: c.dept.trim(), track: c.track.trim(), memo: c.memo.trim(), interview: c.interview === 'auto' ? null : c.interview === 'yes' })),
          recordText, options: { questionCount, year },
        },
      });
      if (!d.success || !d.jobId) throw new Error(d.message || '생성을 시작하지 못했습니다');
      await pollJob(d.jobId);
    } catch (e) { if (e.auth) onAuthError?.(); else setError('생성 오류: ' + e.message); }
    finally { setRunning(false); setProgress(''); }
  };

  // 새로고침·화면 이동 뒤 돌아오면 진행 중이던 작업을 이어서 받는다
  useEffect(() => {
    let jobId = '';
    try { jobId = localStorage.getItem(JOB_KEY) || ''; } catch {}
    if (!jobId) return;
    pollJob(jobId).catch((e) => setError('생성 오류: ' + e.message)).finally(() => { setRunning(false); setProgress(''); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reportTitle = (data) => `${data.studentName ? `${data.studentName} ` : ''}${data.year || year} ${data.major || ''} 대학별 면접 전략`.replace(/\s+/g, ' ').trim();

  const save = async () => {
    if (!result?.data) return;
    try {
      const j = await api('/api/interview', { method: 'POST', body: {
        studentId: result.studentId, studentName: result.studentName, title: reportTitle(result.data),
        cards: (result.data.cards || []).map((c) => ({ univ: c.univ, dept: c.dept, track: c.track, interview: !!c.interview })),
        data: result.data,
      } });
      if (!j.success) throw new Error(j.message || '저장 실패');
      setResult((r) => ({ ...r, savedId: j.item.id }));
      setNotice('✓ 저장되었습니다. 아래 목록에서 언제든 다시 열 수 있습니다.');
      load();
    } catch (e) { if (e.auth) onAuthError?.(); else setError('저장 오류: ' + e.message); }
  };

  const assign = async (id, sid) => {
    try {
      const j = await api(`/api/interview/${id}/assign`, { method: 'POST', body: { studentId: sid } });
      if (!j.success) throw new Error(j.message || '배정 실패');
      setNotice('✓ 학생 기록에 문항·예시 답안이 배정되었습니다. 학생 보드와 학생 열람 코드 페이지에서 볼 수 있습니다.');
    } catch (e) { if (e.auth) onAuthError?.(); else setError('배정 오류: ' + e.message); }
  };

  const openSaved = async (row) => {
    try {
      const j = await api(`/api/interview/${row.id}`);
      if (!j.success) throw new Error(j.message || '열기 실패');
      const data = j.item.data || {};
      setResult({ data, savedId: j.item.id, studentId: j.item.student_id, studentName: j.item.student_name });
      setHtml(buildInterviewHtml({ ...data, studentName: data.studentName || j.item.student_name }));
      setNotice(`✓ '${j.item.title}' 을(를) 열었습니다.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { if (e.auth) onAuthError?.(); else setError(e.message); }
  };

  const remove = async (row) => {
    if (!confirm(`'${row.title}' 리포트를 삭제할까요?`)) return;
    try { const j = await api(`/api/interview/${row.id}`, { method: 'DELETE' }); if (j.success) load(); }
    catch (e) { if (e.auth) onAuthError?.(); }
  };

  const openWindow = (h) => {
    const w = window.open('', '_blank');
    if (!w) { setError('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.'); return; }
    w.document.open(); w.document.write(h); w.document.close();
  };

  const ivCount = result?.data?.interviews?.length || 0;

  return (
    <div style={S.page}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={S.h2}>🎤 면접 전략</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={S.btn} onClick={() => setDoc({ title: '사용설명서', html: guideHtml })}>📖 사용설명서</button>
          <button style={S.btn} onClick={() => setDoc({ title: '예시 리포트', html: exampleHtml })}>📄 예시 리포트</button>
        </div>
      </div>
      <p style={S.lead}>
        학생부와 지원 대학·학과·전형을 넣으면 대학별 평가요소에 학생부를 배치하고, 면접 문항·꼬리질문·예시 답안·진위 검증·2주 연습 계획을
        한 권의 A4 가로 리포트로 만듭니다. 면접이 없는 전형은 서류평가 관점으로 따로 정리합니다. 먼저 <b>📖 사용설명서</b>와 <b>📄 예시 리포트</b>를 열어 보세요.
      </p>

      {error && <div style={S.error}>⚠ {error}</div>}
      {notice && <div style={S.notice}>{notice} <button style={S.dismiss} onClick={() => setNotice('')}>✕</button></div>}

      {/* ① 학생·학생부 */}
      <div style={S.card}>
        <div style={S.secTitle}>① 학생과 학생부 자료</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
          <StudentPicker value={student} onChange={pickStudent} style={{ ...S.input, minWidth: 220 }} placeholder="학생 보드에서 선택 (선택 시 생기부 분석·배치 자동 반영)" />
          <input style={{ ...S.input, width: 110 }} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} placeholder="학생 이름" />
          <input style={{ ...S.input, width: 130 }} value={profile.school} onChange={(e) => setProfile({ ...profile, school: e.target.value })} placeholder="학교" />
          <input style={{ ...S.input, width: 70 }} value={profile.grade} onChange={(e) => setProfile({ ...profile, grade: e.target.value })} placeholder="학년" />
          <input style={{ ...S.input, width: 150 }} value={profile.major} onChange={(e) => setProfile({ ...profile, major: e.target.value })} placeholder="지원 전공 (예: 법학과)" />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <button style={S.btn} onClick={() => fileRef.current?.click()} disabled={extracting}>
            {extracting ? '추출 중… (스캔본은 분량에 따라 몇 분)' : '📎 생기부 올리기 (PDF·docx·hwp·txt)'}
          </button>
          <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.hwp,.hwpx" multiple style={{ display: 'none' }} onChange={(e) => onFiles(e.target.files)} />
          {recordSource && <span style={S.fileChip}>📄 {recordSource}</span>}
          {recordText && <button style={{ ...S.btn, padding: '6px 10px' }} onClick={() => { setRecordText(''); setRecordSource(''); }}>비우기</button>}
        </div>
        <textarea style={S.textarea} rows={5} value={recordText} onChange={(e) => setRecordText(e.target.value)}
          placeholder="학생부 원문·생기부 분석 본문을 여기에. 비워 두면 학생부 없는 간편 모드(대학·학과·전형 기반 공통 문항, 개인 경험은 [학생 경험] 자리 표시)로 만듭니다." />
      </div>

      {/* ② 지원 카드 */}
      <div style={S.card}>
        <div style={S.secTitle}>② 지원 카드 (대학 · 학과 · 전형) — 전형명이 핵심입니다. 같은 학과도 전형에 따라 면접이 없거나 유형이 달라집니다.</div>
        <datalist id="ef-univ-list">{univs.map((u) => <option key={u} value={u} />)}</datalist>
        {cards.map((c, i) => (
          <div key={i} style={S.cardRow}>
            <span style={S.rowNum}>{i + 1}</span>
            <input style={{ ...S.input, flex: '1 1 150px' }} list="ef-univ-list" value={c.univ} onChange={(e) => setCard(i, { univ: e.target.value })} placeholder="대학 (예: 숭실대)" />
            <input style={{ ...S.input, flex: '1 1 130px' }} value={c.dept} onChange={(e) => setCard(i, { dept: e.target.value })} placeholder="학과 (예: 법학과)" />
            <input style={{ ...S.input, flex: '1 1 170px' }} value={c.track} onChange={(e) => setCard(i, { track: e.target.value })} placeholder="전형명 (예: 기회균형, 광운참빛인재Ⅰ-면접형)" />
            <select style={{ ...S.input, flex: '0 0 130px' }} value={c.interview} onChange={(e) => setCard(i, { interview: e.target.value })} title="면접 유무를 알면 지정하세요. '자료로 판단'은 입시가이드·지식베이스로 AI가 판단합니다.">
              <option value="auto">면접: 자료로 판단</option>
              <option value="yes">면접 있음</option>
              <option value="no">면접 없음 (서류 100%)</option>
            </select>
            <input style={{ ...S.input, flex: '1 1 150px' }} value={c.memo} onChange={(e) => setCard(i, { memo: e.target.value })} placeholder="메모 (예: 2단계 면접 50%, 12분)" />
            <button style={{ ...S.btn, padding: '6px 9px', color: '#f87171' }} onClick={() => removeCard(i)} disabled={cards.length <= 1} title="카드 삭제">✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <button style={S.btn} onClick={() => setCards((cs) => [...cs, emptyCard()])} disabled={cards.length >= 8}>＋ 카드 추가</button>
          <label style={S.optLabel}>문항 수
            <select style={S.input} value={questionCount} onChange={(e) => setQuestionCount(Number(e.target.value))}>
              {[6, 8, 10, 12].map((n) => <option key={n} value={n}>{n}개</option>)}
            </select>
          </label>
          <label style={S.optLabel}>학년도
            <select style={S.input} value={year} onChange={(e) => setYear(e.target.value)}>
              {['2027', '2028'].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button style={{ ...S.btn, ...S.btnPrimary, marginLeft: 'auto' }} onClick={generate} disabled={running}>
            {running ? '만드는 중…' : '✨ 면접 전략 리포트 만들기'}
          </button>
        </div>
        {running && (
          <div style={S.progress}>
            <span style={S.spinner} /> {progress || '작업 중…'}
            <div style={{ fontSize: 11.5, color: '#7f93a3', marginTop: 4 }}>개요 1회 + 면접 있는 카드마다 1회씩 AI를 부릅니다. 카드 3개면 보통 5~8분, 6개면 15분 안팎입니다. 서버에서 만들고 끝나면 보관함에 자동 저장되므로 다른 화면에 다녀오거나 새로고침해도 됩니다.</div>
          </div>
        )}
      </div>

      {/* ③ 결과 */}
      {result && html && (
        <div style={S.card}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
            <div style={S.secTitle}>③ {reportTitle(result.data)} <span style={{ color: '#7f93a3', fontWeight: 500, fontSize: 12.5 }}>· 지원 카드 {result.data.cards?.length || 0}개 · 면접 {ivCount}개 · 문항 {result.data.questionCount || questionCount}개씩</span></div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={{ ...S.btn, ...S.btnPrimary }} onClick={() => openWindow(html)}>🖨 새 창에서 열기 · 인쇄/PDF</button>
              {!result.savedId
                ? <button style={S.btn} onClick={save}>💾 저장</button>
                : <span style={S.fileChip}>저장됨 #{result.savedId}</span>}
              {result.savedId && result.studentId && (
                <button style={S.btn} onClick={() => assign(result.savedId, result.studentId)}>📌 {result.studentName || '학생'} 기록에 배정</button>
              )}
              {result.savedId && !result.studentId && <AssignPicker onAssign={(sid) => assign(result.savedId, sid)} />}
              {result.savedId && (
                <SendToPapa kind="면접 전략" menu="interview" title={reportTitle(result.data)} markdown="(서버가 저장본에서 만듭니다)" studentName={result.studentName || ''}
                  extra={{ interviewId: result.savedId }} onAuthError={onAuthError} />
              )}
            </div>
          </div>
          <iframe title="면접 전략 리포트" srcDoc={html} style={S.frame} />
        </div>
      )}

      {/* ④ 보관 목록 */}
      <div style={S.card}>
        <div style={S.secTitle}>④ 저장된 면접 전략 ({items.length}건) — 클릭해서 다시 열기</div>
        {listMsg && <div style={{ color: '#9db0bd', fontSize: 13, padding: '10px 2px' }}>{listMsg}</div>}
        {!listMsg && !items.length && <div style={{ color: '#9db0bd', fontSize: 13, padding: '10px 2px' }}>아직 저장된 리포트가 없습니다. 위에서 만들고 💾 저장하세요.</div>}
        <div style={S.list}>
          {items.map((it) => (
            <div key={it.id} style={S.row} onClick={() => openSaved(it)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={S.rowTitle}>{it.title}</div>
                <div style={S.rowMeta}>
                  {it.student_name && <span style={S.chip}>{it.student_name}</span>}
                  {(it.cards || []).map((c, k) => (
                    <span key={k} style={{ ...S.chip, color: c.interview ? '#8fb8f0' : '#f0a0a8', borderColor: c.interview ? 'rgba(91,134,214,0.5)' : 'rgba(240,160,168,0.4)' }}>
                      {c.univ} {c.track}{c.interview ? '' : ' (면접 없음)'}
                    </span>
                  ))}
                </div>
              </div>
              <span style={{ color: '#6b7d8a', fontSize: 12, whiteSpace: 'nowrap' }}>{String(it.created_at).slice(0, 10)}</span>
              <button style={{ ...S.btn, padding: '4px 8px', fontSize: 12, color: '#f87171' }} onClick={(e) => { e.stopPropagation(); remove(it); }}>삭제</button>
            </div>
          ))}
        </div>
      </div>

      {/* 사용설명서·예시 문서 보기 */}
      {doc && (
        <div style={S.overlay} onClick={() => setDoc(null)}>
          <div style={S.docModal} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <b style={{ color: '#e8eef3', fontSize: 15 }}>{doc.title}</b>
              <span style={{ color: '#7f93a3', fontSize: 12 }}>A4 가로 · 인쇄하려면 새 창에서 여세요</span>
              <button style={{ ...S.btn, marginLeft: 'auto' }} onClick={() => openWindow(doc.html)}>🖨 새 창에서 열기</button>
              <button style={S.close} onClick={() => setDoc(null)}>✕</button>
            </div>
            <iframe title={doc.title} srcDoc={doc.html} style={{ ...S.frame, height: 'calc(90vh - 52px)', borderRadius: '0 0 16px 16px' }} />
          </div>
        </div>
      )}
    </div>
  );
}

// 학생 없이 만든 리포트를 나중에 학생 기록에 붙일 때
function AssignPicker({ onAssign }) {
  const [s, setS] = useState(null);
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <StudentPicker value={s} onChange={setS} style={S.input} placeholder="배정할 학생 선택" />
      <button style={S.btn} disabled={!s} onClick={() => s && onAssign(s.id)}>📌 기록에 배정</button>
    </span>
  );
}

const S = {
  page: { padding: '24px 28px', maxWidth: 1200 },
  h2: { fontSize: 24, fontWeight: 800, margin: '0 0 4px', color: '#e8eef3' },
  lead: { color: '#9db0bd', fontSize: 13.5, margin: '4px 0 16px', lineHeight: 1.6 },
  card: { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: '16px 18px', marginBottom: 14 },
  secTitle: { fontSize: 14.5, fontWeight: 800, color: '#e8eef3', marginBottom: 10 },
  btn: { border: '1px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.06)', color: '#e8eef3', borderRadius: 9, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  btnPrimary: { background: '#5b86d6', border: '1px solid #5b86d6', color: '#fff' },
  fileChip: { fontSize: 12, color: '#9db0bd', background: 'rgba(255,255,255,0.06)', borderRadius: 7, padding: '4px 9px' },
  textarea: { width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, color: '#e8eef3', padding: '9px 11px', fontSize: 13, lineHeight: 1.6, resize: 'vertical' },
  input: { background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, color: '#e8eef3', padding: '7px 10px', fontSize: 13 },
  cardRow: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  rowNum: { width: 24, height: 24, borderRadius: 7, background: '#243341', color: '#9db0bd', display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 800, flex: '0 0 auto' },
  optLabel: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#9db0bd', fontWeight: 600 },
  progress: { marginTop: 12, padding: '10px 14px', background: 'rgba(91,134,214,0.12)', border: '1px solid rgba(91,134,214,0.35)', borderRadius: 10, color: '#cfd8e0', fontSize: 13 },
  spinner: { display: 'inline-block', width: 12, height: 12, border: '2px solid #5b86d6', borderTopColor: 'transparent', borderRadius: '50%', marginRight: 8, verticalAlign: '-2px', animation: 'spin 0.9s linear infinite' },
  frame: { width: '100%', height: '75vh', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, background: '#e9edf2' },
  list: { display: 'flex', flexDirection: 'column' },
  row: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 8px', borderBottom: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer', borderRadius: 8 },
  rowTitle: { fontSize: 14, fontWeight: 700, color: '#e8eef3', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  rowMeta: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, marginTop: 3, flexWrap: 'wrap' },
  chip: { fontSize: 11, fontWeight: 700, color: '#9db0bd', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6, padding: '1px 7px' },
  error: { background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.4)', color: '#f87171', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12 },
  notice: { background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399', borderRadius: 10, padding: '9px 13px', fontSize: 13, marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 10 },
  dismiss: { border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 },
  docModal: { background: '#16222e', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: 'min(1280px, 96vw)', height: '90vh', overflow: 'hidden' },
  close: { border: 'none', background: 'rgba(255,255,255,0.08)', color: '#9db0bd', borderRadius: 8, width: 30, height: 30, cursor: 'pointer' },
};
