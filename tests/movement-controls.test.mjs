import test from 'node:test';
import assert from 'node:assert/strict';
import {screenMoveVector,turnTowardsAngle} from '../movement-controls.js';
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
