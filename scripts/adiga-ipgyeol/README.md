# 어디가 입결 데이터 파이프라인 (입결 콘솔용)

`backend/data/adiga/ipgyeol/` 의 216개 대학 입결 시계열(2021~2026)을 만드는 스크립트.

## 데이터 출처
- **2021~2025**: 어디가 공식 발표자료 취합 엑셀 — Google Drive의 `2025~2021_수시입결과.xlsx` (약 6.7MB).
  스크립트와 같은 폴더(또는 작업 폴더)에 `susi-2021-2025.xlsx` 이름으로 두고 실행.
- **2026(최신)**: 어디가 신규 '대학별 입시결과' 서비스 `classUnivAdmssPopupAjax.do` 스크랩.
  ⚠️ 이 서비스는 **최신 연도만** 실데이터를 반환한다(과거 연도는 0으로 채워진 빈 행).

## 사용법 (매년 새 입결 발표 후 갱신)
```bash
npm install cheerio xlsx   # 의존성 (작업 폴더에서)

node scrape-ipgyeol.mjs        # 전체 218개 대학 수집 → out/ipgyeol-raw/<unvCd>.json (재실행 시 이어받기)
node normalize-ipgyeol.mjs     # 엑셀 + 스크랩 병합 → backend/data/adiga/ipgyeol/ + ipgyeol-index.json
```
- 스크립트 상단의 경로(`C:/Users/kainf/entrance-finder/...`)는 환경에 맞게 수정.
- 새 연도 추가 시: scrape의 `YEARS`를 새 연도로, normalize의 `SHEETS`에 새 엑셀 시트 매핑 추가.

## 주의
- 엑셀 축약 대학명 → 어디가 unvCd 매핑은 normalize의 `ALIAS`(개명: 안동대→국립경국대 등) /
  `SHORT_CAMPUS`(캠퍼스 힌트) 테이블. 미매칭 대학명은 실행 후 콘솔에 출력됨(한려대는 폐교라 제외).
- 연도별 학생부 총점 척도가 다름(900/1000 등) — 환산점수 절대값의 연도 간 비교 금지, 득점률(pct70) 사용.
- 갱신 후 `git add backend/data/adiga` 시 `.gitignore`의 `*.json` 화이트리스트(`!backend/data/adiga/ipgyeol/*.json`)가
  이미 있으므로 그대로 커밋되면 정상.
