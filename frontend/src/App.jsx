import Settings from './components/Settings';
import Login from './components/Login';
import { useState, useRef } from 'react';
import StudentForm from './components/StudentForm';
import AnalysisProgress from './components/AnalysisProgress';
import AnalysisResult from './components/AnalysisResult';
import StudentList from './components/StudentList';
import ChatInterface from './components/ChatInterface';
import './App.css';

const API_BASE = 'https://entrance-finder-production.up.railway.app';

export default function App() {
  const [isLoggedIn, setIsLoggedIn]   = useState(!!localStorage.getItem('ef_token'));
  const [view, setView]               = useState('list');
  const [analysisData, setAnalysisData] = useState(null);
  const [progressSteps, setProgressSteps] = useState([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [apiKey, setApiKey]           = useState(localStorage.getItem('ef_apikey')    || '');
  const [geminiKey, setGeminiKey]     = useState(localStorage.getItem('ef_geminikey') || '');
  const [gptKey, setGptKey]           = useState(localStorage.getItem('ef_gptkey')    || '');
  const [selectedModel, setSelectedModel] = useState(
    localStorage.getItem('ef_model') || 'claude'
  );

  const getActiveKey = () => {
    const group = modelConfig[selectedModel]?.group || selectedModel;
    if (group === 'gemini') return geminiKey;
    if (group === 'gpt')    return gptKey;
    return apiKey;
  };

  const startAnalysis = async (studentData, files) => {
    setView('analyzing');
    setProgressSteps([]);
    setCurrentStep(0);

    try {
      const formData = new FormData();
      formData.append('studentData', JSON.stringify(studentData));

      if (files.recordPdf)   { formData.append('recordPdf',   files.recordPdf);   console.log('[Upload] recordPdf:', files.recordPdf.name, files.recordPdf.size, 'bytes'); }
      if (files.gradePdf)    { formData.append('gradePdf',    files.gradePdf);    console.log('[Upload] gradePdf:', files.gradePdf.name, files.gradePdf.size, 'bytes'); }
      if (files.awardsPdf)   { formData.append('awardsPdf',   files.awardsPdf);   console.log('[Upload] awardsPdf:', files.awardsPdf.name, files.awardsPdf.size, 'bytes'); }
      if (files.mockExamPdf) { formData.append('mockExamPdf', files.mockExamPdf); console.log('[Upload] mockExamPdf:', files.mockExamPdf.name, files.mockExamPdf.size, 'bytes'); }

      const pdfCount = Object.values(files).filter(Boolean).length;
      console.log(`[Upload] 총 ${pdfCount}개 PDF 첨부`);
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
            if (data.type === 'complete') {
              completed = true;
              setAnalysisData({ results: data.results, notionUrl: data.notionUrl, studentData, pdfCount, analyzedModel: selectedModel });
              setView('result');
            }
            if (data.type === 'error') {
              completed = true;
              alert('분석 오류: ' + data.message);
              setView('form');
            }
          } catch {}
        }
      }

      if (!completed) {
        alert('서버 연결이 끊어졌습니다. 다시 시도해주세요.');
        setView('form');
      }
    } catch (err) {
      alert('서버 연결 오류: ' + err.message);
      setView('form');
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
    return <Login onLogin={() => setIsLoggedIn(true)} />;
  }

  const modelConfig = {
    claude:       { icon: '🔵', label: 'Claude Sonnet',    color: '#7c6af7', group: 'claude' },
    'claude-opus':{ icon: '🔷', label: 'Claude Opus',      color: '#5b21b6', group: 'claude' },
    gemini:       { icon: '🟢', label: 'Gemini Flash',     color: '#4caf50', group: 'gemini' },
    'gemini-pro': { icon: '🟩', label: 'Gemini Pro',       color: '#166534', group: 'gemini' },
    gpt:          { icon: '🟡', label: 'GPT-4o',           color: '#f0a500', group: 'gpt' },
    'gpt-mini':   { icon: '🟠', label: 'GPT-4o Mini',      color: '#ea580c', group: 'gpt' },
    'gpt-4.1':    { icon: '🟤', label: 'GPT-4.1',          color: '#78350f', group: 'gpt' },
    'o3':         { icon: '⚪', label: 'o3',                color: '#374151', group: 'gpt' },
    'o4-mini':    { icon: '🔘', label: 'o4-mini',           color: '#6b7280', group: 'gpt' },
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
          <button className={`nav-item ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
            <span>⚙️</span> 설정
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
        {view === 'form'      && <StudentForm onSubmit={startAnalysis} onCancel={() => setView('list')} />}
        {view === 'analyzing' && <AnalysisProgress steps={progressSteps} currentStep={currentStep} />}
        {view === 'result' && analysisData && (
          <AnalysisResult
            data={analysisData}
            onBack={() => setView('list')}
            onNewAnalysis={() => setView('form')}
            selectedModel={selectedModel}
            apiKey={apiKey}
            geminiKey={geminiKey}
            gptKey={gptKey}
          />
        )}
        {view === 'chat' && (
          <ChatInterface getActiveKey={getActiveKey} selectedModel={selectedModel} analysisData={analysisData} />
        )}
        {view === 'settings' && (
          <Settings apiKey={apiKey} geminiKey={geminiKey} gptKey={gptKey} onSave={handleApiKeySave} />
        )}
      </main>
    </div>
  );
}