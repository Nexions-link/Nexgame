// Pure camera-relative left-stick controls. Independent of browser and Three.js.
export const STICK_DEADZONE=.12;
export function screenMoveVector(x,y,cameraYaw,deadzone=STICK_DEADZONE){
 const length=Math.hypot(x,y);
 if(!Number.isFinite(length)||!Number.isFinite(cameraYaw)||length<=deadzone)return {x:0,z:0,strength:0,heading:null};
 const strength=Math.min(1,(Math.min(length,1)-deadzone)/(1-deadzone));
 const right=x/length,forward=-y/length;
 const dx=Math.cos(cameraYaw)*right-Math.sin(cameraYaw)*forward;
 const dz=-Math.sin(cameraYaw)*right-Math.cos(cameraYaw)*forward;
 return {x:dx,z:dz,strength,heading:Math.atan2(dx,dz)};
}
export function turnTowardsAngle(current,target,dt,rate=12){
 if(!Number.isFinite(target)||dt<=0)return current;
 const diff=Math.atan2(Math.sin(target-current),Math.cos(target-current));
 return current+diff*(1-Math.exp(-rate*dt));
}
