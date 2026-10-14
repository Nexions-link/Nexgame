import assert from 'node:assert/strict';
import {DEFAULT_HOTBAR,HOTBAR_SLOT_COUNT,USABLE_ITEMS,actionEntry,actionDefinition,availableHotbarActions,normalizeHotbar,assignHotbarSlot} from '../hotbar.js';
const tests=[];
function check(name,fn){fn();tests.push(name)}
check('eight slots start with warrior skills and a potion',()=>{
 assert.equal(HOTBAR_SLOT_COUNT,8);
 const a=normalizeHotbar(undefined,'warrior');
 assert.equal(a.length,8);
 assert.deepEqual(a.slice(0,4),[
  {kind:'ability',id:'autoAttack'},
  {kind:'ability',id:'thunderStomp'},
  {kind:'item',id:'healingPotion'},
  {kind:'ability',id:'heavyStrike'}
 ]);
 assert.ok(a.slice(4).every(x=>x===null));
});
check('class-aware abilities and consumables appear in different book tabs',()=>{
 const {abilities,items}=availableHotbarActions('warrior',1);
 assert.equal(abilities.length,3);
 assert.ok(abilities.every(a=>a.kind==='ability'));
 assert.equal(items.length,1);
 assert.equal(items[0].id,'healingPotion');
 assert.equal(items[0].kind,'item');
 assert.equal(items[0].abilityId,'healingPotion');
 assert.equal(USABLE_ITEMS.healingPotion.description.includes('55'),true);
});
check('legacy saved data without slots migrates to four working defaults',()=>{
 const value=normalizeHotbar(null,'warrior');
 assert.equal(value[0].id,'autoAttack');
 assert.equal(value[2].kind,'item');
});
check('slot normalization rejects unknown abilities, items and forged keys',()=>{
 const value=normalizeHotbar([
  {kind:'ability',id:'evil'},
  {kind:'ability',id:'healingPotion'},
  {kind:'item',id:'evil'},
  {kind:'other',id:'autoAttack'},
  {kind:'ability',id:'heavyStrike'},
  null,
  {kind:'ability',id:'autoAttack',other:'untrusted'},
  {kind:'item',id:'healingPotion'}
 ],'warrior',1);
 assert.deepEqual(value,[null,null,null,null,{kind:'ability',id:'heavyStrike'},null,
  {kind:'ability',id:'autoAttack'},{kind:'item',id:'healingPotion'}]);
});
check('a picked ability can be assigned to any of the eight slots',()=>{
 let slots=normalizeHotbar(null);
 for(let i=0;i<8;i++){
  slots=assignHotbarSlot(slots,i,actionEntry('ability','heavyStrike'));
  assert.deepEqual(slots[i],{kind:'ability',id:'heavyStrike'});
 }
 assert.equal(slots.length,8);
});
check('using the same skill in several slots is allowed',()=>{
 let slots=normalizeHotbar([]);
 slots=assignHotbarSlot(slots,0,actionEntry('ability','thunderStomp'));
 slots=assignHotbarSlot(slots,7,actionEntry('ability','thunderStomp'));
 assert.deepEqual(slots[0],slots[7]);
});
check('potion can be moved or duplicated without changing inventory count',()=>{
 let slots=normalizeHotbar(null);
 slots=assignHotbarSlot(slots,4,actionEntry('item','healingPotion'));
 assert.deepEqual(slots[4],{kind:'item',id:'healingPotion'});
 assert.deepEqual(slots[2],{kind:'item',id:'healingPotion'});
});
check('clearing a slot persists as a real empty slot',()=>{
 let slots=normalizeHotbar(null);
 slots=assignHotbarSlot(slots,0,null);
 const json=JSON.parse(JSON.stringify(slots));
 assert.equal(normalizeHotbar(json)[0],null);
 assert.equal(json[1].id,'thunderStomp');
});
check('invalid indices never mutate the saved layout',()=>{
 const original=normalizeHotbar(null);
 const copy=JSON.parse(JSON.stringify(original));
 for(const bad of [-1,8,9,0.5,NaN,Infinity,'1',null]){
  const updated=assignHotbarSlot(original,bad,actionEntry('item','healingPotion'));
  assert.deepEqual(updated,copy);
 }
 assert.deepEqual(original,copy);
});
check('malformed arrays always become exactly eight validated slots',()=>{
 assert.equal(normalizeHotbar([]).length,8);
 assert.equal(normalizeHotbar(new Array(200).fill(null)).length,8);
 assert.equal(normalizeHotbar({0:{kind:'ability',id:'autoAttack'}})[0].id,'autoAttack');
 // Objects without array shape fall back to valid defaults.
 assert.equal(normalizeHotbar('bad')[0].id,'autoAttack');
});
check('future class slots never keep warrior-only abilities',()=>{
 const base=normalizeHotbar(null);
 const shaman=normalizeHotbar(base,'shaman',1);
 assert.equal(shaman[0],null);
 assert.equal(shaman[1],null);
 assert.equal(shaman[2].id,'healingPotion');
 assert.equal(shaman[3],null);
});
check('action definitions preserve the correct casting identifiers',()=>{
 assert.equal(actionDefinition(actionEntry('ability','autoAttack')).abilityId,'autoAttack');
 assert.equal(actionDefinition(actionEntry('ability','heavyStrike')).resourceCost,20);
 assert.equal(actionDefinition(actionEntry('item','healingPotion')).abilityId,'healingPotion');
 assert.equal(actionDefinition(actionEntry('item','nope')),null);
});
console.log('NexGame customizable hotbar tests: '+tests.length+' groups passed.');
