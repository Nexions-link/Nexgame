import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldPresence} from '../online.js';

class FakeSocket{
 static OPEN=1;
 static instances=[];
 constructor(url){
  this.url=url;
  this.readyState=0;
  this.sent=[];
  FakeSocket.instances.push(this);
 }
 send(payload){this.sent.push(JSON.parse(payload))}
 open(){this.readyState=FakeSocket.OPEN;this.onopen?.()}
 receive(message){this.onmessage?.({data:JSON.stringify(message)})}
 close(){
  if(this.readyState===3)return;
  this.readyState=3;
  this.onclose?.();
 }
}

test('population includes the local player on welcome and tracks authoritative snapshots',()=>{
 const previous=globalThis.WebSocket;
 globalThis.WebSocket=FakeSocket;
 FakeSocket.instances.length=0;
 let connection;
 try{
  const statuses=[],populations=[],remotePlayers=[];
  connection=createWorldPresence({
   url:'wss://example.test/world',
   onStatus:value=>statuses.push(value),
   onPopulation:count=>populations.push(count),
   onPlayers:list=>remotePlayers.push(list),
   getPosition:()=>({name:'Герой',x:0,z:10,yaw:0,moving:false,level:1})
  });
  const socket=FakeSocket.instances.at(-1);
  assert.ok(socket);
  assert.equal(statuses[0],'connecting');
  socket.open();
  assert.equal(statuses.at(-1),'online');
  assert.equal(socket.sent[0].type,'join');

  socket.receive({
   type:'welcome',id:'self',players:[{id:'other'}],mobs:[],protocol:5
  });
  assert.deepEqual(populations,[2],'welcome excludes self, add one');

  socket.receive({
   type:'snapshot',players:[{id:'self'},{id:'other'},{id:'third'}],mobs:[]
  });
  assert.equal(populations.at(-1),3,'snapshot contains all players');
  assert.deepEqual(remotePlayers.at(-1).map(p=>p.id),['other','third'],
   '3D renderer still excludes our own avatar');

  socket.receive({
   type:'snapshot',players:[{id:'self'}],mobs:[]
  });
  assert.equal(populations.at(-1),1,'online count drops when others leave');

  socket.close();
  assert.equal(populations.at(-1),null,'disconnected count cleared');
  assert.equal(statuses.at(-1),'offline');
 }finally{
  connection?.close();
  if(previous===undefined)delete globalThis.WebSocket;
  else globalThis.WebSocket=previous;
 }
});

test('solo mode keeps world connection disabled and displays no population',()=>{
 const previous=globalThis.WebSocket;
 globalThis.WebSocket=FakeSocket;
 let connection;
 try{
  const statuses=[],populations=[];
  connection=createWorldPresence({
   url:'',onStatus:s=>statuses.push(s),onPopulation:n=>populations.push(n)
  });
  assert.deepEqual(statuses,['solo']);
  assert.deepEqual(populations,[]);
  assert.equal(connection.connected(),false);
 }finally{
  connection?.close();
  if(previous===undefined)delete globalThis.WebSocket;
  else globalThis.WebSocket=previous;
 }
});
