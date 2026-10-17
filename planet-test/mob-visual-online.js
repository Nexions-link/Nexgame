// Presentation only: the authoritative x/z/yaw always come from server snapshots.
// Never write smoothed values back to mob.x, mob.z or mob.yaw (combat/selection).
export function advanceOnlineMobVisual(mob,dt,{rate=11,snapDistance=6}={}){
 if(!mob||![mob.x,mob.z,mob.yaw].every(Number.isFinite))return 0;
 if(!Number.isFinite(mob.renderX)||!Number.isFinite(mob.renderZ)||!Number.isFinite(mob.renderYaw)){
  mob.renderX=mob.x;mob.renderZ=mob.z;mob.renderYaw=mob.yaw;return 0;
 }
 const oldX=mob.renderX,oldZ=mob.renderZ;
 const distance=Math.hypot(mob.x-oldX,mob.z-oldZ);
 // Teleports, server corrections and respawns must not slide across the world.
 if(distance>snapDistance){
  mob.renderX=mob.x;mob.renderZ=mob.z;mob.renderYaw=mob.yaw;return 0;
 }
 const alpha=1-Math.exp(-Math.max(0,Math.min(.1,dt))*rate);
 mob.renderX+=alpha*(mob.x-mob.renderX);
 mob.renderZ+=alpha*(mob.z-mob.renderZ);
 const diff=Math.atan2(Math.sin(mob.yaw-mob.renderYaw),Math.cos(mob.yaw-mob.renderYaw));
 mob.renderYaw+=alpha*diff;
 return Math.hypot(mob.renderX-oldX,mob.renderZ-oldZ);
}
