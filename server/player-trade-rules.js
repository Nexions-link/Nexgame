// Server-only item and currency exchange. Browser packets contain bag references,
// never item grants or ownership. Both resulting bags are validated before save.
import {ITEM_CATALOG,itemStackLimit} from '../items.js';
import {ProgressError,validateInventory} from './progress-rules.js';
import {addOwnedStacks} from './economy-rules.js';

export const TRADE_SLOTS=6;
export const TRADE_RANGE=5;
export const TRADE_INVITE_MS=20000;
export const TRADE_IDLE_MS=120000;
export const MAX_TRADE_GOLD=2147483647;
const int=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const fail=code=>{throw new ProgressError(code,409)};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
export function isTradeableItem(id){
 const def=ITEM_CATALOG[id];
 return id==='healingPotion'||!!(def&&!def.quest&&!def.adminOnly&&
  !def.soulbound&&!def.bindOnPickup);
}
export function resolveTradeOffer(state,input){
 if(!plain(input)||!Array.isArray(input.items)||input.items.length>TRADE_SLOTS||
   !int(input.gold,0,MAX_TRADE_GOLD))fail('invalid_trade_offer');
 const inventory=validateInventory(state.inventory),slots=new Set(),bags=new Set();
 if(!int(state.gold,0,MAX_TRADE_GOLD)||input.gold>state.gold)fail('trade_not_enough_gold');
 const items=input.items.map(item=>{
  if(!plain(item)||!int(item.tradeSlot,0,TRADE_SLOTS-1)||
    !int(item.bagSlot,0,inventory.length-1)||!int(item.qty,1,20)||
    slots.has(item.tradeSlot)||bags.has(item.bagSlot))fail('invalid_trade_offer');
  slots.add(item.tradeSlot);bags.add(item.bagSlot);
  const owned=inventory[item.bagSlot];
  if(!owned||owned.qty<item.qty)fail('trade_item_changed');
  if(!isTradeableItem(owned.id)||item.qty>itemStackLimit(owned.id))fail('trade_item_unavailable');
  return {tradeSlot:item.tradeSlot,bagSlot:item.bagSlot,itemId:owned.id,qty:item.qty};
 }).sort((a,b)=>a.tradeSlot-b.tradeSlot);
 return {items,gold:input.gold};
}
function takeOffer(state,offer){
 const checked=resolveTradeOffer(state,offer);
 const inventory=validateInventory(state.inventory);
 for(const item of checked.items){
  const original=offer.items.find(row=>row.tradeSlot===item.tradeSlot);
  if(original.itemId!==item.itemId)fail('trade_item_changed');
  const row=inventory[item.bagSlot];
  inventory[item.bagSlot]=row.qty===item.qty?null:{id:row.id,qty:row.qty-item.qty};
 }
 return {checked,inventory};
}
export function exchangeTradeProgress(states,offers){
 if(!Array.isArray(states)||states.length!==2||!Array.isArray(offers)||offers.length!==2)
  fail('invalid_trade_offer');
 const removed=states.map((state,index)=>takeOffer(state,offers[index]));
 if(!offers.some(offer=>offer.gold||offer.items.length))fail('trade_empty');
 return states.map((state,index)=>{
  const own=removed[index],other=removed[1-index].checked;
  const gold=state.gold-own.checked.gold+other.gold;
  if(!int(gold,0,MAX_TRADE_GOLD))fail('trade_gold_overflow');
  const inventory=addOwnedStacks(own.inventory,other.items.map(({itemId:id,qty})=>({id,qty})));
  return {...state,gold,inventory};
 });
}
