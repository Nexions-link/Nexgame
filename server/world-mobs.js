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
const valid=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;

export function createMulgoreMobs(){
 return MULGORE_MOB_SPAWNS.map(([x,z],index)=>({
  id:index,x,z,yaw:0,phase:index,spawnX:x,spawnZ:z,roamTime:0,
  boss:index===MULGORE_MOB_SPAWNS.length-1,
  hp:index===MULGORE_MOB_SPAWNS.length-1?108:54,
  maxHp:index===MULGORE_MOB_SPAWNS.length-1?108:54,
  life:1,deadUntil:0,aggroId:null,contributors:new Map(),
  stunnedUntil:0,attackAt:0,lastCombatAt:0
 }));
}
export function resetMulgoreMob(mob,{respawn=false}={}){
 mob.hp=mob.maxHp;mob.aggroId=null;mob.contributors.clear();
 mob.deadUntil=0;mob.stunnedUntil=0;mob.attackAt=0;mob.lastCombatAt=0;
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
  mob.attackAt=0;
  released++;
 }
 return released;
}
export function tickMulgoreMobs(mobs,dt,players=[],now=Date.now()){
 if(!valid(dt,0.000001,Infinity))return [];
 dt=Math.min(dt,MOB_TICK_LIMIT);
 const people=new Map(players.map(p=>[p.id,p]));
 const events=[];
 for(const mob of mobs){
  if(mob.deadUntil){
   if(now>=mob.deadUntil)resetMulgoreMob(mob,{respawn:true});
   else continue;
  }
  mob.roamTime+=dt;
  const target=mob.aggroId?people.get(mob.aggroId):null;
  // No inactivity timeout: stop only when the target leaves 23 m from spawn
  // (or on disconnect, death or respawn).
  const awayFromSpawn=target?Math.hypot(
   target.x-mob.spawnX,target.z-mob.spawnZ):Infinity;
  if(mob.aggroId&&(!target||target.hp<=0||target.respawnShieldUntil>now||
    awayFromSpawn>MOB_AGGRO_LEASH_RANGE)){
   resetMulgoreMob(mob);
  }
  const opponent=mob.aggroId?people.get(mob.aggroId):null;
  const stunned=mob.stunnedUntil>now;
  const tx=opponent?opponent.x:mob.spawnX+Math.sin(mob.roamTime*.18+mob.id)*2.2;
  const tz=opponent?opponent.z:mob.spawnZ+Math.cos(mob.roamTime*.14+mob.id)*2.2;
  const speed=opponent?(mob.boss?bossSpeed:normalSpeed):MOB_SPEED;
  const dx=tx-mob.x,dz=tz-mob.z,d=Math.hypot(dx,dz);
  const threshold=opponent?(mob.boss?2.75:1.75):.25;
  if(!stunned&&d>threshold){
   const step=Math.min(speed*dt,d-threshold);
   const nx=mob.x+dx/d*step,nz=mob.z+dz/d*step;
   // Until swimming is supported, even server-authoritative mobs keep
   // out of deep water instead of walking along the lake bottom.
   if(normalizedLakeRadius(nx,nz,LAKE_BLUEPRINT)>.83){
    mob.x=nx;mob.z=nz;mob.phase+=step*4;
   }
   const facing=Math.atan2(dx,dz);
   mob.yaw+=Math.atan2(Math.sin(facing-mob.yaw),Math.cos(facing-mob.yaw))
    *(1-Math.exp(-dt*6));
  }
  if(opponent&&!stunned&&d<(mob.boss?3:2.1)&&now>=mob.attackAt){
   mob.attackAt=now+(mob.boss?1800:1500);
   events.push({type:'mobAttack',mobId:mob.id,targetId:opponent.id,
    amount:mob.boss?14:9,life:mob.life});
  }
 }
 return events;
}
export function snapshotMulgoreMobs(mobs,now=Date.now()){
 return mobs.map(mob=>({id:mob.id,x:mob.x,z:mob.z,yaw:mob.yaw,
  phase:mob.phase,hp:mob.hp,maxHp:mob.maxHp,life:mob.life,
  dead:mob.deadUntil>now,aggroId:mob.aggroId,stunned:mob.stunnedUntil>now}));
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
  mob.aggroId=player.id;mob.lastCombatAt=now;
  if(area)mob.stunnedUntil=now+2500;
  if(mob.hp===0){
   mob.deadUntil=now+MOB_CORPSE_MS;mob.aggroId=null;
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
