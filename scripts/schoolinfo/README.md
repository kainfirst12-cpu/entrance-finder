# 고교·중학 공시정보 데이터 파이프라인 (🏫 고교·중학 공시정보 화면용)

`frontend/public/data/school-catalog.json.gz` 하나를 만든다. 화면(`SchoolInfo.jsx`)은 이 파일만 읽는다(백엔드 없음).

## 데이터 출처와 자동화 가능 여부

| 항목 | 출처 | 자동화 | 스크립트 |
|---|---|---|---|
| 학교 목록(UUID·학교코드·설립·유형코드) | 학교알리미 학교별공시 JSON(`pneiss_a03_s0_school_json.do`) | ✅ 인증 없음 | `fetch-school-list.mjs` |
| 설립·유형·성별·현재 학생수·교원수·주소 | 학교알리미 학교정보 팝업(`Pneiss_b01_s0.do`) | ✅ 인증 없음 (euc-kr) | `fetch-school-info.mjs` |
| **교과별 학업성취(A~E·평균)** | 학교알리미 공시항목 44 | ⚠️ **학교 1곳 = 보안문자 1회(1회용)** | `captcha-runner.js` + `parse-achievement.mjs` |
| 학년별 재적(1등급 자리 계산용) | 학교알리미 공개용데이터 '학년별·학급별 학생수' xlsx | 수동 다운로드 → 스크립트가 읽음 | `build-catalog.mjs --enrollment` |
| 학급·교원(EDSS) | EDSS 개방데이터 | 예전 catalog 값 유지(갱신 스크립트 없음) | — |
| 남은 큐·붙여넣기 파일 만들기 | 위 원본들의 차집합 | ✅ | `make-queue.mjs` |
| 수집 결과 되넣기 | 브라우저에서 받은 JSON | ✅ | `ingest-export.mjs` |

교과별 학업성취는 OpenAPI(12개 항목뿐)·공개용데이터·data.go.kr 어디에도 없고, 웹 페이지는 보안문자로 막혀 있으며
통과가 1회용이라(같은 학교를 다시 봐도 또 요구) 세션 재사용도 안 된다. 엑셀다운로드 버튼도 화면에 뜬 표를 그대로
보내는 것이라 우회로가 없다. 공식 대량 경로는 EDSS(교육부 연구계획서 심사)뿐. → 사람이 숫자만 치고 나머지는
스크립트가 하는 **보안문자 도우미** 방식으로 간다. 학교당 10초쯤.

## 갱신 절차 (매년 5월 공시 후)

```bash
cd scripts/schoolinfo
node fetch-school-list.mjs            # 전국 중·고 목록 → out/school-list.json (5분)
node fetch-school-info.mjs            # 학교정보 팝업 → out/school-info.json (5,300곳 × 0.5초 ≈ 45분, 중단해도 이어받기)
```

교과별 학업성취(원하는 지역만, 예: 경기 고교):
1. 남은 큐와 붙여넣기 파일을 만든다 — 이미 받은 학교·공시제외 학교는 알아서 빠진다:
   ```bash
   node make-queue.mjs                       # 기본 경기도 고등학교
   node make-queue.mjs --sido 서울특별시 --sigungu 강남구 --chunk 100
   # → out/queue-<지역>.json, out/collect-<지역>-1.js, -2.js, …(한 덩이 130곳)
   ```
2. 덩이 파일 맨 위 주석의 주소(첫 학교 공시 팝업)를 크롬에서 열고, F12 콘솔에 **그 파일 전체를 붙여넣는다**.
   (파일 = `captcha-runner.js` + 그 덩이의 `SI.start(...)`. 예전처럼 runner 따로 실행 후 큐를 넣어도 된다.)
3. 화면 위 초록 띠에 뜨는 학교의 보안문자를 입력 → Enter. 표가 뜨면 자동 저장 후 다음 학교. 학교당 10초쯤.
4. 한 덩이가 끝나면 콘솔에서 `SI.download()` → 받은 JSON 을 넣는다:
   ```bash
   node ingest-export.mjs ~/Downloads/achievement-raw-2026-09-19.json [--dry]
   ```
   `SI.all()`·`SI._state.done` 을 붙여넣은 파일, javascript_tool 결과 파일도 같은 명령으로 들어간다.
   `SI._state.failed`(공시제외)까지 담긴 파일이면 `achievement-skipped.json` 에도 자동으로 붙는다.
   표가 덜 뜬 채 잡힌 레코드는 저장하지 않고 이름을 찍어 준다 — 그 학교만 다시 돌리면 된다.
   레코드 = `{id, name, chasu, grades:{1:{year, rows:[[계열, 과목(단위), 1학기 평균, A,B,C,D,E, 2학기 평균, A,B,C,D,E], …]}, 2, 3}}`

조립:
```bash
node parse-achievement.mjs                          # 확인용 요약 + out/achievement-parsed.json
node build-catalog.mjs [--enrollment 학년별학급별학생수.xlsx]   # → frontend/public/data/school-catalog.json.gz
```
그 다음 커밋·푸시하면 Vercel 이 배포한다. `out/` 은 .gitignore(*.json) 에 걸려 커밋되지 않는다 — 원본은 여기 PC 에만 있다.

## 스키마 (bucheon-schoolinfo 와 호환)
```
schools[] = { id, schulCode, shlIdfCd, schoolName, schoolLevel(고등학교|중학교), sido, sigungu, schoolType, gender, fond,
              enrollment{grade1,grade2,grade3,total}, grade1Seats(=round(grade1×0.1)), bands[], edss{...}|null,
              current{students,male,female,teachers,founded,homepage}?, achievementChasu?, address? }
bands[]   = { grade, semester, subject, credit, family(국어|영어|수학|null), year, mean, sd, a, b, c, d, e }
```
- 2026년 공시(2025학년도) 표에는 표준편차가 없다 → sd null.
- 1학년(2022 교육과정)은 공통국어1/2 처럼 학기 분리 과목이라 한 과목이 한 학기에만 값이 있다.
- 진로선택·체육예술은 A·B·C 3단계만 공시 → d, e null.
- 특성화고 학과별 산출 줄은 과목명 뒤에 `[계열]` 을 붙인다.

## 알려진 함정
- 학교알리미 응답은 euc-kr — Node `res.text()` 로 읽으면 깨진다(`TextDecoder('euc-kr')`).
- runner 는 표를 잡은 직후 `state.current = null` 을 해야 한다. 안 그러면 다음 fragment 가 오기 전 폴링이 같은 표를 두 번 잡아
  학교가 한 칸씩 건너뛰어진다(2026-09-19 실제 발생).
- localStorage 는 학교당 1~2KB(그리드) 라 수백 곳 들어가지만, 원문 HTML 을 넣으면 12곳에서 꽉 찬다.
- 시군구 개편(인천 서구→서해구 등)으로 이름이 바뀌므로 catalog 매칭은 학교명+시도 우선.

## 다른 PC 에서 이어서 수집하기 (원장 안내)

원본(`out/school-list.json`, `out/school-info.json`, `out/achievement-raw/*.json`, `out/achievement-skipped.json`)은 커밋돼 있다.
집 PC 에서 Claude Code 를 `entrance-finder` 폴더로 열고 이렇게 말하면 된다:

> "scripts/schoolinfo/README.md 읽고, 경기도 고등학교 교과별 학업성취 수집을 이어서 해줘. 보안문자는 내가 칠게."

Claude 가 할 일(순서):
1. `git pull` — 다른 PC 가 올린 원본을 받는다.
2. `node make-queue.mjs` — 남은 큐(`out/queue-경기도-고등학교.json`) 와 붙여넣기 파일(`out/collect-경기도-고등학교-N.js`) 생성.
3. 내장 브라우저로 붙여넣기 파일 첫 줄의 주소(큐 첫 학교 공시 팝업)를 열고 그 파일 내용을 javascript_tool 로 주입한다.
   (한 덩이 130곳이 6KB runner + 큐 12KB 쯤. 페이지에서 localhost 로 fetch 는 막혀 있어 큐를 직접 붙여 넣어야 한다.)
4. 원장이 숫자를 치는 동안 `JSON.stringify(window.SI._state.done.slice(a,b))` 로 꺼내
   `node ingest-export.mjs <결과파일>` 로 저장(`save-toolresult.py` 도 같은 일을 하는 예전 버전).
   결과가 커도 tool-results 파일로 떨어지므로 30~50곳씩 꺼내도 된다. 공시제외(`SI._state.failed`)도 같은 명령이 받는다.
5. 끝나면 `node build-catalog.mjs` → `frontend/public/data/school-catalog.json.gz` 갱신 → 커밋·푸시(원본 포함).
   아티팩트(HTML 단독 페이지) 갱신은 이 저장소를 처음 만든 세션에서만 같은 URL 로 재발행되므로, 다른 PC 에서는
   `standalone/` 를 새 아티팩트로 올리거나 학원 PC 세션에 맡긴다.

### 웹/클라우드 Claude Code 에서는 수집이 안 된다 (2026-09-19 확인)
claude.ai/code 같은 원격 세션은 바깥으로 나가는 주소가 조직 정책으로 걸러진다 —
`www.schoolinfo.go.kr:443` 은 CONNECT 403(`connect_rejected`) 으로 막혀 curl·Playwright·내장 브라우저 모두 못 연다.
게다가 보안문자를 칠 사람이 그 컨테이너 화면 앞에 없다. 그래서 **수집(2~4단계)은 브라우저가 있는 PC 에서만** 한다.
원격 세션이 대신 해 줄 수 있는 것: 큐·붙여넣기 파일 만들기(`make-queue.mjs`), 받아온 결과 되넣기(`ingest-export.mjs`),
`parse-achievement.mjs`·`build-catalog.mjs` 조립, 커밋·푸시. 즉 **원장 PC 크롬에서 숫자만 치고**,
받은 JSON 파일을 세션에 올려 주면 나머지는 원격 세션이 한다.

진행 현황(2026-09-19): 부천 28 + 강릉고 1 + 경기 90곳 = 119곳 수집. 경기 고교 남은 큐 380곳
(`out/collect-경기도-고등학교-1~3.js`, 시군구·가나다순으로 김포 '양곡고'부터).
