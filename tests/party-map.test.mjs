import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPartyMember} from '../party-map.js';

test('nearby party members use exact coordinates relative to the player',()=>{
 const m=projectPartyMember(11,21,10,20,4,105);
 assert.deepEqual(m,{x:4,y:4,edge:false});
});
test('party member far away is pinned to minimap edge, not lost',()=>{
 const m=projectPartyMember(310,10,10,10,4.1,103);
 assert.deepEqual(m,{x:103,y:0,edge:true});
 const opposite=projectPartyMember(0,0,10,10,4.1,103);
 assert.equal(opposite.edge,false);
});
test('invalid map positions and scale are rejected',()=>{
 assert.equal(projectPartyMember(Infinity,0,0,0),null);
 assert.equal(projectPartyMember(0,0,0,0,0),null);
 assert.equal(projectPartyMember(NaN,0,0,0),null);
});
