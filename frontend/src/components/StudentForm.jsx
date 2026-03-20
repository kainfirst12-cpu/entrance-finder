// src/components/StudentForm.jsx
import { useState } from 'react';

const GRADES = ['고1', '고2', '고3', 'N수'];
const MAJORS = [
  // 공학계열
  '컴퓨터공학/SW', '전기/전자공학', '기계/로봇공학',
  '화학/신소재공학', '산업/시스템공학', '건축/토목공학',
  '에너지/환경공학', '생명공학/바이오',
  // 자연과학
  '수학/통계', '물리학', '화학', '생명과학', '지구/해양과학',
  // 의약학
  '의학/의예과', '치의학/치의예과', '한의학/한의예과',
  '약학', '수의학', '간호학',
  // 인문사회
  '경영/경제', '법학', '행정/정치외교', '심리학',
  '사회학/사회복지', '언론/미디어', '국어국문/문학',
  '영어영문/외국어', '사학/철학',
  // 교육
  '사범/교육', '유아교육', '특수교육',
  // 예체능
  '미술/디자인', '음악', '체육', '연극/영화',
  // 기타
  '농업/식품', '해양/수산', '항공/우주', '국제학', '자유전공/학부', '기타',
];

const PdfUploader = ({ label, fileKey, files, onChange, hint }) => {
  const file = files[fileKey];
  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.type !== 'application/pdf') return alert('PDF 파일만 업로드 가능해요!');
    if (f.size > 20 * 1024 * 1024) return alert('파일 크기는 20MB 이하만 가능해요!');
    onChange(fileKey, f);
  };
  const remove = () => onChange(fileKey, null);
  return (
    <div className="pdf-uploader">
      <div className="pdf-label">{label}</div>
      {hint && <div className="pdf-hint">{hint}</div>}
      {file ? (
        <div className="pdf-file-row">
          <span className="pdf-icon">📄</span>
          <span className="pdf-filename">{file.name}</span>
          <span className="pdf-size">({(file.size/1024/1024).toFixed(1)}MB)</span>
          <button className="pdf-remove" onClick={remove}>✕</button>
        </div>
      ) : (
        <label className="pdf-drop-zone">
          <input type="file" accept=".pdf" onChange={handleFile} style={{display:'none'}} />
          <span className="pdf-upload-icon">📎</span>
          <span>클릭해서 PDF 업로드</span>
          <span className="pdf-limit">최대 20MB</span>
        </label>
      )}
    </div>
  );
};

export default function StudentForm({ onSubmit, onCancel }) {
  const [form, setForm] = useState({
    name:'', grade:'고1', school:'', region:'',
    major:'컴퓨터공학/SW', targetUniv:'',
    gpa:'', mockExam:'',
    club:'', volunteer:'', leadership:'',
    awards:'', talent:'', interests:'',
    specialNotes:'', subjectPlan:'',
  });
  const [files, setFiles] = useState({
    recordPdf: null,
    gradePdf: null,
    awardsPdf: null,
    mockExamPdf: null,
  });
  const [tab, setTab] = useState(0);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));
  const input = (k) => ({ value:form[k], onChange:(e)=>set(k,e.target.value) });
  const setFile = (k,v) => setFiles(f=>({...f,[k]:v}));
  const tabs = ['기본 정보','성적 정보','비교과 활동','생기부 & 세특'];
  const uploadedCount = Object.values(files).filter(Boolean).length;

  const handleSubmit = () => {
    if (!form.name) return alert('학생 이름을 입력해주세요.');
    if (!form.targetUniv) return alert('목표 대학을 입력해주세요.');
    onSubmit(form, files);
  };

  return (
    <div className="form-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">새 분석 시작</h1>
          <p className="page-desc">학생 정보를 입력하면 Drive 자료 기반 AI 분석이 시작됩니다
            {uploadedCount > 0 && <span className="upload-badge"> · PDF {uploadedCount}개 업로드됨</span>}
          </p>
        </div>
        <button className="btn-ghost" onClick={onCancel}>취소</button>
      </div>
      <div className="tabs">
        {tabs.map((t,i)=>(
          <button key={i} className={`tab ${tab===i?'active':''}`} onClick={()=>setTab(i)}>
            <span className="tab-num">{i+1}</span> {t}
          </button>
        ))}
      </div>
      <div className="form-card">
        {tab===0 && (
          <div className="form-grid">
            <div className="field"><label>학생 이름 *</label><input placeholder="홍길동" {...input('name')} /></div>
            <div className="field"><label>학년</label>
              <select value={form.grade} onChange={e=>set('grade',e.target.value)}>
                {GRADES.map(g=><option key={g}>{g}</option>)}
              </select>
            </div>
            <div className="field"><label>학교명</label><input placeholder="○○고등학교" {...input('school')} /></div>
            <div className="field"><label>지역</label><input placeholder="부천 / 서울 / 경기" {...input('region')} /></div>
            <div className="field full"><label>희망 전공 계열</label>
              <select value={form.major} onChange={e=>set('major',e.target.value)}>
                {MAJORS.map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="field full"><label>목표 대학 (상향 기준) *</label>
              <input placeholder="예: 서울대학교 / 연세대학교 / KAIST" {...input('targetUniv')} />
            </div>
          </div>
        )}
        {tab===1 && (
          <div className="form-grid">
            <div className="field"><label>내신 평균 등급</label>
              <input type="number" min="1" max="9" step="0.1" placeholder="예: 1.8" {...input('gpa')} />
            </div>
            <div className="field"><label>모의고사 등급 (국/수/영/탐)</label>
              <input placeholder="예: 1/1/2/1" {...input('mockExam')} />
            </div>
            <div className="field full"><label>과목 선택 계획</label>
              <textarea placeholder="예: 고2 - 미적분Ⅰ, 기하, 물리학Ⅰ&#10;고3 - 미적분Ⅱ, 과제연구" {...input('subjectPlan')} rows={3} />
            </div>
            <div className="field full">
              <label>📎 성적 관련 PDF 업로드</label>
              <div className="pdf-grid">
                <PdfUploader label="성적표 PDF" fileKey="gradePdf" files={files} onChange={setFile} hint="내신 성적표" />
                <PdfUploader label="모의고사 성적 PDF" fileKey="mockExamPdf" files={files} onChange={setFile} hint="최근 모의고사 결과" />
              </div>
            </div>
          </div>
        )}
        {tab===2 && (
          <div className="form-grid">
            <div className="field full"><label>동아리 활동</label>
              <textarea placeholder="예: 과학동아리 (3년, 로봇 제작)" {...input('club')} rows={2} />
            </div>
            <div className="field full"><label>봉사활동</label>
              <textarea placeholder="예: 수학 멘토링 (30시간)" {...input('volunteer')} rows={2} />
            </div>
            <div className="field full"><label>리더십 경험</label>
              <textarea placeholder="예: 학급 부반장, 동아리 부장" {...input('leadership')} rows={2} />
            </div>
            <div className="field full"><label>수상 경력</label>
              <textarea placeholder="예: 수학경시대회 대상, 과학탐구대회 금상" {...input('awards')} rows={2} />
            </div>
            <div className="field"><label>특기/재능</label>
              <input placeholder="예: 아두이노, 3D 모델링" {...input('talent')} />
            </div>
            <div className="field"><label>관심 탐구 분야</label>
              <input placeholder="예: 자율주행 로봇, AI" {...input('interests')} />
            </div>
            <div className="field full">
              <label>📎 수상내역 PDF 업로드</label>
              <PdfUploader label="수상내역 PDF" fileKey="awardsPdf" files={files} onChange={setFile} hint="수상 내역 정리 파일 (선택사항)" />
            </div>
          </div>
        )}
        {tab===3 && (
          <div className="form-grid">
            <div className="field full">
              <label>📄 생기부 원본 PDF 업로드 (권장)</label>
              <div className="info-box full" style={{marginBottom:'12px',background:'var(--blue-bg)'}}>
                🤖 PDF를 업로드하면 AI가 직접 읽고 분석해요. 텍스트 입력보다 훨씬 정확해요!
              </div>
              <PdfUploader label="생기부 원본 PDF" fileKey="recordPdf" files={files} onChange={setFile} hint="학교생활기록부 전체 PDF" />
            </div>
            <div className="field full">
              <div className="divider-text">또는 직접 텍스트 입력</div>
            </div>
            <div className="field full">
              <label>세특 주요 내용 (PDF 없을 경우)</label>
              <textarea
                placeholder="PDF가 없는 경우 세특 내용을 직접 붙여넣기 해주세요.&#10;[수학] 정수론 탐구 중 페르마 소정리를..."
                {...input('specialNotes')}
                rows={10}
              />
            </div>
          </div>
        )}
      </div>
      <div className="form-footer">
        <div className="form-nav">
          <button className="btn-ghost" onClick={()=>setTab(t=>Math.max(0,t-1))} disabled={tab===0}>← 이전</button>
          {tab<3
            ? <button className="btn-primary" onClick={()=>setTab(t=>t+1)}>다음 →</button>
            : <button className="btn-analyze" onClick={handleSubmit}>🚀 AI 분석 시작</button>
          }
        </div>
      </div>
    </div>
  );
}
