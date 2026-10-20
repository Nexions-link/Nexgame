// NexGameWorld: one spherical, shared authoritative PvE world per planet radius.
// Legacy flat-world sessions are intentionally not attached here.
import {randomUUID} from 'node:crypto';
import {createAccountEconomyDispatcher} from './account-economy-dispatch.js';
import {resolve,dirname,join} from 'node:path';
import {WebSocket} from 'ws';
import {createPartyManager} from './groups.js';
import {createChatManager} from './chat.js';
import {createSharedChest,CHEST_X,CHEST_Z,CHEST_SLOTS} from './chest.js';
import {
 createSphericalMobs,mobSnapshot,tickSphericalMobs,applySphereAttack,
 sanitizeSphereEquipment,normalToLocal,arcDistance,localDistance,startSphereEvade
} from './spherical-pve.js';
import {deriveStats} from '../items.js';
import {resolveSphereWalk} from './world-movement.js';
import {applySphereCharge} from './sphere-charge.js';
import {selectVisiblePlayers} from './world-interest.js';
import {CORPSE_LOOT_RANGE} from '../planet-test/interaction-targeting.js';
import {isAuthorizedBattlefuryEquipped,ADMIN_BATTLEFURY_ID} from './admin-battlefury.js';
import {BATTLEFURY_TUNER_DEFAULTS,BATTLEFURY_TUNER_FIELDS,normalizeBattlefuryTuning} from '../planet-test/battlefury-tuner.js';

export const SPHERE_PROTOCOL=2;
// Recover from dropped/throttled mobile movement packets without teleporting.
// Authoritative distance and chest checks remain entirely server-side.
export function boundedSphereAdvance(from,to,radius,meters){
 const distance=arcDistance(from,to,radius);
 if(!Number.isFinite(distance)||distance<=0||distance>=Math.PI*radius-1e-5)return [...from];
 if(distance<=meters)return [...to];
 if(!(meters>0))return [...from];
 const theta=distance/radius,t=meters/distance,s=Math.sin(theta);
 const next=from.map((v,i)=>
  (v*Math.sin((1-t)*theta)+to[i]*Math.sin(t*theta))/s);
 const length=Math.hypot(...next);
 return length>1e-8?next.map(v=>v/length):[...from];
}
const RADII=[87,174,261],TICK_MS=100,MAX_PLAYERS=100,MAX_SPEED=7;
// Recover normal packet loss (up to a few dozen metres), never accept an
// implausible half-planet destination as a path to glide toward.
const MAX_POSITION_RESYNC=50;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const bound=(v,min,max)=>Math.max(min,Math.min(max,v));
const cleanName=name=>typeof name==='string'
 ?name.trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,24)||'Странник':'Странник';
const normalFrom=raw=>{
 if(!Array.isArray(raw)||raw.length!==3||!raw.every(finite))return null;
 const d=Math.hypot(...raw);return d<.99||d>1.01?null:raw.map(n=>n/d);
};
// The camera/gameplay can accumulate multiple full turns. Discarding otherwise
// valid movement packets with yaw > 4π leaves the server avatar stranded.
// Reduce finite headings to their canonical angle before validating movement.
export const canonicalSphereHeading=h=>finite(h)&&Math.abs(h)<=1e6
 ?Math.atan2(Math.sin(h),Math.cos(h)):null;
const headingOkay=h=>canonicalSphereHeading(h)!==null;
const MAX_SNAPSHOT_BUFFER=512*1024;
const send=(ws,p)=>{
 if(ws.readyState!==WebSocket.OPEN)return;
 // A disconnected mobile tab must not accumulate unlimited outdated snapshots.
 if(p.type==='snapshot'&&ws.bufferedAmount>MAX_SNAPSHOT_BUFFER)return;
 ws.send(JSON.stringify(p));
};
// Cosmetic appearance is only certified from a stored, authenticated character.
// Never trust a client-provided weapon ID or character ID for other players.
export const publicPlayer=p=>({
 id:p.id,name:p.name,normal:p.normal,heading:p.heading,
 moving:p.moving,radius:p.radius,level:p.level,hp:p.hp,maxHp:p.maxHp,
 resource:p.resource,equipment:{
  weapon:p.equipment.weapon?.id||null,shieldId:p.equipment.shield?.id||null
 },
 ...(isAuthorizedBattlefuryEquipped(p)?{
  battlefury:{itemId:ADMIN_BATTLEFURY_ID,pose:p.battlefuryPose||BATTLEFURY_TUNER_DEFAULTS}
 }:{})
});
// All ten finite numeric fields must be present. Other packets cannot remove or
// forge an item: rejected cosmetic packets leave the last good pose intact.
export function sanitizeBattlefuryPresence(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 for(const key of Object.keys(BATTLEFURY_TUNER_DEFAULTS)){
  if(typeof raw[key]!=='number'||!Number.isFinite(raw[key]))return null;
 }
 return normalizeBattlefuryTuning(raw);
}
export function createSphericalWorld({chestFilePath=resolve(process.env.NGW_CHEST_DATA_FILE||join(dirname(resolve(process.env.CHEST_DATA_FILE||'chest-data.json')),'nexgameworld-chest.json'))}={}){
 const players=new Map(),connections=new Map();
 const counters={movementRejected:0,positionCorrections:0,progressSaveFailures:0,snapshotsSent:0};
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
  broadcast:event=>{for(const p of players.values())if(!p.accountId)sendToId(p.id,event)},filePath:chestFilePath});
 let timer=null;
 function attach(ws,{trustedCharacter=null,progressStore=null,economyStore=null}={}){
  // Serialize all server-generated character saves for this connection.
  // A socket is not released for another login until its save queue drains.
  let saveQueue=Promise.resolve(),lastCheckpoint=0,saveFailed=false;
  let messageBudget=80,messageRefillAt=Date.now();
  function queueSave(operation){
   if(saveFailed)return Promise.reject(Error('session_save_failed'));
   const pending=saveQueue.then(()=>{
    if(saveFailed)throw Error('session_save_failed');
    return operation();
   });
   saveQueue=pending.catch(error=>{
    if(saveFailed)return;
    saveFailed=true;
    counters.progressSaveFailures++;
    console.error('NexGameWorld authoritative progress save failed:',
     error?.code||error?.name||'unknown');
    send(ws,{type:'progressError',reason:'Не удалось сохранить прогресс. Переподключитесь.'});
    if(ws.readyState===WebSocket.OPEN)ws.close(1011,'Progress save failed');
   });
   return pending;
  }
  function publishProgress(p,result,source){
   const progress=result.progress;
   p.savedRevision=progress.revision;
   p.savedInventory=progress.inventory;
   p.level=progress.level;
   p.equipment=sanitizeSphereEquipment(progress.equipment,progress.level);
   p.maxHp=deriveStats(progress.level,p.equipment).maxHp;
   p.hp=Math.min(p.maxHp,p.hp);
   send(ws,{type:'progressSaved',source,progress});
  }
  if(connections.size>=MAX_PLAYERS){
   ws.close(1013,'World is full');
   return {accepted:false,drain:()=>saveQueue};
  }
  connections.set(ws,null);
  const cleanup=()=>{
   if(!connections.has(ws))return;
   const p=connections.get(ws);
   connections.delete(ws);
   if(p){
    p.closeAccountChest?.();
    if(p.queueCheckpoint){
     void p.queueCheckpoint({normal:[...p.normal],heading:p.heading,
      radius:p.radius},'exit').catch(()=>{});
    }
    party.disconnect(p.id);chat.disconnect(p.id);chest.disconnect(p.id);
    players.delete(p.id);sendInRoom(p.radius,{type:'leave',id:p.id});
    for(const mob of rooms.get(p.radius).mobs)if(mob.aggroId===p.id)
     startSphereEvade(mob);
   }
  };
  // Publish only occupancy (never item IDs) after the server confirms proximity.
  // The same path serves explicit polls and automatic arrival notifications.
  const sendNearbyChestStatus=p=>{
   if(Math.hypot(p.x-CHEST_X,p.z-CHEST_Z)>12)return;
   if(p.accountId){
    if(economyStore?.readChestStatus)
     void economyStore.readChestStatus().then(status=>{
      if(connections.get(ws)===p)send(ws,{type:'chestStatus',...status});
     }).catch(()=>{});
   }else{
    const snapshot=chest.state();
    send(ws,{type:'chestStatus',occupied:snapshot.slots.filter(Boolean).length,
     total:CHEST_SLOTS,revision:snapshot.revision});
   }
  };
  ws.on('message',raw=>{
   const messageNow=Date.now();
   messageBudget=Math.min(80,messageBudget+Math.max(0,messageNow-messageRefillAt)*.05);
   messageRefillAt=messageNow;
   if(messageBudget<1){ws.close(1008,'Message rate exceeded');return;}
   messageBudget--;
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
    const heading=canonicalSphereHeading(saved?saved.heading:m.heading);
    if(!normal||heading===null)return;
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
     level,equipment,hp,maxHp:stats.maxHp,resource:saved?bound(saved.resource,0,100):0,
     battlefuryPose:BATTLEFURY_TUNER_DEFAULTS,
     lastMobAttackAt:0,lastCombatAt:0,respawnShieldUntil:0,updatedAt:Date.now(),
     joined:true,x:local.x,z:local.z,abilityCooldowns:{},chargeBonus:null,chargeUntil:0,
     savedRevision:saved?.revision??null,lastPositionCorrectionAt:0};
    if(trustedCharacter&&progressStore){
     p.queueVerifiedKill=credit=>queueSave(async()=>{
      const result=await progressStore.recordMobKill({
       accountId:p.accountId,characterId:p.characterId,
       expectedRevision:p.savedRevision,radius:p.radius,serverCredit:credit,deferLoot:true
      });
      if(result.applied){
       publishProgress(p,result,'mob');
       send(ws,{type:'economyResult',kind:'lootAvailable',ok:true,
        mobId:credit.mobId,life:credit.life,loot:credit.loot});
      }
     });
     p.queueCheckpoint=(checkpoint,source='checkpoint')=>{
      // Capture authoritative vitals alongside the accepted movement state.
      const serverVitals={health:p.hp,resource:p.resource};
      return queueSave(async()=>{
       const result=await progressStore.saveServerCheckpoint({
        accountId:p.accountId,characterId:p.characterId,
        expectedRevision:p.savedRevision,checkpoint,serverVitals
       });
       publishProgress(p,result,source);
      });
     };
    }
    p.savedInventory=Array.isArray(saved?.inventory)?saved.inventory:null;
    if(trustedCharacter&&progressStore&&economyStore){
     const dispatch=createAccountEconomyDispatcher({
      player:p,economyStore,progressStore,queueSave,
      corpseContext:message=>{
       const mob=rooms.get(p.radius).mobs.find(e=>e.id===message.mobId);
       if(!mob||mob.phase!=='corpse'||mob.life!==message.life||
          Date.now()>=mob.corpseUntil||p.hp<=0)
        throw Object.assign(Error('corpse_unavailable'),{code:'corpse_unavailable'});
       if(localDistance(mob,p,p.radius)>CORPSE_LOOT_RANGE)
        throw Object.assign(Error('interaction_too_far'),{code:'interaction_too_far'});
       return {mobId:mob.id,life:mob.life,radius:p.radius,x:mob.x,z:mob.z};
      },
      publishProgress:(result,source)=>publishProgress(p,result,source),
      send:event=>send(ws,event),
      broadcastChest:chestState=>{
       const occupied=chestState.slots.filter(Boolean).length;
       for(const other of players.values()){
        if(other.id===p.id||!other.accountId||other.radius!==p.radius)continue;
        if(Math.hypot(other.x-CHEST_X,other.z-CHEST_Z)<=12)
         sendToId(other.id,{type:'chestStatus',occupied,total:CHEST_SLOTS,revision:chestState.revision});
        if(other.accountChestOpen)sendToId(other.id,{type:'chestState',...chestState});
       }
      }
     });
     p.queueEconomy=dispatch.invoke;
     p.closeAccountChest=()=>{dispatch.closeChest();p.accountChestOpen=false};
    }
    players.set(p.id,p);connections.set(ws,p);
    send(ws,{type:'welcome',world:'nexgameworld',protocol:SPHERE_PROTOCOL,
     id:p.id,radius:p.radius,tickMs:TICK_MS,players:[...players.values()]
      .filter(x=>x.radius===p.radius&&x.id!==p.id).map(publicPlayer),
     mobs:mobSnapshot(rooms.get(p.radius).mobs),hp:p.hp,maxHp:p.maxHp,resource:p.resource,
     onlineCount:[...players.values()].filter(x=>x.radius===p.radius).length,
     ...(trustedCharacter?{characterId:p.characterId,
      progress:trustedCharacter.progress,authenticated:true}:{})});
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
   if(m.type==='chestStatus'){sendNearbyChestStatus(current);return;}
   if(m.type==='chestOpen'){
    if(trustedCharacter){
     if(current.queueEconomy)void current.queueEconomy('chestOpen').catch(()=>{});
     else send(ws,{type:'chestResult',ok:false,reason:'pending_server_inventory'});
     return;
    }
    chest.open(current.id,m.inventory);return
   }
   if(m.type==='chestMove'){
    if(trustedCharacter){
     if(current.queueEconomy)void current.queueEconomy('chestMove',m).catch(()=>{});
     else send(ws,{type:'chestResult',ok:false,reason:'pending_server_inventory'});
     return;
    }
    chest.move(current.id,m);return
   }
   if(m.type==='chestClose'){
    if(trustedCharacter){current.closeAccountChest?.();return}
    chest.close(current.id);return
   }
   if(m.type==='economyAction'){
    if(trustedCharacter&&current.queueEconomy&&typeof m.kind==='string'&&m.kind.length<40)
     void current.queueEconomy(m.kind,m).catch(()=>{});
    return;
   }
   if(m.type==='charge'){
    const now=Date.now(),fromNormal=[...current.normal];
    const result=applySphereCharge(rooms.get(current.radius).mobs,current,m.mobId,now);
    if(!result.ok){
     send(ws,{type:'combatRejected',abilityId:'charge',reason:result.reason});return;
    }
    current.updatedAt=now;current.moving=true;
    // Cosmetic motion for nearby clients; relocation and collisions remain server-owned.
    sendInRoom(current.radius,{type:'chargeVisual',id:current.id,fromNormal,
     normal:[...current.normal],heading:current.heading,durationMs:result.durationMs});
    send(ws,{type:'chargeAccepted',abilityId:'charge',mobId:m.mobId,
     normal:[...current.normal],heading:current.heading,durationMs:result.durationMs});
    return;
   }
   if(m.type==='attack'){
    if(current.respawnShieldUntil>Date.now())return;
    const res=applySphereAttack(rooms.get(current.radius).mobs,current,m.abilityId,m.mobId);
    if(!res.ok){send(ws,{type:'combatRejected',abilityId:m.abilityId,reason:res.reason});return}
    if(res.events.length)current.lastCombatAt=Date.now();
    for(const event of res.events)sendInRoom(current.radius,event);
    for(const entry of res.credits){
     const recipient=players.get(entry.targetId);
     if(recipient?.queueVerifiedKill){
      void recipient.queueVerifiedKill(entry.event).catch(()=>{});
     }else sendToId(entry.targetId,entry.event);
    }
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
   if(m.radius!==current.radius||typeof m.moving!=='boolean')return;
   const heading=canonicalSphereHeading(m.heading);
   const normal=normalFrom(m.normal);
   if(!normal||heading===null)return;
   if(Date.now()<(current.chargeUntil||0))return;
   const now=Date.now(),dt=Math.min(1,(now-current.updatedAt)/1000);
   if(dt<.075)return;
   const delta=arcDistance(normal,current.normal,current.radius);
   const correct=reason=>{
    if(now-(current.lastPositionCorrectionAt||0)<500)return;
    current.lastPositionCorrectionAt=now;
    counters.positionCorrections++;
    send(ws,{type:'positionCorrection',normal:[...current.normal],
     heading:current.heading,reason});
   };
   if(!Number.isFinite(delta)||delta>MAX_POSITION_RESYNC){
    correct('position_out_of_range');return;
   }
   const capped=delta>MAX_SPEED*dt+.8;
   const desired=capped
    ?boundedSphereAdvance(current.normal,normal,current.radius,MAX_SPEED*dt):normal;
   const sweep=resolveSphereWalk(current.normal,desired,current.radius);
   current.normal=sweep.normal;
   current.heading=heading;
   current.moving=m.moving&&!sweep.blocked;
   current.updatedAt=now;
   // Accept only cosmetic transforms from the authenticated, uniquely
   // equipped owner; never from guests or from arbitrary gear IDs.
   if(trustedCharacter&&isAuthorizedBattlefuryEquipped(current)){
    const pose=sanitizeBattlefuryPresence(m.battlefuryPose);
    if(pose)current.battlefuryPose=pose;
   }
   const loc=normalToLocal(current.normal,current.radius);
   current.x=loc.x;current.z=loc.z;
   // The first accepted movement into range pushes the count without opening.
   const chestNearby=Math.hypot(current.x-CHEST_X,current.z-CHEST_Z)<=12;
   if(chestNearby&&!current.chestStatusNearby)sendNearbyChestStatus(current);
   current.chestStatusNearby=chestNearby;
   if(sweep.blocked)counters.movementRejected++;
   if(sweep.blocked||capped&&arcDistance(current.normal,normal,current.radius)>1.5)
    correct(sweep.blocked?'collision':'speed_limit');
   if(current.queueCheckpoint&&now-lastCheckpoint>=6000){
    lastCheckpoint=now;
    // Save only the movement actually accepted by the authoritative server,
    // never an unbounded proposed destination or a multi-turn heading.
    const checkpoint={normal:[...current.normal],heading:current.heading,radius:current.radius};
    void current.queueCheckpoint(checkpoint).catch(()=>{});
   }
   if(!trustedCharacter&&Number.isInteger(m.level)&&m.level>=1&&m.level<=60){
    current.level=m.level;
    current.equipment=sanitizeSphereEquipment(m.equipment,current.level);
    current.maxHp=deriveStats(current.level,current.equipment).maxHp;
    current.hp=Math.min(current.hp,current.maxHp);
   }
  });
  ws.on('close',cleanup);ws.on('error',cleanup);
  return {accepted:true,drain:()=>saveQueue,requestCheckpoint:()=>{
   const p=connections.get(ws);
   if(!p?.queueCheckpoint)return saveQueue;
   return p.queueCheckpoint({normal:[...p.normal],
    heading:p.heading,radius:p.radius},'exit');
  }};
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
   const roomPlayers=[...players.values()].filter(p=>p.radius===room.radius);
   if(!roomPlayers.length||room.tick%2!==0)continue;
   // Send 5Hz visual snapshots, but keep the world simulation at 10Hz.
   const worldMobs=mobSnapshot(room.mobs);
   const publicRows=roomPlayers.map(publicPlayer);
   const byId=new Map(publicRows.map(p=>[p.id,p]));
   for(const [ws,observer] of connections){
    if(observer?.radius!==room.radius)continue;
    const visible=selectVisiblePlayers(roomPlayers,observer,room.radius);
    counters.snapshotsSent++;
    send(ws,{type:'snapshot',protocol:SPHERE_PROTOCOL,tick:room.tick,
     radius:room.radius,onlineCount:roomPlayers.length,
     players:visible.map(p=>byId.get(p.id)),mobs:worldMobs});
   }
  }
 }
 timer=setInterval(()=>{
  const now=Date.now(),dt=Math.min(.25,(now-clock)/1000);clock=now;
  tickOnce(dt,now);
 },TICK_MS);
 timer.unref?.();
 return {attach,population:()=>players.size,mobCount:()=>rooms.get(261).mobs.length,
  close:()=>clearInterval(timer),tickOnce,rooms,players,metrics:()=>({...counters})};
}
