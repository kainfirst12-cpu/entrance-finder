# 학교별 실제 개설 과목 (나이스 시간표)

과목 선택 보조·공시정보의 "이 학교에 ○○ 과목이 열리나?"(✓ / △ / ✗) 데이터.

1. `node scripts/neis/map-schools.mjs` — 학교알리미 catalog 고교 ↔ 나이스 학교 코드(교육청 + 표준학교코드). 2026-10 기준 2,391/2,443곳.
2. `node scripts/neis/fetch-timetable.mjs [--only 부천시]` — 학교마다 2·3학년, 1학기 2주(4/6~10·6/8~12)·2학기 2주(9/7~11·9/14~18) 시간표의 과목명만.
   이어받기(이미 받은 학교는 건너뜀). 창체·휴업·행사 줄은 뺌. 약 10분.
3. `node scripts/neis/build-courses.mjs` → `frontend/public/data/school-courses-2026.json.gz` (커밋·배포)

- 인증키: 환경변수 `NEIS_KEY` 또는 이 PC의 `~/.neis/key.txt` (저장소에 넣지 않는다). open.neis.go.kr 마이페이지에서 발급.
- 원본(`out/`)은 .gitignore(*.json) — 이 PC에만 있다.
- 읽는 법은 `frontend/src/course/offerings.js` 맨 위 주석: 2026 2학년 = 2022 개정(✓), 3학년은 아직 2015 개정이라 같은 계열 옛 과목이 있으면 △(가능성).
- **해마다 갱신**: AY·주(WEEKS)를 바꿔 다시 받는다. 2027부터는 3학년도 2022 개정이라 △ 대신 ✓로 바로 확인된다.
