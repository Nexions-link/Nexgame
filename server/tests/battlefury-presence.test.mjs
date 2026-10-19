import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {WebSocket,WebSocketServer} from 'ws';
import {createSphericalWorld,publicPlayer,sanitizeBattlefuryPresence} from '../spherical-world.js';
import {ADMIN_BATTLEFURY_ACCOUNT_ID,ADMIN_BATTLEFURY_CHARACTER_ID} from '../admin-battlefury.js';
import {BATTLEFURY_TUNER_DEFAULTS} from '../../planet-test/battlefury-tuner.js';

const player=(accountId,characterId,weapon='adminBattlefury')=>({
 id:'test',name:'Nexions',normal:[0,0,1],heading:0,moving:false,radius:261,
 level:8,hp:100,maxHp:100,resource:0,accountId,characterId,
 equipment:{weapon:{id:weapon}},
});
const waitFor=async(events,predicate,ms=2800)=>{
 const until=Date.now()+ms;
 while(Date.now()<until){
  const value=events.find(predicate);if(value)return value;
  await new Promise(ok=>setTimeout(ok,25));
 }
 throw Error('Timed out waiting for Battlefury snapshot');
};
test('the world signs visible Battlefury only for authenticated sole owner with it equipped',()=>{
 const owner=player(ADMIN_BATTLEFURY_ACCOUNT_ID,ADMIN_BATTLEFURY_CHARACTER_ID);
 assert.deepEqual(publicPlayer(owner).battlefury,{itemId:'adminBattlefury',pose:BATTLEFURY_TUNER_DEFAULTS});
 assert.equal('battlefury' in publicPlayer(player('forged','forged')),false);
 assert.equal('battlefury' in publicPlayer(player(ADMIN_BATTLEFURY_ACCOUNT_ID,'wrong')),false);
 assert.equal('battlefury' in publicPlayer(player('wrong',ADMIN_BATTLEFURY_CHARACTER_ID)),false);
 assert.equal('battlefury' in publicPlayer(player(ADMIN_BATTLEFURY_ACCOUNT_ID,ADMIN_BATTLEFURY_CHARACTER_ID,'wornAxe')),false);
 assert.equal('battlefury' in publicPlayer({...owner,accountId:null,characterId:null}),false);
});
test('network pose is bounded and partial or nonfinite packets are ignored',()=>{
 const out=sanitizeBattlefuryPresence({...BATTLEFURY_TUNER_DEFAULTS,scale:999,posX:-999,axeZ:900});
 assert.equal(out.scale,3);assert.equal(out.posX,-2);assert.equal(out.axeZ,180);
 assert.equal(sanitizeBattlefuryPresence({...out,scale:NaN}),null);
 assert.equal(sanitizeBattlefuryPresence({scale:2}),null);
 assert.equal(sanitizeBattlefuryPresence(null),null);
});
test('verified remote client receives current pose, but forged anonymous wearer does not',{timeout:12000},async()=>{
 const http=createServer(),wss=new WebSocketServer({server:http}),world=createSphericalWorld();
 const owner={accountId:ADMIN_BATTLEFURY_ACCOUNT_ID,characterId:ADMIN_BATTLEFURY_CHARACTER_ID,
  nickname:'Nexions',progress:{worldRadius:261,positionNormal:[0,0,1],heading:0,
   level:8,health:100,resource:0,revision:1,equipment:{weapon:{id:'adminBattlefury'}}}};
 wss.on('connection',(socket,request)=>world.attach(socket,request.url?.includes('owner')?
  {trustedCharacter:owner}:{}));
 await new Promise(ok=>http.listen(0,'127.0.0.1',ok));
 const url='ws://127.0.0.1:'+http.address().port;
 let auth,viewer;
 const open=async(path)=>{const ws=new WebSocket(url+path),events=[];
  ws.on('message',raw=>events.push(JSON.parse(String(raw))));
  await new Promise((ok,fail)=>{ws.once('open',ok);ws.once('error',fail)});
  return {ws,events};
 };
 try{
  auth=await open('/owner');viewer=await open('/viewer');
  auth.ws.send(JSON.stringify({type:'join',name:'forged',equipment:{weapon:{id:'wornAxe'}}}));
  const welcome=await waitFor(auth.events,e=>e.type==='welcome');
  viewer.ws.send(JSON.stringify({type:'join',name:'Guest',radius:261,normal:[0,0,1],
   heading:0,equipment:{weapon:{id:'adminBattlefury'}}}));
  const view=await waitFor(viewer.events,e=>e.type==='welcome');
  assert.equal(view.players.find(p=>p.id===welcome.id)?.battlefury?.itemId,'adminBattlefury');
  const pose={...BATTLEFURY_TUNER_DEFAULTS,scale:1.85,posX:.125};
  await new Promise(ok=>setTimeout(ok,110));
  auth.ws.send(JSON.stringify({type:'move',radius:261,normal:[0,0,1],heading:0,moving:false,battlefuryPose:pose}));
  const snap=await waitFor(viewer.events,e=>e.type==='snapshot'&&e.players.some(p=>
   p.id===welcome.id&&p.battlefury?.pose?.scale===1.85));
  assert.equal(snap.players.find(p=>p.id===welcome.id).battlefury.pose.posX,.125);
  const forged=snap.players.find(p=>p.id===view.id);
  if(forged)assert.equal('battlefury' in forged,false);
  const other=publicPlayer([...world.players.values()].find(p=>p.id===view.id));
  assert.equal('battlefury' in other,false,'Guest cannot advertise a forged admin axe');
 }finally{
  auth?.ws.close();viewer?.ws.close();wss.close();http.close();world.close();
 }
});
