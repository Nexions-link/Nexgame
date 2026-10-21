// P1.5.1. Real Render staging, exactly 10 guest bots and NO Neon connection.
// HARD-CODED staging endpoint: never use this against production accounts.
// The first 30-min test failed at ~17m with 9/10 population and no disconnect
// diagnostics. Observe, classify, recover and validate every missing socket.
import {WebSocket} from 'ws';
import {performance} from 'node:perf_hooks';
import {writeFileSync} from 'node:fs';
import {localToNormal} from '../spherical-pve.js';

const origin='https://ngw-capacity-test-20261019.onrender.com';
const socketUrl='wss://ngw-capacity-test-20261019.onrender.com/ws/nexgameworld';
const expectedVersion='0.6.43.63',durationMs=15*60*1000;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const started=performance.now(),clients=[],allSockets=[],pingMs=[],samples=[],drops=[];
const wait=async(predicate,limit=9000,description='condition')=>{
 const until=performance.now()+limit;
 while(performance.now()<until){
  const v=predicate();if(v)return v;
  await sleep(75);
 }
 throw Error('Timed out waiting for '+description);
};
const p95=values=>{
 const a=[...values].sort((x,y)=>x-y);
 return a.length?Math.round(a[Math.ceil(a.length*.95)-1]*100)/100:null;
};
let snapshots=0,attacks=0,realHits=0,chatMessages=0,moves=0,
 plannedReconnects=0,recoveredUnplanned=0,unexpectedDisconnects=0,peakHeap=0;
async function health(){
 const response=await fetch(origin+'/health',{signal:AbortSignal.timeout(15000),cache:'no-store'});
 if(!response.ok)throw Error('Staging HTTP '+response.status);
 const h=await response.json();
 if(h.build!==expectedVersion||h.world!=='nexgameworld'||
    !h.guestWorldEnabled||h.databaseConfigured||h.authenticatedWorldEnabled)
  throw Error('Unsafe staging target or unexpected release; abort all traffic');
 return h;
}
async function connect(index){
 const ws=new WebSocket(socketUrl,{handshakeTimeout:12000});
 const c={index,ws,id:null,snapshots:0,lastSnapshot:null,lastSnapshotAt:0,
  intentional:false,closed:false,closeCode:null,closeReason:null,
  error:null,pongs:new Map()};
 allSockets.push(c);
 ws.on('message',buffer=>{
  let event;
  try{event=JSON.parse(String(buffer))}catch{return}
  if(event.type==='welcome')c.id=event.id;
  if(event.type==='snapshot'){
   c.snapshots++;snapshots++;c.lastSnapshot=event;
   c.lastSnapshotAt=Date.now();
  }
  if(event.type==='combat')realHits++;
 });
 ws.on('pong',data=>{
  const id=String(data),ms=c.pongs.get(id);
  if(ms!==undefined){pingMs.push(performance.now()-ms);c.pongs.delete(id)}
 });
 ws.on('close',(code,reason)=>{
  c.closed=true;c.closeCode=code;c.closeReason=String(reason).slice(0,65);
  if(!c.intentional){
   unexpectedDisconnects++;
   const issue={ms:Math.round(performance.now()-started),index,code,
    reason:c.closeReason,kind:'unexpected_close'};
   drops.push(issue);
   console.log('P1.5.1 SOCKET DROP',JSON.stringify(issue));
  }
 });
 ws.on('error',error=>{
  c.error=String(error?.code||error?.message||'transport_failure').slice(0,100);
 });
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('WebSocket handshake timeout for '+index)),18000);
  ws.once('open',()=>{clearTimeout(timer);resolve()});
  ws.once('error',error=>{clearTimeout(timer);reject(error)});
 });
 ws.send(JSON.stringify({type:'join',radius:261,
  name:'Испытание '+(index+1),heading:Math.PI/2,level:1,
  normal:localToNormal(-9+(index%5)*.55,-24+Math.floor(index/5)*.55,261)}));
 await wait(()=>c.id,9000,'join '+index);
 await wait(()=>c.snapshots>=2,9000,'initial snapshots '+index);
 return c;
}
async function replace(index,planned=false,why='temporary_disconnect'){
 const old=clients[index];
 old.intentional=planned;
 if(old.ws.readyState!==WebSocket.CLOSED)old.ws.terminate();
 await wait(()=>old.ws.readyState===WebSocket.CLOSED,4000,'old socket closed');
 const before=old.id;
 let updated;
 for(let attempt=1;attempt<=3;attempt++){
  try{
   if(attempt>1)await sleep(300*attempt);
   updated=await connect(index);break;
  }catch(err){
   drops.push({ms:Math.round(performance.now()-started),index,kind:'reconnect_failure',
    attempt,message:String(err.message||err).slice(0,90)});
   if(attempt===3)throw err;
  }
 }
 if(updated.id===before)throw Error('reused ephemeral identity after reconnect');
 clients[index]=updated;
 if(planned)plannedReconnects++;else recoveredUnplanned++;
 await wait(()=>updated.lastSnapshot?.onlineCount===10,8000,'new session sees 10');
 await wait(()=>clients.every(c=>c.lastSnapshot?.onlineCount===10),8000,
  'everyone sees 10 after rejoin');
 // Delayed snapshots from earlier sessions must not retain ghost identities.
 for(const c of clients){
  const seen=c.lastSnapshot?.players||[];
  if(seen.some(x=>x.id===before))
   throw Error('ghost player remained visible after reconnect');
 }
 console.log('P1.5.1 RECONNECTED',JSON.stringify({
  index,planned,why,ms:Math.round(performance.now()-started)}));
}
async function sample(phase){
 const h=await health();
 peakHeap=Math.max(peakHeap,h.worldPerformance?.heapUsedMiB||0);
 const data={phase,ms:Math.round(performance.now()-started),
  serverPlayers:h.sphericalPlayers,clientSlots:clients.length,
  openSockets:clients.filter(c=>c.ws.readyState===WebSocket.OPEN).length,
  staleSnapshots:clients.filter(c=>Date.now()-c.lastSnapshotAt>5500).map(c=>c.index),
  pingP95Ms:p95(pingMs),snapshots,attacks,realHits,chatMessages,moves,
  unexpectedDisconnects,recoveredUnplanned,plannedReconnects,
  heapMiB:h.worldPerformance?.heapUsedMiB,loopP95Ms:h.worldPerformance?.eventLoopP95Ms,
  heartbeat:h.websocketHealth};
 samples.push(data);
 console.log('P1.5.1 DIAGNOSTIC',JSON.stringify(data));
 if((h.worldMetrics?.progressSaveFailures||0)>0)
  throw Error('World save errors observed');
 if(h.worldPerformance?.eventLoopP95Ms>275)
  throw Error('Game loop p95 above 275 ms');
 if(h.worldPerformance?.heapUsedMiB>220)
  throw Error('Game V8 heap above 220 MiB');
 if(h.sphericalPlayers!==10){
  const lost=clients.filter(c=>c.ws.readyState!==WebSocket.OPEN||
   Date.now()-c.lastSnapshotAt>5500);
  drops.push({kind:'population_mismatch',ms:data.ms,
   reported:h.sphericalPlayers,socketStates:clients.map(c=>({
    index:c.index,state:c.ws.readyState,code:c.closeCode,
    lastSnapshotAgeMs:Date.now()-c.lastSnapshotAt
   })),serverCloses:h.websocketHealth?.recentCloses});
  console.log('P1.5.1 POPULATION MISMATCH',JSON.stringify(drops.at(-1)));
  // Let close events arrive before classifying an active socket as a ghost.
  await sleep(1800);
  const remaining=(await health()).sphericalPlayers;
  if(remaining===10)return;
  const candidates=clients.filter(c=>c.ws.readyState!==WebSocket.OPEN||
   Date.now()-c.lastSnapshotAt>5500);
  if(candidates.length!==1)
   throw Error('Population '+remaining+'; cannot safely identify single dropped connection');
  await replace(candidates[0].index,false,'lost_connection_or_stale_snapshot');
  const recovered=(await health()).sphericalPlayers;
  if(recovered!==10)throw Error('Failed to restore 10 players: '+recovered);
 }
 if(clients.some(c=>c.ws.readyState!==WebSocket.OPEN))
  throw Error('Dead WebSocket despite reported full world population');
}
function send(c,packet){
 if(c.ws.readyState!==WebSocket.OPEN)return false;
 c.ws.send(JSON.stringify(packet));return true;
}
try{
 await health();
 for(let i=0;i<10;i++)clients.push(await connect(i));
 await wait(async()=>{
  const h=await health();return h.sphericalPlayers===10;
 },10000,'ten player world');
 await sample('started');
 let seq=0,statsAt=performance.now(),lastMove=0,lastAttack=0,lastChat=0,
  lastPing=0,dropA=false,dropB=false;
 while(performance.now()-started<durationMs){
  const now=performance.now(),elapsed=now-started;
  if(!dropA&&elapsed>=110000){
   dropA=true;await Promise.all([replace(2,true,'planned_network_dropout'),
    replace(7,true,'planned_network_dropout')]);
   await sample('rejoined_two');
  }
  if(!dropB&&elapsed>=415000){
   dropB=true;await Promise.all([replace(1,true,'planned_network_dropout'),
    replace(8,true,'planned_network_dropout')]);
   await sample('rejoined_two_again');
  }
  if(now-lastMove>=125){
   lastMove=now;
   for(const c of clients){
    const x=-9+(c.index%5)*.55+Math.sin(seq*.025+c.index)*.12;
    const z=-24+Math.floor(c.index/5)*.55+Math.cos(seq*.029+c.index)*.12;
    if(send(c,{type:'move',radius:261,heading:Math.PI/2,moving:true,
     normal:localToNormal(x,z,261)}))moves++;
   }
  }
  if(now-lastAttack>=450){
   lastAttack=now;
   if(send(clients[(seq*3+1)%10],
    {type:'attack',abilityId:'autoAttack',mobId:'dolgonog-0'}))attacks++;
  }
  if(now-lastChat>=2200){
   lastChat=now;
   if(send(clients[seq%10],
    {type:'chatSend',channel:'world',text:'P1.5.1 тест '+seq}))chatMessages++;
  }
  if(now-lastPing>=3000){
   lastPing=now;
   for(const c of clients){
    if(c.ws.readyState===WebSocket.OPEN){
     const id=String(seq)+'-'+c.index;
     c.pongs.set(id,performance.now());c.ws.ping(id);
    }
   }
  }
  if(performance.now()-statsAt>=25000){
   statsAt=performance.now();
   await sample('load');
  }
  seq++;
  await sleep(80);
 }
 await sample('finished');
 if(plannedReconnects!==4)throw Error('Missing intentional network disruptions');
 if(clients.some(c=>c.ws.readyState!==WebSocket.OPEN))
  throw Error('Some virtual players offline at end');
 if(realHits===0)throw Error('No successful combat registered');
 if(pingMs.length<600||p95(pingMs)>1500)
  throw Error('WebSocket RTT above 1500ms or too few pings');
 if(recoveredUnplanned>2)throw Error('Too many unexpected WebSocket recoveries');
 const final={passed:true,build:expectedVersion,stagingOnly:true,neon:false,
  durationMs:Math.round(performance.now()-started),concurrentPlayers:10,
  plannedReconnects,recoveredUnplanned,unexpectedDisconnects,
  pingP95Ms:p95(pingMs),realHits,moves,chatMessages,peakHeapMiB:peakHeap,
  drops,samples};
 writeFileSync('p1-5-1-report.json',JSON.stringify(final,null,2)+'\n');
 console.log('P1.5.1 RESULT PASS',JSON.stringify({durationMs:final.durationMs,
  plannedReconnects,recoveredUnplanned,unexpectedDisconnects,pingP95Ms:p95(pingMs),
  realHits,peakHeapMiB:peakHeap}));
}catch(error){
 const fail={passed:false,build:expectedVersion,stagingOnly:true,neon:false,
  elapsedMs:Math.round(performance.now()-started),error:String(error?.stack||error),
  peakHeapMiB:peakHeap,unexpectedDisconnects,recoveredUnplanned,plannedReconnects,
  drops,samples};
 writeFileSync('p1-5-1-report.json',JSON.stringify(fail,null,2)+'\n');
 console.error('P1.5.1 RESULT FAIL',String(error?.stack||error));
 process.exitCode=1;
}finally{
 for(const c of allSockets){
  c.intentional=true;
  if(c.ws.readyState===WebSocket.OPEN||c.ws.readyState===WebSocket.CONNECTING)
   c.ws.terminate();
 }
}
