import Settings from './components/Settings';
import Login from './components/Login';
import { useState } from 'react';
import StudentForm from './components/StudentForm';
import AnalysisProgress from './components/AnalysisProgress';
import AnalysisResult from './components/AnalysisResult';
import StudentList from './components/StudentList';
import './App.css';

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
    if (selectedModel === 'gemini') return geminiKey;
    if (selectedModel === 'gpt')    return gptKey;
    return apiKey;
  };

  const startAnalysis = async (studentData, files) => {
    setView('analyzing');
    setProgressSteps([]);
    setCurrentStep(0);

    try {
      const formData = new FormData();
      formData.append('studentData', JSON.stringify(studentData));

      if (files.recordPdf)   formData.append('recordPdf',   files.recordPdf);
      if (files.gradePdf)    formData.append('gradePdf',    files.gradePdf);
      if (files.awardsPdf)   formData.append('awardsPdf',   files.awardsPdf);
      if (files.mockExamPdf) formData.append('mockExamPdf', files.mockExamPdf);

      const pdfCount = Object.values(files).filter(Boolean).length;
      const token = localStorage.getItem('ef_token');

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/analyze`, {
        method: 'POST',
        headers: {
          'x-api-key':  getActiveKey(),
          'x-ai-model': selectedModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
              setAnalysisData({ results: data.results, notionUrl: data.notionUrl, studentData, pdfCount });
              setView('result');
            }
            if (data.type === 'error') {
              alert('분석 오류: ' + data.message);
              setView('form');
            }
          } catch {}
        }
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

  if (!isLoggedIn) {
    return <Login onLogin={() => setIsLoggedIn(true)} />;
  }

  const modelConfig = {
    claude: { icon: '🔵', label: 'Claude',  color: '#7c6af7' },
    gemini: { icon: '🟢', label: 'Gemini',  color: '#4caf50' },
    gpt:    { icon: '🟡', label: 'GPT-4o',  color: '#f0a500' },
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
          <AnalysisResult data={analysisData} onBack={() => setView('list')} onNewAnalysis={() => setView('form')} />
        )}
        {view === 'settings' && (
          <Settings apiKey={apiKey} geminiKey={geminiKey} gptKey={gptKey} onSave={handleApiKeySave} />
        )}
      </main>
    </div>
  );
}