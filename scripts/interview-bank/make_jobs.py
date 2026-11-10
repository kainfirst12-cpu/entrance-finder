# 논술 대학(최신 학년도 보고서 하나씩)의 문항카드 쪽만 골라 jobs/<번호>_<대학>.txt 로 쓴다 (구독 에이전트 추출용)
import json,re,os
st=json.load(open('stats.json',encoding='utf-8')); ctx=json.load(open('ctx.json',encoding='utf-8'))
man={x['fileId']:x for x in json.load(open('manifest.json',encoding='utf-8'))}
CARD=re.compile(r'성취\s*기준|적용\s*교육\s*과정|논제|예시\s*답안|채점\s*기준|제시문|문항\s*해설')
SKIP=re.compile(r'사관학교|경찰대')
def univ(n):
  m=re.search(r'([가-힣]+(대학교|대학))',n); return m.group(1) if m else n
best={}
for s in st:
  if 'pages' not in s or ctx.get(s['id'],{}).get('non',0)<20 or SKIP.search(s['name']): continue
  u=univ(re.sub(r'^\(.*?\)\s*','',s['name'])).replace('서울과기대학교','서울과학기술대학교'); y=int(man[s['id']]['year'])
  if u not in best or y>best[u][1]: best[u]=(s,y)
jobs=[]; n=0
for u,(s,y) in sorted(best.items()):
  pg=json.load(open(f"text/{s['id']}.json",encoding='utf-8'))
  hit={i for i,p in enumerate(pg) if len(CARD.findall(p['t']))>=2}
  keep=sorted({j for i in hit for j in (i-1,i,i+1) if 0<=j<len(pg)})
  if not keep: continue
  parts=[[]]; size=0
  for j in keep:
    if size>55000: parts.append([]); size=0
    parts[-1].append(pg[j]); size+=len(pg[j]['t'])
  for k,part in enumerate(parts):
    n+=1; fn=f"jobs/{n:03d}_{u}{'_'+str(k+1) if len(parts)>1 else ''}.txt"
    head=f"[문서] {s['name']}\n[학년도] {y}\n[대학] {u}\n[구간] {k+1}/{len(parts)} (이 보고서의 문항카드 관련 쪽만 뽑은 것)\n[요약표]\n{ctx[s['id']].get('summary') or '(없음)'}\n\n"
    body='\n'.join(f"<<쪽 {p['p']}>>\n{p['t'].strip()}" for p in part)
    open(fn,'w',encoding='utf-8').write(head+body)
    jobs.append({'job':os.path.basename(fn),'fileId':s['id'],'univ':u,'year':y,'chars':len(body)})
json.dump(jobs,open('jobs.json','w',encoding='utf-8'),ensure_ascii=False,indent=0)
print('univs',len(best),'jobs',len(jobs),'chars',sum(j['chars'] for j in jobs))
