// 학교별 개설 과목 — 2026 나이스 시간표에서 실제로 수업한 과목(scripts/neis/build-courses.mjs).
//
// 읽는 법(2027 입학생 기준으로 '이 학교에서 들을 수 있나'):
//   · 2026 2학년 = 2022 개정(2025 입학생) → 2학년 시간표에 있으면 ✓(실제 수업 중).
//   · 2026 3학년 = 아직 2015 개정(2024 입학생) → 2022 과목명이 없다. 같은 계열 2015 과목(예: 미적분Ⅱ ← 미적분, 역학과 에너지 ← 물리학Ⅱ)이
//     3학년에 있으면 '3학년 개설 가능성'으로만 표시한다(확정 아님). 2022 개정 3학년 편제는 2027 에 처음 열린다.
//   · 시간표에 없다고 개설이 안 되는 것은 아니다 — 수강 신청이 적으면 안 열리고, 반대로 편제표에만 있고 실제로는 안 열리기도 한다.
import { fetchGzJson } from '../schoolCatalog';

let p = null;
export function loadOfferings() {
  if (!p) p = fetchGzJson('/data/school-courses-2026.json.gz').catch(() => { p = null; return null; });
  return p;
}

const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/Ⅰ|I(?=$)/g, '1').replace(/Ⅱ|II(?=$)/g, '2').replace(/·|ㆍ/g, '');
// 2022 과목 → 같은 계열 2015 과목(2026 3학년 시간표에서 찾을 이름)
const LEGACY = {
  미적분Ⅱ: ['미적분'], 기하: ['기하'], '확률과 통계': ['확률과 통계'], '경제 수학': ['경제 수학'], '인공지능 수학': ['인공지능 수학'],
  '역학과 에너지': ['물리학Ⅱ'], '전자기와 양자': ['물리학Ⅱ'], '물질과 에너지': ['화학Ⅱ'], '화학 반응의 세계': ['화학Ⅱ'],
  '세포와 물질대사': ['생명과학Ⅱ'], '생물의 유전': ['생명과학Ⅱ'], 지구시스템과학: ['지구과학Ⅱ'], 행성우주과학: ['지구과학Ⅱ'],
  정치: ['정치와 법'], '법과 사회': ['정치와 법'], 경제: ['경제'], '윤리와 사상': ['윤리와 사상'], '사회와 문화': ['사회·문화'],
  세계사: ['세계사'], '동아시아 역사 기행': ['동아시아사'], '한국지리 탐구': ['한국지리'], '심화 영어': ['심화 영어Ⅰ', '심화영어'],
  '영미 문학 읽기': ['영미 문학 읽기'], '인공지능 기초': ['인공지능 기초'], '과학과제 연구': ['과학과제 연구'],
};

/** 한 학교에서 과목 하나의 상태 → { mark: 'yes'|'maybe'|'no'|'unknown', text } */
export function offerStatus(school, subject) {
  if (!school) return { mark: 'unknown', text: '확인 불가' };
  const has = (list, name) => list.some((t) => norm(t) === norm(name));
  if (has(school.g2, subject)) return { mark: 'yes', text: '✓ 2학년 수업 중' };
  if (has(school.g3, subject)) return { mark: 'yes', text: '✓ 3학년 수업 중' };
  const legacy = (LEGACY[subject] || []).find((l) => has(school.g3, l));
  if (legacy) return { mark: 'maybe', text: `3학년 가능성 (2015 ‘${legacy}’ 운영 중)` };
  return { mark: 'no', text: '2026 시간표엔 없음' };
}
export const MARK_COLOR = { yes: '#16a34a', maybe: '#d6a24a', no: '#9ca3af', unknown: '#9ca3af' };

// 공시정보 화면 '듣고 싶은 과목' 후보 — 진로 설계에서 자주 갈리는 2·3학년 선택과목
export const PICKABLE = ['미적분Ⅱ', '기하', '확률과 통계', '경제 수학', '인공지능 수학', '역학과 에너지', '전자기와 양자', '물질과 에너지', '화학 반응의 세계',
  '세포와 물질대사', '생물의 유전', '지구시스템과학', '행성우주과학', '경제', '정치', '법과 사회', '윤리와 사상', '국제 관계의 이해', '심화 영어',
  '영어 발표와 토론', '인공지능 기초', '데이터 과학', '한문', '과학과제 연구'];
