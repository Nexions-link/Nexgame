import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advanceOnlineMobVisual} from '../mob-visual-online.js';

test('network smoothing moves only the visual pose, never combat-authoritative coordinates',()=>{
 const mob={x:3,z:4,yaw:1,renderX:0,renderZ:0,renderYaw:0};
 const moved=advanceOnlineMobVisual(mob,1/60);
 assert.ok(moved>0);
 assert.ok(mob.renderX>0&&mob.renderX<3);
 assert.ok(mob.renderZ>0&&mob.renderZ<4);
 assert.ok(mob.renderYaw>0&&mob.renderYaw<1);
 assert.deepEqual([mob.x,mob.z,mob.yaw],[3,4,1]);
 for(let i=0;i<180;i++)advanceOnlineMobVisual(mob,1/60);
 assert.ok(Math.hypot(mob.renderX-3,mob.renderZ-4)<.001);
});

test('turn interpolation wraps across +/- PI by the shortest path',()=>{
 const mob={x:0,z:0,yaw:-Math.PI+.08,renderX:0,renderZ:0,renderYaw:Math.PI-.08};
 advanceOnlineMobVisual(mob,1/60);
 assert.ok(mob.renderYaw>Math.PI-.08);
 assert.equal(mob.yaw,-Math.PI+.08);
});

test('server corrections teleport visually rather than drifting through terrain',()=>{
 const mob={x:100,z:30,yaw:-2,renderX:0,renderZ:0,renderYaw:1};
 assert.equal(advanceOnlineMobVisual(mob,1/60),0);
 assert.deepEqual([mob.renderX,mob.renderZ,mob.renderYaw],[100,30,-2]);
});

test('visuals initialize directly from the first authoritative snapshot',()=>{
 const mob={x:7,z:9,yaw:.25};
 assert.equal(advanceOnlineMobVisual(mob,1/60),0);
 assert.deepEqual([mob.renderX,mob.renderZ,mob.renderYaw],[7,9,.25]);
});
