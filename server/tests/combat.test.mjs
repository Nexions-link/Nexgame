import test from 'node:test';
import assert from 'node:assert/strict';
import {
 createMulgoreMobs,tickMulgoreMobs,snapshotMulgoreMobs,
 applyMulgoreAbility,resetMulgoreMob,rollMulgoreLoot,sanitizeEquipment,MOB_CORPSE_MS
} from '../world-mobs.js';

const warrior=(id,x=-9,z=-23,level=1)=>({id,x,z,level,yaw:0,equipment:{},updatedAt:Date.now()});
const fixedRoll=()=>.5;

test('two warriors damage the very same HP pool and share kill credit',()=>{
 const mobs=createMulgoreMobs(),a=warrior('a'),b=warrior('b');
 const start=100000;
 const first=applyMulgoreAbility(mobs,a,'autoAttack',0,start,fixedRoll);
 const second=applyMulgoreAbility(mobs,b,'autoAttack',0,start+100,fixedRoll);
 assert.equal(first.ok,true);assert.equal(second.ok,true);
 assert.equal(mobs[0].hp,54-first.event.hits[0].amount-second.event.hits[0].amount);
 let killed=null;
 for(let wave=1;wave<15&&!killed;wave++){
  for(const [person,offset] of [[a,0],[b,100]]){
   const result=applyMulgoreAbility(mobs,person,'autoAttack',0,start+wave*2500+offset,fixedRoll);
   assert.equal(result.ok,true);
   if(result.deaths.length){killed=result.deaths[0];break}
  }
 }
 assert.ok(killed,'joint party should be able to finish one creature');
 assert.equal(mobs[0].hp,0);
 assert.deepEqual(killed.contributors.sort(),['a','b']);
 const snapshot=snapshotMulgoreMobs(mobs,start+50000);
 assert.equal(snapshot[0].dead,true);
 assert.equal(snapshot[0].hp,0);
 const repeat=applyMulgoreAbility(mobs,a,'autoAttack',0,start+55000,fixedRoll);
 assert.equal(repeat.ok,false,'cannot kill the same life twice');
});

test('server rejects spam, distant and backwards attacks',()=>{
 const mobs=createMulgoreMobs(),a=warrior('a');
 const t=100000;
 assert.equal(applyMulgoreAbility(mobs,a,'autoAttack',0,t,fixedRoll).ok,true);
 assert.equal(applyMulgoreAbility(mobs,a,'autoAttack',0,t+100,fixedRoll).ok,false);
 assert.equal(applyMulgoreAbility(mobs,a,'autoAttack',100,t+5000,fixedRoll).ok,false);
 a.x=25;a.z=25;
 assert.equal(applyMulgoreAbility(mobs,a,'autoAttack',0,t+5500,fixedRoll).ok,false);
 a.x=-9;a.z=-26;a.yaw=Math.PI; // Creature is behind the character.
 assert.equal(applyMulgoreAbility(mobs,a,'autoAttack',0,t+6500,fixedRoll).ok,false);
});

test('stomp hits multiple creatures at most once and respects cooldown',()=>{
 const mobs=createMulgoreMobs(),a=warrior('a',-5,-25);
 const t=100000;
 const first=applyMulgoreAbility(mobs,a,'thunderStomp',null,t,fixedRoll);
 assert.equal(first.ok,true);
 const unique=new Set(first.event.hits.map(h=>h.id));
 assert.equal(first.event.hits.length,unique.size);
 for(const hit of first.event.hits)assert.ok(hit.amount===6);
 assert.equal(applyMulgoreAbility(mobs,a,'thunderStomp',null,t+1,fixedRoll).ok,false);
 assert.equal(applyMulgoreAbility(mobs,a,'thunderStomp',null,t+8001,fixedRoll).ok,true);
});

test('mob chases its shared aggro target, strikes it and gives up after leash',()=>{
 const mobs=createMulgoreMobs(),a=warrior('a');
 const t=100000;
 assert.equal(applyMulgoreAbility(mobs,a,'autoAttack',0,t,fixedRoll).ok,true);
 a.z=-21;
 const attacks=tickMulgoreMobs(mobs,.1,[a],t+100);
 assert.equal(attacks.length,1);
 assert.equal(attacks[0].targetId,'a');
 assert.equal(attacks[0].amount,9);
 a.x=200;
 tickMulgoreMobs(mobs,.1,[a],t+200);
 assert.equal(mobs[0].aggroId,null);
 assert.equal(mobs[0].hp,mobs[0].maxHp);
});

test('dead creatures respawn once after the server timer, with a new life ID',()=>{
 const mobs=createMulgoreMobs(),a=warrior('a',-9,-23,60),t=100000;
 const hit=applyMulgoreAbility(mobs,a,'autoAttack',0,t,fixedRoll);
 assert.equal(hit.deaths.length,1);
 const id=mobs[0].life;
 tickMulgoreMobs(mobs,.1,[a],t+MOB_CORPSE_MS-1);
 assert.equal(mobs[0].life,id);
 tickMulgoreMobs(mobs,.1,[a],t+MOB_CORPSE_MS+1);
 assert.equal(mobs[0].life,id+1);
 assert.equal(mobs[0].hp,54);
 assert.equal(mobs[0].deadUntil,0);
});

test('equipment is whitelisted and rare loot stays inside the item catalog',()=>{
 assert.deepEqual(sanitizeEquipment({weapon:'wornAxe',chest:'chainVest',hat:'notARealItem'},1),{
  weapon:{id:'wornAxe',qty:1},chest:{id:'chainVest',qty:1}
 });
 assert.deepEqual(sanitizeEquipment({weapon:'scalpingStrength'},1),{});
 const loot=rollMulgoreLoot(true,()=>.9);
 assert.equal(loot[0].id,'giantFeather');
 assert.ok(loot.every(item=>item&&Number.isInteger(item.qty)&&item.qty>0));
});


test('server weapon cadence provides exact retry timing and autoattacks ignore global cooldown',()=>{
 const mobs=createMulgoreMobs(),a=warrior('cadence');
 a.equipment={weapon:{id:'wornAxe',qty:1}};
 const started=200000;
 const first=applyMulgoreAbility(mobs,a,'autoAttack',0,started,fixedRoll);
 assert.equal(first.ok,true);
 assert.equal(first.event.cooldownMs,2000);
 assert.equal(first.event.gcdMs,0);
 const early=applyMulgoreAbility(mobs,a,'autoAttack',0,started+1950,fixedRoll);
 assert.equal(early.ok,false);
 assert.equal(early.reason,'Способность восстанавливается');
 assert.equal(early.retryAfterMs,50);
 assert.equal(early.cooldownMs,50);
 assert.equal(early.gcdMs,0);
 const ready=applyMulgoreAbility(mobs,a,'autoAttack',0,started+2000,fixedRoll);
 assert.equal(ready.ok,true);
});
test('server and client share weapon speed after a live equipment swap',()=>{
 const mobs=createMulgoreMobs(),a=warrior('switch',-9,-23,3);
 a.equipment={weapon:{id:'letterOpener',qty:1}};
 const result=applyMulgoreAbility(mobs,a,'autoAttack',0,300000,fixedRoll);
 assert.equal(result.ok,true);
 assert.equal(result.event.cooldownMs,1700);
 assert.equal(applyMulgoreAbility(mobs,a,'autoAttack',0,301699,fixedRoll).retryAfterMs,1);
 a.equipment={weapon:{id:'wornAxe',qty:1}};
 const next=applyMulgoreAbility(mobs,a,'autoAttack',0,301700,fixedRoll);
 assert.equal(next.ok,true);
 assert.equal(next.event.cooldownMs,2000);
});
test('global GCD is 1.5 seconds for specials but never blocks regular autoattack',()=>{
 const mobs=createMulgoreMobs(),a=warrior('gcd',-9,-23,6);
 const t=400000;
 const special=applyMulgoreAbility(mobs,a,'heavyStrike',0,t,fixedRoll);
 assert.equal(special.ok,true);
 assert.equal(special.event.cooldownMs,3000);
 assert.equal(special.event.gcdMs,1500);
 const stomp=applyMulgoreAbility(mobs,a,'thunderStomp',null,t+100,fixedRoll);
 assert.equal(stomp.ok,false);
 assert.equal(stomp.gcdMs,1400);
 assert.equal(stomp.retryAfterMs,1400);
 assert.equal(applyMulgoreAbility(mobs,a,'autoAttack',0,t+101,fixedRoll).ok,true);
 assert.equal(applyMulgoreAbility(mobs,a,'thunderStomp',null,t+1500,fixedRoll).ok,true);
});
