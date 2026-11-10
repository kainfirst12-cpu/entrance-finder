# out/<작업>.json 검사: 모양 + 원문 대조(질문·성취기준 코드가 작업 파일에 실제로 있는가)
# 사용: python -I -X utf8 check_out.py out/019_경희대학교_1.json [...]   (인자 없으면 out/*.json 전부)
import json, re, sys, os, glob

BASE = os.path.dirname(os.path.abspath(__file__))
KINDS = {'논술', '면접'}
IT = {'제시문 기반', '서류 기반', '인성', 'MMI', '교직적성', '전공적성', '기타', '해당없음'}
EF = {'인문', '사회', '인문사회 통합', '수리', '과학', '의학', '기타', '해당없음'}
sq = lambda s: re.sub(r'[^가-힣A-Za-z0-9]', '', str(s or ''))

def check(path):
    errs, warns = [], []
    job = os.path.join(BASE, 'jobs', os.path.basename(path)[:-5] + '.txt')
    src = sq(open(job, encoding='utf-8').read()) if os.path.exists(job) else ''
    if not src: errs.append(f'작업 파일 없음: {job}')
    try: d = json.load(open(path, encoding='utf-8'))
    except Exception as e: return [f'JSON 읽기 실패: {e}'], []
    if not isinstance(d.get('questions'), list): return ['questions 배열 없음'], []
    for i, q in enumerate(d['questions']):
        tag = f'#{i} {q.get("qno", "")[:30]}'
        for k in ['kind', 'qno', 'question', 'passage', 'curriculum', 'textbooks', 'units', 'evalPoints']:
            if k not in q: errs.append(f'{tag}: {k} 없음')
        if q.get('kind') not in KINDS: errs.append(f'{tag}: kind={q.get("kind")}')
        if q.get('interviewType', '해당없음') not in IT: errs.append(f'{tag}: interviewType={q.get("interviewType")}')
        if q.get('essayField', '해당없음') not in EF: errs.append(f'{tag}: essayField={q.get("essayField")}')
        if not q.get('question') and not q.get('curriculum') and not q.get('evalPoints'): errs.append(f'{tag}: 질문도 근거도 없음')
        # 원문 대조 — 질문 앞 40자, 성취기준 코드
        qs = sq(re.sub(r'\[(수식|그림|표)[^\]]*\]', '', q.get('question') or ''))
        if src and qs:
            probe = qs[:40]
            if probe not in src and qs[len(qs)//2: len(qs)//2 + 30] not in src and qs[-25:] not in src:
                warns.append(f'{tag}: 질문이 원문에서 안 보임 — {q["question"][:50]}')
        for c in q.get('curriculum') or []:
            code = sq(c.get('code'))
            if src and code and code not in src: warns.append(f'{tag}: 성취기준 코드 원문에 없음 {c.get("code")}')
            st = sq(c.get('standard'))[:20]
            if src and st and st not in src: warns.append(f'{tag}: 성취기준 문장 원문에 없음 {c.get("standard", "")[:30]}')
    return errs, warns

paths = sys.argv[1:] or sorted(glob.glob(os.path.join(BASE, 'out', '*.json')))
bad = 0
for p in paths:
    e, w = check(p)
    n = len(json.load(open(p, encoding='utf-8')).get('questions', [])) if not e or 'JSON' not in e[0] else 0
    print(f'{os.path.basename(p)}: 문항 {n} · 오류 {len(e)} · 경고 {len(w)}')
    for x in e + w[:15]: print('   ', x)
    bad += bool(e)
sys.exit(1 if bad else 0)
