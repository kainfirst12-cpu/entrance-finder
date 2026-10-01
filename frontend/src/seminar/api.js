// 설명회 화면 공용 — 서버 호출(401 만 로그아웃, 403 은 메시지), SSE(keepalive) 결과 받기
import { API_BASE } from '../apiBase';

export const token = () => localStorage.getItem('ef_token');
export async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method || 'GET',
    headers: { Authorization: `Bearer ${token()}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  // 401 만 로그아웃, 403 은 서버 메시지만(메뉴 잠금)
  if (res.status === 401 || res.status === 403) { let m = res.status === 401 ? '로그인이 필요합니다' : '이 학원 코드에는 열려 있지 않은 기능입니다'; try { m = (await res.json()).message || m; } catch { /* 본문 없음 */ } const e = new Error(m); e.auth = res.status === 401; throw e; }
  return res.json();
}
export async function postSSE(url, opts, onEvent) {
  const res = await fetch(url, opts);
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/event-stream')) { try { return await res.json(); } catch { return { success: false, message: `서버 응답 오류 (HTTP ${res.status})` }; } }
  const reader = res.body.getReader(); const dec = new TextDecoder();
  let buf = '', result = null;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const l of lines) if (l.startsWith('data: ')) { try { result = JSON.parse(l.slice(6)); onEvent?.(result); } catch { /* 조각 */ } }
  }
  return result || { success: false, message: '서버 응답이 비었습니다 (연결 끊김)' };
}
