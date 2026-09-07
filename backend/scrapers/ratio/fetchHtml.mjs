// 경쟁률 페이지 한 장을 글자로 받아 온다.
//
// 두 대행사가 인코딩이 다르다 — 진학은 UTF-8, 유웨이는 **euc-kr** 이다.
// 그냥 res.text() 로 읽으면 유웨이 쪽 대학명·모집단위가 통째로 깨진다.
// 그래서 바이트로 받아서 charset 을 보고 직접 디코딩한다.
import iconv from 'iconv-lite';

// 헤더 값은 ASCII 만 담을 수 있다 — 한글을 넣으면 fetch 가 ByteString 오류로 죽는다.
const UA = 'Mozilla/5.0 (compatible; entrance-finder/1.0; academy counseling)';

export async function fetchHtml(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());

    // charset 은 헤더가 1순위, 없으면 meta 태그(그때는 ASCII 로 훑어도 안전하다)
    const header = res.headers.get('content-type') || '';
    let charset = (header.match(/charset=([\w-]+)/i) || [])[1];
    if (!charset) {
      const head = buf.subarray(0, 2048).toString('latin1');
      charset = (head.match(/charset=["']?([\w-]+)/i) || [])[1];
    }
    charset = (charset || 'utf-8').toLowerCase();
    const html = /euc-kr|ks_c_5601|cp949/.test(charset)
      ? iconv.decode(buf, 'euc-kr')
      : buf.toString('utf8');
    return { html, charset, finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}
