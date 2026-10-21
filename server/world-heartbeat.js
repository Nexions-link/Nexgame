// Browser and Node clients automatically answer RFC6455 ping with pong.
// Preserve anonymous drop causes, making staging disconnects diagnosable
// without exposing player names, session tokens, or message contents.
import {WebSocket} from 'ws';
export function createWorldHeartbeat({wss,intervalMs=30000,maxMissed=3}){
 const missed=new WeakMap(),terminationCauses=new WeakMap();
 let pingsSent=0,staleTerminations=0,pingFailures=0;
 let totalClosed=0,abnormalClosed=0,transportErrors=0;
 const closeCodes={},closeCauses={},recentCloses=[];
 const rememberClose=(code,cause)=>{
  const key=String(code);
  closeCodes[key]=(closeCodes[key]||0)+1;
  closeCauses[cause]=(closeCauses[cause]||0)+1;
  if(code!==1000&&code!==1001)abnormalClosed++;
  recentCloses.push({at:new Date().toISOString(),code,cause});
  if(recentCloses.length>12)recentCloses.shift();
 };
 function track(ws){
  missed.set(ws,0);
  ws.on('pong',()=>missed.set(ws,0));
  ws.on('error',()=>{transportErrors++});
  ws.once('close',code=>{
   totalClosed++;
   const cause=terminationCauses.get(ws)||
    (code===1000?'client_normal':
     code===1001?'going_away':
     code===1008?'server_policy':
     code===1011||code===1013?'server_restart_or_unavailable':
     code===1006?'transport_abnormal':'other');
   rememberClose(code,cause);
  });
 }
 function sweep(){
  for(const ws of wss.clients){
   if(ws.readyState!==WebSocket.OPEN)continue;
   const count=(missed.get(ws)??0)+1;
   if(count>=maxMissed){
    staleTerminations++;
    terminationCauses.set(ws,'heartbeat_timeout');
    ws.terminate();continue;
   }
   missed.set(ws,count);
   try{ws.ping();pingsSent++}catch{
    pingFailures++;
    terminationCauses.set(ws,'ping_error');
    ws.terminate();
   }
  }
 }
 const timer=setInterval(sweep,intervalMs);
 timer.unref?.();
 return {track,sweep,stats:()=>({
  pingsSent,staleTerminations,pingFailures,transportErrors,
  totalClosed,abnormalClosed,
  openSockets:[...wss.clients].filter(ws=>ws.readyState===WebSocket.OPEN).length,
  closeCodes:{...closeCodes},closeCauses:{...closeCauses},
  recentCloses:recentCloses.map(entry=>({...entry}))
 }),close:()=>clearInterval(timer)};
}
