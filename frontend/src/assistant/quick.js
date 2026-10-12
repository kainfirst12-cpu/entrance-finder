// ⚡ 너만의 패파 '바로 처리' — 정해진 모양의 짧은 명령은 AI 를 부르지 않고 코드가 바로 도구를 부른다(2026-10-12 원장 요청).
//   "모델 챗지피티 루나로 바꿔" · "검증은 클로드 오퍼스로 해줘"(분석 결과 화면) · "박예서 학생 열어줘"
// 지금 화면에 그 도구가 있을 때만 쓰고, 확인이 필요한 도구(confirm)는 쓰지 않는다. 안 맞으면 null → 평소처럼 AI 에게.
// (패스파인더 Q·국뽀·뽀개기 lib/assistant/quick.ts 와 같은 규칙)

const COMPANY = /클로드|claude|지피티|챗지피티|gpt|chatgpt|제미나이|제미니|gemini|오퍼스|opus|소네트|sonnet|루나|luna|솔|sol|테라|terra|플래시|flash/i;
const END = String.raw`\s*(?:으로|로)\s*(?:해|해\s*줘|해줘|할게|하자|바꿔|바꿔\s*줘|바꿔줘|변경(?:해\s*줘)?|정해\s*줘)?\s*[.!요]*$`;

function pick(tools, names) {
  for (const n of names) {
    const t = tools.find((x) => x.name === n && !x.confirm);
    if (t) return t;
  }
  return null;
}

export function matchQuick(raw, tools) {
  const text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!text || text.length > 60 || /\n/.test(raw)) return null;

  // 검증 모델 — 분석 결과 화면
  const v = (text.match(new RegExp(String.raw`^(?:다\s*만든\s*(?:뒤|후)\s*)?(?:교차\s*)?검증(?:\s*모델)?(?:은|는|을|를)?\s+(.+?)` + END)) || [])[1];
  if (v && COMPANY.test(v)) {
    const t = pick(tools, ['set_verify_model']);
    if (t) return { tool: t, input: { model: v } };
  }
  // 모델 바꾸기
  const m = text.match(new RegExp(String.raw`^(?:분석\s*|상담\s*)?모델(?:은|는|을|를)?\s+(.+?)` + END))
    || text.match(new RegExp(String.raw`^(.+?)\s*(?:으로|로)\s*(?:바꿔|바꿔\s*줘|바꿔줘|변경해\s*줘)\s*[.!요]*$`));
  if (m && COMPANY.test(m[1]) && !/검증/.test(m[1])) {
    const t = pick(tools, ['set_model']);
    if (t) return { tool: t, input: { model: m[1] } };
  }
  // 학생 열기 — "박예서 학생 열어줘", "운남고 박예서 열어줘"
  const o = text.match(/^(?:(\S+?(?:고|중))\s+)?([가-힣]{2,4})(?:\s*학생)?\s*(?:카드\s*)?(?:열어|펼쳐|보여)\s*(?:줘|줘요|주세요)?\s*[.!]*$/);
  if (o) {
    const t = pick(tools, ['open_student', 'open_board_student']);
    if (t) return { tool: t, input: { name: o[2], ...(o[1] ? { school: o[1] } : {}) } };
  }
  return null;
}
