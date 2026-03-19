import { useState, useRef, useEffect } from 'react';

const API_BASE = 'https://entrance-finder-production.up.railway.app';

export default function ChatInterface({ getActiveKey, selectedModel }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '안녕하세요! 입시 전문 컨설턴트입니다.\n생기부, 세특, 입시 전략 등 궁금한 점을 자유롭게 질문해 주세요.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const apiKey = getActiveKey();
    if (!apiKey) {
      setMessages(prev => [...prev, { role: 'assistant', content: '설정에서 API 키를 먼저 입력해 주세요.' }]);
      return;
    }

    const userMsg = { role: 'user', content: text };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const history = messages.filter(m => m.role !== 'system').slice(-10);
      const token = localStorage.getItem('ef_token');

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-ai-model': selectedModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text, history }),
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const copyMessage = async (content, idx) => {
    await navigator.clipboard.writeText(content);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const copyAllChat = async () => {
    const text = messages
      .map(m => `[${m.role === 'user' ? '나' : 'AI 컨설턴트'}]\n${m.content}`)
      .join('\n\n---\n\n');
    await navigator.clipboard.writeText(text);
    setCopiedIdx('all');
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const clearChat = () => {
    setMessages([
      { role: 'assistant', content: '대화가 초기화되었습니다. 새로운 질문을 해주세요!' },
    ]);
  };

  const modelLabels = { claude: 'Claude', gemini: 'Gemini', gpt: 'GPT-4o' };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>입시 상담 채팅</h2>
        <div className="chat-header-right">
          <span className="chat-model-badge">{modelLabels[selectedModel] || 'Claude'}</span>
          <button className="btn-ghost chat-clear-btn" onClick={copyAllChat}>
            {copiedIdx === 'all' ? '복사됨!' : '전체 복사'}
          </button>
          <button className="btn-ghost chat-clear-btn" onClick={clearChat}>초기화</button>
        </div>
      </div>

      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            <div className="chat-bubble-label">
              {msg.role === 'user' ? '나' : 'AI 컨설턴트'}
            </div>
            <div className="chat-bubble-content">
              {msg.content.split('\n').map((line, j) => (
                <span key={j}>{line}<br /></span>
              ))}
            </div>
            {msg.role === 'assistant' && (
              <button
                className="chat-copy-btn"
                onClick={() => copyMessage(msg.content, i)}
              >
                {copiedIdx === i ? '복사됨!' : '복사'}
              </button>
            )}
          </div>
        ))}
        {loading && (
          <div className="chat-bubble assistant">
            <div className="chat-bubble-label">AI 컨설턴트</div>
            <div className="chat-bubble-content chat-typing">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="생기부, 세특, 입시 전략 등 질문을 입력하세요... (Enter로 전송, Shift+Enter로 줄바꿈)"
          rows={2}
          disabled={loading}
        />
        <button
          className="btn-primary chat-send-btn"
          onClick={sendMessage}
          disabled={loading || !input.trim()}
        >
          {loading ? '답변 중...' : '전송'}
        </button>
      </div>
    </div>
  );
}
