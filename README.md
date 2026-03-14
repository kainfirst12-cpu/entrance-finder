# 입시-Finder — 패스파인더 에듀

Google Drive 지식베이스 기반 AI 입시 컨설팅 앱

---

## 📁 폴더 구조

```
entrance-finder/
├── backend/
│   ├── server.js              # Express 서버 (메인)
│   ├── services/
│   │   ├── driveService.js    # Google Drive API
│   │   ├── claudeService.js   # Claude AI 8단계 분석
│   │   └── notionService.js   # Notion 자동 저장
│   └── .env.example           # 환경변수 예시
└── frontend/
    ├── src/
    │   ├── App.jsx             # 메인 앱
    │   ├── App.css             # 전체 스타일
    │   └── components/
    │       ├── StudentForm.jsx      # 학생 입력 폼
    │       ├── AnalysisProgress.jsx # 분석 진행 화면
    │       ├── AnalysisResult.jsx   # 분석 결과 화면
    │       └── StudentList.jsx      # 학생 목록
    └── index.html
```

---

## 🚀 실행 방법

### 1단계 — 환경변수 설정

```bash
cd backend
cp .env.example .env
# .env 파일 열어서 아래 값 입력:
```

```env
ANTHROPIC_API_KEY=sk-ant-xxxxxxxx         # Claude API 키
GOOGLE_SERVICE_ACCOUNT_EMAIL=finder-bot@entrance-exam-finder.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_DRIVE_KNOWLEDGE_FOLDER_ID=여기에_지식베이스_폴더ID
GOOGLE_DRIVE_STUDENTS_FOLDER_ID=여기에_학생별_폴더ID
NOTION_API_KEY=secret_xxxxxxxx
NOTION_DATABASE_ID=313b9df57c2e808f9257f6ca644a675a
```

> GOOGLE_PRIVATE_KEY 입력 방법:
> JSON 키 파일에서 "private_key" 값을 그대로 복사
> 줄바꿈(\n)이 실제 문자로 들어가도 됩니다

### 2단계 — Drive 폴더 ID 확인

Google Drive에서 각 폴더 열기 → 주소창 URL의 마지막 부분이 ID
```
drive.google.com/drive/folders/1ABC123XYZ   ← 이 부분
```

### 3단계 — 백엔드 실행

```bash
cd backend
npm install
node server.js
```

서버 실행 확인:
```
🚀 입시-Finder 서버 실행 중: http://localhost:3001
📁 Drive 연결 테스트: http://localhost:3001/api/drive/test
```

브라우저에서 http://localhost:3001/api/drive/test 접속해서
Drive 연결 확인!

### 4단계 — 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev
```

http://localhost:3000 에서 앱 확인

---

## 📋 사용 방법

1. 앱 접속 → **새 분석 시작** 클릭
2. 학생 정보 4탭 입력
3. **AI 분석 시작** 클릭
4. 9단계 분석 진행 (약 2-3분)
5. 결과 확인 → **Notion에서 보기** 클릭

---

## 🗂️ Google Drive 폴더 구조

```
📁 입시-Finder/
├── 📂 01_대입정책/          ← 2029 개편안, 고교학점제 자료
├── 📂 02_대학별전형/        ← 서울대·연세대 등 전형 분석
├── 📂 03_합격자사례/        ← 합격자 생기부 (txt 파일)
└── 📂 학생별/
      └── 📂 홍길동_2026/   ← 학생 이름으로 폴더 생성
```

> 파일 형식: .txt 권장 (PDF, DOCX도 가능)
> 합격자 생기부는 txt로 변환해서 저장하면 AI가 바로 참조

---

## 🔧 문제 해결

**Drive 연결 오류:**
- Service Account JSON 키의 private_key에 실제 줄바꿈 포함 여부 확인
- Drive 폴더 공유 시 Service Account 이메일로 뷰어 권한 부여 확인

**Notion 저장 오류:**
- Integration이 해당 데이터베이스에 연결됐는지 확인
- Database ID 오타 확인 (하이픈 없는 32자리)

**분석 오류:**
- ANTHROPIC_API_KEY 유효성 확인
- 네트워크 연결 확인
