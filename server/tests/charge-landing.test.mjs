import test from 'node:test';
import assert from 'node:assert/strict';
import {createSphericalMobs,localDistance,localToNormal,applySphereAttack} from '../spherical-pve.js';
import {applySphereCharge,completeSphereCharge,CHARGE_DURATION_MS} from '../sphere-charge.js';
import {createSphericalWorld} from '../spherical-world.js';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const hero=()=>({
 id:'charger',joined:true,level:8,radius:261,
 normal:localToNormal(-9,-24,261),heading:Math.PI/2,
 hp:180,maxHp:180,resource:0,equipment:{weapon:{id:'wornAxe'}},
 abilityCooldowns:{}
});
test('server settles charge at landing without an extra client autoattack packet',()=>{
 const mobs=createSphericalMobs(),mob=mobs[0],p=hero(),now=10000;
 const start=applySphereCharge(mobs,p,mob.id,now);
 assert.equal(start.ok,true,start.reason);
 const hp=mob.hp;
 assert.equal(completeSphereCharge(mobs,p,now+CHARGE_DURATION_MS-1,()=>.2).ok,false);
 assert.equal(mob.hp,hp);
 const result=completeSphereCharge(mobs,p,now+CHARGE_DURATION_MS+20,()=>.2);
 assert.equal(result.ok,true,result.reason);
 assert.equal(result.events.length,1);
 assert.equal(result.events[0].chargeImpact,true);
 assert.ok(result.events[0].damage>0);
 assert.equal(p.resource,20,'the first validated charge hit awards 20, not 12');
 assert.equal(p.chargeBonus,null);
 assert.equal(p.chargeImpact,null);
 assert.equal(completeSphereCharge(mobs,p,now+1000,()=>.2).ok,false,'one charge produces only one hit');
});
test('enemy stepping sideways during dash is reacquired safely and hit at landing',()=>{
 const mobs=createSphericalMobs(),mob=mobs[0],p=hero();
 assert.equal(applySphereCharge(mobs,p,mob.id,10000).ok,true);
 mob.x+=1.05;mob.z+=.35;
 const result=completeSphereCharge(mobs,p,10600,()=>.5);
 assert.equal(result.ok,true,result.reason);
 assert.ok(localDistance(mob,p,261)<3.45);
 assert.equal(p.resource,20);
 assert.ok(result.normal.every(Number.isFinite));
});
test('charge landing bypasses GCD and previous auto swing but keeps next cooldown',()=>{
 const mobs=createSphericalMobs(),mob=mobs[0],p=hero();
 p.abilityCooldowns.autoAttack=13000;
 assert.equal(applySphereCharge(mobs,p,mob.id,10000).ok,true);
 assert.equal(p.abilityCooldowns.gcd,11500);
 const result=completeSphereCharge(mobs,p,10580,()=>.5);
 assert.equal(result.ok,true,result.reason);
 assert.equal(p.resource,20);
 assert.ok(p.abilityCooldowns.autoAttack>10580);
 assert.equal(p.abilityCooldowns.gcd,11500,'landing does not reset existing global cooldown');
});
test('dead, respawned or escaped enemy never receives a stale phantom charge hit',()=>{
 for(const mode of ['dead','respawn','escaped']){
  const mobs=createSphericalMobs(),mob=mobs[0],p=hero();
  assert.equal(applySphereCharge(mobs,p,mob.id,10000).ok,true);
  if(mode==='dead'){mob.phase='corpse';mob.hp=0}
  if(mode==='respawn')mob.life+=1;
  if(mode==='escaped')mob.x+=9;
  const hp=mob.hp,position=[...p.normal];
  const result=completeSphereCharge(mobs,p,10600,()=>.5);
  assert.equal(result.ok,false,mode);
  assert.equal(mob.hp,hp);
  assert.equal(p.resource,0);
  assert.equal(p.chargeImpact,null);
  assert.deepEqual(p.normal,position,'a stale charge cannot teleport toward its old target');
 }
});
test('a manual first hit racing the server tick consumes the pending impact once',()=>{
 const mobs=createSphericalMobs(),mob=mobs[0],p=hero();
 assert.equal(applySphereCharge(mobs,p,mob.id,10000).ok,true);
 const manual=applySphereAttack(mobs,p,'autoAttack',mob.id,10580,()=>.5);
 assert.equal(manual.ok,true,manual.reason);
 assert.equal(p.resource,20);
 assert.equal(p.chargeImpact,null);
 const hp=mob.hp;
 assert.equal(completeSphereCharge(mobs,p,10600).ok,false);
 assert.equal(mob.hp,hp);
});
test('world server tick (without WebSocket player attack) produces exactly one strike',()=>{
 const world=createSphericalWorld();
 try {
  const mobs=world.rooms.get(261).mobs,p=hero(),mob=mobs[0];
  world.players.set(p.id,p);
  assert.equal(applySphereCharge(mobs,p,mob.id,10000).ok,true);
  const before=mob.hp;
  world.tickOnce(.1,10000+CHARGE_DURATION_MS+50);
  assert.ok(mob.hp<before,'server tick lands the pending strike');
  assert.equal(p.resource,20);
  assert.equal(p.chargeImpact,null);
  const after=mob.hp;
  world.tickOnce(.1,10000+CHARGE_DURATION_MS+150);
  assert.equal(mob.hp,after,'following ticks do not replay the impact');
 }finally{world.close()}
});
test('charge emits private vitals and a server-confirmed visual combat marker',()=>{
 const text=readFileSync(new URL('../spherical-world.js',import.meta.url),'utf8');
 assert.match(text,/completeSphereCharge\(room\.mobs,p,now\)/);
 assert.match(text,/type:'playerVitals',hp:p\.hp,maxHp:p\.maxHp,resource:p\.resource/);
 assert.match(text,/type:'chargeLanded'/);
});
