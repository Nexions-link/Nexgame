// NexGameWorld spherical shared PvE. Authoritative mob AI, combat and corpse lifecycle.
// The original flat-world spawning and combat code is NOT loaded by this module.
import {canWalkCamp} from '../planet-test/sphere-physics.js';
import {moveMobToward,mobSegmentClear} from '../planet-test/mob-navigation.js';
import {rollCreatureLoot} from '../planet-test/loot-tables.js';
import {deriveStats,ITEM_CATALOG,armorReduction} from '../items.js';
import {getAbilityDefinition} from '../skills.js';

export const SPHERE_MOB_SPAWNS=Object.freeze([
 [-9,-23],[1,-28],[13,-22],[21,-33],[-22,-35],[-28,29],[15,36],[48,9],[39,47]
]);
export const SPHERE_CORPSE_MS=30000;
export const SPHERE_RESPAWN_MS=30000;
export const SPHERE_LEASH_METRES=23;
export const SPHERE_ROAM_RADIUS=3.2;
const TAU=Math.PI*2,MAX_TICK=.25,MELEE_RANGE=3.45,STOMP_RANGE=4.5;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
export function localToNormal(x,z,r){
 const d=Math.hypot(x,z),angle=d/r;
 return d<1e-8?[0,0,1]:[x*Math.sin(angle)/d,z*Math.sin(angle)/d,Math.cos(angle)];
}
export function normalToLocal(normal,r){
 if(!Array.isArray(normal)||normal.length!==3||!normal.every(finite))return null;
 const d=Math.acos(clamp(normal[2],-1,1))*r,len=Math.hypot(normal[0],normal[1]);
 return len<1e-8?{x:0,z:0,d}: {x:normal[0]*d/len,z:normal[1]*d/len,d};
}
export function arcDistance(a,b,r){
 if(!Array.isArray(a)||!Array.isArray(b)||!a.every(finite)||!b.every(finite))return Infinity;
 return Math.acos(clamp(a[0]*b[0]+a[1]*b[1]+a[2]*b[2],-1,1))*r;
}
export function localDistance(mob,player,r){
 return arcDistance(localToNormal(mob.x,mob.z,r),player.normal,r);
}
// Hero heading is measured in the tangent East/North basis used in planet.js.
export function facesMob(player,mob,r,cosLimit=Math.cos(.9)){
 const n=player.normal, other=localToNormal(mob.x,mob.z,r);
 const lon=Math.atan2(n[0],n[2]);
 const east=[Math.cos(lon),0,-Math.sin(lon)];
 const north=[n[1]*east[2]-n[2]*east[1],n[2]*east[0]-n[0]*east[2],n[0]*east[1]-n[1]*east[0]];
 const fwd=east.map((v,i)=>v*Math.cos(player.heading)+north[i]*Math.sin(player.heading));
 const dot=n[0]*other[0]+n[1]*other[1]+n[2]*other[2];
 const aim=other.map((v,i)=>v-dot*n[i]);
 const length=Math.hypot(...aim);
 return length>.000001&&fwd.reduce((s,v,i)=>s+v*aim[i],0)/length>=cosLimit;
}
const lakeWalkable=(x,z)=>{
 // Same submerged basin as the browser world, conservatively treated as non-walkable
 // for wildlife. This prevents AI from crossing its deepest section.
 const dx=(x-30)/17.2,dz=(z-26)/12.5;
 const angle=Math.atan2(dz,dx);
 const shoreline=1+.041*Math.sin(3*angle+.5)+.026*Math.cos(5*angle-1.2)+.014*Math.sin(9*angle+.3);
 return Math.hypot(dx,dz)/shoreline>=.98;
};
const walkable=(x,z,r)=>canWalkCamp(x,z,r)&&lakeWalkable(x,z);
// The visual GLB points along tangent-local +Z, matching mob-facing.js.
export function sphericalMobYaw(x,z,dx,dz,radius){
 const d=Math.hypot(dx,dz);if(d<1e-8)return null;
 const n=localToNormal(x,z,radius),to=localToNormal(x+dx/d,z+dz/d,radius);
 const dot=n[0]*to[0]+n[1]*to[1]+n[2]*to[2];
 const f=[to[0]-dot*n[0],to[1]-dot*n[1],to[2]-dot*n[2]];
 const qden=Math.sqrt(2*(1+n[1]));if(qden<1e-8)return null;
 const qx=n[2]/qden,qz=-n[0]/qden,qw=(1+n[1])/qden;
 const localX=[1-2*qz*qz,2*qw*qz,2*qx*qz];
 const localZ=[2*qx*qz,-2*qw*qx,1-2*qx*qx];
 return Math.atan2(f[0]*localX[0]+f[1]*localX[1]+f[2]*localX[2],
   f[0]*localZ[0]+f[1]*localZ[1]+f[2]*localZ[2]);
}
function chooseRoamGoal(mob,now,rng){
 const size=mob.boss?.94:.52,canWalk=(x,z)=>walkable(x,z,size);
 for(let attempt=0;attempt<12;attempt++){
  const angle=TAU*clamp(rng(),0,1),distance=1.15+(SPHERE_ROAM_RADIUS-1.15)*clamp(rng(),0,1);
  const x=mob.spawnX+Math.sin(angle)*distance,z=mob.spawnZ+Math.cos(angle)*distance;
  if(!canWalk(x,z)||!mobSegmentClear(mob.x,mob.z,x,z,canWalk))continue;
  mob.roamGoalX=x;mob.roamGoalZ=z;mob.roamState='walking';mob.navigation=null;return;
 }
 mob.roamState='rest';mob.roamUntil=now+1800;
}
export function createSphericalMobs(){
 return SPHERE_MOB_SPAWNS.map(([x,z],i)=>{
  const boss=i===SPHERE_MOB_SPAWNS.length-1;
  return {id:'dolgonog-'+i,index:i,x,z,spawnX:x,spawnZ:z,yaw:0,
   boss,name:boss?'Грозоклюв':'Равнинный долгоног',hp:boss?108:54,maxHp:boss?108:54,
   phase:'alive',life:1,aggroId:null,contributors:new Set(),lastHitAt:0,
   stunUntil:0,attackAt:0,attackCooldownAt:0,deathAt:0,corpseUntil:0,respawnAt:0,
   roaming:i*1.73,navigation:null,returning:false,
    roamState:'rest',roamUntil:0,roamGoalX:x,roamGoalZ:z};
 });
}
export function mobSnapshot(mobs){
 return mobs.map(m=>({id:m.id,index:m.index,x:m.x,z:m.z,yaw:m.yaw,
  boss:m.boss,hp:m.hp,maxHp:m.maxHp,phase:m.phase,life:m.life,
  aggro:!!m.aggroId,deathAt:m.deathAt,corpseUntil:m.corpseUntil,respawnAt:m.respawnAt,
  attackWindup:m.attackAt>0}));
}
export function sanitizeSphereEquipment(raw,level){
 const result={};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return result;
 for(const [slot,item] of Object.entries(raw)){
  const id=typeof item==='string'?item:item?.id;
  if(typeof id==='string'&&ITEM_CATALOG[id]?.slot===slot&&
   (ITEM_CATALOG[id].requiredLevel||1)<=level)result[slot]={id};
 }
 return result;
}
const playerStats=p=>deriveStats(p.level||1,p.equipment||{});
const notice=(id,reason)=>({targetId:id,event:{type:'combatRejected',reason}});
export function applySphereAttack(mobs,player,abilityId,mobId,now=Date.now(),rng=Math.random){
 const ability=getAbilityDefinition(abilityId);
 if(!ability||!['autoAttack','heavyStrike','thunderStomp'].includes(abilityId))
  return {ok:false,reason:'Неизвестная боевая способность',events:[]};
 if(player.hp<=0)return {ok:false,reason:'Персонаж мёртв',events:[]};
 const cooldown=player.abilityCooldowns??(player.abilityCooldowns={});
 if(now<(cooldown[abilityId]||0)||ability.gcd>0&&now<(cooldown.gcd||0))
  return {ok:false,reason:'Способность восстанавливается',events:[]};
 if((player.resource||0)<ability.resourceCost)
  return {ok:false,reason:'Недостаточно ярости',events:[]};
 const targets=abilityId==='thunderStomp'
  ?mobs.filter(m=>m.phase==='alive'&&localDistance(m,player,player.radius)<=STOMP_RANGE)
  :mobs.filter(m=>m.id===mobId&&m.phase==='alive');
 if(abilityId!=='thunderStomp'&&targets.length!==1)
  return {ok:false,reason:'Цель недоступна',events:[]};
 if(abilityId!=='thunderStomp'&&
  (localDistance(targets[0],player,player.radius)>MELEE_RANGE+.35||!facesMob(player,targets[0],player.radius)))
  return {ok:false,reason:'Цель слишком далеко или не перед вами',events:[]};
 player.resource=clamp((player.resource||0)-ability.resourceCost,0,100);
 cooldown[abilityId]=now+(abilityId==='autoAttack'?Math.max(800,playerStats(player).speed*1000):ability.cooldown*1000);
 if(ability.gcd>0)cooldown.gcd=now+ability.gcd*1000;
 const stats=playerStats(player),events=[],credits=[];
 for(const target of targets){
  const damage=abilityId==='thunderStomp'?6:
   Math.max(1,Math.round(stats.damageMin+clamp(rng(),0,1)*(stats.damageMax-stats.damageMin))+
    (abilityId==='heavyStrike'?ability.damageBonus||0:0));
  target.hp=Math.max(0,target.hp-damage);
  target.contributors.add(player.id);
  target.aggroId=player.id;target.returning=false;target.roamState='rest';
  target.navigation=null;
  target.lastHitAt=now;
  if(abilityId==='thunderStomp')target.stunUntil=Math.max(target.stunUntil,now+2500);
  player.resource=clamp(player.resource+(abilityId==='autoAttack'?12:abilityId==='heavyStrike'?8:3),0,100);
  events.push({type:'combat',mobId:target.id,life:target.life,abilityId,
   fromId:player.id,damage,hp:target.hp,maxHp:target.maxHp});
  if(target.hp===0){
   target.phase='corpse';target.deathAt=now;target.corpseUntil=now+SPHERE_CORPSE_MS;
   target.respawnAt=target.corpseUntil+SPHERE_RESPAWN_MS;
   target.aggroId=null;target.attackAt=0;target.attackCooldownAt=0;target.navigation=null;
   const recipients=[...target.contributors];
   for(const attackerId of recipients)credits.push({targetId:attackerId,
    event:{type:'killCredit',mobId:target.id,life:target.life,
     xp:target.boss?70:22,gold:target.boss?12:4,
     loot:rollCreatureLoot(target.boss?'stormbeak':'dolgonog',rng)}});
  }
 }
 return {ok:true,events,credits,resource:player.resource};
}
export function tickSphericalMobs(mobs,players,radius,dt,now=Date.now(),rng=Math.random){
 dt=clamp(dt,0,MAX_TICK);
 const events=[];
 const alive=[...players.values()].filter(p=>p.joined&&p.radius===radius&&p.hp>0);
 for(const mob of mobs){
  if(mob.phase==='corpse'&&now>=mob.corpseUntil){mob.phase='hidden';mob.aggroId=null;}
  if(mob.phase==='hidden'&&now>=mob.respawnAt){
   mob.phase='alive';mob.hp=mob.maxHp;mob.life++;
   mob.x=mob.spawnX;mob.z=mob.spawnZ;mob.yaw=0;mob.aggroId=null;
   mob.contributors.clear();mob.navigation=null;mob.attackAt=0;mob.attackCooldownAt=0;
   mob.stunUntil=0;mob.roaming=mob.index*1.73;
   mob.returning=false;mob.roamState='rest';mob.roamUntil=now+1500;
   mob.roamGoalX=mob.spawnX;mob.roamGoalZ=mob.spawnZ;
  }
  if(mob.phase!=='alive')continue;
  const spawnNormal=localToNormal(mob.spawnX,mob.spawnZ,radius);
  let target=mob.aggroId?players.get(mob.aggroId):null;
  if(target&&(!target.joined||target.hp<=0||target.radius!==radius||
    arcDistance(spawnNormal,target.normal,radius)>SPHERE_LEASH_METRES)){
   mob.aggroId=null;mob.attackAt=0;mob.navigation=null;
   mob.returning=true;target=null;
  }
  if(!target&&mob.aggroId){mob.aggroId=null;mob.attackAt=0;mob.returning=true;mob.navigation=null;}
  // An evading creature must actually finish its return before reacquiring aggro.
  if(!target&&!mob.returning){
   let closest=Infinity;
   for(const p of alive){
    const spawnDistance=arcDistance(spawnNormal,p.normal,radius),distance=localDistance(mob,p,radius);
    if(spawnDistance<SPHERE_LEASH_METRES&&distance<(mob.boss?9:7)&&distance<closest){
     closest=distance;target=p;
    }
   }
   if(target){mob.aggroId=target.id;mob.navigation=null;}
  }
  const aim=target?normalToLocal(target.normal,radius):null;
  mob.roaming+=dt;
  if(target){mob.returning=false;mob.roamState='rest';}
  else if(mob.returning){
   if(Math.hypot(mob.x-mob.spawnX,mob.z-mob.spawnZ)<.35){
    mob.returning=false;mob.hp=mob.maxHp;mob.contributors.clear();
    mob.navigation=null;mob.roamState='rest';
    mob.roamUntil=now+1500+Math.floor(clamp(rng(),0,1)*1500);
   }
  }else if(mob.roamState==='walking'){
   if(Math.hypot(mob.x-mob.roamGoalX,mob.z-mob.roamGoalZ)<.28){
    mob.roamState='rest';mob.roamUntil=now+1400+Math.floor(clamp(rng(),0,1)*2200);
    mob.navigation=null;
   }
  }else if(now>=mob.roamUntil){chooseRoamGoal(mob,now,rng);}
  const walking=mob.roamState==='walking';
  const gx=target?aim?.x:mob.returning?mob.spawnX:walking?mob.roamGoalX:mob.x;
  const gz=target?aim?.z:mob.returning?mob.spawnZ:walking?mob.roamGoalZ:mob.z;
  if(!finite(gx)||!finite(gz))continue;
  const distance=target?localDistance(mob,target,radius):Math.hypot(gx-mob.x,gz-mob.z);
  const beforeX=mob.x,beforeZ=mob.z;
  const cannotMove=now<mob.stunUntil||now<mob.attackAt;
  if(!cannotMove&&distance>(target?(mob.boss?3:2.35):.28)){
   moveMobToward(mob,{goalX:gx,goalZ:gz,dt,
    speed:target?(mob.boss?1.75:2.05):mob.returning?1.65:.95,
    mode:target?'chase':mob.returning?'return':'roam',
    canWalk:(x,z)=>walkable(x,z,mob.boss?.94:.52),detour:!!target||mob.returning});
  }
  const travelled=Math.hypot(mob.x-beforeX,mob.z-beforeZ);
  const dx=target&&distance<3.5?gx-mob.x:travelled>.001?mob.x-beforeX:mob.returning?gx-mob.x:0;
  const dz=target&&distance<3.5?gz-mob.z:travelled>.001?mob.z-beforeZ:mob.returning?gz-mob.z:0;
  const desired=sphericalMobYaw(mob.x,mob.z,dx,dz,radius);
  if(desired!==null){
   const delta=Math.atan2(Math.sin(desired-mob.yaw),Math.cos(desired-mob.yaw));
   mob.yaw+=clamp(delta,-dt*(target?9:5),dt*(target?9:5));
  }
  if(!target){mob.attackAt=0;continue;}
  const close=distance<(mob.boss?3:2.6)&&
   mobSegmentClear(mob.x,mob.z,gx,gz,(x,z)=>walkable(x,z,.12));
  if(now<mob.stunUntil||!close){mob.attackAt=0;continue;}
  if(mob.attackAt===0&&now>=mob.attackCooldownAt){
   mob.attackAt=now+(mob.boss?450:400);
   events.push({type:'mobTelegraph',mobId:mob.id,life:mob.life,targetId:target.id,windupMs:mob.boss?450:400});
  }else if(mob.attackAt>0&&now>=mob.attackAt){
   // Do not deal invisible rear-facing hits while a mob completes its turn.
   const facing=sphericalMobYaw(mob.x,mob.z,gx-mob.x,gz-mob.z,radius);
   const error=facing===null?Math.PI:Math.abs(Math.atan2(Math.sin(facing-mob.yaw),Math.cos(facing-mob.yaw)));
   if(error>.32){mob.attackAt=now+100;continue;}
   const stats=playerStats(target);
   const block=stats.blockChance>0&&rng()<stats.blockChance;
   const reduction=armorReduction(stats.armor,mob.boss?5:1);
   const raw=mob.boss?14:9,absorbed=block?Math.max(0,stats.blockValue):0;
   const damage=Math.max(0,Math.round((raw-absorbed)*(1-reduction)));
   target.hp=Math.max(0,target.hp-damage);
   target.lastMobAttackAt=now;
   target.resource=clamp((target.resource||0)+5,0,100);
   mob.attackAt=0;mob.attackCooldownAt=now+(mob.boss?1800:2100);
   events.push({type:'mobAttack',mobId:mob.id,targetId:target.id,
    damage,blocked:block,absorbed,hp:target.hp,maxHp:target.maxHp});
   if(target.hp<=0){
    target.hp=target.maxHp;target.resource=0;target.normal=localToNormal(0,0,radius);
    target.heading=0;target.updatedAt=now;target.respawnShieldUntil=now+3000;
    for(const other of mobs)if(other.aggroId===target.id){
     other.aggroId=null;other.attackAt=0;other.navigation=null;
    }
    events.push({type:'respawnAccepted',targetId:target.id,
     normal:target.normal,heading:target.heading,hp:target.hp,maxHp:target.maxHp});
   }
  }
 }
 return events;
}
