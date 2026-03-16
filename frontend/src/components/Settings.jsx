import { useState } from 'react';

export default function Settings({ apiKey, onSave }) {
  const [inputKey, setInputKey] = useState(apiKey || '');
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    onSave(inputKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="settings-container">
      <h2>⚙️ 설정</h2>
      <div className="settings-section">
        <label>Anthropic API 키</label>
        <input
          type="password"
          value={inputKey}
          onChange={(e) => setInputKey(e.target.value)}
          placeholder="sk-ant-..."
          className="api-key-input"
        />
        <p className="settings-hint">
          API 키는 브라우저에만 저장되며 서버로 직접 전달됩니다.
        </p>
        <button onClick={handleSave} className="save-btn">
          {saved ? '✅ 저장됨!' : '저장'}
        </button>
      </div>
    </div>
  );
}