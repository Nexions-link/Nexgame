// P1.1: end-to-end browser-facing multi-client session on a disposable server.
// Anonymous guest mode is enabled ONLY in this child process; production stays auth-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {WebSocket} from 'ws';
import {localToNormal} from '../spherical-pve.js';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,ms=5000){
 const start=Date.now();
 while(Date.now()-start<ms){
  const data=read();
  if(data)return data;
  await wait(30);
 }
 throw Error('Timed out waiting for five-player network event');
}
async function start(){
 const port=await new Promise(resolve=>{
  const tcp=createServer().listen(0,'127.0.0.1',()=>{
   const p=tcp.address().port;tcp.close(()=>resolve(p));
  });
 });
 const child=spawn(process.execPath,['index.js'],{
  cwd:new URL('../',import.meta.url),
  env:{...process.env,PORT:String(port),NGW_GUEST_WORLD_ENABLED:'true',
   NGW_CHEST_DATA_FILE:'/tmp/ngw-p1-journey-'+port+'.json'},
  stdio:['ignore','ignore','pipe']
 });
 let stderr='';child.stderr.on('data',data=>{stderr+=String(data)});
 for(let n=0;n<90;n++){
  if(child.exitCode!==null)throw Error('Child server exited: '+stderr);
  try{
   const response=await fetch('http://127.0.0.1:'+port+'/health');
   if(response.ok)return {port,child};
  }catch{}
  await wait(60);
 }
 child.kill();
 throw Error('Five-player test server failed to start: '+stderr);
}
async function join(port,name,x=-9,z=-24){
 const socket=new WebSocket('ws://127.0.0.1:'+port+'/ws/nexgameworld'),events=[];
 socket.on('message',data=>events.push(JSON.parse(String(data))));
 await new Promise((ok,bad)=>{socket.once('open',ok);socket.once('error',bad)});
 socket.send(JSON.stringify({type:'join',name,radius:261,
  normal:localToNormal(x,z,261),heading:Math.PI/2,level:1}));
 return {socket,events,send:data=>socket.send(JSON.stringify(data)),
  close:()=>socket.close()};
}
test('five online heroes retain consistent snapshots, party, chat and rejoin state',
 {timeout:16000},async()=>{
 const {port,child}=await start(),clients=[];
 try{
  clients.push(...await Promise.all(
   Array.from({length:5},(_,i)=>join(port,'Путник '+(i+1)))));
  const welcome=await Promise.all(clients.map(c=>until(()=>c.events.find(e=>e.type==='welcome'))));
  const ids=new Set(welcome.map(x=>x.id));
  assert.equal(ids.size,5,'each simultaneous join must receive a unique server identity');
  assert.equal(welcome.at(-1).onlineCount,5,'fifth join sees all online players');
  const leader=clients[0],leaderId=welcome[0].id;
  const firstSnap=await until(()=>leader.events.find(e=>e.type==='snapshot'
    &&e.onlineCount===5&&e.players.length===5));
  assert.deepEqual(new Set(firstSnap.players.map(p=>p.id)),ids);
  assert.equal(firstSnap.players.filter(p=>p.id===leaderId).length,1,
   'local player must never be duplicated in snapshots');
  for(let n=1;n<5;n++){
   leader.send({type:'partyInvite',targetId:welcome[n].id});
   await until(()=>clients[n].events.find(e=>e.type==='partyInvite'
     &&e.fromId===leaderId));
   clients[n].send({type:'partyRespond',fromId:leaderId,accept:true});
   await until(()=>leader.events.find(e=>e.type==='partyState'
     &&e.members.length===n+1));
  }
  const party=leader.events.filter(e=>e.type==='partyState').at(-1);
  assert.equal(party.members.length,5);
  assert.equal(party.leaderId,leaderId);
  for(const c of clients)
   await until(()=>c.events.find(e=>e.type==='partyState'&&e.members.length===5));

  clients[1].send({type:'chatSend',channel:'party',text:'P1 пять игроков на связи'});
  await Promise.all(clients.map(c=>until(()=>c.events.find(e=>
   e.type==='chat'&&e.channel==='party'&&e.text==='P1 пять игроков на связи'))));
  clients[2].send({type:'chatSend',channel:'world',text:'P1 общий мир'});
  await Promise.all(clients.map(c=>until(()=>c.events.find(e=>
   e.type==='chat'&&e.channel==='world'&&e.text==='P1 общий мир'))));

  const dropped=clients[4],oldId=welcome[4].id;
  dropped.close();
  await until(()=>leader.events.find(e=>e.type==='leave'&&e.id===oldId));
  await until(()=>leader.events.find(e=>e.type==='partyState'
   &&e.members.length===4&&!e.members.some(p=>p.id===oldId)));
  await until(()=>leader.events.find(e=>e.type==='snapshot'
   &&e.onlineCount===4&&!e.players.some(p=>p.id===oldId)));
  const returned=await join(port,'Путник 5');
  clients.push(returned);
  const newWelcome=await until(()=>returned.events.find(e=>e.type==='welcome'));
  assert.notEqual(newWelcome.id,oldId,'reconnected player gets a new ephemeral socket ID');
  assert.equal(newWelcome.onlineCount,5);
  const recovered=await until(()=>leader.events.findLast(e=>e.type==='snapshot'
   &&e.onlineCount===5&&e.players.some(p=>p.id===newWelcome.id)));
  assert.equal(recovered.players.filter(p=>p.id===newWelcome.id).length,1);
  assert.equal(recovered.players.some(p=>p.id===oldId),false,
   'old disconnected avatar must never reappear as a ghost');
  const survivingParty=leader.events.filter(e=>e.type==='partyState').at(-1);
  assert.equal(survivingParty.members.length,4);
  assert.equal(survivingParty.members.some(p=>p.id===newWelcome.id),false,
   'returning player cannot inherit a group membership from another socket');
  const response=await fetch('http://127.0.0.1:'+port+'/health');
  assert.equal((await response.json()).sphericalPlayers,5);
 }finally{
  for(const client of clients)client.close();
  child.kill();
 }
});

test('initial welcome respects visual interest radius just like later snapshots',
 {timeout:10000},async()=>{
 const {port,child}=await start(),clients=[];
 try{
  const far=await join(port,'Дальний игрок',120,-24);
  clients.push(far);
  const farWelcome=await until(()=>far.events.find(e=>e.type==='welcome'));
  const near=await join(port,'Ближний игрок',-9,-24);
  clients.push(near);
  const nearWelcome=await until(()=>near.events.find(e=>e.type==='welcome'));
  assert.equal(nearWelcome.onlineCount,2,'room count includes distant characters');
  assert.equal(nearWelcome.players.some(p=>p.id===farWelcome.id),false,
   'joining browser must not receive characters beyond visual interest range');
  const snap=await until(()=>near.events.find(e=>e.type==='snapshot'));
  assert.equal(snap.onlineCount,2);
  assert.equal(snap.players.some(p=>p.id===farWelcome.id),false);
 }finally{
  for(const client of clients)client.close();
  child.kill();
 }
});
