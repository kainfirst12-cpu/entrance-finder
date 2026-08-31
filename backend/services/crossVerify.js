/**
 * 교차 검증 — 이미 만들어진 글을 **다른 모델들에게 검토받는다**.
 *
 * 왜 필요한가
 *   이 앱이 내놓는 글(입결 판정·생기부 분석·상담 브리핑·로드맵)은 학생과 학부모의 지원 결정을
 *   바꾼다. 그런데 만든 것도 AI고, 읽는 사람은 그 글이 맞는지 확인할 방법이 없었다.
 *   같은 모델에게 "맞니?"라고 물으면 자기가 쓴 글을 대체로 옹호한다 — 그래서 **다른 회사 모델**
 *   여럿에게 따로 묻고, 여러 모델이 같은 곳을 짚으면 그건 진짜일 가능성이 높다고 본다.
 *
 * 이 모듈이 하지 않는 것: 판정을 대신 내리지 않는다. 지적을 모아 보여줄 뿐이고 결정은 사람이 한다.
 */
import { placementJudgeRules } from './reportUtils.js';

/** 글의 성격마다 다르게 봐야 한다 — 무엇이 '틀린 것'인지가 다르기 때문. */
const KIND_GUIDE = {
  ipgyeol: `이 글은 **대학 입시 지원 판정**입니다. 특히 다음을 의심하세요.
- 입결 등급을 학생 내신과 같은 자로 비교했는가. 대학이 자체 환산등급을 쓰면 그 비교는 성립하지 않습니다.
- 낙관 편향: 근거 없이 '안정'이라 부르거나, 충원·경쟁률을 유리한 쪽으로만 읽지 않았는가.
- 수능최저·모집인원 급감·소수선발·통학거리 같은 강등 요인을 빠뜨리지 않았는가.
${placementJudgeRules()}`,
  saenggibu: `이 글은 **생활기록부 분석·전략**입니다. 특히 다음을 의심하세요.
- 학생 자료에 없는 활동·성취를 지어내지 않았는가(가장 큰 문제입니다).
- 두루뭉술한 칭찬으로 분량을 채우지 않았는가. 근거가 되는 기록을 짚고 있는가.
- 학년·시기상 이미 지난 일을 앞으로 할 일처럼 쓰지 않았는가.`,
  roadmap: `이 글은 **학생이 직접 따라 할 로드맵**입니다. 특히 다음을 의심하세요.
- 학생이 혼자 읽고 실행할 수 있을 만큼 구체적인가(무엇을, 언제까지, 어떻게).
- 고등학생이 실제로 할 수 있는 분량·난이도인가. 대학원생 수준의 주제를 얹지 않았는가.
- 학교에서 실제로 열리는 과목·활동에 근거하는가.`,
  record: `이 글은 **학생 기록(상담·분석·검색 결과)**입니다. 특히 다음을 의심하세요.
- 숫자(내신·컷·경쟁률·연도)가 서로 어긋나지 않는가.
- 기록에 없는 사실을 단정하지 않았는가.
- 결론이 근거보다 앞서 나가지 않았는가.`,
};

export const VERIFY_KINDS = Object.keys(KIND_GUIDE);

function systemPromptFor(kind) {
  const guide = KIND_GUIDE[kind] || KIND_GUIDE.record;
  return `당신은 입시 컨설팅 문서를 검토하는 **깐깐한 감수자**입니다. 이 글은 다른 AI가 썼고,
학생·학부모의 지원 결정에 쓰입니다. 잘못된 문장 하나가 지원 실패로 이어질 수 있습니다.

${guide}

[검토 원칙]
- 칭찬하지 마세요. 당신의 일은 **틀린 곳을 찾는 것**입니다. 문제가 없으면 없다고만 하세요.
- 반드시 **원문 문장을 그대로 인용**해서 어디가 문제인지 짚으세요. 뭉뚱그리면 고칠 수 없습니다.
- 주어진 [원본 자료]에 없는 내용을 글이 단정했다면 그것이 가장 심각한 문제입니다.
- 자료가 없어서 판단할 수 없는 것은 '문제'가 아닙니다. 모르면 지적하지 마세요.
- 문체·표현 취향은 지적하지 마세요. **사실·논리·누락**만 봅니다.

[출력 형식 — 오직 JSON만, 다른 말 금지]
{
  "verdict": "신뢰가능" | "주의" | "재작성권장",
  "summary": "한 문장 총평",
  "issues": [
    {
      "severity": "높음" | "중간" | "낮음",
      "type": "사실오류" | "과장" | "누락" | "모순" | "근거없음",
      "quote": "문제가 있는 원문 문장을 그대로",
      "problem": "무엇이 왜 잘못됐는지",
      "fix": "어떻게 고치면 되는지"
    }
  ]
}
문제가 없으면 issues 는 빈 배열로 두고 verdict 를 "신뢰가능"으로 하세요.`;
}

/**
 * 토큰 한도에 걸려 **중간에서 잘린 JSON** 을 살려낸다.
 * 지적을 10건 넘게 쓰면 응답이 길어져 마지막 문장에서 끊기는데, 그 한 건 때문에
 * 앞의 아홉 건까지 통째로 버리면 검토자 하나가 통째로 실패한 것처럼 보인다.
 * 열린 문자열·괄호를 닫아 파싱한 뒤, 잘려서 반쪽인 마지막 지적만 버린다.
 */
function salvageTruncatedJson(t) {
  const a = t.indexOf('{');
  if (a < 0) return null;
  const s = t.slice(a);
  const stack = [];
  let inStr = false, esc = false;
  for (const ch of s) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  if (!stack.length && !inStr) return null;   // 잘린 게 아니면 여기 올 일이 없다
  let fixed = s;
  if (inStr) fixed += '"';
  fixed = fixed.replace(/,\s*$/, '');
  for (let i = stack.length - 1; i >= 0; i -= 1) fixed += stack[i] === '{' ? '}' : ']';
  let obj;
  try { obj = JSON.parse(fixed); } catch { return null; }
  // 마지막 지적은 문장이 끊겨 있을 가능성이 높다 — 근거가 반쪽이면 보여주지 않는다
  if (Array.isArray(obj.issues) && obj.issues.length) {
    const last = obj.issues[obj.issues.length - 1];
    if (!last?.problem || !last?.fix) obj.issues.pop();
  }
  obj.truncated = true;
  return obj;
}

/** 모델이 코드펜스나 잡담을 붙여도, 답이 중간에 잘려도 JSON 을 건져낸다. */
export function parseVerdictJson(raw) {
  const t = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(t); } catch { /* 아래에서 한 번 더 */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* 아래에서 한 번 더 */ } }
  return salvageTruncatedJson(t);
}

/** 지적끼리 '같은 곳을 말하는지' 비교하기 위한 키 — 인용문 앞부분을 뼈대만 남겨 맞춘다. */
function issueKey(issue) {
  const q = String(issue?.quote || '').replace(/[\s"'“”‘’.,·…()[\]]/g, '').slice(0, 24);
  return q || `t:${issue?.type || ''}:${String(issue?.problem || '').replace(/\s/g, '').slice(0, 20)}`;
}

/**
 * 여러 검토 결과를 겹쳐 본다.
 * 여러 모델이 같은 곳을 짚었으면 그건 우연일 확률이 낮다 — 그 순서로 보여준다.
 */
export function buildConsensus(reviews) {
  const ok = reviews.filter((r) => r.ok && r.result);
  const map = new Map();
  for (const r of ok) {
    for (const it of (r.result.issues || [])) {
      const k = issueKey(it);
      if (!map.has(k)) map.set(k, { ...it, agreedBy: [], severities: [] });
      const e = map.get(k);
      if (!e.agreedBy.includes(r.label)) e.agreedBy.push(r.label);
      e.severities.push(it.severity);
      // 더 자세히 쓴 지적을 대표로 남긴다
      if (String(it.problem || '').length > String(e.problem || '').length) {
        e.problem = it.problem; e.fix = it.fix; e.quote = it.quote || e.quote;
      }
    }
  }
  const SEV = { 높음: 3, 중간: 2, 낮음: 1 };
  const issues = [...map.values()].sort((a, b) =>
    b.agreedBy.length - a.agreedBy.length
    || (SEV[b.severity] || 0) - (SEV[a.severity] || 0));

  const verdicts = ok.map((r) => r.result.verdict).filter(Boolean);
  // 가장 나쁜 판정을 대표로 — 한 모델이라도 '재작성권장'이면 그걸 먼저 봐야 한다
  const RANK = { 재작성권장: 3, 주의: 2, 신뢰가능: 1 };
  const worst = verdicts.sort((a, b) => (RANK[b] || 0) - (RANK[a] || 0))[0] || null;

  return {
    verdict: worst,
    reviewerCount: ok.length,
    agreedCount: issues.filter((i) => i.agreedBy.length >= 2).length,
    issues,
  };
}

/**
 * 한 검토자에게 글을 보낸다. 실패해도 다른 검토자 결과는 살아야 하므로 여기서 삼킨다.
 * @param call callAIModel (server.js 가 주입 — 이 모듈이 SDK 를 직접 들지 않게)
 */
export async function reviewOnce(call, { label, group, submodel, apiKey }, { kind, text, context }) {
  try {
    const userMsg = [
      context ? `[원본 자료 — 이 글이 근거로 삼아야 하는 것]\n${String(context).slice(0, 40000)}` : '',
      `[검토할 글]\n${String(text).slice(0, 60000)}`,
    ].filter(Boolean).join('\n\n');
    const raw = await call({
      aiModel: group, submodel, apiKey,
      // 지적을 열 건 넘게 쓰면 4000 토큰으로는 한국어 응답이 문장 중간에서 끊긴다.
      // 끊기면 JSON 이 깨져 검토자 하나가 통째로 실패한다 — callAIModel 기본값과 같은 8000 을 준다.
      systemPrompt: systemPromptFor(kind), userMsg, maxTokens: 8000,
    });
    const result = parseVerdictJson(raw);
    // 실패를 '읽지 못했습니다' 한 줄로 덮으면 무엇이 왔는지 알 길이 없다. 응답 앞부분을 붙여 둔다.
    if (!result) {
      const head = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      return { label, ok: false, error: head ? `검토 결과를 JSON 으로 읽지 못했습니다 — 응답: ${head}…` : '검토자가 빈 응답을 보냈습니다' };
    }
    return { label, ok: true, result: { verdict: result.verdict || null, summary: result.summary || '', issues: Array.isArray(result.issues) ? result.issues : [] } };
  } catch (err) {
    return { label, ok: false, error: err?.message || '검토 실패' };
  }
}

/**
 * 지적을 **원문에 반영**해 다시 쓴다.
 *
 * 검증만 하고 끝나면 컨설턴트가 지적 열 건을 손으로 옮겨 적어야 한다 — 그러다 빠뜨린다.
 * 여기서 하는 일은 '다시 쓰기'가 아니라 '지적된 곳만 고치기'다. 지적이 닿지 않은 문장은
 * 한 글자도 건드리지 않아야 원문의 다른 판단이 조용히 바뀌는 일이 없다.
 */
function applySystemPrompt(kind) {
  const guide = KIND_GUIDE[kind] || KIND_GUIDE.record;
  return `당신은 입시 컨설팅 문서를 **지적받은 대로 고쳐 쓰는 편집자**입니다.
아래 [원문]을 감수자들이 읽고 [지적]을 남겼습니다. 그 지적을 반영해 원문을 다시 씁니다.

${guide}

[지켜야 할 것]
- **지적된 곳만** 고칩니다. 지적이 닿지 않은 문장·수치·표·목록·순서는 한 글자도 바꾸지 마세요.
- 각 지적의 '고치는 법'을 그대로 따릅니다. 더 나은 표현이 떠올라도 지적 범위를 넘지 마세요.
- **새 사실을 지어내지 마세요.** [원본 자료]에 없는 것은 단정하지 말고 '확인 필요'라고 쓰세요.
- 원문의 형식(줄바꿈·머리표·번호·마크다운 표)을 그대로 유지합니다.
- 분량을 줄이지 마세요. 지적과 무관한 대목을 요약하거나 빼면 안 됩니다.

[출력 — 고쳐 쓴 글 전문만. 설명·머리말·코드펜스 금지]`;
}

/** 지적 목록을 사람이 읽는 모양 그대로 모델에게 넘긴다 — JSON 을 주면 형식을 흉내 내려 든다. */
function issuesToText(issues) {
  return (Array.isArray(issues) ? issues : []).map((it, i) => [
    `${i + 1}. (${it.severity || '낮음'} · ${it.type || '지적'})`,
    it.quote ? `   문제된 문장: "${it.quote}"` : '',
    it.problem ? `   무엇이 잘못됐나: ${it.problem}` : '',
    it.fix ? `   고치는 법: ${it.fix}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

export async function applyFixes(call, { group, submodel, apiKey }, { kind, text, context, issues }) {
  const list = (Array.isArray(issues) ? issues : []).filter((i) => i && (i.problem || i.fix));
  if (!list.length) throw new Error('반영할 지적이 없습니다');
  const original = String(text || '');
  const userMsg = [
    context ? `[원본 자료 — 이 글이 근거로 삼아야 하는 것]\n${String(context).slice(0, 40000)}` : '',
    `[지적 ${list.length}건]\n${issuesToText(list)}`,
    `[원문 — 이것을 고쳐 씁니다]\n${original.slice(0, 60000)}`,
  ].filter(Boolean).join('\n\n');

  const raw = await call({
    aiModel: group, submodel, apiKey,
    systemPrompt: applySystemPrompt(kind), userMsg, maxTokens: 16000,
  });
  const out = String(raw || '').trim().replace(/^```(?:markdown|md|text)?\n?/i, '').replace(/\n?```$/, '').trim();
  if (!out) throw new Error('고쳐 쓴 글을 받지 못했습니다');
  // 지적을 반영한다며 글을 반토막 내는 일이 있다. 조용히 짧아진 글을 저장하게 두면 안 된다.
  if (original.length >= 400 && out.length < original.length * 0.5) {
    throw new Error(`고쳐 쓴 글이 원문의 절반 이하로 줄었습니다(${original.length}자 → ${out.length}자). 반영할 지적을 줄여 다시 시도해 주세요.`);
  }
  return out;
}
