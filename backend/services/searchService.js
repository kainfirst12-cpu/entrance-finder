// services/searchService.js — 웹 검색으로 합격 사례 보완
const SEARCH_TIMEOUT = 8000;

// 검색 쿼리 생성
function buildQueries(major, targetUniv) {
  const queries = [];
  if (targetUniv && major) {
    queries.push(`${targetUniv} ${major} 합격 사례 내신 등급`);
    queries.push(`${targetUniv} ${major} 학생부종합전형 합격`);
  }
  if (major) {
    queries.push(`${major} 대학 합격 사례 내신 세특`);
    queries.push(`${major} 수시 합격 스펙 2025 2026`);
  }
  return queries;
}

// DuckDuckGo HTML 검색 (API 키 불필요)
async function searchDDG(query) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; entrance-finder/1.0)' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const html = await res.text();

    // 검색 결과 파싱 (제목 + 스니펫)
    const results = [];
    const snippetRegex = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const titleRegex = /class="result__a"[^>]*>([\s\S]*?)<\/a>/g;

    const titles = [];
    let m;
    while ((m = titleRegex.exec(html)) !== null) {
      titles.push(m[1].replace(/<[^>]*>/g, '').trim());
    }
    const snippets = [];
    while ((m = snippetRegex.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]*>/g, '').trim());
    }

    for (let i = 0; i < Math.min(titles.length, 3); i++) {
      if (titles[i] && snippets[i]) {
        results.push({ title: titles[i], snippet: snippets[i] });
      }
    }

    return results;
  } catch (e) {
    console.warn(`[Search] DDG 검색 실패 (${query}):`, e.message);
    return [];
  }
}

// 합격 사례 웹 검색
export async function searchAdmissionCases(major, targetUniv) {
  console.log(`[Search] 웹 검색 시작: ${major} / ${targetUniv}`);
  const queries = buildQueries(major, targetUniv);
  const allResults = [];

  // 쿼리 2개만 병렬 실행 (속도 위해)
  const searchPromises = queries.slice(0, 2).map(q => searchDDG(q));
  const results = await Promise.all(searchPromises);

  for (const r of results) {
    allResults.push(...r);
  }

  // 중복 제거
  const seen = new Set();
  const unique = allResults.filter(r => {
    const key = r.title.slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) {
    console.log('[Search] 검색 결과 없음');
    return '';
  }

  // 텍스트로 변환
  let text = `\n=== 웹 검색 보완 자료 (${major} / ${targetUniv}) ===\n`;
  text += `[참고: 아래는 웹 검색으로 수집한 참고 자료입니다. 정확도를 검증하고 활용하십시오.]\n\n`;
  unique.slice(0, 5).forEach((r, i) => {
    text += `[검색${i + 1}] ${r.title}\n${r.snippet}\n\n`;
  });

  console.log(`[Search] ${unique.length}건 검색 완료 (${text.length}자)`);
  return text;
}
