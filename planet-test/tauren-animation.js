// PT 0.3.0: spherical Tauren animation using the main NexGame's 0.47 m
// gather crouch, .20 torso bend, arm reach and two-segment .72/.68 m leg IK.
// All transforms are local to the character's radial-up frame.
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(x)=>x*x*(3-2*x);
export function animateSphericalTauren(actor,{dt=1/60,time=0,walk=0,phase=0,gather=false,attack=0,stomp=0}={}){
 const speed=clamp(walk,0,1),seconds=clamp(dt,0,.1),user=actor.root.userData;
 user.gatherBlend=clamp((user.gatherBlend||0)+((gather?1:0)-(user.gatherBlend||0))*(1-Math.exp(-seconds*13)),0,1);
 const bend=smooth(user.gatherBlend),stride=Math.sin(phase),beat=Math.cos(phase*2);
 const breath=Math.sin(time*1.7);
 // Exact body drop and upper body bend from NexGame animateTauren().
 actor.body.position.set(stride*.035*speed,1.4+.008*breath+.026*(1-beat)*speed-.47*bend,0);
 actor.chest.rotation.set(.035*speed+.20*bend,Math.sin(phase)*.065*speed,-stride*.025*speed);
 actor.chest.scale.y=1+breath*.005;
 actor.neck.rotation.set(-.018*breath+.10*bend,-actor.chest.rotation.y*.65,stride*.015*speed);
 // Real upper- and lower-leg joints, not a visual squash of the whole character.
 // Keep both hooves grounded while the hip sinks into the gather pose.
 for(let i=0;i<2;i++){
  const leg=actor.legs[i];
  const p=((phase/(Math.PI*2)+i*.5)%1+1)%1;
  let z=0,lift=0;
  if(p<.58)z=.775-1.55*p/.58;
  else{const t=(p-.58)/.42;z=-.775+1.55*smooth(t);lift=Math.sin(t*Math.PI)*.22}
  z*=speed;lift*=speed*(1-bend);
  if(stomp>0&&i===1)lift+=.32*stomp;
  const hipY=actor.body.position.y;
  const y=.205+lift-hipY;
  const distance=clamp(Math.hypot(y,z),.15,1.397);
  const knee=Math.acos(clamp((distance*distance-.72*.72-.68*.68)/(2*.72*.68),-1,1));
  leg.hip.position.y=hipY;
  leg.hip.rotation.x=Math.atan2(-z,-y)-Math.atan2(.68*Math.sin(knee),.72+.68*Math.cos(knee));
  leg.knee.rotation.x=knee;
  leg.foot.rotation.x=-leg.hip.rotation.x-knee;
 }
 for(let i=0;i<2;i++){
  const arm=actor.arms[i],sign=i?1:-1;
  arm.shoulder.rotation.x=sign*stride*.31*speed-bend*(i?.95:1.12);
  arm.shoulder.rotation.z=-sign*(.12+.025*breath);
  arm.elbow.rotation.x=-.14-Math.abs(stride)*.11*speed-.45*bend;
 }
 const strike=clamp(attack,0,1),stompPose=clamp(stomp,0,1);
 if(strike>0){
  const windup=smooth(clamp((1-strike)*2.2,0,1)),swing=Math.sin((1-strike)*Math.PI);
  actor.chest.rotation.y+=-.22*(1-windup)+.38*swing;
  actor.chest.rotation.x+=.12*swing;
  actor.arms[1].shoulder.rotation.x-=.8*swing-.24*(1-windup);
  actor.arms[1].elbow.rotation.x-=.28*(1-windup);
 }
 if(stompPose>0){
  actor.body.position.y-=.14*Math.sin((1-stompPose)*Math.PI);
  actor.arms[0].shoulder.rotation.z-=.24*stompPose;
  actor.arms[1].shoulder.rotation.z+=.24*stompPose;
 }
 if(actor.tail)actor.tail.rotation.x=.06+Math.sin(time*2)*.06+speed*.08;
 if(actor.braids)actor.braids.forEach((b,i)=>{
  b.rotation.x=.035*Math.sin(time*2+i)+.07*stride*speed;
 });
 return bend;
}
