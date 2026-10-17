import test from 'node:test';
import assert from 'node:assert/strict';
import {
 SPHERE_MOB_SPAWNS,SPHERE_CORPSE_MS,SPHERE_RESPAWN_MS,
 createSphericalMobs,localToNormal,normalToLocal,arcDistance,
 facesMob,sphereMobFacingYaw,applySphereAttack,tickSphericalMobs,mobSnapshot,sanitizeSphereEquipment
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

test('peaceful online Dolgonog explores its patrol radius without being pulled home at 0.65m',()=>{
 const mob=createSphericalMobs()[0],start={x:mob.x,z:mob.z};
 let furthest=0;
 for(let i=0;i<220;i++){
  tickSphericalMobs([mob],new Map(),261,.1,20000+i*100,()=>.5);
  furthest=Math.max(furthest,Math.hypot(mob.x-start.x,mob.z-start.z));
  assert.equal(mob.returning,false,'ordinary patrol must not trigger evade');
 }
 assert.ok(furthest>1.0,'mob should walk more than one metre from spawn');
 assert.ok(furthest<6,'idle mob should remain near its original habitat');
});

test('on losing online aggro the Dolgonog returns, heals at home, then resumes patrol',()=>{
 const mob=createSphericalMobs()[0],home={x:mob.x,z:mob.z};
 mob.x+=3;mob.z+=1;mob.hp=17;mob.aggroId='gone';mob.contributors.add('gone');
 tickSphericalMobs([mob],new Map(),261,.1,10000,()=>.5);
 assert.equal(mob.returning,true);
 assert.equal(mob.hp,17,'healing must wait for arrival at spawn');
 for(let i=0;i<160&&mob.returning;i++)tickSphericalMobs([mob],new Map(),261,.1,10100+i*100,()=>.5);
 assert.equal(mob.returning,false);
 assert.equal(mob.hp,mob.maxHp);
 assert.equal(mob.contributors.size,0);
 assert.ok(Math.hypot(mob.x-home.x,mob.z-home.z)<.65);
});

test('server facing corresponds to radial +Z-forward frame instead of a flat-map bearing',()=>{
 const epsilon=1e-8;
 assert.ok(Math.abs(Math.abs(sphereMobFacingYaw(0,0,0,3,261))-Math.PI)<epsilon);
 assert.ok(Math.abs(sphereMobFacingYaw(0,0,3,0,261)-Math.PI/2)<epsilon);
 for(const radius of [87,174,261]){
  const yaw=sphereMobFacingYaw(38,42,40,47,radius);
  assert.ok(Number.isFinite(yaw));
  assert.ok(yaw>=-Math.PI&&yaw<=Math.PI);
 }
});
