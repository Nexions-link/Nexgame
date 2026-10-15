import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {HIT_REACTION_SECONDS,DAMAGE_LABEL_LIMIT,hitReaction,damageText,createCombatFeedback} from '../combat-feedback.js';
const read=path=>readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)),'utf8');
test('impact reaction rises and fully settles without affecting actor coordinates',()=>{
 assert.equal(HIT_REACTION_SECONDS,.32);
 assert.equal(hitReaction(0),0);
 assert.equal(hitReaction(-2),0);
 assert.equal(hitReaction(Infinity),0);
 assert.equal(hitReaction(HIT_REACTION_SECONDS),0);
 assert.ok(hitReaction(.16)>.85);
 assert.ok(hitReaction(.08)>0);
});
test('numbers ignore rejected, zero or nonfinite damage',()=>{
 assert.equal(damageText(8.7),'9');
 assert.equal(damageText(0),'');
 assert.equal(damageText(-5),'');
 assert.equal(damageText(Infinity),'');
});
test('pooled labels are reused for local and server-authoritative hits',()=>{
 const elements=[];
 const layer={clientWidth:400,clientHeight:300,appendChild(e){elements.push(e)}};
 const document={createElement:()=>({className:'',hidden:true,style:{},textContent:''}),documentElement:{clientWidth:400,clientHeight:300}};
 class Vector3{
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this}
  project(){this.x=0;this.y=0;this.z=.3;return this}
 }
 const fx=createCombatFeedback({THREE:{Vector3},document,camera:{},layer});
 const mob={root:{parent:{},position:{x:0,y:0,z:0}},baseScale:1};
 const labels=DAMAGE_LABEL_LIMIT;
 assert.equal(elements.length,labels);
 assert.equal(fx.hit(mob,7),true);
 assert.equal(elements[0].textContent,'7');
 assert.equal(fx.hit(mob,14,'heavyStrike'),true);
 assert.match(elements[1].className,/strong/);
 assert.equal(fx.hit(mob,6,'thunderStomp'),true);
 assert.match(elements[2].className,/area/);
 fx.update(.07);
 assert.equal(elements[0].hidden,false);
 assert.match(elements[0].style.left,/px$/);
 for(let i=0;i<labels+3;i++)fx.hit(mob,8);
 assert.equal(elements.length,labels,'no allocations after initialization');
 fx.update(1);
 assert.ok(elements.every(e=>e.hidden===true));
 fx.hit(mob,3);fx.clear();
 assert.ok(elements.every(e=>e.hidden===true));
});
test('client receives exactly one feedback event for each confirmed multiplayer hit',()=>{
 const game=read('game.js');
 assert.match(game,/if\(!enemy\|\|enemy\.trainingDummy\|\|enemy\.serverLife!==hit\.life\)continue/);
 assert.match(game,/showCombatHit\(enemy,hit\.amount,event\.abilityId\)/);
 assert.match(game,/if\(worldCombatReady&&!e\.trainingDummy\)\{[\s\S]*?worldConnection\.sendAttack\(source,e\.index\)/);
 assert.match(game,/showCombatHit\(e,amount,source\)/);
 assert.match(game,/combatFeedback\.update\(dt\)/);
 assert.match(game,/combatFeedback\.clear\(\)/);
 assert.match(read('plainstrider-model.js'),/visual\.container\.position\.z=-\.19\*recoil/);
 assert.match(read('app.html'),/id="combatFeedback"/);
});
