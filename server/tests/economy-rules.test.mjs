import test from 'node:test';
import assert from 'node:assert/strict';
import {
 requireServerProximity,getGatherQuest,acceptGatherQuest,gatherNode,
 requireGatherAvailable,addOwnedStacks,consumeOwnedStacks,
 buyFromMerchant,sellToMerchant,turnInGatherQuest,moveSharedChest,
 getMentorQuest,acceptMentorQuest,certifyMentorKill,certifyMentorInteraction,turnInMentorQuest,
 ECONOMY_VENDOR,ECONOMY_HERBALIST,ECONOMY_CHEST,ECONOMY_MENTOR
} from '../economy-rules.js';
import {localToNormal} from '../spherical-pve.js';
import {RELIC_POSITION,SCOUT_POSITION} from '../../planet-test/mentor-chain.js';
const context=(point,extra={})=>({
 normal:localToNormal(point.x,point.z,261),radius:261,inCombat:false,...extra
});
const state=(change={})=>({
 level:1,experience:0,gold:100,health:120,resource:0,
 revision:0,worldRadius:261,positionNormal:[0,0,1],heading:0,
 inventory:Array(12).fill(null),equipment:{},quests:{},actionBar:[],...change
});
test('merchant uses SERVER price list and only items the character owns',()=>{
 const ctx=context(ECONOMY_VENDOR);
 const purchased=buyFromMerchant(state(),{itemId:'wornAxe',qty:1},ctx);
 assert.equal(purchased.gold,92);
 assert.deepEqual(purchased.inventory[0],{id:'wornAxe',qty:1});
 assert.equal(state().gold,100);
 assert.throws(()=>buyFromMerchant(state(),{itemId:'warriorTunic',qty:1},ctx),/item_not_for_sale/);
 assert.throws(()=>buyFromMerchant(state(),{itemId:'wornAxe',qty:1},context({x:0,z:-50})),/interaction_too_far/);
 assert.throws(()=>buyFromMerchant(state(),{itemId:'wornAxe',qty:1},context(ECONOMY_VENDOR,{inCombat:true})),/untrusted_interaction_context/);
 assert.throws(()=>buyFromMerchant(state(),{itemId:'wornAxe',qty:1},context(ECONOMY_VENDOR,{radius:87})),/untrusted_interaction_context/);
 assert.throws(()=>buyFromMerchant(state({gold:0}),{itemId:'wornAxe',qty:1},ctx),/not_enough_gold/);
 const full=Array.from({length:12},()=>({id:'wornAxe',qty:1}));
 assert.throws(()=>buyFromMerchant(state({inventory:full}),{itemId:'feebleSword',qty:1},ctx),/inventory_full/);
 const sold=sellToMerchant(purchased,{bagSlot:0,qty:1},ctx);
 assert.equal(sold.gold,93);
 assert.equal(sold.inventory[0],null);
 assert.throws(()=>sellToMerchant(sold,{bagSlot:0,qty:1},ctx),/item_not_sellable/);
 assert.throws(()=>sellToMerchant(state({inventory:[{id:'meadowFlower',qty:1},...Array(11).fill(null)]}),{bagSlot:0,qty:1},ctx),/item_not_sellable/);
 assert.throws(()=>sellToMerchant(state(),{bagSlot:0,qty:1,price:1000},ctx),/item_not_sellable/);
});
test('gather quest accepts sequential stages, consumes real ingredients, never pays twice',()=>{
 const herbalist=context(ECONOMY_HERBALIST);
 const active=acceptGatherQuest(state());
 assert.deepEqual(getGatherQuest(active),{stage:1,accepted:true});
 const node=gatherNode(1,0);
 assert.equal(node.itemId,'meadowFlower');
 assert.equal(node.nodeId,'gather:1:0');
 assert.doesNotThrow(()=>requireGatherAvailable(active,node,context(node)));
 assert.throws(()=>requireGatherAvailable(active,node,context({x:90,z:90})),/interaction_too_far/);
 assert.throws(()=>acceptGatherQuest(active),/quest_not_available/);
 assert.throws(()=>turnInGatherQuest(active,herbalist),/item_not_owned/);
 const ready=state({
  quests:active.quests,
  inventory:[{id:'meadowFlower',qty:4},...Array(11).fill(null)]
 });
 const {next,event}=turnInGatherQuest(ready,herbalist);
 assert.equal(event.eventKey,'gather:turnin:1');
 assert.equal(next.level,1);
 assert.equal(next.experience,35);
 assert.equal(next.gold,112);
 assert.equal(next.inventory[0],null);
 assert.deepEqual(getGatherQuest(next),{stage:2,accepted:false});
 assert.throws(()=>turnInGatherQuest(next,herbalist),/quest_not_ready/);
 assert.deepEqual(getGatherQuest(acceptGatherQuest(next)),{stage:2,accepted:true});
 assert.throws(()=>gatherNode(1,99),/unknown_gather_node/);
});
test('chest must conserve stacks, reject quest items and require proximity',()=>{
 const ctx=context(ECONOMY_CHEST);
 const bag=Array(12).fill(null);
 bag[0]={id:'chainVest',qty:1};
 const first=moveSharedChest(state({inventory:bag}),Array(18).fill(null),{action:'deposit',slot:0},ctx);
 assert.equal(first.next.inventory[0],null);
 assert.deepEqual(first.slots[0],{id:'chainVest',qty:1});
 const back=moveSharedChest(first.next,first.slots,{action:'withdraw',slot:0},ctx);
 assert.deepEqual(back.next.inventory[0],{id:'chainVest',qty:1});
 assert.equal(back.slots[0],null);
 assert.throws(()=>moveSharedChest(state({inventory:[{id:'meadowFlower',qty:1},...Array(11).fill(null)]}),Array(18).fill(null),{action:'deposit',slot:0},ctx),/chest_transfer_rejected/);
 assert.throws(()=>moveSharedChest(state({inventory:bag}),Array(18).fill(null),{action:'deposit',slot:0},context({x:100,z:100})),/interaction_too_far/);
 assert.throws(()=>moveSharedChest(state({inventory:bag}),Array(18).fill(null),{action:'deposit',slot:-1},ctx),/invalid_chest_action/);
});
test('stack transfers conserve quantities and fail atomically when bag is full',()=>{
 const base=Array(12).fill(null);
 base[0]={id:'feather',qty:19};
 const added=addOwnedStacks(base,[{id:'feather',qty:3}]);
 assert.deepEqual(added[0],{id:'feather',qty:20});
 assert.deepEqual(added[1],{id:'feather',qty:2});
 assert.deepEqual(base[0],{id:'feather',qty:19});
 const removed=consumeOwnedStacks(added,'feather',21);
 assert.equal(removed[0],null);
 assert.deepEqual(removed[1],{id:'feather',qty:1});
 assert.throws(()=>consumeOwnedStacks(added,'feather',25),/item_not_owned/);
 const full=Array.from({length:12},()=>({id:'chainVest',qty:1}));
 assert.throws(()=>addOwnedStacks(full,[{id:'feather',qty:1}]),/inventory_full/);
 assert.throws(()=>addOwnedStacks(base,[{id:'forgedLegendary',qty:1}]),/unknown_item/);
});

test('mentor objectives require genuine server-shape kill credits and fixed progression rewards',()=>{
 const atMentor=context(ECONOMY_MENTOR);
 const runId='1a42d6d3-7bd1-42a7-a1e2-c315635833a3';
 let hero=acceptMentorQuest(state(),atMentor);
 assert.deepEqual(getMentorQuest(hero),{step:1,kills:0});
 const normal=life=>({
  type:'killCredit',mobId:'dolgonog-0',life,xp:22,gold:0,loot:[{id:'feather',qty:1}]
 });
 assert.throws(()=>certifyMentorKill(hero,{...normal(1),xp:999},runId),/invalid_kill_reward/);
 assert.throws(()=>certifyMentorKill(hero,{
  type:'killCredit',mobId:'dolgonog-9',life:1,xp:70,gold:0,loot:[{id:'giantFeather',qty:1}]
 },runId),/wrong_mentor_target/);
 for(let life=1;life<=3;life++)hero=certifyMentorKill(hero,normal(life),runId).next;
 assert.deepEqual(getMentorQuest(hero),{step:2,kills:3});
 assert.throws(()=>certifyMentorKill(hero,normal(4),runId),/mentor_kill_not_needed/);
 const rewarded=turnInMentorQuest(hero,atMentor);
 assert.equal(rewarded.event.eventKey,'mentor:turnin:2');
 assert.equal(rewarded.next.gold,125);
 assert.equal(rewarded.next.experience,80);
 hero=acceptMentorQuest(rewarded.next,atMentor);
 assert.equal(getMentorQuest(hero).step,4);
 assert.throws(()=>certifyMentorInteraction(hero,'relic',context({x:100,z:100})),/interaction_too_far/);
 hero=certifyMentorInteraction(hero,'relic',context(RELIC_POSITION));
 assert.equal(getMentorQuest(hero).step,5);
 hero=acceptMentorQuest(turnInMentorQuest(hero,atMentor).next,atMentor);
 assert.equal(getMentorQuest(hero).step,7);
 hero=certifyMentorInteraction(hero,'scout',context(SCOUT_POSITION));
 assert.equal(getMentorQuest(hero).step,8);
 hero=acceptMentorQuest(turnInMentorQuest(hero,atMentor).next,atMentor);
 assert.equal(getMentorQuest(hero).step,10);
 const boss={
  type:'killCredit',mobId:'dolgonog-9',life:1,xp:70,gold:0,
  loot:[{id:'giantFeather',qty:1}]
 };
 assert.throws(()=>certifyMentorKill(hero,normal(5),runId),/wrong_mentor_target/);
 hero=certifyMentorKill(hero,boss,runId).next;
 assert.equal(getMentorQuest(hero).step,11);
 hero=turnInMentorQuest(hero,atMentor).next;
 assert.equal(getMentorQuest(hero).step,12);
 assert.throws(()=>turnInMentorQuest(hero,atMentor),/mentor_reward_not_ready/);
 assert.throws(()=>acceptMentorQuest(hero,atMentor),/mentor_quest_not_available/);
});
