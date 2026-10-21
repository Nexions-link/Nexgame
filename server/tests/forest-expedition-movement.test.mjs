import test from 'node:test';
import assert from 'node:assert/strict';
import {localToNormal} from '../spherical-pve.js';
import {walkableSphereNormal,resolveSphereWalk} from '../world-movement.js';
import {createForestLayout,forestLocalPoint,forestCampPoint,FOREST_CAMP_PROPS} from '../../planet-test/whispering-forest.js';
const R=261;
test('authoritative movement cannot cross trees or expedition tents',()=>{
 const tree=createForestLayout().trees[0],p=forestLocalPoint(tree.lon,tree.lat,R);
 assert.equal(walkableSphereNormal(localToNormal(p.x,p.z,R),R),false);
 const tent=FOREST_CAMP_PROPS.find(x=>x.kind==='tent'),pos=forestCampPoint(tent.dx,tent.dz,R);
 const q=forestLocalPoint(pos.lon,pos.lat,R);
 assert.equal(walkableSphereNormal(localToNormal(q.x,q.z,R),R),false);
 const from=localToNormal(p.x-5,p.z,R),to=localToNormal(p.x+5,p.z,R);
 assert.equal(resolveSphereWalk(from,to,R).blocked,true);
});