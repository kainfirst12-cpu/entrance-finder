import { useState, useRef, useEffect } from 'react';

const API_BASE = 'https://entrance-finder-production.up.railway.app';

// 마크다운 → HTML 변환 (채팅 인쇄용)
function chatMdToHtml(raw) {
  if (!raw) return '';
  // 이모지 제거
  let text = raw.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}]/gu, '');
  // HTML escape
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
    let p = line.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    out.push(p);
    i++;
  }
  return out.join('\n');
}

const MODEL_CFG = {
  claude:       { icon: '🔵', label: 'Claude Sonnet', color: '#7c6af7', group: 'claude' },
  'claude-opus':{ icon: '🔷', label: 'Claude Opus',   color: '#5b21b6', group: 'claude' },
  gemini:       { icon: '🟢', label: 'Gemini Flash',  color: '#4caf50', group: 'gemini' },
  'gemini-pro': { icon: '🟩', label: 'Gemini Pro',    color: '#166534', group: 'gemini' },
  gpt:          { icon: '🟡', label: 'GPT-4o',        color: '#f0a500', group: 'gpt' },
  'gpt-mini':   { icon: '🟠', label: 'GPT-4o Mini',   color: '#ea580c', group: 'gpt' },
};

export default function ChatInterface({ getActiveKey, selectedModel }) {
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '안녕하세요! 입시 전문 컨설턴트입니다.\n생기부, 세특, 입시 전략 등 궁금한 점을 자유롭게 질문해 주세요.' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [verifyingIdx, setVerifyingIdx] = useState(null);
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
          'x-ai-model': MODEL_CFG[selectedModel]?.group || selectedModel,
          'x-ai-submodel': selectedModel,
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

  // 다른 AI로 교차 검증
  const verifyChatMessage = async (msgIdx, verifyModel) => {
    const msg = messages[msgIdx];
    if (!msg || msg.role !== 'assistant') return;
    // 해당 답변 바로 위의 사용자 질문 찾기
    let userQuestion = '';
    for (let j = msgIdx - 1; j >= 0; j--) {
      if (messages[j].role === 'user') { userQuestion = messages[j].content; break; }
    }

    const vKey = verifyModel === 'claude'
      ? localStorage.getItem('ef_apikey')
      : verifyModel === 'gemini'
        ? localStorage.getItem('ef_geminikey')
        : localStorage.getItem('ef_gptkey');

    if (!vKey) {
      alert(`${MODEL_CFG[verifyModel]?.label} API 키가 설정되지 않았습니다.`);
      return;
    }

    setVerifyingIdx(msgIdx);
    try {
      const token = localStorage.getItem('ef_token');
      const res = await fetch(`${API_BASE}/api/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': vKey,
          'x-ai-model': verifyModel,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          studentData: { name: '상담 학생' },
          analysisText: `[질문]\n${userQuestion}\n\n[${modelLabels[selectedModel]} 답변]\n${msg.content}`,
          originalModel: modelLabels[selectedModel] || 'AI',
        }),
      });
      const data = await res.json();
      if (data.success) {
        const verifyMsg = {
          role: 'assistant',
          content: `[${MODEL_CFG[verifyModel]?.label} 교차 검증]\n${data.reply}`,
          isVerify: true,
          verifyModel,
        };
        setMessages(prev => {
          const copy = [...prev];
          copy.splice(msgIdx + 1, 0, verifyMsg);
          return copy;
        });
      } else {
        alert('검증 오류: ' + data.message);
      }
    } catch (err) {
      alert('검증 요청 실패: ' + err.message);
    } finally {
      setVerifyingIdx(null);
    }
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
      const content = chatMdToHtml(msg.content);
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
          <div key={i} className={`chat-bubble ${msg.role} ${msg.isVerify ? 'verify' : ''}`}>
            <div className="chat-bubble-label">
              {msg.role === 'user' ? '나' : msg.isVerify ? `${MODEL_CFG[msg.verifyModel]?.label || 'AI'} 교차 검증` : 'AI 컨설턴트'}
            </div>
            <div className="chat-bubble-content">
              {msg.content.split('\n').map((line, j) => (
                <span key={j}>{line}<br /></span>
              ))}
            </div>
            {msg.role === 'assistant' && (
              <div className="chat-bubble-actions">
                <button
                  className="chat-copy-btn"
                  onClick={() => copyMessage(msg.content, i)}
                >
                  {copiedIdx === i ? '복사됨!' : '복사'}
                </button>
                {!msg.isVerify && (
                  <span className="chat-verify-group">
                    {Object.entries(MODEL_CFG)
                      .filter(([key]) => key !== selectedModel)
                      .map(([key, cfg]) => (
                        <button
                          key={key}
                          className="chat-verify-btn"
                          style={{ borderColor: cfg.color, color: cfg.color }}
                          onClick={() => verifyChatMessage(i, key)}
                          disabled={verifyingIdx === i}
                        >
                          {verifyingIdx === i ? '...' : `${cfg.icon} ${cfg.label} 검증`}
                        </button>
                      ))}
                  </span>
                )}
              </div>
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
