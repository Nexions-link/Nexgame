import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WebSocket,WebSocketServer} from 'ws';
import {createSphericalWorld} from '../spherical-world.js';
import {localToNormal} from '../spherical-pve.js';
async function until(events,kind,ms=3000){
 const t=Date.now();
 while(Date.now()-t<ms){
  const v=events.find(e=>e.type===kind);
  if(v)return v;
  await new Promise(ok=>setTimeout(ok,20));
 }
 throw Error('Timed out waiting for '+kind);
}
test('authenticated world joins use stored nickname, level, position and gear, not forged packets',{timeout:8000},async()=>{
 const server=createServer();
 const world=createSphericalWorld();
 const wss=new WebSocketServer({server});
 const trusted={accountId:'account',characterId:'hero',nickname:'Молодой Воин',
  progress:{level:1,health:120,resource:25,worldRadius:261,
   positionNormal:localToNormal(-9,-25,261),heading:0,
   equipment:{weapon:{id:'wornAxe'}},revision:0}};
 wss.on('connection',ws=>world.attach(ws,{trustedCharacter:trusted}));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const client=new WebSocket('ws://127.0.0.1:'+server.address().port),events=[];
 client.on('message',raw=>events.push(JSON.parse(String(raw))));
 try{
  await new Promise((ok,fail)=>{client.once('open',ok);client.once('error',fail)});
  client.send(JSON.stringify({type:'join',name:'Admin',radius:87,normal:[0,1,0],heading:1,
   level:60,hp:999999,equipment:{weapon:{id:'scalpingStrength'}}}));
  const welcome=await until(events,'welcome');
  assert.equal(welcome.radius,261);
  assert.equal(welcome.hp,120);
  assert.equal(welcome.resource,25);
  assert.equal(world.players.size,1);
  const hero=[...world.players.values()][0];
  assert.equal(hero.name,'Молодой Воин');
  assert.equal(hero.level,1);
  assert.equal(hero.resource,25);
  assert.equal(hero.equipment.weapon.id,'wornAxe');
  assert.deepEqual(hero.normal,trusted.progress.positionNormal);
  assert.equal(hero.characterId,'hero');
  client.send(JSON.stringify({type:'rename',name:'Admin'}));
  client.send(JSON.stringify({type:'move',radius:261,normal:hero.normal,heading:0,
   moving:false,level:60,equipment:{weapon:{id:'scalpingStrength'}}}));
  await new Promise(ok=>setTimeout(ok,170));
  assert.equal(hero.name,'Молодой Воин');
  assert.equal(hero.level,1);
  assert.equal(hero.equipment.weapon.id,'wornAxe');
  client.send(JSON.stringify({type:'chestOpen',inventory:[{id:'scalpingStrength',qty:1}]}));
  const denied=await until(events,'chestResult');
  assert.equal(denied.ok,false);
  assert.equal(denied.reason,'pending_server_inventory');
  client.send(JSON.stringify({type:'heal'}));
  const healDenied=await until(events,'combatRejected');
  assert.equal(healDenied.reason,'pending_server_item_use');
 }finally{
  client.close();wss.close();server.close();world.close();
 }
});

test('authenticated mob kill commits progress before a verified reward is sent',{timeout:10000},async()=>{
 const server=createServer(),world=createSphericalWorld();
 const wss=new WebSocketServer({server});
 const normal=localToNormal(-9,-24,261);
 const initial={revision:1,level:1,experience:0,gold:30,health:120,resource:0,
  worldRadius:261,positionNormal:normal,heading:Math.PI/2,
  inventory:[{id:'wornAxe',qty:1},...Array(11).fill(null)],
  equipment:{weapon:{id:'wornAxe'}},quests:{},actionBar:[]};
 let current=initial,killCount=0,checkpointCount=0;
 const stored={
  async recordMobKill(args){
   killCount++;
   assert.equal(args.characterId,'hero');
   assert.equal(args.expectedRevision,current.revision);
   assert.equal(args.serverCredit.type,'killCredit');
   assert.equal(args.deferLoot,true);
   current={...current,revision:current.revision+1,experience:22,gold:30};
   return {applied:true,progress:current};
  },
  async saveServerCheckpoint(args){
   checkpointCount++;
   assert.equal(args.expectedRevision,current.revision);
   current={...current,revision:current.revision+1,
    positionNormal:args.checkpoint.normal,heading:args.checkpoint.heading};
   return {progress:current};
  }
 };
 wss.on('connection',ws=>world.attach(ws,{trustedCharacter:{
  accountId:'account',characterId:'hero',nickname:'Надёжный Герой',progress:initial
 },progressStore:stored}));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const ws=new WebSocket('ws://127.0.0.1:'+server.address().port),events=[];
 ws.on('message',raw=>events.push(JSON.parse(String(raw))));
 try{
  await new Promise((ok,fail)=>{ws.once('open',ok);ws.once('error',fail)});
  ws.send(JSON.stringify({type:'join',name:'FakeAdmin',radius:87,
   heading:0,normal:[0,1,0],level:60}));
  await until(events,'welcome');
  const mob=world.rooms.get(261).mobs[0];
  mob.hp=1;
  ws.send(JSON.stringify({type:'attack',abilityId:'autoAttack',mobId:'dolgonog-0'}));
  const committed=await until(events,'progressSaved',5000);
  assert.equal(committed.source,'mob');
  assert.equal(committed.progress.experience,22);
  assert.equal(committed.progress.revision,2);
  assert.equal(killCount,1);
  assert.equal(events.some(e=>e.type==='killCredit'),false);
  const corpseLoot=await until(events,'economyResult');
  assert.equal(corpseLoot.kind,'lootAvailable');
  assert.equal(corpseLoot.mobId,'dolgonog-0');
  assert.ok(Array.isArray(corpseLoot.loot));
  // Movement may not claim a higher level or forged weapon.
  await new Promise(ok=>setTimeout(ok,130));
  ws.send(JSON.stringify({type:'move',radius:261,heading:Math.PI/2,
   normal:localToNormal(-9,-23.8,261),moving:true,
   level:60,equipment:{weapon:{id:'scalpingStrength'}}}));
  const saved=await new Promise(async(ok,fail)=>{
   const start=Date.now();
   while(Date.now()-start<5000){
    const x=events.find(e=>e.type==='progressSaved'&&e.source==='checkpoint');
    if(x){ok(x);return}
    await new Promise(done=>setTimeout(done,20));
   }
   fail(Error('checkpoint did not save'));
  });
  assert.equal(saved.progress.revision,3);
  assert.equal(checkpointCount,1);
  const actor=[...world.players.values()][0];
  assert.equal(actor.level,1); // No client-side level-up from a packet.
  assert.equal(actor.equipment.weapon.id,'wornAxe');
 }finally{ws.close();wss.close();server.close();world.close()}
});

test('disconnecting during combat sends mobs into evasion without retaining old loot owners',
 {timeout:8000},async()=>{
 const server=createServer(),world=createSphericalWorld();
 const wss=new WebSocketServer({server});
 wss.on('connection',ws=>world.attach(ws));
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const client=new WebSocket('ws://127.0.0.1:'+server.address().port),events=[];
 client.on('message',raw=>events.push(JSON.parse(String(raw))));
 try{
  await new Promise((ok,fail)=>{client.once('open',ok);client.once('error',fail)});
  client.send(JSON.stringify({type:'join',name:'Отключившийся герой',radius:261,
   normal:localToNormal(-9,-24,261),heading:Math.PI/2}));
  const welcome=await until(events,'welcome');
  const mob=world.rooms.get(261).mobs[0];
  mob.x=mob.spawnX+2;mob.z=mob.spawnZ;
  mob.hp=mob.maxHp-10;mob.aggroId=welcome.id;
  mob.contributors.add(welcome.id);
  mob.attackAt=Date.now()+800;
  client.close();
  const started=Date.now();
  while(world.players.size&&Date.now()-started<3000)
   await new Promise(ok=>setTimeout(ok,20));
  assert.equal(world.players.size,0);
  assert.equal(mob.aggroId,null);
  assert.equal(mob.returning,true,'a disconnected target must trigger a full return');
  assert.equal(mob.attackAt,0);
  assert.equal(mob.contributors.size,0,'ghost player must not remain in loot ledger');
  assert.equal(mob.hp,mob.maxHp-10,'HP resets at home, not on socket close');
 }finally{
  client.close();wss.close();server.close();world.close();
 }
});
