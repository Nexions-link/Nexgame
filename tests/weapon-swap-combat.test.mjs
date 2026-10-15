import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ITEM_CATALOG,deriveStats} from '../items.js';

// Execute the actual game equipment functions with a controlled battle state,
// instead of replicating a second implementation in the tests.
const game=readFileSync(fileURLToPath(new URL('../game.js',import.meta.url)),'utf8');
const first=game.indexOf('function finishEquipmentChange('),last=game.indexOf('function refreshCharacter()',first);
assert.ok(first>=0&&last>first,'equipment handlers are present in game.js');
const source=game.slice(first,last);
function harness(overrides={}){
 const state={
  level:8,hp:85,inventory:[{id:'feebleSword',qty:1},{id:'letterOpener',qty:1},null],
  equipment:{weapon:{id:'wornAxe',qty:1},shield:{id:'infantryBear',qty:1},chest:{id:'warriorTunic',qty:1}}
 };
 let combat=true,autoAttack=true,attackElapsed=.26,attackCooldown=1.4,swingTarget={id:'mob'};
 const messages=[];let saved=0,visuals=0,updates=0;
 const env={
  state,ITEM_CATALOG,
  autoSwingClock:{reset(){}},
  inCombat:()=>combat,
  msg:message=>messages.push(message),
  playerStats:()=>deriveStats(state.level,state.equipment),
  syncEquipmentVisuals:()=>visuals++,
  save:()=>saved++,
  updateHUD:()=>updates++,
  storeItem:(item)=>{
   const i=state.inventory.findIndex(entry=>!entry);
   if(i<0)return false;
   state.inventory[i]={...item};return true;
  },
  ...overrides
 };
 Object.defineProperties(env,{
  autoAttack:{get:()=>autoAttack,set:v=>{autoAttack=v}},
  attackElapsed:{get:()=>attackElapsed,set:v=>{attackElapsed=v}},
  attackCooldown:{get:()=>attackCooldown,set:v=>{attackCooldown=v}},
  swingTarget:{get:()=>swingTarget,set:v=>{swingTarget=v}}
 });
 const api=new Function('env','with(env){'+source+';return {equipInventorySlot,unequipSlot};}')(env);
 return {env,state,messages,api,metrics:()=>({combat,autoAttack,attackElapsed,attackCooldown,swingTarget,saved,visuals,updates}),
  setCombat:value=>{combat=value}};
}

test('swap a sword into the equipped slot mid-combat without interrupting autoattack or its cooldown',()=>{
 const h=harness(),target=h.metrics().swingTarget;
 assert.equal(h.api.equipInventorySlot(0),true);
 assert.equal(h.state.equipment.weapon.id,'feebleSword');
 assert.equal(h.state.inventory[0].id,'wornAxe');
 assert.deepEqual(h.metrics(),{combat:true,autoAttack:true,attackElapsed:.26,attackCooldown:1.4,swingTarget:target,saved:1,visuals:1,updates:1});
 assert.equal(h.api.equipInventorySlot(1),true,'dagger can replace a sword mid-combat');
 assert.equal(h.state.equipment.weapon.id,'letterOpener');
 assert.equal(h.state.inventory[1].id,'feebleSword');
 assert.equal(h.metrics().attackCooldown,1.4,'no instant attack exploit');
 assert.equal(h.metrics().autoAttack,true);
});

test('unequip weapon in combat when the backpack has room, preserving ongoing attack',()=>{
 const h=harness();
 assert.equal(h.api.unequipSlot('weapon'),true);
 assert.equal(h.state.equipment.weapon,null);
 assert.equal(h.state.inventory[2].id,'wornAxe');
 assert.equal(h.metrics().autoAttack,true);
 assert.equal(h.metrics().attackElapsed,.26);
 assert.equal(h.metrics().attackCooldown,1.4);
});

test('shield and armor still cannot be equipped or removed during combat',()=>{
 const h=harness();
 h.state.inventory[0]={id:'infantryBear',qty:1};
 h.state.inventory[1]={id:'warriorPants',qty:1};
 assert.equal(h.api.equipInventorySlot(0),false);
 assert.equal(h.api.equipInventorySlot(1),false);
 assert.equal(h.api.unequipSlot('shield'),false);
 assert.equal(h.api.unequipSlot('chest'),false);
 assert.equal(h.state.equipment.shield.id,'infantryBear');
 assert.equal(h.state.equipment.chest.id,'warriorTunic');
 assert.equal(h.metrics().saved,0);
 assert.equal(h.metrics().autoAttack,true);
 assert.ok(h.messages.every(message=>message.includes('Сначала выйди из боя')));
});

test('outside combat armor/shield equipment is unchanged, including previous combat-state reset',()=>{
 const h=harness();h.setCombat(false);
 h.state.inventory[0]={id:'warriorPants',qty:1};
 assert.equal(h.api.equipInventorySlot(0),true);
 assert.equal(h.state.equipment.legs.id,'warriorPants');
 assert.equal(h.metrics().autoAttack,false);
 assert.equal(h.metrics().attackElapsed,-1);
 assert.equal(h.metrics().attackCooldown,0);
 assert.equal(h.metrics().swingTarget,null);
 assert.equal(h.api.unequipSlot('shield'),true);
 assert.equal(h.state.equipment.shield,null);
});

test('weapon still respects level requirements and bag capacity when unequipped',()=>{
 const h=harness();
 h.state.level=1;
 assert.equal(h.api.equipInventorySlot(0),false,'higher-level sword is blocked');
 assert.equal(h.state.equipment.weapon.id,'wornAxe');
 assert.ok(h.messages.includes('Требуется уровень 3'));
 h.state.inventory[2]={id:'feather',qty:20};
 assert.equal(h.api.unequipSlot('weapon'),false);
 assert.equal(h.state.equipment.weapon.id,'wornAxe');
});

test('release keeps the restriction focused on the weapon slot',()=>{
 assert.match(game,/if\(def\.slot!=='weapon'&&inCombat\(\)\)/);
 assert.match(game,/if\(slot!=='weapon'&&inCombat\(\)\)/);
 assert.match(game,/if\(slot!=='weapon'\)\{\s*autoAttack=false;attackElapsed=-1;swingTarget=null;attackCooldown=0/);
});
