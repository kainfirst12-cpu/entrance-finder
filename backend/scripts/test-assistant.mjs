// 조교(AI 선생님) 도구 루프 검증 — 진짜 API 키 없이 돈다.
//
// 왜 fetch 를 흉내 내나: 세 회사 SDK 가 결국 fetch 로 나가므로, 여기서 가로채면
// **실제로 보내는 요청 본문**을 그대로 볼 수 있다. 스키마가 틀리면 진짜 키로만 알 수 있는
// 400 오류(빈 tool_calls, 빈 parameters 등)를 키 없이 여기서 잡는다.
//
//   node backend/scripts/test-assistant.mjs
import assert from 'node:assert/strict';
import { runAssistantStep, normalizeUiTools, __test__ } from '../services/assistantAgent.js';

const { toClaudeMessages, toOpenAiMessages, toGeminiContents, toolsForProvider, orderResults } = __test__;

let pass = 0;
const ok = (label, fn) => { fn(); pass++; console.log('  ✓', label); };

// ── 브라우저가 보낸 화면 도구 정규화 ─────────────────
console.log('\n[화면 도구 정규화]');
ok('이상한 이름은 버린다', () => {
  const out = normalizeUiTools([
    { name: 'set_view', description: '화면 이동', schema: { type: 'object', properties: { view: { type: 'string' } } } },
    { name: '나쁜 이름', description: '한글 이름' },
    { name: 'search_ipgyeol', description: '서버 도구 이름 가로채기' },
    { name: 'no_args' },
  ]);
  assert.deepEqual(out.map((t) => t.function.name), ['set_view', 'no_args']);
});
ok('서버 도구 이름은 덮어쓸 수 없다', () => {
  assert.equal(normalizeUiTools([{ name: 'save_placement' }]).length, 0);
});
ok('인자 없는 도구도 properties 는 객체다', () => {
  const t = normalizeUiTools([{ name: 'no_args' }])[0];
  assert.deepEqual(t.function.parameters, { type: 'object', properties: {} });
});

// ── turns → 제공사별 메시지 ──────────────────────────
const TURNS = [
  { role: 'user', content: '중앙대 컴공 컷 보고 폼 채워줘' },
  { role: 'assistant', content: '찾아볼게요.', toolCalls: [{ id: 'c1', name: 'search_ipgyeol', input: { univKeywords: ['중앙대'] } }] },
  { role: 'toolResults', results: [{ id: 'c1', name: 'search_ipgyeol', result: { 전체매칭: 3, 반환: 3 } }] },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c2', name: 'fill_student_form', input: { targetUniv: '중앙대학교' } }] },
  { role: 'toolResults', results: [{ id: 'c2', name: 'fill_student_form', result: '목표 대학을 중앙대학교로 넣었습니다' }] },
];

console.log('\n[Claude 메시지]');
ok('tool_use 와 tool_result 가 짝을 이룬다', () => {
  const m = toClaudeMessages(TURNS);
  assert.equal(m[1].role, 'assistant');
  assert.equal(m[1].content[0].type, 'text');
  assert.equal(m[1].content[1].type, 'tool_use');
  assert.equal(m[1].content[1].id, 'c1');
  assert.equal(m[2].role, 'user');
  assert.equal(m[2].content[0].type, 'tool_result');
  assert.equal(m[2].content[0].tool_use_id, 'c1');
});
ok('본문 없는 도구 호출도 블록이 남는다', () => {
  const m = toClaudeMessages(TURNS);
  // 네 번째 칸: 본문이 비어 text 블록 없이 tool_use 만.
  assert.equal(m[3].content.length, 1);
  assert.equal(m[3].content[0].type, 'tool_use');
});

console.log('\n[GPT 메시지]');
ok('tool_calls 는 arguments 가 문자열이다', () => {
  const m = toOpenAiMessages(TURNS);
  const a = m.find((x) => x.role === 'assistant' && x.tool_calls);
  assert.equal(typeof a.tool_calls[0].function.arguments, 'string');
  assert.deepEqual(JSON.parse(a.tool_calls[0].function.arguments), { univKeywords: ['중앙대'] });
});
ok('도구 결과는 role:tool 한 줄씩', () => {
  const m = toOpenAiMessages(TURNS);
  const t = m.filter((x) => x.role === 'tool');
  assert.equal(t.length, 2);
  assert.equal(t[0].tool_call_id, 'c1');
});
ok('⚠ 빈 tool_calls 배열은 절대 넣지 않는다 (OpenAI 400)', () => {
  const m = toOpenAiMessages([
    { role: 'user', content: 'ㅎㅇ' },
    { role: 'assistant', content: '안녕하세요', toolCalls: [] },
  ]);
  assert.equal(m[1].tool_calls, undefined);
  assert.equal(m[1].content, '안녕하세요');
});
ok('본문도 도구도 없는 칸은 통째로 빠진다', () => {
  const m = toOpenAiMessages([{ role: 'user', content: 'ㅎㅇ' }, { role: 'assistant', content: '', toolCalls: [] }]);
  assert.equal(m.length, 1);
});

console.log('\n[Gemini 메시지]');
ok('functionCall / functionResponse 로 간다', () => {
  const c = toGeminiContents(TURNS);
  assert.equal(c[1].role, 'model');
  assert.equal(c[1].parts[1].functionCall.name, 'search_ipgyeol');
  assert.equal(c[2].role, 'user');
  assert.equal(c[2].parts[0].functionResponse.name, 'search_ipgyeol');
});
ok('문자열 결과는 객체로 감싼다 (Gemini 는 객체만 받는다)', () => {
  const c = toGeminiContents(TURNS);
  const last = c[c.length - 1].parts[0].functionResponse.response;
  assert.equal(typeof last, 'object');
  assert.equal(last.result, '목표 대학을 중앙대학교로 넣었습니다');
});

console.log('\n[Gemini 도구 선언]');
ok('⚠ 인자 없는 도구에는 parameters 를 아예 넣지 않는다', () => {
  const tools = normalizeUiTools([{ name: 'no_args', description: '인자 없음' }]);
  const decls = toolsForProvider('gemini', tools)[0].functionDeclarations;
  assert.equal('parameters' in decls[0], false);
});
ok('인자 있는 도구는 스키마가 붙는다', () => {
  const tools = normalizeUiTools([{ name: 'set_view', schema: { type: 'object', properties: { view: { type: 'string' } } } }]);
  const decls = toolsForProvider('gemini', tools)[0].functionDeclarations;
  assert.equal(decls[0].parameters.properties.view.type, 'string');
});
ok('Claude 는 input_schema 라는 이름을 쓴다', () => {
  const tools = normalizeUiTools([{ name: 'set_view', schema: { type: 'object', properties: {} } }]);
  assert.ok(toolsForProvider('claude', tools)[0].input_schema);
});

console.log('\n[결과 순서]');
ok('부른 순서대로 되돌려 준다', () => {
  const calls = [{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }];
  const out = orderResults(calls, [{ id: 'b', name: 'y', result: 2 }, { id: 'a', name: 'x', result: 1 }]);
  assert.deepEqual(out.map((r) => r.id), ['a', 'b']);
});
ok('빠진 결과는 오류로 채운다 — 짝이 안 맞으면 세 회사 모두 400 이다', () => {
  const out = orderResults([{ id: 'a', name: 'x' }], []);
  assert.equal(out.length, 1);
  assert.ok(out[0].result.오류);
});

// ── 실제 요청 본문 — fetch 를 가로채 확인 ─────────────
// 응답은 각 회사 규격대로 흉내 낸다. 여기서 통과하면 스키마 모양은 맞는 것이다.
const realFetch = globalThis.fetch;
let seen = null;
function mockFetch(reply) {
  globalThis.fetch = async (url, init = {}) => {
    seen = { url: String(url), body: init.body ? JSON.parse(init.body) : null };
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

console.log('\n[Claude — 실제 요청]');
mockFetch({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude',
  content: [{ type: 'text', text: '화면을 옮길게요.' }, { type: 'tool_use', id: 'tu1', name: 'set_view', input: { view: 'ipgyeol' } }],
  stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
});
{
  const out = await runAssistantStep({
    group: 'claude', modelId: 'claude-sonnet-5', apiKey: 'sk-ant-test',
    systemPrompt: '테스트', turns: [{ role: 'user', content: '입결 콘솔 열어줘' }],
    uiTools: [{ name: 'set_view', description: '화면 이동', schema: { type: 'object', properties: { view: { type: 'string' } }, required: ['view'] } }],
  });
  ok('상담 도구 3개 + 화면 도구가 함께 실린다', () => {
    const names = seen.body.tools.map((t) => t.name);
    assert.deepEqual(names, ['search_ipgyeol', 'search_knowledge', 'save_placement', 'set_view']);
  });
  ok('화면 도구를 부르면 거기서 멈추고 브라우저에 넘긴다', () => {
    assert.equal(out.done, false);
    assert.equal(out.toolCalls.length, 1);
    assert.equal(out.toolCalls[0].name, 'set_view');
    assert.deepEqual(out.toolCalls[0].input, { view: 'ipgyeol' });
    assert.equal(out.assistantTurn.role, 'assistant');
    assert.deepEqual(out.serverResults, []);
  });
}

console.log('\n[GPT — 실제 요청]');
mockFetch({
  id: 'chatcmpl-1', object: 'chat.completion', model: 'gpt-5',
  choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '다 됐습니다.' } }],
});
{
  const out = await runAssistantStep({
    group: 'gpt', modelId: 'gpt-5', apiKey: 'sk-test',
    systemPrompt: '테스트',
    turns: [
      { role: 'user', content: '고마워' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'x1', name: 'set_view', input: { view: 'form' } }] },
      { role: 'toolResults', results: [{ id: 'x1', name: 'set_view', result: '분석 화면으로 옮겼습니다' }] },
    ],
    uiTools: [{ name: 'set_view', schema: { type: 'object', properties: { view: { type: 'string' } } } }],
  });
  ok('system 이 맨 앞에 한 번만 들어간다', () => {
    assert.equal(seen.body.messages[0].role, 'system');
    assert.equal(seen.body.messages.filter((m) => m.role === 'system').length, 1);
  });
  ok('도구가 없으면 done', () => {
    assert.equal(out.done, true);
    assert.equal(out.text, '다 됐습니다.');
  });
}

console.log('\n[Gemini — 실제 요청]');
mockFetch({
  candidates: [{
    content: { role: 'model', parts: [{ functionCall: { name: 'set_model', args: { model: 'gemini-pro' } } }] },
    finishReason: 'STOP', index: 0,
  }],
});
{
  const out = await runAssistantStep({
    group: 'gemini', modelId: 'gemini-3.7-flash', apiKey: 'AIzaTest',
    systemPrompt: '테스트', turns: [{ role: 'user', content: '모델 바꿔줘' }],
    uiTools: [{ name: 'set_model', schema: { type: 'object', properties: { model: { type: 'string' } } } }],
  });
  ok('systemInstruction 으로 나간다', () => {
    assert.ok(seen.body.systemInstruction);
  });
  ok('화면 도구 호출에 id 를 붙여 돌려준다 (Gemini 는 id 를 안 준다)', () => {
    assert.equal(out.done, false);
    assert.equal(out.toolCalls[0].name, 'set_model');
    assert.ok(out.toolCalls[0].id, 'id 가 있어야 결과와 짝을 맞춘다');
  });
}

console.log('\n[서버 도구는 한 요청 안에서 스스로 돈다]');
{
  // 1) 서버 도구 호출 → 2) 마무리. 브라우저는 한 번만 왕복해야 한다.
  let call = 0;
  globalThis.fetch = async (url, init = {}) => {
    call++;
    const body = call === 1
      ? {
        id: 'm1', type: 'message', role: 'assistant', model: 'claude', stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 's1', name: 'search_knowledge', input: { query: '중앙대 전형' } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }
      : {
        id: 'm2', type: 'message', role: 'assistant', model: 'claude', stop_reason: 'end_turn',
        content: [{ type: 'text', text: '자료에 없습니다.' }], usage: { input_tokens: 1, output_tokens: 1 },
      };
    seen = { url: String(url), body: init.body ? JSON.parse(init.body) : null };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const out = await runAssistantStep({
    group: 'claude', modelId: 'claude-sonnet-5', apiKey: 'sk-ant-test',
    systemPrompt: '테스트', turns: [{ role: 'user', content: '중앙대 전형 알려줘' }], uiTools: [],
  });
  ok('모델을 두 번 부르고 브라우저에는 한 번만 돌아온다', () => {
    assert.equal(call, 2);
    assert.equal(out.done, true);
  });
  ok('서버 도구 실행 기록이 남는다', () => {
    assert.equal(out.toolLog.length, 1);
    assert.equal(out.toolLog[0].name, 'search_knowledge');
  });
  ok('두 번째 요청에 tool_result 가 실려 간다', () => {
    const last = seen.body.messages[seen.body.messages.length - 1];
    assert.equal(last.role, 'user');
    assert.equal(last.content[0].type, 'tool_result');
    assert.equal(last.content[0].tool_use_id, 's1');
  });
}

globalThis.fetch = realFetch;
console.log(`\n통과 ${pass}개\n`);
