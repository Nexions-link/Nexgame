// Server movement collision uses the exact same world geometry as the browser.
// Sweep the entire great-circle segment to prevent tunneling through wall meshes.
import {canWalkCamp} from '../planet-test/sphere-physics.js';
import {canWadeAtLocal} from '../planet-test/start-zone.js';
import {arcDistance,normalToLocal} from './spherical-pve.js';

export function walkableSphereNormal(normal,radius,actorRadius=.42){
 const p=normalToLocal(normal,radius);
 return !!p&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&
  canWalkCamp(p.x,p.z,actorRadius,radius)&&(p.d>=82||canWadeAtLocal(p.x,p.z));
}
export function sphericalArcPoint(from,to,t,radius){
 const distance=arcDistance(from,to,radius);
 if(!Number.isFinite(distance))return null;
 if(distance<1e-6)return [...from];
 const angle=distance/radius,sine=Math.sin(angle);
 if(Math.abs(sine)<1e-8)return null;
 const raw=from.map((n,i)=>n*Math.sin((1-t)*angle)/sine+
  to[i]*Math.sin(t*angle)/sine);
 const len=Math.hypot(...raw);
 return len>1e-8?raw.map(n=>n/len):null;
}
export function resolveSphereWalk(from,to,radius,actorRadius=.42){
 const distance=arcDistance(from,to,radius);
 if(!Number.isFinite(distance)||distance>=Math.PI*radius-1e-5)
  return {normal:[...from],blocked:true};
 if(distance<1e-6)return {normal:[...from],blocked:false};
 const steps=Math.max(1,Math.ceil(distance/.35));
 let accepted=[...from];
 for(let i=1;i<=steps;i++){
  const proposed=sphericalArcPoint(from,to,i/steps,radius);
  if(!proposed||!walkableSphereNormal(proposed,radius,actorRadius))
   return {normal:accepted,blocked:true};
  accepted=proposed;
 }
 return {normal:accepted,blocked:false};
}
