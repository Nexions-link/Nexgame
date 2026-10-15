import test from 'node:test';
import assert from 'node:assert/strict';
import {
 MULGORE_MOB_SPAWNS,MOB_SPEED,MOB_AGGRO_LEASH_RANGE,MOB_SIGHT_RANGE,MOB_BOSS_SIGHT_RANGE,MOB_ATTACK_WINDUP_MS,createMulgoreMobs,tickMulgoreMobs,snapshotMulgoreMobs,releaseMulgoreAggroForPlayer,applyMulgoreAbility
} from '../world-mobs.js';

test('one consistent wildlife roster with stable IDs and boss coordinates',()=>{
 const mobs=createMulgoreMobs();
 assert.equal(mobs.length,9);
 assert.deepEqual(mobs.map(m=>m.id),[0,1,2,3,4,5,6,7,8]);
 assert.deepEqual([mobs[8].x,mobs[8].z],[39,47]);
 assert.equal(mobs.filter(m=>m.boss).length,1);
 mobs.forEach((mob,id)=>assert.deepEqual([mob.x,mob.z],MULGORE_MOB_SPAWNS[id]));
});
test('server movement is bounded, continuous and stays close to spawn',()=>{
 const mobs=createMulgoreMobs();
 for(let tick=0;tick<2000;tick++){
  const before=mobs.map(({x,z})=>({x,z}));
  tickMulgoreMobs(mobs,.1);
  mobs.forEach((m,i)=>{
   assert.ok(Math.hypot(m.x-before[i].x,m.z-before[i].z)<=MOB_SPEED*.1+1e-8);
   assert.ok(Math.hypot(m.x-m.spawnX,m.z-m.spawnZ)<6);
   assert.ok(Number.isFinite(m.yaw));
   assert.ok(Number.isFinite(m.phase));
  });
 }
});
test('snapshots are safe independent data objects',()=>{
 const mobs=createMulgoreMobs();
 const packet=snapshotMulgoreMobs(mobs);
 assert.equal(packet.length,9);
 assert.deepEqual(Object.keys(packet[0]),['id','x','z','yaw','phase','hp','maxHp','life','dead','aggroId','stunned','attackSeq','returning']);
 packet[0].x=999;
 assert.equal(mobs[0].x,-9);
});
test('invalid or absent simulation delta does not teleport mobs',()=>{
 const mobs=createMulgoreMobs();
 const before=snapshotMulgoreMobs(mobs);
 tickMulgoreMobs(mobs,-1);
 tickMulgoreMobs(mobs,NaN);
 tickMulgoreMobs(mobs,0);
 assert.deepEqual(snapshotMulgoreMobs(mobs),before);
});

test('death releases every mob attacking the dead player without resetting loot/HP',()=>{
 const mobs=createMulgoreMobs();
 for(const i of [0,1,8]){
  mobs[i].aggroId='fallen';
  mobs[i].attackAt=123456;
  mobs[i].hp=27;
  mobs[i].contributors.set('fallen',10);
 }
 mobs[2].aggroId='other';
 assert.equal(releaseMulgoreAggroForPlayer(mobs,'fallen'),3);
 for(const i of [0,1,8]){
  assert.equal(mobs[i].aggroId,null);
  assert.equal(mobs[i].attackAt,0);
  assert.equal(mobs[i].hp,27);
  assert.equal(mobs[i].contributors.get('fallen'),10);
 }
 assert.equal(mobs[2].aggroId,'other');
});
test('server immediately abandons attackers when player is dead or under respawn protection',()=>{
 const mobs=createMulgoreMobs(),now=100000;
 const player={id:'fallen',x:-9,z:-23,hp:0,respawnShieldUntil:0};
 mobs[0].aggroId='fallen';
 tickMulgoreMobs(mobs,.1,[player],now);
 assert.equal(mobs[0].aggroId,null);
 assert.equal(mobs[0].attackAt,0);
 assert.equal(mobs[0].hp,mobs[0].maxHp);
 mobs[0].aggroId='fallen';player.hp=100;player.respawnShieldUntil=now+3000;
 assert.deepEqual(tickMulgoreMobs(mobs,.1,[player],now+100),[]);
 assert.equal(mobs[0].aggroId,null);
});

test('aggro keeps striking a motionless player after 16 seconds without new damage',()=>{
 const mobs=createMulgoreMobs(),mob=mobs[0],now=100000;
 const player={id:'stationary',x:-9,z:-21,hp:100,respawnShieldUntil:0,level:1,yaw:Math.PI,equipment:{}};
 assert.equal(applyMulgoreAbility(mobs,player,'autoAttack',0,now,()=>.5).ok,true);
 const damagedHp=mob.hp;
 let strikes=0;
 for(let second=1;second<=45;second++){
  const attacks=tickMulgoreMobs(mobs,.1,[player],now+second*1000);
  strikes+=attacks.filter(event=>event.type==='mobAttack'&&event.targetId===player.id).length;
  assert.equal(mob.aggroId,player.id,'cannot drop aggro merely because time passes');
  assert.equal(mob.hp,damagedHp,'no regeneration while aggro is active');
 }
 assert.ok(strikes>=10,'standing still must not stop repeated mob attacks');
});

test('mob disengages after 23 m measured from original spawn, not the first hit',()=>{
 const mobs=createMulgoreMobs(),mob=mobs[0],now=200000;
 const player={id:'runner',x:-9,z:-21,hp:100,respawnShieldUntil:0,level:1,yaw:Math.PI,equipment:{}};
 assert.equal(MOB_AGGRO_LEASH_RANGE,23);
 assert.equal(applyMulgoreAbility(mobs,player,'autoAttack',0,now,()=>.5).ok,true);
 const damagedHp=mob.hp;
 player.z=-1; // 22 m from mob spawn (-9,-23).
 tickMulgoreMobs(mobs,.1,[player],now+100000);
 assert.equal(mob.aggroId,player.id,'time without retaliation must not clear aggro');
 assert.equal(mob.hp,damagedHp);
 player.z=0; // Exactly 23 m: aggro remains.
 tickMulgoreMobs(mobs,.1,[player],now+100100);
 assert.equal(mob.aggroId,player.id);
 player.z=.01; // Over 23 m: health restores and it disengages.
 tickMulgoreMobs(mobs,.1,[player],now+100200);
 assert.equal(mob.aggroId,null);
 assert.equal(mob.hp,mob.maxHp);
});

test('near-boundary aggro does not shift the fixed spawn-based limit',()=>{
 const mobs=createMulgoreMobs(),mob=mobs[0],now=300000;
 mob.z=-3; // Simulate a mob already running far from spawn.
 const player={id:'near-edge',x:-9,z:-3,hp:100,level:1,yaw:0,equipment:{}};
 assert.equal(applyMulgoreAbility(mobs,player,'autoAttack',0,now,()=>.5).ok,true);
 player.z=-.5; // Only 2.5 m from hit position, 22.5 m from spawn.
 tickMulgoreMobs(mobs,.1,[player],now+100);
 assert.equal(mob.aggroId,player.id);
 player.z=.1; // Just 3.1 m from hit position but 23.1 m from spawn.
 tickMulgoreMobs(mobs,.1,[player],now+200);
 assert.equal(mob.aggroId,null);
});

test('another attacker cannot extend the leash or restore combat timeout',()=>{
 const mobs=createMulgoreMobs(),mob=mobs[0],now=400000;
 const a={id:'a',x:-9,z:-23,hp:100,level:1,yaw:0,equipment:{}};
 const b={id:'b',x:-9,z:-21,hp:100,level:1,yaw:Math.PI,equipment:{}};
 assert.equal(applyMulgoreAbility(mobs,a,'autoAttack',0,now,()=>.5).ok,true);
 assert.equal(applyMulgoreAbility(mobs,b,'autoAttack',0,now+1000,()=>.5).ok,true);
 assert.equal(mob.aggroId,b.id);
 b.z=-.2; // 22.8 m from spawn.
 tickMulgoreMobs(mobs,.1,[a,b],now+30000);
 assert.equal(mob.aggroId,b.id);
 a.hp=0; // No other living player should immediately take over aggro.
 b.z=.1; // 23.1 m from spawn.
 tickMulgoreMobs(mobs,.1,[a,b],now+30100);
 assert.equal(mob.aggroId,null);
});

test('respawn aggro release preserves damaged HP and contributors',()=>{
 const mobs=createMulgoreMobs(),mob=mobs[0],now=500000;
 const player={id:'respawn',x:-9,z:-22,hp:100,level:1,yaw:Math.PI,equipment:{}};
 assert.equal(applyMulgoreAbility(mobs,player,'autoAttack',0,now,()=>.5).ok,true);
 const damagedHp=mob.hp;
 assert.equal(releaseMulgoreAggroForPlayer(mobs,player.id),1);
 assert.equal(mob.aggroId,null);
 assert.equal(mob.hp,damagedHp);
 assert.equal(mob.contributors.has(player.id),true);
});

test('wild creatures notice players on sight without the player attacking first',()=>{
 const mobs=createMulgoreMobs(),now=120000;
 const player={id:'visitor',x:-9,z:-23+MOB_SIGHT_RANGE-.25,hp:100};
 const first=tickMulgoreMobs(mobs,.1,[player],now);
 assert.equal(first.length,0,'sighting should not deal instant damage');
 assert.equal(mobs[0].aggroId,player.id);
 assert.equal(mobs[0].hp,mobs[0].maxHp,'detection does not hurt the monster');
 assert.equal(MOB_BOSS_SIGHT_RANGE,9);
});

test('telegraphed peck is visible before the hit and can be dodged',()=>{
 const mobs=createMulgoreMobs(),mob=mobs[0],now=220000;
 const player={id:'bait',x:-9,z:-22,hp:100};
 tickMulgoreMobs(mobs,.1,[player],now);
 const start=tickMulgoreMobs(mobs,.1,[player],now+300);
 assert.deepEqual(start,[]);
 assert.equal(mob.attackSeq,1,'Peck animation started via sequence');
 assert.equal(mob.windupUntil,now+300+MOB_ATTACK_WINDUP_MS);
 assert.equal(tickMulgoreMobs(mobs,.1,[player],now+500).length,0);
 player.z=-17;
 assert.equal(tickMulgoreMobs(mobs,.1,[player],now+800).length,0,'moving away dodges impact');
 assert.equal(mob.windupUntil,0);
 player.z=-22;
 tickMulgoreMobs(mobs,.1,[player],now+1800);
 assert.equal(mob.attackSeq,2,'another windup can start after miss');
 assert.equal(tickMulgoreMobs(mobs,.1,[player],now+2300).filter(x=>x.type==='mobAttack').length,1);
});

test('a monster breaks off past spawn leash and actively goes home',()=>{
 const mobs=createMulgoreMobs(),mob=mobs[0],now=320000;
 const player={id:'runner',x:-9,z:-22,hp:100};
 tickMulgoreMobs(mobs,.1,[player],now);
 mob.x=-9;mob.z=-11;
 player.z=1; // 24m from spawn.
 tickMulgoreMobs(mobs,.1,[player],now+100);
 assert.equal(mob.aggroId,null);
 assert.equal(mob.returning,true);
 const before=Math.hypot(mob.x-mob.spawnX,mob.z-mob.spawnZ);
 for(let t=2;t<=20;t++)tickMulgoreMobs(mobs,.1,[player],now+t*100);
 assert.ok(Math.hypot(mob.x-mob.spawnX,mob.z-mob.spawnZ)<before);
});
