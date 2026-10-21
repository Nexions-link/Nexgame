import test from 'node:test';
import assert from 'node:assert/strict';
import {createSphericalMobs,localToNormal,rallyNearbyWolves,tickSphericalMobs,
 startSphereEvade,SPHERE_LEASH_METRES,sphereCombatLineClear} from '../spherical-pve.js';
import {wolfPairIndex,eligibleWolfPackHelper,WOLF_PACK_HOWL_MS} from '../../planet-test/forest-wolf-pack.js';
import {FOREST_WOLF_SPAWNS} from '../../planet-test/forest-wolf-spawns.js';
import {canWalkCamp} from '../../planet-test/sphere-physics.js';
const now=100000;
const player=p=>({id:'p1',normal:localToNormal(p.x,p.z,261),radius:261,
 joined:true,hp:120,maxHp:120,respawnShieldUntil:0,heading:0,resource:0,equipment:{}});
test('three independent pairs are close, visibly reachable and clear of collisions',()=>{
 assert.equal(FOREST_WOLF_SPAWNS.length,6);
 for(let pair=0;pair<3;pair++){
  const a=FOREST_WOLF_SPAWNS[pair*2],b=FOREST_WOLF_SPAWNS[pair*2+1];
  const d=Math.hypot(a.x-b.x,a.z-b.z);
  assert.ok(d>18&&d<26,'pair '+pair+' distance '+d);
  assert.equal(wolfPairIndex(14+pair*2),pair);
  assert.equal(wolfPairIndex(15+pair*2),pair);
  assert.equal(canWalkCamp(a.x,a.z,5.1,261),true);
  assert.equal(canWalkCamp(b.x,b.z,5.1,261),true);
  assert.equal(sphereCombatLineClear(a.x,a.z,b.x,b.z),true);
 }
});
test('one wolf howls and calls at most one legitimate ally; no chain or repeat',()=>{
 const mobs=createSphericalMobs(),leader=mobs[14],ally=mobs[15];
 const hero=player(leader); const players=new Map([[hero.id,hero]]);
 leader.aggroId=hero.id;
 const events=tickSphericalMobs(mobs,players,261,.1,now,()=>.5);
 assert.equal(events.filter(e=>e.type==='mobHowl').length,1);
 assert.equal(ally.aggroId,hero.id);
 assert.ok(leader.packHowlUntil===now+WOLF_PACK_HOWL_MS);
 assert.ok(ally.packHowlUntil===now+WOLF_PACK_HOWL_MS);
 assert.equal(leader.attackAt,0);
 assert.equal(ally.attackAt,0);
 assert.equal(tickSphericalMobs(mobs,players,261,.1,now+100,()=>.5)
  .filter(e=>e.type==='mobHowl').length,0);
 assert.equal(mobs.filter(m=>m.family==='forestWolf'&&m.aggroId===hero.id).length,2);
 startSphereEvade(leader);startSphereEvade(ally);
 assert.equal(leader.packAlerted,false);assert.equal(ally.packAssisting,false);
 assert.equal(leader.packHowlUntil,0);
});
test('a helper never joins a fight through obstacles or beyond its leash',()=>{
 const mobs=createSphericalMobs(),leader=mobs[14],ally=mobs[15],hero=player(leader);
 assert.equal(eligibleWolfPackHelper(leader,ally,hero,{
  radius:261,now,leash:SPHERE_LEASH_METRES,
  distance:()=>10,clear:()=>false}),false);
 assert.equal(eligibleWolfPackHelper(leader,ally,hero,{
  radius:261,now,leash:SPHERE_LEASH_METRES,
  distance:(a,b)=>b===hero?30:10,clear:()=>true}),false);
 ally.aggroId='another';
 assert.equal(rallyNearbyWolves(mobs,leader,hero,261,now).length,0);
 assert.equal(ally.aggroId,'another');
});
