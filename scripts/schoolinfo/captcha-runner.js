// 학교알리미 '교과별 학업성취 사항'(공시항목 44) 보안문자 도우미 — 학교 공시 팝업 페이지(Pneiss_b01_s0.do) 안에서 실행한다.
//
// 이 항목은 학교 1곳을 볼 때마다 보안문자(CAPTCHA) 1회가 필요하고, 통과는 1회용이라 스크립트만으로는 못 긁는다.
// 그래서 사람이 숫자를 입력하고, 이 스크립트가 (1) 다음 학교 공시를 같은 페이지에 불러오고 (2) 표가 뜨면 즉시
// 원문 HTML·표 텍스트를 붙잡아 두고 (3) 바로 다음 학교로 넘긴다. 사람은 숫자만 계속 친다.
//
// 사용:
//   1) https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=<아무 학교 UUID> 를 연다
//   2) 이 파일 내용을 콘솔(또는 javascript_tool)로 실행 → window.SI 가 생긴다
//   3) SI.start([{id:'<SHL_IDF_CD>', name:'학교명'}, ...])  — 큐를 넣으면 첫 학교의 보안문자 칸이 뜬다
//   4) 숫자 입력 → [입력] (Enter 도 됨). 표가 뜨면 자동 저장 후 다음 학교로.
//   5) SI.drain() 으로 완료분을 꺼내거나(꺼낸 건 큐에서 비움), SI.download() 로 JSON 파일 저장.
//   결과 한 건 = { id, name, capturedAt, chasu, grades: {1: {year, rows: [[계열, 과목, 1학기평균, A,B,C,D,E, 2학기평균, A,B,C,D,E], ...]}, 2:…, 3:…} }
//   숫자 해석(밴드 구조화)은 parse-achievement.mjs 가 한다.
(function () {
  if (window.SI && window.SI.__alive) { console.log('SI already running'); return; }
  const $ = window.jQuery;
  const state = { queue: [], i: 0, done: [], failed: [], current: null, timer: null, __alive: true, waitingSince: 0 };

  const params = (s) => $.param({
    GS_HANGMOK_CD: '44', GS_HANGMOK_NO: '4-나', GS_HANGMOK_NM: '교과별 학업성취 사항',
    GS_BURYU_CD: 'JG220', JG_BURYU_CD: 'JG040', JG_HANGMOK_CD: '15', JG_GUBUN: '1',
    JG_YEAR2: String(state.year), HG_NM: s.name, SHL_IDF_CD: s.id, GS_TYPE: 'Y', JG_YEAR: String(state.year),
    SORT: 'BR', CHOSEN_JG_YEAR: String(state.year), PRE_JG_YEAR: String(state.year), LOAD_TYPE: 'single',
  });

  function banner(msg, color) {
    let b = document.getElementById('si-banner');
    if (!b) {
      b = document.createElement('div'); b.id = 'si-banner';
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;padding:12px 18px;font:700 16px/1.4 sans-serif;color:#fff;box-shadow:0 2px 10px rgba(0,0,0,.3)';
      document.body.appendChild(b);
    }
    b.style.background = color || '#1f5f4e';
    b.textContent = msg;
  }

  function loadCurrent() {
    const s = state.queue[state.i];
    if (!s) { banner(`끝. 저장 ${state.done.length}곳 · 실패 ${state.failed.length}곳 — SI.download() 로 파일 저장`, '#374151'); state.current = null; return; }
    state.current = s; state.waitingSince = Date.now();
    banner(`${state.i + 1}/${state.queue.length}  ${s.name} — 아래 보안문자 숫자를 입력하고 [입력]`, '#1f5f4e');
    $('#gongsiInfo').load('/ei/pp/Pneipp_b44_s0p.do', params(s), function () {
      const box = document.querySelector('#gongsiInfo');
      if (box) { box.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }
      const input = document.querySelector('#passLine44');
      if (input) {
        input.focus();
        // Enter 로도 제출되게 — 원래 페이지는 버튼 클릭만 받는다
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); document.querySelector('#frmSubmit44')?.click(); } });
      } else {
        // 보안문자 없이 바로 표가 온 경우(드묾) — 폴링이 잡는다
      }
    });
  }

  function gridOf(table) {
    const grid = []; const rows = [...table.querySelectorAll('tr')];
    rows.forEach((tr, ri) => {
      grid[ri] = grid[ri] || []; let ci = 0;
      [...tr.children].forEach((td) => {
        while (grid[ri][ci] !== undefined) ci++;
        const txt = td.textContent.trim().replace(/\s+/g, ' '); const rs = td.rowSpan || 1, cs = td.colSpan || 1;
        for (let r = 0; r < rs; r++) { grid[ri + r] = grid[ri + r] || []; for (let c = 0; c < cs; c++) grid[ri + r][ci + c] = txt; }
        ci += cs;
      });
    });
    return grid;
  }

  function captureIfReady() {
    const s = state.current; if (!s) return;
    const box = document.querySelector('#gongsiInfo'); if (!box) return;
    if (document.querySelector('#passLine44')) return; // 아직 입력 전
    const tables = box.querySelectorAll('table');
    const txt = box.innerText || '';
    // 신설·재개교 학교는 보안문자 없이 "현 항목은 … 공시제외" 안내만 온다 → 기록하고 건너뛴다(2026-09 옥길새길고)
    if (/공시제외|자료가 없/.test(txt)) {
      state.failed.push({ ...s, reason: (txt.match(/사유\s*:\s*(.+)/) || [])[1] || '공시제외' });
      state.current = null; state.i += 1;
      banner(`공시제외(${s.name}) — 다음 학교 불러오는 중…`, '#b45309');
      setTimeout(loadCurrent, 600); return;
    }
    if (!tables.length || !/학업성취/.test(txt)) return; // 로딩 중
    // 학년별 표: 페이지는 1·2·3학년 탭을 #excel / #excel2 / #excelN 에 따로 둔다(엑셀다운로드가 이 셋을 보낸다)
    // #excel 안에 1·2·3학년 표 3개가 들어 있다(엑셀다운로드가 보내는 그 HTML). 표를 셀 그리드(rowspan·colspan 펼침)로 압축한다.
    const src = document.querySelector('#excel') || box;
    const grades = {};
    [...src.querySelectorAll('table')].forEach((t, k) => {
      const g = gridOf(t);
      const gradeCell = (g[1] || []).find((x) => /^\d학년$/.test(x || ''));
      grades[gradeCell ? parseInt(gradeCell, 10) : 't' + k] = { year: (g[0] || [])[0] || null, rows: g.slice(4).filter((r) => r.length >= 3) };
    });
    const chasu = document.querySelector('#select_trans_dt')?.value || null;
    const rec = { id: s.id, name: s.name, capturedAt: new Date().toISOString(), chasu, grades };
    state.current = null; // 다음 fragment 가 오기 전에 폴링이 같은 표를 또 잡지 않게 — 이걸 빼먹으면 학교가 한 칸씩 건너뛰어진다
    state.done.push(rec);
    try { localStorage.setItem('si_done_' + s.id, JSON.stringify(rec)); } catch (e) { /* 용량 초과면 메모리만 */ }
    state.i += 1;
    banner(`저장됨: ${s.name} (${state.done.length}곳) — 다음 학교 불러오는 중…`, '#0f766e');
    setTimeout(loadCurrent, 600);
  }

  // 표가 뜨는 걸 0.5초마다 확인. 입력 후 5분 넘게 아무것도 안 뜨면 그 학교는 건너뛰지 않고 그대로 기다린다(사람 속도).
  state.timer = setInterval(captureIfReady, 500);

  window.SI = {
    __alive: true,
    year: new Date().getFullYear(),
    start(list, year) {
      state.queue = list.filter((x) => x && x.id); state.i = 0; state.year = year || this.year;
      const skip = state.queue.filter((x) => localStorage.getItem('si_done_' + x.id));
      if (skip.length) { console.log(`이미 저장된 ${skip.length}곳은 건너뜀`); state.queue = state.queue.filter((x) => !localStorage.getItem('si_done_' + x.id)); }
      loadCurrent();
    },
    skip() { state.failed.push(state.current); state.i += 1; loadCurrent(); },
    status() { return { i: state.i, total: state.queue.length, done: state.done.length, failed: state.failed.length, current: state.current?.name || null }; },
    drain() { const out = state.done.splice(0); return out; },
    all() { return Object.keys(localStorage).filter((k) => k.startsWith('si_done_')).map((k) => JSON.parse(localStorage.getItem(k))); },
    download() {
      const data = this.all();
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), count: data.length, records: data })], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `achievement-raw-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    },
    clearStore() { Object.keys(localStorage).filter((k) => k.startsWith('si_done_')).forEach((k) => localStorage.removeItem(k)); },
    stop() { clearInterval(state.timer); state.__alive = false; window.SI.__alive = false; },
  };
  Object.defineProperty(window.SI, '_state', { get: () => state });
  console.log('SI ready — SI.start([{id, name}, ...])');
})();
