import test from 'node:test';
import assert from 'node:assert/strict';
import {
 ProgressError,requiredExperience,addExperience,readProgress,
 validateInventory,validateEquipment,validateKillCredit,
 awardVerifiedKill,validateServerCheckpoint,equipOwnedItem,unequipOwnedItem,setActionBarSlot
} from '../progress-rules.js';

const rows=()=>({
 schemaVersion:1,revision:'0',level:1,experience:0,gold:30,health:120,
 resource:0,worldRadius:261,positionNormal:[0,0,1],heading:0,
 inventory:[],equipment:{},quests:{},actionBar:[]
});
const WORLD_RUN='d70561b2-6f8b-4e55-ab2c-9a8490ce85ae';
const mob=(extra={})=>({
 type:'killCredit',mobId:'dolgonog-0',life:1,xp:22,gold:4,
 loot:[{id:'feather',qty:1}],...extra
});
test('readProgress validates a DB snapshot and normalizes its empty inventory',()=>{
 const state=readProgress(rows());
 assert.equal(state.revision,0);
 assert.equal(state.inventory.length,12);
 assert.deepEqual(state.inventory,Array(12).fill(null));
 assert.notStrictEqual(state.positionNormal,rows().positionNormal);
 assert.throws(()=>readProgress({...rows(),schemaVersion:2}),/unsupported_progress_schema/);
 assert.throws(()=>readProgress({...rows(),revision:'9007199254740994'}),/invalid_revision/);
 assert.throws(()=>readProgress({...rows(),gold:-1}),/corrupt_character_progress/);
 assert.throws(()=>readProgress({...rows(),inventory:[{id:'feather',qty:1}]}),/invalid_inventory_size/);
});
test('server-verified kill credits enforce mob identity, radius, loot table and reward budget',()=>{
 const valid=validateKillCredit(mob(),261,WORLD_RUN);
 assert.equal(valid.eventKey,'mob:'+WORLD_RUN+':261:dolgonog-0:1');
 assert.equal(valid.xp,22);
 assert.throws(()=>validateKillCredit(mob(),261,'not-a-run-id'),/invalid_world_epoch/);
 assert.notEqual(valid.eventKey,validateKillCredit(mob(),261,'72f5c0a7-5dc7-4ddb-a635-f727ade18096').eventKey);
 assert.throws(()=>validateKillCredit(mob({xp:7000}),261,WORLD_RUN),/invalid_kill_reward/);
 assert.throws(()=>validateKillCredit(mob({gold:9999}),261,WORLD_RUN),/invalid_kill_reward/);
 assert.throws(()=>validateKillCredit(mob({mobId:'dolgonog-9'}),261,WORLD_RUN),/unverified_kill_event/);
 assert.throws(()=>validateKillCredit(mob({life:0}),261,WORLD_RUN),/unverified_kill_event/);
 assert.throws(()=>validateKillCredit(mob(),999,WORLD_RUN),/unverified_kill_event/);
 assert.throws(()=>validateKillCredit(mob({loot:[{id:'healingPotion',qty:10}]}),261,WORLD_RUN),/invalid_kill_loot/);
 assert.throws(()=>validateKillCredit(mob({loot:[{id:'warriorTunic',qty:2}]}),261,WORLD_RUN),/invalid_kill_loot/);
 assert.throws(()=>validateKillCredit(mob({loot:[{id:'beak',qty:5}]}),261,WORLD_RUN),/invalid_kill_loot/);
 assert.throws(()=>validateKillCredit(mob({loot:[{id:'feather',qty:1},{id:'feather',qty:1}]}),261,WORLD_RUN),/invalid_kill_loot/);
 assert.throws(()=>validateKillCredit(mob({loot:[{id:'batteredBuckler',qty:1},{id:'chainVest',qty:1}]}),261,WORLD_RUN),/invalid_kill_loot/);
 assert.throws(()=>validateKillCredit(mob({gold:4,level:60}),261,WORLD_RUN),/unverified_kill_event/);
 const boss=validateKillCredit(mob({mobId:'dolgonog-8',life:12,xp:70,gold:12,loot:[{id:'giantFeather',qty:1}]}),261,WORLD_RUN);
 assert.equal(boss.eventKey,'mob:'+WORLD_RUN+':261:dolgonog-8:12');
 assert.throws(()=>validateKillCredit(mob({mobId:'dolgonog-8'}),261,WORLD_RUN),/invalid_kill_reward/);
});
test('mob rewards level safely, stack into owned slots and never mutate the input',()=>{
 const s=readProgress({...rows(),experience:99});
 const saved=JSON.stringify(s);
 const event=validateKillCredit(mob(),261,WORLD_RUN);
 const rewarded=awardVerifiedKill(s,event);
 assert.equal(rewarded.level,2);
 assert.equal(rewarded.experience,21);
 assert.equal(rewarded.gold,34);
 assert.deepEqual(rewarded.inventory[0],{id:'feather',qty:1});
 assert.equal(JSON.stringify(s),saved);
 assert.equal(addExperience(59,5000,70).level,60);
 assert.equal(addExperience(60,0,70).experience,0);
 assert.equal(requiredExperience(1),100);
 assert.throws(()=>validateInventory([{id:'feather',qty:999}]),/invalid_inventory_size/);
 assert.throws(()=>validateEquipment({weapon:{id:'scalpingStrength'}},1),/unavailable_equipment/);
});
test('full inventory rejects the entire reward instead of dropping items or granting duplicate XP',()=>{
 const bag=Array.from({length:12},()=>({id:'wornAxe',qty:1}));
 const state=readProgress({...rows(),inventory:bag});
 const credit=validateKillCredit(mob(),261,WORLD_RUN);
 const before=JSON.stringify(state);
 assert.throws(()=>awardVerifiedKill(state,credit),e=>e instanceof ProgressError&&e.code==='inventory_full');
 assert.equal(JSON.stringify(state),before);
});
test('equip and unequip are inventory-conserving and require ownership + level',()=>{
 const inventory=Array(12).fill(null);
 inventory[0]={id:'wornAxe',qty:1};
 inventory[1]={id:'feebleSword',qty:1};
 const initial=readProgress({...rows(),inventory});
 const next=equipOwnedItem(initial,0,'weapon');
 assert.deepEqual(next.equipment.weapon,{id:'wornAxe'});
 assert.equal(next.inventory[0],null);
 assert.equal(initial.inventory[0].id,'wornAxe');
 assert.throws(()=>equipOwnedItem(next,1,'weapon'),/equipment_requirements_not_met/);
 assert.throws(()=>equipOwnedItem(next,4,'weapon'),/item_not_owned/);
 const back=unequipOwnedItem(next,'weapon',0);
 assert.deepEqual(back.inventory[0],{id:'wornAxe',qty:1});
 assert.deepEqual(back.equipment,{});
 assert.throws(()=>unequipOwnedItem(next,'weapon',1),/inventory_slot_occupied/);
});
test('trusted checkpoints cannot write level, currency, gear, or move planets',()=>{
 const normal=validateServerCheckpoint({normal:[0,0,1.003],radius:261,heading:1},261);
 assert.equal(normal.positionNormal[2],1);
 assert.throws(()=>validateServerCheckpoint({normal:[0,0,1],heading:1,radius:261,level:60},261),/invalid_checkpoint/);
 assert.throws(()=>validateServerCheckpoint({normal:[0,0,1],heading:1,radius:261,gold:999},261),/invalid_checkpoint/);
 assert.throws(()=>validateServerCheckpoint({normal:[0,0,1],heading:1,radius:261,equipment:{}},261),/invalid_checkpoint/);
 assert.throws(()=>validateServerCheckpoint({normal:[0,0,1],heading:1,radius:87},261),/invalid_checkpoint/);
 assert.throws(()=>validateServerCheckpoint({normal:[0,0,2],heading:1,radius:261},261),/invalid_checkpoint/);
});

test('action bar edits validate slot, class, level and payload without changing game stats',()=>{
 const state=readProgress(rows());
 const saved=setActionBarSlot(state,7,{kind:'ability',id:'autoAttack'});
 assert.equal(saved.actionBar.length,8);assert.deepEqual(saved.actionBar[7],{kind:'ability',id:'autoAttack'});
 assert.equal(saved.gold,state.gold);assert.deepEqual(saved.inventory,state.inventory);
 let cleared=saved;for(let slot=0;slot<8;slot++)cleared=setActionBarSlot(cleared,slot,null);
 assert.deepEqual(cleared.actionBar,Array(8).fill(null));
 assert.throws(()=>setActionBarSlot(state,8,null),/invalid_action_bar_slot/);
 assert.throws(()=>setActionBarSlot(state,-1,null),/invalid_action_bar_slot/);
 assert.throws(()=>setActionBarSlot(state,1,{kind:'ability',id:'unknown'}),/invalid_action_bar_entry/);
 assert.throws(()=>setActionBarSlot(state,1,{kind:'ability',id:'autoAttack',damage:9999}),/invalid_action_bar_entry/);
 assert.throws(()=>setActionBarSlot(state,1,undefined),/invalid_action_bar_entry/);
});
