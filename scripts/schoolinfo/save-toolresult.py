"""javascript_tool 결과 파일(JSON 문자열이 한 번 더 감싸진 형태)에서 학교 레코드를 꺼내 out/achievement-raw/<id>.json 으로 저장.
   python save-toolresult.py <tool-result.txt>"""
import json, sys, os
p = sys.argv[1]
arr = json.load(open(p, encoding='utf-8'))
txt = arr[0]['text']
if '\n\n(captured' in txt:
    txt = txt[:txt.rfind('\n\n(captured')]
s = json.loads(txt)
recs = json.loads(s) if isinstance(s, str) else s
os.makedirs('out/achievement-raw', exist_ok=True)
names = []
for r in recs:
    json.dump(r, open(f"out/achievement-raw/{r['id']}.json", 'w', encoding='utf-8'), ensure_ascii=False)
    names.append(r['name'])
print(len(recs), names)
