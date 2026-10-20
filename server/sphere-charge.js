// Server-authoritative warrior charge: validates movement and bonus award.
// Only this handler can relocate a player beyond standard walking speed.
import {getAbilityDefinition} from '../skills.js';
import {arcDistance,localDistance,localToNormal,normalToLocal,sphereCombatLineClear} from './spherical-pve.js';
import {resolveSphereWalk,sphericalArcPoint} from './world-movement.js';

export const CHARGE_DURATION_MS=550;
const END_RANGE=2.85;
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
 const lon=Math.atan2(destination[0],destination[2]);
 const east=[Math.cos(lon),0,-Math.sin(lon)];
 const north=[destination[1]*east[2]-destination[2]*east[1],
              destination[2]*east[0]-destination[0]*east[2],
              destination[0]*east[1]-destination[1]*east[0]];
 const dot=destination.reduce((sum,n,i)=>sum+n*to[i],0);
 const tangent=to.map((n,i)=>n-dot*destination[i]);
 const heading=Math.atan2(tangent.reduce((sum,n,i)=>sum+n*north[i],0),
                           tangent.reduce((sum,n,i)=>sum+n*east[i],0));
 player.normal=destination;
 player.x=endpoint.x;player.z=endpoint.z;
 if(Number.isFinite(heading))player.heading=heading;
 player.chargeUntil=now+CHARGE_DURATION_MS;
 player.chargeBonus={mobId:mob.id,life:mob.life,expiresAt:now+6000};
 cd.charge=now+def.cooldown*1000;
 cd.gcd=Math.max(cd.gcd||0,now+def.gcd*1000);
 return {ok:true,durationMs:CHARGE_DURATION_MS,normal:[...destination],heading:player.heading};
}
