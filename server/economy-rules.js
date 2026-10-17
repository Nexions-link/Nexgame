// Isolated server-authoritative economy rules for NexGameWorld Alpha 0.7.2.
// NEVER expose these helpers as client-authored XP, currency or inventory APIs.
import {ITEM_CATALOG,MERCHANT_STOCK,itemStackLimit} from '../items.js';
import {GATHER_QUESTS,GATHER_INTERACT_RANGE,
 GATHER_RESPAWN_SECONDS,GATHER_CAST_SECONDS,OFFLINE_CHEST} from '../planet-test/gather-world.js';
import {lakeRadius} from '../planet-test/start-zone.js';
import {arcDistance,localToNormal} from './spherical-pve.js';
import {transferChest,cleanStack,CHEST_SLOTS} from './chest.js';
import {addExperience,ProgressError} from './progress-rules.js';

export const ECONOMY_CHEST_ID='hearth-house';
export const ECONOMY_VENDOR={x:6,z:11,range:4.7};
export const ECONOMY_HERBALIST={x:8,z:1,range:4.7};
export const ECONOMY_MENTOR={x:-1.5,z:-5,range:4.7};
export const ECONOMY_CHEST={...OFFLINE_CHEST,range:5.5};
export const ECONOMY_CAST_MS=GATHER_CAST_SECONDS*1000;
export const ECONOMY_RESPAWN_MS=GATHER_RESPAWN_SECONDS*1000;
const STOCK=new Set(MERCHANT_STOCK),MAX_GOLD=2147483647;
const invalid=(code='invalid_economy_action',status=400)=>{throw new ProgressError(code,status)};
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const int=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const clone=row=>row?{id:row.id,qty:row.qty}:null;

export function requireServerProximity(state,context,point,limit=4.7){
 // The context must be created from a VERIFIED server-side character position,
 // never forwarded from a browser. The rules enforce range independently.
 if(!obj(context)||context.radius!==state.worldRadius||
    state.worldRadius!==261||context.inCombat!==false||
    !Array.isArray(context.normal)||context.normal.length!==3||
    !context.normal.every(x=>typeof x==='number'&&Number.isFinite(x))||
    Math.abs(Math.hypot(...context.normal)-1)>.005)
  invalid('untrusted_interaction_context',403);
 const meters=arcDistance(context.normal,localToNormal(point.x,point.z,state.worldRadius),state.worldRadius);
 if(meters>limit)invalid('interaction_too_far',403);
 return true;
}
export function getGatherQuest(state){
 const raw=state.quests?.gather;
 if(raw===undefined)return {stage:0,accepted:false};
 if(!obj(raw)||!int(raw.stage,0,4)||typeof raw.accepted!=='boolean'||
    ((raw.stage===0||raw.stage===4)&&raw.accepted))
  invalid('corrupt_gather_quest');
 return {stage:raw.stage,accepted:raw.accepted};
}
const changeGather=(state,gather)=>({...state,quests:{...state.quests,gather}});
export function acceptGatherQuest(state){
 const quest=getGatherQuest(state);
 if(quest.stage===4||quest.accepted)invalid('quest_not_available',409);
 return changeGather(state,{stage:quest.stage===0?1:quest.stage,accepted:true});
}
export function gatherNode(stage,index){
 if(!int(stage,1,3)||!int(index,0,1000))invalid('invalid_gather_node');
 const row=GATHER_QUESTS[stage];
 const point=row?.locations[index];
 if(!point)invalid('unknown_gather_node');
 // Match the exact dry-shore adjustment of gather-world.js.
 let [x,z]=point,tries=0;
 while(lakeRadius(x,z)<1.23&&tries++<30){
  const dx=x-30,dz=z-26,length=Math.max(.1,Math.hypot(dx,dz));
  x+=dx/length;z+=dz/length;
 }
 return {nodeId:'gather:'+stage+':'+index,stage,index,itemId:row.item,x,z};
}
export function requireGatherAvailable(state,node,context){
 const quest=getGatherQuest(state);
 if(!quest.accepted||quest.stage!==node.stage)invalid('quest_not_active',409);
 const row=GATHER_QUESTS[node.stage];
 const count=countItem(state.inventory,row.item);
 if(count>=row.count)invalid('quest_ingredients_complete',409);
 requireServerProximity(state,context,node,GATHER_INTERACT_RANGE);
 return row;
}
export function countItem(inventory,id){
 return inventory.reduce((total,row)=>total+(row?.id===id?row.qty:0),0);
}
export function addOwnedStacks(inventory,drops){
 if(!Array.isArray(inventory)||inventory.length<12||inventory.length>108||!Array.isArray(drops))
  invalid('invalid_inventory');
 const bag=inventory.map(clone);
 for(const row of drops){
  if(!obj(row)||typeof row.id!=='string'||!int(row.qty,1,100))
   invalid('invalid_item_grant');
  if(!ITEM_CATALOG[row.id]&&row.id!=='healingPotion')
   invalid('unknown_item');
  let remaining=row.qty;
  const limit=ITEM_CATALOG[row.id]?itemStackLimit(row.id):20;
  for(const slot of bag)if(slot&&slot.id===row.id&&remaining){
   const n=Math.min(remaining,limit-slot.qty);
   slot.qty+=n;remaining-=n;
  }
  for(let i=0;i<bag.length&&remaining;i++)if(!bag[i]){
   const n=Math.min(remaining,limit);
   bag[i]={id:row.id,qty:n};remaining-=n;
  }
  if(remaining)invalid('inventory_full',409);
 }
 return bag;
}
export function consumeOwnedStacks(inventory,id,qty){
 if(!int(qty,1,100)||countItem(inventory,id)<qty)
  invalid('item_not_owned',409);
 let remaining=qty;
 const bag=inventory.map(clone);
 for(let i=0;i<bag.length&&remaining;i++){
  const row=bag[i];if(row?.id!==id)continue;
  const take=Math.min(remaining,row.qty);
  row.qty-=take;remaining-=take;
  if(row.qty===0)bag[i]=null;
 }
 if(remaining)invalid('item_not_owned',409);
 return bag;
}
export function buyFromMerchant(state,{itemId,qty},context){
 requireServerProximity(state,context,ECONOMY_VENDOR,ECONOMY_VENDOR.range);
 if(!int(qty,1,20)||typeof itemId!=='string')invalid('invalid_purchase');
 const isPotion=itemId==='healingPotion';
 const def=ITEM_CATALOG[itemId];
 if(!isPotion&&(!STOCK.has(itemId)||!def||!int(def.buy,1,100000)))
  invalid('item_not_for_sale');
 const unit=isPotion?10:def.buy,price=unit*qty;
 if(state.gold<price)invalid('not_enough_gold',409);
 if(def?.slot&&qty>20)invalid('invalid_purchase');
 const inventory=addOwnedStacks(state.inventory,[{id:itemId,qty}]);
 return {...state,gold:state.gold-price,inventory};
}
export function sellToMerchant(state,{bagSlot,qty},context){
 requireServerProximity(state,context,ECONOMY_VENDOR,ECONOMY_VENDOR.range);
 if(!int(bagSlot,0,state.inventory.length-1)||!int(qty,1,20))
  invalid('invalid_sale');
 const row=state.inventory[bagSlot],def=row&&ITEM_CATALOG[row.id];
 if(!row||!def||def.quest||!int(def.sell,1,100000)||qty>row.qty)
  invalid('item_not_sellable',409);
 const gold=state.gold+def.sell*qty;
 if(!int(gold,0,MAX_GOLD))invalid('gold_overflow',409);
 const inventory=state.inventory.map(clone);
 const balance=row.qty-qty;
 inventory[bagSlot]=balance?{id:row.id,qty:balance}:null;
 return {...state,gold,inventory};
}
export function turnInGatherQuest(state,context){
 requireServerProximity(state,context,ECONOMY_HERBALIST,ECONOMY_HERBALIST.range);
 const quest=getGatherQuest(state);
 if(!quest.accepted||quest.stage<1||quest.stage>3)
  invalid('quest_not_ready',409);
 const row=GATHER_QUESTS[quest.stage];
 const inventory=consumeOwnedStacks(state.inventory,row.item,row.count);
 const gold=state.gold+row.gold;
 if(!int(gold,0,MAX_GOLD))invalid('gold_overflow',409);
 const experience=addExperience(state.level,state.experience,row.xp);
 return {next:{...state,...experience,gold,inventory,
   quests:{...state.quests,gather:{stage:quest.stage+1,accepted:false}}},
  event:{eventKey:'gather:turnin:'+quest.stage,eventKind:'quest_reward',
   xp:row.xp,gold:row.gold,loot:[]}};
}
export function moveSharedChest(state,slots,{action,slot},context){
 requireServerProximity(state,context,ECONOMY_CHEST,ECONOMY_CHEST.range);
 if(action!=='deposit'&&action!=='withdraw'||!int(slot,0,action==='deposit'?state.inventory.length-1:CHEST_SLOTS-1))
  invalid('invalid_chest_action');
 if(!Array.isArray(slots)||slots.length!==CHEST_SLOTS||
    !slots.every(row=>row===null||cleanStack(row)))invalid('corrupt_shared_chest',503);
 const moved=transferChest(slots,state.inventory,action,slot);
 if(!moved.ok)invalid('chest_transfer_rejected',409);
 return {next:{...state,inventory:moved.inventory},slots:moved.slots,item:moved.item};
}
