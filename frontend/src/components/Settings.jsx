import { useState } from 'react';

export default function Settings({ apiKey, geminiKey, gptKey, onSave }) {
  const [keys, setKeys] = useState({
    anthropic: apiKey || '',
    gemini: geminiKey || '',
    gpt: gptKey || '',
  });
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onSave(keys);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings-container">
      <h2>⚙️ 설정</h2>

      <div className="settings-section">
        <label>🤖 Anthropic (Claude) API 키</label>
        <input type="password" value={keys.anthropic}
          onChange={(e) => setKeys({...keys, anthropic: e.target.value})}
          placeholder="sk-ant-..." className="api-key-input" />
      </div>

      <div className="settings-section">
        <label>✨ Google Gemini API 키</label>
        <input type="password" value={keys.gemini}
          onChange={(e) => setKeys({...keys, gemini: e.target.value})}
          placeholder="AIza..." className="api-key-input" />
      </div>

      <div className="settings-section">
        <label>💚 OpenAI (GPT) API 키</label>
        <input type="password" value={keys.gpt}
          onChange={(e) => setKeys({...keys, gpt: e.target.value})}
          placeholder="sk-..." className="api-key-input" />
      </div>

      <p className="settings-hint">API 키는 브라우저에만 저장되며 서버로 직접 전달됩니다.</p>
      <button onClick={handleSave} className="save-btn">
        {saved ? '✅ 저장됨!' : '저장'}
      </button>
    </div>
  );
}