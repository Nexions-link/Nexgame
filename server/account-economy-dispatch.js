// NexGameWorld authenticated-only action dispatcher.
// This module never accepts client-supplied ownership, position or revisions.
export function createAccountEconomyDispatcher({
 player,economyStore,progressStore,queueSave,publishProgress,send,
 broadcastChest=()=>{}
}){
 if(!player.accountId||!player.characterId||!economyStore||!progressStore)
  throw Error('Authenticated player and both stores required');
 let chestOpen=false;
 const closeChest=()=>{chestOpen=false};
 const invoke=(kind,message={})=>queueSave(async()=>{
  const params={accountId:player.accountId,characterId:player.characterId,
   expectedRevision:player.savedRevision};
  const context={normal:[...player.normal],radius:player.radius,
   inCombat:player.hp<=0||Date.now()-(player.lastCombatAt||0)<5000};
  try{
   let result;
   if(kind==='chestOpen'){
    const chest=await economyStore.readChest({...params,context});
    chestOpen=true;
    player.accountChestOpen=true;
    send({type:'chestState',...chest,inventory:player.savedInventory});
    return;
   }
   if(kind==='chestMove'){
    if(!chestOpen)throw Object.assign(Error('chest_not_open'),{code:'chest_not_open'});
    result=await economyStore.moveChest({...params,context,
     action:message.action,slot:message.slot,requestId:message.requestId});
   }else if(kind==='merchantBuy')result=await economyStore.buy({...params,context,
    itemId:message.itemId,qty:message.qty,requestId:message.requestId});
   else if(kind==='merchantSell')result=await economyStore.sell({...params,context,
    bagSlot:message.bagSlot,qty:message.qty,requestId:message.requestId});
   else if(kind==='equip'){
    if(context.inCombat)throw Object.assign(Error('equipment_combat_restricted'),{code:'equipment_combat_restricted'});
    result=await progressStore.equipInventoryItem({...params,
     bagSlot:message.bagSlot,equipmentSlot:message.equipmentSlot});
   }else if(kind==='unequip'){
    if(context.inCombat)throw Object.assign(Error('equipment_combat_restricted'),{code:'equipment_combat_restricted'});
    result=await progressStore.unequipInventoryItem({...params,
     bagSlot:message.bagSlot,equipmentSlot:message.equipmentSlot});
   }else if(kind==='gatherAccept')result=await economyStore.acceptGather({...params,context});
   else if(kind==='gatherStart')result=await economyStore.startGather({...params,context,
    stage:message.stage,index:message.index});
   else if(kind==='gatherFinish')result=await economyStore.finishGather({...params,context,
    stage:message.stage,index:message.index});
   else if(kind==='gatherTurnIn')result=await economyStore.turnInGather({...params,context});
   else if(kind==='mentorAccept')result=await economyStore.startMentor({...params,context});
   else if(kind==='mentorInteract')result=await economyStore.mentorInteract({...params,context,
    kind:message.interaction});
   else if(kind==='mentorTurnIn')result=await economyStore.turnInMentor({...params,context});
   else throw Object.assign(Error('unsupported_economy_action'),{code:'unsupported_economy_action'});
   if(result?.progress)publishProgress(result,kind);
   if(kind==='chestMove'){
    send({type:'chestResult',ok:true,requestId:message.requestId,
     revision:result.chest.revision,slots:result.chest.slots,
     inventory:result.progress.inventory,action:message.action});
    broadcastChest(result.chest);
   }else send({type:'economyResult',ok:true,kind,requestId:message.requestId||null,
    applied:result?.applied!==false,castMs:result?.castMs||null});
  }catch(error){
   const code=typeof error?.code==='string'&&/^[a-z_]{3,48}$/.test(error.code)?
    error.code:'server_save_failed';
   send({type:kind.startsWith('chest')?'chestResult':'economyResult',
    kind,ok:false,requestId:message.requestId||null,reason:code});
  }
 });
 return {invoke,closeChest,get chestOpen(){return chestOpen}};
}
