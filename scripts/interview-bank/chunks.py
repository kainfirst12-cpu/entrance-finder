# 문서별 면접 관련 쪽을 골라 연속 구간(앞뒤 1쪽 포함)으로 묶고 ~14k자 단위 청크로 자른다 → chunks.json
import json, re
man = {x['fileId']: x for x in json.load(open('manifest.json', encoding='utf-8'))}
st = json.load(open('stats.json', encoding='utf-8'))
IV = re.compile(r'면접|구술')
HINT = re.compile(r'문항\s*카드|출제\s*의도|예상\s*질문|질문\s*예시|예시\s*문항|기출|제시문|문항\s*\d|질문\s*\d|[가-힣]+(나요|까요|니까|십니까|하시오|하세요|보세요)\s*\?')
EXCL = re.compile(r'논술')
out = []
for s in st:
    if 'pages' not in s: continue
    pg = json.load(open(f"text/{s['id']}.json", encoding='utf-8'))
    hit = set()
    for i, p in enumerate(pg):
        t = p['t']
        if HINT.search(t) or (IV.search(t) and re.search(r"질문|문항", t)): hit.add(i)
    # 앞뒤 1쪽 (문항과 출제의도가 쪽을 넘나든다)
    keep = sorted({j for i in hit for j in (i - 1, i, i + 1) if 0 <= j < len(pg)})
    buf, size = [], 0
    def flush():
        global buf, size
        if buf: out.append({'id': s['id'], 'name': s['name'], 'year': man[s['id']]['year'], 'pages': [p['p'] for p in buf],
                            'text': '\n'.join(f"<<쪽 {p['p']}>>\n{p['t'].strip()}" for p in buf)})
        buf, size = [], 0
    last = None
    for j in keep:
        p = pg[j]
        if (last is not None and j != last + 1) or size + len(p['t']) > 14000: flush()
        if len(p['t'].strip()) < 30: last = j; continue
        buf.append(p); size += len(p['t']); last = j
    flush()
json.dump(out, open('chunks.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('chunks', len(out), 'chars', sum(len(c['text']) for c in out), 'pages', sum(len(c['pages']) for c in out))
