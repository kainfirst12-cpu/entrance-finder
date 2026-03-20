import { useState } from 'react';

const GRADES = ['고1','고2','고3'];
const MAJORS = [
  '컴퓨터공학/SW', '전기/전자공학', '기계/로봇공학',
  '화학/신소재공학', '산업/시스템공학', '건축/토목공학',
  '에너지/환경공학', '생명공학/바이오',
  '수학/통계', '물리학', '화학', '생명과학', '지구/해양과학',
  '의학/의예과', '치의학/치의예과', '한의학/한의예과',
  '약학', '수의학', '간호학',
  '경영/경제', '법학', '행정/정치외교', '심리학',
  '사회학/사회복지', '언론/미디어', '국어국문/문학',
  '영어영문/외국어', '사학/철학',
  '사범/교육', '유아교육', '특수교육',
  '미술/디자인', '음악', '체육', '연극/영화',
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
          <span className="pdf-icon">PDF</span>
          <span className="pdf-filename">{file.name}</span>
          <span className="pdf-size">({(file.size/1024/1024).toFixed(1)}MB)</span>
          <button className="pdf-remove" onClick={remove}>X</button>
        </div>
      ) : (
        <label className="pdf-drop-zone">
          <input type="file" accept=".pdf" onChange={handleFile} style={{display:'none'}} />
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
  const tabs = ['기본 정보','생기부 & 자료 업로드'];
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
          <p className="page-desc">기본 정보 입력 + 생기부 PDF 업로드만 하면 AI가 자동 분석합니다
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
            <div className="field"><label>학교명</label><input placeholder="OO고등학교" {...input('school')} /></div>
            <div className="field"><label>지역</label><input placeholder="부천 / 서울 / 경기" {...input('region')} /></div>
            <div className="field full"><label>희망 전공 계열</label>
              <select value={form.major} onChange={e=>set('major',e.target.value)}>
                {MAJORS.map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="field full"><label>목표 대학 (상향 기준) *</label>
              <input placeholder="예: 서울대학교 / 연세대학교 / KAIST" {...input('targetUniv')} />
            </div>
            <div className="field"><label>내신 평균 등급</label>
              <input type="number" min="1" max="9" step="0.1" placeholder="예: 1.8" {...input('gpa')} />
            </div>
            <div className="field"><label>모의고사 등급 (국/수/영/탐)</label>
              <input placeholder="예: 1/1/2/1" {...input('mockExam')} />
            </div>
          </div>
        )}
        {tab===1 && (
          <div className="form-grid">
            <div className="field full">
              <div className="info-box full" style={{marginBottom:'16px',background:'var(--blue-bg)'}}>
                생기부 PDF를 업로드하면 AI가 성적, 세특, 비교과, 수상 등 모든 정보를 자동으로 추출하여 분석합니다. 별도로 성적이나 활동을 입력할 필요가 없습니다.
              </div>
            </div>

            <div className="field full">
              <PdfUploader label="생기부 원본 PDF (핵심)" fileKey="recordPdf" files={files} onChange={setFile} hint="학교생활기록부 전체 PDF — 이것 하나면 분석 가능" />
            </div>

            <div className="field full" style={{marginTop:'8px'}}>
              <details className="extra-upload-details">
                <summary className="extra-upload-summary">추가 자료 업로드 (선택사항)</summary>
                <div className="pdf-grid" style={{marginTop:'12px'}}>
                  <PdfUploader label="성적표 PDF" fileKey="gradePdf" files={files} onChange={setFile} hint="내신 성적표 (별도 파일인 경우)" />
                  <PdfUploader label="모의고사 PDF" fileKey="mockExamPdf" files={files} onChange={setFile} hint="최근 모의고사 결과" />
                  <PdfUploader label="수상내역 PDF" fileKey="awardsPdf" files={files} onChange={setFile} hint="수상 내역 정리 파일" />
                </div>
              </details>
            </div>

            <div className="field full" style={{marginTop:'12px'}}>
              <details className="extra-upload-details">
                <summary className="extra-upload-summary">텍스트 직접 입력 (PDF 없을 경우)</summary>
                <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'12px'}}>
                  <div className="field full"><label>세특 주요 내용</label>
                    <textarea placeholder="PDF가 없는 경우 세특 내용을 직접 붙여넣기 해주세요." {...input('specialNotes')} rows={6} />
                  </div>
                  <div className="field full"><label>동아리/봉사/수상 등 비교과</label>
                    <textarea placeholder="동아리, 봉사활동, 리더십, 수상 경력 등" {...input('club')} rows={4} />
                  </div>
                </div>
              </details>
            </div>
          </div>
        )}
      </div>
      <div className="form-footer">
        <div className="form-nav">
          <button className="btn-ghost" onClick={()=>setTab(t=>Math.max(0,t-1))} disabled={tab===0}>이전</button>
          {tab<1
            ? <button className="btn-primary" onClick={()=>setTab(t=>t+1)}>다음 →</button>
            : <button className="btn-analyze" onClick={handleSubmit}>AI 분석 시작</button>
          }
        </div>
      </div>
    </div>
  );
}
