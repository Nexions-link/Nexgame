import test from 'node:test';
import assert from 'node:assert/strict';
import {screenMoveVector,turnTowardsAngle,followCameraYaw} from '../movement-controls.js';
const near=(value,expected)=>assert.ok(Math.abs(value-expected)<1e-7,`${value} != ${expected}`);
test('free 360 stick moves in screen direction regardless of camera orbit',()=>{
 for(const yaw of [0,.5,Math.PI/2,Math.PI,-1.8]){
  const up=screenMoveVector(0,-1,yaw),right=screenMoveVector(1,0,yaw);
  near(up.x,-Math.sin(yaw));near(up.z,-Math.cos(yaw));
  near(right.x,Math.cos(yaw));near(right.z,-Math.sin(yaw));
  near(up.x*right.x+up.z*right.z,0);
  near(up.strength,1);near(right.strength,1);
  near(Math.hypot(up.x,up.z),1);
 }
});
test('full diagonals are normalized and character faces motion',()=>{
 const p=screenMoveVector(1,-1,Math.PI/3);
 near(Math.hypot(p.x,p.z),1);near(p.strength,1);
 near(Math.sin(p.heading),p.x);near(Math.cos(p.heading),p.z);
});
test('released and tiny joystick input do not drift or cause heading updates',()=>{
 for(const [x,y] of [[0,0],[.04,.05],[.1,-.05]]){
  const v=screenMoveVector(x,y,0);
  assert.deepEqual(v,{x:0,z:0,strength:0,heading:null});
 }
 assert.equal(turnTowardsAngle(1,null,.016),1);
});
test('movement strength scales outside deadzone and never exceeds unity',()=>{
 const a=screenMoveVector(0,-.56,.2);
 assert.ok(a.strength>.4&&a.strength<.6);
 near(screenMoveVector(0,-5,0).strength,1);
});
test('hero rotates shortest arc across +/- pi without overshoot',()=>{
 const start=Math.PI-.1,end=-Math.PI+.1;
 const next=turnTowardsAngle(start,end,.05);
 assert.ok(next>start);assert.ok(next<start+.2);
 const late=turnTowardsAngle(start,end,1);
 assert.ok(late>next);assert.ok(late<start+.21);
});

test('follow mode holds the camera orbit while any active stick direction is pressed',()=>{
 for(const yaw of [-2.2,0,.8,Math.PI]){
  for(const [x,y] of [[0,1],[0,-1],[1,0],[-1,0],[.8,.7]]){
   const active=screenMoveVector(x,y,yaw).strength>0;
   assert.equal(active,true);
   near(followCameraYaw(yaw,yaw+1,.016,{enabled:true,manual:active}),yaw);
  }
 }
});
test('holding stick DOWN for many frames cannot cause hero and camera to spin',()=>{
 let camYaw=0,heroYaw=Math.PI;
 let movedZ=0,totalTurn=0;
 for(let i=0;i<240;i++){
  const vector=screenMoveVector(0,1,camYaw);
  const nextHero=turnTowardsAngle(heroYaw,vector.heading,1/60);
  totalTurn+=Math.abs(Math.atan2(Math.sin(nextHero-heroYaw),Math.cos(nextHero-heroYaw)));
  heroYaw=nextHero;movedZ+=vector.z/60;
  camYaw=followCameraYaw(camYaw,heroYaw,1/60,{enabled:true,manual:vector.strength>0});
 }
 near(camYaw,0);
 assert.ok(totalTurn<=Math.PI+.001,`Unexpected continuous turning: ${totalTurn}`);
 assert.ok(Math.abs(Math.atan2(Math.sin(heroYaw),Math.cos(heroYaw)))<.01);
 assert.ok(movedZ>3.9);
});
test('after releasing stick auto-follow catches up smoothly via the shortest arc',()=>{
 const start=0;
 const first=followCameraYaw(start,0,.016,{enabled:true,manual:false});
 assert.ok(Math.abs(first)>0&&Math.abs(first)<Math.PI/2);
 let cam=first;
 for(let i=0;i<180;i++)cam=followCameraYaw(cam,0,1/60,{enabled:true});
 assert.ok(Math.abs(Math.abs(cam)-Math.PI)<.002);
});
test('free camera, touch orbit and touch cooldown keep their previous behavior',()=>{
 const yaw=.8,hero=-2.2,dt=.2;
 near(followCameraYaw(yaw,hero,dt,{enabled:false}),yaw);
 near(followCameraYaw(yaw,hero,dt,{enabled:true,orbiting:true}),yaw);
 near(followCameraYaw(yaw,hero,dt,{enabled:true,cooldown:.5}),yaw);
 near(followCameraYaw(yaw,hero,0,{enabled:true}),yaw);
});
test('stick dead zone does not unnecessarily suppress follow recovery',()=>{
 const tiny=screenMoveVector(.05,-.07,.4);
 near(tiny.strength,0);
 const yaw=followCameraYaw(.4,1,.1,{enabled:true,manual:tiny.strength>0});
 assert.ok(Math.abs(yaw-.4)>.05);
});
