// PT 0.6: original NexGame warrior poses, evaluated in the character's
// local radial-up frame. Equipment grip tuners remain the source of truth.
import {weaponSwingProfile,daggerThrustPose} from '../weapon-visuals.js?v=0.3.7.1';
import {shieldBlockPose} from '../shield-block.js?v=0.3.7.1';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const ease=(a,b,t)=>{const x=clamp((t-a)/(b-a),0,1);return x*x*(3-2*x)};
const smooth=x=>x*x*(3-2*x);
export function animateSphericalTauren(actor,{
 dt=1/60,time=0,walk=0,phase=0,gather=false,
 attack=-1,stomp=0,blockRemaining=0,weaponKind='none'
}={}){
 const speed=clamp(walk,0,1),seconds=clamp(dt,0,.1),user=actor.root.userData;
 user.gatherBlend=clamp((user.gatherBlend||0)+((gather?1:0)-(user.gatherBlend||0))*(1-Math.exp(-seconds*13)),0,1);
 user.walkBlend=clamp((user.walkBlend||0)+(speed-(user.walkBlend||0))*(1-Math.exp(-seconds*10)),0,1);
 const w=user.walkBlend,bend=smooth(user.gatherBlend),stride=Math.sin(phase),beat=Math.cos(phase*2);
 const breath=Math.sin(time*1.7),profile=weaponSwingProfile(weaponKind);
 // Native weapon-specific phases. Progress 0..1 runs for precisely 0.8 s;
 // physical damage is triggered separately at progress 0.425.
 const playing=attack>=0&&attack<=1;
 const stabbing=playing&&weaponKind==='dagger'?daggerThrustPose(attack):null;
 const windup=playing&&!stabbing?ease(0,.32,attack)*(1-ease(.38,.65,attack)):0;
 const swing=playing&&!stabbing?ease(.32,.58,attack)*(1-ease(.64,1,attack)):0;
 const block=shieldBlockPose(blockRemaining);
 actor.body.position.set(stride*.035*w,1.4+.008*breath+.026*(1-beat)*w-.47*bend,0);
 actor.chest.rotation.set(.035*w+.20*bend+block.chestX,
  Math.sin(phase)*.065*w+block.chestY,-stride*.025*w);
 actor.chest.scale.y=1+breath*.005;
 actor.neck.rotation.set(-.018*breath+.10*bend,-actor.chest.rotation.y*.65,stride*.015*w);
 if(stabbing){
  actor.chest.rotation.y+=.06*stabbing.draw-.07*stabbing.extend;
  actor.chest.rotation.x+=.10*stabbing.extend;
  actor.body.position.z=.16*stabbing.extend;
 }else{
  actor.chest.rotation.y+=-profile.torsoWindup*windup+profile.torsoSwing*swing;
  actor.chest.rotation.x+=.12*swing;
  actor.body.position.z=0;
 }
 const stompPower=clamp(stomp,0,1);
 actor.body.position.y-=.14*Math.sin((1-stompPower)*Math.PI);
 // Two-segment IK for each leg. Heel remains aligned to local radial-up ground.
 for(let i=0;i<2;i++){
  const leg=actor.legs[i],p=((phase/(Math.PI*2)+i*.5)%1+1)%1;
  let z=0,lift=0;
  if(p<.58)z=.775-1.55*p/.58;
  else{const t=(p-.58)/.42;z=-.775+1.55*smooth(t);lift=Math.sin(t*Math.PI)*.22}
  z*=w;lift*=w*(1-bend);
  if(stompPower>0&&i===1)lift+=.32*stompPower;
  const y=.205+lift-actor.body.position.y,
   distance=clamp(Math.hypot(y,z),.15,1.397),
   knee=Math.acos(clamp((distance*distance-.72*.72-.68*.68)/(2*.72*.68),-1,1));
  leg.hip.position.y=actor.body.position.y;
  leg.hip.rotation.x=Math.atan2(-z,-y)-Math.atan2(.68*Math.sin(knee),.72+.68*Math.cos(knee));
  leg.knee.rotation.x=knee;
  leg.foot.rotation.x=-leg.hip.rotation.x-knee;
 }
 for(let i=0;i<2;i++){
  const arm=actor.arms[i],sign=i?1:-1;
  arm.shoulder.rotation.x=sign*stride*.31*w-(i?profile.shoulderWindup*windup-profile.shoulderSwing*swing:0);
  arm.shoulder.rotation.z=-sign*(.12+.025*breath)+(i?profile.shoulderSlash*swing:0);
  arm.elbow.rotation.x=-.14-Math.abs(stride)*.11*w-(i?profile.elbowWindup*windup:0);
  arm.shoulder.rotation.x-=bend*(i?.95:1.12);
  arm.elbow.rotation.x-=.45*bend;
  if(stompPower>0)arm.shoulder.rotation.z+=sign*.17*Math.sin(stompPower*Math.PI);
  if(i===0){
   arm.shoulder.rotation.x+=block.shoulderX;
   arm.shoulder.rotation.z+=block.shoulderZ;
   arm.elbow.rotation.x+=block.elbowX;
  }else if(stabbing){
   arm.shoulder.rotation.x+=.24*stabbing.draw-1.16*stabbing.extend;
   arm.shoulder.rotation.z-=.07*stabbing.extend;
   arm.elbow.rotation.x+=-.72*stabbing.draw+.11*stabbing.extend;
  }
  // Dynamically rotate the *wrist joint*, not the GLB model: unchanged approved
  // sword/axe/dagger/shield tuning angles remain in userData.equipmentGrip.
  const grip=user.equipmentGrip?.[i===0?'shield':'weapon'];
  if(arm.hand&&grip){
   const wrist=i===0?block.wristX:
     stabbing?.12*stabbing.draw-.08*stabbing.extend:
     -profile.wristWindup*windup+profile.wristSwing*swing;
   arm.hand.rotation.set(grip.x+wrist,grip.y,grip.z,grip.order||'XYZ');
  }
 }
 if(actor.tail)actor.tail.rotation.x=.06+Math.sin(time*2)*.06+w*.08;
 if(actor.braids)actor.braids.forEach((b,i)=>{
  b.rotation.x=.035*Math.sin(time*2+i)+.07*stride*w;
 });
 return {crouch:bend,block:block.power,attack:playing?swing:0,dagger:stabbing?.extend||0};
}
