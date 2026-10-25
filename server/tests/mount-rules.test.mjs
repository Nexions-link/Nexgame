import test from 'node:test';
import assert from 'node:assert/strict';
import {
 MOUNT_LEVEL,MOUNT_CAST_MS,MOUNT_SPEED_MULTIPLIER,FIRST_MOUNT_ID,
 MOUNT_STATE,mountOwned,canBeginMount,beginMount,advanceMount,dismount,mountedSpeed,publicMount
} from '../mount-rules.js';
test('level and server-issued ownership are mandatory',()=>{
 assert.equal(MOUNT_LEVEL,10);
 assert.equal(mountOwned({mounts:[FIRST_MOUNT_ID]}),true);
 assert.equal(mountOwned({mounts:[]}),false);
 assert.equal(canBeginMount({level:9,owned:true}),'level');
 assert.equal(canBeginMount({level:10,owned:false}),'not_owned');
 assert.equal(canBeginMount({level:10,owned:true}),null);
});
test('cast lasts two seconds and movement or combat interrupts it',()=>{
 const start=beginMount({},1000);
 assert.equal(start.castEndsAt,1000+MOUNT_CAST_MS);
 assert.equal(advanceMount(start,2999).mountState,MOUNT_STATE.CASTING);
 assert.equal(advanceMount(start,3000).mountState,MOUNT_STATE.RIDING);
 assert.equal(advanceMount(start,1500,{moving:true}).mountState,MOUNT_STATE.FOOT);
 assert.equal(advanceMount(start,1500,{inCombat:true}).mountState,MOUNT_STATE.FOOT);
});
test('mount movement only applies to authorized riding state',()=>{
 const started=beginMount({},0);
 assert.equal(mountedSpeed(4.05,started),4.05);
 const riding=advanceMount(started,2000);
 assert.equal(mountedSpeed(5,riding),5*MOUNT_SPEED_MULTIPLIER);
 assert.equal(mountedSpeed(5,dismount(riding)),5);
 assert.deepEqual(publicMount(started),{mountState:'foot',mountId:null});
 assert.deepEqual(publicMount(riding),{mountState:'riding',mountId:FIRST_MOUNT_ID});
});
test('blocked in combat, water, interiors, and when already moving',()=>{
 for(const flag of ['inCombat','inWater','indoors','moving','dead'])
  assert.notEqual(canBeginMount({level:10,owned:true,[flag]:true}),null);
});
