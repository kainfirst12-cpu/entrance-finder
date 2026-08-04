import { useState, useRef, useEffect } from 'react';
import { API_BASE } from '../apiBase';
import StudentPicker from './StudentPicker';

const SECTION_MAP = [
  { key: 'caseMatching',   num: '0', title: '합격자 사례 매칭 분석' },
  { key: 'academic',       num: '1', title: '학업역량 종합 분석' },
  { key: 'activity',       num: '2', title: '비교과 활동 평가' },
  { key: 'career',         num: '3', title: '진로 역량 및 전공 적합성' },
  { key: 'strategy',       num: '4', title: '수시 지원 전략' },
  { key: 'roadmap',        num: '5', title: '핵심 리스크 및 대응 방안' },
  { key: 'recordFeedback', num: '6', title: '실행 계획' },
  { key: 'dashboard',      num: '7', title: '종합 평가 및 권고사항' },
];

const MODEL_CFG = {
  claude:       { icon: '●', label: 'Claude Sonnet 4.6', color: '#7c6af7', group: 'claude' },
  'claude-opus':{ icon: '◆', label: 'Claude Opus 4.8',   color: '#5b21b6', group: 'claude' },
  gemini:       { icon: '●', label: 'Gemini 3.5 Flash',    color: '#4caf50', group: 'gemini' },
  'gemini-pro': { icon: '■', label: 'Gemini 3.1 Pro',    color: '#166534', group: 'gemini' },
  gpt:          { icon: '●', label: 'GPT-5.5',           color: '#f0a500', group: 'gpt' },
  'gpt-mini':   { icon: '●', label: 'GPT-5.4 Mini',      color: '#ea580c', group: 'gpt' },
};

// 에이전트가 부른 도구 이름을 사람 말로
const TOOL_LABEL = {
  search_ipgyeol: '입결 조회',
  search_knowledge: '지식베이스',
  save_placement: '배치 저장',
};

function chatMdToHtml(raw) {
  if (!raw) return '';
  let text = raw.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}]/gu, '');
  text = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|.*\|/.test(line)) {
      const tbl = [];
      while (i < lines.length && /^\s*\|.*\|/.test(lines[i])) { tbl.push(lines[i]); i++; }
      const rows = tbl.filter(l => !/^\s*\|[\s\-:]+\|/.test(l));
      if (rows.length) {
        let h = '<table style="width:100%;border-collapse:collapse;margin:10px 0;font-size:12.5px;">';
        rows.forEach((r, ri) => {
          const cells = r.split('|').filter((_, ci, a) => ci > 0 && ci < a.length - 1).map(c => c.trim());
          const tag = ri === 0 ? 'th' : 'td';
          const style = ri === 0 ? 'background:#1e293b;color:#fff;padding:8px 12px;text-align:left;border:1px solid #334155;' : 'padding:8px 12px;border:1px solid #e2e8f0;';
          h += '<tr>' + cells.map(c => `<${tag} style="${style}">${c}</${tag}>`).join('') + '</tr>';
        });
        h += '</table>';
        out.push(h);
      }
      continue;
    }
    if (/^\s*```/.test(line)) { i++; continue; }
    if (/^[─━]{5,}/.test(line.trim())) { out.push('<hr style="border:none;height:1px;background:#e2e8f0;margin:12px 0;">'); i++; continue; }
    const hm = line.match(/^(#{1,6})\s+(.+)/);
    if (hm) { out.push(`<div style="font-size:15px;font-weight:700;color:#1e293b;margin:16px 0 6px;">${hm[2]}</div>`); i++; continue; }
    let p = line.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
    out.push(p);
    i++;
  }
  return out.join('\n');
}

// 컨텍스트 패널·빠른 질문용 스타일 (App.css의 chat-context-panel 안에서 쓰임)
const CS = {
  tabRow: { display: 'flex', gap: 6, margin: '8px 0 10px' },
  tab: { flex: 1, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', borderRadius: 8, padding: '5px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
  tabOn: { background: '#2563eb', borderColor: '#2563eb', color: '#fff' },
  wrap: { display: 'flex', flexDirection: 'column', minHeight: 0 },
  sName: { fontSize: 15, fontWeight: 800, color: '#0f172a' },
  sMeta: { fontSize: 12, color: '#64748b', lineHeight: 1.6, marginTop: 2 },
  gradeLine: { fontSize: 11.5, color: '#2563eb', fontWeight: 700, marginTop: 4 },
  secTitle: { fontSize: 11.5, fontWeight: 800, color: '#334155', margin: '12px 0 6px', display: 'flex', alignItems: 'center', gap: 6 },
  chk: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#475569', padding: '3px 0', cursor: 'pointer' },
  miniBtn: { border: '1px solid #cbd5e1', background: '#fff', color: '#475569', borderRadius: 6, padding: '1px 7px', fontSize: 10.5, fontWeight: 700, cursor: 'pointer' },
  recList: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 300, overflowY: 'auto', paddingRight: 2 },
  recItem: { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 8px', background: '#fff' },
  recTop: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' },
  recType: { fontSize: 10, fontWeight: 800, color: '#2563eb', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 5, padding: '1px 5px', whiteSpace: 'nowrap' },
  recTitle: { fontSize: 12, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  recFoot: { display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 },
  recDate: { fontSize: 10.5, color: '#94a3b8', marginRight: 'auto' },
  recBody: { fontSize: 11.5, lineHeight: 1.7, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '7px 9px', marginTop: 5, maxHeight: 220, overflowY: 'auto', whiteSpace: 'pre-wrap' },
  plList: { display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 150, overflowY: 'auto' },
  plRow: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5 },
  plV: { fontWeight: 800, color: '#2563eb', minWidth: 28 },
  plName: { color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 },
  plCut: { color: '#94a3b8' },
  empty: { fontSize: 12, color: '#94a3b8', padding: '6px 0' },
  quickRow: { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: '8px 14px 0' },
  quickLabel: { fontSize: 11.5, fontWeight: 700, color: '#64748b' },
  quickChip: { border: '1px solid #99f6e4', background: '#f0fdfa', color: '#0f766e', borderRadius: 20, padding: '4px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' },
};

export default function ChatInterface({ getActiveKey, selectedModel, analysisData }) {
  // 기존 상태
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '안녕하세요! 입시 전문 컨설턴트입니다.\n생기부, 세특, 입시 전략 등 궁금한 점을 자유롭게 질문해 주세요.\n\nJSON 분석 파일, PDF, 이미지를 첨부하면 해당 내용을 기반으로 상담할 수 있습니다.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [verifyingIdx, setVerifyingIdx] = useState(null);
  const [refiningVerifyIdx, setRefiningVerifyIdx] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // 새 기능 상태
  const [attachedFiles, setAttachedFiles] = useState([]); // {name, type, preview, data, text}
  const [analysisContext, setAnalysisContext] = useState(null); // 로드된 JSON 분석 데이터
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [editingIdx, setEditingIdx] = useState(null);
  const [editText, setEditText] = useState('');
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [reportInclude, setReportInclude] = useState({}); // 리포트에 포함할 메시지 인덱스
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const fileInputRef = useRef(null);
  const jsonInputRef = useRef(null);
  const chatImportRef = useRef(null);

  // 상담을 배정할 보드 학생
  const [boardStudent, setBoardStudent] = useState(null);
  const [savingChat, setSavingChat] = useState(false);

  // 학생 자료(생기부 분석·브리핑·배치·로드맵) — 이 학생에 대한 상담이 되게 하는 컨텍스트
  const [dossier, setDossier] = useState(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [recSel, setRecSel] = useState({});        // recordId → 포함 여부
  const [useProfile, setUseProfile] = useState(true);
  const [usePlacements, setUsePlacements] = useState(true);
  const [useRoadmaps, setUseRoadmaps] = useState(true);
  const [panelTab, setPanelTab] = useState('student'); // 'student' | 'analysis'
  const [openRecId, setOpenRecId] = useState(null);

  // 불러온 기록을 상담 중에 바로 고치기 — 생기부 분석·상담 내용을 화면 옮기지 않고 수정
  const [editRecId, setEditRecId] = useState(null);
  const [editRec, setEditRec] = useState({ title: '', content: '' });
  const [savingRec, setSavingRec] = useState(false);

  const startRecEdit = (r) => {
    setEditRecId(r.id);
    setEditRec({ title: r.title || '', content: r.content || '' });
    setOpenRecId(r.id);
  };
  const cancelRecEdit = () => { setEditRecId(null); setEditRec({ title: '', content: '' }); };

  const saveRecEdit = async () => {
    if (!editRec.content.trim()) { alert('내용이 비어 있습니다.'); return; }
    setSavingRec(true);
    try {
      const tok = localStorage.getItem('ef_token');
      const r = await fetch(`${API_BASE}/api/board/records/${editRecId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ title: editRec.title, content: editRec.content }),
      });
      const d = await r.json();
      if (!d.success) throw new Error(d.message || '저장 실패');
      // 서버가 돌려준 값으로 갈아끼운다 — 화면과 DB가 어긋나면 이후 상담이 옛 내용을 근거로 삼는다
      setDossier((prev) => prev && {
        ...prev,
        records: prev.records.map((x) => (x.id === d.record.id ? { ...x, ...d.record } : x)),
      });
      cancelRecEdit();
    } catch (e) {
      alert('기록 저장 실패: ' + e.message);
    } finally { setSavingRec(false); }
  };

  // AI 답변을 기존 기록에 반영 — "이렇게 고쳐줘" 하고 받은 결과를 그대로 덮어쓴다
  const applyMessageToRecord = (content) => {
    if (editRecId == null) return;
    setEditRec((p) => ({ ...p, content }));
  };

  const deleteRecord = async (r) => {
    if (!confirm(`"${r.title || '(제목 없음)'}" 기록을 삭제할까요?\n되돌릴 수 없습니다.`)) return;
    try {
      const tok = localStorage.getItem('ef_token');
      const res = await fetch(`${API_BASE}/api/board/records/${r.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${tok}` },
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.message || '삭제 실패');
      setDossier((prev) => prev && { ...prev, records: prev.records.filter((x) => x.id !== r.id) });
      setRecSel((p) => { const n = { ...p }; delete n[r.id]; return n; });
      if (editRecId === r.id) cancelRecEdit();
      if (openRecId === r.id) setOpenRecId(null);
    } catch (e) {
      alert('기록 삭제 실패: ' + e.message);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // analysisData prop이 바뀌면 자동으로 컨텍스트 설정
  useEffect(() => {
    if (analysisData?.results) {
      setAnalysisContext(analysisData);
      setContextPanelOpen(true);
    }
  }, [analysisData]);

  const modelLabels = { claude: 'Claude Sonnet 4.6', 'claude-opus': 'Claude Opus 4.8', gemini: 'Gemini 3.5 Flash', 'gemini-pro': 'Gemini 3.1 Pro', gpt: 'GPT-5.5', 'gpt-mini': 'GPT-5.4 Mini' };

  // ── 학생 자료 불러오기 ────────────────────────────
  // 기본 선택: 생기부 분석·컨설턴트 브리핑·최근 상담 — 상담에서 가장 자주 근거가 되는 기록들
  const PRIORITY_TYPES = ['컨설턴트 브리핑', '생기부 분석', '입시상담'];
  const loadStudentDossier = async (s) => {
    setBoardStudent(s);
    setDossier(null); setRecSel({}); setOpenRecId(null);
    if (!s) return;
    setDossierLoading(true);
    try {
      const tok = localStorage.getItem('ef_token');
      const r = await fetch(`${API_BASE}/api/board/students/${s.id}/context`, { headers: { Authorization: `Bearer ${tok}` } });
      const d = await r.json();
      if (!d.success) throw new Error(d.message || '학생 자료를 불러오지 못했습니다');
      setDossier(d);
      setPanelTab('student');
      setContextPanelOpen(true);

      // 기본 선택 구성
      const sel = {};
      const withBody = (d.records || []).filter((x) => x.content);
      for (const t of PRIORITY_TYPES) {
        const hit = withBody.find((x) => x.type === t);
        if (hit) sel[hit.id] = true;
      }
      if (!Object.keys(sel).length) withBody.slice(0, 2).forEach((x) => { sel[x.id] = true; });
      setRecSel(sel);

      const g = d.grades?.length ? ` · 최근 내신 ${d.grades[d.grades.length - 1].gpa ?? '-'}` : '';
      setMessages((prev) => [...prev, {
        role: 'assistant', isSystem: true,
        content: `[${d.student.name} 학생 자료 로드 완료]\n${d.student.school || '학교 미입력'} · ${d.student.grade || '학년 미입력'} · 희망 ${d.student.major || '미입력'} · 목표 ${d.student.target_univ || '미입력'}${g}\n` +
          `기록 ${d.records.length}건 / 배치 ${d.placements.length}건 / 로드맵 ${d.roadmaps.length}건\n\n` +
          `왼쪽 패널에서 상담에 넣을 기록을 고를 수 있습니다. 이제 이 학생에 대해 바로 질문하세요.`,
      }]);
    } catch (e) {
      alert('학생 자료 로드 실패: ' + e.message);
    } finally { setDossierLoading(false); }
  };

  // AI에 넘길 학생 컨텍스트 (선택된 항목만)
  const buildStudentContext = () => {
    if (!dossier) return null;
    const st = dossier.student || {};
    const ctx = {};
    if (useProfile) {
      ctx.profile = { name: st.name, school: st.school, grade: st.grade, major: st.major, targetUniv: st.target_univ, status: st.status, notes: st.notes, gpa: st.gpa };
      ctx.grades = (dossier.grades || []).map((g) => ({ term: g.term, gpa: g.gpa, note: g.note }));
    } else {
      ctx.profile = { name: st.name };
    }
    ctx.records = (dossier.records || []).filter((r) => recSel[r.id] && r.content)
      .map((r) => ({ type: r.type, title: r.title, date: r.created_at, content: r.content }));
    if (usePlacements) {
      ctx.placements = (dossier.placements || []).map((p) => ({
        univName: p.univ_name, dept: p.dept, track: p.track, typeName: p.type_name, verdict: p.verdict,
        grade: p.grade, cut70: p.snapshot?.cut70, cutYear: p.snapshot?.cutYear,
        aiVerdict: p.snapshot?.aiVerdict, aiReason: p.snapshot?.aiReason,
      }));
    }
    if (useRoadmaps) {
      ctx.roadmaps = (dossier.roadmaps || []).map((r) => ({
        title: r.title, total: r.items.length, done: r.items.filter((i) => i.done).length,
        pending: r.items.filter((i) => !i.done).map((i) => i.title),
      }));
    }
    const hasAny = ctx.records.length || ctx.placements?.length || ctx.roadmaps?.length || useProfile;
    return hasAny ? ctx : null;
  };

  const selectedRecCount = Object.values(recSel).filter(Boolean).length;

  // 학생 맞춤 빠른 질문
  const QUICK_ASKS = [
    { label: '종합 진단', q: '이 학생의 현재 상황을 종합 진단해 주세요. 강점·약점·리스크를 근거와 함께 정리하고, 지금 가장 시급한 과제 3가지를 알려주세요.' },
    { label: '수시 6장 전략', q: '이 학생의 내신·생기부·배치 기록을 근거로 수시 6장 지원 전략을 짜주세요. 안정·적정·소신 구성과 각 카드의 선정 이유를 밝혀주세요.' },
    { label: '배치 기록 검토', q: '저장된 배치 기록이 이 학생에게 타당한지 검토해 주세요. 과하게 상향이거나 불필요한 카드가 있으면 지적하고 대안을 제시해 주세요.' },
    { label: '생기부 보완점', q: '이 학생의 생기부에서 지원 전공 대비 비어 있는 부분과, 다음 학기에 채워야 할 활동·탐구 주제를 구체적으로 제안해 주세요.' },
    { label: '로드맵 점검', q: '로드맵의 미완료 항목을 우선순위대로 정리하고, 남은 기간에 현실적으로 실행할 계획으로 다듬어 주세요.' },
    { label: '학부모 상담용 정리', q: '학부모 상담에서 그대로 읽을 수 있도록, 이 학생의 현재 위치와 앞으로의 계획을 쉬운 말로 정리해 주세요.' },
  ];

  // ── 파일 처리 (공통) ──────────────────────────────
  const processFiles = async (files) => {
    if (!files.length) return;
    setUploadingFiles(true);
    const newFiles = [];

    for (const file of files) {
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf';
      const isJson = file.name.endsWith('.json');

      if (isJson) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (data.results && data.studentData) {
            setAnalysisContext(data);
            setContextPanelOpen(true);
            setMessages(prev => [...prev, {
              role: 'assistant',
              content: `[분석 데이터 로드 완료]\n학생: ${data.studentData?.name || '미입력'}\n전공: ${data.studentData?.major || '미입력'}\n목표: ${data.studentData?.targetUniv || '미입력'}\n\n${SECTION_MAP.filter(s => data.results?.[s.key]).map(s => `- [${s.num}단계] ${s.title}`).join('\n')}\n\n위 분석 데이터에 대해 질문하거나, 수정을 요청할 수 있습니다.`,
              isSystem: true,
            }]);
          } else {
            alert('유효하지 않은 분석 파일입니다. results와 studentData가 필요합니다.');
          }
        } catch (err) {
          alert('JSON 파싱 오류: ' + err.message);
        }
        continue;
      }

      if (isImage) {
        const base64 = await fileToBase64(file);
        const preview = URL.createObjectURL(file);
        newFiles.push({ name: file.name || `image_${Date.now()}.png`, type: 'image', mimeType: file.type || 'image/png', base64, preview });
      } else if (isPdf) {
        try {
          const formData = new FormData();
          formData.append('files', file);
          const token = localStorage.getItem('ef_token');
          const res = await fetch(`${API_BASE}/api/chat-upload`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          });
          const data = await res.json();
          if (data.success && data.files?.[0]) {
            newFiles.push({ name: file.name, type: 'pdf', text: data.files[0].text });
          }
        } catch (err) {
          newFiles.push({ name: file.name, type: 'pdf', text: `[PDF 추출 실패: ${err.message}]` });
        }
      }
    }

    if (newFiles.length > 0) {
      setAttachedFiles(prev => [...prev, ...newFiles]);
    }
    setUploadingFiles(false);
  };

  // 파일 선택 (input)
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    processFiles(files);
  };

  // Ctrl+V 붙여넣기 (이미지 캡쳐)
  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      processFiles(files);
    }
  };

  // 드래그앤드롭
  const [dragging, setDragging] = useState(false);
  const handleDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) processFiles(files);
  };

  const fileToBase64 = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(file);
  });

  const removeFile = (idx) => {
    setAttachedFiles(prev => {
      const f = prev[idx];
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return prev.filter((_, i) => i !== idx);
    });
  };

  // ── 에이전트 모드 ────────────────────────────────
  // 일반 상담은 프론트가 골라 넘긴 컨텍스트만 본다. 에이전트 모드는 서버가 입결 7만 건과
  // 지식베이스를 직접 조회하므로, 컨설턴트가 조건을 미리 다 적지 않아도 된다.
  const [agentMode, setAgentMode] = useState(false);

  // 에이전트 라우트는 keepalive SSE로 응답한다(도구 호출이 길어 프록시 타임아웃을 피하기 위함)
  const readSSE = async (res) => {
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/event-stream')) {
      try { return await res.json(); }
      catch { return { success: false, message: `서버 응답 오류 (HTTP ${res.status})` }; }
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', result = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) { try { result = JSON.parse(line.slice(6)); } catch {} }
      }
    }
    return result || { success: false, message: '서버 응답이 비었습니다' };
  };

  // ── 메시지 전송 ──────────────────────────────────
  const sendMessage = async (override) => {
    const text = String(typeof override === 'string' ? override : input).trim();
    if ((!text && attachedFiles.length === 0) || loading) return;

    const apiKey = getActiveKey();
    if (!apiKey) {
      setMessages(prev => [...prev, { role: 'assistant', content: '설정에서 API 키를 먼저 입력해 주세요.' }]);
      return;
    }

    // 사용자 메시지 구성
    const userMsg = {
      role: 'user',
      content: text || '(첨부 파일 분석 요청)',
      files: attachedFiles.length > 0 ? attachedFiles.map(f => ({ name: f.name, type: f.type })) : undefined,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    const filesToSend = [...attachedFiles];
    setAttachedFiles([]);
    setLoading(true);

    try {
      const history = messages.filter(m => m.role !== 'system' && !m.isSystem).slice(-10);
      const token = localStorage.getItem('ef_token');

      // 파일 컨텍스트 구성
      const fileContents = filesToSend.filter(f => f.type === 'pdf').map(f => ({ name: f.name, text: f.text }));
      const imageData = filesToSend.filter(f => f.type === 'image').map(f => ({ mimeType: f.mimeType, base64: f.base64 }));

      const body = {
        message: text || '첨부된 파일을 분석해 주세요.',
        history: history.map(h => ({ role: h.role, content: h.content })),
      };

      // 에이전트 모드 — 서버가 학생 자료를 직접 읽고 입결·지식베이스를 도구로 조회한다
      if (agentMode) {
        const res = await fetch(`${API_BASE}/api/chat/agent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'x-ai-model': MODEL_CFG[selectedModel]?.group || selectedModel,
            'x-ai-submodel': selectedModel,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            studentId: boardStudent?.id || undefined,
            message: text || '첨부된 파일을 분석해 주세요.',
            history: history.map(h => ({ role: h.role, content: h.content })),
            baseYear: '2026',
          }),
        });
        const d = await readSSE(res);
        if (d.success) {
          setMessages(prev => [...prev, { role: 'assistant', content: d.reply, toolLog: d.toolLog || [] }]);
          // 에이전트가 배치를 저장했으면 학생 자료를 다시 읽어 화면과 어긋나지 않게 한다
          if (d.savedPlacements?.length && boardStudent) loadStudentDossier(boardStudent);
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: `오류: ${d.message}` }]);
        }
        return;
      }

      const studentCtx = buildStudentContext();
      if (studentCtx) body.studentContext = studentCtx;
      if (analysisContext) body.analysisContext = { studentData: analysisContext.studentData, results: analysisContext.results };
      if (fileContents.length > 0) body.fileContents = fileContents;
      if (imageData.length > 0) body.imageData = imageData;

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-ai-model': MODEL_CFG[selectedModel]?.group || selectedModel,
          'x-ai-submodel': selectedModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (data.success) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: `오류: ${data.message}` }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `연결 오류: ${err.message}` }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── 메시지 편집 (인간 수정) ──────────────────────
  const startEdit = (idx) => {
    setEditingIdx(idx);
    setEditText(messages[idx].content);
  };

  const saveEdit = (idx) => {
    setMessages(prev => prev.map((m, i) => i === idx ? { ...m, content: editText, edited: true } : m));
    setEditingIdx(null);
    setEditText('');
  };

  const cancelEdit = () => { setEditingIdx(null); setEditText(''); };

  const deleteMessage = (idx) => {
    if (!confirm('이 메시지를 삭제하시겠습니까?')) return;
    setMessages(prev => prev.filter((_, i) => i !== idx));
  };

  // ── 복사 ──────────────────────────────────
  const copyMessage = async (content, idx) => {
    await navigator.clipboard.writeText(content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const copyAllChat = async () => {
    const text = messages.map(m => `[${m.role === 'user' ? '나' : '컨설턴트'}]\n${m.content}`).join('\n\n---\n\n');
    await navigator.clipboard.writeText(text);
    setCopiedIdx('all');
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  // ── 학생 보드에 배정 ──────────────────────────────
  const assignChatMessage = async (idx) => {
    const tok = localStorage.getItem('ef_token');
    if (!tok) { alert('로그인이 필요합니다.'); return; }
    try {
      let d, label;
      if (boardStudent) {
        // 헤더에서 선택한 학생에게 정확히 배정
        const r = await fetch(`${API_BASE}/api/board/students/${boardStudent.id}/records`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ type: '입시상담', title: '입시 상담', content: messages[idx]?.content || '' }),
        });
        d = await r.json(); label = boardStudent.name;
      } else {
        const nm = (window.prompt('어느 학생에게 배정할까요? 학생 이름:\n(상단에서 학생을 선택해두면 바로 배정됩니다)') || '').trim();
        if (!nm) return;
        const r = await fetch(`${API_BASE}/api/board/upsert`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ name: nm, record: { type: '입시상담', title: '입시 상담', content: messages[idx]?.content || '' } }),
        });
        d = await r.json(); label = nm;
      }
      if (d.success) alert(`'${label}' 학생 보드에 배정되었습니다.\n학생 카드 → '내용 보기'에서 확인할 수 있어요.`);
      else alert('배정 실패: ' + (d.message || '다시 로그인해 주세요'));
    } catch (e) { alert('배정 오류: ' + e.message); }
  };

  // 전체 상담 내용을 선택한 학생 기록으로 저장
  const saveChatToStudent = async () => {
    if (!boardStudent) { alert('먼저 상단에서 학생을 선택해 주세요.'); return; }
    const tok = localStorage.getItem('ef_token');
    if (!tok) { alert('로그인이 필요합니다.'); return; }
    const body = messages.filter(m => !m.isSystem)
      .map(m => `[${m.role === 'user' ? '질문' : m.isVerify ? '교차 검증' : '컨설턴트'}]\n${m.content}`).join('\n\n---\n\n');
    if (!body.trim()) { alert('저장할 대화가 없습니다.'); return; }
    setSavingChat(true);
    try {
      const r = await fetch(`${API_BASE}/api/board/students/${boardStudent.id}/records`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ type: '입시상담', title: `입시 상담 전체 대화 (${new Date().toLocaleDateString('ko-KR')})`, content: body }),
      });
      const d = await r.json();
      if (d.success) alert(`'${boardStudent.name}' 학생 보드에 상담 전체가 저장되었습니다.`);
      else alert('저장 실패: ' + (d.message || '다시 로그인해 주세요'));
    } catch (e) { alert('저장 오류: ' + e.message); }
    finally { setSavingChat(false); }
  };

  // ── 교차 검증 ──────────────────────────────────
  const verifyChatMessage = async (msgIdx, verifyModel) => {
    const msg = messages[msgIdx];
    if (!msg || msg.role !== 'assistant') return;
    let userQuestion = '';
    for (let j = msgIdx - 1; j >= 0; j--) {
      if (messages[j].role === 'user') { userQuestion = messages[j].content; break; }
    }
    const group = MODEL_CFG[verifyModel]?.group || verifyModel;
    const vKey = group === 'claude' ? localStorage.getItem('ef_apikey')
      : group === 'gemini' ? localStorage.getItem('ef_geminikey')
      : localStorage.getItem('ef_gptkey');

    if (!vKey) { alert(`${MODEL_CFG[verifyModel]?.label} API 키가 설정되지 않았습니다.`); return; }

    setVerifyingIdx(msgIdx);
    try {
      const token = localStorage.getItem('ef_token');
      const res = await fetch(`${API_BASE}/api/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': vKey,
          'x-ai-model': group,
          'x-ai-submodel': verifyModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          studentData: analysisContext?.studentData
            || (dossier ? { name: dossier.student.name, school: dossier.student.school, major: dossier.student.major, targetUniv: dossier.student.target_univ } : { name: '상담 학생' }),
          analysisText: `[질문]\n${userQuestion}\n\n[${modelLabels[selectedModel]} 답변]\n${msg.content}`,
          originalModel: modelLabels[selectedModel] || 'AI',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => {
          const copy = [...prev];
          copy.splice(msgIdx + 1, 0, { role: 'assistant', content: `[${MODEL_CFG[verifyModel]?.label} 교차 검증]\n${data.reply}`, isVerify: true, verifyModel });
          return copy;
        });
      } else { alert('검증 오류: ' + data.message); }
    } catch (err) { alert('검증 실패: ' + err.message); }
    finally { setVerifyingIdx(null); }
  };

  // ── 검증 결과 반영 ──────────────────────────────
  const refineChatWithVerify = async (verifyMsgIdx) => {
    const currentMessages = messages;
    const verifyMsg = currentMessages[verifyMsgIdx];
    if (!verifyMsg?.isVerify) return;

    // 검증 메시지 바로 앞의 원본 assistant 메시지 찾기
    let origIdx = -1;
    for (let j = verifyMsgIdx - 1; j >= 0; j--) {
      if (currentMessages[j].role === 'assistant' && !currentMessages[j].isVerify && !currentMessages[j].isSystem) {
        origIdx = j; break;
      }
    }
    if (origIdx === -1) { alert('원본 답변을 찾을 수 없습니다.'); return; }

    // 원본 답변 앞의 user 질문 찾기
    let userQuestion = '';
    for (let j = origIdx - 1; j >= 0; j--) {
      if (currentMessages[j].role === 'user') { userQuestion = currentMessages[j].content; break; }
    }

    // 원본 답변 작성 모델의 API 키 사용
    const group = MODEL_CFG[selectedModel]?.group || 'claude';
    const apiKey = group === 'claude' ? localStorage.getItem('ef_apikey')
      : group === 'gemini' ? localStorage.getItem('ef_geminikey')
      : localStorage.getItem('ef_gptkey');
    if (!apiKey) { alert('API 키가 설정되지 않았습니다.'); return; }

    setRefiningVerifyIdx(verifyMsgIdx);
    try {
      const token = localStorage.getItem('ef_token');
      const res = await fetch(`${API_BASE}/api/chat-refine`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-ai-model': group,
          'x-ai-submodel': selectedModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          question: userQuestion,
          originalAnswer: currentMessages[origIdx].content,
          verifyText: verifyMsg.content,
          studentData: analysisContext?.studentData || {},
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessages(prev => {
          const copy = [...prev];
          // origIdx는 messages 배열 기준이므로 현재 인덱스 재탐색
          let realOrigIdx = -1;
          for (let j = verifyMsgIdx - 1; j >= 0; j--) {
            if (copy[j].role === 'assistant' && !copy[j].isVerify && !copy[j].isSystem) {
              realOrigIdx = j; break;
            }
          }
          if (realOrigIdx !== -1) {
            copy[realOrigIdx] = { ...copy[realOrigIdx], content: data.reply, refined: true };
          }
          return copy;
        });
      } else { alert('반영 실패: ' + data.message); }
    } catch (err) { alert('반영 실패: ' + err.message); }
    finally { setRefiningVerifyIdx(null); }
  };

  // ── 분석 컨텍스트: 단계 클릭 → 질문 ──────────────
  const askAboutStage = (sec) => {
    if (!analysisContext?.results?.[sec.key]) return;
    setInput(`[${sec.num}단계] ${sec.title}에 대해 상세히 설명해 주세요. 개선점이나 보완할 점이 있다면 알려주세요.`);
    inputRef.current?.focus();
  };

  // 개별 단계 JSON 내보내기
  const exportStageJSON = (sec) => {
    if (!analysisContext?.results?.[sec.key]) return;
    const data = { stage: sec.num, title: sec.title, key: sec.key, content: analysisContext.results[sec.key], studentData: analysisContext.studentData, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${analysisContext.studentData?.name || '학생'}_${sec.num}단계_${sec.title}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  // 개별 단계 JSON 가져오기
  const importStageJSON = async (file, sec) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.content) {
        setAnalysisContext(prev => ({ ...prev, results: { ...prev.results, [sec.key]: data.content } }));
        setMessages(prev => [...prev, { role: 'assistant', content: `[${sec.num}단계] ${sec.title} 데이터가 업데이트되었습니다.`, isSystem: true }]);
      }
    } catch (err) { alert('JSON 파싱 오류: ' + err.message); }
  };

  // ── 채팅 내보내기 / 불러오기 ──────────────────────
  const exportChat = () => {
    const data = { version: 1, exportedAt: new Date().toISOString(), messages, analysisContext, model: selectedModel };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `입시상담_${new Date().toLocaleDateString('ko-KR')}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const importChat = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.messages) {
        setMessages(data.messages);
        if (data.analysisContext) { setAnalysisContext(data.analysisContext); setContextPanelOpen(true); }
      } else { alert('유효하지 않은 채팅 파일입니다.'); }
    } catch (err) { alert('파일 오류: ' + err.message); }
  };

  // ── 초기화 ──────────────────────────────────
  const clearChat = () => {
    setMessages([{ role: 'assistant', content: '대화가 초기화되었습니다. 새로운 질문을 해주세요!' }]);
    setAnalysisContext(null);
    setContextPanelOpen(!!dossier); // 불러온 학생 자료는 대화 초기화와 무관하게 유지
    setAttachedFiles([]);
  };

  // ── 리포트 미리보기 & 생성 ──────────────────────
  const openReportPreview = () => {
    const defaults = {};
    messages.forEach((m, i) => { if (!m.isSystem && !m.isVerify) defaults[i] = true; });
    setReportInclude(defaults);
    setShowReportPreview(true);
  };

  const generateReport = () => {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const includedMessages = messages.filter((_, i) => reportInclude[i]);

    const messagesHTML = includedMessages.map((msg) => {
      const content = chatMdToHtml(msg.content);
      const isUser = msg.role === 'user';
      return `<div class="msg ${isUser ? 'user' : 'ai'}">
        <div class="msg-label">${isUser ? '질문' : '패스파인더 입시분석팀'}${msg.edited ? ' <span style="color:#f59e0b;font-size:11px;">[수정됨]</span>' : ''}</div>
        <div class="msg-content">${content}</div>
      </div>`;
    }).join('');

    const studentName = analysisContext?.studentData?.name || '';
    const studentMajor = analysisContext?.studentData?.major || '';
    const studentTarget = analysisContext?.studentData?.targetUniv || '';

    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8">
<title>입시 상담 리포트 - 패스파인더 에듀</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Noto Sans KR',sans-serif;color:#1a1916;background:#fff;font-size:13px;line-height:1.8;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.print-bar{position:fixed;top:0;left:0;right:0;background:#1a2744;color:#fff;display:flex;align-items:center;justify-content:center;gap:12px;padding:10px 24px;z-index:100;font-size:14px;font-weight:500}
.print-bar button{padding:8px 24px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit}
.print-bar button:hover{background:#1d4ed8}
.print-bar .close-btn{background:transparent;border:1px solid rgba(255,255,255,0.3);padding:8px 16px}
.report{max-width:800px;margin:70px auto 60px;padding:0 24px}
.cover{background:linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%);color:#fff;padding:28px 32px 24px;border-radius:10px;margin:0 0 24px;position:relative;overflow:hidden}
.cover::before{content:'';position:absolute;top:-40px;right:-40px;width:200px;height:200px;border:1px solid rgba(255,255,255,0.06);border-radius:50%}
.cover::after{content:'';position:absolute;bottom:-60px;left:-30px;width:260px;height:260px;border:1px solid rgba(255,255,255,0.04);border-radius:50%}
.cover-brand{font-size:9px;letter-spacing:0.2em;color:rgba(255,255,255,0.3);text-transform:uppercase;margin-bottom:2px}
.cover-title{font-size:18px;font-weight:700;line-height:1.3;margin-bottom:2px}
.cover-subtitle{font-size:12px;color:rgba(255,255,255,0.45);margin-bottom:14px;font-weight:400}
.cover-divider{width:36px;height:2px;background:rgba(255,255,255,0.15);margin-bottom:12px}
.cover-meta{display:flex;flex-wrap:wrap;gap:4px 20px;font-size:11px;color:rgba(255,255,255,0.55);line-height:1.6}
.cover-meta strong{color:#fff;font-weight:600}
.cover-footer{display:none}
.messages{display:flex;flex-direction:column;gap:20px}
.msg{border:1px solid #e5e7eb;border-radius:10px;overflow:hidden}
.msg-label{padding:10px 18px;font-size:12px;font-weight:600;border-bottom:1px solid #e5e7eb}
.msg.user .msg-label{background:#eff6ff;color:#2563eb}
.msg.ai .msg-label{background:#f8fafc;color:#0f172a}
.msg-content{padding:16px 20px;font-size:13px;line-height:1.9;white-space:pre-wrap;word-break:break-word;color:#333}
.report-footer{text-align:center;padding:24px 0;font-size:11px;color:#999;border-top:1px solid #e5e7eb;margin-top:24px}
@media print{.print-bar{display:none!important}.report{margin-top:0}.cover{border-radius:0;margin:0 -24px 16px}body{font-size:12px}}
@page{size:A4;margin:20mm 15mm}
</style></head><body>
<div class="print-bar"><span>리포트가 준비되었습니다.</span><button onclick="window.print()">PDF로 인쇄 / 저장</button><button class="close-btn" onclick="window.close()">닫기</button></div>
<div class="report">
<div class="cover">
  <div class="cover-brand">PATHFINDER EDU</div>
  <div class="cover-title">${studentName ? `${studentName} 학생` : '입시'} 상담 분석 리포트</div>
  <div class="cover-subtitle">패스파인더 입시분석팀 &middot; ${today}</div>
  <div class="cover-divider"></div>
  <div class="cover-meta">
    ${studentName ? `<div><strong>대상 학생</strong> ${studentName}</div>` : ''}
    ${studentMajor ? `<div><strong>희망 전공</strong> ${studentMajor}</div>` : ''}
    ${studentTarget ? `<div><strong>목표 대학</strong> ${studentTarget}</div>` : ''}
    <div><strong>작성일</strong> ${today}</div>
    <div><strong>분석 항목</strong> ${includedMessages.length}건</div>
    <div><strong>작성</strong> 패스파인더 입시분석팀</div>
  </div>
  <div class="cover-footer">PATHFINDER ADMISSIONS CONSULTING</div>
</div>
<div class="messages">${messagesHTML}</div>
<div class="report-footer">패스파인더 에듀 &middot; 입시분석팀 &copy; ${new Date().getFullYear()} &mdash; 본 리포트는 패스파인더 입시분석팀이 작성하였습니다.</div>
</div></body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
    else alert('팝업이 차단되었습니다.');
    setShowReportPreview(false);
  };

  // ── 렌더링 ──────────────────────────────────────
  return (
    <div className="chat-container" style={{ display: 'flex', gap: 0 }}>
      {/* 컨텍스트 패널 — 학생 자료 / 분석 데이터 */}
      {contextPanelOpen && (dossier || analysisContext) && (
        <div className="chat-context-panel">
          <div className="context-panel-header">
            <strong>상담 컨텍스트</strong>
            <button className="btn-ghost-sm" onClick={() => setContextPanelOpen(false)}>닫기</button>
          </div>

          {dossier && analysisContext && (
            <div style={CS.tabRow}>
              <button style={{ ...CS.tab, ...(panelTab === 'student' ? CS.tabOn : {}) }} onClick={() => setPanelTab('student')}>학생 자료</button>
              <button style={{ ...CS.tab, ...(panelTab === 'analysis' ? CS.tabOn : {}) }} onClick={() => setPanelTab('analysis')}>분석 데이터</button>
            </div>
          )}

          {/* ── 학생 자료 ── */}
          {dossier && (!analysisContext || panelTab === 'student') && (
            <div style={CS.wrap}>
              <div style={CS.sName}>{dossier.student.name}</div>
              <div style={CS.sMeta}>
                {dossier.student.school || '학교 미입력'} · {dossier.student.grade || '학년 미입력'}<br />
                희망 {dossier.student.major || '미입력'} / 목표 {dossier.student.target_univ || '미입력'}
              </div>
              {dossier.student.gpa != null && (
                <div style={CS.gradeLine}>대표 내신 {Number(dossier.student.gpa).toFixed(2)} (전 교과 환산)</div>
              )}
              {dossier.grades?.length > 0 && (
                <div style={CS.gradeLine}>학기별 {dossier.grades.map((g) => `${g.term} ${g.gpa ?? '-'}`).join(' · ')}</div>
              )}

              <div style={CS.secTitle}>AI에 포함할 자료</div>
              <label style={CS.chk}><input type="checkbox" checked={useProfile} onChange={(e) => setUseProfile(e.target.checked)} /> 기본 정보·내신·메모</label>
              <label style={CS.chk}><input type="checkbox" checked={usePlacements} onChange={(e) => setUsePlacements(e.target.checked)} disabled={!dossier.placements.length} />
                입결 배치 기록 ({dossier.placements.length}건)</label>
              <label style={CS.chk}><input type="checkbox" checked={useRoadmaps} onChange={(e) => setUseRoadmaps(e.target.checked)} disabled={!dossier.roadmaps.length} />
                생기부 로드맵 ({dossier.roadmaps.length}건)</label>

              <div style={CS.secTitle}>
                기록 {selectedRecCount}/{dossier.records.length} 선택
                <button style={CS.miniBtn} onClick={() => {
                  const all = {}; dossier.records.filter((r) => r.content).forEach((r) => { all[r.id] = true; }); setRecSel(all);
                }}>전체</button>
                <button style={CS.miniBtn} onClick={() => setRecSel({})}>해제</button>
              </div>
              <div style={CS.recList}>
                {!dossier.records.length && <div style={CS.empty}>저장된 기록이 없습니다.</div>}
                {dossier.records.map((r) => (
                  <div key={r.id} style={CS.recItem}>
                    <label style={CS.recTop}>
                      <input type="checkbox" checked={!!recSel[r.id]} disabled={!r.content}
                        onChange={(e) => setRecSel((p) => ({ ...p, [r.id]: e.target.checked }))} />
                      <span style={CS.recType}>{r.type || '기록'}</span>
                      <span style={CS.recTitle} title={r.title}>{r.title || '(제목 없음)'}</span>
                    </label>
                    <div style={CS.recFoot}>
                      <span style={CS.recDate}>{String(r.created_at).slice(0, 10)}</span>
                      {r.content && (
                        <>
                          <button style={CS.miniBtn} onClick={() => setOpenRecId(openRecId === r.id ? null : r.id)}>
                            {openRecId === r.id ? '접기' : '내용'}
                          </button>
                          <button style={CS.miniBtn} onClick={() => {
                            setInput(`[${r.type || '기록'}] "${r.title}" 내용을 근거로 이 학생에 대해 설명해 주세요. 보완할 점이 있으면 함께 알려주세요.`);
                            inputRef.current?.focus();
                          }}>질문</button>
                          <button style={CS.miniBtn} onClick={() => (editRecId === r.id ? cancelRecEdit() : startRecEdit(r))}>
                            {editRecId === r.id ? '수정 취소' : '수정'}
                          </button>
                          <button style={CS.miniBtn} onClick={() => {
                            setInput(`아래 [${r.type || '기록'}] "${r.title}" 내용을 다듬어 주세요. 사실은 바꾸지 말고 표현과 구성만 정리해 전체 본문을 그대로 다시 출력해 주세요.\n\n---\n${r.content}`);
                            startRecEdit(r);
                            inputRef.current?.focus();
                          }}>다듬기</button>
                          <button style={{ ...CS.miniBtn, color: '#ef4444' }} onClick={() => deleteRecord(r)}>삭제</button>
                        </>
                      )}
                    </div>

                    {editRecId === r.id ? (
                      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <input value={editRec.title} onChange={(e) => setEditRec((p) => ({ ...p, title: e.target.value }))}
                          placeholder="제목" style={{ ...CS.recBody, fontWeight: 700, padding: '6px 8px' }} />
                        <textarea value={editRec.content} onChange={(e) => setEditRec((p) => ({ ...p, content: e.target.value }))}
                          rows={14} style={{ ...CS.recBody, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.6, resize: 'vertical' }} />
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button style={{ ...CS.miniBtn, fontWeight: 700 }} disabled={savingRec} onClick={saveRecEdit}>
                            {savingRec ? '저장 중…' : '저장'}
                          </button>
                          <button style={CS.miniBtn} disabled={savingRec} onClick={cancelRecEdit}>취소</button>
                          <span style={{ fontSize: 10.5, color: '#94a3b8' }}>
                            AI 답변의 [기록에 반영] 버튼을 누르면 이 칸에 들어옵니다
                          </span>
                        </div>
                      </div>
                    ) : (
                      openRecId === r.id && <div style={CS.recBody}>{r.content}</div>
                    )}
                  </div>
                ))}
              </div>

              {dossier.placements.length > 0 && (
                <>
                  <div style={CS.secTitle}>배치 기록</div>
                  <div style={CS.plList}>
                    {dossier.placements.slice(0, 20).map((p) => (
                      <div key={p.id} style={CS.plRow}>
                        <span style={CS.plV}>{p.verdict || '—'}</span>
                        <span style={CS.plName}>{(p.univ_name || '').replace(/\[.*\]$/, '')} {p.dept}</span>
                        <span style={CS.plCut}>{p.snapshot?.cut70 != null ? Number(p.snapshot.cut70).toFixed(2) : '—'}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <button className="btn-ghost-sm" style={{ width: '100%', marginTop: 10 }}
                onClick={() => { setDossier(null); setRecSel({}); setBoardStudent(null); }}>
                학생 자료 해제
              </button>
            </div>
          )}

          {/* ── 분석 데이터(JSON) ── */}
          {analysisContext && (!dossier || panelTab === 'analysis') && (
          <>
          <div className="context-student-info">
            <div><strong>{analysisContext.studentData?.name || '학생'}</strong></div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{analysisContext.studentData?.major || ''} / {analysisContext.studentData?.targetUniv || ''}</div>
          </div>
          <div className="context-stages">
            {SECTION_MAP.map(sec => {
              const hasData = !!analysisContext.results?.[sec.key];
              return (
                <div key={sec.key} className={`context-stage-item ${hasData ? '' : 'disabled'}`}>
                  <span className="stage-num-badge">{sec.num}</span>
                  <span className="stage-title" onClick={() => hasData && askAboutStage(sec)} style={{ cursor: hasData ? 'pointer' : 'default' }}>
                    {sec.title}
                  </span>
                  {hasData && (
                    <div className="stage-actions">
                      <button title="JSON 내보내기" onClick={() => exportStageJSON(sec)}>↓</button>
                      <label title="JSON 가져오기" style={{ cursor: 'pointer' }}>
                        ↑<input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.[0]) importStageJSON(e.target.files[0], sec); e.target.value = ''; }} />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button className="btn-ghost-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => { setAnalysisContext(null); if (!dossier) setContextPanelOpen(false); }}>
            분석 컨텍스트 해제
          </button>
          </>
          )}
        </div>
      )}

      {/* 메인 채팅 영역 */}
      <div className={`chat-main ${dragging ? 'drag-over' : ''}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' }}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {/* 헤더 */}
        <div className="chat-header">
          <h2>입시 상담 채팅</h2>
          <div className="chat-header-right">
            <span className="chat-model-badge">{modelLabels[selectedModel] || 'Claude'}</span>

            {/* 학생 선택 — 고르면 그 학생의 분석·상담·배치·로드맵 자료를 통째로 불러온다 */}
            <StudentPicker value={boardStudent} onChange={loadStudentDossier} placeholder="학생 불러오기"
              style={{ padding: '5px 8px', fontSize: 12, borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#1e293b', maxWidth: 180 }} />
            {dossierLoading && <span style={{ fontSize: 12, color: '#94a3b8' }}>자료 불러오는 중…</span>}
            {dossier && !contextPanelOpen && (
              <button className="btn-ghost chat-clear-btn" onClick={() => { setPanelTab('student'); setContextPanelOpen(true); }} style={{ color: '#2dd4bf' }}>
                {dossier.student.name} 자료 패널
              </button>
            )}
            {boardStudent && (
              <button className="btn-ghost chat-clear-btn" onClick={saveChatToStudent} disabled={savingChat}
                style={{ color: '#2dd4bf' }}>
                {savingChat ? '저장 중…' : `💾 ${boardStudent.name}에 대화 저장`}
              </button>
            )}

            {/* 분석 JSON 불러오기 */}
            <button className="btn-ghost chat-clear-btn" onClick={() => jsonInputRef.current?.click()}>
              JSON 불러오기
            </button>
            <input ref={jsonInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileSelect} />

            {/* 채팅 내보내기/불러오기 */}
            <button className="btn-ghost chat-clear-btn" onClick={exportChat}>채팅 저장</button>
            <button className="btn-ghost chat-clear-btn" onClick={() => chatImportRef.current?.click()}>채팅 불러오기</button>
            <input ref={chatImportRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importChat} />

            {/* 리포트 */}
            <button className="btn-print-html-sm" onClick={openReportPreview}>리포트 생성</button>

            {/* 분석 컨텍스트 토글 */}
            {analysisContext && !contextPanelOpen && (
              <button className="btn-ghost chat-clear-btn" onClick={() => setContextPanelOpen(true)} style={{ color: '#2563eb' }}>
                분석 패널
              </button>
            )}

            <button className="btn-ghost chat-clear-btn" onClick={copyAllChat}>{copiedIdx === 'all' ? '복사됨!' : '전체 복사'}</button>
            <button className="btn-ghost chat-clear-btn" onClick={clearChat}>초기화</button>
          </div>
        </div>

        {/* 메시지 영역 */}
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`chat-bubble ${msg.role} ${msg.isVerify ? 'verify' : ''} ${msg.isSystem ? 'system-msg' : ''}`}
              style={editingIdx === i ? { maxWidth: '100%', width: '100%', alignSelf: 'stretch' } : undefined}>
              <div className="chat-bubble-label">
                {msg.role === 'user' ? '나' : msg.isVerify ? `${MODEL_CFG[msg.verifyModel]?.label || 'AI'} 교차 검증` : msg.isSystem ? '시스템' : '컨설턴트'}
                {msg.edited && <span style={{ marginLeft: 6, color: '#f59e0b', fontSize: 11 }}>[수정됨]</span>}
                {msg.files && <span style={{ marginLeft: 6, color: '#64748b', fontSize: 11 }}>[{msg.files.map(f => f.name).join(', ')}]</span>}
              </div>

              {editingIdx === i ? (
                <div className="chat-edit-area">
                  <textarea className="chat-edit-textarea" value={editText} onChange={e => setEditText(e.target.value)} rows={8} />
                  <div className="chat-edit-actions">
                    <button className="btn-save-sm" onClick={() => saveEdit(i)}>저장</button>
                    <button className="btn-ghost-sm" onClick={cancelEdit}>취소</button>
                  </div>
                </div>
              ) : (
                <div className="chat-bubble-content">
                  {msg.content.split('\n').map((line, j) => <span key={j}>{line}<br /></span>)}
                </div>
              )}

              {/* 에이전트가 실제로 무엇을 조회했는지 — 근거를 못 보면 답을 검증할 수 없다 */}
              {msg.toolLog?.length > 0 && (
                <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px dashed #d7dfea', display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#8492a5' }}>조회 {msg.toolLog.length}회</span>
                  {msg.toolLog.map((t, k) => (
                    <span key={k} title={JSON.stringify(t.args, null, 1)}
                      style={{ fontSize: 10.5, fontWeight: 600, color: '#1d4fa8', background: '#e8f1fc', border: '1px solid #c3dcf7', borderRadius: 6, padding: '2px 7px' }}>
                      {TOOL_LABEL[t.name] || t.name} · {t.summary}
                    </span>
                  ))}
                </div>
              )}

              {editingIdx !== i && (
                <div className="chat-bubble-actions">
                  <button className="chat-copy-btn" onClick={() => copyMessage(msg.content, i)}>{copiedIdx === i ? '복사됨!' : '복사'}</button>
                  <button className="chat-copy-btn" onClick={() => startEdit(i)}>수정</button>
                  <button className="chat-copy-btn" onClick={() => deleteMessage(i)} style={{ color: '#ef4444' }}>삭제</button>
                  {msg.role === 'assistant' && !msg.isSystem && (
                    <button className="chat-copy-btn" onClick={() => assignChatMessage(i)} style={{ color: '#2dd4bf' }}>📋 학생 배정</button>
                  )}
                  {/* 수정 중인 기록이 있을 때만 — 새 기록을 만드는 '학생 배정'과 달리 기존 기록을 덮어쓴다 */}
                  {msg.role === 'assistant' && !msg.isSystem && editRecId != null && (
                    <button className="chat-copy-btn" style={{ color: '#a78bfa' }}
                      title="이 답변을 왼쪽에서 수정 중인 기록 본문에 넣습니다. 저장을 눌러야 반영됩니다."
                      onClick={() => applyMessageToRecord(msg.content)}>기록에 반영</button>
                  )}

                  {msg.role === 'assistant' && !msg.isVerify && !msg.isSystem && (
                    <span className="chat-verify-group">
                      {msg.refined && <span style={{ fontSize: '11px', color: '#10b981', marginRight: 4 }}>✓ 검증 반영됨</span>}
                      {Object.entries(MODEL_CFG)
                        .filter(([key]) => key !== selectedModel)
                        .map(([key, cfg]) => (
                          <button key={key} className="chat-verify-btn" style={{ borderColor: cfg.color, color: cfg.color }}
                            onClick={() => verifyChatMessage(i, key)} disabled={verifyingIdx === i}>
                            {verifyingIdx === i ? '...' : `${cfg.label} 검증`}
                          </button>
                        ))}
                    </span>
                  )}
                  {msg.role === 'assistant' && msg.isVerify && (
                    <button
                      className="chat-verify-btn"
                      style={{ borderColor: '#10b981', color: '#10b981', fontWeight: 600 }}
                      onClick={() => refineChatWithVerify(i)}
                      disabled={refiningVerifyIdx === i}
                    >
                      {refiningVerifyIdx === i ? '반영 중...' : '✓ 이 검증 결과 반영'}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="chat-bubble assistant">
              <div className="chat-bubble-label">컨설턴트</div>
              <div className="chat-bubble-content chat-typing"><span></span><span></span><span></span></div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* 첨부 파일 미리보기 */}
        {attachedFiles.length > 0 && (
          <div className="chat-attached-files">
            {attachedFiles.map((f, i) => (
              <div key={i} className="attached-file-chip">
                {f.type === 'image' && f.preview && <img src={f.preview} alt="" className="attached-thumb" />}
                <span className="attached-file-icon">{f.type === 'pdf' ? 'PDF' : 'IMG'}</span>
                <span className="attached-file-name">{f.name}</span>
                <button className="attached-file-remove" onClick={() => removeFile(i)}>x</button>
              </div>
            ))}
          </div>
        )}

        {/* 학생 맞춤 빠른 질문 */}
        {dossier && (
          <div style={CS.quickRow}>
            <span style={CS.quickLabel}>{dossier.student.name} 학생 · 빠른 상담</span>
            {QUICK_ASKS.map((q) => (
              <button key={q.label} style={CS.quickChip} disabled={loading} onClick={() => sendMessage(q.q)}>{q.label}</button>
            ))}
          </div>
        )}

        {/* 에이전트 모드 토글 — 켜면 서버가 입결·지식베이스를 직접 조회한다 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px 0', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
            title="켜면 AI가 전국 입결 7만 건과 지식베이스를 스스로 찾아본 뒤 답합니다. 조건을 미리 다 적지 않아도 됩니다.">
            <input type="checkbox" checked={agentMode} onChange={e => setAgentMode(e.target.checked)} />
            자료 조회 모드
          </label>
          <span style={{ fontSize: 11.5, color: '#8492a5' }}>
            {agentMode
              ? `입결·지식베이스를 직접 조회합니다${boardStudent ? ` · ${boardStudent.name} 학생 자료 전체 사용` : ' · 학생을 고르면 그 학생 자료까지 함께 봅니다'} · GPT 모델 필요`
              : '끄면 왼쪽 패널에서 고른 기록만 보고 답합니다'}
          </span>
        </div>

        {/* 입력 영역 */}
        <div className="chat-input-area">
          <button className="chat-file-btn" onClick={() => fileInputRef.current?.click()} disabled={uploadingFiles} title="파일 첨부 (PDF, 이미지, JSON)">
            {uploadingFiles ? '...' : '+'}
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.json" multiple style={{ display: 'none' }} onChange={handleFileSelect} />

          <textarea ref={inputRef} className="chat-input" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="질문을 입력하세요... (Enter 전송, Shift+Enter 줄바꿈) | Ctrl+V로 이미지 붙여넣기 | 파일 드래그앤드롭" rows={2} disabled={loading} />

          <button className="btn-primary chat-send-btn" onClick={sendMessage} disabled={loading || (!input.trim() && attachedFiles.length === 0)}>
            {loading ? '답변 중...' : '전송'}
          </button>
        </div>
      </div>

      {/* 리포트 미리보기 모달 */}
      {showReportPreview && (
        <div className="report-preview-overlay" onClick={() => setShowReportPreview(false)}>
          <div className="report-preview-modal" onClick={e => e.stopPropagation()}>
            <div className="report-preview-header">
              <h3>리포트 미리보기</h3>
              <button className="btn-ghost-sm" onClick={() => setShowReportPreview(false)}>닫기</button>
            </div>
            <div className="report-preview-body">
              <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>리포트에 포함할 메시지를 선택하세요. 체크 해제하면 해당 메시지가 리포트에서 제외됩니다.</p>
              <div className="report-preview-controls">
                <button className="btn-ghost-sm" onClick={() => { const all = {}; messages.forEach((_, i) => { all[i] = true; }); setReportInclude(all); }}>전체 선택</button>
                <button className="btn-ghost-sm" onClick={() => setReportInclude({})}>전체 해제</button>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>{Object.values(reportInclude).filter(Boolean).length}개 선택</span>
              </div>
              <div className="report-preview-list">
                {messages.map((msg, i) => (
                  <label key={i} className={`report-preview-item ${reportInclude[i] ? 'included' : ''}`}>
                    <input type="checkbox" checked={!!reportInclude[i]} onChange={e => setReportInclude(prev => ({ ...prev, [i]: e.target.checked }))} />
                    <span className={`preview-role ${msg.role}`}>{msg.role === 'user' ? '질문' : msg.isSystem ? '시스템' : 'AI'}</span>
                    <span className="preview-text">{msg.content.slice(0, 100)}{msg.content.length > 100 ? '...' : ''}</span>
                    {msg.edited && <span style={{ color: '#f59e0b', fontSize: 11 }}>[수정됨]</span>}
                  </label>
                ))}
              </div>
            </div>
            <div className="report-preview-footer">
              <button className="btn-primary" onClick={generateReport}>PDF 리포트 생성 ({Object.values(reportInclude).filter(Boolean).length}개 메시지)</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
