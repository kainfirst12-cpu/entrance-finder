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
