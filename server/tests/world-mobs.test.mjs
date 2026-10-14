import test from 'node:test';
import assert from 'node:assert/strict';
import {
 MULGORE_MOB_SPAWNS,MOB_SPEED,createMulgoreMobs,tickMulgoreMobs,snapshotMulgoreMobs
} from '../world-mobs.js';

test('one consistent wildlife roster with stable IDs and boss coordinates',()=>{
 const mobs=createMulgoreMobs();
 assert.equal(mobs.length,9);
 assert.deepEqual(mobs.map(m=>m.id),[0,1,2,3,4,5,6,7,8]);
 assert.deepEqual([mobs[8].x,mobs[8].z],[39,47]);
 assert.equal(mobs.filter(m=>m.boss).length,1);
 mobs.forEach((mob,id)=>assert.deepEqual([mob.x,mob.z],MULGORE_MOB_SPAWNS[id]));
});
test('server movement is bounded, continuous and stays close to spawn',()=>{
 const mobs=createMulgoreMobs();
 for(let tick=0;tick<2000;tick++){
  const before=mobs.map(({x,z})=>({x,z}));
  tickMulgoreMobs(mobs,.1);
  mobs.forEach((m,i)=>{
   assert.ok(Math.hypot(m.x-before[i].x,m.z-before[i].z)<=MOB_SPEED*.1+1e-8);
   assert.ok(Math.hypot(m.x-m.spawnX,m.z-m.spawnZ)<6);
   assert.ok(Number.isFinite(m.yaw));
   assert.ok(Number.isFinite(m.phase));
  });
 }
});
test('snapshots are safe independent data objects',()=>{
 const mobs=createMulgoreMobs();
 const packet=snapshotMulgoreMobs(mobs);
 assert.equal(packet.length,9);
 assert.deepEqual(Object.keys(packet[0]),['id','x','z','yaw','phase']);
 packet[0].x=999;
 assert.equal(mobs[0].x,-9);
});
test('invalid or absent simulation delta does not teleport mobs',()=>{
 const mobs=createMulgoreMobs();
 const before=snapshotMulgoreMobs(mobs);
 tickMulgoreMobs(mobs,-1);
 tickMulgoreMobs(mobs,NaN);
 tickMulgoreMobs(mobs,0);
 assert.deepEqual(snapshotMulgoreMobs(mobs),before);
});
