import assert from 'node:assert/strict';
import {
 CLASS_DEFINITIONS,ABILITY_DEFINITIONS,
 getClassDefinition,getAbilityDefinition,getClassAbilities,
 normalizeClassId,normalizeResource,changeResource,
 createAbilityRuntime,tickAbilityRuntime,abilityCooldown,
 abilityFailure,activateAbility
} from '../skills.js';
const checks=[];
function test(name,fn){fn();checks.push(name)}
const ctx=(runtime,additional={})=>({
 classId:'warrior',level:1,resource:40,runtime,hasTarget:true,
 range:2.5,facing:true,hasConsumable:true,needsHealing:true,...additional
});
test('class definitions and future-class restrictions',()=>{
 assert.equal(Object.keys(CLASS_DEFINITIONS).length,3);
 assert.equal(getClassDefinition('warrior').resource,'rage');
 assert.equal(getClassDefinition('shaman').resource,'mana');
 assert.equal(getClassDefinition('hunter').resource,'mana');
 assert.equal(CLASS_DEFINITIONS.warrior.playable,true);
 assert.equal(CLASS_DEFINITIONS.shaman.playable,false);
 assert.equal(CLASS_DEFINITIONS.hunter.playable,false);
 assert.equal(normalizeClassId('shaman'),'warrior');
 assert.equal(normalizeClassId('unknown'),'warrior');
});
test('old save migration, resources and clamping',()=>{
 assert.equal(normalizeResource(undefined,'warrior'),0);
 assert.equal(normalizeResource(undefined,'shaman'),100);
 assert.equal(normalizeResource(Number.NaN,'warrior'),0);
 assert.equal(changeResource(97,20,'warrior'),100);
 assert.equal(changeResource(2,-40,'warrior'),0);
 assert.equal(changeResource(25,15,'warrior'),40);
});
test('warrior ability loadout is data driven',()=>{
 assert.deepEqual(getClassAbilities('warrior',1).map(x=>x.id).sort(),
  ['autoAttack','thunderStomp','healingPotion','heavyStrike'].sort());
 assert.deepEqual(getClassAbilities('hunter',1).map(x=>x.id),['healingPotion']);
 assert.equal(ABILITY_DEFINITIONS.heavyStrike.resourceCost,20);
 assert.equal(ABILITY_DEFINITIONS.heavyStrike.cooldown,3);
 assert.equal(ABILITY_DEFINITIONS.heavyStrike.gcd,1.5);
});
test('melee conditions reject invalid attacks without changing timers',()=>{
 const runtime=createAbilityRuntime(),def=getAbilityDefinition('heavyStrike');
 const base=ctx(runtime);
 assert.equal(abilityFailure(def,ctx(runtime,{hasTarget:false})),'Нет цели');
 assert.equal(abilityFailure(def,ctx(runtime,{range:8})),'Цель слишком далеко');
 assert.equal(abilityFailure(def,ctx(runtime,{facing:false})),'Цель не перед вами');
 assert.equal(abilityFailure(def,ctx(runtime,{resource:19})),'Недостаточно ярости');
 assert.equal(abilityFailure(def,ctx(runtime,{classId:'shaman'})),'Недоступно этому классу');
 assert.equal(activateAbility(def,ctx(runtime,{range:7})).ok,false);
 assert.equal(runtime.gcd,0);
 assert.equal(abilityCooldown(runtime,def.id),0);
 assert.equal(abilityFailure(def,base),'');
});
test('ability activation consumes rage and starts both cooldowns',()=>{
 const runtime=createAbilityRuntime(),def=getAbilityDefinition('heavyStrike');
 const result=activateAbility(def,ctx(runtime));
 assert.equal(result.ok,true);
 assert.equal(result.resource,20);
 assert.equal(runtime.gcd,1.5);
 assert.equal(abilityCooldown(runtime,def.id),3);
 assert.equal(abilityFailure(def,ctx(runtime)),'Способность восстанавливается');
 tickAbilityRuntime(runtime,1.6);
 assert.equal(runtime.gcd,0);
 assert.ok(abilityCooldown(runtime,def.id)>1.39);
 tickAbilityRuntime(runtime,1.5);
 assert.equal(abilityCooldown(runtime,def.id),0);
});
test('global cooldown blocks skill casting but never stops autoattack',()=>{
 const runtime=createAbilityRuntime();
 assert.equal(activateAbility(getAbilityDefinition('thunderStomp'),ctx(runtime,{resource:0})).ok,true);
 assert.equal(abilityFailure(getAbilityDefinition('heavyStrike'),ctx(runtime)),'Общая перезарядка');
 assert.equal(abilityFailure(getAbilityDefinition('autoAttack'),ctx(runtime)),'');
});
test('potion checks supplies and health but costs no rage',()=>{
 const runtime=createAbilityRuntime(),def=getAbilityDefinition('healingPotion');
 assert.equal(abilityFailure(def,ctx(runtime,{hasConsumable:false})),'Лечебные настои закончились');
 assert.equal(abilityFailure(def,ctx(runtime,{needsHealing:false})),'Здоровье уже полное');
 assert.equal(activateAbility(def,ctx(runtime)).resource,40);
});
test('invalid or negative dt never lengthens cooldown',()=>{
 const runtime=createAbilityRuntime();activateAbility(getAbilityDefinition('heavyStrike'),ctx(runtime));
 tickAbilityRuntime(runtime,-20);
 assert.equal(runtime.gcd,1.5);
 tickAbilityRuntime(runtime,Infinity);
 assert.equal(runtime.gcd,1.5);
 tickAbilityRuntime(runtime,10);
 assert.equal(runtime.gcd,0);
 assert.equal(abilityCooldown(runtime,'heavyStrike'),0);
});
console.log('NexGame Alpha 0.3.5 skills tests: '+checks.length+' groups passed.');
