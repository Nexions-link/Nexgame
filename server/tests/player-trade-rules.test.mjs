import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveTradeOffer,exchangeTradeProgress,MAX_TRADE_GOLD} from '../player-trade-rules.js';

const state=(items=[],gold=30)=>({inventory:[...items,...Array(12-items.length).fill(null)],gold});
const offer=(s,items=[],gold=0)=>resolveTradeOffer(s,{items,gold});
const item=(tradeSlot,bagSlot,qty=1)=>({tradeSlot,bagSlot,qty});
const count=(states,id)=>states.reduce((sum,s)=>sum+s.inventory.reduce((n,row)=>n+(row?.id===id?row.qty:0),0),0);
test('trade resolves actual owned items, takes partial stacks and conserves every item and coin',()=>{
 const states=[state([{id:'feather',qty:20},{id:'wornAxe',qty:1}],40),state([{id:'healingPotion',qty:7}],25)];
 const original=structuredClone(states),offers=[offer(states[0],[item(0,0,8),item(5,1)],13),offer(states[1],[item(2,0,3)],4)];
 const next=exchangeTradeProgress(states,offers);
 assert.deepEqual(states,original,'validation and exchange do not mutate either input');
 assert.equal(next[0].gold,31);assert.equal(next[1].gold,34);
 assert.equal(next[0].gold+next[1].gold,65);
 for(const id of ['feather','wornAxe','healingPotion'])assert.equal(count(next,id),count(states,id));
 assert.deepEqual(next[0].inventory[0],{id:'feather',qty:12});
 assert.ok(next[1].inventory.some(row=>row?.id==='wornAxe'));
});
test('full backpacks can exchange their outgoing slots and merge incoming stacks',()=>{
 const full=()=>state(Array.from({length:12},()=>({id:'wornAxe',qty:1})));
 const states=[full(),full()];states[1].inventory[0]={id:'chainVest',qty:1};
 const next=exchangeTradeProgress(states,[offer(states[0],[item(0,0)]),offer(states[1],[item(0,0)])]);
 assert.deepEqual(next[0].inventory[0],{id:'chainVest',qty:1});
 assert.deepEqual(next[1].inventory[0],{id:'wornAxe',qty:1});
 const stacks=[state([{id:'feather',qty:20},{id:'wolfPelt',qty:19}]),state([{id:'feather',qty:18}])];
 const merged=exchangeTradeProgress(stacks,[offer(stacks[0],[item(0,0,2)]),offer(stacks[1])]);
 assert.deepEqual(merged[1].inventory[0],{id:'feather',qty:20});
});
test('full receiving bag or changed source rejects both results without consuming either offer',()=>{
 const states=[state([{id:'feather',qty:1}]),state(Array.from({length:12},()=>({id:'wornAxe',qty:1})))];
 const offers=[offer(states[0],[item(0,0)]),offer(states[1])],before=structuredClone(states);
 assert.throws(()=>exchangeTradeProgress(states,offers),e=>e.code==='inventory_full');
 assert.deepEqual(states,before);
 states[0].inventory[0]={id:'wolfPelt',qty:1};
 assert.throws(()=>exchangeTradeProgress(states,offers),e=>e.code==='trade_item_changed');
});
test('six unique bag references, catalog eligibility and integer currency are server enforced',()=>{
 const s=state([{id:'feather',qty:5},{id:'meadowFlower',qty:1},{id:'adminBattlefury',qty:1}]);
 for(const input of [
  {items:[item(0,0,6)],gold:0},{items:[item(0,0,0)],gold:0},
  {items:[item(0,0),item(1,0)],gold:0},{items:[item(0,0),item(0,1)],gold:0},
  {items:[item(6,0)],gold:0},{items:[item(0,-1)],gold:0},
  {items:[item(0,1)],gold:0},{items:[item(0,2)],gold:0},
  {items:Array.from({length:7},(_,i)=>item(i,0)),gold:0},
  {items:[],gold:-1},{items:[],gold:1.5},{items:[],gold:NaN},{items:[],gold:Infinity},
  {items:[],gold:31},{items:[],gold:MAX_TRADE_GOLD+1}
 ])assert.throws(()=>resolveTradeOffer(s,input));
 assert.equal(resolveTradeOffer(s,{items:[{...item(0,0),itemId:'adminBattlefury'}],gold:0}).items[0].itemId,'feather',
  'a client-supplied item ID never becomes an item grant');
});
test('gold overflow and an empty exchange are rejected before persistence',()=>{
 const states=[state([],MAX_TRADE_GOLD),state([],1)];
 assert.throws(()=>exchangeTradeProgress(states,[offer(states[0]),offer(states[1],[],1)]),e=>e.code==='trade_gold_overflow');
 assert.throws(()=>exchangeTradeProgress(states,[offer(states[0]),offer(states[1])]),e=>e.code==='trade_empty');
});
