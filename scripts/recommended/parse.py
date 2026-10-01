# 2028학년도 대학별 권장과목(대교협 자료집 기반 권역별 정리 엑셀) → 앱 데이터
#   python scripts/recommended/parse.py  → frontend/public/data/recommended-2028.json.gz
# 원본: 원장 지식베이스 '2. 대학별 전형/03_2028학년도 권역별 대학별 권장과목.xlsx' (이 폴더에 source-2028.xlsx 로 복사해 둠)
# 열: 권역 · 지역 · 대학명 · 모집단위(계열/단과대) · 모집단위(학과) · 핵심과목 · 권장과목 · 비고
#   ※ 핵심과목 = 필수적 이수를 권장, 권장과목 = 가급적 이수를 권장. 지원 자격이 아니라 평가 참고.
# 과목 칸은 쉼표로 나뉜 과목명이거나, "인문사회계열 진로 및 적성을 고려하여…" 같은 문장이다 → raw 를 그대로 두고, 쉼표로 나눈 조각을 items 로.
import gzip, json, os, re, datetime
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source-2028.xlsx')
OUT = os.path.join(HERE, '..', '..', 'frontend', 'public', 'data', 'recommended-2028.json.gz')

def clean(v):
    if v is None:
        return ''
    s = str(v).replace('\r', '').strip()
    return '' if s in ('-', '–', '—') else s

def items(raw):
    if not raw:
        return []
    # 문장형(진로·적성 고려, ~영역 이수 권장 등)은 과목 목록으로 쪼개지 않는다
    if re.search(r'고려하여|이수할 것|권장$|자유롭게|제시하지 않', raw):
        return []
    parts = re.split(r'[,\n]|(?<=[^·])·(?=[^가])', raw)  # '기술·가정' 은 남긴다
    out = []
    for p in parts:
        p = re.sub(r'\s+', ' ', p)
        p = re.sub(r'^(일반|진로|융합)\s*선택\s*[:：]\s*', '', p.strip())   # '진로선택: 기하' → '기하'
        p = re.sub(r'\s*중\s*\d+\s*과목.*$', '', p)                      # '생물의 유전 중 3과목]' → '생물의 유전'
        p = p.strip(' ()[]-')
        p = p.replace('I', 'Ⅰ') if re.search(r'(미적분|영어|수학)\s*I$', p) else p
        p = re.sub(r'(미적분|영어)\s*Ⅰ', r'\1Ⅰ', p); p = re.sub(r'(미적분|영어)\s*Ⅱ', r'\1Ⅱ', p)
        if p and len(p) <= 30:
            out.append(p)
    return out

wb = openpyxl.load_workbook(SRC, read_only=True)
rows = list(wb.worksheets[0].iter_rows(values_only=True))
univs = {}
last = {'region': '', 'area': '', 'univ': '', 'college': ''}
for r in rows[4:]:
    r = list(r) + [None] * 9
    region, area, univ, college, unit, core, rec, note = [clean(x) for x in r[:8]]
    if not (univ or college or unit or core):
        continue
    region = region or last['region']; area = area or last['area']; univ = (univ or last['univ']).replace('\n', ' ')
    if univ != last['univ']:
        last['college'] = ''
    college = (college or '').replace('\n', ' · ')
    if not college and unit:
        college = last['college']
    last.update(region=region, area=area, univ=univ, college=college or last['college'])
    name = ' · '.join([x for x in (college, unit) if x]) or '(전체)'
    u = univs.setdefault(univ, {'name': univ, 'region': region, 'area': area, 'units': []})
    u['units'].append({
        'name': name, 'college': college, 'unit': unit,
        'core': {'raw': core, 'items': items(core)},
        'rec': {'raw': rec, 'items': items(rec)},
        'note': note,
    })

data = {
    'title': '2028학년도 대학별 권장과목',
    'source': '대교협 「2028 모집단위별 반영과목 및 대학별 권장과목 자료집」 기반 권역별 정리(원장 지식베이스)',
    'legend': {'core': '핵심과목 — 필수적 이수를 권장', 'rec': '권장과목 — 가급적 이수를 권장'},
    'generatedAt': datetime.datetime.now().isoformat(timespec='seconds'),
    'univs': sorted(univs.values(), key=lambda u: u['name']),
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with gzip.open(OUT, 'wt', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False)
n = sum(len(u['units']) for u in data['univs'])
print(f"{len(data['univs'])}개 대학 · {n}개 모집단위 → {os.path.relpath(OUT)} ({os.path.getsize(OUT)//1024}KB)")
