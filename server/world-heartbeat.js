// WebSocket protocol ping/pong is automatically answered by mobile browsers.
// Stale sockets are terminated so account character leases and party slots clear.
import {WebSocket} from 'ws';
export function createWorldHeartbeat({wss,intervalMs=30000,maxMissed=3}){
 const missed=new WeakMap();
 let pingsSent=0,staleTerminations=0,pingFailures=0;
 function track(ws){
  missed.set(ws,0);
  ws.on('pong',()=>missed.set(ws,0));
 }
 function sweep(){
  for(const ws of wss.clients){
   if(ws.readyState!==WebSocket.OPEN)continue;
   const count=(missed.get(ws)??0)+1;
   if(count>=maxMissed){staleTerminations++;ws.terminate();continue}
   missed.set(ws,count);
   try{ws.ping();pingsSent++}catch{pingFailures++;ws.terminate()}
  }
 }
 const timer=setInterval(sweep,intervalMs);
 timer.unref?.();
 return {track,sweep,stats:()=>({pingsSent,staleTerminations,pingFailures}),
  close:()=>clearInterval(timer)};
}
