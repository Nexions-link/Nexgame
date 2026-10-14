import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {WebSocket} from 'ws';

async function freePort(){
 const server=createServer();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const port=server.address().port;
 await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 return port;
}
async function ready(port,timeout=8000){
 const until=Date.now()+timeout;
 while(Date.now()<until){
  try{
   const response=await fetch('http://127.0.0.1:'+port+'/health');
   if(response.ok)return response.json();
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,70));
 }
 throw Error('World server did not become healthy');
}
async function connect(port){
 const ws=new WebSocket('ws://127.0.0.1:'+port);
 const snapshots=new Map(),combats=[],credits=[],enemyAttacks=[],partyStates=[],partyInvites=[],partyNotices=[];let welcome=null;
 ws.on('message',message=>{
  const payload=JSON.parse(String(message));
  if(payload.type==='welcome')welcome=payload;
  if(payload.type==='snapshot'&&Number.isInteger(payload.tick)){
   snapshots.set(payload.tick,payload);
  }
  if(payload.type==='combat')combats.push(payload);
  if(payload.type==='killCredit')credits.push(payload);
  if(payload.type==='mobAttack')enemyAttacks.push(payload);
  if(payload.type==='partyState')partyStates.push(payload);
  if(payload.type==='partyInvite')partyInvites.push(payload);
  if(payload.type==='partyNotice')partyNotices.push(payload);
 });
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
 return {ws,snapshots,combats,credits,enemyAttacks,partyStates,partyInvites,partyNotices,getWelcome:()=>welcome};
}

test('two players receive identical mob states on the same world tick', {timeout:14000},async()=>{
 const port=await freePort();
 const child=spawn(process.execPath,['index.js'],{
  cwd:new URL('../',import.meta.url),
  env:{...process.env,PORT:String(port)},
  stdio:'ignore'
 });
 let a,b;
 try{
  const health=await ready(port);
  assert.equal(health.protocol,4);
  assert.equal(health.mobs,9);
  a=await connect(port);b=await connect(port);
  await new Promise(resolve=>setTimeout(resolve,650));
  assert.equal(a.getWelcome()?.mobs?.length,9);
  assert.equal(b.getWelcome()?.mobs?.length,9);
  const matches=[...a.snapshots.keys()].filter(tick=>b.snapshots.has(tick));
  assert.ok(matches.length>=2,'both clients must receive multiple identical ticks');
  for(const tick of matches){
   const am=a.snapshots.get(tick).mobs,bm=b.snapshots.get(tick).mobs;
   assert.equal(am.length,9);
   assert.deepEqual(am,bm,'mobs and animation phases must match at tick '+tick);
  }
 }finally{
  a?.ws.close();b?.ws.close();child.kill('SIGTERM');
 }
});

test('two real WebSockets land hits on the same creature and both receive kill credit',
 {timeout:12000},async()=>{
 const port=await freePort(),child=spawn(process.execPath,['index.js'],{
  cwd:new URL('../',import.meta.url),
  env:{...process.env,PORT:String(port)},stdio:'ignore'
 });
 let a,b;
 try{
  await ready(port);
  a=await connect(port);b=await connect(port);
  const join={type:'join',x:-9,z:-23,yaw:0,level:60,equipment:{weapon:'wornAxe'}};
  a.ws.send(JSON.stringify(join));b.ws.send(JSON.stringify(join));
  await new Promise(resolve=>setTimeout(resolve,120));
  a.ws.send(JSON.stringify({type:'attack',abilityId:'thunderStomp'}));
  b.ws.send(JSON.stringify({type:'attack',abilityId:'thunderStomp'}));
  await new Promise(resolve=>setTimeout(resolve,120));
  a.ws.send(JSON.stringify({type:'attack',abilityId:'autoAttack',mobId:0}));
  await new Promise(resolve=>setTimeout(resolve,350));
  assert.ok(a.combats.some(event=>event.hits.some(hit=>hit.id===0&&hit.dead)),
   'player A sees server-confirmed mob death');
  assert.ok(b.combats.some(event=>event.hits.some(hit=>hit.id===0&&hit.dead)),
   'player B sees exactly the same death');
  assert.equal(a.credits.filter(c=>c.mobId===0).length,1);
  assert.equal(b.credits.filter(c=>c.mobId===0).length,1);
  assert.equal(a.credits[0].life,b.credits[0].life);
  const snapshots=[...a.snapshots.values()].filter(packet=>packet.mobs[0]?.dead);
  assert.ok(snapshots.length,'dead mob persists in authoritative snapshots');
  assert.equal(snapshots.at(-1).mobs[0].hp,0);
 }finally{
  a?.ws.close();b?.ws.close();child.kill('SIGTERM');
 }
});

test('two real WebSockets invite, accept, rename and dissolve a party on disconnect',
 {timeout:12000},async()=>{
 const port=await freePort();
 const child=spawn(process.execPath,['index.js'],{
  cwd:new URL('../',import.meta.url),
  env:{...process.env,PORT:String(port)},stdio:'ignore'
 });
 let a,b;
 try{
  await ready(port);
  a=await connect(port);b=await connect(port);
  await new Promise(resolve=>setTimeout(resolve,100));
  const idA=a.getWelcome()?.id,idB=b.getWelcome()?.id;
  assert.ok(idA&&idB);
  a.ws.send(JSON.stringify({type:'join',name:'Грозовой Рог',x:0,z:10,yaw:0}));
  b.ws.send(JSON.stringify({type:'join',name:'Серебряный Рог',x:0,z:10,yaw:0}));
  await new Promise(resolve=>setTimeout(resolve,75));
  a.ws.send(JSON.stringify({type:'partyInvite',targetId:idB}));
  await new Promise(resolve=>setTimeout(resolve,110));
  assert.equal(b.partyInvites.at(-1)?.fromId,idA);
  assert.equal(b.partyInvites.at(-1)?.fromName,'Грозовой Рог');
  b.ws.send(JSON.stringify({type:'partyRespond',fromId:idA,accept:true}));
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.deepEqual(a.partyStates.at(-1)?.members,b.partyStates.at(-1)?.members);
  assert.equal(a.partyStates.at(-1)?.members.length,2);
  assert.equal(a.partyStates.at(-1)?.leaderId,idA);
  b.ws.send(JSON.stringify({type:'rename',name:'Новый Рог'}));
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(a.partyStates.at(-1)?.members[1]?.name,'Новый Рог');
  b.ws.close();
  await new Promise(resolve=>setTimeout(resolve,140));
  assert.equal(a.partyStates.at(-1)?.groupId,null);
 }finally{
  a?.ws.close();b?.ws.close();child.kill('SIGTERM');
 }
});
