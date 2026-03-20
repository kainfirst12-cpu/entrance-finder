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

  const handlePrintChat = () => {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const modelLabel = modelLabels[selectedModel] || 'AI';

    const messagesHTML = messages.map((msg) => {
      const content = msg.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const isUser = msg.role === 'user';
      return `
        <div class="msg ${isUser ? 'user' : 'ai'}">
          <div class="msg-label">${isUser ? '나' : `AI 컨설턴트 (${modelLabel})`}</div>
          <div class="msg-content">${content}</div>
        </div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>입시 상담 기록 - 패스파인더 에듀</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans KR', sans-serif;
    color: #1a1916;
    background: #fff;
    font-size: 13px;
    line-height: 1.8;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .print-bar {
    position: fixed;
    top: 0; left: 0; right: 0;
    background: #1a2744;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 10px 24px;
    z-index: 100;
    font-size: 14px;
    font-weight: 500;
  }
  .print-bar button {
    padding: 8px 24px;
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .print-bar button:hover { background: #1d4ed8; }
  .print-bar .close-btn {
    background: transparent;
    border: 1px solid rgba(255,255,255,0.3);
    padding: 8px 16px;
  }
  .print-bar .close-btn:hover { background: rgba(255,255,255,0.1); }
  .report {
    max-width: 800px;
    margin: 70px auto 60px;
    padding: 0 24px;
  }
  .cover {
    background: #1a2744;
    color: #fff;
    padding: 40px 44px;
    border-radius: 12px;
    margin-bottom: 32px;
    page-break-after: always;
  }
  .cover-logo {
    font-size: 11px;
    letter-spacing: 0.2em;
    color: rgba(255,255,255,0.45);
    margin-bottom: 12px;
    text-transform: uppercase;
  }
  .cover-title {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 20px;
    line-height: 1.4;
  }
  .cover-info {
    font-size: 14px;
    color: rgba(255,255,255,0.7);
    line-height: 1.8;
  }
  .cover-info strong { color: #fff; }
  .messages { display: flex; flex-direction: column; gap: 20px; }
  .msg {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    overflow: hidden;
    page-break-inside: avoid;
  }
  .msg-label {
    padding: 10px 18px;
    font-size: 12px;
    font-weight: 600;
    border-bottom: 1px solid #e5e7eb;
  }
  .msg.user .msg-label { background: #eff6ff; color: #2563eb; }
  .msg.ai .msg-label { background: #f8f9fa; color: #1a2744; }
  .msg-content {
    padding: 16px 20px;
    font-size: 13px;
    line-height: 1.9;
    white-space: pre-wrap;
    word-break: break-word;
    color: #333;
  }
  .report-footer {
    text-align: center;
    padding: 24px 0;
    font-size: 11px;
    color: #999;
    border-top: 1px solid #e5e7eb;
    margin-top: 24px;
  }
  @media print {
    .print-bar { display: none !important; }
    .report { margin-top: 0; }
    .cover { border-radius: 0; margin: 0 -24px 0; }
    .msg { break-inside: avoid; }
    body { font-size: 12px; }
  }
  @page { size: A4; margin: 20mm 15mm; }
</style>
</head>
<body>
  <div class="print-bar">
    <span>상담 기록이 준비되었습니다.</span>
    <button onclick="window.print()">PDF로 인쇄 / 저장</button>
    <button class="close-btn" onclick="window.close()">닫기</button>
  </div>
  <div class="report">
    <div class="cover">
      <div class="cover-logo">PATHFINDER EDU</div>
      <div class="cover-title">입시 상담 기록</div>
      <div class="cover-info">
        <strong>AI 모델:</strong> ${modelLabel}<br>
        <strong>상담일:</strong> ${today}<br>
        <strong>메시지:</strong> ${messages.length}건
      </div>
    </div>
    <div class="messages">
      ${messagesHTML}
    </div>
    <div class="report-footer">
      패스파인더 에듀 · 입시-Finder &copy; ${new Date().getFullYear()} &mdash; ${today} 생성
    </div>
  </div>
</body>
</html>`;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    } else {
      alert('팝업이 차단되었습니다. 팝업 차단을 해제해 주세요.');
    }
  };

  const modelLabels = { claude: 'Claude', gemini: 'Gemini', gpt: 'GPT-4o' };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h2>입시 상담 채팅</h2>
        <div className="chat-header-right">
          <span className="chat-model-badge">{modelLabels[selectedModel] || 'Claude'}</span>
          <button className="btn-print-html-sm" onClick={handlePrintChat}>
            🖨️ PDF 인쇄
          </button>
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
