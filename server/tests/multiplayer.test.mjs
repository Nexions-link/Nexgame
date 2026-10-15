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
 const snapshots=new Map(),combats=[],credits=[],enemyAttacks=[],partyStates=[],partyInvites=[],partyNotices=[],chatMessages=[],chatRejected=[];let welcome=null;
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
  if(payload.type==='chat')chatMessages.push(payload);
  if(payload.type==='chatRejected')chatRejected.push(payload);
 });
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
 return {ws,snapshots,combats,credits,enemyAttacks,partyStates,partyInvites,partyNotices,chatMessages,chatRejected,getWelcome:()=>welcome};
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
  assert.equal(health.protocol,7);
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

test('world messages reach all, party chat stays private, and spoofed names are ignored',
 {timeout:14000},async()=>{
 const port=await freePort();
 const child=spawn(process.execPath,['index.js'],{
  cwd:new URL('../',import.meta.url),
  env:{...process.env,PORT:String(port)},stdio:'ignore'
 });
 let a,b,c;
 try{
  const health=await ready(port);assert.equal(health.protocol,7);
  a=await connect(port);b=await connect(port);c=await connect(port);
  await new Promise(resolve=>setTimeout(resolve,85));
  const aid=a.getWelcome().id,bid=b.getWelcome().id;
  a.ws.send(JSON.stringify({type:'join',name:'Гром',x:0,z:10,yaw:0}));
  b.ws.send(JSON.stringify({type:'join',name:'Друг',x:0,z:10,yaw:0}));
  c.ws.send(JSON.stringify({type:'join',name:'Посторонний',x:0,z:10,yaw:0}));
  await new Promise(resolve=>setTimeout(resolve,80));
  a.ws.send(JSON.stringify({type:'chatSend',channel:'world',text:'Всем привет!',name:'Не Гром'}));
  await new Promise(resolve=>setTimeout(resolve,95));
  assert.equal(a.chatMessages.length,1);
  assert.equal(b.chatMessages.length,1);
  assert.equal(c.chatMessages.length,1);
  assert.equal(c.chatMessages[0].name,'Гром');
  assert.equal(c.chatMessages[0].fromId,aid);
  a.ws.send(JSON.stringify({type:'partyInvite',targetId:bid}));
  await new Promise(resolve=>setTimeout(resolve,85));
  b.ws.send(JSON.stringify({type:'partyRespond',fromId:aid,accept:true}));
  await new Promise(resolve=>setTimeout(resolve,1100));
  b.ws.send(JSON.stringify({type:'chatSend',channel:'party',text:'Только друзьям'}));
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(a.chatMessages.filter(m=>m.channel==='party').length,1);
  assert.equal(b.chatMessages.filter(m=>m.channel==='party').length,1);
  assert.equal(c.chatMessages.filter(m=>m.channel==='party').length,0);
  c.ws.send(JSON.stringify({type:'chatSend',channel:'party',text:'Я не в группе'}));
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(c.chatRejected.some(m=>m.reason.includes('группу')));
  b.ws.send(JSON.stringify({type:'partyLeave'}));
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.ok(a.partyNotices.some(m=>m.message.includes('покинул группу')));
 }finally{
  a?.ws.close();b?.ws.close();c?.ws.close();child.kill('SIGTERM');
 }
});

test('respawn synchronizes a death teleport and stops shared mobs from striking the old location',
 {timeout:12000},async()=>{
 const port=await freePort(),child=spawn(process.execPath,['index.js'],{
  cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(port)},stdio:'ignore'
 });
 let actor;
 try{
  const health=await ready(port);assert.equal(health.protocol,7);
  actor=await connect(port);
  const respawns=[];
  actor.ws.on('message',raw=>{const m=JSON.parse(String(raw));if(m.type==='respawnAccepted')respawns.push(m)});
  actor.ws.send(JSON.stringify({type:'join',name:'Защитник',x:-9,z:-23,yaw:0,level:1,hp:120,maxHp:120}));
  await new Promise(resolve=>setTimeout(resolve,80));
  actor.ws.send(JSON.stringify({type:'attack',abilityId:'autoAttack',mobId:0}));
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.ok(actor.enemyAttacks.some(m=>m.mobId===0),'monster attacks before respawn');
  const previousAttacks=actor.enemyAttacks.length;
  actor.ws.send(JSON.stringify({type:'respawn'}));
  await new Promise(resolve=>setTimeout(resolve,250));
  assert.equal(respawns.length,1,'authoritative teleport acknowledged');
  assert.deepEqual([respawns[0].x,respawns[0].z],[0,10]);
  const last=[...actor.snapshots.values()].at(-1);
  const self=last.players.find(p=>p.id===actor.getWelcome().id);
  assert.deepEqual([self.x,self.z],[0,10]);
  assert.equal(last.mobs[0].aggroId,null,'creature abandons stale target');
  assert.equal(actor.enemyAttacks.length,previousAttacks,'no further attacks at corpse position');
  actor.ws.send(JSON.stringify({type:'respawn'}));
  await new Promise(resolve=>setTimeout(resolve,120));
  assert.equal(respawns.length,1,'cannot spam respawn teleports');
 }finally{actor?.ws.close();child.kill('SIGTERM')}
});
