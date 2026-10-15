import test from 'node:test';
import assert from 'node:assert/strict';
import {
 MULGORE_MOB_SPAWNS,MOB_SPEED,MOB_AGGRO_LEASH_RANGE,createMulgoreMobs,tickMulgoreMobs,snapshotMulgoreMobs,releaseMulgoreAggroForPlayer,applyMulgoreAbility
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
 assert.deepEqual(Object.keys(packet[0]),['id','x','z','yaw','phase','hp','maxHp','life','dead','aggroId','stunned']);
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
 assert.deepEqual([mob.aggroStartX,mob.aggroStartZ],[-9,-21]);
});

test('50 m leash is strictly measured from first aggro, not spawn, mob or last hit',()=>{
 const mobs=createMulgoreMobs(),mob=mobs[0],now=200000;
 const player={id:'runner',x:-9,z:-21,hp:100,respawnShieldUntil:0,level:1,yaw:Math.PI,equipment:{}};
 assert.equal(MOB_AGGRO_LEASH_RANGE,50);
 assert.equal(applyMulgoreAbility(mobs,player,'autoAttack',0,now,()=>.5).ok,true);
 const lowHp=mob.hp;
 player.z=-21+49.9; // Farther than the old 19/23 m limit; still inside 50 m.
 tickMulgoreMobs(mobs,.1,[player],now+100000);
 assert.equal(mob.aggroId,player.id);
 assert.equal(mob.hp,lowHp);
 assert.deepEqual([mob.aggroStartX,mob.aggroStartZ],[-9,-21]);
 player.z=-21+50.01;
 tickMulgoreMobs(mobs,.1,[player],now+100100);
 assert.equal(mob.aggroId,null);
 assert.equal(mob.hp,mob.maxHp);
 assert.equal(mob.aggroStartX,null);
 assert.equal(mob.aggroStartZ,null);
 // After disengaging, the mob heads home rather than pursuing the old target.
 const oldDistance=Math.hypot(mob.x-mob.spawnX,mob.z-mob.spawnZ);
 for(let i=0;i<40;i++)tickMulgoreMobs(mobs,.1,[],now+100200+i*100);
 assert.ok(Math.hypot(mob.x-mob.spawnX,mob.z-mob.spawnZ)<Math.max(6,oldDistance));
});

test('additional hits and a new attacker cannot move an existing leash origin',()=>{
 const mobs=createMulgoreMobs(),mob=mobs[0],now=300000;
 const a={id:'first',x:-9,z:-23,hp:100,level:1,yaw:0,equipment:{}};
 const b={id:'second',x:-9,z:-21,hp:100,level:1,yaw:Math.PI,equipment:{}};
 assert.equal(applyMulgoreAbility(mobs,a,'autoAttack',0,now,()=>.5).ok,true);
 assert.equal(applyMulgoreAbility(mobs,b,'autoAttack',0,now+1000,()=>.5).ok,true);
 assert.equal(mob.aggroId,b.id);
 assert.deepEqual([mob.aggroStartX,mob.aggroStartZ],[-9,-23]);
 b.z=-23+49;
 tickMulgoreMobs(mobs,.1,[a,b],now+30000);
 assert.equal(mob.aggroId,b.id);
 b.z=-23+50.1;
 tickMulgoreMobs(mobs,.1,[a,b],now+30100);
 assert.equal(mob.aggroId,null);
});

test('dropping aggro for a respawned player clears the old leash origin',()=>{
 const mobs=createMulgoreMobs(),mob=mobs[0],now=400000;
 const player={id:'respawn',x:-9,z:-22,hp:100,level:1,yaw:Math.PI,equipment:{}};
 applyMulgoreAbility(mobs,player,'autoAttack',0,now,()=>.5);
 assert.equal(releaseMulgoreAggroForPlayer(mobs,player.id),1);
 assert.equal(mob.aggroId,null);
 assert.equal(mob.aggroStartX,null);
 assert.equal(mob.aggroStartZ,null);
});
