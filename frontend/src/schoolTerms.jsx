import { useState } from 'react';

// 공시정보·설명회 화면의 낱말 풀이 — 점선 밑줄 낱말을 누르면 뜻이 뜬다. 학부모님께 화면을 그대로 보여 줘도 읽히게.
export const GLOSSARY = {
  'A 비율': '그 과목에서 성취도 A(보통 90점 이상)를 받은 학생의 비율입니다. 성취도는 절대평가라 시험이 쉬우면 A가 많아지고, 어려우면 적어집니다.',
  'A 난이도': '그 학교에서 A 받기가 전국 일반고(자율형 공립고 포함) 가운데 얼마나 어려운지입니다. "어려운 쪽 상위 10%"면 A 비율이 이 학교보다 낮은 학교가 전국에 10%뿐이라는 뜻 — A가 드물어 받기 어렵지만, 받으면 대학이 무겁게 읽습니다(대학은 성취도를 A 비율과 함께 봅니다). 쉬운 학교는 A를 받기 쉬운 대신 A만으로는 눈에 덜 띕니다.',
  '1등급 자리': '5등급제에서 1등급은 그 과목 수강자의 상위 10%입니다. 1학년 학생 수 × 10% 로 어림합니다. 수강자가 적은 선택과목은 1등급이 한두 명뿐일 수 있습니다.',
  '석차등급': '같은 과목을 들은 학생 사이의 상대평가입니다. 5등급제 누적 비율: 1등급 10% · 2등급 34% · 3등급 66% · 4등급 90% · 5등급 100%.',
  '성취도': '점수를 A·B·C·D·E 다섯 단계로 나눈 절대평가 성적입니다. 체육·예술·일부 진로선택은 A·B·C 세 단계만 씁니다.',
  '상대 표준편차': '2025학년도부터 공시에 표준편차가 빠져, A~E에 5~1점을 매겨 분포의 흩어짐을 계산한 값입니다. 실제 표준편차는 아닙니다.',
  '학교 층': '학생을 어디서 뽑느냐에 따른 묶음입니다. 거주지 일반고(일반고·자율형 공립고), 시도 단위(외고·국제고·과학고·예고·체고·광역 자사고), 전국 단위(영재학교·전국 자사고), 특성화·마이스터고. 뽑는 범위가 다르면 학생 집단도 달라 따로 봅니다.',
  '평준화': '원하는 학교를 적어 내면 추첨으로 배정하는 지역입니다. 같은 학군 안의 학교끼리만 지원할 수 있습니다. 비평준화 지역은 학교마다 중학교 내신으로 선발합니다.',
  '학군': '평준화 지역에서 함께 지원할 수 있게 묶은 학교들입니다. 사는 곳에 따라 학군이 정해지고 그 안의 학교 중에서 배정받으므로, 같은 학군 학교끼리 비교합니다.',
  '쏠림': '이 학교 평균이 함께 본 학교들 평균보다 얼마나 높은지입니다. 높으면 성적이 좋은 학생이 몰렸거나 시험이 쉬웠다는 뜻이라, 같은 실력이라도 교내 등수가 조금 내려갈 수 있습니다.',
  '편제': '학교가 3년 동안 어떤 과목을 몇 학년·몇 학기에 몇 학점으로 가르치는지 정한 교육과정 편제표입니다. 학교마다 달라 듣고 싶은 과목이 열리는지 확인해야 합니다.',
  '권장과목': '대학이 모집단위별로 "고교에서 들어 두면 좋은 과목"으로 발표한 과목입니다. 핵심과목은 이수를 강하게 권하는 과목, 권장과목은 이수하면 도움이 되는 과목입니다. 지원 자격은 아니고 평가 참고 자료입니다.',
  '융합선택': '여러 분야를 섞은 선택과목입니다. 사회·과학 융합선택 과목은 석차등급 없이 성취도(A~E)만 기록됩니다.',
  '공동교육과정': '우리 학교에 없는 과목을 다른 학교와 함께 열거나 온라인학교로 듣는 제도입니다. 대학은 "학교에 없어서 못 들은 것"과 "있는데 안 들은 것"을 구분해 봅니다.',
};

// A 난이도 단계 — pct = 전국에서 A 비율이 이 학교 이하인 학교 비율(낮을수록 A가 드묾 = 어려움). 화면은 '어려운 쪽 상위 pct%'로 읽는다.
export function aDifficulty(pct) {
  if (pct === null || pct === undefined) return null;
  const [label, color] = pct <= 10 ? ['매우 어려움', '#dc2626'] : pct <= 30 ? ['어려움', '#ea580c'] : pct <= 70 ? ['보통', '#6b7280'] : pct <= 90 ? ['쉬움', '#2563eb'] : ['매우 쉬움', '#0891b2'];
  return { pct, label, color, text: `어려운 쪽 상위 ${pct}%` };
}

/** <Term k="A 비율" /> 또는 <Term k="A 비율">A</Term> — 점선 밑줄 + 누르면 풀이 */
export function Term({ k, children }) {
  const [open, setOpen] = useState(false);
  const text = GLOSSARY[k];
  if (!text) return children ?? k;
  return (
    <span style={{ position: 'relative', display: 'inline' }}>
      <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}
        style={{ borderBottom: '1px dotted currentColor', cursor: 'help' }} title={text}>
        {children ?? k}<sup style={{ fontSize: '0.7em', marginLeft: 1, opacity: 0.7 }}>ⓘ</sup>
      </span>
      {open && (
        <span onClick={(e) => { e.stopPropagation(); setOpen(false); }}
          style={{ position: 'absolute', zIndex: 50, top: '1.6em', left: 0, width: 280, background: 'var(--surface, #1e2a36)', color: 'var(--text, #e8eef3)', border: '1px solid var(--border, #3a4a5a)', borderRadius: 8, padding: '8px 10px', fontSize: 12, fontWeight: 400, lineHeight: 1.55, boxShadow: '0 6px 18px rgba(0,0,0,.35)', whiteSpace: 'normal', textAlign: 'left' }}>
          <b>{k}</b><br />{text}
        </span>
      )}
    </span>
  );
}

// ── 학교 층 — 뽑는 범위가 다른 학교끼리는 한 줄로 비교하지 않는다 ──
// 전국 단위 자사고·영재학교는 이름 목록으로 가른다(학교알리미 유형만으로는 광역·전국 자사고가 구분되지 않음).
const NATIONAL_JASA = ['민족사관고등학교', '상산고등학교', '하나고등학교', '용인한국외국어대학교부설고등학교', '포항제철고등학교', '광양제철고등학교', '김천고등학교', '현대청운고등학교', '인천하늘고등학교'];
const GIFTED = ['서울과학고등학교', '경기과학고등학교', '대구과학고등학교', '대전과학고등학교', '광주과학고등학교', '한국과학영재학교', '세종과학예술영재학교', '인천과학예술영재학교'];
export const LAYERS = [
  { key: 'local', label: '거주지 일반고', hint: '일반고·자율형 공립고' },
  { key: 'region', label: '시도 단위', hint: '외고·국제고·과학고·예고·체고·광역 자사고' },
  { key: 'national', label: '전국 단위', hint: '영재학교·전국 자사고' },
  { key: 'vocational', label: '특성화·마이스터', hint: '특성화고·마이스터고' },
];
export function layerOf(s) {
  const n = String(s.schoolName || '').replace(/\s+/g, '');
  if (GIFTED.includes(n) || /영재학교$/.test(n)) return 'national';
  if (NATIONAL_JASA.includes(n) || (n === '북일고등학교' && s.sido === '충청남도')) return 'national';
  if (s.schoolType === '특성화고등학교') return 'vocational';
  // 특목고 가운데 외고·국제고·과학고·예고·체고가 아니면 산업수요 맞춤형(마이스터고)
  if (s.schoolType === '특수목적고등학교' && !/외국어|국제|과학|예술|체육|영재/.test(n)) return 'vocational';
  if (s.schoolType === '일반고등학교' || (s.schoolType === '자율고등학교' && s.fond === '공립')) return 'local';
  return 'region';
}
/** 학생 성별로 지원 가능한지 — 남학생은 여고 제외, 여학생은 남고 제외 */
export function genderOk(s, student) {
  if (student === '남학생') return s.gender !== '여자';
  if (student === '여학생') return s.gender !== '남자';
  return true;
}

// ── 평준화 학군 — 같은 학군 안의 학교끼리만 지원·배정된다(선복수지원-후추첨) ──
// 출처를 확인한 시도만 넣는다. 경기: 2027학년도 고교 평준화 배정 방안(경기도교육청, 2026-09 발표) — 9개 학군·12개 시.
//   수원·성남·안양권·고양·안산·용인 = 1단계 학군내배정 + 2단계 구역내배정, 부천·광명·의정부 = 학군내배정만.
// 학군에 없는 시군은 비평준화(학교별 선발). 다른 시도는 공식 배정 방안을 확인한 뒤 같은 모양으로 추가할 것.
export const DISTRICTS = {
  경기도: {
    source: '경기도교육청 「2027학년도 고교 평준화 배정 방안」(2026-09)',
    list: [
      { name: '수원', sigungu: ['수원시'], step2: true },
      { name: '성남', sigungu: ['성남시'], step2: true },
      { name: '안양권', sigungu: ['안양시', '과천시', '군포시', '의왕시'], step2: true },
      { name: '고양', sigungu: ['고양시'], step2: true },
      { name: '안산', sigungu: ['안산시'], step2: true },
      { name: '용인', sigungu: ['용인시'], step2: true },
      { name: '부천', sigungu: ['부천시'] },
      { name: '광명', sigungu: ['광명시'] },
      { name: '의정부', sigungu: ['의정부시'] },
    ],
  },
};
/** 학교가 속한 평준화 학군(없으면 null — 비평준화이거나 아직 표가 없는 시도) */
export function districtOf(s) {
  const d = DISTRICTS[s.sido];
  return d ? d.list.find((x) => x.sigungu.includes(s.sigungu)) || null : null;
}
