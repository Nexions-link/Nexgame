// Shared Hearth House chest. One authoritative 18-slot state per world server.
// All mutations are serialized in the Node event loop and saved before ACK.
import {readFileSync,writeFileSync,renameSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {ITEM_CATALOG,itemStackLimit} from '../items.js';

export const CHEST_SLOTS=18;
export const CHEST_X=-33.2,CHEST_Z=-7.4,CHEST_RANGE=5.5;
const validSlot=(slot,length)=>Number.isInteger(slot)&&slot>=0&&slot<length;
const copy=row=>row?{id:row.id,qty:row.qty}:null;
export function cleanStack(row){
 if(!row||typeof row!=='object'||Array.isArray(row))return null;
 const id=row.id,def=typeof id==='string'&&Object.hasOwn(ITEM_CATALOG,id)?ITEM_CATALOG[id]:null;
 if(!def||def.quest||!Number.isInteger(row.qty)||row.qty<1||row.qty>itemStackLimit(id))return null;
 return {id,qty:row.qty};
}
export function cleanInventory(value){
 if(!Array.isArray(value)||value.length<12||value.length>108)return null;
 const arr=[];
 for(const row of value){
  if(row==null){arr.push(null);continue}
  const safe=cleanStack(row);
  // Quest items may remain in a backpack, but may not enter the chest.
  if(!safe&&typeof row?.id==='string'&&Object.hasOwn(ITEM_CATALOG,row.id)&&ITEM_CATALOG[row.id].quest&&
   Number.isInteger(row.qty)&&row.qty>=1&&row.qty<=itemStackLimit(row.id)){
   arr.push({id:row.id,qty:row.qty});continue;
  }
  if(!safe)return null;
  arr.push(safe);
 }
 return arr;
}
const addStack=(slots,item)=>{
 const next=slots.map(copy);let remaining=item.qty;
 for(const row of next)if(row&&row.id===item.id&&remaining){
  const add=Math.min(itemStackLimit(item.id)-row.qty,remaining);
  row.qty+=add;remaining-=add;
 }
 for(let i=0;i<next.length&&remaining;i++)if(!next[i]){
  const add=Math.min(itemStackLimit(item.id),remaining);
  next[i]={id:item.id,qty:add};remaining-=add;
 }
 return remaining?null:next;
};
export function transferChest(slots,inventory,action,slot){
 if(!Array.isArray(slots)||slots.length!==CHEST_SLOTS||
  !Array.isArray(inventory)||!validSlot(slot,action==='deposit'?inventory.length:CHEST_SLOTS))
  return {ok:false,reason:'Неверная ячейка'};
 const takeFrom=action==='deposit'?inventory:slots;
 const putInto=action==='deposit'?slots:inventory;
 const item=cleanStack(takeFrom[slot]);
 if(!item)return {ok:false,reason:'Нельзя переместить этот предмет'};
 const filled=addStack(putInto,item);
 if(!filled)return {ok:false,reason:action==='deposit'?'В сундуке нет места':'В рюкзаке нет места'};
 const reduced=takeFrom.map(copy);reduced[slot]=null;
 return {ok:true,slots:action==='deposit'?filled:reduced,
  inventory:action==='deposit'?reduced:filled,item};
}
export function createSharedChest({filePath,send,broadcast,players}={}){
 let slots=Array(CHEST_SLOTS).fill(null),revision=0;
 const sessions=new Map();
 if(filePath){
  try{
   const stored=JSON.parse(readFileSync(filePath,'utf8'));
   if(Array.isArray(stored.slots)&&stored.slots.length===CHEST_SLOTS&&
      stored.slots.every(row=>row===null||cleanStack(row))){
    slots=stored.slots.map(copy);revision=Number.isSafeInteger(stored.revision)&&stored.revision>=0?stored.revision:0;
   }
  }catch(error){if(error.code!=='ENOENT')throw error}
 }
 const state=()=>({type:'chestState',revision,slots:slots.map(copy)});
 const reject=(id,reason,requestId)=>{send(id,{type:'chestResult',ok:false,reason,requestId});return false};
 const near=id=>{
  const p=players.get(id);
  return !!p&&Number.isFinite(p.x)&&Number.isFinite(p.z)&&Math.hypot(p.x-CHEST_X,p.z-CHEST_Z)<=CHEST_RANGE;
 };
 function open(id,inventory){
  if(!near(id))return reject(id,'Подойди ближе к сундуку');
  const snapshot=cleanInventory(inventory);
  if(!snapshot)return reject(id,'Не удалось проверить рюкзак');
  sessions.set(id,{inventory:snapshot});
  send(id,state());
  return true;
 }
 function move(id,{action,slot,requestId}={}){
  const s=sessions.get(id);
  if(!s||!near(id)){sessions.delete(id);return reject(id,'Нужно стоять возле сундука',requestId)}
  if(action!=='deposit'&&action!=='withdraw')return reject(id,'Неверное действие',requestId);
  if(typeof requestId!=='string'||requestId.length<8||requestId.length>80)return reject(id,'Неверный запрос',requestId);
  const moved=transferChest(slots,s.inventory,action,slot);
  if(!moved.ok)return reject(id,moved.reason,requestId);
  const nextRevision=revision+1;
  // Never report success until the canonical shared data was saved.
  if(filePath)try{
   mkdirSync(dirname(filePath),{recursive:true});
   const temp=filePath+'.tmp';
   writeFileSync(temp,JSON.stringify({revision:nextRevision,slots:moved.slots}),{mode:0o600});
   renameSync(temp,filePath);
  }catch(error){return reject(id,'Сервер не смог сохранить сундук',requestId)}
  slots=moved.slots;revision=nextRevision;s.inventory=moved.inventory;
  send(id,{type:'chestResult',ok:true,requestId,action,item:moved.item,
   inventory:s.inventory.map(copy),revision,slots:slots.map(copy)});
  broadcast(state());
  return true;
 }
 return {open,move,state,close:id=>sessions.delete(id),disconnect:id=>sessions.delete(id),
  hasSession:id=>sessions.has(id)};
}
