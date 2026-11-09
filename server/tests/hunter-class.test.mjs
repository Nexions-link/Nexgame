import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCharacterOptions} from '../account-rules.js';
import {createSphericalMobs,applySphereAttack,localToNormal,facesMob,tickSphericalMobs,SPHERE_LEASH_METRES} from '../spherical-pve.js';
import {applySphereCharge} from '../sphere-charge.js';
import {defaultHotbarForClass,normalizeHotbar} from '../../hotbar.js';
import {setActionBarSlot} from '../progress-rules.js';
const setup=()=>{const mobs=createSphericalMobs(),m=mobs[0];const player={id:'hunter',classId:'hunter',raceId:'orc',radius:261,normal:localToNormal(m.x,m.z-12,261),heading:Math.PI/2,hp:120,maxHp:120,level:1,resource:100,equipment:{weapon:{id:'wornBow'}},abilityCooldowns:{},moving:false};assert.ok(facesMob(player,m,261));return {mobs,m,player};};
test('all four race/class combinations are allowed, injected identities rejected',()=>{
 for(const raceId of ['hornfolk','orc'])for(const classId of ['warrior','hunter'])assert.deepEqual(validateCharacterOptions({nickname:'Следопыт',raceId,classId}),{nickname:'Следопыт',raceId,classId,appearance:{}});
 assert.throws(()=>validateCharacterOptions({nickname:'Следопыт',raceId:'elf'}));
 assert.throws(()=>validateCharacterOptions({nickname:'Следопыт',classId:'hunter',level:60}));
});
test('hunter hits at range, spends mana once, preserves cooldown and blocks warrior abilities',()=>{
 const {mobs,m,player}=setup();const result=applySphereAttack(mobs,player,'arcaneShot',m.id,10000,()=>.5);
 assert.equal(result.ok,true);assert.ok(m.hp<m.maxHp);assert.equal(player.resource,85);
 assert.equal(applySphereAttack(mobs,player,'arcaneShot',m.id,10001).ok,false);assert.equal(player.resource,85);
 assert.equal(applySphereAttack(mobs,player,'thunderStomp',m.id,20000).ok,false);
 player.level=10;assert.equal(applySphereCharge(mobs,player,m.id,20000).ok,false);
});
test('stationary, mana, level, bow and range gates cannot be bypassed',()=>{
 const {mobs,m,player}=setup();player.moving=true;
 assert.equal(applySphereAttack(mobs,player,'autoShot',m.id,10000).ok,false);player.moving=false;
 assert.equal(applySphereAttack(mobs,player,'multiShot',m.id,10000).ok,false);
 player.resource=0;assert.equal(applySphereAttack(mobs,player,'arcaneShot',m.id,10000).ok,false);
 player.resource=100;player.equipment={};assert.equal(applySphereAttack(mobs,player,'autoShot',m.id,10000).ok,false);
 player.equipment={weapon:{id:'wornBow'}};player.normal=localToNormal(m.x,m.z-40,261);assert.equal(applySphereAttack(mobs,player,'autoShot',m.id,10000).ok,false);
});
test('concussive shot has a bounded slow; warrior cannot send hunter packets',()=>{
 const {mobs,m,player}=setup();assert.equal(applySphereAttack(mobs,player,'concussiveShot',m.id,10000).ok,true);assert.equal(m.slowUntil,14000);
 player.classId='warrior';assert.equal(applySphereAttack(mobs,player,'autoShot',m.id,20000).ok,false);
});
test('hunter hotbar survives server validation and cannot contain warrior spells',()=>{
 const state={classId:'hunter',level:4,actionBar:[]};
 const next=setActionBarSlot(state,4,{kind:'ability',id:'multiShot'});
 assert.equal(next.actionBar[0].id,'autoShot');assert.equal(next.actionBar[4].id,'multiShot');
 assert.throws(()=>setActionBarSlot(state,0,{kind:'ability',id:'heavyStrike'}));
 assert.deepEqual(normalizeHotbar(defaultHotbarForClass('hunter'),'hunter',1),defaultHotbarForClass('hunter'));
});

test('ranged hunter pull keeps aggro and damaged health while mob pursues beyond old leash',()=>{
 const {mobs,m,player}=setup();
 player.normal=localToNormal(m.x,m.z-29,261);
 assert.ok(facesMob(player,m,261));
 const shot=applySphereAttack(mobs,player,'arcaneShot',m.id,10000,()=>.5);
 assert.equal(shot.ok,true);
 assert.ok(SPHERE_LEASH_METRES>35);
 const damaged=m.hp;
 const players=new Map([[player.id,{...player,joined:true,respawnShieldUntil:0}]]);
 for(let time=10100;time<=14000;time+=100){
  tickSphericalMobs(mobs,players,261,.1,time,()=>.5);
  assert.equal(m.aggroId,player.id,'aggro must persist for a distant ranged pull');
  assert.equal(m.returning,false,'mob must not evade while its target remains in leash');
  assert.equal(m.hp,damaged,'health must not regenerate during pursuit');
 }
});
test('far beyond combat leash creature evades instead of pursuing forever',()=>{
 const {mobs,m,player}=setup();
 assert.equal(applySphereAttack(mobs,player,'arcaneShot',m.id,10000,()=>.5).ok,true);
 // A creature already standing on its home point completes evade immediately.
 // Move it a little from spawn to verify the return phase persists.
 m.x=m.spawnX+2;
 player.normal=localToNormal(m.spawnX,m.spawnZ-(SPHERE_LEASH_METRES+10),261);
 tickSphericalMobs(mobs,new Map([[player.id,{...player,joined:true,respawnShieldUntil:0}]]),261,.1,10100,()=>.5);
 assert.equal(m.aggroId,null);
 assert.equal(m.returning,true);
});
