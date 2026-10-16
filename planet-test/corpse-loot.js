// Planet-only corpse lifetime and safe, opt-in looting.
// Nothing is moved to inventory just by opening or closing a corpse.
export const CORPSE_DURATION_SECONDS=30;
export const NORMAL_MOB_RESPAWN_SECONDS=30;
export function canStoreCorpseRow(inventory,row,stackLimit,slotCount=12){
 if(!Array.isArray(inventory)||!row||typeof row.id!=='string'||
  !Number.isInteger(row.qty)||row.qty<1)return false;
 const cap=Math.max(1,Math.floor(Number(stackLimit(row.id))||1));
 const existing=inventory.reduce((sum,slot)=>
  sum+(slot?.id===row.id?Math.max(0,cap-(slot.qty||0)):0),0);
 const empty=Math.max(0,slotCount-inventory.length);
 return existing+empty*cap>=row.qty;
}
export function takeCorpseRow(corpse,index,{inventory,stackLimit,store,slotCount=12}){
 if(!corpse?.corpse||!corpse.root?.visible||!Array.isArray(corpse.loot)||
  !Number.isInteger(index)||index<0||index>=corpse.loot.length)
  return {ok:false,reason:'unavailable'};
 const row=corpse.loot[index];
 if(!canStoreCorpseRow(inventory,row,stackLimit,slotCount))
  return {ok:false,reason:'full'};
 if(store(row.id,row.qty)!==true)
  return {ok:false,reason:'full'};
 corpse.loot.splice(index,1);
 return {ok:true,item:{id:row.id,qty:row.qty},remaining:corpse.loot.length};
}
export function takeAllCorpseRows(corpse,services){
 if(!corpse?.corpse||!corpse.root?.visible||!Array.isArray(corpse.loot))
  return {taken:[],remaining:0};
 const taken=[];
 // Iterate backwards to avoid skipping items after successful removal.
 for(let i=corpse.loot.length-1;i>=0;i--){
  const outcome=takeCorpseRow(corpse,i,services);
  if(outcome.ok)taken.push(outcome.item);
 }
 return {taken,remaining:corpse.loot.length};
}
