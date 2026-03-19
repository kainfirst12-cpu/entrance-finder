import { useState } from 'react';

const API_BASE = 'https://entrance-finder-production.up.railway.app';

export default function Settings({ apiKey, geminiKey, gptKey, onSave }) {
  const [keys, setKeys] = useState({
    anthropic: apiKey || '',
    gemini: geminiKey || '',
    gpt: gptKey || '',
  });
  const [saved, setSaved] = useState(false);
  const [testStatus, setTestStatus] = useState({ claude: null, gemini: null, gpt: null });
  const [testError, setTestError] = useState({ claude: '', gemini: '', gpt: '' });

  const handleSave = () => {
    onSave(keys);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const testConnection = async (model) => {
    const keyMap = { claude: keys.anthropic, gemini: keys.gemini, gpt: keys.gpt };
    const key = keyMap[model];

    if (!key) {
      setTestStatus(prev => ({ ...prev, [model]: 'nokey' }));
      return;
    }

    setTestStatus(prev => ({ ...prev, [model]: 'testing' }));

    try {
      const token = localStorage.getItem('ef_token');
      const res = await fetch(`${API_BASE}/api/test-connection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-api-key': key,
        },
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
      case 'testing': return '⏳ 테스트 중...';
      case 'success': return '✅ 연결 성공';
      case 'fail':    return '❌ 연결 실패';
      case 'nokey':   return '⚠️ 키 없음';
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
      <h2>⚙️ 설정</h2>

      <div className="settings-section">
        <label>🤖 Anthropic (Claude) API 키</label>
        <div className="key-row">
          <input
            type="password"
            value={keys.anthropic}
            onChange={(e) => setKeys({ ...keys, anthropic: e.target.value })}
            placeholder="sk-ant-..."
            className="api-key-input"
          />
          <button
            onClick={() => testConnection('claude')}
            className={statusClass('claude')}
            disabled={testStatus.claude === 'testing'}
          >
            {statusLabel('claude')}
          </button>
        </div>
        {testError.claude && <p className="test-error">{testError.claude}</p>}
      </div>

      <div className="settings-section">
        <label>✨ Google Gemini API 키</label>
        <div className="key-row">
          <input
            type="password"
            value={keys.gemini}
            onChange={(e) => setKeys({ ...keys, gemini: e.target.value })}
            placeholder="AIza..."
            className="api-key-input"
          />
          <button
            onClick={() => testConnection('gemini')}
            className={statusClass('gemini')}
            disabled={testStatus.gemini === 'testing'}
          >
            {statusLabel('gemini')}
          </button>
        </div>
        {testError.gemini && <p className="test-error">{testError.gemini}</p>}
      </div>

      <div className="settings-section">
        <label>💚 OpenAI (GPT) API 키</label>
        <div className="key-row">
          <input
            type="password"
            value={keys.gpt}
            onChange={(e) => setKeys({ ...keys, gpt: e.target.value })}
            placeholder="sk-..."
            className="api-key-input"
          />
          <button
            onClick={() => testConnection('gpt')}
            className={statusClass('gpt')}
            disabled={testStatus.gpt === 'testing'}
          >
            {statusLabel('gpt')}
          </button>
        </div>
        {testError.gpt && <p className="test-error">{testError.gpt}</p>}
      </div>

      <p className="settings-hint">API 키는 브라우저에만 저장되며 서버로 직접 전달됩니다.</p>

      <button onClick={handleSave} className="save-btn">
        {saved ? '✅ 저장됨!' : '저장'}
      </button>
    </div>
  );
}