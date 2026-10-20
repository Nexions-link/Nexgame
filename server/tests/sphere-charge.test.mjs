import test from 'node:test';
import assert from 'node:assert/strict';
import {getClassAbilities,getAbilityDefinition} from '../../skills.js';
import {normalizeHotbar} from '../../hotbar.js';
import {createSphericalMobs,localToNormal,arcDistance,applySphereAttack} from '../spherical-pve.js';
import {applySphereCharge,CHARGE_DURATION_MS} from '../sphere-charge.js';
const character=(level=8,x=-9,z=-24)=>({id:'hero',level,normal:localToNormal(x,z,261),radius:261,
 heading:Math.PI/2,hp:180,maxHp:180,resource:0,equipment:{weapon:{id:'wornAxe'}},abilityCooldowns:{}});
test('charge is unlocked at level 8 and assignable to hotbar',()=>{
 const def=getAbilityDefinition('charge');
 assert.equal(def.level,8);assert.equal(def.range,30);assert.equal(def.cooldown,15);
 assert.equal(getClassAbilities('warrior',7).some(a=>a.id==='charge'),false);
 assert.equal(getClassAbilities('warrior',8).some(a=>a.id==='charge'),true);
 assert.equal(normalizeHotbar([{kind:'ability',id:'charge'}],'warrior',7)[0],null);
 assert.deepEqual(normalizeHotbar([{kind:'ability',id:'charge'}],'warrior',8)[0],{kind:'ability',id:'charge'});
});
test('charge moves to melee and first validated auto-hit adds exactly 20 rage',()=>{
 const mobs=createSphericalMobs(),mob=mobs[0],p=character();
 const now=10000,initial=arcDistance(p.normal,localToNormal(mob.x,mob.z,261),261);
 const result=applySphereCharge(mobs,p,mob.id,now);
 assert.equal(result.ok,true,result.reason);
 assert.equal(result.durationMs,CHARGE_DURATION_MS);
 assert.ok(arcDistance(p.normal,localToNormal(mob.x,mob.z,261),261)<3.45);
 assert.ok(initial>=arcDistance(p.normal,localToNormal(mob.x,mob.z,261),261));
 const hit=applySphereAttack(mobs,p,'autoAttack',mob.id,now+600,()=>.2);
 assert.equal(hit.ok,true,hit.reason);
 assert.equal(p.resource,32,'normal 12 plus charge bonus 20');
 assert.equal(p.chargeBonus,null,'bonus applied only once');
 assert.equal(applySphereCharge(mobs,p,mob.id,now+700).ok,false,'cooldown prevents duplicate dash');
 const next=applySphereAttack(mobs,p,'autoAttack',mob.id,now+2900,()=>.2);
 assert.equal(next.ok,true,next.reason);
 assert.equal(p.resource,44,'second strike awards only baseline rage');
});
test('low level, missing target and excessive distance are rejected without relocating',()=>{
 const mobs=createSphericalMobs(),mob=mobs[0],low=character(7),start=[...low.normal];
 assert.equal(applySphereCharge(mobs,low,mob.id,10000).ok,false);
 assert.deepEqual(low.normal,start);
 assert.equal(low.abilityCooldowns.charge,undefined);
 const far=character(8,70,65),where=[...far.normal];
 assert.equal(applySphereCharge(mobs,far,mob.id,10000).ok,false);
 assert.deepEqual(far.normal,where);
 assert.equal(applySphereCharge(mobs,character(), 'not-a-mob',10000).ok,false);
});
test('charge bonus expires and never fires on a late strike',()=>{
 const mobs=createSphericalMobs(),p=character(),mob=mobs[0];
 assert.equal(applySphereCharge(mobs,p,mob.id,10000).ok,true);
 p.chargeBonus.expiresAt=10500;
 const hit=applySphereAttack(mobs,p,'autoAttack',mob.id,10800,()=>.2);
 assert.equal(hit.ok,true);
 assert.equal(p.resource,12);
});
