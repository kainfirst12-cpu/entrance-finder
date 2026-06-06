import Settings from './components/Settings';
import Login from './components/Login';
import { useState, useRef, useEffect } from 'react';
import StudentForm from './components/StudentForm';
import AnalysisProgress from './components/AnalysisProgress';
import AnalysisResult from './components/AnalysisResult';
import StudentList from './components/StudentList';
import ChatInterface from './components/ChatInterface';
import Assessment from './components/Assessment';
import Board from './components/Board';
import AdminDashboard from './components/AdminDashboard';
import { API_BASE } from './apiBase';
import './App.css';

const INPROGRESS_KEY = 'ef_inprogress';

export default function App() {
  const [isLoggedIn, setIsLoggedIn]   = useState(!!localStorage.getItem('ef_token'));
  const [role, setRole]               = useState(localStorage.getItem('ef_role') || 'user');
  // 새로고침/끊김 복구: 진행 중이던 분석이 저장돼 있으면 결과화면으로 복원
  const recovered = (() => {
    try {
      const raw = localStorage.getItem(INPROGRESS_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (d?.results && Object.keys(d.results).length > 0) return d;
    } catch {}
    return null;
  })();
  const [view, setView]               = useState(recovered ? 'result' : 'list');
  const [analysisData, setAnalysisData] = useState(recovered);
  const partialRef = useRef(null);
  const [progressSteps, setProgressSteps] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [formPrefill, setFormPrefill] = useState(null); // JSON 불러오기 시 폼에 미리 채울 데이터
  const [apiKey, setApiKey]           = useState(localStorage.getItem('ef_apikey')    || '');
  const [geminiKey, setGeminiKey]     = useState(localStorage.getItem('ef_geminikey') || '');
  const [gptKey, setGptKey]           = useState(localStorage.getItem('ef_gptkey')    || '');
  const [selectedModel, setSelectedModel] = useState(
    localStorage.getItem('ef_model') || 'claude'
  );

  // 현재 접속 추적용 하트비트 (60초마다)
  useEffect(() => {
    if (!isLoggedIn) return;
    const ping = () => {
      const token = localStorage.getItem('ef_token');
      if (!token) return;
      fetch(`${API_BASE}/api/heartbeat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    };
    ping();
    const id = setInterval(ping, 60000);
    return () => clearInterval(id);
  }, [isLoggedIn]);

  const handleLogout = () => {
    localStorage.removeItem('ef_token');
    localStorage.removeItem('ef_role');
    localStorage.removeItem('ef_name');
    setIsLoggedIn(false);
    setRole('user');
  };

  const getActiveKey = () => {
    const group = modelConfig[selectedModel]?.group || selectedModel;
    if (group === 'gemini') return geminiKey;
    if (group === 'gpt')    return gptKey;
    return apiKey;
  };

  const startAnalysis = async (studentData, files, extras = {}) => {
    // extras = { pdfTexts, existingResults, sectionsToRun }
    setView('analyzing');
    setProgressSteps([]);
    setCurrentStep(0);

    const pdfCountInit = Object.values(files).filter(Boolean).length;
    // 부분 저장용 누적 버퍼 — 재분석이면 기존 결과 위에 덮어씀
    partialRef.current = {
      results: { ...(extras.existingResults || {}) },
      studentData,
      pdfCount: pdfCountInit,
      analyzedModel: selectedModel,
      pdfTexts: extras.pdfTexts || '',
    };
    const persistPartial = () => {
      try { localStorage.setItem(INPROGRESS_KEY, JSON.stringify(partialRef.current)); } catch {}
    };

    try {
      const formData = new FormData();
      formData.append('studentData', JSON.stringify(studentData));

      if (files.recordPdf)   { formData.append('recordPdf',   files.recordPdf);   console.log('[Upload] recordPdf:', files.recordPdf.name, files.recordPdf.size, 'bytes'); }
      if (files.gradePdf)    { formData.append('gradePdf',    files.gradePdf);    console.log('[Upload] gradePdf:', files.gradePdf.name, files.gradePdf.size, 'bytes'); }
      if (files.awardsPdf)   { formData.append('awardsPdf',   files.awardsPdf);   console.log('[Upload] awardsPdf:', files.awardsPdf.name, files.awardsPdf.size, 'bytes'); }
      if (files.mockExamPdf) { formData.append('mockExamPdf', files.mockExamPdf); console.log('[Upload] mockExamPdf:', files.mockExamPdf.name, files.mockExamPdf.size, 'bytes'); }

      // 재분석 모드: 이전 PDF 텍스트 / 기존 결과 / 부분 섹션
      if (extras.pdfTexts) formData.append('pdfTexts', extras.pdfTexts);
      if (extras.existingResults) formData.append('existingResults', JSON.stringify(extras.existingResults));
      if (extras.sectionsToRun?.length) formData.append('sectionsToRun', JSON.stringify(extras.sectionsToRun));

      const pdfCount = Object.values(files).filter(Boolean).length;
      console.log(`[Upload] 총 ${pdfCount}개 PDF 첨부 (재분석: ${!!extras.pdfTexts}, 부분: ${extras.sectionsToRun?.length || '전체'})`);
      const token = localStorage.getItem('ef_token');

      const response = await fetch(`${API_BASE}/api/analyze`, {
        method: 'POST',
        headers: {
          'x-api-key':  getActiveKey(),
          'x-ai-model': modelConfig[selectedModel]?.group || selectedModel,
          'x-ai-submodel': selectedModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`서버 응답 오류: ${response.status}`);
      }

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let completed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'progress') {
              setCurrentStep(data.step);
              setProgressSteps(prev => [
                ...prev.filter(s => s.step !== data.step),
                { step: data.step, label: data.label, total: data.total },
              ]);
            }
            if (data.type === 'section') {
              // 한 섹션이 완료될 때마다 즉시 누적 + 로컬 저장 (중간에 끊겨도 보존)
              partialRef.current.results[data.key] = data.content;
              persistPartial();
            }
            if (data.type === 'complete') {
              completed = true;
              const finalData = {
                results: { ...partialRef.current.results, ...data.results },
                notionUrl: data.notionUrl,
                studentData,
                pdfCount,
                analyzedModel: selectedModel,
                pdfTexts: data.pdfTexts || extras.pdfTexts || '',
              };
              setAnalysisData(finalData);
              localStorage.removeItem(INPROGRESS_KEY); // 정상 완료 → 임시 저장 삭제
              setFormPrefill(null); // 사용 완료된 prefill 해제
              setView('result');
              // 학생 보드에 자동 기록 (선생님 코드 로그인 시)
              if ((localStorage.getItem('ef_role') || 'user') === 'user' && token) {
                fetch(`${API_BASE}/api/board/upsert`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                  body: JSON.stringify({
                    name: studentData.name, school: studentData.school, grade: studentData.grade,
                    major: studentData.major, targetUniv: studentData.targetUniv,
                    record: { type: '생기부 분석', title: `${selectedModel} 분석${pdfCount ? ` · PDF ${pdfCount}건` : ''}` },
                  }),
                }).catch(() => {});
              }
            }
            if (data.type === 'error') {
              completed = true;
              finishWithPartial(`분석 중 오류가 발생했습니다: ${data.message}`);
            }
          } catch {}
        }
      }

      if (!completed) finishWithPartial('서버 연결이 끊어졌습니다.');
    } catch (err) {
      finishWithPartial('서버 연결 오류: ' + err.message);
    }

    // 오류/끊김 시: 그때까지 완료된 섹션이 있으면 결과화면으로 보존, 없으면 폼으로
    function finishWithPartial(msg) {
      const got = partialRef.current?.results || {};
      const doneCount = Object.values(got).filter(Boolean).length;
      if (doneCount > 0) {
        setAnalysisData({ ...partialRef.current, partial: true, notionUrl: null });
        setView('result');
        alert(`${msg}\n\n완료된 ${doneCount}개 항목은 저장되어 결과 화면에 표시됩니다. 누락된 항목은 "이 데이터로 재분석"으로 이어서 분석할 수 있습니다.`);
      } else {
        alert(msg + '\n\n다시 시도해주세요.');
        setView('form');
      }
    }
  };

  const handleApiKeySave = (keys) => {
    setApiKey(keys.anthropic);
    setGeminiKey(keys.gemini);
    setGptKey(keys.gpt);
    localStorage.setItem('ef_apikey',    keys.anthropic);
    localStorage.setItem('ef_geminikey', keys.gemini);
    localStorage.setItem('ef_gptkey',    keys.gpt);
    setView('list');
  };

  const handleModelChange = (model) => {
    setSelectedModel(model);
    localStorage.setItem('ef_model', model);
  };

  // JSON 불러오기
  const fileInputRef = useRef(null);
  const handleImportJSON = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = JSON.parse(evt.target.result);
        if (!data.results || !data.studentData) {
          alert('유효하지 않은 분석 파일입니다. results와 studentData가 필요합니다.');
          return;
        }
        setAnalysisData({
          results: data.results,
          studentData: data.studentData,
          pdfCount: data.pdfCount || 0,
          analyzedModel: data.analyzedModel || 'claude',
          pdfTexts: data.pdfTexts || '',
        });
        if (data.analyzedModel && modelConfig[data.analyzedModel]) {
          setSelectedModel(data.analyzedModel);
        }
        setView('result');
      } catch (err) {
        alert('JSON 파일 파싱 오류: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  if (!isLoggedIn) {
    return <Login onLogin={() => { setIsLoggedIn(true); setRole(localStorage.getItem('ef_role') || 'user'); }} />;
  }

  const modelConfig = {
    claude:       { icon: '🔵', label: 'Claude Sonnet 4.6', color: '#7c6af7', group: 'claude' },
    'claude-opus':{ icon: '🔷', label: 'Claude Opus 4.8',   color: '#5b21b6', group: 'claude' },
    gemini:       { icon: '🟢', label: 'Gemini 3.5 Flash',  color: '#4caf50', group: 'gemini' },
    'gemini-pro': { icon: '🟩', label: 'Gemini 3.1 Pro',    color: '#166534', group: 'gemini' },
    gpt:          { icon: '🟡', label: 'GPT-5.5',           color: '#f0a500', group: 'gpt' },
    'gpt-mini':   { icon: '🟠', label: 'GPT-5.4 Mini',      color: '#ea580c', group: 'gpt' },
    'gpt-4.1':    { icon: '🟤', label: 'GPT-5.4',           color: '#78350f', group: 'gpt' },
    'o3':         { icon: '⚪', label: 'GPT-5.5 Pro',       color: '#374151', group: 'gpt' },
    'o4-mini':    { icon: '🔘', label: 'GPT-5.4 Nano',      color: '#6b7280', group: 'gpt' },
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-icon">🎯</span>
          <div>
            <div className="logo-title">입시-Finder</div>
            <div className="logo-sub">패스파인더 에듀</div>
          </div>
        </div>

        {/* AI 모델 선택 */}
        <div className="model-selector">
          <div className="model-selector-label">AI 모델 선택</div>
          {Object.entries(modelConfig).map(([key, cfg]) => (
            <button
              key={key}
              className={`model-btn ${selectedModel === key ? 'active' : ''}`}
              style={selectedModel === key ? { borderColor: cfg.color, color: cfg.color } : {}}
              onClick={() => handleModelChange(key)}
            >
              {cfg.icon} {cfg.label}
            </button>
          ))}
        </div>

        <nav className="nav">
          <button className={`nav-item ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
            <span>👥</span> 학생 목록
          </button>
          <button
            className={`nav-item ${['form', 'analyzing', 'result'].includes(view) ? 'active' : ''}`}
            onClick={() => setView('form')}
          >
            <span>✨</span> 새 분석 시작
          </button>
          <button className="nav-item" onClick={() => fileInputRef.current?.click()}>
            <span>📂</span> 분석 불러오기
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleImportJSON}
          />
          <button className={`nav-item ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')}>
            <span>💬</span> 입시 상담
          </button>
          <button className={`nav-item ${view === 'assessment' ? 'active' : ''}`} onClick={() => setView('assessment')}>
            <span>📝</span> 수행평가
          </button>
          <button className={`nav-item ${view === 'board' ? 'active' : ''}`} onClick={() => setView('board')}>
            <span>📋</span> 학생 관리 보드
          </button>
          <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            <span>⚙️</span> 설정
          </button>
          {role === 'admin' && (
            <button className={`nav-item ${view === 'admin' ? 'active' : ''}`} onClick={() => setView('admin')}>
              <span>🛡️</span> 관리자
            </button>
          )}
          <button className="nav-item" onClick={handleLogout}>
            <span>🚪</span> 로그아웃
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="drive-status">
            <span className="status-dot green"></span>
            <span>Drive 연결됨</span>
          </div>
          <div className="drive-status">
            <span className="status-dot green"></span>
            <span>Notion 연결됨</span>
          </div>
        </div>
      </aside>

      <main className="main">
        {view === 'list'      && <StudentList onNewAnalysis={() => setView('form')} />}
        {view === 'form'      && (
          <StudentForm
            onSubmit={startAnalysis}
            onCancel={() => { setFormPrefill(null); setView('list'); }}
            prefill={formPrefill}
            onClearPrefill={() => setFormPrefill(null)}
          />
        )}
        {view === 'analyzing' && <AnalysisProgress steps={progressSteps} currentStep={currentStep} />}
        {view === 'result' && analysisData && (
          <AnalysisResult
            data={analysisData}
            onBack={() => setView('list')}
            onNewAnalysis={() => { setFormPrefill(null); setView('form'); }}
            onReanalyze={(prefillData) => {
              setFormPrefill(prefillData);
              setView('form');
            }}
            selectedModel={selectedModel}
            apiKey={apiKey}
            geminiKey={geminiKey}
            gptKey={gptKey}
          />
        )}
        {view === 'chat' && (
          <ChatInterface getActiveKey={getActiveKey} selectedModel={selectedModel} analysisData={analysisData} />
        )}
        {view === 'assessment' && (
          <Assessment
            getActiveKey={getActiveKey}
            selectedModel={selectedModel}
            aiGroup={modelConfig[selectedModel]?.group || selectedModel}
          />
        )}
        {view === 'settings' && (
          <Settings apiKey={apiKey} geminiKey={geminiKey} gptKey={gptKey} onSave={handleApiKeySave} />
        )}
        {view === 'board' && (
          <Board onAuthError={handleLogout} />
        )}
        {view === 'admin' && role === 'admin' && (
          <AdminDashboard onAuthError={handleLogout} />
        )}
      </main>
    </div>
  );
}