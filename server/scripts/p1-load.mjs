// P1.4. Disposable, local-only load test: never connect to production Render/Neon.
// Real Node WebSockets simulate 5 and 10 browser clients with jitter, combat,
// chat, movement and simultaneous reconnects. Run: node scripts/p1-load.mjs
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {performance} from 'node:perf_hooks';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {WebSocket} from 'ws';
import {localToNormal} from '../spherical-pve.js';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check,limitMs=6000,subject='condition')=>{
 const deadline=performance.now()+limitMs;
 while(performance.now()<deadline){
  const value=await check();
  if(value)return value;
  await wait(35);
 }
 throw Error('Timed out awaiting '+subject);
};
const p95=values=>{
 if(!values.length)return 0;
 const sorted=[...values].sort((a,b)=>a-b);
 return Math.round(sorted[Math.ceil(sorted.length*.95)-1]*10)/10;
};
const percentile95=values=>p95(values);
const pct=(x)=>Math.round(x*100)/100;
const port=()=>new Promise(resolve=>{
 const tcp=createServer();
 tcp.listen(0,'127.0.0.1',()=>{
  const port=tcp.address().port;
  tcp.close(()=>resolve(port));
 });
});
async function runCohort(size,durationMs){
 const storage=await mkdtemp(join(tmpdir(),'ngw-load-'));
 const p=await port(),endpoint='http://127.0.0.1:'+p;
 const env={...process.env,PORT:String(p),DATABASE_URL:'',
  NGW_AUTH_WORLD_ENABLED:'false',NGW_GUEST_WORLD_ENABLED:'true',
  NGW_CHEST_DATA_FILE:join(storage,'chest.json'),
  NGW_ACCOUNTS_MIGRATE:'no'};
 // Isolate the test from any ambient developer/CI database credentials.
 for(const key of Object.keys(env))
  if(/NEON|DATABASE|POSTGRES|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE/i.test(key)
     &&key!=='DATABASE_URL')delete env[key];
 const child=spawn(process.execPath,['index.js'],{
  cwd:root,env,stdio:['ignore','ignore','pipe']
 });
 let errors='';
 child.stderr.on('data',data=>{errors=(errors+String(data)).slice(-5000)});
 const clients=[],allClients=[],latencies=[],chatId='P1.4 нагрузка ';
 let unexpectedClosures=0,generatedMoves=0,generatedAttacks=0,generatedChats=0;
 let generatedHeals=0,reconnects=0,maxHeap=0;
 const jitterTimers=new Set();
 const health=async()=>{
  const response=await fetch(endpoint+'/health',{signal:AbortSignal.timeout(2500)});
  assert.equal(response.status,200);
  return response.json();
 };
 const open=async(index)=>{
  const socket=new WebSocket('ws://127.0.0.1:'+p+'/ws/nexgameworld');
  const state={index,socket,id:null,expectedClose:false,snapshots:0,
   chat:0,attacks:0,combatAccepted:0,chatRejected:0,partyState:null,
   partyInvites:[],lastSnapshot:null,disconnects:0,
   latestSnapshotAt:0,startedAt:Date.now(),pending:new Map()};
  allClients.push(state);
  socket.on('message',raw=>{
   const event=JSON.parse(String(raw));
   if(event.type==='welcome')state.id=event.id;
   else if(event.type==='snapshot'){
    state.snapshots++;state.lastSnapshot=event;
    state.latestSnapshotAt=Date.now();
   }else if(event.type==='chat'&&event.text?.startsWith(chatId))state.chat++;
   else if(event.type==='combat'||event.type==='combatRejected'){
    state.attacks++;
    if(event.type==='combat')state.combatAccepted++;
   }else if(event.type==='partyInvite')state.partyInvites.push(event);
   else if(event.type==='partyState')state.partyState=event;
   else if(event.type==='chatRejected')state.chatRejected++;
  });
  socket.on('pong',buffer=>{
   const id=String(buffer),start=state.pending.get(id);
   if(start!==undefined){
    latencies.push(performance.now()-start);state.pending.delete(id);
   }
  });
  socket.on('close',()=>{
   state.disconnects++;
   if(!state.expectedClose)unexpectedClosures++;
  });
  await new Promise((ok,bad)=>{
   socket.once('open',ok);socket.once('error',bad);
  });
  const x=-9+(index%5)*.55,z=-24+Math.floor(index/5)*.55;
  socket.send(JSON.stringify({type:'join',name:'Нагрузочный игрок '+(index+1),
   radius:261,normal:localToNormal(x,z,261),heading:Math.PI/2,level:1}));
  await until(()=>state.id,4000,'welcome for client '+index);
  return state;
 };
 const send=(c,event)=>{
  if(c?.socket.readyState!==WebSocket.OPEN)return false;
  c.socket.send(JSON.stringify(event));return true;
 };
 const delayedSend=(c,event,lag)=>{
  const timer=setTimeout(()=>{
   jitterTimers.delete(timer);
   send(c,event);
  },lag);
  jitterTimers.add(timer);
 };
 const reconnect=async(index)=>{
  const old=clients[index],oldId=old.id;
  old.expectedClose=true;
  await new Promise(resolve=>{
   old.socket.once('close',resolve);
   old.socket.close(1000,'Synthetic network drop');
   setTimeout(resolve,1000).unref?.();
  });
  clients[index]=await open(index);
  assert.notEqual(oldId,clients[index].id,'fresh socket must have fresh ID');
  reconnects++;return oldId;
 };
 try{
  await until(async()=>{
   if(child.exitCode!==null)throw Error('Disposable server died: '+errors);
   try{return (await health()).world==='nexgameworld'}catch{return false}
  },9000,'disposable guest world start');
  clients.push(...await Promise.all(Array.from({length:size},(_,i)=>open(i))));
  await until(async()=>((await health()).sphericalPlayers===size),4000,'full cohort join');
  await until(()=>clients.every(c=>c.snapshots>=2),3500,'first visual snapshots');
  const leader=clients[0];
  // Exercise one party and its server validation while the world is occupied.
  for(let i=1;i<Math.min(size,5);i++){
   send(leader,{type:'partyInvite',targetId:clients[i].id});
   await until(()=>clients[i].partyInvites.some(v=>v.fromId===leader.id),
    2500,'group invitation');
   send(clients[i],{type:'partyRespond',fromId:leader.id,accept:true});
   await until(()=>leader.partyState?.members?.length===i+1,
    2500,'group roster update');
  }
  assert.equal(leader.partyState.members.length,5);
  for(const member of clients.slice(0,5))
   await until(()=>member.partyState?.members?.length===5,2500,
    'consistent five-person group');
  send(leader,{type:'chatSend',channel:'party',text:chatId+'party'});
  await until(()=>clients.slice(0,5).every(c=>c.chat>=1),2500,'party channel delivery');
  if(size===10){
   await wait(100);
   assert.ok(clients.slice(5).every(c=>c.chat===0),
    'outsiders must not receive party chat under load');
  }
  const start=performance.now();let lastPing=0,lastChat=0,lastAttack=0,lastHeal=0;
  let round=0,doneReconnect=false,oldIds=[];
  while(performance.now()-start<durationMs){
   const elapsed=performance.now()-start;
   for(let i=0;i<size;i++){
    const c=clients[i];
    const baseX=-9+(i%5)*.55,baseZ=-24+Math.floor(i/5)*.55;
    // Deterministic 0–135ms packet jitter around 8Hz mobile movement.
    const x=baseX+Math.sin(round*.075+i*.35)*.2;
    const z=baseZ+Math.cos(round*.065+i*.4)*.2;
    delayedSend(c,{type:'move',radius:261,normal:localToNormal(x,z,261),
     heading:Math.PI/2,moving:true},(round*17+i*37)%136);
    generatedMoves++;
   }
   if(elapsed-lastPing>800){
    lastPing=elapsed;
    for(const c of clients)if(c.socket.readyState===WebSocket.OPEN){
     const id=String(round)+'-'+c.index;
     c.pending.set(id,performance.now());
     c.socket.ping(id);
    }
    const info=await health();
    assert.equal(info.ok,true);
    assert.equal(info.sphericalPlayers,size,'game population must recover after rejoin');
    maxHeap=Math.max(maxHeap,info.worldPerformance?.heapUsedMiB??0);
   }
   if(elapsed-lastChat>1150){
    lastChat=elapsed;
    const c=clients[(round+1)%size];
    if(send(c,{type:'chatSend',channel:'world',text:chatId+round}))generatedChats++;
   }
   if(elapsed-lastAttack>400){
    lastAttack=elapsed;
    const c=clients[(round*3+1)%size];
    if(send(c,{type:'attack',abilityId:'autoAttack',mobId:'dolgonog-0'}))
     generatedAttacks++;
   }
   if(elapsed-lastHeal>1500){
    lastHeal=elapsed;
    const c=clients[(round+2)%size];
    if(send(c,{type:'heal'}))generatedHeals++;
   }
   if(!doneReconnect&&elapsed>=durationMs*.52){
    doneReconnect=true;
    // Two simultaneous unstable mobile connections (other players stay in).
    const indices=size===5?[2,4]:[2,8];
    const old=await Promise.all(indices.map(reconnect));
    oldIds.push(...old);
    await until(async()=>((await health()).sphericalPlayers===size),
     3000,'population after simultaneous reconnect');
   }
   round++;
   await wait(125);
  }
  await wait(350);
  const final=await health();
  assert.equal(final.sphericalPlayers,size);
  assert.equal(unexpectedClosures,0,'healthy players must not be disconnected by synthetic activity');
  assert.equal(reconnects,2);
  assert.ok(latencies.length>=size*2,'WebSocket ping/pong samples missing');
  assert.ok(p95(latencies)<1250,'95th-percentile loopback websocket latency exceeded 1.25 s');
  const snapshotTotal=allClients.reduce((sum,c)=>sum+c.snapshots,0);
  const snapshotsPerClientSecond=snapshotTotal/(size*(durationMs/1000));
  assert.ok(snapshotsPerClientSecond>=2,
   'visual updates stalled below 2 snapshots per player-second');
  assert.ok(final.worldPerformance&&Number.isFinite(final.worldPerformance.heapUsedMiB),
   'Render health diagnostics must expose finite memory usage');
  assert.ok(final.worldPerformance.eventLoopP95Ms<250,
   'server event-loop p95 exceeded 250 ms on test runner');
  assert.ok(maxHeap<250,'test server consumed more than 250 MiB V8 heap');
  const receivedChats=allClients.reduce((sum,c)=>sum+c.chat,0);
  assert.ok(generatedChats>=2,'test did not send chat messages');
  assert.ok(receivedChats>=size,'world chat broadcasts stopped under load');
  assert.ok(allClients.reduce((sum,c)=>sum+c.attacks,0)>0,
   'combat commands produced no server response');
  assert.ok(allClients.reduce((sum,c)=>sum+c.combatAccepted,0)>0,
   'combat exercise never produced an authoritative hit');
  for(const oldId of oldIds){
   assert.ok(clients.every(c=>c.id!==oldId));
   assert.ok(clients.every(c=>c.lastSnapshot
    &&!c.lastSnapshot.players.some(x=>x.id===oldId)),
    'ghost avatar remains after reconnect');
  }
  assert.ok(clients.every(c=>c.lastSnapshot?.onlineCount===size),
   'snapshots disagree about current population');
  const report={players:size,durationMs,generatedMoves,generatedAttacks,generatedHeals,
   generatedChats,receivedChats,reconnects,unexpectedClosures,
   combatAccepted:allClients.reduce((sum,c)=>sum+c.combatAccepted,0),
   snapshots:snapshotTotal,snapshotsPerClientSecond:pct(snapshotsPerClientSecond),
   pingSamples:latencies.length,pingP95Ms:percentile95(latencies),
   heapPeakMiB:pct(maxHeap),serverHealth:final.worldPerformance,
   serverMetrics:final.worldMetrics};
  console.log('P1.4 LOAD RESULT '+JSON.stringify(report));
  return report;
 }finally{
  for(const timer of jitterTimers)clearTimeout(timer);
  for(const client of allClients){
   client.expectedClose=true;
   if(client.socket.readyState===WebSocket.OPEN)client.socket.terminate();
  }
  child.kill('SIGTERM');
  await Promise.race([
   new Promise(resolve=>child.once('exit',resolve)),
   wait(2500).then(()=>child.kill('SIGKILL'))
  ]);
  await rm(storage,{recursive:true,force:true});
 }
}
const results=[];
try{
 for(const count of [5,10])results.push(await runCohort(count,count===5?5000:7500));
 const path=process.env.NGW_LOAD_REPORT||resolve(root,'p1-load-results.json');
 await mkdir(resolve(path,'..'),{recursive:true});
 await writeFile(path,JSON.stringify({phase:'P1.4',environment:'isolated GitHub runner',
  productionTraffic:false,results},null,2)+'\n');
 console.log('P1.4 PASSED: synthetic load report '+path);
}catch(error){
 console.error('P1.4 FAILED:',error?.stack||error);
 process.exitCode=1;
}
