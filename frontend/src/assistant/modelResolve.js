// 🗣 말로 고른 모델 → 이 앱의 모델 키. "챗지피티 루나", "클로드 오퍼스", "제미나이 프로" 같은 말을 받는다.
// 너만의 패파가 "어느 모델로 할까요?" 하고 물은 뒤 답을 이걸로 푼다(2026-10-12, 패스파인더 Q·국뽀·뽀개기와 같은 규칙).
// options: [{ key, label }] — 이 앱 modelConfig 의 키·이름.

const COMPANY_WORDS = [
  ['gpt', /gpt|지피티|쥐피티|챗지피티|chatgpt|openai|오픈\s*ai|\bo3\b|\bo4|루나|luna|\bsol\b|솔|테라|terra/i],
  ['claude', /claude|클로드|anthropic|오퍼스|opus|소네트|소넷|sonnet|하이쿠|haiku/i],
  ['gemini', /gemini|제미나이|제미니|구글|google/i],
];
const ALIASES = [
  [/루나/g, 'luna'], [/솔/g, 'sol'], [/테라/g, 'terra'], [/오퍼스/g, 'opus'], [/소네트|소넷/g, 'sonnet'], [/하이쿠/g, 'haiku'],
  [/플래시/g, 'flash'], [/라이트/g, 'lite'], [/프로/g, 'pro'], [/미니/g, 'mini'],
];
export const COMPANY_LABEL = { claude: 'Claude', gpt: 'GPT', gemini: 'Gemini' };

export function companyOf(text) {
  for (const [c, re] of COMPANY_WORDS) if (re.test(text || '')) return c;
  return null;
}

/** 말 → { ok:true, option } | { ok:false, company, candidates, reason }. 버전 숫자를 안 말했으면 목록 앞쪽(기본) 것으로. */
export function resolveModelKey(text, options, companyOfKey) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, company: null, candidates: [], reason: '모델 이름이 비었습니다' };
  const exact = options.find((o) => o.key.toLowerCase() === raw.toLowerCase() || o.label.toLowerCase() === raw.toLowerCase());
  if (exact) return { ok: true, option: exact };
  let t = raw.toLowerCase();
  for (const [re, w] of ALIASES) t = t.replace(re, ` ${w} `);
  const company = companyOf(raw) || companyOf(t);
  const pool = company ? options.filter((o) => companyOfKey(o.key) === company) : [...options];
  const words = (t.match(/[a-z]+|\d+(?:\.\d+)?/g) || []).filter((w) => !/^(gpt|claude|gemini|chatgpt|openai|google)$/.test(w));
  if (!words.length) return { ok: false, company, candidates: pool, reason: company ? `${COMPANY_LABEL[company]} 모델 중 어떤 것으로 할까요?` : '어느 회사 모델인지 모르겠습니다' };
  const scored = pool.map((o) => {
    const hay = `${o.key} ${o.label}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (/^\d/.test(w)) { if (new RegExp(`(^|[^0-9.])${w.replace('.', '\\.')}([^0-9]|$)`).test(hay)) score += 2; }
      else if (new RegExp(`\\b${w}\\b`).test(hay)) score += 3;
      else if (hay.includes(w)) score += 1;
    }
    for (const tail of ['mini', 'lite', 'pro']) if (hay.includes(tail) && !words.includes(tail)) score -= 1;
    return { o, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { ok: false, company, candidates: pool, reason: `«${raw}» 모델을 찾지 못했습니다` };
  const top = scored.filter((x) => x.score === scored[0].score);
  if (top.length === 1 || !words.some((w) => /^\d/.test(w))) return { ok: true, option: top[0].o };
  return { ok: false, company, candidates: top.map((x) => x.o), reason: `«${raw}»에 맞는 모델이 여럿입니다` };
}

/** 이 앱 modelConfig({key:{label, group}}) 로 바로 푼다. */
export function resolveFromConfig(text, modelConfig) {
  const options = Object.entries(modelConfig).map(([key, v]) => ({ key, label: v.label }));
  return resolveModelKey(text, options, (k) => modelConfig[k]?.group || 'claude');
}
