// Sends one player's answer the way PlayerPage does (sendCleanMessage), over Node's ws, which works from this container.
const WebSocket=require('ws');const {HttpsProxyAgent}=require('https-proxy-agent');const fs=require('fs');
const WS='wss://h8ipndmk4d.execute-api.us-east-1.amazonaws.com/dev';const ca=fs.readFileSync('/root/.ccr/ca-bundle.crt');
module.exports=function send(gameId,playerName,questionNumber,answer,answerType){return new Promise((res)=>{
 const ws=new WebSocket(`${WS}?gameId=${gameId}&playerName=${encodeURIComponent(playerName)}`,{agent:new HttpsProxyAgent(process.env.HTTPS_PROXY),ca,headers:{Origin:'https://engage.dev.seibtribe.us'}});
 const msgs=[];ws.on('message',m=>msgs.push(String(m).slice(0,160)));
 ws.on('open',()=>{ws.send(JSON.stringify({messageType:`ANSWER#${questionNumber}`,gameId,playerName,timestamp:new Date().toISOString(),answer,answerType}));setTimeout(()=>{ws.close();res({ok:true,msgs})},2500);});
 ws.on('unexpected-response',(q,r)=>res({ok:false,status:r.statusCode}));ws.on('error',e=>res({ok:false,err:e.message}));});};
