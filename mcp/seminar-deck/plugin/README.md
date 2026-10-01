# 설명회 자료 만들기 (seminar-deck)

입시파인더의 📽️ 설명회 자료 만들기를 Claude Code·Cowork 에서 말로 쓰는 플러그인입니다.

> "부천여고, 상동고, 송내고 담당학교로 2027 고입설명회 자료 만들어줘"

- 담당 고등학교의 학교알리미 1학년 성취도(A~E)를 서로 비교해 학교별 분석 · 과목별 비교 차트 · 유형 분류 슬라이드를 만듭니다.
- 입시파인더에 발행된 ① 제도 설명 공통본, 우리 학원의 ③ 학원 소개, 표지·목차·감사(연락처)까지 붙여 **편집 가능한 PPT** 로 저장합니다.
- 학부모님께 보낼 **공유 링크**(로그인 없이 휴대폰으로 보기)도 만듭니다.
- 해설 문구는 Claude 가 분석 수치를 보고 직접 씁니다(별도 AI 키 불필요).

## 필요한 것
- Node.js 20 이상 (설치 확인: 명령창에서 `node -v`)
- 입시파인더 **학원 코드** — 그 코드에 설명회 메뉴가 열려 있어야 합니다(입시파인더 관리자가 엽니다).

## 처음 한 번
Claude 에게 "설명회 자료 상태 확인해줘"라고 하면 학원 코드를 묻습니다. 넣은 코드는 이 컴퓨터의 `사용자 폴더\.seminar-deck\config.json` 에만 저장됩니다.
학원 이름·로고는 "표지에 우리 학원 이름은 ○○, 로고는 C:\...\logo.png 로 해줘"라고 말하면 저장합니다.

## 도구
seminar_status · seminar_login · set_brand · find_schools · region_schools · analyze_schools · list_decks · get_deck · save_deck · build_pptx · share_link

PPT 기본 저장 폴더: `문서\설명회자료` (set_brand 의 out_dir 로 바꿀 수 있음)
