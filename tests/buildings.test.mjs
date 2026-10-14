import test from 'node:test';
import assert from 'node:assert/strict';
import {localToWorld2D,worldToLocal2D,isInsideRect,circleHitsRect,buildingWallColliders} from '../building-physics.js';
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('local/world transforms invert for all common house rotations',()=>{
 for(const yaw of [0,0.5,-0.6,Math.PI/2,Math.PI]){
  const p=localToWorld2D(2.5,-3,-12,-5,yaw);
  const q=worldToLocal2D(p.x,p.z,-12,-5,yaw);
  approx(q.x,2.5);approx(q.z,-3);
 }
});
test('front doorway stays walkable, walls block at every rotation',()=>{
 for(const rotation of [0,.5,1.1,-.7]){
  const p={x:-12,z:-5,width:9.6,depth:10.4,wallThickness:.34,doorWidth:3.4,rotation};
  const walls=buildingWallColliders(p);
  const collides=(lx,lz,r=.58)=>{
   const point=localToWorld2D(lx,lz,p.x,p.z,rotation);
   return walls.some(w=>circleHitsRect(point.x,point.z,r,w));
  };
  assert.equal(walls.length,5);
  assert.equal(collides(0,0),false,'room must be open');
  assert.equal(collides(0,p.depth/2),false,'door must be open');
  assert.equal(collides(0,p.depth/2+2),false,'outside door must be open');
  assert.equal(collides(-p.width/2,0),true,'left wall');
  assert.equal(collides(p.width/2,0),true,'right wall');
  assert.equal(collides(0,-p.depth/2),true,'rear wall');
  assert.equal(collides(p.width/2-1,p.depth/2),true,'front wall');
  assert.equal(collides(1.1,p.depth/2),false,'tauren must fit beside door centre');
  assert.equal(collides(1.5,p.depth/2),true,'tauren should graze door jamb');
 }
});
test('rect corner collision uses true radial clearance, not square padding',()=>{
 const r={x:0,z:0,w:2,d:2,yaw:0};
 assert.equal(circleHitsRect(1.6,1.6,.58,r),false);
 assert.equal(circleHitsRect(1.35,1.35,.58,r),true);
});
test('interior detection works on rotated houses',()=>{
 const room={x:-12,z:-5,w:8.5,d:9.3,yaw:.5};
 const inside=localToWorld2D(3,2,-12,-5,.5);
 const outside=localToWorld2D(7,0,-12,-5,.5);
 assert.equal(isInsideRect(inside.x,inside.z,room),true);
 assert.equal(isInsideRect(outside.x,outside.z,room),false);
});
test('invalid geometry rejects overlapping/closed entrance',()=>{
 assert.throws(()=>buildingWallColliders({x:0,z:0,width:3,depth:8,doorWidth:3,wallThickness:.35}),RangeError);
});

test('large house keeps full-size entrance and safe furniture collision',()=>{
 const x=-27,z=-2,scale=2,yaw=Math.PI/2;
 const wallParts=buildingWallColliders({
  x,z,width:9.6*scale,depth:10.4*scale,doorWidth:3.4*scale,wallThickness:.34*scale,rotation:yaw,height:4.55*scale
 });
 const hits=(lx,lz)=>{
  const p=localToWorld2D(lx,lz,x,z,yaw);
  return wallParts.some(rect=>circleHitsRect(p.x,p.z,.58,rect));
 };
 assert.equal(hits(0,0),false,'central floor remains open');
 assert.equal(hits(0,10.4),false,'double-width door is enterable');
 assert.equal(hits(0,12),false,'approach to house is unobstructed');
 assert.equal(hits(0,-10.4),true,'rear wall remains solid');
 assert.equal(hits(9.6,0),true,'side wall remains solid');
 assert.equal(hits(3.3,10.4),true,'door jamb remains solid');
 assert.equal(hits(1.2,10.4),false,'comfortable player clearance inside doorway');
 const bed=localToWorld2D(-2.6*scale,-2.5*scale,x,z,yaw);
 assert.equal(circleHitsRect(bed.x,bed.z,.58,{...bed,w:2.35*scale,d:2.55*scale,yaw}),true);
});
