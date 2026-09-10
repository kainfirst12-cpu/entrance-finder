// services/assistantAgent.js — 떠 있는 조교(AI 선생님)가 쓰는 한 걸음짜리 도구 루프.
//
// consultAgent.runAgentLoop 과 무엇이 다른가
//   저쪽은 도구가 전부 서버 안(입결·지식베이스·배치 저장)에 있어서 한 요청 안에서 끝까지 돈다.
//   여기는 **화면을 조작하는 도구**가 섞인다 — 그건 브라우저에만 있으므로 서버가 실행할 수 없다.
//   그래서 이 함수는 '화면 도구를 부를 차례'가 오면 거기서 멈추고 브라우저에 넘긴다.
//   서버 도구만 부르는 동안은 여기서 계속 돌기 때문에, 입결을 세 번 뒤지는 상담이라도
//   왕복은 한 번이다(브라우저가 서버 도구를 대신 부를 방법도 없다 — 인증과 DB가 서버에 있다).
//
// 대화 상태(turns)는 **브라우저가 들고 있고 매 요청 통째로 보낸다**. 제공사별 메시지 모양은
// 여기서 그때그때 만든다 — 서버에 세션을 두면 탭을 두 개 열었을 때 서로를 덮어쓴다.
import {
  CONSULT_TOOLS, CONSULT_TOOL_NAMES, runConsultTool, toGeminiSchema,
} from './consultAgent.js';

// 화면 도구까지 합쳐도 한 요청 안에서 서버 도구만으로 도는 횟수 상한.
const MAX_SERVER_HOPS = 6;
// 브라우저가 보낸 도구 선언을 그대로 믿지 않는다 — 개수와 이름을 여기서 자른다.
const MAX_UI_TOOLS = 40;
const TOOL_RESULT_CAP = 60000;

/**
 * turns 한 칸의 모양(브라우저와 맞춘 약속):
 *   { role: 'user',        content: '...' }
 *   { role: 'assistant',   content: '...', toolCalls: [{ id, name, input }] }
 *   { role: 'toolResults', results:  [{ id, name, result }] }
 * result 는 문자열이거나 객체다(서버 도구는 객체, 화면 도구는 대개 문자열).
 */

function safeJson(v) {
  try { return JSON.stringify(v ?? null).slice(0, TOOL_RESULT_CAP); }
  catch { return String(v).slice(0, TOOL_RESULT_CAP); }
}

// Gemini 의 functionResponse.response 는 객체여야 한다 — 문자열이면 감싼다.
function asObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : { result: v ?? null };
}

// 도구 결과는 부른 순서대로 돌려준다. 순서가 어긋나도 세 제공사 모두 id·이름으로 짝을 찾지만,
// 로그를 눈으로 볼 때 헷갈리므로 여기서 맞춰 둔다.
function orderResults(calls, results) {
  const byId = new Map(results.map((r) => [r.id, r]));
  const used = new Set();
  const out = [];
  for (const c of calls) {
    const hit = byId.get(c.id);
    if (hit) { out.push(hit); used.add(c.id); }
    else out.push({ id: c.id, name: c.name, result: { 오류: '결과가 오지 않았다' } });
  }
  for (const r of results) if (!used.has(r.id)) out.push(r);
  return out;
}

// ── 브라우저가 선언한 화면 도구를 OpenAI 형태로 정규화 ──
export function normalizeUiTools(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const t of raw.slice(0, MAX_UI_TOOLS)) {
    const name = String(t?.name || '').trim();
    // 서버 도구와 이름이 겹치면 어느 쪽을 부른 건지 갈라낼 수 없다 — 화면 쪽을 버린다.
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || CONSULT_TOOL_NAMES.includes(name)) continue;
    const schema = t?.schema && typeof t.schema === 'object' ? t.schema : { type: 'object', properties: {} };
    out.push({
      type: 'function',
      function: {
        name,
        description: String(t?.description || '').slice(0, 1200),
        parameters: { type: 'object', properties: {}, ...schema },
      },
    });
  }
  return out;
}

function toolsForProvider(group, tools) {
  const defs = tools.map((t) => t.function);
  if (group === 'gemini') {
    return [{
      functionDeclarations: defs.map((d) => {
        const decl = { name: d.name, description: d.description };
        // ⚠ 인자가 없는 도구에 parameters:{type:'object',properties:{}} 를 주면 Gemini 가 거절한다.
        //   화면 도구 절반이 인자가 없으므로(생성 시작·미리보기 등) 이 줄이 없으면 Gemini 키가 통째로 죽는다.
        if (Object.keys(d.parameters?.properties || {}).length > 0) {
          decl.parameters = toGeminiSchema(d.parameters);
        }
        return decl;
      }),
    }];
  }
  if (group === 'claude') {
    return defs.map((d) => ({ name: d.name, description: d.description, input_schema: d.parameters }));
  }
  return tools;
}

// ── turns → 제공사별 메시지 ───────────────────────────
function toClaudeMessages(turns) {
  const out = [];
  for (const t of turns) {
    if (t.role === 'user') { out.push({ role: 'user', content: String(t.content || '') }); continue; }
    if (t.role === 'assistant') {
      const blocks = [];
      if (String(t.content || '').trim()) blocks.push({ type: 'text', text: t.content });
      for (const c of t.toolCalls || []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input || {} });
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
      continue;
    }
    if (t.role === 'toolResults') {
      const blocks = (t.results || []).map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: safeJson(r.result) }));
      if (blocks.length) out.push({ role: 'user', content: blocks });
    }
  }
  return out;
}

function toOpenAiMessages(turns) {
  const out = [];
  for (const t of turns) {
    if (t.role === 'user') { out.push({ role: 'user', content: String(t.content || '') }); continue; }
    if (t.role === 'assistant') {
      const calls = t.toolCalls || [];
      // ⚠ tool_calls 는 비어 있으면 넣지 않는다 — 빈 배열을 보내면 OpenAI 가 400 으로 튕긴다.
      if (calls.length === 0) {
        if (String(t.content || '').trim()) out.push({ role: 'assistant', content: t.content });
        continue;
      }
      out.push({
        role: 'assistant',
        content: String(t.content || '') || null,
        tool_calls: calls.map((c) => ({
          id: c.id, type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
        })),
      });
      continue;
    }
    if (t.role === 'toolResults') {
      for (const r of t.results || []) out.push({ role: 'tool', tool_call_id: r.id, content: safeJson(r.result) });
    }
  }
  return out;
}

function toGeminiContents(turns) {
  const out = [];
  for (const t of turns) {
    if (t.role === 'user') { out.push({ role: 'user', parts: [{ text: String(t.content || '') }] }); continue; }
    if (t.role === 'assistant') {
      const parts = [];
      if (String(t.content || '').trim()) parts.push({ text: t.content });
      for (const c of t.toolCalls || []) parts.push({ functionCall: { name: c.name, args: c.input || {} } });
      if (parts.length) out.push({ role: 'model', parts });
      continue;
    }
    if (t.role === 'toolResults') {
      const parts = (t.results || []).map((r) => ({ functionResponse: { name: r.name, response: asObject(r.result) } }));
      if (parts.length) out.push({ role: 'user', parts });
    }
  }
  return out;
}

// ── 제공사별 '한 번 물어보기' ─────────────────────────
// 반환: { text, calls: [{ id, name, input }] }
let uid = 0;
const newId = (name) => `${name}_${Date.now().toString(36)}_${(uid++).toString(36)}`;

async function askClaude({ modelId, apiKey, systemPrompt, turns, tools }) {
  const AnthropicSDK = (await import('@anthropic-ai/sdk')).default;
  const client = new AnthropicSDK({ apiKey });
  const r = await client.messages.create({
    model: modelId, max_tokens: 8000, system: systemPrompt,
    tools: toolsForProvider('claude', tools), messages: toClaudeMessages(turns),
  });
  const blocks = r.content || [];
  return {
    text: blocks.filter((c) => c.type === 'text').map((c) => c.text).join(''),
    calls: blocks.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, input: c.input || {} })),
  };
}

async function askGpt({ modelId, apiKey, systemPrompt, turns, tools }) {
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });
  const r = await openai.chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: systemPrompt }, ...toOpenAiMessages(turns)],
    tools, max_completion_tokens: 8000,
  });
  const m = r.choices[0].message;
  return {
    text: m.content || '',
    calls: (m.tool_calls || []).map((tc) => {
      let input = {};
      try { input = JSON.parse(tc.function.arguments || '{}'); } catch { /* 인자가 깨지면 빈 객체로 부른다 */ }
      return { id: tc.id, name: tc.function.name, input };
    }),
  };
}

async function askGemini({ modelId, apiKey, systemPrompt, turns, tools }) {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction: systemPrompt,
    tools: toolsForProvider('gemini', tools),
    // pro 계열은 사고 토큰이 출력 한도를 먼저 먹는다 — 여유를 얹지 않으면 본문이 빈 문자열로 온다.
    generationConfig: { maxOutputTokens: /pro/i.test(modelId) ? 16000 : 8000 },
  });
  const r = await model.generateContent({ contents: toGeminiContents(turns) });
  const calls = (r.response.functionCalls?.() || []).map((c) => ({ id: newId(c.name), name: c.name, input: c.args || {} }));
  // 도구를 부르는 응답에서 text() 를 읽으면 SDK 가 던지는 판이 있다 — 본문은 없어도 되므로 삼킨다.
  let text = '';
  try { text = r.response.text() || ''; } catch { text = ''; }
  return { text, calls };
}

const ASK = { claude: askClaude, gpt: askGpt, gemini: askGemini };

/**
 * 한 요청 = 모델에게 물어보고, 서버 도구는 여기서 실행하고, 화면 도구가 나오면 멈춘다.
 *
 * @returns {{
 *   text: string,
 *   done: boolean,
 *   toolCalls: Array,        // 브라우저가 실행할 화면 도구 (done 이면 빈 배열)
 *   assistantTurn: object|null, // 브라우저가 turns 에 그대로 이어 붙일 칸
 *   serverResults: Array,    // 서버가 이미 실행해 둔 결과 — 브라우저가 화면 도구 결과와 합쳐 보낸다
 *   toolLog: Array,          // 화면에 보여줄 '무엇을 했는지'
 *   truncated: boolean,
 * }}
 */
export async function runAssistantStep({ group, modelId, apiKey, systemPrompt, turns = [], uiTools = [], ctx = {} }) {
  const ask = ASK[group] || askClaude;
  const tools = [...CONSULT_TOOLS, ...normalizeUiTools(uiTools)];
  const toolLog = [];
  // 서버 도구를 여러 번 도는 동안 늘어나는 대화. 브라우저가 보낸 turns 는 건드리지 않는다.
  const work = [...turns];

  for (let hop = 0; hop < MAX_SERVER_HOPS; hop++) {
    const { text, calls } = await ask({ modelId, apiKey, systemPrompt, turns: work, tools });
    if (!calls.length) {
      return { text, done: true, toolCalls: [], assistantTurn: null, serverResults: [], toolLog, truncated: false };
    }

    const assistantTurn = { role: 'assistant', content: text, toolCalls: calls };
    const serverCalls = calls.filter((c) => CONSULT_TOOL_NAMES.includes(c.name));
    const uiCalls = calls.filter((c) => !CONSULT_TOOL_NAMES.includes(c.name));

    const serverResults = [];
    for (const c of serverCalls) {
      let out;
      try { out = await runConsultTool(c.name, c.input || {}, ctx); }
      catch (e) { out = { 오류: e.message }; }
      serverResults.push({ id: c.id, name: c.name, result: out });
      toolLog.push({ name: c.name, args: c.input || {}, summary: summarizeServer(out) });
    }

    // 화면 도구가 하나라도 있으면 여기서 멈춘다 — 그건 브라우저만 실행할 수 있다.
    if (uiCalls.length) {
      return { text, done: false, toolCalls: uiCalls, assistantTurn, serverResults, toolLog, truncated: false };
    }

    work.push(assistantTurn, { role: 'toolResults', results: orderResults(calls, serverResults) });
  }

  return {
    text: '자료 조회가 상한에 도달했습니다. 질문을 좁혀 다시 물어봐 주세요.',
    done: true, toolCalls: [], assistantTurn: null, serverResults: [], toolLog, truncated: true,
  };
}

function summarizeServer(out) {
  if (out?.전체매칭 != null) return `${out.전체매칭}건 매칭 · ${out.반환}건 확인`;
  if (out?.자료) return `자료 ${out.자료.length}건`;
  if (out?.저장됨) return `저장 — ${out.내용}`;
  return out?.오류 || '완료';
}

export const __test__ = { toClaudeMessages, toOpenAiMessages, toGeminiContents, toolsForProvider, orderResults };
