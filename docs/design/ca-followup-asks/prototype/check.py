# The server-side check the SPEC proposes, run over the prototype's outputs.
import json, re, sys
d=json.load(open('rounds.json'))
def norm(s): return re.sub(r'[^a-z0-9 ]+',' ',s.lower().replace("’","'")).split()
def contains(hay, needle):
    h,n=norm(hay),norm(needle)
    return len(n)>0 and any(h[i:i+len(n)]==n for i in range(len(h)-len(n)+1))
def check(ask, answers, names):
    p=[]
    t=ask.get('type')
    if t not in ('agree','choice','open'): return ['bad type']
    nums=ask.get('answers') or []
    if not nums or any((not isinstance(n,int)) or n<1 or n>len(answers) for n in nums): p.append('answers out of range')
    if t=='agree':
        s=ask.get('statement','')
        if not s: p.append('no statement')
        elif len(s.split())>20: p.append('statement > 20 words')
        elif not any(contains(answers[n-1],s) for n in nums if isinstance(n,int) and 1<=n<=len(answers)): p.append('statement not copied from its answer')
    if t in ('choice','open'):
        q=ask.get('question','')
        if not q: p.append('no question')
        elif len(q)>110: p.append(f'question {len(q)} chars')
    if t=='choice':
        o=ask.get('options') or []
        if not 2<=len(o)<=4: p.append('option count')
        if len({x.get('answer') for x in o})!=len(o): p.append('two options from one answer')
        for x in o:
            a=x.get('answer')
            if not (isinstance(a,int) and 1<=a<=len(answers)): p.append('option answer out of range'); continue
            if len(x.get('text','').split())>8: p.append(f'option > 8 words: {x["text"]}')
            if not contains(answers[a-1],x.get('text','')): p.append(f'option not copied: {x["text"]!r} (answer {a})')
    room=' '.join([ask.get('question',''),ask.get('statement','')]+[x.get('text','') for x in ask.get('options') or []]).lower()
    for n in names:
        for part in n.lower().split():
            if re.search(r'\b'+re.escape(part)+r'\b',room): p.append('names a person')
    return p
out={}
for f in sys.argv[1:]:
    k=f.split('_')[-1].split('.')[0]
    r=d['rounds'][k]
    sc=sorted(r['answers'],key=lambda a:-(3*a['first']+2*a['second']+a['third']))
    answers=[a['text'] for a in sc]; names=[a['name'] for a in r['answers'] if not r['hidden']]
    j=json.load(open(f))
    tu=[c['toolUse'] for c in j['output']['message']['content'] if 'toolUse' in c]
    txt=''.join(c.get('text','') for c in j['output']['message']['content'])
    if not tu: print(f,'NO TOOL CALL'); continue
    asks=tu[0]['input'].get('asks',[])
    print(f'\n===== {f}  latency {j["_latency_s"]}s  tool calls {len(tu)}  stray text {len(txt)} chars  asks {len(asks)}')
    for a in asks:
        print(json.dumps(a,ensure_ascii=False,indent=1))
        print('  CHECK:', check(a,answers,names) or 'pass')
