# One Bedrock converse call via the AWS CLI (read-only inference). usage:
# python3 run.py <haiku|sonnet> <prompt.txt> <out.json> [tool]
import json, subprocess, sys, time
M={'haiku':'us.anthropic.claude-haiku-4-5-20251001-v1:0','sonnet':'us.anthropic.claude-sonnet-4-6'}
model, pf, out = sys.argv[1:4]
tool = len(sys.argv) > 4
prompt=open(pf).read()
req={'modelId':M[model],'messages':[{'role':'user','content':[{'text':prompt}]}],
     'inferenceConfig':{'maxTokens':1200 if tool else 2048}}
if tool:
    d=json.load(open(__import__('os').path.join(__import__('os').path.dirname(__file__),'..','prompt-draft.json')))['followUpAsks']['tool']
    # auto, not forced: the 5.5 route cannot force a tool, so test the harder case
    req['toolConfig']={'tools':[{'toolSpec':{'name':d['name'],'description':d['description'],'inputSchema':{'json':d['input_schema']}}}],'toolChoice':{'auto':{}}}
else:
    req['inferenceConfig']['temperature']=0.7
json.dump(req,open(out+'.req.json','w'))
t=time.time()
r=subprocess.run(['aws','bedrock-runtime','converse','--cli-input-json','file://'+out+'.req.json','--output','json'],capture_output=True,text=True,env={**__import__('os').environ,'AWS_PROFILE':'adminaccess','AWS_REGION':'us-east-1'})
dt=time.time()-t
if r.returncode: print(r.stderr); sys.exit(1)
res=json.loads(r.stdout); res['_latency_s']=round(dt,1)
json.dump(res,open(out,'w'),indent=1)
print(out, dt, res.get('stopReason'), res.get('usage'))
