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
    if (f.size > 50 * 1024 * 1024) return alert('파일 크기는 50MB 이하만 가능해요!');
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
    major:'', targetUniv:'',
    gpa:'', mockExam:'',
    club:'', volunteer:'', leadership:'',
    awards:'', talent:'', interests:'',
    specialNotes:'', subjectPlan:'',
  });
  const [selectedMajors, setSelectedMajors] = useState([]);
  const [mockExamName, setMockExamName] = useState('');
  // 과목별 점수: { score: 원점수, grade: 등급, gradeType: 'confirmed'|'expected' }
  const DEFAULT_MOCK = { score:'', grade:'', gradeType:'confirmed' };
  const [mockSubjects, setMockSubjects] = useState({
    korean:  { ...DEFAULT_MOCK, label: '국어', max: 100 },
    math:    { ...DEFAULT_MOCK, label: '수학', max: 100 },
    english: { ...DEFAULT_MOCK, label: '영어', max: 100 },
    history: { ...DEFAULT_MOCK, label: '한국사', max: 50 },
  });
  const [mockElectives, setMockElectives] = useState([
    // 선택/탐구 과목 (사용자가 추가)
    // { id, name, score, grade, gradeType, max }
  ]);
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

  const toggleMajor = (m) => {
    setSelectedMajors(prev => {
      if (prev.includes(m)) return prev.filter(x => x !== m);
      if (prev.length >= 3) { alert('최대 3개까지 선택 가능합니다.'); return prev; }
      return [...prev, m];
    });
  };

  const addElective = () => {
    setMockElectives(prev => [...prev, {
      id: Date.now(), name: '', score: '', grade: '', gradeType: 'confirmed', max: 50
    }]);
  };
  const removeElective = (id) => setMockElectives(prev => prev.filter(e => e.id !== id));
  const updateElective = (id, field, value) => {
    setMockElectives(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  };
  const updateMockSubject = (key, field, value) => {
    setMockSubjects(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  // 모의고사 점수를 AI에 전달할 텍스트로 변환
  const buildMockExamText = () => {
    const parts = [];
    for (const [, sub] of Object.entries(mockSubjects)) {
      if (!sub.score && !sub.grade) continue;
      const gradeLabel = sub.gradeType === 'expected' ? '예상' : '확정';
      const scoreStr = sub.score ? `원점수 ${sub.score}/${sub.max}` : '';
      const gradeStr = sub.grade ? `${gradeLabel}${sub.grade}등급` : '';
      parts.push(`${sub.label}: ${[scoreStr, gradeStr].filter(Boolean).join(', ')}`);
    }
    for (const el of mockElectives) {
      if (!el.name || (!el.score && !el.grade)) continue;
      const gradeLabel = el.gradeType === 'expected' ? '예상' : '확정';
      const scoreStr = el.score ? `원점수 ${el.score}/${el.max}` : '';
      const gradeStr = el.grade ? `${gradeLabel}${el.grade}등급` : '';
      parts.push(`${el.name}: ${[scoreStr, gradeStr].filter(Boolean).join(', ')}`);
    }
    if (parts.length === 0) return form.mockExam || '';
    const exam = mockExamName ? `[${mockExamName}] ` : '';
    return `${exam}${parts.join(' / ')}`;
  };

  const handleSubmit = () => {
    if (!form.name) return alert('학생 이름을 입력해주세요.');
    if (!form.targetUniv) return alert('목표 대학을 입력해주세요.');
    if (selectedMajors.length === 0) return alert('희망 전공을 1개 이상 선택해주세요.');
    const mockExamText = buildMockExamText();
    onSubmit({ ...form, major: selectedMajors.join(', '), mockExam: mockExamText }, files);
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
            <div className="field full"><label>희망 전공 계열 (최대 3개)</label>
              <div className="major-tags">
                {selectedMajors.map(m => (
                  <span key={m} className="major-tag selected" onClick={() => toggleMajor(m)}>
                    {m} <span className="major-tag-x">X</span>
                  </span>
                ))}
                {selectedMajors.length === 0 && <span className="major-tag-hint">아래에서 선택하세요</span>}
              </div>
              <div className="major-grid">
                {MAJORS.map(m => (
                  <button
                    key={m}
                    type="button"
                    className={`major-chip ${selectedMajors.includes(m) ? 'active' : ''}`}
                    onClick={() => toggleMajor(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div className="field full"><label>목표 대학 (상향 기준) *</label>
              <input placeholder="예: 서울대학교 / 연세대학교 / KAIST" {...input('targetUniv')} />
            </div>
            <div className="field full"><label>내신 평균 등급</label>
              <input type="number" min="1" max="9" step="0.1" placeholder="예: 1.8" {...input('gpa')} />
            </div>
            <div className="field full">
              <label>모의고사 성적</label>
              <div className="mock-exam-block">
                <input
                  className="mock-exam-name"
                  placeholder="시험명 (예: 2026년 6월 모의고사)"
                  value={mockExamName}
                  onChange={e => setMockExamName(e.target.value)}
                  style={{marginBottom:12, width:'100%'}}
                />

                <div className="mock-section-label">주요 과목 (만점 기준 자동 적용)</div>
                <table className="mock-table">
                  <thead>
                    <tr>
                      <th>과목</th>
                      <th>만점</th>
                      <th>원점수</th>
                      <th>등급</th>
                      <th>구분</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(mockSubjects).map(([key, sub]) => (
                      <tr key={key}>
                        <td className="mock-subj-name">{sub.label}</td>
                        <td className="mock-max">{sub.max}점</td>
                        <td><input type="number" min="0" max={sub.max} placeholder={`0~${sub.max}`} value={sub.score} onChange={e => updateMockSubject(key, 'score', e.target.value)} /></td>
                        <td><input type="number" min="1" max="9" placeholder="1~9" value={sub.grade} onChange={e => updateMockSubject(key, 'grade', e.target.value)} /></td>
                        <td>
                          <select value={sub.gradeType} onChange={e => updateMockSubject(key, 'gradeType', e.target.value)}>
                            <option value="confirmed">확정</option>
                            <option value="expected">예상</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mock-section-label" style={{marginTop:12}}>
                  선택/탐구 과목
                  <button type="button" className="mock-add-btn" onClick={addElective}>+ 과목 추가</button>
                </div>
                {mockElectives.length > 0 && (
                  <table className="mock-table">
                    <thead>
                      <tr>
                        <th>과목명</th>
                        <th>만점</th>
                        <th>원점수</th>
                        <th>등급</th>
                        <th>구분</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {mockElectives.map(el => (
                        <tr key={el.id}>
                          <td><input className="mock-el-name" placeholder="예: 생명과학I" value={el.name} onChange={e => updateElective(el.id, 'name', e.target.value)} /></td>
                          <td>
                            <select value={el.max} onChange={e => updateElective(el.id, 'max', Number(e.target.value))}>
                              <option value={50}>50점</option>
                              <option value={100}>100점</option>
                            </select>
                          </td>
                          <td><input type="number" min="0" max={el.max} placeholder={`0~${el.max}`} value={el.score} onChange={e => updateElective(el.id, 'score', e.target.value)} /></td>
                          <td><input type="number" min="1" max="9" placeholder="1~9" value={el.grade} onChange={e => updateElective(el.id, 'grade', e.target.value)} /></td>
                          <td>
                            <select value={el.gradeType} onChange={e => updateElective(el.id, 'gradeType', e.target.value)}>
                              <option value="confirmed">확정</option>
                              <option value="expected">예상</option>
                            </select>
                          </td>
                          <td><button type="button" className="mock-remove-btn" onClick={() => removeElective(el.id)}>X</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {mockElectives.length === 0 && (
                  <div className="mock-score-hint">선택/탐구 과목을 추가하려면 위 버튼을 클릭하세요 (예: 사회탐구, 과학탐구, 공통사회, 공통과학 등)</div>
                )}
              </div>
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
