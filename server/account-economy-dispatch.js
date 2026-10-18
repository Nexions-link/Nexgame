// NexGameWorld authenticated-only action dispatcher.
// This module never accepts client-supplied ownership, position or revisions.
export function createAccountEconomyDispatcher({
 player,economyStore,progressStore,queueSave,publishProgress,send,
 corpseContext=()=>{throw Object.assign(Error('corpse_unavailable'),{code:'corpse_unavailable'})},
 broadcastChest=()=>{}
}){
 if(!player.accountId||!player.characterId||!economyStore||!progressStore)
  throw Error('Authenticated player and both stores required');
 let chestOpen=false,chestEpoch=0;
 const closeChest=()=>{chestEpoch++;chestOpen=false;player.accountChestOpen=false};
 const invoke=(kind,message={})=>{
  const requestedEpoch=chestEpoch;
  return queueSave(async()=>{
  const params={accountId:player.accountId,characterId:player.characterId,
   expectedRevision:player.savedRevision};
  const context={normal:[...player.normal],radius:player.radius,
   inCombat:player.hp<=0||Date.now()-(player.lastCombatAt||0)<5000};
  try{
   let result;
   if(['lootOpen','lootInspect','lootTake'].includes(kind)){
    const corpse=corpseContext(message);
    if(kind==='lootTake'){
     result=await economyStore.takeCorpseLoot({...params,context,corpse,
      itemId:message.itemId,requestId:message.requestId});
     if(result.progress)publishProgress(result,kind);
    }
    const snapshot=await economyStore.readCorpseLoot({...params,context,corpse});
    send({type:'economyResult',ok:true,kind,mobId:corpse.mobId,life:corpse.life,
     loot:snapshot.loot,taken:result?.taken||[],requestId:message.requestId||null});
    return;
   }
   if(kind==='chestOpen'){
    if(requestedEpoch!==chestEpoch)return;
    const chest=await economyStore.readChest({...params,context});
    if(requestedEpoch!==chestEpoch)return;
    chestOpen=true;
    player.accountChestOpen=true;
    send({type:'chestState',...chest,inventory:player.savedInventory});
    return;
   }
   if(kind==='chestMove'){
    if(!chestOpen||requestedEpoch!==chestEpoch)
     throw Object.assign(Error('chest_not_open'),{code:'chest_not_open'});
    result=await economyStore.moveChest({...params,context,
     action:message.action,slot:message.slot,requestId:message.requestId});
   }else if(kind==='merchantBuy')result=await economyStore.buy({...params,context,
    itemId:message.itemId,qty:message.qty,requestId:message.requestId});
   else if(kind==='merchantSell')result=await economyStore.sell({...params,context,
    bagSlot:message.bagSlot,qty:message.qty,requestId:message.requestId});
   else if(kind==='hotbarSet')result=await progressStore.saveActionBarSlot({...params,slot:message.slot,entry:message.entry});
   else if(kind==='usePotion'){
    const now=Date.now();
    if(now-(player.lastPotionUseAt||0)<1500)
     throw Object.assign(Error('potion_cooldown'),{code:'potion_cooldown'});
    result=await progressStore.useHealingPotion({...params,
     currentHp:player.hp,maxHp:player.maxHp});
    player.lastPotionUseAt=now;
    player.hp=result.progress.health;
    send({type:'playerVitals',hp:player.hp,maxHp:player.maxHp,resource:player.resource});
   }else if(kind==='equip'){
    if(context.inCombat&&message.equipmentSlot!=='weapon')throw Object.assign(Error('equipment_combat_restricted'),{code:'equipment_combat_restricted'});
    result=await progressStore.equipInventoryItem({...params,
     bagSlot:message.bagSlot,equipmentSlot:message.equipmentSlot});
   }else if(kind==='unequip'){
    if(context.inCombat&&message.equipmentSlot!=='weapon')throw Object.assign(Error('equipment_combat_restricted'),{code:'equipment_combat_restricted'});
    result=await progressStore.unequipInventoryItem({...params,
     bagSlot:message.bagSlot,equipmentSlot:message.equipmentSlot});
   }else if(kind==='gatherAccept')result=await economyStore.acceptGather({...params,context});
   else if(kind==='gatherStart')result=await economyStore.startGather({...params,context,
    stage:message.stage,index:message.index});
   else if(kind==='gatherFinish')result=await economyStore.finishGather({...params,context,
    stage:message.stage,index:message.index});
   else if(kind==='gatherTurnIn')result=await economyStore.turnInGather({...params,context});
   else if(kind==='banditAccept')result=await economyStore.startBanditQuest({...params,context});
   else if(kind==='banditTurnIn')result=await economyStore.finishBanditQuest({...params,context});
   else if(kind==='mentorAccept')result=await economyStore.startMentor({...params,context});
   else if(kind==='mentorInteract')result=await economyStore.mentorInteract({...params,context,
    kind:message.interaction});
   else if(kind==='mentorTurnIn')result=await economyStore.turnInMentor({...params,context});
   else throw Object.assign(Error('unsupported_economy_action'),{code:'unsupported_economy_action'});
   if(result?.progress)publishProgress(result,kind);
   if(kind==='chestMove'){
    const snapshot=result.chest||await economyStore.readChest({...params,context});
    send({type:'chestResult',ok:true,requestId:message.requestId,
     revision:snapshot.revision,slots:snapshot.slots,
     inventory:result.progress.inventory,action:message.action,
     applied:result.applied!==false});
    if(result.applied!==false)broadcastChest(snapshot);
   }else send({type:'economyResult',ok:true,kind,requestId:message.requestId||null,
    applied:result?.applied!==false,castMs:result?.castMs||null});
  }catch(error){
   const code=typeof error?.code==='string'&&/^[a-z_]{3,48}$/.test(error.code)?
    error.code:'server_save_failed';
   // Preserve safe, actionable DB error codes in server logs without exposing
   // SQL details or character data to clients.
   if(code==='server_save_failed')
    console.error('NexGameWorld economy action failed:',kind,error?.code||error?.name||'unknown');
   send({type:kind.startsWith('chest')?'chestResult':'economyResult',
    kind,ok:false,requestId:message.requestId||null,reason:code});
  }
 });
 };
 return {invoke,closeChest,get chestOpen(){return chestOpen}};
}
