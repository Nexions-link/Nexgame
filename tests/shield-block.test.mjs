import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SHIELD_BLOCK_SECONDS,shieldBlockStrength,shieldBlockPose} from '../shield-block.js';
const read=path=>readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)),'utf8');

test('block rises quickly, braces for impact and fully recovers to the tuned grip',()=>{
 assert.ok(SHIELD_BLOCK_SECONDS>=.35&&SHIELD_BLOCK_SECONDS<=.6);
 for(const t of [-2,-.1,0,NaN,Infinity]){
  assert.equal(shieldBlockStrength(t),0);
  assert.deepEqual(shieldBlockPose(t),shieldBlockPose(0));
 }
 assert.equal(shieldBlockStrength(SHIELD_BLOCK_SECONDS),0,'first frame keeps rest pose');
 const rising=shieldBlockStrength(SHIELD_BLOCK_SECONDS*.87);
 const braced=shieldBlockStrength(SHIELD_BLOCK_SECONDS*.67);
 const recovery=shieldBlockStrength(SHIELD_BLOCK_SECONDS*.15);
 assert.ok(rising>.4,'raise shield promptly');
 assert.ok(braced>.99,'shield clearly covers the torso');
 assert.ok(recovery<braced,'shield comes back down');
 assert.equal(shieldBlockPose(0).wristX,0);
 assert.ok(Math.abs(shieldBlockPose(SHIELD_BLOCK_SECONDS).shoulderX)<1e-9);
});

test('blocking puts the left shoulder and forearm in front without moving right hand',()=>{
 const pose=shieldBlockPose(SHIELD_BLOCK_SECONDS*.66);
 assert.ok(pose.shoulderX<-.9);
 assert.ok(pose.shoulderZ>.55);
 assert.ok(pose.elbowX<-.36);
 assert.ok(pose.wristX>0);
 assert.ok(pose.chestX<0&&pose.chestY<0);
 const g=read('game.js');
 assert.match(g,/if\(i===0&&block\.power>0\)/);
 assert.match(g,/arm\.shoulder\.rotation\.x\+=block\.shoulderX/);
 assert.match(g,/arm\.shoulder\.rotation\.z\+=block\.shoulderZ/);
 assert.match(g,/arm\.elbow\.rotation\.x\+=block\.elbowX/);
 assert.match(g,/applyShieldWristPose\(actor,arm\.hand\.rotation\.x\+block\.wristX\)/);
 assert.match(g,/const shieldVisible=actor\.arms\[0\]\?\.hand\.getObjectByName\('gear-shield'\)\?\.visible===true/);
});

test('only genuine blocked mob damage starts animation in solo or multiplayer',()=>{
 const g=read('game.js');
 const start=g.indexOf('function incomingDamage('),end=g.indexOf('function finishEquipmentChange(',start);
 assert.ok(start>0&&end>start);
 const block=g.slice(start,end);
 assert.match(block,/const blocked=stats\.blockChance>0&&inFront&&rng\(\)<stats\.blockChance/);
 assert.match(block,/const damage=Math\.max\(blocked\?0:1,Math\.round\(raw\*/);
 assert.match(block,/if\(blocked\)\{\s*hero\.blockRemaining=SHIELD_BLOCK_SECONDS/);
 assert.equal((g.match(/hero\.blockRemaining=SHIELD_BLOCK_SECONDS/g)||[]).length,1);
 assert.match(g,/const suffered=incomingDamage\(enemy,amount\)/,'network hits use same block rule');
 assert.match(g,/const suffered=incomingDamage\(e,e\.boss\?14:9\)/,'solo hits use same rule');
 assert.match(g,/hero\.blockRemaining=Math\.max\(0,\(hero\.blockRemaining\|\|0\)-Math\.max\(0,dt\)\)/);
 assert.match(g,/function resetWorld\(\)\{\s*hero\.blockRemaining=0/);
 assert.match(g,/function revive\(\)\{hero\.blockRemaining=0/);
});

test('block does not change validated shield pose, weapon tuning or hit damage',()=>{
 const g=read('game.js');
 assert.match(g,/function applyShieldTransform\(root,kind\)/);
 assert.match(g,/mount\.rotation\.set\(radians\(p\.shieldX\),radians\(p\.shieldY\),radians\(p\.shieldZ\),'YXZ'\)/);
 assert.match(read('shield-tuner.js'),/shieldY:-140/);
 assert.match(read('shield-tuner.js'),/shieldX:-16,shieldY:-160,shieldZ:-180/);
 assert.match(read('axe-tuner.js'),/axeX:-165,axeY:-1,axeZ:-101/);
 assert.match(read('sword-tuner.js'),/swordX:-8,swordY:-169,swordZ:-101/);
 assert.match(read('dagger-tuner.js'),/daggerX:-3,daggerY:-180,daggerZ:-60/);
});
