import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createAutoSwingClock,reconcileAbilityCooldown,MELEE_IMPACT_MS,AUTO_SWING_SAFETY_MS} from '../combat-timing.js';
const source=p=>readFileSync(fileURLToPath(new URL('../'+p,import.meta.url)),'utf8');

test('autoattack waits for the server acknowledgement and the next impact window',()=>{
 let t=0;
 const sync=createAutoSwingClock(()=>t);
 assert.equal(MELEE_IMPACT_MS,340);
 assert.equal(sync.canStart(),true);
 t=340;sync.onSent();assert.equal(sync.awaiting,true);
 t=460;assert.equal(sync.canStart(),false);
 sync.onAccepted(2000);
 assert.equal(sync.awaiting,false);
 assert.equal(sync.canStart(),false);
 const ready=460+2000-MELEE_IMPACT_MS+AUTO_SWING_SAFETY_MS;
 t=ready-1;assert.equal(sync.canStart(),false);
 t=ready;assert.equal(sync.canStart(),true);
});
test('cooldown rejection delays the swing rather than allowing infinite empty animations',()=>{
 let now=400;
 const sync=createAutoSwingClock(()=>now);
 sync.onSent();now+=60;sync.onRejected(750);
 assert.equal(sync.awaiting,false);
 assert.equal(sync.canStart(),false);
 now+=Math.max(0,750-MELEE_IMPACT_MS)+AUTO_SWING_SAFETY_MS;
 assert.equal(sync.canStart(),true);
});
test('lost packets recover after an acknowledgement timeout and can reset after disconnect',()=>{
 let now=1000;const c=createAutoSwingClock(()=>now);
 c.onSent();now=4499;assert.equal(c.canStart(),false);
 now=4500;assert.equal(c.canStart(),true);
 c.onSent();c.reset();assert.equal(c.canStart(),true);
});
test('global cooldown is reconciled separately and autoattacks never consume it',()=>{
 const runtime={gcd:.5,cooldowns:{heavyStrike:1}};
 reconcileAbilityCooldown(runtime,'heavyStrike',3000,1500);
 assert.equal(runtime.cooldowns.heavyStrike,3);
 assert.equal(runtime.gcd,1.5);
 reconcileAbilityCooldown(runtime,'autoAttack',3000,1500);
 assert.equal(runtime.gcd,1.5);
 assert.equal(runtime.cooldowns.autoAttack,undefined);
});
test('client animation and server attack timing are linked to authoritative results',()=>{
 const g=source('game.js'),server=source('server/world-mobs.js'),transport=source('server/index.js');
 assert.match(g,/autoSwingClock\.canStart\(\)/);
 assert.match(g,/autoSwingClock\.onSent\(\)/);
 assert.match(g,/autoSwingClock\.onAccepted\(/);
 assert.match(g,/autoSwingClock\.onRejected\(/);
 assert.match(g,/reconcileAbilityCooldown\(abilityRuntime,event\.abilityId,event\.cooldownMs,event\.gcdMs\)/);
 assert.match(g,/event\.reason==='Способность восстанавливается'\)return/);
 assert.match(g,/attackElapsed>=\.34&&!attackLanded/);
 assert.match(g,/attackElapsed>=\.8/);
 assert.match(server,/cooldownMs:Math\.max\(0,Math\.ceil\(player\.combatReadyAt\[abilityId\]-now\)\)/);
 assert.match(server,/gcdMs:Math\.max\(0,Math\.ceil\(\(player\.gcdAt\|\|0\)-now\)\)/);
 assert.match(transport,/retryAfterMs:result\.retryAfterMs/);
});
