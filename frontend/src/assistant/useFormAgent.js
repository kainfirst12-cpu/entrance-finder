import { useAssistantAgent } from './useAssistantAgent';

// '새 생기부 분석' 폼(StudentForm)의 도구.
// 이 화면이 이 앱에서 손이 제일 많이 가는 곳이다 — 칸이 스무 개 넘고 탭이 둘이다.

const TEXT_FIELDS = {
  name: '학생 이름',
  school: '학교명',
  region: '지역',
  grade: '학년 (고1/고2/고3/N수 등)',
  targetUniv: '목표 대학',
  gpa: '대표 내신 등급 (숫자, 예: 2.3)',
  club: '동아리',
  volunteer: '봉사활동',
  leadership: '리더십 경험',
  awards: '수상 경력',
  talent: '특기',
  interests: '관심 분야',
  specialNotes: '세특 등 직접 붙여 넣는 생기부 내용',
  subjectPlan: '과목 선택 계획',
};

/** 목록에 있는 값으로 맞춰 준다 — 모델은 '컴퓨터공학'이라 말하고 목록에는 '컴퓨터공학/SW'가 있다. */
function resolveFrom(list, raw) {
  const q = String(raw || '').trim();
  if (!q) return null;
  return list.find((v) => v === q)
    || list.find((v) => v.replace(/\s/g, '') === q.replace(/\s/g, ''))
    || list.find((v) => v.startsWith(q))
    || list.find((v) => v.includes(q))
    || null;
}

export function useFormAgent({
  form, setField, majors, setMajors, tracks, setTracks,
  tab, setTab, tabs, submit, uploadedCount, reuseMode,
  MAJORS, TRACKS, MAX_MAJORS,
}) {
  useAssistantAgent('screen', {
    key: 'form',
    title: '새 생기부 분석',
    describe: () => [
      '[화면] 새 생기부 분석 — 학생 정보를 채우고 PDF를 올린 뒤 분석을 돌린다.',
      `[탭] ${tabs.map((t, i) => `${i}:${t}`).join(' / ')} — 지금 ${tab}번`,
      '[채워진 값]',
      ...Object.keys(TEXT_FIELDS)
        .filter((k) => String(form[k] || '').trim())
        .map((k) => `  - ${TEXT_FIELDS[k]}: ${String(form[k]).slice(0, 120)}`),
      `[희망 전공] ${majors.length ? majors.join(', ') : '아직 없음 (분석하려면 1개 이상 필요)'}`,
      `[희망 전형] ${tracks.length ? tracks.join(', ') : '선택 안 함'}`,
      `[내신 등급제] ${form.gradeSystem}`,
      `[올린 PDF] ${uploadedCount}개${reuseMode ? ' (이전 분석 자료를 물려받은 재분석 모드)' : ''}`,
      '[주의] PDF 첨부는 파일 선택창이 필요해 조교가 대신 하지 못한다. 값만 채우고 첨부는 원장이 직접.',
    ].join('\n'),
    examples: [
      '김하늘 / 부천고 / 고2 / 내신 2.3 넣어줘',
      '희망 전공 컴퓨터공학이랑 반도체로 잡아줘',
      '목표 대학 중앙대로 하고 학생부종합 전형 켜줘',
    ],
    tools: [
      {
        name: 'fill_student_form',
        description: '분석 폼의 글자 칸을 채운다. 준 항목만 바뀌고 나머지는 그대로 둔다. '
          + '모르는 값은 넣지 마라 — 빈 칸으로 두고 원장에게 물어라.',
        schema: {
          type: 'object',
          properties: Object.fromEntries(
            Object.entries(TEXT_FIELDS).map(([k, label]) => [k, { type: 'string', description: label }]),
          ),
        },
        run: (args) => {
          const done = [];
          for (const [k, v] of Object.entries(args || {})) {
            if (!(k in TEXT_FIELDS)) continue;
            if (v == null) continue;
            setField(k, String(v));
            done.push(`${TEXT_FIELDS[k]}=${String(v).slice(0, 40)}`);
          }
          return done.length ? `채웠습니다 — ${done.join(', ')}` : '채울 값이 없었습니다.';
        },
      },
      {
        name: 'set_grade_system',
        description: "내신 등급제를 고른다. 고1은 보통 5등급제, 고2·고3은 9등급제. 분석 기준이 달라진다.",
        schema: {
          type: 'object',
          properties: { system: { type: 'string', enum: ['9등급제', '5등급제'] } },
          required: ['system'],
        },
        run: ({ system }) => { setField('gradeSystem', system); return `내신 등급제를 ${system}로 바꿨습니다.`; },
      },
      {
        name: 'set_majors',
        description: `희망 전공 계열을 고른다(최대 ${MAX_MAJORS}개). 목록에 있는 이름으로만 고를 수 있고, `
          + `비슷한 말은 알아서 맞춰 준다. 고를 수 있는 값: ${MAJORS.join(' / ')}`,
        schema: {
          type: 'object',
          properties: { majors: { type: 'array', items: { type: 'string' }, description: '전공 계열 이름들' } },
          required: ['majors'],
        },
        run: ({ majors: want }) => {
          const picked = [];
          const missed = [];
          for (const raw of want || []) {
            const hit = resolveFrom(MAJORS, raw);
            if (!hit) { missed.push(raw); continue; }
            if (!picked.includes(hit)) picked.push(hit);
          }
          if (!picked.length) return `목록에서 찾지 못했습니다: ${missed.join(', ')}. 목록에 있는 이름으로 다시 골라 주세요.`;
          const capped = picked.slice(0, MAX_MAJORS);
          setMajors(capped);
          const over = picked.length > MAX_MAJORS ? ` (최대 ${MAX_MAJORS}개라 뒤는 잘랐습니다)` : '';
          const miss = missed.length ? ` / 목록에 없어 못 넣은 것: ${missed.join(', ')}` : '';
          return `희망 전공을 ${capped.join(', ')} 로 정했습니다${over}${miss}`;
        },
      },
      {
        name: 'set_tracks',
        description: `희망 전형을 고른다(복수). 지원 카드를 이 전형 위주로 짠다. 고를 수 있는 값: ${TRACKS.join(' / ')}`,
        schema: {
          type: 'object',
          properties: { tracks: { type: 'array', items: { type: 'string' } } },
          required: ['tracks'],
        },
        run: ({ tracks: want }) => {
          const picked = [];
          const missed = [];
          for (const raw of want || []) {
            const hit = resolveFrom(TRACKS, raw);
            if (!hit) { missed.push(raw); continue; }
            if (!picked.includes(hit)) picked.push(hit);
          }
          setTracks(picked);
          const miss = missed.length ? ` / 목록에 없어 못 넣은 것: ${missed.join(', ')}` : '';
          return picked.length ? `희망 전형을 ${picked.join(', ')} 로 정했습니다${miss}` : `목록에서 찾지 못했습니다: ${missed.join(', ')}`;
        },
      },
      {
        name: 'open_form_tab',
        description: `폼 탭을 옮긴다. ${tabs.map((t, i) => `${i}=${t}`).join(', ')}`,
        schema: { type: 'object', properties: { tab: { type: 'number' } }, required: ['tab'] },
        run: ({ tab: next }) => {
          const i = Math.trunc(Number(next));
          if (!(i >= 0 && i < tabs.length)) return `그런 탭은 없습니다: ${next}`;
          setTab(i);
          return `'${tabs[i]}' 탭을 열었습니다.`;
        },
      },
      {
        name: 'start_analysis',
        description: '채워 둔 내용으로 생기부 분석을 시작한다. 몇 분 걸리고 AI 요금이 든다. '
          + '원장이 시작하라고 했을 때만 부르고, 값을 채운 직후에 알아서 부르지 마라.',
        schema: { type: 'object', properties: {} },
        confirm: () => '지금 분석을 시작할까요? 몇 분 걸리고 AI 요금이 듭니다.',
        run: () => {
          // 폼이 alert 로 막기 전에 여기서 먼저 짚어 준다 — 조교는 alert 를 못 읽는다.
          const missing = [];
          if (!form.name) missing.push('학생 이름');
          if (!form.targetUniv) missing.push('목표 대학');
          if (!majors.length) missing.push('희망 전공(1개 이상)');
          if (missing.length) return `아직 시작할 수 없습니다. 빠진 것: ${missing.join(', ')}`;
          if (uploadedCount === 0 && !reuseMode && !String(form.specialNotes || '').trim()) {
            return 'PDF도 없고 세특 내용도 비어 있어 분석할 재료가 없습니다. 생기부 PDF를 올리시거나 세특을 붙여 넣어 주세요 (첨부는 제가 대신 못 합니다).';
          }
          submit();
          return '분석을 시작했습니다. 진행 화면에서 단계가 올라갑니다.';
        },
      },
    ],
  });
}
