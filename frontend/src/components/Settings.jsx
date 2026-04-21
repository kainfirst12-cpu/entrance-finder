import { useState, useRef } from 'react';
import { API_BASE } from '../apiBase';

export default function Settings({ apiKey, geminiKey, gptKey, onSave }) {
  const [keys, setKeys] = useState({
    anthropic: apiKey || '',
    gemini: geminiKey || '',
    gpt: gptKey || '',
  });
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState({ claude: null, gemini: null, gpt: null });
  const [testError, setTestError] = useState({ claude: '', gemini: '', gpt: '' });

  // 브랜드 설정
  const [brandName, setBrandName] = useState(localStorage.getItem('ef_brand_name') || 'PATHFINDER EDU');
  const [brandSub, setBrandSub] = useState(localStorage.getItem('ef_brand_sub') || '패스파인더 에듀');
  const [reportTitle, setReportTitle] = useState(localStorage.getItem('ef_report_title') || 'PATHFINDER REPORT');
  const [logoData, setLogoData] = useState(localStorage.getItem('ef_logo') || '');
  const fileRef = useRef(null);

  const handleSave = () => {
    onSave(keys);
    // 브랜드 설정 저장
    localStorage.setItem('ef_brand_name', brandName);
    localStorage.setItem('ef_brand_sub', brandSub);
    localStorage.setItem('ef_report_title', reportTitle);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      alert('로고 파일은 500KB 이하로 업로드해 주세요.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const data = ev.target.result;
      setLogoData(data);
      localStorage.setItem('ef_logo', data);
    };
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setLogoData('');
    localStorage.removeItem('ef_logo');
    if (fileRef.current) fileRef.current.value = '';
  };

  const testConnection = async (model) => {
    const keyMap = { claude: keys.anthropic, gemini: keys.gemini, gpt: keys.gpt };
    const key = keyMap[model];
    if (!key) { setTestStatus(prev => ({ ...prev, [model]: 'nokey' })); return; }
    setTestStatus(prev => ({ ...prev, [model]: 'testing' }));
    try {
      const token = localStorage.getItem('ef_token');
      const res = await fetch(`${API_BASE}/api/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'x-api-key': key },
        body: JSON.stringify({ aiModel: model }),
      });
      const data = await res.json();
      if (data.success) {
        setTestStatus(prev => ({ ...prev, [model]: 'success' }));
        setTestError(prev => ({ ...prev, [model]: '' }));
      } else {
        setTestStatus(prev => ({ ...prev, [model]: 'fail' }));
        setTestError(prev => ({ ...prev, [model]: data.message || '알 수 없는 오류' }));
      }
    } catch (err) {
      setTestStatus(prev => ({ ...prev, [model]: 'fail' }));
      setTestError(prev => ({ ...prev, [model]: err.message }));
    }
  };

  const statusLabel = (model) => {
    switch (testStatus[model]) {
      case 'testing': return '테스트 중...';
      case 'success': return '연결 성공';
      case 'fail':    return '연결 실패';
      case 'nokey':   return '키 없음';
      default:        return '연결 테스트';
    }
  };

  const statusClass = (model) => {
    switch (testStatus[model]) {
      case 'success': return 'test-btn success';
      case 'fail':    return 'test-btn fail';
      case 'nokey':   return 'test-btn warn';
      default:        return 'test-btn';
    }
  };

  return (
    <div className="settings-container">
      <h2>설정</h2>

      {/* 브랜드/로고 설정 */}
      <div className="settings-group">
        <h3 className="settings-group-title">리포트 브랜딩</h3>

        <div className="settings-section">
          <label>리포트 상단 타이틀</label>
          <input
            type="text"
            value={reportTitle}
            onChange={(e) => setReportTitle(e.target.value)}
            placeholder="PATHFINDER REPORT"
            className="api-key-input"
          />
        </div>

        <div className="settings-section">
          <label>학원/기관 이름 (영문)</label>
          <input
            type="text"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="PATHFINDER EDU"
            className="api-key-input"
          />
        </div>

        <div className="settings-section">
          <label>학원/기관 이름 (한글)</label>
          <input
            type="text"
            value={brandSub}
            onChange={(e) => setBrandSub(e.target.value)}
            placeholder="패스파인더 에듀"
            className="api-key-input"
          />
        </div>

        <div className="settings-section">
          <label>학원 로고 (500KB 이하, PNG/JPG)</label>
          <div className="logo-upload-area">
            {logoData ? (
              <div className="logo-preview-wrap">
                <img src={logoData} alt="로고" className="logo-preview-img" />
                <div className="logo-actions">
                  <button className="btn-ghost" onClick={() => fileRef.current?.click()}>변경</button>
                  <button className="btn-ghost btn-danger-text" onClick={removeLogo}>삭제</button>
                </div>
              </div>
            ) : (
              <div className="logo-dropzone" onClick={() => fileRef.current?.click()}>
                <span className="logo-dropzone-text">클릭하여 로고 업로드</span>
                <span className="logo-dropzone-hint">PNG, JPG / 500KB 이하</span>
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" onChange={handleLogoUpload} hidden />
          </div>
        </div>
      </div>

      {/* API 키 설정 */}
      <div className="settings-group">
        <h3 className="settings-group-title">AI API 키</h3>

        <div className="settings-section">
          <label>Anthropic (Claude) API 키</label>
          <div className="key-row">
            <input type="password" value={keys.anthropic} onChange={(e) => setKeys({ ...keys, anthropic: e.target.value })} placeholder="sk-ant-..." className="api-key-input" />
            <button onClick={() => testConnection('claude')} className={statusClass('claude')} disabled={testStatus.claude === 'testing'}>{statusLabel('claude')}</button>
          </div>
          {testError.claude && <p className="test-error">{testError.claude}</p>}
        </div>

        <div className="settings-section">
          <label>Google Gemini API 키</label>
          <div className="key-row">
            <input type="password" value={keys.gemini} onChange={(e) => setKeys({ ...keys, gemini: e.target.value })} placeholder="AIza..." className="api-key-input" />
            <button onClick={() => testConnection('gemini')} className={statusClass('gemini')} disabled={testStatus.gemini === 'testing'}>{statusLabel('gemini')}</button>
          </div>
          {testError.gemini && <p className="test-error">{testError.gemini}</p>}
        </div>

        <div className="settings-section">
          <label>OpenAI (GPT) API 키</label>
          <div className="key-row">
            <input type="password" value={keys.gpt} onChange={(e) => setKeys({ ...keys, gpt: e.target.value })} placeholder="sk-..." className="api-key-input" />
            <button onClick={() => testConnection('gpt')} className={statusClass('gpt')} disabled={testStatus.gpt === 'testing'}>{statusLabel('gpt')}</button>
          </div>
          {testError.gpt && <p className="test-error">{testError.gpt}</p>}
        </div>
      </div>

      <p className="settings-hint">API 키와 로고는 브라우저에만 저장됩니다.</p>

      <button onClick={handleSave} className="save-btn">
        {saved ? '저장됨!' : '저장'}
      </button>
    </div>
  );
}
