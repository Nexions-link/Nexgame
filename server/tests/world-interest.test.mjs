import test from 'node:test';
import assert from 'node:assert/strict';
import {localToNormal} from '../spherical-pve.js';
import {selectVisiblePlayers} from '../world-interest.js';
const mk=(id,x,z=0)=>({id,normal:localToNormal(x,z,261),radius:261});
test('AOI includes self and nearby 16 peers, excludes distant heroes',()=>{
 const self=mk('self',0),near=Array.from({length:25},(_,i)=>mk('hero-'+i,i+1));
 const far=mk('far',100);
 const visible=selectVisiblePlayers([far,...near,self],self,261);
 assert.equal(visible.length,17);
 assert.equal(visible[0].id,'self');
 assert.deepEqual(visible.slice(1).map(p=>p.id),near.slice(0,16).map(p=>p.id));
 assert.equal(visible.some(p=>p.id==='far'),false);
});
test('same radius controls eligibility without changing real room population',()=>{
 const self=mk('self',0),close=mk('close',20),far=mk('far',100);
 assert.deepEqual(selectVisiblePlayers([self,close,far],self,261).map(p=>p.id),['self','close']);
});
