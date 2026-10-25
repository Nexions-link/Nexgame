import test from 'node:test';
import {canWalkCamp} from '../../planet-test/sphere-physics.js';
import {canWadeAtLocal} from '../../planet-test/start-zone.js';
import {BOSS_POSITION} from '../../planet-test/mentor-chain.js';
import assert from 'node:assert/strict';
import {
 SPHERE_MOB_SPAWNS,SPHERE_CORPSE_MS,SPHERE_RESPAWN_MS,
 createSphericalMobs,localToNormal,normalToLocal,arcDistance,
 facesMob,applySphereAttack,tickSphericalMobs,mobSnapshot,sanitizeSphereEquipment,sphericalMobYaw,SPHERE_ROAM_RADIUS,startSphereEvade,sphereCombatLineClear,reassignSphereAggroOnLeave
} from '../spherical-pve.js';

const character=(id,x=-9,z=-24,radius=261)=>({
 id,name:id,joined:true,normal:localToNormal(x,z,radius),
 radius,heading:Math.PI/2,hp:120,maxHp:120,level:1,
 equipment:{weapon:{id:'wornAxe'}},resource:35,abilityCooldowns:{}
});
test('spherical geometry round-trips local camp positions at all radii',()=>{
 for(const radius of [87,174,261]){
  for(const [x,z] of SPHERE_MOB_SPAWNS){
   // The 87m and 174m legacy test planets cannot represent the new far-forest
   // spawns outside their unique geodesic chart; production radius is 261m.
   if(Math.hypot(x,z)>=Math.PI*radius-1e-6)continue;
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
   assert.ok(d<=(m.family==='bandit'?15:SPHERE_ROAM_RADIUS+.5),'creatures remain in their roaming or patrol area');
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
 assert.equal(mobs.length,26);
 assert.deepEqual([mobs.find(m=>m.boss).x,mobs.find(m=>m.boss).z],[BOSS_POSITION.x,BOSS_POSITION.z]);
 for(const m of mobs){
  assert.equal(canWalkCamp(m.spawnX,m.spawnZ),true,'mob spawn must not be inside a wall');
  // The only physical lake is in the original 82m start chart. Beyond it,
  // walkability is spherical terrain; flat starter height is not authoritative.
  if(Math.hypot(m.spawnX,m.spawnZ)<82)
   assert.equal(canWadeAtLocal(m.spawnX,m.spawnZ),true,'starter spawn must not be in deep water');
 }
 assert.deepEqual(mobs.filter(m=>m.family==='dolgonog').map(m=>m.level),[1,1,1,1,1,2,2,2,2]);
 const boss=mobs.find(m=>m.boss);
 assert.equal(boss.id,'dolgonog-9');
 assert.equal(boss.level,3);assert.equal(boss.boss,true);
 assert.equal(boss.hp,108);
 assert.deepEqual(mobSnapshot(mobs).map(m=>m.level),mobs.map(m=>m.level));
 assert.equal(mobs[5].maxHp,66,'level 2 mobs have slightly more health');
 assert.equal(mobs[5].name,'Равнинный долгоног');
});

test('all ten monsters are beasts; none has a currency kill reward',()=>{
 const mobs=createSphericalMobs();
 assert.equal(mobs.length,26);
 assert.ok(mobs.filter(m=>m.family!=='bandit').every(m=>m.creatureType==='beast'));
 assert.ok(mobs.filter(m=>m.family==='bandit').every(m=>m.creatureType==='humanoid'));
 assert.ok(mobSnapshot(mobs).filter(m=>m.family!=='bandit').every(m=>m.creatureType==='beast'));
 const hero=character('hunter'),mob=mobs[0];mob.hp=1;
 const result=applySphereAttack(mobs,hero,'autoAttack',mob.id,4000,()=>.5);
 assert.equal(result.credits[0].event.gold,0);
 assert.ok(result.credits[0].event.loot.every(row=>row.id!=='coins'));
});

test('an idle player remains under real combat pressure until leash; evasion cannot grant rewards',()=>{
 const mob=createSphericalMobs()[0],p=character('idle',mob.spawnX,mob.spawnZ+1);
 const players=new Map([[p.id,p]]);
 mob.hp=mob.maxHp-9;
 mob.aggroId=p.id;mob.contributors.add(p.id);
 mob.yaw=sphericalMobYaw(mob.x,mob.z,0,1,261);
 const attacks=[];
 for(let i=0;i<105;i++){
  const events=tickSphericalMobs([mob],players,261,.1,10000+i*100,()=>.99);
  attacks.push(...events.filter(e=>e.type==='mobAttack'));
  if(attacks.length>=2)break;
 }
 assert.ok(attacks.length>=2,'the creature must continue hitting a stationary player');
 assert.equal(mob.hp,mob.maxHp-9,'an active attacker must not silently heal');
 // After the hero escapes, combat credit and queued attacks must be discarded.
 mob.x=mob.spawnX+2;
 p.normal=localToNormal(70,70,261);
 tickSphericalMobs([mob],players,261,.1,22000,()=>.99);
 assert.equal(mob.returning,true);
 assert.equal(mob.aggroId,null);
 assert.equal(mob.attackAt,0);
 assert.equal(mob.contributors.size,0);
 assert.equal(mob.hp,mob.maxHp-9,'the mob heals only once back at its spawn');
 const other=character('opportunist',mob.x,mob.z);
 const priorHp=mob.hp;
 const rejected=applySphereAttack([mob],other,'autoAttack',mob.id,22200,()=>.5);
 assert.equal(rejected.ok,false,'evading creatures should not be farmed');
 assert.equal(mob.hp,priorHp);
 for(let i=0;i<190&&mob.returning;i++)
  tickSphericalMobs([mob],players,261,.1,22300+i*100,()=>.99);
 assert.equal(mob.returning,false);
 assert.equal(mob.hp,mob.maxHp);
});

test('a fatal hit disengages every pursuing creature before respawn and cancels old combat credit',()=>{
 const [killer,other]=createSphericalMobs();
 const hero=character('fallen',killer.x,killer.z+1);
 hero.hp=1;hero.x=killer.x;hero.z=killer.z+1;
 killer.yaw=sphericalMobYaw(killer.x,killer.z,0,1,261);
 killer.aggroId=hero.id;killer.attackAt=1100;
 other.x=other.spawnX+2;other.z=other.spawnZ;
 other.hp=other.maxHp-8;other.aggroId=hero.id;other.attackAt=1100;
 for(const mob of [killer,other])mob.contributors.add(hero.id);
 const players=new Map([[hero.id,hero]]);
 const events=tickSphericalMobs([killer,other],players,261,.1,1200,()=>.99);
 assert.equal(events.filter(e=>e.type==='mobAttack').length,1);
 assert.equal(events.filter(e=>e.type==='respawnAccepted').length,1);
 assert.deepEqual(hero.normal,localToNormal(0,0,261));
 assert.ok(hero.respawnShieldUntil>1200);
 assert.ok([killer,other].every(m=>m.aggroId===null&&m.attackAt===0));
 assert.equal(other.returning,true,'second creature must go home instead of resuming a phantom attack');
 assert.equal(other.hp,other.maxHp-8);
 assert.ok([killer,other].every(m=>m.contributors.size===0));
 const more=tickSphericalMobs([killer,other],players,261,.1,1300,()=>.99);
 assert.equal(more.some(e=>e.type==='mobAttack'||e.type==='mobTelegraph'),false);
});

test('evade helper is safe for corpses and clears stale windup, stun and navigation',()=>{
 const mob=createSphericalMobs()[0];
 mob.phase='corpse';mob.aggroId='ghost';
 startSphereEvade(mob);
 assert.equal(mob.aggroId,'ghost','corpse lifecycle must stay authoritative');
 mob.phase='alive';mob.navigation={route:[]};mob.stunUntil=123;mob.attackAt=800;
 mob.contributors.add('ghost');
 startSphereEvade(mob);
 assert.equal(mob.returning,true);
 assert.equal(mob.stunUntil,0);
 assert.equal(mob.attackAt,0);
 assert.equal(mob.navigation,null);
 assert.equal(mob.contributors.size,0);
});

test('solid tent blocks initial passive aggro, but visible players can still be detected',()=>{
 const mob=createSphericalMobs()[0];
 // Small tent is centered at (-23,-15), both endpoints are outside its walls.
 mob.spawnX=mob.x=-23;mob.spawnZ=mob.z=-18.25;mob.roamUntil=Infinity;
 const hero=character('scout',-23,-11.75);
 const players=new Map([[hero.id,hero]]);
 assert.equal(sphereCombatLineClear(mob.x,mob.z,-23,-11.75),false);
 const events=tickSphericalMobs([mob],players,261,.1,1000,()=>.5);
 assert.equal(mob.aggroId,null,'no X-ray vision through a tent');
 assert.equal(events.some(e=>e.type==='mobTelegraph'),false);
 hero.normal=localToNormal(-23,-18.9,261);
 tickSphericalMobs([mob],players,261,.1,1100,()=>.5);
 assert.equal(mob.aggroId,hero.id,'an unobstructed target is still acquired');
});

test('tree collision blocks melee and thunder stomp; no damage, resource or aggro leak',()=>{
 const mob=createSphericalMobs()[0];mob.spawnX=mob.x=-27.15;mob.spawnZ=mob.z=21;
 const hero=character('warrior',-24.85,21);hero.heading=Math.PI;
 assert.equal(sphereCombatLineClear(-24.85,21,mob.x,mob.z),false);
 const initialHp=mob.hp,initialRage=hero.resource;
 const melee=applySphereAttack([mob],hero,'autoAttack',mob.id,1000,()=>.5);
 assert.equal(melee.ok,false);
 assert.match(melee.reason,/препятствием/);
 assert.equal(mob.hp,initialHp);
 assert.equal(hero.resource,initialRage);
 assert.equal(mob.aggroId,null);
 const stomp=applySphereAttack([mob],hero,'thunderStomp',mob.id,2000,()=>.5);
 assert.equal(stomp.ok,true,'an unobstructed empty AoE can be cast');
 assert.equal(stomp.events.length,0,'walls must filter damaged AoE targets');
 assert.equal(mob.hp,initialHp);
 mob.aggroId=hero.id;mob.attackAt=2200;
 const events=tickSphericalMobs([mob],new Map([[hero.id,hero]]),261,.1,2300,()=>.5);
 assert.equal(events.some(e=>e.type==='mobAttack'),false,'mob cannot hit through tree');
 assert.equal(mob.attackAt,0,'blocked attack windup must be cancelled');
});

test('attack from a new player switches aggro and cancels a hit aimed at the old target',()=>{
 const mob=createSphericalMobs()[0];
 const first=character('first',mob.x,mob.z-1);
 const second=character('second',mob.x,mob.z-1);
 mob.aggroId=first.id;mob.attackAt=1800;mob.attackCooldownAt=0;
 mob.contributors.add(first.id);
 const attack=applySphereAttack([mob],second,'autoAttack',mob.id,1500,()=>.5);
 assert.equal(attack.ok,true);
 assert.equal(mob.aggroId,second.id);
 assert.equal(mob.attackAt,0,'old attack cannot land on the new aggro target');
 assert.ok(mob.contributors.has(first.id));
 assert.ok(mob.contributors.has(second.id));
 const players=new Map([[first.id,first],[second.id,second]]);
 let telegraphed=false;
 for(let i=0;i<18;i++){
  const now=2000+i*100;
  const events=tickSphericalMobs([mob],players,261,.1,now,()=>.5);
  if(events.some(e=>e.type==='mobTelegraph'&&e.targetId===second.id))telegraphed=true;
  assert.ok(events.every(e=>e.type!=='mobTelegraph'||e.targetId===second.id));
 }
 assert.equal(telegraphed,true,'new target receives the authoritative telegraph');
});

test('western bandits acquire independently, never as an entire pack',()=>{
 const specs=createSphericalMobs().filter(m=>m.family==='bandit');
 assert.equal(specs.length,4);
 for(const encounter of specs){
  const mobs=createSphericalMobs().filter(m=>m.family==='bandit');
  const player=character('solo',encounter.spawnX,encounter.spawnZ);
  const map=new Map([[player.id,player]]);
  tickSphericalMobs(mobs,map,261,.1,1000,()=>.5);
  assert.deepEqual(mobs.filter(m=>m.aggroId===player.id).map(m=>m.id),
   [encounter.id],'solo proximity pull at '+encounter.id+' must not wake other bandits');
 }
});
test('patrols stay apart and elite chief holds his separate position when idle',()=>{
 const mobs=createSphericalMobs().filter(m=>m.family==='bandit');
 const chief=mobs.find(m=>m.boss),x=chief.x,z=chief.z;
 const points=mobs.map(m=>({id:m.id,x:m.x,z:m.z}));
 const pairDistance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
 let patrolMoved=false;
 for(let i=0;i<250;i++){
  tickSphericalMobs(mobs,new Map(),261,.1,5000+i*100,()=>.6);
  for(const patrol of mobs.filter(m=>!m.boss)){
   const origin=points.find(p=>p.id===patrol.id);
   if(pairDistance(patrol,origin)>.8)patrolMoved=true;
  }
  for(let a=0;a<mobs.length;a++)for(let b=a+1;b<mobs.length;b++)
   assert.ok(pairDistance(mobs[a],mobs[b])>12,'independent encounter spacing '+mobs[a].id+'/'+mobs[b].id);
 }
 assert.ok(patrolMoved,'patrols continue to roam independently');
 assert.equal(chief.x,x);
 assert.equal(chief.z,z);
});


test('exclusive Battlefury kills in one verified melee hit, never for impostors',()=>{
 const mobs=createSphericalMobs(),mob=mobs[0];
 const owner=character('nexions');owner.characterId='ccfdf7dc-fdbf-4857-9d9f-5b8b0301fd98';owner.accountId='4aadebea-72c0-4987-839d-de5059a75f38';owner.equipment={weapon:{id:'adminBattlefury'}};
 const hit=applySphereAttack(mobs,owner,'autoAttack',mob.id,1000,()=>0);
 assert.equal(hit.ok,true);assert.equal(hit.events[0].damage,mob.maxHp);assert.equal(mob.phase,'corpse');
 const faker=character('impostor');faker.equipment={weapon:{id:'adminBattlefury'}};
 const alive=createSphericalMobs()[0];
 const hit2=applySphereAttack([alive],faker,'autoAttack',alive.id,1000,()=>0);
 assert.equal(hit2.ok,true);assert.ok(alive.hp>0);
});

test('disconnected tank transfers aggro to a living PvE contributor instead of resetting the fight',()=>{
 const mob=createSphericalMobs()[0],tank=character('tank'),ally=character('ally');
 mob.hp=mob.maxHp-9;mob.aggroId=tank.id;mob.contributors=new Set([tank.id,ally.id]);
 mob.attackAt=2300;mob.attackCooldownAt=2500;
 const players=new Map([[ally.id,ally]]);
 assert.equal(reassignSphereAggroOnLeave(mob,tank.id,players,261),true);
 assert.equal(mob.aggroId,ally.id);
 assert.equal(mob.hp,mob.maxHp-9,'existing group damage must be retained');
 assert.equal(mob.returning,false);
 assert.equal(mob.attackAt,0,'old windup aimed at disconnected tank is cancelled');
 assert.deepEqual([...mob.contributors],[ally.id]);
 mob.hp=1;
 const kill=applySphereAttack([mob],ally,'autoAttack',mob.id,4000,()=>.5);
 assert.equal(kill.ok,true);
 assert.deepEqual(kill.credits.map(c=>c.targetId),[ally.id],
  'disconnected tank must not receive a future reward');
});
test('disconnecting a non-aggro contributor clears their credit without resetting the mob',()=>{
 const mob=createSphericalMobs()[0],tank=character('tank'),ally=character('ally');
 mob.aggroId=tank.id;mob.contributors=new Set([tank.id,ally.id]);
 const hp=mob.hp;
 const players=new Map([[tank.id,tank]]);
 assert.equal(reassignSphereAggroOnLeave(mob,ally.id,players,261),false);
 assert.equal(mob.aggroId,tank.id);
 assert.equal(mob.hp,hp);
 assert.deepEqual([...mob.contributors],[tank.id]);
});
test('disconnected tank with no remaining contributor causes clean PvE evade',()=>{
 const mob=createSphericalMobs()[0],tank=character('tank');
 mob.aggroId=tank.id;mob.contributors.add(tank.id);
 assert.equal(reassignSphereAggroOnLeave(mob,tank.id,new Map(),261),false);
 assert.equal(mob.aggroId,null);
 assert.equal(mob.returning,true);
 assert.equal(mob.contributors.size,0);
});
