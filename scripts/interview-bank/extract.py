import fitz, json, os, re, sys
os.makedirs('text', exist_ok=True)
man = json.load(open('manifest.json', encoding='utf-8'))
stats = []
KW = re.compile(r'면접|구술')
for x in man:
    f = f"pdf/{x['fileId']}.pdf"
    if not os.path.exists(f): continue
    out = f"text/{x['fileId']}.json"
    try:
        doc = fitz.open(f)
    except Exception as e:
        stats.append({'id': x['fileId'], 'name': x['name'], 'err': str(e)}); continue
    pages = []
    for i, p in enumerate(doc):
        t = p.get_text()
        pages.append({'p': i + 1, 't': t})
    json.dump(pages, open(out, 'w', encoding='utf-8'), ensure_ascii=False)
    empty = sum(1 for p in pages if len(p['t'].strip()) < 30)
    iv = sum(1 for p in pages if KW.search(p['t']))
    stats.append({'id': x['fileId'], 'name': x['name'], 'year': x['year'], 'pages': len(pages), 'empty': empty, 'ivpages': iv})
json.dump(stats, open('stats.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
tp = sum(s.get('pages', 0) for s in stats); te = sum(s.get('empty', 0) for s in stats); ti = sum(s.get('ivpages', 0) for s in stats)
print('docs', len(stats), 'pages', tp, 'empty', te, 'interview-kw pages', ti)
print('mostly-scanned docs', sum(1 for s in stats if s.get('pages') and s['empty'] > s['pages'] * 0.6))
print('docs with 0 iv pages', sum(1 for s in stats if s.get('ivpages') == 0))
