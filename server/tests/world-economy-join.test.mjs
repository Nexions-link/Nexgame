import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WebSocket,WebSocketServer} from 'ws';
import {createSphericalWorld} from '../spherical-world.js';
import {localToNormal} from '../spherical-pve.js';

async function waitFor(events,type,timeout=3000){
 const start=Date.now();
 while(Date.now()-start<timeout){
  const event=events.find(m=>m.type===type);
  if(event)return event;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error('No event: '+type);
}
test('auth economy accepts only server-bound identity and position, persists verified result', {timeout:9000}, async()=>{
 const world=createSphericalWorld(),http=createServer(),wss=new WebSocketServer({server:http});
 const vendor=localToNormal(6,11,261),calls=[];
 const accountId='9fd73e82-7157-4c50-a943-72ac83ec7cce';
 const characterId='9cf39f9c-898e-4168-b34b-1076256b0ee7';
 const progress={revision:0,level:1,experience:0,gold:30,health:120,resource:0,
  worldRadius:261,positionNormal:vendor,heading:0,inventory:Array(12).fill(null),
  equipment:{},quests:{},actionBar:[]};
 const economyStore={
  async buy(args){
   calls.push(args);
   return {applied:true,progress:{...progress,revision:1,gold:22,
    inventory:[{id:'wornAxe',qty:1},...Array(11).fill(null)]}};
  }
 };
 const progressStore={async load(){return progress}};
 wss.on('connection',ws=>{
  world.attach(ws,{economyStore,progressStore,
   trustedCharacter:{accountId,characterId,nickname:'Владелец',progress}});
  ws.emit('message',Buffer.from(JSON.stringify({type:'join'})));
 });
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const ws=new WebSocket('ws://127.0.0.1:'+http.address().port),events=[];
 ws.on('message',raw=>events.push(JSON.parse(String(raw))));
 try{
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  await waitFor(events,'welcome');
  ws.send(JSON.stringify({type:'economy',action:'buy',itemId:'wornAxe',qty:1,
   requestId:'257dce9c-042c-40c4-ad82-55c4f490d5b2',
   accountId:'forged',characterId:'forged',context:{normal:[0,0,1],radius:87,inCombat:false},
   level:60,gold:1000000}));
  const saved=await waitFor(events,'progressSaved');
  assert.equal(saved.progress.gold,22);
  const ack=await waitFor(events,'economyResult');
  assert.equal(ack.ok,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].accountId,accountId);
  assert.equal(calls[0].characterId,characterId);
  assert.equal(calls[0].expectedRevision,0);
  assert.deepEqual(calls[0].context.normal,vendor);
  assert.equal(calls[0].context.radius,261);
  assert.equal(calls[0].context.inCombat,false);
  assert.equal(calls[0].qty,1);
 }finally{
  ws.close();wss.close();http.close();world.close();
 }
});
test('guest world cannot call authenticated economy operations',{timeout:8000},async()=>{
 const world=createSphericalWorld(),http=createServer(),wss=new WebSocketServer({server:http});
 wss.on('connection',ws=>world.attach(ws));
 await new Promise(resolve=>http.listen(0,'127.0.0.1',resolve));
 const ws=new WebSocket('ws://127.0.0.1:'+http.address().port),events=[];
 ws.on('message',raw=>events.push(JSON.parse(String(raw))));
 try{
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  ws.send(JSON.stringify({type:'join',name:'Гость',radius:261,normal:localToNormal(6,11,261),
   heading:0,level:1}));
  await waitFor(events,'welcome');
  ws.send(JSON.stringify({type:'economy',action:'buy',itemId:'wornAxe',qty:1,
   requestId:'99826a66-61d4-49d6-8ed7-b207ba76e404'}));
  await new Promise(resolve=>setTimeout(resolve,160));
  assert.equal(events.some(x=>x.type==='economyResult'||x.type==='progressSaved'),false);
 }finally{ws.close();wss.close();http.close();world.close()}
});
