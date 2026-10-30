import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {WebSocket} from 'ws';
import {localToNormal} from '../spherical-pve.js';
import {FOREST_WOLF_SPAWNS} from '../../planet-test/forest-wolf-spawns.js';
import {CHEST_X,CHEST_Z} from '../chest.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function server(){
 const port=await new Promise(resolve=>{
  const s=createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
 });
 const processHandle=spawn(process.execPath,['index.js'],{
  cwd:new URL('../',import.meta.url),
  env:{...process.env,PORT:String(port),NGW_GUEST_WORLD_ENABLED:'true',NGW_CHEST_DATA_FILE:'/tmp/ngw-online-'+port+'.json'},
  stdio:['ignore','ignore','pipe']
 });
 let stderr='';processHandle.stderr.on('data',c=>{stderr+=c});
 for(let n=0;n<70;n++){
  if(processHandle.exitCode!==null)throw Error('Server crashed: '+stderr);
  try{const r=await fetch('http://127.0.0.1:'+port+'/health');if(r.ok)return {port,child:processHandle}}catch{}
  await sleep(65);
 }
 processHandle.kill();throw Error('Server did not open: '+stderr);
}
async function join(port,name,x,z,level=1,radius=261,equipment={}){
 const ws=new WebSocket('ws://127.0.0.1:'+port+'/ws/nexgameworld'),events=[];
 ws.on('message',raw=>events.push(JSON.parse(String(raw))));
 await new Promise((ok,fail)=>{ws.once('open',ok);ws.once('error',fail)});
 ws.send(JSON.stringify({type:'join',name,radius,heading:Math.PI/2,
  normal:localToNormal(x,z,radius),level,equipment}));
 return {ws,events,send:m=>ws.send(JSON.stringify(m)),close:()=>ws.close()};
}
async function until(get,timeout=3500){
 const started=Date.now();
 while(Date.now()-started<timeout){
  const val=get();if(val)return val;await sleep(35);
 }
 throw Error('Timed out waiting for expected network event');
}
test('two browsers share authoritative dolgonog health, kill credit and quest rewards', {timeout:10000},async()=>{
 const {port,child}=await server();let a,b;
 try{
  a=await join(port,'Молодой воин',-9,-24,1,261,{weapon:{id:'wornAxe'}});
  b=await join(port,'Старший воин',-9,-24,60,261,{weapon:{id:'scalpingStrength'}});
  const aw=await until(()=>a.events.find(e=>e.type==='welcome'));
  const bw=await until(()=>b.events.find(e=>e.type==='welcome'));
  assert.equal(aw.protocol,2);
  assert.equal(aw.mobs.length,26);
  a.send({type:'attack',abilityId:'autoAttack',mobId:'dolgonog-0'});
  await until(()=>a.events.find(e=>e.type==='combat'&&e.mobId==='dolgonog-0'));
  b.send({type:'attack',abilityId:'autoAttack',mobId:'dolgonog-0'});
  await until(()=>a.events.find(e=>e.type==='combat'&&e.hp===0&&e.mobId==='dolgonog-0'));
  const creditA=await until(()=>a.events.find(e=>e.type==='killCredit'&&e.mobId==='dolgonog-0'));
  const creditB=await until(()=>b.events.find(e=>e.type==='killCredit'&&e.mobId==='dolgonog-0'));
  assert.equal(creditA.life,creditB.life);
  assert.ok(Array.isArray(creditA.loot));
  const snap=await until(()=>b.events.find(e=>e.type==='snapshot'&&e.mobs[0].phase==='corpse'));
  assert.equal(snap.mobs[0].hp,0);
  assert.equal(snap.mobs[0].corpseUntil-snap.mobs[0].deathAt,30000);
  assert.equal(snap.mobs[0].respawnAt-snap.mobs[0].corpseUntil,30000);
  assert.ok(bw.id!==aw.id);
 }finally{a?.close();b?.close();child.kill()}
});
test('spherical parties, room-scoped chat and server chest reuse existing rules', {timeout:10000},async()=>{
 const {port,child}=await server();let a,b,c,d;
 try{
  a=await join(port,'Игрок А',CHEST_X,CHEST_Z);
  b=await join(port,'Игрок Б',CHEST_X,CHEST_Z);
  c=await join(port,'Игрок В',CHEST_X,CHEST_Z);
  d=await join(port,'Отдельная планета',CHEST_X,CHEST_Z,1,87);
  const aw=await until(()=>a.events.find(e=>e.type==='welcome'));
  const bw=await until(()=>b.events.find(e=>e.type==='welcome'));
  await until(()=>c.events.find(e=>e.type==='welcome'));
  await until(()=>d.events.find(e=>e.type==='welcome'));
  a.send({type:'partyInvite',targetId:bw.id});
  const invite=await until(()=>b.events.find(e=>e.type==='partyInvite'));
  assert.equal(invite.fromId,aw.id);
  b.send({type:'partyRespond',fromId:aw.id,accept:true});
  const party=await until(()=>a.events.find(e=>e.type==='partyState'&&e.members.length===2));
  assert.equal(party.leaderId,aw.id);
  a.send({type:'chatSend',channel:'party',text:'Привет, группа!'});
  await until(()=>b.events.find(e=>e.type==='chat'&&e.text==='Привет, группа!'));
  assert.equal(c.events.some(e=>e.type==='chat'&&e.text==='Привет, группа!'),false);
  await sleep(950); // Honor existing chat rate limit: at least 900 ms between messages.
  a.send({type:'chatSend',channel:'world',text:'Привет, мир!'});
  await until(()=>c.events.find(e=>e.type==='chat'&&e.text==='Привет, мир!'));
  assert.equal(d.events.some(e=>e.type==='chat'&&e.text==='Привет, мир!'),false);
  const inventory=[{id:'wornAxe',qty:1},{id:'healingPotion',qty:3},...Array(10).fill(null)];
  // A confirmed move into chest range pushes occupancy before any open/poll.
  a.send({type:'move',radius:261,normal:localToNormal(CHEST_X,CHEST_Z,261),
   heading:Math.PI/2,moving:false});
  const pushedStatus=await until(()=>a.events.find(e=>e.type==='chestStatus'));
  assert.equal(pushedStatus.occupied,0);
  a.send({type:'chestStatus'});
  const emptyStatus=await until(()=>a.events.filter(e=>e.type==='chestStatus').at(-1));
  assert.equal(emptyStatus.total,18);
  assert.equal(emptyStatus.occupied,0);
  a.send({type:'chestOpen',inventory});
  await until(()=>a.events.find(e=>e.type==='chestState'));
  a.send({type:'chestMove',action:'deposit',slot:0,requestId:'deposit-test-001'});
  const deposit=await until(()=>a.events.find(e=>e.type==='chestResult'&&e.requestId==='deposit-test-001'));
  assert.equal(deposit.ok,true);
  b.send({type:'chestStatus'});
  const usedStatus=await until(()=>b.events.find(e=>e.type==='chestStatus'&&e.occupied===1));
  assert.equal(usedStatus.total,18);
  b.send({type:'chestOpen',inventory:Array(12).fill(null)});
  const shared=await until(()=>b.events.find(e=>e.type==='chestState'&&e.slots.some(x=>x?.id==='wornAxe')));
  const slot=shared.slots.findIndex(x=>x?.id==='wornAxe');
  b.send({type:'chestMove',action:'withdraw',slot,requestId:'withdraw-test-001'});
  const withdrawn=await until(()=>b.events.find(e=>e.type==='chestResult'&&e.requestId==='withdraw-test-001'));
  assert.equal(withdrawn.ok,true);
  assert.equal(withdrawn.inventory.filter(Boolean).length,1);
  const stale=await until(()=>a.events.find(e=>e.type==='chestState'&&e.revision>=2));
  assert.equal(stale.slots[slot],null);
 }finally{for(const x of [a,b,c,d])x?.close();child.kill()}
});

// Regression: a missed mobile-frame update cannot strand server coordinates.
test('server catches up a divergent position before authenticated-distance chest check', {timeout:9000},async()=>{
 const {port,child}=await server();let client,timer;
 try{
  client=await join(port,'Путник',CHEST_X+12,CHEST_Z);
  await until(()=>client.events.find(e=>e.type==='welcome'));
  const normal=localToNormal(CHEST_X,CHEST_Z,261);
  const move=()=>client.send({type:'move',radius:261,normal,heading:Math.PI/2,moving:false});
  timer=setInterval(move,100);
  await sleep(2400);
  client.send({type:'chestOpen',inventory:Array(12).fill(null)});
  const accepted=await until(()=>client.events.find(e=>e.type==='chestState'));
  assert.equal(accepted.slots.length,18);
  assert.equal(client.events.some(e=>e.type==='chestResult'&&e.ok===false),false);
 }finally{clearInterval(timer);client?.close();child.kill()}
});

// Regression from iPhone: repeated turning used to take yaw beyond ±4π.
// The old handler silently dropped EVERY movement packet, leaving the server
// outside the chest interaction range even while the model stood beside it.
test('multiple full turns never strand an online hero outside the chest', {timeout:9000},async()=>{
 const {port,child}=await server();let hero,peer,timer;
 try{
  hero=await join(port,'Крутящийся герой',CHEST_X+8,CHEST_Z);
  peer=await join(port,'Наблюдатель',CHEST_X+8,CHEST_Z);
  const welcome=await until(()=>hero.events.find(e=>e.type==='welcome'));
  await until(()=>peer.events.find(e=>e.type==='welcome'));
  const chestNormal=localToNormal(CHEST_X,CHEST_Z,261);
  const turns=20*Math.PI+.35;
  timer=setInterval(()=>hero.send({type:'move',radius:261,
   normal:chestNormal,heading:turns,moving:true}),100);
  await sleep(1600);
  const snapshot=peer.events.filter(e=>e.type==='snapshot'
   &&e.players.some(p=>p.id===welcome.id&&Math.abs(p.heading-.35)<1e-5)).at(-1);
  assert.ok(snapshot,'server must accept and canonicalize a multi-turn yaw');
  hero.send({type:'chestOpen',inventory:Array(12).fill(null)});
  const chest=await until(()=>hero.events.find(e=>e.type==='chestState'));
  assert.equal(chest.slots.length,18);
  assert.equal(hero.events.some(e=>e.type==='chestResult'&&e.ok===false),false);
 }finally{clearInterval(timer);hero?.close();peer?.close();child.kill()}
});

test('warrior charge visual is shared with nearby observers without client-supplied endpoints',{timeout:9000},async()=>{
 const {port,child}=await server();let warrior,observer;
 try{
  warrior=await join(port,'Воин',-9,-24,8,261,{weapon:{id:'wornAxe'}});
  observer=await join(port,'Свидетель',-9,-24,1,261);
  const player=await until(()=>warrior.events.find(e=>e.type==='welcome'));
  await until(()=>observer.events.find(e=>e.type==='welcome'));
  warrior.send({type:'charge',mobId:'dolgonog-0'});
  const confirmed=await until(()=>warrior.events.find(e=>e.type==='chargeAccepted'));
  assert.equal(confirmed.mobId,'dolgonog-0');
  const effect=await until(()=>observer.events.find(e=>e.type==='chargeVisual'&&e.id===player.id));
  assert.deepEqual(effect.normal,confirmed.normal);
  assert.equal(effect.durationMs,confirmed.durationMs);
  assert.equal(effect.fromNormal.length,3);
  assert.ok(effect.fromNormal.every(Number.isFinite));
  assert.ok(!observer.events.some(e=>e.type==='chargeAccepted'));
 }finally{warrior?.close();observer?.close();child.kill();}
});

test('Whispering Forest: two real sockets witness the same wolves, combat and pack retaliation',
 {timeout:15000},async()=>{
 const {port,child}=await server();let attacker,observer;
 try{
  const wolf=FOREST_WOLF_SPAWNS[0],mobId='forest-wolf-0';
  attacker=await join(port,'Охотник в лесу',wolf.x,wolf.z-1.7,5,261,{weapon:{id:'wornAxe'}});
  observer=await join(port,'Напарник в лесу',wolf.x,wolf.z-1.9,5,261,{weapon:{id:'wornAxe'}});
  const a=await until(()=>attacker.events.find(e=>e.type==='welcome'));
  const b=await until(()=>observer.events.find(e=>e.type==='welcome'));
  const wa=a.mobs.find(m=>m.id===mobId),wb=b.mobs.find(m=>m.id===mobId);
  assert.ok(wa&&wb,'the same forest wolf must spawn on both browsers');
  assert.equal(wa.life,wb.life);
  assert.equal(wa.family,'forestWolf');
  await until(()=>attacker.events.find(e=>e.type==='snapshot'
   &&e.players.some(p=>p.id===b.id)),5000);
  attacker.send({type:'attack',abilityId:'autoAttack',mobId});
  const first=await until(()=>observer.events.find(e=>e.type==='combat'
   &&e.mobId===mobId&&e.fromId===a.id),5000);
  assert.ok(first.damage>0,'observer sees a real server-confirmed strike');
  assert.ok(first.hp<wa.maxHp);
  observer.send({type:'attack',abilityId:'autoAttack',mobId});
  const second=await until(()=>attacker.events.find(e=>e.type==='combat'
   &&e.mobId===mobId&&e.fromId===b.id),5000);
  assert.ok(second.damage>0,'first player sees a teammate hit the same wolf');
  assert.equal(second.life,first.life);
  const reaction=await until(()=>attacker.events.find(e=>
   e.type==='mobTelegraph'&&e.mobId===mobId),7000);
  assert.equal(reaction.life,first.life);
  const impact=await until(()=>observer.events.find(e=>
   e.type==='mobStrike'&&e.mobId===mobId),7000);
  assert.ok([a.id,b.id].includes(impact.targetId));
  const received=await until(()=>[attacker,observer].some(c=>c.events.some(e=>
   e.type==='mobAttack'&&e.mobId===mobId)),3000);
  assert.equal(received,true,'victim receives authoritative damage');
  const sa=attacker.events.filter(e=>e.type==='snapshot').at(-1).mobs.find(m=>m.id===mobId);
  const sb=observer.events.filter(e=>e.type==='snapshot').at(-1).mobs.find(m=>m.id===mobId);
  assert.equal(sa.life,sb.life);
  assert.equal(sa.hp,sb.hp,'both browsers converge on the same wolf health');
 }finally{
  attacker?.close();observer?.close();child.kill();
 }
});
