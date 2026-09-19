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

교과별 학업성취(원하는 지역만, 예: 부천):
1. 내장 브라우저(또는 크롬)에서 아무 학교의 공시 팝업을 연다 —
   `https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=<uuid>`
2. `captcha-runner.js` 내용을 콘솔/javascript_tool 로 실행하고 큐를 넣는다:
   `SI.start([{id:'<SHL_IDF_CD>', name:'학교명'}, ...], 2026)` — id·name 은 out/school-list.json 에서.
   (Claude 세션이면 `out/queue-*.json` 을 만들어 runner 뒤에 `SI.start(...)` 를 붙여 주입한다.)
3. 화면 위 초록 띠에 뜨는 학교의 보안문자를 입력 → Enter. 표가 뜨면 자동 저장 후 다음 학교.
4. 저장분 꺼내기: `SI.all()`(localStorage) 또는 `SI._state.done` 을 JSON 으로 받아
   `out/achievement-raw/<id>.json` 으로 저장(`save-toolresult.py` 는 javascript_tool 결과 파일용).
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
2. 큐 = `out/school-list.json` 의 경기도 고등학교 − `out/achievement-raw/` 에 있는 id − `out/achievement-skipped.json` 의 id.
3. 내장 브라우저로 `https://www.schoolinfo.go.kr/ei/ss/Pneiss_b01_s0.do?SHL_IDF_CD=<큐 첫 학교 uuid>` 를 열고
   `captcha-runner.js` 를 javascript_tool 로 주입(주석 제거본 6KB) + 큐를 `window.__Q` 로 3덩이 나눠 넣고 `SI.start(q, 2026)`.
   (페이지에서 localhost 로 fetch 는 막혀 있어 큐를 직접 붙여 넣어야 한다.)
4. 원장이 숫자를 치는 동안 `JSON.stringify(window.SI._state.done.slice(a,b))` 로 꺼내 `save-toolresult.py <결과파일>` 로 저장.
   결과가 커도 tool-results 파일로 떨어지므로 30~50곳씩 꺼내도 된다. 공시제외로 건너뛴 학교는 `SI._state.failed` 에서 읽어
   `achievement-skipped.json` 에 추가.
5. 끝나면 `node build-catalog.mjs` → `frontend/public/data/school-catalog.json.gz` 갱신 → 커밋·푸시(원본 포함).
   아티팩트(HTML 단독 페이지) 갱신은 이 저장소를 처음 만든 세션에서만 같은 URL 로 재발행되므로, 다른 PC 에서는
   `standalone/` 를 새 아티팩트로 올리거나 학원 PC 세션에 맡긴다.

진행 현황(2026-09-20): **전국 완료** — 고교 2,283 + 중학 3,413 = 5,696곳 수집, 공시제외(신설·'입력된 데이터가 없습니다') 236곳 → 학교 목록 5,932곳 전부 처리.
집 PC 수집분은 `achievement-raw-<지역>-<날짜>.json`(`{exportedAt, count, records[]}`) 묶음으로 넘어와 학교당 파일로 풀어 넣었다.

## 정기 자동 갱신 (보안문자 없는 부분만)

`.github/workflows/schoolinfo-refresh.yml` — 3·6·9·12월 1일 03:00 KST 자동 + GitHub Actions 탭에서 수동 실행(Run workflow).
1. `fetch-school-list.mjs` → 2. `fetch-school-info.mjs --refresh`(24h 내 받은 건 건너뜀) → 3. `ci-changed.mjs` 로 fetchedAt 외에
실제 바뀐 게 있는지 판정 → 있으면 `build-catalog.mjs` 후 `out/school-list.json`·`out/school-info.json`·`frontend/public/data/` 커밋·푸시
→ Vercel 배포. 바뀐 게 없으면 아무것도 안 한다. 성취도(`achievement-raw/`)는 손대지 않는다(아래 알림 참고).

## 새 공시 알림 (자동 갱신 대신)

성취도는 자동 갱신이 안 되므로, 대신 **새 공시가 올라오면 입시파인더 대시보드·공시정보 화면에 배너**가 뜬다.
- 백엔드 `GET /api/schoolinfo/disclosure` — 학교 공시 팝업(인증 없음)의 `<select id="gsYear">` 최신값을 하루 1회 읽는다(24h 캐시).
- `frontend/public/data/school-catalog-meta.json` — 지금 실린 공시 연도(`disclosureYear`). `build-catalog.mjs` 가 catalog 와 같이 만든다.
- `DisclosureNotice.jsx` — 최신값 > disclosureYear 면 "N년 공시가 올라왔습니다", 조회가 안 되는 날엔 다음 해 5월 1일 이후에만
  "공시 시기입니다" 로 약하게 안내. ✕ 로 닫으면 그 연도 배너만 숨김(localStorage).
배너가 뜨면 위 '갱신 절차'대로 다시 수집하면 된다(학교알리미 정기 공시는 보통 5월 말).

## 입시 해설 보고서 (2026-09-20)

상세·비교 모달의 `🧭 입시 해설 생성` → 백엔드 `/api/schoolinfo/explain`(AI 본문) + `schoolReportData.buildReportData`(수치 블록 `data`).
- `data` = 학교 카드(재적·1등급 자리·학급·교원) + 국·영·수 학년별 A~E 분포. **AI 가 아니라 catalog 수치로 결정론적으로** 만들고
  PDF(`pdfService._drawReportData`)·Word(`docxService.reportDataChildren`)·화면(`SchoolReport.jsx ReportVisual`)·나만의 패파(`ReportVisual.tsx`)가
  같은 순서·색(A 청록·B 파랑·C 보라·D 노랑·E 빨강, 학교색 4개)으로 그린다. AI 본문은 해석만(원자료 표·HTML 금지).
- 보관: `ef_school_reports`(선생님별, `snapshot.data`, 전송 이력 `sent`). 내보내기: `/api/school-reports/export` (docx·pdf).
- 학부모 전송: `📨 학부모에게 보내기` → `/api/school-reports/send` → 나만의 패파 `POST /api/inbound/report` `{student_name, title, md, data, audience, memo}`
  → 그 학생의 성장 리포트(payload.kind='doc') + 알림. 서버 환경변수 `ACADEMY_VIDEO_INBOUND_KEY`(나만의 패파 선생님 대시보드 '연동 열쇠'),
  `ACADEMY_VIDEO_URL`(기본 https://academy-video.vercel.app).

## 출력 파일 구조 (2026-09-20 부터)

2026년 공시 표는 국·영·수 외 전 과목이 들어와 밴드가 학교당 ~76줄(전국 45만 줄, JSON 84MB) 이라 한 파일로는 못 싣는다.
- `frontend/public/data/school-catalog.json.gz` (2.8MB) — 학교별 `bands` 는 **국·영·수만**. 목록·정렬·비교 화면은 이것만 쓴다.
- `frontend/public/data/school-bands/<h|m><시도번호>.json.gz` (32개, 7.2MB) — 전 과목 표 `{ [school.id]: bands[] }`.
  학교 항목의 `bandsFile` 이 경로. 상세 모달이 열릴 때 그 시도 파일만 받아 캐시한다(`SchoolInfo.jsx` `loadFullBands`).
- 중학교 표는 계열 칸이 없는 13칸(`[과목, 1학기 평균, A~E, 2학기 평균, A~E]`) — `parse-achievement.mjs` 가 헤더로 구분한다.
- 종합고(일반계+상업계 등)는 `과목 [일반계 / 전체학과]` 처럼 계열별 줄만 있고 전체 줄이 없다(493곳). 목록 카드의 대표값은
  전체계열 → 일반계 → 나머지 순으로 고른다(`pickBand`).
