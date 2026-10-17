// NexGameWorld: one spherical, shared authoritative PvE world per planet radius.
// Legacy flat-world sessions are intentionally not attached here.
import {randomUUID} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {WebSocket} from 'ws';
import {createPartyManager} from './groups.js';
import {createChatManager} from './chat.js';
import {createSharedChest} from './chest.js';
import {
 createSphericalMobs,mobSnapshot,tickSphericalMobs,applySphereAttack,
 sanitizeSphereEquipment,normalToLocal,arcDistance
} from './spherical-pve.js';
import {deriveStats} from '../items.js';

export const SPHERE_PROTOCOL=2;
const RADII=[87,174,261],TICK_MS=100,MAX_PLAYERS=100,MAX_SPEED=7;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const bound=(v,min,max)=>Math.max(min,Math.min(max,v));
const cleanName=name=>typeof name==='string'
 ?name.trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,24)||'Странник':'Странник';
const normalFrom=raw=>{
 if(!Array.isArray(raw)||raw.length!==3||!raw.every(finite))return null;
 const d=Math.hypot(...raw);return d<.99||d>1.01?null:raw.map(n=>n/d);
};
const headingOkay=h=>finite(h)&&Math.abs(h)<=Math.PI*4;
const send=(ws,p)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(p))};
const publicPlayer=p=>({
 id:p.id,name:p.name,normal:p.normal,heading:p.heading,
 moving:p.moving,radius:p.radius,level:p.level,hp:p.hp,maxHp:p.maxHp,
 resource:p.resource,equipment:{
  weapon:p.equipment.weapon?.id||null,shieldId:p.equipment.shield?.id||null
 }
});
export function createSphericalWorld({chestFilePath=resolve(process.env.NGW_CHEST_DATA_FILE||join(dirname(resolve(process.env.CHEST_DATA_FILE||'chest-data.json')),'nexgameworld-chest.json'))}={}){
 const players=new Map(),connections=new Map();
 const rooms=new Map(RADII.map(radius=>[radius,{radius,mobs:createSphericalMobs(),tick:0}]));
 let clock=Date.now();
 const sendToId=(id,event)=>{for(const [ws,player] of connections)
  if(player?.id===id)send(ws,event)};
 const sendInRoom=(radius,event)=>{for(const [ws,p] of connections)
  if(p?.radius===radius)send(ws,event)};
 const party=createPartyManager({players,send:sendToId});
 const chat=createChatManager({players,parties:party,send:sendToId,
  broadcast:event=>{const from=players.get(event.fromId);if(from)sendInRoom(from.radius,event);}});
 const chest=createSharedChest({players,send:sendToId,
  broadcast:event=>{for(const p of players.values())sendToId(p.id,event)},filePath:chestFilePath});
 let timer=null;
 function attach(ws,{trustedCharacter=null}={}){
  if(connections.size>=MAX_PLAYERS){ws.close(1013,'World is full');return}
  connections.set(ws,null);
  const cleanup=()=>{
   if(!connections.has(ws))return;
   const p=connections.get(ws);
   connections.delete(ws);
   if(p){
    party.disconnect(p.id);chat.disconnect(p.id);chest.disconnect(p.id);
    players.delete(p.id);sendInRoom(p.radius,{type:'leave',id:p.id});
    for(const mob of rooms.get(p.radius).mobs)if(mob.aggroId===p.id)mob.aggroId=null;
   }
  };
  ws.on('message',raw=>{
   if(raw.length>8192)return;
   let m;try{m=JSON.parse(String(raw))}catch{return}
   if(!m||typeof m!=='object'||Array.isArray(m))return;
   const current=connections.get(ws);
   if(m.type==='join'){
    if(current)return;
    // Authenticated sessions use only Neon state; never trust packet stats.
    const saved=trustedCharacter?.progress;
    const radius=saved?saved.worldRadius:m.radius;
    if(!RADII.includes(radius))return;
    const normal=normalFrom(saved?saved.positionNormal:m.normal);
    const heading=saved?saved.heading:m.heading;
    if(!normal||!headingOkay(heading))return;
    const level=saved?saved.level:Number.isInteger(m.level)?bound(m.level,1,60):1;
    const equipment=sanitizeSphereEquipment(saved?saved.equipment:m.equipment,level);
    const stats=deriveStats(level,equipment);
    const hp=saved?bound(saved.health,1,stats.maxHp):
     finite(m.hp)?bound(m.hp,1,stats.maxHp):stats.maxHp;
    const local=normalToLocal(normal,radius);
    const p={id:randomUUID(),name:trustedCharacter?cleanName(trustedCharacter.nickname):cleanName(m.name),
     characterId:trustedCharacter?.characterId||null,
     accountId:trustedCharacter?.accountId||null,
     normal,heading,moving:false,radius,
     level,equipment,hp,maxHp:stats.maxHp,resource:0,
     lastMobAttackAt:0,lastCombatAt:0,respawnShieldUntil:0,updatedAt:Date.now(),
     joined:true,x:local.x,z:local.z,abilityCooldowns:{}};
    players.set(p.id,p);connections.set(ws,p);
    send(ws,{type:'welcome',world:'nexgameworld',protocol:SPHERE_PROTOCOL,
     id:p.id,radius:p.radius,tickMs:TICK_MS,players:[...players.values()]
      .filter(x=>x.radius===p.radius&&x.id!==p.id).map(publicPlayer),
     mobs:mobSnapshot(rooms.get(p.radius).mobs),hp:p.hp,maxHp:p.maxHp,resource:p.resource});
    send(ws,party.state(p.id));
    return;
   }
   if(!current)return;
   if(m.type==='rename'){
    if(trustedCharacter)return;
    const name=cleanName(m.name);
    current.name=name;party.renamed(current.id);
    send(ws,{type:'nameChanged',name});return;
   }
   if(m.type==='partyInvite'){
    const target=players.get(m.targetId);
    if(target?.radius!==current.radius){
     send(ws,{type:'partyNotice',error:true,message:'Игрок находится в другом мире'});
     return;
    }
    party.invite(current.id,m.targetId);return;
   }
   if(m.type==='partyRespond'){party.respond(current.id,m.fromId,m.accept===true);return}
   if(m.type==='partyLeave'){party.leave(current.id);return}
   if(m.type==='chatSend'){chat.handle(current.id,m);return}
   if(m.type==='chestOpen'){
    if(trustedCharacter){send(ws,{type:'chestResult',ok:false,reason:'pending_server_inventory'});return}
    chest.open(current.id,m.inventory);return
   }
   if(m.type==='chestMove'){
    if(trustedCharacter){send(ws,{type:'chestResult',ok:false,reason:'pending_server_inventory'});return}
    chest.move(current.id,m);return
   }
   if(m.type==='chestClose'){chest.close(current.id);return}
   if(m.type==='attack'){
    if(current.respawnShieldUntil>Date.now())return;
    const res=applySphereAttack(rooms.get(current.radius).mobs,current,m.abilityId,m.mobId);
    if(!res.ok){send(ws,{type:'combatRejected',abilityId:m.abilityId,reason:res.reason});return}
    if(res.events.length)current.lastCombatAt=Date.now();
    for(const event of res.events)sendInRoom(current.radius,event);
    for(const entry of res.credits)sendToId(entry.targetId,entry.event);
    return;
   }
   if(m.type==='heal'){
    if(trustedCharacter){send(ws,{type:'combatRejected',reason:'pending_server_item_use'});return}
    // Potions are currently saved locally. Keep server state bounded to actual
    // player stats, without accepting arbitrary max HP or a direct HP value.
    const now=Date.now();
    if(now<(current.lastHealAt||0)+1500){send(ws,{type:'combatRejected',reason:'Настой восстанавливается'});return;}
    current.lastHealAt=now;current.hp=Math.min(current.maxHp,current.hp+55);
    send(ws,{type:'playerVitals',hp:current.hp,maxHp:current.maxHp,resource:current.resource});
    return;
   }
   if(m.type!=='move')return;
   if(m.radius!==current.radius||typeof m.moving!=='boolean'||!headingOkay(m.heading))return;
   const normal=normalFrom(m.normal);if(!normal)return;
   const now=Date.now(),dt=Math.min(1,(now-current.updatedAt)/1000);
   if(dt<.075)return;
   if(arcDistance(normal,current.normal,current.radius)>MAX_SPEED*dt+.8)return;
   current.normal=normal;current.heading=m.heading;current.moving=m.moving;
   current.updatedAt=now;
   const loc=normalToLocal(normal,current.radius);
   current.x=loc.x;current.z=loc.z;
   if(!trustedCharacter&&Number.isInteger(m.level)&&m.level>=1&&m.level<=60){
    current.level=m.level;
    current.equipment=sanitizeSphereEquipment(m.equipment,current.level);
    current.maxHp=deriveStats(current.level,current.equipment).maxHp;
    current.hp=Math.min(current.hp,current.maxHp);
   }
  });
  ws.on('close',cleanup);ws.on('error',cleanup);
 }
 function tickOnce(dt=.1,now=Date.now()){
  for(const room of rooms.values()){
   room.tick++;
   const events=tickSphericalMobs(room.mobs,players,room.radius,dt,now);
   for(const e of events){
    if(e.type==='mobAttack'){
     const p=players.get(e.targetId);if(p)p.lastCombatAt=now;
    }
    if(e.type==='mobAttack'||e.type==='respawnAccepted')sendToId(e.targetId,e);
    else sendInRoom(room.radius,e);
   }
   for(const p of players.values()){
    if(p.radius!==room.radius||now-(p.lastCombatAt||0)<=5000)continue;
    p.hp=Math.min(p.maxHp,p.hp+3*dt);
    p.resource=Math.max(0,p.resource-5*dt);
   }
   if(![...players.values()].some(p=>p.radius===room.radius))continue;
   const snapshot={type:'snapshot',protocol:SPHERE_PROTOCOL,tick:room.tick,radius:room.radius,
    players:[...players.values()].filter(p=>p.radius===room.radius).map(publicPlayer),
    mobs:mobSnapshot(room.mobs)};
   sendInRoom(room.radius,snapshot);
  }
 }
 timer=setInterval(()=>{
  const now=Date.now(),dt=Math.min(.25,(now-clock)/1000);clock=now;
  tickOnce(dt,now);
 },TICK_MS);
 timer.unref?.();
 return {attach,population:()=>players.size,mobCount:()=>rooms.get(261).mobs.length,
  close:()=>clearInterval(timer),tickOnce,rooms,players};
}
