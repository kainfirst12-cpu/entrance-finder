# 면접 공식 기출 은행 수집 파이프라인

출처: 울산진로진학지원센터 대입자료실(use.go.kr, q_bbsSn=1095)에 대학별로 올라오는
**선행학습 영향평가 자체평가보고서**(대학이 법에 따라 공개하는 문서). 사설 후기 모음은 넣지 않는다.

작업 폴더는 저장소 밖(`C:\tmp\interview-bank`) — PDF 수백 MB 와 중간 JSON 이 쌓인다. 이 폴더의 스크립트를 거기로 복사해 쓴다.

1. `use-rows.json` — 게시판 목록(제목·docNo). 목록 HTML 을 긁어 만든다(q_rowPerPage=300).
2. `node crawl.mjs 2026,2025` → `manifest.json`(첨부 파일 목록)
3. `node download.mjs` → `pdf/`
4. `python extract.py` → `text/`(쪽별 텍스트), `stats.json`
5. `python chunks.py` → `chunks.json`(문항 후보 쪽 묶음), `python ctx.py` → `ctx.json`(문서별 요약표·언급 횟수)
6. `node batch.mjs submit` → `status` → `fetch` → `results.json` (Claude Batch, 반값). `.env` 에 ANTHROPIC_API_KEY
7. `node normalize.mjs` → `backend/data/interview-bank/questions.json`

새 학년도 보고서가 올라오면(매년 4월 초) 1~7 을 다시 돌린다. 같은 대학·같은 질문은 최신 학년도 하나만 남는다.
⚠️ 서울대처럼 보고서 본문에 문항 원문 없이 출제의도·분석만 싣는 대학은 문항이 0개로 나온다(정상).
