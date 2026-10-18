import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WebSocket,WebSocketServer} from 'ws';
import {createSphericalWorld} from '../spherical-world.js';
import {localToNormal} from '../spherical-pve.js';

async function waitFor(messages,predicate,timeout=3500){
 const deadline=Date.now()+timeout;
 while(Date.now()<deadline){
  const event=messages.find(predicate);
  if(event)return event;
  await new Promise(resolve=>setTimeout(resolve,20));
 }
 throw Error('Timeout awaiting authenticated economy event');
}
test('WebSocket economy is bound to server-owned hero identity, location and progress', {timeout:12000},async()=>{
 const world=createSphericalWorld(),server=createServer(),wss=new WebSocketServer({server});
 const normal=localToNormal(-9,-25,261);
 let revision=7,saveCalls=0,buyCalls=0,readCalls=0;
 let persistent={
  revision,level:2,experience:5,gold:30,health:113,resource:0,
  worldRadius:261,positionNormal:normal,heading:0,
  inventory:Array(12).fill(null),equipment:{},quests:{},actionBar:[]
 };
 const saved=()=>({...persistent,inventory:persistent.inventory.map(x=>x?{...x}:null)});
 const progressStore={
  async saveServerCheckpoint({expectedRevision}){
   assert.equal(expectedRevision,revision);
   revision++;persistent={...persistent,revision};
   saveCalls++;return {progress:saved()};
  },
  async recordMobKill(){throw Error('No mob kill expected')},
  async saveActionBarSlot(args){
   assert.equal(args.accountId,'server-owned-account');assert.equal(args.characterId,'server-owned-character');
   assert.equal(args.expectedRevision,revision);assert.equal(args.slot,7);
   const actionBar=Array(8).fill(null);actionBar[7]=args.entry;
   persistent={...persistent,revision:++revision,actionBar};return {progress:saved()};
  },
  async equipInventoryItem(){throw Error('No equip expected')},
  async unequipInventoryItem(){throw Error('No unequip expected')},
  async useHealingPotion(){throw Error('No potion expected')}
 };
 const economyStore={
  async buy(args){
   buyCalls++;
   assert.equal(args.accountId,'server-owned-account');
   assert.equal(args.characterId,'server-owned-character');
   assert.equal(args.expectedRevision,revision);
   assert.equal(args.context.radius,261);
   assert.deepEqual(args.context.normal,normal);
   assert.equal(args.context.inCombat,false);
   assert.equal(args.itemId,'wornAxe');assert.equal(args.qty,1);
   revision++;
   const inventory=Array(12).fill(null);inventory[0]={id:'wornAxe',qty:1};
   persistent={...persistent,gold:22,inventory,revision};
   return {applied:true,progress:saved()};
  },
  async readChest(args){
   readCalls++;
   assert.equal(args.characterId,'server-owned-character');
   assert.deepEqual(args.context.normal,normal);
   return {revision:5,slots:Array(18).fill(null)};
  }
 };
 const trusted={accountId:'server-owned-account',characterId:'server-owned-character',
  nickname:'НастоящийГерой',progress:saved()};
 wss.on('connection',(ws,req)=>req.url==='/auth'?
  world.attach(ws,{trustedCharacter:trusted,progressStore,economyStore}):world.attach(ws));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='ws://127.0.0.1:'+server.address().port;
 const auth=new WebSocket(base+'/auth'),guest=new WebSocket(base+'/guest');
 const events=[],guestEvents=[];
 auth.on('message',raw=>events.push(JSON.parse(String(raw))));
 guest.on('message',raw=>guestEvents.push(JSON.parse(String(raw))));
 try{
  await Promise.all([auth,guest].map(ws=>new Promise((resolve,reject)=>{
   ws.once('open',resolve);ws.once('error',reject);
  })));
  auth.send(JSON.stringify({type:'join',name:'Админ',level:60,gold:90000,
   radius:87,normal:[0,1,0],heading:0}));
  guest.send(JSON.stringify({type:'join',name:'Гость',radius:261,
   normal,heading:0,moving:false,level:60}));
  await waitFor(events,m=>m.type==='welcome');
  await waitFor(guestEvents,m=>m.type==='welcome');
  guest.send(JSON.stringify({type:'economyAction',kind:'merchantBuy',
   itemId:'wornAxe',qty:1,requestId:'f3e39735-c79a-48fc-85ce-688626355184'}));
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(buyCalls,0,'Guest may not submit economy mutations');
  auth.send(JSON.stringify({type:'economyAction',kind:'merchantBuy',itemId:'wornAxe',
   qty:1,accountId:'attacker',characterId:'attacker',expectedRevision:999999,
   context:{radius:87,normal:[0,1,0],inCombat:false},
   requestId:'fe339da1-e599-4c15-896f-5bc1bb1a6d9d'}));
  const progress=await waitFor(events,m=>m.type==='progressSaved'&&m.source==='merchantBuy');
  assert.equal(progress.progress.gold,22);
  assert.equal(progress.progress.revision,8);
  assert.equal(buyCalls,1);
  const receipt=await waitFor(events,m=>m.type==='economyResult'&&m.kind==='merchantBuy');
  assert.equal(receipt.ok,true);
  auth.send(JSON.stringify({type:'chestOpen',inventory:[{id:'fakeLegendary',qty:999}]}));
  const chest=await waitFor(events,m=>m.type==='chestState');
  assert.equal(chest.slots.length,18);
  assert.deepEqual(chest.inventory[0],{id:'wornAxe',qty:1});
  assert.equal(readCalls,1);
  assert.equal(saveCalls,0);
  auth.send(JSON.stringify({type:'economyAction',kind:'hotbarSet',slot:7,entry:{kind:'ability',id:'autoAttack'},accountId:'attacker',expectedRevision:999}));
  const bar=await waitFor(events,m=>m.type==='progressSaved'&&m.source==='hotbarSet');
  assert.deepEqual(bar.progress.actionBar[7],{kind:'ability',id:'autoAttack'});
  assert.equal((await waitFor(events,m=>m.kind==='hotbarSet')).ok,true);
 }finally{
  auth.close();guest.close();wss.close();server.close();world.close();
 }
});

test('corpse commands validate server life, distance and ownership before applying inventory', {timeout:10000},async()=>{
 const world=createSphericalWorld(),server=createServer(),wss=new WebSocketServer({server});
 const normal=localToNormal(-9,-24,261);
 let persistent={revision:1,level:1,experience:0,gold:30,health:120,resource:0,worldRadius:261,
  positionNormal:normal,heading:Math.PI/2,inventory:Array(12).fill(null),equipment:{weapon:{id:'wornAxe'}},quests:{},actionBar:[]};
 let loot=[{id:'feather',qty:1}],takes=0;
 const progressStore={async recordMobKill(args){
  assert.equal(args.deferLoot,true);
  persistent={...persistent,revision:2,experience:22,gold:34};
  return {applied:true,progress:persistent};
 },async saveServerCheckpoint(){return {progress:persistent}}};
 const economyStore={
  async readCorpseLoot(args){assert.equal(args.characterId,'owner');return {loot};},
  async takeCorpseLoot(args){
   takes++;assert.equal(args.accountId,'account');assert.equal(args.characterId,'owner');
   assert.equal(args.expectedRevision,2);assert.equal(args.corpse.mobId,'dolgonog-0');
   assert.equal(args.corpse.life,1);assert.deepEqual(args.context.normal,normal);
   persistent={...persistent,revision:3,inventory:[...loot,...Array(11).fill(null)]};
   const taken=loot;loot=[];return {applied:true,progress:persistent,taken};
  }
 };
 wss.on('connection',ws=>world.attach(ws,{trustedCharacter:{accountId:'account',characterId:'owner',nickname:'Охотник',progress:persistent},progressStore,economyStore}));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const ws=new WebSocket('ws://127.0.0.1:'+server.address().port),events=[];
 ws.on('message',raw=>events.push(JSON.parse(String(raw))));
 const send=message=>ws.send(JSON.stringify(message));
 try{
  await new Promise((ok,fail)=>{ws.once('open',ok);ws.once('error',fail)});
  send({type:'join'});await waitFor(events,e=>e.type==='welcome');
  const mob=world.rooms.get(261).mobs[0];mob.hp=1;
  send({type:'attack',abilityId:'autoAttack',mobId:mob.id});
  await waitFor(events,e=>e.kind==='lootAvailable');
  assert.equal(persistent.inventory.some(Boolean),false);
  send({type:'economyAction',kind:'lootOpen',mobId:mob.id,life:mob.life+1});
  assert.equal((await waitFor(events,e=>e.kind==='lootOpen')).reason,'corpse_unavailable');
  events.length=0;
  const actor=[...world.players.values()][0];actor.x=50;actor.z=50;
  send({type:'economyAction',kind:'lootTake',mobId:mob.id,life:mob.life});
  assert.equal((await waitFor(events,e=>e.kind==='lootTake')).reason,'interaction_too_far');assert.equal(takes,0);
  events.length=0;actor.x=-9;actor.z=-24;
  send({type:'economyAction',kind:'lootOpen',mobId:mob.id,life:mob.life});
  assert.deepEqual((await waitFor(events,e=>e.kind==='lootOpen')).loot,loot);
  send({type:'economyAction',kind:'lootTake',mobId:mob.id,life:mob.life,accountId:'attacker',characterId:'attacker',loot:[{id:'fake',qty:999}],requestId:'f3e39735-c79a-48fc-85ce-688626355184'});
  const result=await waitFor(events,e=>e.kind==='lootTake');assert.equal(result.ok,true);assert.deepEqual(result.loot,[]);
  assert.equal(takes,1);assert.deepEqual(persistent.inventory[0],{id:'feather',qty:1});
 }finally{ws.close();wss.close();server.close();world.close()}
});
