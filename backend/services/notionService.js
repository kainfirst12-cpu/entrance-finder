// services/notionService.js
// 분석 결과를 기존 Notion DB에 자동 저장

import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// ── Notion DB에서 학생 목록 조회 ──────────────────────
export const listStudents = async () => {
  const pages = [];
  let cursor = undefined;
  do {
    const res = await notion.databases.query({
      database_id: DATABASE_ID,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ property: '분석일자', direction: 'descending' }],
    });
    pages.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  return pages.map((p) => {
    const props = p.properties || {};
    const nameProp = props['학생 이름'];
    const name =
      nameProp?.title?.map((t) => t.plain_text).join('') || '(이름 없음)';
    const targetUniv =
      props['희망 대학']?.rich_text?.map((t) => t.plain_text).join('') || '';
    const analysisDate = props['분석일자']?.date?.start || null;
    const status = props['분석상태']?.select?.name || null;
    const summary =
      props['분석결과']?.rich_text?.map((t) => t.plain_text).join('') || '';
    return {
      id: p.id,
      name,
      targetUniv,
      analysisDate,
      status,
      summary,
      url: `https://notion.so/${p.id.replace(/-/g, '')}`,
    };
  });
};

// ── 학생 페이지 찾기 또는 생성 ────────────────────────
const findOrCreateStudent = async (studentName) => {
  // 기존 DB에서 학생 찾기
  const response = await notion.databases.query({
    database_id: DATABASE_ID,
    filter: {
      property: '학생 이름',
      title: { contains: studentName },
    },
  });

  if (response.results.length > 0) {
    return response.results[0].id;
  }

  // 없으면 새 페이지 생성
  const newPage = await notion.pages.create({
    parent: { database_id: DATABASE_ID },
    properties: {
      '학생 이름': {
        title: [{ text: { content: studentName } }],
      },
    },
  });
  return newPage.id;
};

// ── 텍스트 블록 생성 헬퍼 ────────────────────────────
const textBlock = (text) => ({
  object: 'block',
  type: 'paragraph',
  paragraph: {
    rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }],
  },
});

const headingBlock = (text, level = 2) => ({
  object: 'block',
  type: `heading_${level}`,
  [`heading_${level}`]: {
    rich_text: [{ type: 'text', text: { content: text } }],
  },
});

const dividerBlock = () => ({ object: 'block', type: 'divider', divider: {} });

const calloutBlock = (text, emoji = '💡') => ({
  object: 'block',
  type: 'callout',
  callout: {
    rich_text: [{ type: 'text', text: { content: text.slice(0, 2000) } }],
    icon: { type: 'emoji', emoji },
  },
});

// 긴 텍스트를 2000자씩 나눠서 블록 배열로 변환
const longTextBlocks = (text) => {
  const chunks = [];
  for (let i = 0; i < text.length; i += 1900) {
    chunks.push(textBlock(text.slice(i, i + 1900)));
  }
  return chunks;
};

// ── 분석 결과 Notion 페이지에 저장 ───────────────────
export const saveAnalysisToNotion = async (studentData, analysisResults) => {
  const pageId = await findOrCreateStudent(studentData.name);

  // JSON 파싱 (대시보드에서 JSON 추출)
  let scoreData = null;
  try {
    const jsonMatch = analysisResults.dashboard?.match(/\{[\s\S]*"종합점수"[\s\S]*\}/);
    if (jsonMatch) scoreData = JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.log('JSON 파싱 실패, 텍스트로 저장');
  }

  // 기본 속성 업데이트
  const properties = {
    분석일자: {
      date: { start: new Date().toISOString().split('T')[0] },
    },
    분석상태: {
      select: { name: '완료' },
    },
  };

  if (scoreData?.종합평가요약) {
    properties['분석결과'] = {
      rich_text: [{ text: { content: scoreData.종합평가요약.slice(0, 2000) } }],
    };
  }

  if (studentData.targetUniv) {
    properties['희망 대학'] = {
      rich_text: [{ text: { content: studentData.targetUniv } }],
    };
  }

  await notion.pages.update({ page_id: pageId, properties });

  // 기존 콘텐츠 블록 모두 삭제 (초기화 후 새로 작성)
  const existingBlocks = await notion.blocks.children.list({ block_id: pageId });
  for (const block of existingBlocks.results) {
    await notion.blocks.delete({ block_id: block.id });
  }

  // 새 분석 결과 블록 작성
  const analysisDate = new Date().toLocaleDateString('ko-KR');

  const blocks = [
    // ── 헤더 ──
    headingBlock(`🎓 ${studentData.name} 입시 컨설팅 리포트`, 1),
    calloutBlock(`📅 분석일: ${analysisDate}  |  🎯 목표: ${studentData.targetUniv} ${studentData.major}  |  📊 내신: ${studentData.gpa}등급`, '📋'),
    dividerBlock(),

    // ── 역량 점수 ──
    headingBlock('📊 역량 종합 점수', 2),
    ...(scoreData ? [calloutBlock(
      `학업역량: ${scoreData.종합점수?.학업역량}/10\n비교과: ${scoreData.종합점수?.비교과}/10\n진로역량: ${scoreData.종합점수?.진로역량}/10\n세특 질: ${scoreData.종합점수?.세특질}/10\n전공적합성: ${scoreData.종합점수?.전공적합성}/10\n\n총점: ${scoreData.종합점수?.총점}/50`,
      '📊'
    )] : []),
    dividerBlock(),

    // ── 0단계: 사례 매칭 ──
    headingBlock('🔍 Drive 사례 매칭 결과', 2),
    ...longTextBlocks(analysisResults.caseMatching || ''),
    dividerBlock(),

    // ── 1단계: 학업역량 ──
    headingBlock('📚 학업역량 분석', 2),
    ...longTextBlocks(analysisResults.academic || ''),
    dividerBlock(),

    // ── 2단계: 비교과 ──
    headingBlock('🏆 비교과 활동 분석', 2),
    ...longTextBlocks(analysisResults.activity || ''),
    dividerBlock(),

    // ── 3단계: 진로 역량 ──
    headingBlock('🎯 진로 역량 분석', 2),
    ...longTextBlocks(analysisResults.career || ''),
    dividerBlock(),

    // ── 4단계: 지원 전략 ──
    headingBlock('🗺️ 지원 전략 (수시 6장)', 2),
    ...longTextBlocks(analysisResults.strategy || ''),
    dividerBlock(),

    // ── 5단계: 3년 로드맵 ──
    headingBlock('📅 3년 로드맵', 2),
    ...longTextBlocks(analysisResults.roadmap || ''),
    dividerBlock(),

    // ── 6단계: 세특 피드백 ──
    headingBlock('✏️ 세특 Before/After 개선안', 2),
    ...longTextBlocks(analysisResults.recordFeedback || ''),
    dividerBlock(),

    // ── 7단계: 종합 대시보드 ──
    headingBlock('🎓 종합 대시보드', 2),
    ...longTextBlocks(analysisResults.dashboard || ''),
  ];

  // 100개씩 나눠서 추가 (Notion API 제한)
  for (let i = 0; i < blocks.length; i += 100) {
    await notion.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(i, i + 100),
    });
  }

  return {
    pageId,
    url: `https://notion.so/${pageId.replace(/-/g, '')}`,
  };
};
