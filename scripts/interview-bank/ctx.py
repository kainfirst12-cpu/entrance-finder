# 문서별 맥락: 논술/면접 언급 횟수 + '문항 분석 결과 요약표' 쪽(어느 문항이 면접인지 논술인지 적힌 표)
import json, re
st = json.load(open('stats.json', encoding='utf-8'))
ctx = {}
for s in st:
    if 'pages' not in s: continue
    pg = json.load(open(f"text/{s['id']}.json", encoding='utf-8'))
    full = '\n'.join(p['t'] for p in pg)
    n_non = len(re.findall(r'논술', full)); n_iv = len(re.findall(r'면접|구술', full)); n_apt = len(re.findall(r'적성고사', full))
    summ = [p for p in pg if re.search(r'문항\s*분석\s*결과\s*요약|문항\s*분석\s*요약|평가\s*대상.{0,40}입학\s*전형', p['t'], re.S)][:2]
    s_txt = '\n'.join(f"<<요약표 쪽 {p['p']}>>\n{p['t'].strip()[:3500]}" for p in summ)
    ctx[s['id']] = {'non': n_non, 'iv': n_iv, 'apt': n_apt, 'summary': s_txt}
json.dump(ctx, open('ctx.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('docs', len(ctx), 'no-iv', sum(1 for c in ctx.values() if c['iv'] == 0), 'no-nonsul', sum(1 for c in ctx.values() if c['non'] == 0), 'with summary', sum(1 for c in ctx.values() if c['summary']))
