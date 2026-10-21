import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptForestHunt,creditForestWolfKill,reportForestHunt,
 inspectForestDen,finishForestHunt,getForestHunt} from '../forest-hunt-quest.js';
import {FOREST_HUNT_SCOUT,FOREST_DEN_SITES} from '../../planet-test/forest-hunt-quest.js';
import {localToNormal} from '../spherical-pve.js';
import {canWalkCamp} from '../../planet-test/sphere-physics.js';
const ctx=p=>({normal:localToNormal(p.x,p.z,261),radius:261,inCombat:false});
const initial=()=>({level:5,experience:0,gold:0,health:180,worldRadius:261,equipment:{},
 quests:{expedition:{stage:2,visited:[false,false,false]}}});
test('hunt is level/expedition gated and kill events require verified wolf family',()=>{
 let s=initial();s.level=4;
 assert.throws(()=>acceptForestHunt(s,ctx(FOREST_HUNT_SCOUT)));
 s.level=5;s.quests.expedition.stage=1;
 assert.throws(()=>acceptForestHunt(s,ctx(FOREST_HUNT_SCOUT)));
 s.quests.expedition.stage=2;
 assert.throws(()=>acceptForestHunt(s,ctx({x:0,z:0})));
 s=acceptForestHunt(s,ctx(FOREST_HUNT_SCOUT));
 assert.equal(getForestHunt(s).stage,1);
 assert.equal(creditForestWolfKill(s,'bandit-0'),s);
 for(const id of ['forest-wolf-0','forest-wolf-1','forest-wolf-2'])
  s=creditForestWolfKill(s,id);
 assert.equal(getForestHunt(s).stage,2);assert.equal(getForestHunt(s).kills,3);
 assert.equal(creditForestWolfKill(s,'forest-wolf-3'),s);
 assert.throws(()=>reportForestHunt(s,ctx(FOREST_DEN_SITES[0])));
 s=reportForestHunt(s,ctx(FOREST_HUNT_SCOUT));
 assert.throws(()=>inspectForestDen(s,ctx(FOREST_DEN_SITES[0]),2));
 assert.throws(()=>inspectForestDen(s,ctx(FOREST_DEN_SITES[0]),1));
 s=inspectForestDen(s,ctx(FOREST_DEN_SITES[0]),0);
 assert.throws(()=>inspectForestDen(s,ctx(FOREST_DEN_SITES[0]),0));
 s=inspectForestDen(s,ctx(FOREST_DEN_SITES[1]),1);
 assert.equal(getForestHunt(s).stage,4);
 assert.throws(()=>finishForestHunt(s,ctx(FOREST_DEN_SITES[0])));
 const {next,event}=finishForestHunt(s,ctx(FOREST_HUNT_SCOUT));
 assert.equal(getForestHunt(next).stage,5);assert.equal(event.xp,210);
 assert.equal(event.eventKey,'forest-hunt:den:v1');assert.equal(next.gold,42);
 assert.throws(()=>finishForestHunt(next,ctx(FOREST_HUNT_SCOUT)));
});
test('both den sites are clear of solids with player clearance',()=>{
 for(const point of FOREST_DEN_SITES)assert.equal(canWalkCamp(point.x,point.z,2.3,261),true);
});
