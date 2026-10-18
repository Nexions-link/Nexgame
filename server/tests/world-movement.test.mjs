import test from 'node:test';
import assert from 'node:assert/strict';
import {localToNormal,arcDistance} from '../spherical-pve.js';
import {HOUSE_CHEST} from '../../planet-test/hearth-house.js';
import {resolveSphereWalk,walkableSphereNormal} from '../world-movement.js';
const R=261;
const point=(x,z)=>localToNormal(x,z,R);
test('server sweep blocks longhouse walls',()=>{
 const from=point(-27-12,0),to=point(-27-7,0);
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
