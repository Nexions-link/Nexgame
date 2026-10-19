// Isolated load probe. Run against a LOCAL guest-enabled server only.
// Never run against production: production requires real account sessions.
import {WebSocket} from 'ws';
import {performance} from 'node:perf_hooks';
const target=process.env.NGW_LOAD_URL||'ws://127.0.0.1:3000/ws/nexgameworld';
if(!/^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(target))
 throw Error('Refusing to load-test a non-local server');
const stages=[5,10,20,30,50,75,100];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function runStage(count){
 const sockets=[];let welcomed=0,snapshots=0,bytes=0,errors=0;
 const started=performance.now();
 try{
  await Promise.all(Array.from({length:count},(_,i)=>new Promise(resolve=>{
   const ws=new WebSocket(target);sockets.push(ws);
   let settled=false;const done=()=>{if(!settled){settled=true;resolve()}};
   ws.on('open',()=>{
    ws.send(JSON.stringify({type:'join',name:'LoadTest'+i,radius:261,heading:0,
     normal:[0,1,0],level:1,equipment:{}}));
    setTimeout(done,1200);
   });
   ws.on('message',raw=>{
    bytes+=raw.length;
    try{const event=JSON.parse(String(raw));if(event.type==='welcome'){welcomed++;done()}
     if(event.type==='snapshot')snapshots++;}catch{errors++}
   });
   ws.on('error',()=>{errors++;done()});
   ws.on('close',done);
   setTimeout(done,3500);
  })));
  await sleep(3000);
  const active=sockets.filter(ws=>ws.readyState===WebSocket.OPEN).length;
  return {count,welcomed,active,snapshots,receivedMB:+(bytes/1048576).toFixed(2),
   errors,elapsedMs:Math.round(performance.now()-started)};
 }finally{for(const ws of sockets)ws.terminate()}
}
for(const count of stages){
 const result=await runStage(count);console.log(JSON.stringify(result));
 if(result.active<count||result.welcomed<count||result.errors)break;
 await sleep(800);
}
