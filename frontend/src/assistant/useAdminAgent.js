import { useAssistantAgent } from './useAssistantAgent';
import { MENU_ITEMS } from '../menus';

// 관리자 대시보드(AdminDashboard)의 도구 — 이용자 코드 활성화·비활성화·공개 메뉴·새 코드 발급.
// 원장이 "전원 비활성화해", "강민규만 켜줘", "김수진 빼고 다 꺼" 처럼 시키는 것을 한 번에 처리한다.
//
// 🔒 관리자 전용 — 세 겹으로 막는다: ① 이 화면은 role==='admin' 일 때만 그려진다(App.jsx)
//   ② 서버 /api/assistant 가 관리자 로그인이 아니면 이 도구 이름들을 모델에게서 뺀다(assistantAgent ADMIN_UI_TOOLS)
//   ③ 실제 변경 API(/api/admin/users)는 requireAdmin. 도구 이름을 바꾸면 ADMIN_UI_TOOLS 도 같이 바꿀 것.
//
// 코드 삭제(delete_users)는 사용 기록까지 지워져 되돌릴 수 없다 — 몇 개든 **항상** 확인창을 띄운다(원장 요청으로 09-29 추가).

// 한꺼번에 바꿀 때 서버에 동시에 보내는 요청 수. 78개를 한 번에 쏘면 Railway 가 몇 개를 튕긴다.
const CONCURRENCY = 6;
// 이 수 이상을 한 번에 바꾸면 확인창을 띄운다(한두 명은 말한 그대로라 묻지 않는다).
const CONFIRM_AT = 3;

const norm = (s) => String(s || '').replace(/\s/g, '').toLowerCase();
const label = (u) => `${u.name || '(이름없음)'}(${u.code})`;

/**
 * 이름·코드 목록을 실제 이용자로 바꾼다. 이름이 같은 사람이 둘 이상이면 고르지 않고 되묻게 한다
 * (엉뚱한 사람을 끄는 게 못 끄는 것보다 나쁘다).
 */
function resolveUsers(users, raws) {
  const hits = new Map();
  const missing = [];
  const ambiguous = [];
  for (const raw of raws || []) {
    const q = norm(raw);
    if (!q) continue;
    const byCode = users.filter((u) => norm(u.code) === q);
    const byName = users.filter((u) => norm(u.name) === q);
    const partial = users.filter((u) => norm(u.name).includes(q));
    const found = byCode.length ? byCode : byName.length ? byName : partial;
    if (found.length === 0) missing.push(raw);
    else if (found.length > 1) ambiguous.push(`${raw} → ${found.map(label).join(', ')}`);
    else hits.set(found[0].id, found[0]);
  }
  return { hits: [...hits.values()], missing, ambiguous };
}

/** all/targets/except 를 풀어 대상 이용자 목록을 만든다. 문제가 있으면 error 문자열. */
function pickTargets(users, { all, targets, except }) {
  let picked;
  const notes = [];
  if (all) {
    picked = users;
  } else {
    const r = resolveUsers(users, targets);
    if (r.ambiguous.length) return { error: `이름이 겹쳐 누구인지 모릅니다 — 코드로 다시 지정하세요: ${r.ambiguous.join(' / ')}` };
    if (r.missing.length) notes.push(`목록에 없음: ${r.missing.join(', ')}`);
    picked = r.hits;
  }
  if (except?.length) {
    const ex = resolveUsers(users, except);
    if (ex.ambiguous.length) return { error: `제외할 이름이 겹칩니다 — 코드로 다시 지정하세요: ${ex.ambiguous.join(' / ')}` };
    if (ex.missing.length) notes.push(`제외 목록 중 없는 이름: ${ex.missing.join(', ')}`);
    const drop = new Set(ex.hits.map((u) => u.id));
    picked = picked.filter((u) => !drop.has(u.id));
  }
  return { picked, notes };
}

async function runLimited(items, fn) {
  const failed = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const it = items[i++];
      try { await fn(it); } catch (e) { failed.push(`${label(it)}: ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return failed;
}

const TARGET_PROPS = {
  all: { type: 'boolean', description: '전체 이용자 코드가 대상이면 true' },
  targets: { type: 'array', items: { type: 'string' }, description: '대상 이용자의 이름 또는 코드(예: 강민규, 4HB28HKA). all 이 true 면 비워 둔다.' },
  except: { type: 'array', items: { type: 'string' }, description: '대상에서 뺄 이름 또는 코드("누구 빼고 전부")' },
};

export function useAdminAgent({ users, dbOn, patchUser, createUser, deleteUser, reload }) {
  const menuKeys = MENU_ITEMS.map((m) => m.key);

  useAssistantAgent('screen', {
    key: 'admin',
    title: '관리자 대시보드',
    describe: () => {
      if (!dbOn) return '[화면] 관리자 대시보드 — 데이터베이스가 연결되지 않아 이용자 코드를 다룰 수 없다.';
      const online = users.filter((u) => u.online);
      const off = users.filter((u) => !u.active);
      return [
        '[화면] 관리자 대시보드 — 이용자(학원) 코드 관리·현재 접속·지식베이스·활동 로그.',
        `[이용자 코드] 총 ${users.length}개 · 활성 ${users.length - off.length} · 비활성 ${off.length} · 접속중 ${online.length}`,
        online.length ? `[접속중] ${online.map(label).join(', ')}` : '',
        '[도구] 이용자 전체 명단은 list_users 로 읽는다. 활성/비활성은 set_users_active(전원·특정인·누구 빼고 전부), 공개 메뉴는 set_user_menus, 새 코드는 create_user_code, 삭제는 delete_users.',
        '[삭제] delete_users 는 코드와 사용 기록을 되돌릴 수 없게 지운다. 원장이 "삭제"를 분명히 말했을 때만 부르고, 비활성화로 충분한지 헷갈리면 먼저 물을 것.',
      ].filter(Boolean).join('\n');
    },
    examples: [
      '전원 비활성화해줘',
      '강민규, 조한결만 활성화해줘',
      '김수진 빼고 전부 활성화',
      '오늘 접속 안 한 사람 목록 보여줘',
    ],
    tools: [
      {
        name: 'list_users',
        description: '이용자 코드 전체 명단(이름·코드·활성 여부·접속중·최근 접속·분석 횟수·공개 메뉴)을 읽는다. 누구를 바꿀지 확인하거나 명단을 물을 때.',
        schema: { type: 'object', properties: {} },
        run: () => {
          if (!users.length) return '발급된 이용자 코드가 없습니다.';
          const when = (ts) => (ts ? new Date(ts).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '없음');
          return users.map((u) => [
            label(u),
            u.active ? '활성' : '비활성',
            u.online ? '접속중' : '',
            `최근접속 ${when(u.last_seen_at)}`,
            `분석 ${u.analyze_count || 0}회`,
            `메뉴 ${Array.isArray(u.menus) ? u.menus.join('·') || '없음' : '전체'}`,
          ].filter(Boolean).join(' | ')).join('\n');
        },
      },
      {
        name: 'set_users_active',
        description: '이용자 코드를 활성화(active=true) 또는 비활성화(active=false)한다. 전원(all=true), 특정인(targets), "누구 빼고 전부"(all=true + except) 모두 된다. 비활성화된 코드는 로그인·이용이 막힌다.',
        schema: {
          type: 'object',
          properties: { active: { type: 'boolean', description: 'true=활성화, false=비활성화' }, ...TARGET_PROPS },
          required: ['active'],
        },
        confirm: ({ active, ...rest }) => {
          const r = pickTargets(users, rest);
          if (r.error) return null; // 대상이 틀렸으면 묻지 않고 run 이 이유를 돌려준다
          const change = r.picked.filter((u) => !!u.active !== !!active);
          if (change.length < CONFIRM_AT) return null;
          const names = change.slice(0, 12).map((u) => u.name || u.code).join(', ');
          return `${change.length}개 코드를 ${active ? '활성화' : '비활성화'}할까요?\n${names}${change.length > 12 ? ` 외 ${change.length - 12}개` : ''}`;
        },
        run: async ({ active, ...rest }) => {
          if (typeof active !== 'boolean') return 'active 값(true/false)이 필요합니다.';
          if (!rest.all && !(rest.targets || []).length) return '대상이 없습니다. 전원(all) 또는 이름·코드(targets)를 지정하세요.';
          const r = pickTargets(users, rest);
          if (r.error) return r.error;
          const change = r.picked.filter((u) => !!u.active !== !!active);
          const already = r.picked.length - change.length;
          const word = active ? '활성화' : '비활성화';
          if (!change.length) return [`바꿀 코드가 없습니다 — 대상 ${r.picked.length}개가 이미 ${word} 상태입니다.`, ...r.notes].join(' ');
          const failed = await runLimited(change, (u) => patchUser(u.id, { active }));
          await reload();
          const done = change.length - failed.length;
          return [
            `${done}개 코드를 ${word}했습니다${done <= 10 ? `: ${change.filter((u) => !failed.some((f) => f.startsWith(label(u)))).map(label).join(', ')}` : ''}.`,
            already ? `이미 ${word} 상태라 그대로 둔 코드 ${already}개.` : '',
            failed.length ? `실패 ${failed.length}개 — ${failed.join(' / ')}` : '',
            ...r.notes,
          ].filter(Boolean).join(' ');
        },
      },
      {
        name: 'set_user_menus',
        description: `이용자 코드의 공개 메뉴를 바꾼다. mode: open(메뉴 열기) / close(메뉴 닫기) / all(전체 공개로 되돌리기). 메뉴 key: ${MENU_ITEMS.map((m) => `${m.key}(${m.label})`).join(', ')}. interview·schoolreports·seminar 는 전체 공개여도 잠겨 있어 open 으로 직접 열어야 한다.`,
        schema: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['open', 'close', 'all'] },
            menus: { type: 'array', items: { type: 'string', enum: menuKeys }, description: 'open/close 할 메뉴 key' },
            ...TARGET_PROPS,
          },
          required: ['mode'],
        },
        confirm: ({ mode, menus, ...rest }) => {
          const r = pickTargets(users, rest);
          if (r.error || r.picked.length < CONFIRM_AT) return null;
          return `${r.picked.length}개 코드의 공개 메뉴를 바꿀까요? (${mode === 'all' ? '전체 공개' : `${mode === 'open' ? '열기' : '닫기'}: ${(menus || []).join(', ')}`})`;
        },
        run: async ({ mode, menus = [], ...rest }) => {
          if (!rest.all && !(rest.targets || []).length) return '대상이 없습니다. 전원(all) 또는 이름·코드(targets)를 지정하세요.';
          const keys = menus.filter((k) => menuKeys.includes(k));
          if (mode !== 'all' && !keys.length) return `바꿀 메뉴가 없습니다. 고를 수 있는 key: ${menuKeys.join(', ')}`;
          const r = pickTargets(users, rest);
          if (r.error) return r.error;
          if (!r.picked.length) return ['대상 코드가 없습니다.', ...r.notes].join(' ');
          // AdminDashboard 의 메뉴 편집창과 같은 규칙: null=전체 공개(optIn 제외), 배열=그 안의 것만.
          const base = (u) => (Array.isArray(u.menus) ? u.menus : MENU_ITEMS.filter((m) => !m.optIn).map((m) => m.key));
          const next = (u) => {
            if (mode === 'all') return null;
            if (mode === 'open') return [...new Set([...base(u), ...keys])];
            return base(u).filter((k) => !keys.includes(k));
          };
          const failed = await runLimited(r.picked, (u) => patchUser(u.id, { menus: next(u) }));
          await reload();
          return [
            `${r.picked.length - failed.length}개 코드의 공개 메뉴를 바꿨습니다(${mode === 'all' ? '전체 공개' : `${mode === 'open' ? '열기' : '닫기'}: ${keys.join(', ')}`}).`,
            failed.length ? `실패 ${failed.length}개 — ${failed.join(' / ')}` : '',
            ...r.notes,
          ].filter(Boolean).join(' ');
        },
      },
      {
        name: 'delete_users',
        description: '이용자 코드를 삭제한다. 사용 기록도 함께 지워지고 되돌릴 수 없다. 원장이 "삭제"를 분명히 시켰을 때만 부른다(쓰지 못하게만 하려면 set_users_active 로 비활성화). 전원(all=true)·특정인(targets)·"누구 빼고"(except) 모두 된다.',
        schema: { type: 'object', properties: { ...TARGET_PROPS } },
        // 되돌릴 수 없으므로 한 명이어도 반드시 묻는다.
        confirm: (args) => {
          const r = pickTargets(users, args);
          if (r.error || !r.picked.length) return null; // run 이 이유를 돌려준다
          const names = r.picked.slice(0, 15).map(label).join(', ');
          return `⚠ ${r.picked.length}개 코드를 삭제할까요? 사용 기록도 함께 지워지고 되돌릴 수 없습니다.\n${names}${r.picked.length > 15 ? ` 외 ${r.picked.length - 15}개` : ''}`;
        },
        run: async (args) => {
          if (!args.all && !(args.targets || []).length) return '대상이 없습니다. 전원(all) 또는 이름·코드(targets)를 지정하세요.';
          const r = pickTargets(users, args);
          if (r.error) return r.error;
          if (!r.picked.length) return ['삭제할 코드가 없습니다.', ...r.notes].join(' ');
          const failed = await runLimited(r.picked, (u) => deleteUser(u.id));
          await reload();
          const ok = r.picked.filter((u) => !failed.some((f) => f.startsWith(label(u))));
          return [
            `${ok.length}개 코드를 삭제했습니다${ok.length && ok.length <= 10 ? `: ${ok.map(label).join(', ')}` : ''}.`,
            failed.length ? `실패 ${failed.length}개 — ${failed.join(' / ')}` : '',
            ...r.notes,
          ].filter(Boolean).join(' ');
        },
      },
      {
        name: 'create_user_code',
        description: '새 이용자 코드를 발급한다. name 에 이용자 이름이나 메모(예: 김선생, 3학년반)를 넣는다.',
        schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
        confirm: ({ name }) => `'${name}' 이름으로 새 이용자 코드를 발급할까요?`,
        run: async ({ name }) => {
          const code = await createUser(String(name || '').trim());
          return `'${name}' 코드를 발급했습니다: ${code}`;
        },
      },
    ],
  });
}
