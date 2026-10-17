import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {WebSocket} from 'ws';
import {localToNormal} from '../spherical-pve.js';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function server(){
 const port=await new Promise(resolve=>{
  const s=createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});
 });
 const processHandle=spawn(process.execPath,['index.js'],{
  cwd:new URL('../',import.meta.url),
  env:{...process.env,PORT:String(port),NGW_CHEST_DATA_FILE:'/tmp/ngw-online-'+port+'.json'},
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
  assert.equal(aw.mobs.length,9);
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
  a=await join(port,'Игрок А',-33.2,-7.4);
  b=await join(port,'Игрок Б',-33.2,-7.4);
  c=await join(port,'Игрок В',-33.2,-7.4);
  d=await join(port,'Отдельная планета',-33.2,-7.4,1,87);
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
  a.send({type:'chatSend',channel:'world',text:'Привет, мир!'});
  await until(()=>c.events.find(e=>e.type==='chat'&&e.text==='Привет, мир!'));
  assert.equal(d.events.some(e=>e.type==='chat'&&e.text==='Привет, мир!'),false);
  const inventory=[{id:'wornAxe',qty:1},{id:'healingPotion',qty:3},...Array(10).fill(null)];
  a.send({type:'chestOpen',inventory});
  await until(()=>a.events.find(e=>e.type==='chestState'));
  a.send({type:'chestMove',action:'deposit',slot:0,requestId:'deposit-test-001'});
  const deposit=await until(()=>a.events.find(e=>e.type==='chestResult'&&e.requestId==='deposit-test-001'));
  assert.equal(deposit.ok,true);
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
