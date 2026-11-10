# 보충: 작업 파일 사이에 빠진 짧은 틈(4쪽 이하)의 쪽만 모아 jobs/G<nn>_<대학>.txt 로 쓴다 — 문항카드 질문 쪽이 빠진 경우 대비
import json,re,os
import sys
GAP=int(sys.argv[1]) if len(sys.argv)>1 else 5
jobs=json.load(open('jobs.json',encoding='utf-8')); ctx=json.load(open('ctx.json',encoding='utf-8'))
docs={}
for j in jobs:
  if j['job'].startswith('G'): continue
  t=open('jobs/'+j['job'],encoding='utf-8').read()
  docs.setdefault(j['fileId'],{'j':j,'pages':set()})['pages'].update(int(x) for x in re.findall(r'<<쪽 (\d+)>>',t))
out=[x for x in jobs if not x['job'].startswith('G')]; n=0; total=0
for fid,d in docs.items():
  pg={p['p']:p for p in json.load(open(f'text/{fid}.json',encoding='utf-8'))}
  have=sorted(d['pages']); fill=[]
  for a,b in zip(have,have[1:]):
    if 1<b-a<=GAP: fill+= [p for p in range(a+1,b) if p in pg and len(pg[p]['t'].strip())>=30]
  if not fill: continue
  n+=1; j=d['j']; fn=f"jobs/G{n:02d}_{j['univ']}.txt"
  head=f"[문서] (보충) {j['univ']} {j['year']}학년도 보고서\n[학년도] {j['year']}\n[대학] {j['univ']}\n[구간] 보충 — 앞 작업에서 빠졌던 쪽만 모은 것(질문 원문이 여기 있고 근거는 다른 파일에 있을 수 있음)\n[요약표]\n{ctx[fid].get('summary') or '(없음)'}\n\n"
  body='\n'.join(f"<<쪽 {p}>>\n{pg[p]['t'].strip()}" for p in fill); total+=len(body)
  open(fn,'w',encoding='utf-8').write(head+body)
  out.append({'job':os.path.basename(fn),'fileId':fid,'univ':j['univ'],'year':j['year'],'chars':len(body)})
json.dump(out,open('jobs.json','w',encoding='utf-8'),ensure_ascii=False,indent=0)
print('gap jobs',n,'chars',total)
