// NexGame Alpha 0.3.5.22: authoritative idle wildlife movement.
// No combat, health, loot or target ownership in this milestone.
export const MULGORE_MOB_SPAWNS=Object.freeze([
 [-9,-23],[1,-28],[13,-22],[21,-33],[-22,-35],[-28,29],[15,36],[34,13],
 // Boss spawn: must match BOSS_X / BOSS_Z in game.js.
 [39,47]
]);
export const MOB_SPEED=.42;
export const MOB_TICK_LIMIT=.25;

export function createMulgoreMobs(){
 return MULGORE_MOB_SPAWNS.map(([x,z],index)=>({
  id:index,x,z,yaw:0,spawnX:x,spawnZ:z,roamTime:0,
  boss:index===MULGORE_MOB_SPAWNS.length-1
 }));
}
export function tickMulgoreMobs(mobs,dt){
 if(!Number.isFinite(dt)||dt<=0)return;
 dt=Math.min(dt,MOB_TICK_LIMIT);
 for(const mob of mobs){
  mob.roamTime+=dt;
  const tx=mob.spawnX+Math.sin(mob.roamTime*.18+mob.id)*2.2;
  const tz=mob.spawnZ+Math.cos(mob.roamTime*.14+mob.id)*2.2;
  const dx=tx-mob.x,dz=tz-mob.z,d=Math.hypot(dx,dz);
  if(d<=.25)continue;
  const step=Math.min(d,MOB_SPEED*dt);
  mob.x+=dx/d*step;
  mob.z+=dz/d*step;
  const desiredYaw=Math.atan2(dx,dz);
  mob.yaw+=Math.atan2(Math.sin(desiredYaw-mob.yaw),Math.cos(desiredYaw-mob.yaw))
   *(1-Math.exp(-6*dt));
 }
}
export function snapshotMulgoreMobs(mobs){
 return mobs.map(mob=>({id:mob.id,x:mob.x,z:mob.z,yaw:mob.yaw}));
}
