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
  progress:{level:1,health:120,resource:0,worldRadius:261,
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
  assert.equal(world.players.size,1);
  const hero=[...world.players.values()][0];
  assert.equal(hero.name,'Молодой Воин');
  assert.equal(hero.level,1);
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
