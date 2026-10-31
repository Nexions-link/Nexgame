import test from 'node:test';
import assert from 'node:assert/strict';
import {localToNormal,arcDistance} from '../spherical-pve.js';
import {HOUSE_CHEST} from '../../planet-test/hearth-house.js';
import {resolveSphereWalk,walkableSphereNormal} from '../world-movement.js';
const R=261;
const point=(x,z)=>localToNormal(x,z,R);
test('server sweep blocks longhouse walls',()=>{
 const from=point(-14,-8),to=point(-21,-8);
 assert.equal(walkableSphereNormal(from,R),true);
 assert.equal(resolveSphereWalk(from,to,R).blocked,true);
});
test('server sweep cannot tunnel through shared chest',()=>{
 const x=HOUSE_CHEST.x,z=HOUSE_CHEST.z;
 const from=point(x-2,z),to=point(x+2,z);
 const result=resolveSphereWalk(from,to,R);
 assert.equal(result.blocked,true);
 assert.ok(arcDistance(result.normal,to,R)>.5);
});
test('unobstructed movement stays walkable',()=>{
 const from=point(0,0),to=point(.8,0);
 const result=resolveSphereWalk(from,to,R);
 assert.equal(result.blocked,false);
 assert.ok(arcDistance(result.normal,to,R)<.001);
});
test('deep lake rejects movement',()=>{
 assert.equal(walkableSphereNormal(point(30,26),R),false);
});

test('bounded movement credit accepts mobile jitter, but rejects repeated speed bursts',async()=>{
 const {sphereMoveBudget}=await import('../spherical-world.js');
 let b=sphereMoveBudget(1.2,.1,7,.4);
 assert.equal(b.capped,false);
 for(let i=0;i<12;i++)b=sphereMoveBudget(b.credit,.1,7,.405);
 assert.equal(b.capped,false,'ordinary walking must not trigger a speed cap');
 assert.ok(b.credit<=2);
 const spike=sphereMoveBudget(b.credit,.01,7,9);
 assert.equal(spike.capped,true);
 assert.ok(spike.distance<=2.07);
 const again=sphereMoveBudget(spike.credit,.01,7,9);
 assert.ok(again.distance<=.08,'unused burst distance cannot be reused');
});
