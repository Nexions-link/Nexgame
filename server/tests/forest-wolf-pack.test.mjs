import test from 'node:test';
import assert from 'node:assert/strict';
import {createSphericalMobs,localToNormal,rallyNearbyWolves,tickSphericalMobs,
 startSphereEvade,SPHERE_LEASH_METRES,sphereCombatLineClear,
 applySphereAttack,reassignSphereAggroOnLeave} from '../spherical-pve.js';
import {wolfPairIndex,eligibleWolfPackHelper,WOLF_PACK_HOWL_MS} from '../../planet-test/forest-wolf-pack.js';
import {FOREST_WOLF_SPAWNS} from '../../planet-test/forest-wolf-spawns.js';
import {canWalkCamp} from '../../planet-test/sphere-physics.js';
const now=100000;
const player=p=>({id:'p1',normal:localToNormal(p.x,p.z,261),radius:261,
 joined:true,hp:120,maxHp:120,respawnShieldUntil:0,heading:0,resource:0,equipment:{}});
test('six independent pairs are close, visibly reachable and clear of collisions',()=>{
 assert.equal(FOREST_WOLF_SPAWNS.length,12);
 for(let pair=0;pair<6;pair++){
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

test('two characters jointly fight one forest wolf; only verified contributors receive kill credit',()=>{
 const mobs=createSphericalMobs(),wolf=mobs[14],oldLife=wolf.life;
 const heroA={...player({x:wolf.x,z:wolf.z-1.9}),id:'a',level:5,heading:Math.PI/2};
 const heroB={...player({x:wolf.x,z:wolf.z-1.8}),id:'b',level:5,heading:Math.PI/2};
 const first=applySphereAttack(mobs,heroA,'autoAttack',wolf.id,now,()=>.5);
 assert.equal(first.ok,true,'first warrior can hit forest wolf without obstacles');
 assert.equal(first.events[0].fromId,'a');
 assert.ok(first.events[0].damage>0);
 wolf.hp=1; // Reduce only this test mob so the second verified blow confirms shared kill.
 const second=applySphereAttack(mobs,heroB,'autoAttack',wolf.id,now+1,()=>.5);
 assert.equal(second.ok,true);
 assert.equal(second.events[0].fromId,'b');
 assert.equal(second.events[0].hp,0);
 assert.equal(second.events[0].life,oldLife);
 assert.equal(wolf.phase,'corpse');
 assert.deepEqual(new Set(second.credits.map(x=>x.targetId)),new Set(['a','b']));
 assert.ok(second.credits.every(x=>x.event.mobId===wolf.id&&x.event.life===oldLife
  &&x.event.xp>0));
 const replay=applySphereAttack(mobs,heroA,'autoAttack',wolf.id,now+3000,()=>.5);
 assert.equal(replay.ok,false,'corpse cannot be killed twice');
});
test('wolf pack aggro remains on the surviving contributor after a tank disconnect',()=>{
 const mobs=createSphericalMobs(),wolf=mobs[14];
 const first={...player({x:wolf.x,z:wolf.z-1.9}),id:'tank',level:5,heading:Math.PI/2};
 const second={...player({x:wolf.x,z:wolf.z-1.8}),id:'ally',level:5,heading:Math.PI/2};
 assert.equal(applySphereAttack(mobs,first,'autoAttack',wolf.id,now,()=>.5).ok,true);
 assert.equal(applySphereAttack(mobs,second,'autoAttack',wolf.id,now+1,()=>.5).ok,true);
 const roster=new Map([['ally',second]]);
 assert.equal(reassignSphereAggroOnLeave(wolf,'tank',roster,261,now+2),true);
 assert.equal(wolf.aggroId,'ally');
 assert.equal(wolf.contributors.has('tank'),false);
 assert.equal(wolf.contributors.has('ally'),true);
 assert.equal(wolf.returning,false);
});
