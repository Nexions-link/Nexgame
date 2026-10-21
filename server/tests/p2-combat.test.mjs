import test from 'node:test';
import assert from 'node:assert/strict';
import {applySphereAttack,createSphericalMobs,localToNormal,sphericalMobYaw,tickSphericalMobs} from '../spherical-pve.js';
import {applySphereCharge,CHARGE_DURATION_MS} from '../sphere-charge.js';

const hero=(id,x=-9,z=-24,level=1)=>({
 id,joined:true,level,radius:261,normal:localToNormal(x,z,261),
 heading:Math.PI/2,hp:180,maxHp:180,resource:50,
 equipment:{weapon:{id:'wornAxe'}},abilityCooldowns:{}
});

test('P2.1 stable threat avoids ping-pong then changes to stronger attacker',()=>{
 const mob=createSphericalMobs()[0],tank=hero('tank'),ally=hero('ally');
 const hit=(player,now)=>applySphereAttack([mob],player,'autoAttack',mob.id,now,()=>.5);
 assert.equal(hit(tank,1000).ok,true);
 assert.equal(hit(ally,1000).ok,true);
 assert.equal(mob.aggroId,'tank');
 mob.attackAt=2200;
 assert.equal(hit(ally,4000).ok,true);
 assert.equal(mob.aggroId,'ally');
 assert.equal(mob.attackAt,0);
});

test('P2.1 dead tank transfers to nearby contributor without healing',()=>{
 const mob=createSphericalMobs()[0],tank=hero('tank'),ally=hero('ally');
 tank.hp=0;mob.hp-=11;mob.aggroId=tank.id;
 mob.contributors=new Set([tank.id,ally.id]);
 mob.threat=new Map([[tank.id,15],[ally.id,9]]);
 mob.attackAt=2100;
 tickSphericalMobs([mob],new Map([[tank.id,tank],[ally.id,ally]]),261,.1,2000,()=>.5);
 assert.equal(mob.aggroId,ally.id);
 assert.equal(mob.hp,mob.maxHp-11);
 assert.equal(mob.returning,false);
 assert.equal(mob.contributors.has(tank.id),false);
 assert.equal(mob.threat.has(tank.id),false);
 assert.notEqual(mob.attackAt,2100);
});

test('P2.1 stomp interrupts winding attack and stuns elite for less time',()=>{
 const mob=createSphericalMobs().find(m=>m.id==='dolgonog-9');
 const player=hero('hero',mob.x,mob.z,9);
 mob.aggroId='hero';mob.attackAt=1500;
 const result=applySphereAttack([mob],player,'thunderStomp',mob.id,1000,()=>.5);
 assert.equal(result.ok,true);
 assert.equal(result.events[0].damage,10);
 assert.equal(mob.attackAt,0);
 assert.equal(mob.stunUntil,2000);
 const regular=createSphericalMobs()[0],near=hero('regular',regular.x,regular.z);
 assert.equal(applySphereAttack([regular],near,'thunderStomp',regular.id,1000,()=>.5).ok,true);
 assert.equal(regular.stunUntil,3500);
});

test('P2.1 charge forbids melee before landing, first hit still grants 20 rage',()=>{
 const mobs=createSphericalMobs(),mob=mobs[0],player=hero('charger',-9,-24,8);
 player.resource=0;
 const charged=applySphereCharge(mobs,player,mob.id,1000);
 assert.equal(charged.ok,true,charged.reason);
 const hp=mob.hp;
 assert.equal(applySphereAttack(mobs,player,'autoAttack',mob.id,1100,()=>.5).ok,false);
 assert.equal(mob.hp,hp);
 assert.equal(applySphereAttack(mobs,player,'autoAttack',mob.id,1000+CHARGE_DURATION_MS+50,()=>.5).ok,true);
 assert.equal(player.resource,20);
});

test('P2.1 mob hit emits private damage and public visual without HP',()=>{
 const mob=createSphericalMobs()[0],target=hero('target',mob.x,mob.z+1);
 mob.aggroId=target.id;mob.attackAt=1100;
 mob.yaw=sphericalMobYaw(mob.x,mob.z,0,1,261);
 const events=tickSphericalMobs([mob],new Map([[target.id,target]]),261,.1,1200,()=>.99);
 const real=events.filter(e=>e.type==='mobAttack'),visual=events.filter(e=>e.type==='mobStrike');
 assert.equal(real.length,1);assert.equal(visual.length,1);
 assert.equal(real[0].life,mob.life);assert.equal(visual[0].life,mob.life);
 assert.equal(visual[0].targetId,target.id);
 assert.equal('hp' in visual[0],false);
 assert.equal('damage' in visual[0],false);
});
