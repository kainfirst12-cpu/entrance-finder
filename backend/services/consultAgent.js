// services/consultAgent.js — 상담 에이전트가 쓰는 도구 정의와 실행
//
// 설계 원칙: AI 는 "무엇을 찾을지"만 정하고, 숫자는 전부 코드가 원본에서 꺼낸다.
//   입결 7만 건(27MB)은 프롬프트에 넣을 수 없고, 넣더라도 모델이 숫자를 지어낼 여지가 생긴다.
//   그래서 학생 자료(유한)는 프롬프트에 직접 넣고, 입결·지식베이스는 도구로만 닿게 한다.
import { searchEntries } from './ipgyeolSearch.js';
import { embedQuery, searchByType, kbReady } from './vectorStore.js';
import { addPlacement } from './boardStore.js';

// OpenAI tools 스키마
export const CONSULT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_ipgyeol',
      description:
        '대학어디가 공식 입시결과(전국 216개 대학 × 학과 × 전형 약 7만 건, 2021~2026)를 조건으로 검색한다. '
        + '특정 대학·학과의 70%컷·경쟁률·충원·모집인원을 확인하거나, 조건에 맞는 후보를 찾을 때 쓴다. '
        + '답변에 인용하는 입결 숫자는 반드시 이 도구의 결과여야 한다. 기억이나 추정으로 숫자를 쓰지 마라.',
      parameters: {
        type: 'object',
        properties: {
          regions: { type: 'array', items: { type: 'string' }, description: '지역명. 서울/경기/인천/강원/대전/세종/충남/충북/광주/전남/전북/대구/경북/부산/울산/경남/제주' },
          capitalOnly: { type: 'boolean', description: '수도권(서울·경기·인천)만' },
          univKeywords: { type: 'array', items: { type: 'string' }, description: '대학명 포함 키워드. 예: ["중앙대","숭실대"]' },
          deptKeywords: { type: 'array', items: { type: 'string' }, description: '학과명 포함 키워드(OR). 계열이면 대표 학과명을 여러 개 펼쳐라' },
          excludeKeywords: { type: 'array', items: { type: 'string' } },
          tracks: { type: 'array', items: { type: 'string' }, description: '교과/종합/논술/실기' },
          typeKeywords: { type: 'array', items: { type: 'string' }, description: '전형명 키워드. 대학·학과와 함께 쓰면 결과가 0건이 되기 쉬우니 신중히' },
          gradeMin: { type: 'number', description: '70%컷 하한' },
          gradeMax: { type: 'number', description: '70%컷 상한' },
          targetGrade: { type: 'number', description: '학생 내신. 주면 안정/적정/소신/위험 판정이 붙는다' },
          verdicts: { type: 'array', items: { type: 'string' }, description: '안정/적정/소신/위험 중 원하는 것' },
          rateMin: { type: 'number' }, rateMax: { type: 'number' },
          recruitMin: { type: 'number', description: '모집인원 하한' },
          trend: { type: 'string', enum: ['easing', 'tightening'], description: 'easing=컷 완화, tightening=컷 상승' },
          sunung: { type: 'string', enum: ['none', 'required'], description: '수능최저 없는/있는 전형' },
          sortBy: { type: 'string', enum: ['fit', 'cut', 'easy', 'rate', 'recruit', 'trend'] },
          limit: { type: 'number', description: '최대 30' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description:
        '입시 지식베이스(대입정책·대학별전형 방법·합격자 사례)를 의미 검색한다. '
        + '전형방법, 반영교과, 수능최저 기준, 서류평가 방식처럼 입결 숫자로는 알 수 없는 것을 물을 때 쓴다.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '검색할 내용을 한 문장으로' },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['대입정책', '대학별전형', '합격자사례'] },
            description: '생략하면 세 종류 모두 검색',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_placement',
      description:
        '검토를 마친 지원 후보를 이 학생의 배치 기록으로 저장한다. '
        + '학생이 선택되어 있을 때만 쓸 수 있다. 사용자가 저장을 요청했거나 명확히 동의했을 때만 호출하라. '
        + '추천만 한 단계에서 미리 저장하지 마라.',
      parameters: {
        type: 'object',
        properties: {
          unvCd: { type: 'string', description: 'search_ipgyeol 결과의 unvCd 를 그대로' },
          univName: { type: 'string' },
          region: { type: 'string' },
          dept: { type: 'string' },
          track: { type: 'string', description: '교과/종합/논술/실기' },
          typeName: { type: 'string' },
          baseYear: { type: 'string' },
          grade: { type: 'number', description: '판정 기준으로 삼은 학생 내신' },
          verdict: { type: 'string', description: '안정/적정/소신/위험' },
          cut70: { type: 'number' }, cutYear: { type: 'string' },
          rate: { type: 'number' }, recruit: { type: 'number' }, fill: { type: 'number' },
          memo: { type: 'string', description: '저장 이유 한 줄' },
        },
        required: ['univName', 'dept', 'track'],
      },
    },
  },
];

// ── 제공사별 도구 규격 변환 ───────────────────────────
// 도구 정의는 위 CONSULT_TOOLS(OpenAI 형태) 하나만 두고, 나머지는 거기서 파생시킨다.
// 세 벌을 따로 관리하면 도구를 하나 고칠 때마다 어긋난다.

// Gemini 는 JSON Schema 전체가 아니라 OpenAPI 부분집합만 받는다.
// 모르는 키가 섞이면 400 이 나므로 허용된 키만 남긴다.
function toGeminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  if (s.type) out.type = s.type;
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(s.properties)) out.properties[k] = toGeminiSchema(v);
  }
  if (Array.isArray(s.required) && s.required.length) out.required = s.required;
  return out;
}

export function toolsForProvider(group) {
  const defs = CONSULT_TOOLS.map((t) => t.function);
  if (group === 'gemini') {
    return [{ functionDeclarations: defs.map((d) => ({ name: d.name, description: d.description, parameters: toGeminiSchema(d.parameters) })) }];
  }
  if (group === 'claude') {
    return defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters }));
  }
  return CONSULT_TOOLS;
}

/**
 * 전형 자료(지식베이스) 의미 검색 — 도구와 입결 콘솔 요약이 함께 쓴다.
 * 신설 전형처럼 입결이 아예 없는 건은 여기에만 단서가 있다.
 */
export async function lookupAdmissionGuide(query, types) {
  if (!kbReady()) return [];
  const kinds = types?.length ? types : ['대학별전형', '대입정책', '합격자사례'];
  const emb = await embedQuery(String(query || '').slice(0, 500));
  const found = await Promise.all(kinds.map((t) => searchByType(emb, t, 4)));
  const blocks = [];
  kinds.forEach((t, i) => {
    for (const h of found[i] || []) {
      blocks.push({
        종류: t,
        제목: h.title || h.metadata?.filename || '',
        관련도: Math.round((h.score || 0) * 100),
        내용: String(h.content || '').slice(0, 1200),
      });
    }
  });
  return blocks;
}

// 결과를 프롬프트에 도로 넣어야 하므로 토큰을 아껴 압축한다.
function compactHit(r) {
  return {
    unvCd: r.univ.unvCd,
    대학: r.univ.name.replace(/\[.*\]$/, ''),
    지역: r.univ.region,
    학과: r.entry.dept,
    전형구분: r.entry.track,
    전형명: r.entry.typeName,
    컷70: r.match.cut70,
    기준연도: r.match.cutYear,
    전년대비: r.match.delta,
    경쟁률: r.match.rate,
    충원: r.match.fill,
    모집: r.match.recruit,
    판정: r.match.verdict,
    수능최저: r.sunung?.text ? r.sunung.text.slice(0, 120) : null,
  };
}

/**
 * 도구 하나를 실행한다.
 * ctx: { studentId, baseYear, defaultGrade, onSaved }
 * 반환값은 그대로 모델에 돌려줄 JSON 이다.
 */
export async function runConsultTool(name, args = {}, ctx = {}) {
  if (name === 'search_ipgyeol') {
    const filter = { ...args, baseYear: args.baseYear || ctx.baseYear || '2026' };
    filter.limit = Math.min(Number(filter.limit) || 20, 30);
    if (filter.targetGrade == null && ctx.defaultGrade != null) filter.targetGrade = ctx.defaultGrade;
    const { total, results } = searchEntries(filter);
    return {
      전체매칭: total,
      반환: results.length,
      결과: results.map(compactHit),
      비고: total === 0
        ? '조건에 맞는 전형이 0건이다. 대학·학과·전형명을 동시에 좁히면 0건이 되기 쉬우니 조건을 하나씩 빼고 다시 불러라. 신설 전형은 입결 자료 자체가 없다.'
        : undefined,
    };
  }

  if (name === 'search_knowledge') {
    if (!kbReady()) return { 오류: '지식베이스가 비어 있다. 이 도구로는 답할 수 없으니 입결 자료나 학생 기록으로 답하라.' };
    const blocks = await lookupAdmissionGuide(args.query, args.types);
    return blocks.length ? { 자료: blocks } : { 자료: [], 비고: '관련 자료를 찾지 못했다.' };
  }

  if (name === 'save_placement') {
    if (!ctx.studentId) return { 오류: '학생이 선택되지 않아 저장할 수 없다. 사용자에게 학생을 먼저 고르라고 안내하라.' };
    const snapshot = {};
    for (const k of ['cut70', 'cutYear', 'rate', 'recruit', 'fill']) if (args[k] != null) snapshot[k] = args[k];
    const saved = await addPlacement(ctx.studentId, {
      unvCd: args.unvCd, univName: args.univName, region: args.region,
      dept: args.dept, track: args.track, typeName: args.typeName,
      baseYear: args.baseYear || ctx.baseYear || '2026',
      grade: args.grade != null ? args.grade : ctx.defaultGrade,
      verdict: args.verdict, snapshot, memo: args.memo || '',
    });
    ctx.onSaved?.(saved);
    return { 저장됨: true, id: saved.id, 내용: `${args.univName} ${args.dept} ${args.track}(${args.typeName || '-'})` };
  }

  return { 오류: `알 수 없는 도구: ${name}` };
}

// ── 도구 호출 루프 (claude / gpt / gemini) ─────────────
// 세 제공사의 규격이 전부 달라 루프도 따로다. 공통으로 뽑아내면 오히려 읽기 어렵다.
//   · OpenAI  : message.tool_calls → role:'tool' 메시지로 결과 회신
//   · Anthropic: content[].tool_use → user 메시지 안 tool_result 블록으로 회신
//   · Gemini  : response.functionCalls() → functionResponse 파트로 회신

const MAX_TURNS = 8;   // 도구 호출이 끝없이 이어지는 것을 막는 상한

function summarize(out) {
  if (out?.전체매칭 != null) return `${out.전체매칭}건 매칭 · ${out.반환}건 확인`;
  if (out?.자료) return `자료 ${out.자료.length}건`;
  if (out?.저장됨) return `저장 — ${out.내용}`;
  return out?.오류 || '완료';
}

/**
 * @returns {{ reply: string, toolLog: Array, truncated: boolean }}
 */
export async function runAgentLoop({ group, modelId, apiKey, systemPrompt, history = [], message, ctx = {} }) {
  const toolLog = [];
  const call = async (name, args) => {
    let out;
    try { out = await runConsultTool(name, args, ctx); }
    catch (e) { out = { 오류: e.message }; }
    toolLog.push({ name, args, summary: summarize(out) });
    return out;
  };
  const hist = history.slice(-10).filter((h) => h && h.role && h.content);

  // ── OpenAI ──
  if (group === 'gpt') {
    const OpenAI = (await import('openai')).default;
    const openai = new OpenAI({ apiKey });
    const msgs = [
      { role: 'system', content: systemPrompt },
      ...hist.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 6000) })),
      { role: 'user', content: String(message).slice(0, 8000) },
    ];
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const r = await openai.chat.completions.create({
        model: modelId, messages: msgs, tools: toolsForProvider('gpt'), max_completion_tokens: 8000,
      });
      const m = r.choices[0].message;
      msgs.push(m);
      if (!m.tool_calls?.length) return { reply: m.content || '', toolLog, truncated: false };
      for (const tc of m.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        const out = await call(tc.function.name, args);
        msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out).slice(0, 60000) });
      }
    }
    return { reply: '', toolLog, truncated: true };
  }

  // ── Anthropic ──
  if (group === 'claude') {
    const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
    const client = new AnthropicSDK({ apiKey });
    const msgs = [
      ...hist.map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content).slice(0, 6000) })),
      { role: 'user', content: String(message).slice(0, 8000) },
    ];
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const r = await client.messages.create({
        model: modelId, max_tokens: 8000, system: systemPrompt,
        tools: toolsForProvider('claude'), messages: msgs,
      });
      const uses = (r.content || []).filter((c) => c.type === 'tool_use');
      if (!uses.length) {
        return { reply: (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''), toolLog, truncated: false };
      }
      msgs.push({ role: 'assistant', content: r.content });
      const results = [];
      for (const u of uses) {
        const out = await call(u.name, u.input || {});
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 60000) });
      }
      msgs.push({ role: 'user', content: results });
    }
    return { reply: '', toolLog, truncated: true };
  }

  // ── Gemini ──
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: systemPrompt,
    tools: toolsForProvider('gemini'),
    // pro 계열은 사고 토큰이 출력 한도를 먼저 먹는다(GPT pro와 같은 증상). 여유를 얹는다.
    generationConfig: { maxOutputTokens: /pro/i.test(modelId) ? 16000 : 8000 },
  });
  const chat = model.startChat({
    history: hist.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(h.content).slice(0, 6000) }] })),
  });
  let res = await chat.sendMessage(String(message).slice(0, 8000));
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const calls = res.response.functionCalls?.() || [];
    if (!calls.length) return { reply: res.response.text() || '', toolLog, truncated: false };
    const parts = [];
    for (const c of calls) {
      const out = await call(c.name, c.args || {});
      parts.push({ functionResponse: { name: c.name, response: out } });
    }
    res = await chat.sendMessage(parts);
  }
  return { reply: '', toolLog, truncated: true };
}
