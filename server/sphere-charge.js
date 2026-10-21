// Server-authoritative warrior charge: validates movement and bonus award.
// Only this handler can relocate a player beyond standard walking speed.
import {getAbilityDefinition} from '../skills.js';
import {arcDistance,localDistance,localToNormal,normalToLocal,sphereCombatLineClear,applySphereAttack} from './spherical-pve.js';
import {resolveSphereWalk,sphericalArcPoint} from './world-movement.js';

export const CHARGE_DURATION_MS=550;
const END_RANGE=2.85;
const MAX_LANDING_TRACK_METRES=6;
function headingTowards(from,to){
 const lon=Math.atan2(from[0],from[2]),east=[Math.cos(lon),0,-Math.sin(lon)];
 const north=[from[1]*east[2]-from[2]*east[1],from[2]*east[0]-from[0]*east[2],from[0]*east[1]-from[1]*east[0]];
 const dot=from.reduce((sum,n,i)=>sum+n*to[i],0),tangent=to.map((n,i)=>n-dot*from[i]);
 if(Math.hypot(...tangent)<1e-9)return null;
 return Math.atan2(tangent.reduce((sum,n,i)=>sum+n*north[i],0),
  tangent.reduce((sum,n,i)=>sum+n*east[i],0));
}
export function applySphereCharge(mobs,player,mobId,now=Date.now()){
 const def=getAbilityDefinition('charge');
 if((player.level||1)<def.level)return {ok:false,reason:'Необходим 8 уровень'};
 if(player.hp<=0||player.respawnShieldUntil>now)return {ok:false,reason:'Персонаж не может атаковать'};
 const cd=player.abilityCooldowns??(player.abilityCooldowns={});
 if(now<(cd.charge||0)||now<(cd.gcd||0)||now<(player.chargeUntil||0))
  return {ok:false,reason:'Способность восстанавливается'};
 const mob=mobs.find(m=>m.id===mobId&&m.phase==='alive'&&!m.returning&&m.hp>0);
 if(!mob)return {ok:false,reason:'Цель недоступна'};
 const distance=localDistance(mob,player,player.radius);
 if(!Number.isFinite(distance)||distance>def.range+1e-6)
  return {ok:false,reason:'Цель слишком далеко'};
 const from=normalToLocal(player.normal,player.radius);
 if(!from||!sphereCombatLineClear(from.x,from.z,mob.x,mob.z))
  return {ok:false,reason:'Цель за препятствием'};
 const to=localToNormal(mob.x,mob.z,player.radius);
 const travel=Math.max(0,distance-END_RANGE);
 const destination=travel>0?sphericalArcPoint(player.normal,to,travel/distance,player.radius):[...player.normal];
 if(!destination)return {ok:false,reason:'Нет безопасного пути к цели'};
 const sweep=resolveSphereWalk(player.normal,destination,player.radius);
 if(sweep.blocked||arcDistance(sweep.normal,destination,player.radius)>.01)
  return {ok:false,reason:'Путь к цели перекрыт'};
 const endpoint=normalToLocal(destination,player.radius);
 if(!endpoint||!sphereCombatLineClear(endpoint.x,endpoint.z,mob.x,mob.z))
  return {ok:false,reason:'Путь к цели перекрыт'};
 const heading=headingTowards(destination,to);
 player.normal=destination;
 player.x=endpoint.x;player.z=endpoint.z;
 if(Number.isFinite(heading))player.heading=heading;
 player.chargeUntil=now+CHARGE_DURATION_MS;
 // The server owns exactly one landing blow for the target's current life.
 player.chargeImpact={mobId:mob.id,life:mob.life,landAt:player.chargeUntil};
 player.chargeBonus={mobId:mob.id,life:mob.life,expiresAt:now+6000};
 cd.charge=now+def.cooldown*1000;
 cd.gcd=Math.max(cd.gcd||0,now+def.gcd*1000);
 return {ok:true,durationMs:CHARGE_DURATION_MS,normal:[...destination],heading:player.heading};
}

/**
 * Resolve a single confirmed charge impact at landing, without waiting for
 * mobile Safari animation frames or a second attack packet.
 * A valid, alive target may drift during the dash. Only a short, clear
 * server-validated closing step is allowed; no teleporting through walls.
 */
export function completeSphereCharge(mobs,player,now=Date.now(),rng=Math.random){
 const pending=player?.chargeImpact;
 if(!pending||now<pending.landAt)return {ok:false,pending:!!pending,events:[],credits:[]};
 player.chargeImpact=null;
 if(!player.joined||player.hp<=0||player.respawnShieldUntil>now||
   player.chargeUntil>now)return {ok:false,reason:'Персонаж недоступен',events:[],credits:[]};
 const mob=mobs.find(m=>m.id===pending.mobId&&m.life===pending.life&&
  m.phase==='alive'&&m.hp>0&&!m.returning);
 if(!mob)return {ok:false,reason:'Цель больше недоступна',events:[],credits:[]};
 const radius=player.radius,location=normalToLocal(player.normal,radius);
 const distance=localDistance(mob,player,radius);
 if(!Number.isFinite(distance)||distance>MAX_LANDING_TRACK_METRES||
   !location||!sphereCombatLineClear(location.x,location.z,mob.x,mob.z))
  return {ok:false,reason:'Цель ушла с траектории рывка',events:[],credits:[]};
 if(distance>END_RANGE){
  const target=localToNormal(mob.x,mob.z,radius);
  const landing=sphericalArcPoint(player.normal,target,(distance-END_RANGE)/distance,radius);
  if(!landing)return {ok:false,reason:'Нет безопасного пути',events:[],credits:[]};
  const swept=resolveSphereWalk(player.normal,landing,radius);
  if(swept.blocked||arcDistance(swept.normal,landing,radius)>.01)
   return {ok:false,reason:'Путь к цели перекрыт',events:[],credits:[]};
  const endpoint=normalToLocal(landing,radius);
  if(!endpoint||!sphereCombatLineClear(endpoint.x,endpoint.z,mob.x,mob.z))
   return {ok:false,reason:'Цель за препятствием',events:[],credits:[]};
  player.normal=landing;player.x=endpoint.x;player.z=endpoint.z;
 }
 const aimed=headingTowards(player.normal,localToNormal(mob.x,mob.z,radius));
 if(aimed!==null)player.heading=aimed;
 const strike=applySphereAttack(mobs,player,'autoAttack',mob.id,now,rng,{chargeImpact:true});
 if(!strike.ok)return strike;
 for(const event of strike.events)event.chargeImpact=true;
 return {...strike,normal:[...player.normal],heading:player.heading};
}
