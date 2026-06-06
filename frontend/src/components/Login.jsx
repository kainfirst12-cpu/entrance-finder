import { useState } from 'react';
import { API_BASE } from '../apiBase';

export default function Login({ onLogin }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!code) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('ef_token', data.token);
        localStorage.setItem('ef_role', data.role || 'user');
        localStorage.setItem('ef_name', data.name || '');
        onLogin();
      } else {
        setError(data.message || '코드가 올바르지 않습니다.');
      }
    } catch {
      setError('서버 연결 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh',
      background: 'linear-gradient(135deg, #0f1724 0%, #1a2a3a 100%)'
    }}>
      <div style={{
        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '16px', padding: '48px 40px', width: '360px',
        backdropFilter: 'blur(12px)', boxShadow: '0 20px 60px rgba(0,0,0,0.4)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🎯</div>
          <h1 style={{ color: '#fff', fontSize: '22px', fontWeight: '700', margin: '0 0 6px' }}>
            입시-Finder
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: '13px', margin: 0 }}>
            AI 입시 컨설팅 시스템
          </p>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <input
            type="password"
            placeholder="발급받은 코드를 입력하세요"
            value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            style={{
              width: '100%', padding: '14px 16px', borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.08)', color: '#fff',
              fontSize: '15px', outline: 'none', boxSizing: 'border-box'
            }}
          />
        </div>

        {error && (
          <p style={{ color: '#ff6b6b', fontSize: '13px', margin: '0 0 12px', textAlign: 'center' }}>
            {error}
          </p>
        )}

        <button
          onClick={handleSubmit}
          disabled={loading}
          style={{
            width: '100%', padding: '14px', borderRadius: '10px', border: 'none',
            background: loading ? '#555' : 'linear-gradient(135deg, #667eea, #764ba2)',
            color: '#fff', fontSize: '15px', fontWeight: '600',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? '확인 중...' : '입장하기'}
        </button>
      </div>
    </div>
  );
}