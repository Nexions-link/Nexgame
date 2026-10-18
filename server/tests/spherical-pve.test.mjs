import test from 'node:test';
import {canWalkCamp} from '../../planet-test/sphere-physics.js';
import {canWadeAtLocal} from '../../planet-test/start-zone.js';
import {BOSS_POSITION} from '../../planet-test/mentor-chain.js';
import assert from 'node:assert/strict';
import {
 SPHERE_MOB_SPAWNS,SPHERE_CORPSE_MS,SPHERE_RESPAWN_MS,
 createSphericalMobs,localToNormal,normalToLocal,arcDistance,
 facesMob,applySphereAttack,tickSphericalMobs,mobSnapshot,sanitizeSphereEquipment,sphericalMobYaw,SPHERE_ROAM_RADIUS
} from '../spherical-pve.js';

const character=(id,x=-9,z=-24,radius=261)=>({
 id,name:id,joined:true,normal:localToNormal(x,z,radius),
 radius,heading:Math.PI/2,hp:120,maxHp:120,level:1,
 equipment:{weapon:{id:'wornAxe'}},resource:35,abilityCooldowns:{}
});
test('spherical geometry round-trips local camp positions at all radii',()=>{
 for(const radius of [87,174,261]){
  for(const [x,z] of SPHERE_MOB_SPAWNS){
   const p=normalToLocal(localToNormal(x,z,radius),radius);
   assert.ok(Math.abs(p.x-x)<1e-8);
   assert.ok(Math.abs(p.z-z)<1e-8);
  }
  assert.ok(arcDistance(localToNormal(0,0,radius),localToNormal(0,1,radius),radius)-1<1e-8);
 }
});
test('combat validates distance, facing, cooldowns and authoritative HP',()=>{
 const mobs=createSphericalMobs(),player=character('hero'),first=mobs[0];
 assert.equal(facesMob(player,first,261),true);
 const attacked=applySphereAttack(mobs,player,'autoAttack',first.id,1000,()=>.5);
 assert.equal(attacked.ok,true);
 assert.ok(first.hp<first.maxHp);
 assert.equal(attacked.events[0].mobId,first.id);
 assert.equal(applySphereAttack(mobs,player,'autoAttack',first.id,1100).ok,false);
 const far=character('far',80,0);
 assert.equal(applySphereAttack(mobs,far,'autoAttack',first.id,1000).ok,false);
 player.heading=-Math.PI/2;
 assert.equal(applySphereAttack(mobs,player,'autoAttack',first.id,5000).ok,false);
});
test('two contributors receive one personal kill credit and corpse persists 30s then respawns 30s later',()=>{
 const mobs=createSphericalMobs(),first=mobs[0];
 const p1=character('p1'),p2=character('p2');
 p1.equipment={weapon:{id:'wornAxe'}};p2.equipment=p1.equipment;
 const contributors=new Set();
 const loot=new Map();
 let now=1000;
 for(let i=0;first.phase==='alive'&&i<75;i++){
  const p=i%2?p2:p1;
  const res=applySphereAttack(mobs,p,'autoAttack',first.id,now,()=>.3);
  assert.equal(res.ok,true);
  for(const credit of res.credits){contributors.add(credit.targetId);loot.set(credit.targetId,credit.event);}
  now+=2500;
 }
 assert.equal(first.phase,'corpse');
 assert.deepEqual([...contributors].sort(),['p1','p2']);
 for(const row of loot.values()){assert.equal(row.life,1);assert.ok(Array.isArray(row.loot));}
 const atDeath=first.deathAt;
 assert.equal(mobSnapshot(mobs)[0].phase,'corpse');
 tickSphericalMobs(mobs,new Map(),261,.1,atDeath+SPHERE_CORPSE_MS-1);
 assert.equal(first.phase,'corpse');
 tickSphericalMobs(mobs,new Map(),261,.1,atDeath+SPHERE_CORPSE_MS);
 assert.equal(first.phase,'hidden');
 tickSphericalMobs(mobs,new Map(),261,.1,atDeath+SPHERE_CORPSE_MS+SPHERE_RESPAWN_MS-1);
 assert.equal(first.phase,'hidden');
 tickSphericalMobs(mobs,new Map(),261,.1,atDeath+SPHERE_CORPSE_MS+SPHERE_RESPAWN_MS);
 assert.equal(first.phase,'alive');assert.equal(first.life,2);assert.equal(first.hp,first.maxHp);
 assert.equal(first.contributors.size,0);
});
test('mob aggro is shared, survives idle and releases only when player leaves 23m spawn leash',()=>{
 const mobs=createSphericalMobs(),first=mobs[0];
 const p=character('p');
 const players=new Map([[p.id,p]]);
 for(let i=0;i<15;i++)tickSphericalMobs(mobs,players,261,.1,10000+i*100,()=>.99);
 assert.equal(first.aggroId,'p');
 p.normal=localToNormal(70,70,261);
 tickSphericalMobs(mobs,players,261,.1,12000);
 assert.equal(first.aggroId,null);
});
test('equipment and wrong-world injections are bounded',()=>{
 assert.deepEqual(sanitizeSphereEquipment({weapon:{id:'scalpingStrength'},shield:{id:'batteredBuckler'}},1),
  {shield:{id:'batteredBuckler'}});
 const mobs=createSphericalMobs(),p=character('x');
 assert.equal(applySphereAttack(mobs,p,'healingPotion',mobs[0].id,1000).ok,false);
 assert.equal(applySphereAttack(mobs,p,'autoAttack','missing',1000).ok,false);
});

test('spherical yaw uses GLB tangent +Z frame instead of flat-world bearings',()=>{
 const forwardZ=sphericalMobYaw(0,0,0,1,261);
 const forwardX=sphericalMobYaw(0,0,1,0,261);
 assert.ok(Math.abs(Math.abs(forwardZ)-Math.PI)<.02,'map +Z requires a 180-degree local turn');
 assert.ok(Math.abs(forwardX-Math.PI/2)<.02,'map +X requires +90 degrees');
 assert.equal(sphericalMobYaw(0,0,0,0,261),null);
});
test('online wildlife walks and rests around spawn instead of snapping home after 0.65m',()=>{
 const mobs=createSphericalMobs(),players=new Map(),r=261;
 let randomIndex=0;
 const rng=()=>((randomIndex++*.173+.03)%1);
 const start=mobs.map(m=>({x:m.x,z:m.z}));
 let maxDistance=0,everWalking=false,everResting=false;
 for(let i=0;i<260;i++){
  tickSphericalMobs(mobs,players,r,.1,10_000+i*100,rng);
  for(let j=0;j<mobs.length;j++){
   const m=mobs[j];const d=Math.hypot(m.x-start[j].x,m.z-start[j].z);
   maxDistance=Math.max(maxDistance,d);
   assert.ok(d<=SPHERE_ROAM_RADIUS+.5,'wildlife never leaves its permitted home range');
   everWalking ||= m.roamState==='walking';
   everResting ||= m.roamState==='rest';
  }
 }
 assert.ok(maxDistance>1.0,'at least one dolgonog really wanders away from spawn');
 assert.ok(everWalking&&everResting,'roaming alternates with idle periods');
});
test('server stops chase at leash, returns home and restores HP after return',()=>{
 const mob=createSphericalMobs()[0],p=character('leash',mob.spawnX,mob.spawnZ,261);
 const players=new Map([[p.id,p]]);
 mob.x=mob.spawnX+2;mob.z=mob.spawnZ;mob.hp=10;mob.aggroId=p.id;
 p.normal=localToNormal(75,75,261);
 tickSphericalMobs([mob],players,261,.1,20000,()=>.2);
 assert.equal(mob.aggroId,null);assert.equal(mob.returning,true);
 for(let i=1;i<180&&mob.returning;i++)tickSphericalMobs([mob],players,261,.1,20000+i*100,()=>.2);
 assert.equal(mob.returning,false,'evading creature reaches its home point');
 assert.equal(mob.hp,mob.maxHp,'health resets after return, not during the chase');
});

test('server respawn moves interaction coordinates to the starting camp',()=>{
 const mobs=createSphericalMobs(),mob=mobs[0];
 const hero=character('fallen',mob.x,mob.z+1);
 hero.x=mob.x;hero.z=mob.z+1;hero.hp=1;
 mob.aggroId=hero.id;mob.attackAt=1100;
 mob.yaw=sphericalMobYaw(mob.x,mob.z,hero.x-mob.x,hero.z-mob.z,261);
 const events=tickSphericalMobs(mobs,new Map([[hero.id,hero]]),261,.1,1200,()=>.99);
 assert.ok(events.some(e=>e.type==='respawnAccepted'));
 assert.deepEqual([hero.x,hero.z],[0,0]);
 assert.deepEqual(hero.normal,localToNormal(0,0,261));
});

test('the world has exactly nine normal dolgonogs (levels 1 and 2) and one elite level 3 boss',()=>{
 const mobs=createSphericalMobs();
 assert.equal(mobs.length,10);
 assert.deepEqual([mobs.at(-1).x,mobs.at(-1).z],[BOSS_POSITION.x,BOSS_POSITION.z]);
 for(const m of mobs.slice(0,-1)){
  assert.equal(canWalkCamp(m.spawnX,m.spawnZ),true,'mob spawn must not be inside a wall');
  assert.equal(canWadeAtLocal(m.spawnX,m.spawnZ),true,'mob spawn must not be in deep water');
 }
 assert.deepEqual(mobs.filter(m=>!m.boss).map(m=>m.level),[1,1,1,1,1,2,2,2,2]);
 const boss=mobs.at(-1);
 assert.equal(boss.id,'dolgonog-9');
 assert.equal(boss.level,3);assert.equal(boss.boss,true);
 assert.equal(boss.hp,108);
 assert.deepEqual(mobSnapshot(mobs).map(m=>m.level),mobs.map(m=>m.level));
 assert.equal(mobs[5].maxHp,66,'level 2 mobs have slightly more health');
 assert.equal(mobs[5].name,'Равнинный долгоног');
});

test('all ten monsters are beasts; none has a currency kill reward',()=>{
 const mobs=createSphericalMobs();
 assert.equal(mobs.length,10);
 assert.ok(mobs.every(m=>m.creatureType==='beast'));
 assert.ok(mobSnapshot(mobs).every(m=>m.creatureType==='beast'));
 const hero=character('hunter'),mob=mobs[0];mob.hp=1;
 const result=applySphereAttack(mobs,hero,'autoAttack',mob.id,4000,()=>.5);
 assert.equal(result.credits[0].event.gold,0);
 assert.ok(result.credits[0].event.loot.every(row=>row.id!=='coins'));
});
