// src/components/StudentList.jsx
import { useState, useEffect } from 'react';

const STATUS_COLOR = {
  '완료': 'green',
  '미분석': 'gray',
  '업데이트필요': 'amber',
};

export default function StudentList({ onNewAnalysis }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('http://localhost:3001/api/students')
      .then((r) => r.json())
      .then((d) => {
        if (d.success) setStudents(d.students);
      })
      .catch(() => setStudents([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = students.filter(
    (s) =>
      s.name?.includes(search) ||
      s.targetUniv?.includes(search) ||
      s.grade?.toString().includes(search)
  );

  return (
    <div className="list-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">학생 관리</h1>
          <p className="page-desc">Notion DB와 실시간 연동 · 총 {students.length}명</p>
        </div>
        <button className="btn-analyze" onClick={onNewAnalysis}>
          ✨ 새 분석 시작
        </button>
      </div>

      {/* 검색 */}
      <div className="search-wrap">
        <input
          className="search-input"
          placeholder="🔍 이름 · 대학 · 학년으로 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading-wrap">
          <div className="spinner" />
          <p>Notion DB 불러오는 중...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-wrap">
          <div className="empty-icon">👥</div>
          <p className="empty-title">아직 분석된 학생이 없어요</p>
          <p className="empty-desc">새 분석 시작 버튼을 눌러 첫 번째 학생을 분석해보세요!</p>
          <button className="btn-analyze" onClick={onNewAnalysis}>
            ✨ 첫 번째 분석 시작
          </button>
        </div>
      ) : (
        <div className="student-grid">
          {filtered.map((s) => (
            <div key={s.id} className="student-card">
              <div className="student-card-header">
                <div className="student-avatar">
                  {s.name?.charAt(0) || '?'}
                </div>
                <div>
                  <div className="student-name">{s.name}</div>
                  <div className="student-meta">{s.grade}학년 · {s.region || '지역 미입력'}</div>
                </div>
                <span className={`status-badge ${STATUS_COLOR[s.status] || 'gray'}`}>
                  {s.status || '미분석'}
                </span>
              </div>

              <div className="student-info">
                <div className="student-info-row">
                  <span className="info-label">목표 대학</span>
                  <span className="info-value">{s.targetUniv || '미입력'}</span>
                </div>
                {s.analysisDate && (
                  <div className="student-info-row">
                    <span className="info-label">마지막 분석</span>
                    <span className="info-value">{s.analysisDate}</span>
                  </div>
                )}
                {s.summary && (
                  <div className="student-summary">{s.summary}</div>
                )}
              </div>

              <div className="student-card-footer">
                {s.notionUrl && (
                  <a href={s.notionUrl} target="_blank" rel="noreferrer" className="btn-notion-sm">
                    📓 Notion
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
