// NexGame Alpha 0.3.5.24 — single-process shared-world presence and authoritative PvE.
// Characters are not authenticated or persisted yet; use only for playtesting.
// One process = one global world; use persistent infrastructure for deployment.
import {createServer} from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import {randomUUID} from 'node:crypto';
import {createPartyManager} from './groups.js';
import {createChatManager} from './chat.js';
import {createSharedChest} from './chest.js';
import {resolve} from 'node:path';
import {createMulgoreMobs,tickMulgoreMobs,snapshotMulgoreMobs,applyMulgoreAbility,sanitizeEquipment,rollMulgoreLoot} from './world-mobs.js';

const PORT=Number(process.env.PORT||3000);
const MAX_PLAYERS=100;
const TICK_MS=100; // 10 world snapshots per second.
const WORLD_PROTOCOL=6; // Adds server-authoritative shared chest transactions.
const WORLD_BUILD='0.3.5.36';
const MAX_MESSAGE_BYTES=8192; // inventory snapshot for a 108-slot character backpack
const MAX_SPEED=7; // anti-teleport cap for 4.05 world units/sec client movement.
const ALLOWED_ORIGINS=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
const players=new Map();
const clients=new Map();
// One set of living wildlife coordinates for the entire Mulgore world.
const mobs=createMulgoreMobs();
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const cleanName=name=>typeof name==='string'?name.trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,24):'';
const encode=value=>JSON.stringify(value);
const send=(socket,payload)=>{if(socket.readyState===WebSocket.OPEN)socket.send(encode(payload));};
const broadcast=payload=>{for(const socket of clients.keys())send(socket,payload)};
const sendToPlayer=(id,payload)=>{for(const [socket,otherId] of clients)if(id===otherId)send(socket,payload)};
const parties=createPartyManager({players,send:sendToPlayer});
const chat=createChatManager({players,parties,send:sendToPlayer,broadcast});
const chest=createSharedChest({players,send:sendToPlayer,broadcast,filePath:resolve(process.env.CHEST_DATA_FILE||'chest-data.json')});

const http=createServer((req,res)=>{
 if(req.url==='/health'){
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(encode({ok:true,world:'mulgore',players:players.size,mobs:mobs.length,protocol:WORLD_PROTOCOL,build:WORLD_BUILD}));
  return;
 }
 res.writeHead(404);res.end('Not found');
});
const wss=new WebSocketServer({server:http,maxPayload:MAX_MESSAGE_BYTES,
 verifyClient:({origin},done)=>done(!ALLOWED_ORIGINS.length||ALLOWED_ORIGINS.includes(origin))});
function disconnect(ws){
 const id=clients.get(ws);if(!id)return;
 parties.disconnect(id);
 chat.disconnect(id);
 chest.disconnect(id);
 clients.delete(ws);players.delete(id);
 for(const client of clients.keys())send(client,{type:'leave',id});
}
wss.on('connection',ws=>{
 if(clients.size>=MAX_PLAYERS){ws.close(1013,'World is full');return}
 const id=randomUUID(),now=Date.now();
 const player={id,name:'Странник',x:0,z:10,yaw:Math.PI,level:1,moving:false,updatedAt:now,equipment:{},hp:120,maxHp:120};
 let joined=false;
 clients.set(ws,id);players.set(id,player);
 send(ws,{type:'welcome',id,world:'mulgore',tickMs:TICK_MS,protocol:WORLD_PROTOCOL,build:WORLD_BUILD,
  players:[...players.values()].filter(other=>other.id!==id),
  mobs:snapshotMulgoreMobs(mobs)});
 send(ws,parties.state(id));
 ws.on('message',raw=>{
  let data;try{data=JSON.parse(String(raw))}catch{return}
  if(!data||typeof data!=='object')return;
  if(data.type==='join'){
   if(joined)return;joined=true;
   const name=cleanName(data.name);if(name)player.name=name;
   // Initialize the player's first position from an existing browser save.
   // Coordinates are provisional until server-authoritative movement is added.
   if(finite(data.x,-1000,1000)&&finite(data.z,-1000,1000)){
    player.x=data.x;player.z=data.z;
   }
   if(finite(data.yaw,-Math.PI*4,Math.PI*4))player.yaw=data.yaw;
   if(integer(data.level,1,60))player.level=data.level;
   player.equipment=sanitizeEquipment(data.equipment,player.level);
   if(finite(data.maxHp,1,10000)&&finite(data.hp,0,data.maxHp)){
    player.hp=data.hp;player.maxHp=data.maxHp;
   }
   player.updatedAt=Date.now();
   return;
  }
  if(!joined)return;
  if(data.type==='rename'){
   const name=cleanName(data.name);
   if(!name){send(ws,{type:'partyNotice',error:true,message:'Имя не должно быть пустым'});return}
   player.name=name;
   parties.renamed(id);
   send(ws,{type:'nameChanged',name});
   return;
  }
  if(data.type==='partyInvite'){parties.invite(id,data.targetId);return}
  if(data.type==='partyRespond'){parties.respond(id,data.fromId,data.accept===true);return}
  if(data.type==='partyLeave'){parties.leave(id);return}
  if(data.type==='chatSend'){chat.handle(id,data);return}
  if(data.type==='chestOpen'){chest.open(id,data.inventory);return}
  if(data.type==='chestMove'){chest.move(id,data);return}
  if(data.type==='chestClose'){chest.close(id);return}
  if(data.type==='attack'){
   const result=applyMulgoreAbility(mobs,player,data.abilityId,data.mobId);
   if(!result.ok){send(ws,{type:'combatRejected',abilityId:data.abilityId,reason:result.reason});return}
   broadcast(result.event);
   for(const death of result.deaths){
    for(const attackerId of death.contributors){
     sendToPlayer(attackerId,{type:'killCredit',mobId:death.id,life:death.life,
      xp:death.boss?70:22,gold:death.boss?12:4,
      loot:rollMulgoreLoot(death.boss)});
    }
   }
   return;
  }
  if(data.type!=='move')return;
  if(!finite(data.x,-1000,1000)||!finite(data.z,-1000,1000)||
     !finite(data.yaw,-Math.PI*4,Math.PI*4)||typeof data.moving!=='boolean')return;
  const now=Date.now(),dt=Math.min(1,(now-player.updatedAt)/1000);
  if(dt<.075)return; // Limit client input to about 10 updates/sec.
  const dx=data.x-player.x,dz=data.z-player.z;
  if(Math.hypot(dx,dz)>MAX_SPEED*dt+1) return;
  player.x=data.x;player.z=data.z;player.yaw=data.yaw;
  player.moving=data.moving;player.updatedAt=now;
  if(integer(data.level,1,60))player.level=data.level; // Temporary, untrusted level until accounts.
  if(data.equipment)player.equipment=sanitizeEquipment(data.equipment,player.level);
  if(finite(data.maxHp,1,10000)&&finite(data.hp,0,data.maxHp)){
   player.hp=data.hp;player.maxHp=data.maxHp;
  }
 });
 ws.on('close',()=>disconnect(ws));
 ws.on('error',()=>disconnect(ws));
});
let lastMobTick=performance.now(),worldTick=0;
const interval=setInterval(()=>{
 worldTick++;
 const now=performance.now();
 const mobEvents=tickMulgoreMobs(mobs,(now-lastMobTick)/1000,[...players.values()],Date.now());lastMobTick=now;
 for(const event of mobEvents)broadcast(event);
 const snapshot=[...players.values()].map(p=>({id:p.id,name:p.name,x:p.x,z:p.z,yaw:p.yaw,level:p.level,moving:p.moving,hp:p.hp,maxHp:p.maxHp}));
 const mobSnapshot=snapshotMulgoreMobs(mobs);
 for(const client of clients.keys())send(client,{type:'snapshot',protocol:WORLD_PROTOCOL,tick:worldTick,players:snapshot,mobs:mobSnapshot});
},TICK_MS);
interval.unref();
http.listen(PORT,'0.0.0.0',()=>console.log('NexGame world listening on '+PORT));
