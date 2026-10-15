// NexGame Alpha 0.3.5.24: one authoritative PvE simulation per Mulgore world.
// Character persistence and identity remain client-side in this alpha.
import {deriveStats,ITEM_CATALOG,rollEquipmentLoot} from '../items.js';
import {LAKE_BLUEPRINT,normalizedLakeRadius} from '../lake.js';

export const MULGORE_MOB_SPAWNS=Object.freeze([
 [-9,-23],[1,-28],[13,-22],[21,-33],[-22,-35],[-28,29],[15,36],[48,9],[39,47]
]);
export const MOB_SPEED=.42;
export const MOB_TICK_LIMIT=.25;
export const MOB_CORPSE_MS=65000;
const MELEE_RANGE=3.95,STOMP_RANGE=4.9;
export const MOB_AGGRO_LEASH_RANGE=23; // World units: measured from this mob's fixed spawn position.
const normalSpeed=2.1,bossSpeed=1.75;
export const MOB_SIGHT_RANGE=7,MOB_BOSS_SIGHT_RANGE=9,MOB_ATTACK_WINDUP_MS=450;
const RETURN_SPEED=1.4;
// Static landmarks mirrored from the game scene. Prevent wandering through
// tents, trees, totems and the house; no runtime pathfinding dependency.
const blockers=[[11,-7,3.65],[-15,12,3.3],[13,16,2.96],[-23,-15,2.6],
 [-3,-5,.75],[5,9,.56],[-5,25,.6],[35,-14,.94],[-6,7,1.05],
 [-26,21,.48],[54,35,.4],[34,-26,.38],[-34,-30,.46],
 [9,49,.48],[-39,40,.44],[51,25,.52],[50,-8,.32],[-47,-7,.44]];
function mobWalkable(x,z){
 if(Math.abs(x)>68||Math.abs(z)>68||
  normalizedLakeRadius(x,z,LAKE_BLUEPRINT)<=.83)return false;
 // House walls are approximated as a solid rectangle; birds stay outdoors.
 if(Math.abs(x+27)<11.3&&Math.abs(z+2)<10.5)return false;
 return blockers.every(([bx,bz,r])=>Math.hypot(x-bx,z-bz)>r+.38);
}
function mobStep(mob,tx,tz,speed,dt,reach){
 const dx=tx-mob.x,dz=tz-mob.z,d=Math.hypot(dx,dz);
 if(d<=reach)return null;
 const length=Math.min(speed*dt,d-reach),yaw=Math.atan2(dx,dz);
 const side=mob.id%2?-1:1;
 const angles=[0,side*.5,side*1.0,side*1.5,-side*.5,-side*1,-side*1.5,side*2,-side*2];
 for(const angle of angles){
  const face=yaw+angle,sx=Math.sin(face),sz=Math.cos(face);
  const nx=mob.x+sx*length,nz=mob.z+sz*length;
  const oldHome=Math.hypot(mob.x-mob.spawnX,mob.z-mob.spawnZ);
  const newHome=Math.hypot(nx-mob.spawnX,nz-mob.spawnZ);
  if(newHome>MOB_AGGRO_LEASH_RANGE+4&&newHome>=oldHome)continue;
  const probe=Math.min(.8,d-reach);
  if(!mobWalkable(nx,nz)||!mobWalkable(mob.x+sx*probe,mob.z+sz*probe))continue;
  mob.x=nx;mob.z=nz;mob.phase+=length*4;
  return face;
 }
 return null;
}
const valid=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;

export function createMulgoreMobs(){
 return MULGORE_MOB_SPAWNS.map(([x,z],index)=>({
  id:index,x,z,yaw:0,phase:index,spawnX:x,spawnZ:z,roamTime:0,
  boss:index===MULGORE_MOB_SPAWNS.length-1,
  hp:index===MULGORE_MOB_SPAWNS.length-1?108:54,
  maxHp:index===MULGORE_MOB_SPAWNS.length-1?108:54,
  life:1,deadUntil:0,aggroId:null,returning:false,attackSeq:0,windupUntil:0,
  contributors:new Map(),stunnedUntil:0,attackAt:0,lastCombatAt:0
 }));
}
export function resetMulgoreMob(mob,{respawn=false}={}){
 const hadAggro=!!mob.aggroId;
 mob.hp=mob.maxHp;mob.aggroId=null;mob.contributors.clear();
 mob.deadUntil=0;mob.stunnedUntil=0;mob.attackAt=0;mob.windupUntil=0;mob.lastCombatAt=0;
 mob.returning=!respawn&&hadAggro;
 if(respawn){mob.life++;mob.x=mob.spawnX;mob.z=mob.spawnZ;mob.roamTime=0;}
}
// Clear hostile target immediately on death/respawn without changing loot
// or other players' damage contributions.
export function releaseMulgoreAggroForPlayer(mobs,playerId){
 if(typeof playerId!=='string'||!playerId)return 0;
 let released=0;
 for(const mob of mobs){
  if(mob.aggroId!==playerId)continue;
  mob.aggroId=null;
  mob.returning=true;mob.windupUntil=0;
  mob.attackAt=0;
  released++;
 }
 return released;
}
export function tickMulgoreMobs(mobs,dt,players=[],now=Date.now()){
 if(!valid(dt,.000001,Infinity))return [];
 dt=Math.min(dt,MOB_TICK_LIMIT);
 const people=new Map(players.filter(p=>p.joined!==false).map(p=>[p.id,p]));
 const events=[];
 for(const mob of mobs){
  if(mob.deadUntil){
   if(now>=mob.deadUntil)resetMulgoreMob(mob,{respawn:true});
   else continue;
  }
  mob.roamTime+=dt;
  let target=mob.aggroId?people.get(mob.aggroId):null;
  if(!mob.aggroId){
   const fromSpawn=Math.hypot(mob.x-mob.spawnX,mob.z-mob.spawnZ);
   if(fromSpawn>30){
    // Repair an idle mob displaced outside the supported world by old AI.
    mob.x=mob.spawnX;mob.z=mob.spawnZ;mob.returning=false;mob.windupUntil=0;
   }else if(fromSpawn>6){
    mob.returning=true;
   }
  }
  if(mob.aggroId&&(!target||target.hp<=0||target.respawnShieldUntil>now||
     Math.hypot(target.x-mob.spawnX,target.z-mob.spawnZ)>MOB_AGGRO_LEASH_RANGE)){
   resetMulgoreMob(mob);target=null;
  }
  // Returning mobs must get home before starting a new fight.
  if(mob.returning&&Math.hypot(mob.x-mob.spawnX,mob.z-mob.spawnZ)<.65){
   mob.returning=false;
  }
  if(!mob.aggroId&&!mob.returning){
   let nearest=null,best=mob.boss?MOB_BOSS_SIGHT_RANGE:MOB_SIGHT_RANGE;
   for(const player of people.values()){
    if(player.hp<=0||player.respawnShieldUntil>now||
       !Number.isFinite(player.x)||!Number.isFinite(player.z)||
       Math.hypot(player.x-mob.spawnX,player.z-mob.spawnZ)>MOB_AGGRO_LEASH_RANGE)continue;
    const d=Math.hypot(player.x-mob.x,player.z-mob.z);
    if(d<best){best=d;nearest=player;}
   }
   if(nearest){
    mob.aggroId=nearest.id;
    mob.attackAt=now+280;target=nearest;
   }
  }
  const opponent=mob.aggroId?people.get(mob.aggroId):null;
  const stunned=mob.stunnedUntil>now;
  const tx=opponent?opponent.x:mob.returning?mob.spawnX:
   mob.spawnX+Math.sin(mob.roamTime*.18+mob.id)*2.2;
  const tz=opponent?opponent.z:mob.returning?mob.spawnZ:
   mob.spawnZ+Math.cos(mob.roamTime*.14+mob.id)*2.2;
  const speed=opponent?(mob.boss?bossSpeed:normalSpeed):mob.returning?RETURN_SPEED:MOB_SPEED;
  const d=Math.hypot(tx-mob.x,tz-mob.z);
  if(opponent&&d>.001){
   const facing=Math.atan2(tx-mob.x,tz-mob.z);
   mob.yaw+=Math.atan2(Math.sin(facing-mob.y),Math.cos(facing-mob.y))*(1-Math.exp(-dt*6));
  }
  if(!stunned&&(!opponent||!mob.windupUntil)){
   const heading=mobStep(mob,tx,tz,speed,dt,
    opponent?(mob.boss?2.75:1.75):mob.returning?.35:.25);
   if(!opponent&&heading!==null){
    mob.yaw+=Math.atan2(Math.sin(heading-mob.yaw),Math.cos(heading-mob.yaw))
     *(1-Math.exp(-dt*6));
   }
  }
  if(stunned||!opponent){mob.windupUntil=0;continue;}
  const distance=Math.hypot(opponent.x-mob.x,opponent.z-mob.z);
  if(mob.windupUntil){
   if(now>=mob.windupUntil){
    mob.windupUntil=0;
    if(distance<(mob.boss?3:2.1))
     events.push({type:'mobAttack',mobId:mob.id,targetId:opponent.id,
      amount:mob.boss?14:9,life:mob.life});
   }
  }else if(distance<(mob.boss?3:2.1)&&now>=mob.attackAt){
   // Begin visible Peck before delivering damage. A moving player can dodge.
   mob.attackSeq++;
   mob.windupUntil=now+MOB_ATTACK_WINDUP_MS;
   mob.attackAt=now+(mob.boss?1800:1500);
  }
 }
 return events;
}
export function snapshotMulgoreMobs(mobs,now=Date.now()){
 return mobs.map(mob=>({id:mob.id,x:mob.x,z:mob.z,yaw:mob.yaw,
  phase:mob.phase,hp:mob.hp,maxHp:mob.maxHp,life:mob.life,
  dead:mob.deadUntil>now,aggroId:mob.aggroId,stunned:mob.stunnedUntil>now,
  attackSeq:mob.attackSeq,returning:mob.returning}));
}
export function sanitizeEquipment(equipment,level){
 if(!equipment||typeof equipment!=='object'||Array.isArray(equipment))return {};
 const clean={};
 for(const [slot,entry] of Object.entries(equipment)){
  // Incoming client packets contain item IDs; server-stored loadouts already
  // contain normalized {id,qty} objects. Validate BOTH forms against catalog.
  const id=typeof entry==='string'?entry:
   entry&&typeof entry==='object'&&!Array.isArray(entry)?entry.id:null;
  if(typeof id!=='string')continue;
  const item=ITEM_CATALOG[id];
  if(item?.slot===slot&&(item.requiredLevel||1)<=level)clean[slot]={id,qty:1};
 }
 return clean;
}
export function rollMulgoreLoot(boss=false,rng=Math.random){
 const gear=rollEquipmentLoot(boss,rng),items=gear?[gear]:[];
 if(boss)items.unshift({id:'giantFeather',qty:1});
 if(rng()>=.72)return items;
 const roll=rng(),id=roll<.42?'feather':roll<.72?'beak':roll<.94?'down':'charm';
 items.push({id,qty:id==='down'&&rng()<.38?2:1});
 if(rng()<.16)items.push({id:id==='feather'?'down':'feather',qty:1});
 return items;
}
// Caller must pass the player object stored by the WebSocket server: do not trust
// user-provided damage, cooldowns, target positions or claimed kills.
export function applyMulgoreAbility(mobs,player,abilityId,mobId,now=Date.now(),rng=Math.random){
 if(!player||!['autoAttack','heavyStrike','thunderStomp'].includes(abilityId))
  return {ok:false,reason:'Неизвестная атака'};
 const area=abilityId==='thunderStomp';
 const target=area?null:mobs[mobId];
 if(!area&&(!Number.isInteger(mobId)||!target||target.deadUntil))
  return {ok:false,reason:'Цель недоступна'};
 if(!player.combatReadyAt)player.combatReadyAt=Object.create(null);
 // Basic swings are governed only by weapon speed. Specials additionally
 // obey the global cooldown. Tell the client how long to wait on rejection.
 const cooldownMs=Math.max(0,Math.ceil((player.combatReadyAt[abilityId]||0)-now));
 const gcdMs=Math.max(0,Math.ceil((player.gcdAt||0)-now));
 if(cooldownMs>0||(abilityId!=='autoAttack'&&gcdMs>0))
  return {ok:false,reason:'Способность восстанавливается',
   cooldownMs,gcdMs,retryAfterMs:Math.max(cooldownMs,abilityId==='autoAttack'?0:gcdMs)};
 const stats=deriveStats(player.level||1,sanitizeEquipment(player.equipment,player.level||1));
 if(!area){
  const dx=target.x-player.x,dz=target.z-player.z,d=Math.hypot(dx,dz);
  if(d>MELEE_RANGE)return {ok:false,reason:'Цель слишком далеко'};
  if(d>.001&&Math.sin(player.yaw)*dx+Math.cos(player.yaw)*dz<d*-.12)
   return {ok:false,reason:'Цель не перед вами'};
 }
 const victims=area?mobs.filter(m=>!m.deadUntil&&Math.hypot(m.x-player.x,m.z-player.z)<=STOMP_RANGE):[target];
 const damage=area?6:Math.max(1,Math.round(
  stats.damageMin+rng()*(stats.damageMax-stats.damageMin)+
  (abilityId==='heavyStrike'?8:0)));
 player.combatReadyAt[abilityId]=now+(area?8000:abilityId==='heavyStrike'?3000:stats.speed*1000);
 if(abilityId!=='autoAttack')player.gcdAt=now+1500;
 const hits=[],deaths=[];
 for(const mob of victims){
  if(mob.deadUntil)continue;
  mob.hp=Math.max(0,mob.hp-damage);
  mob.contributors.set(player.id,(mob.contributors.get(player.id)||0)+damage);
  mob.aggroId=player.id;mob.returning=false;mob.lastCombatAt=now;
  if(area){mob.stunnedUntil=now+2500;mob.windupUntil=0;}
  if(mob.hp===0){
   mob.deadUntil=now+MOB_CORPSE_MS;mob.aggroId=null;mob.windupUntil=0;
   deaths.push({id:mob.id,life:mob.life,boss:mob.boss,
    contributors:[...mob.contributors.keys()]});
  }
  hits.push({id:mob.id,amount:damage,hp:mob.hp,dead:mob.hp===0,life:mob.life});
 }
 return {ok:true,event:{
  type:'combat',actorId:player.id,abilityId,hits,
  // Durations, not absolute server timestamps: safe across client clocks.
  cooldownMs:Math.max(0,Math.ceil(player.combatReadyAt[abilityId]-now)),
  gcdMs:Math.max(0,Math.ceil((player.gcdAt||0)-now))
 },deaths};
}
