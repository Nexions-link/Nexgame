// Isolated server-only PostgreSQL economy. No HTTP or WebSocket routes.
// The controlling world server must authenticate/resolve the character and
// supply a validated live position, combat state and gather interaction.
import {createHash,randomUUID} from 'node:crypto';
import pg from 'pg';
import {createProgressStore} from './progress-store.js';
import {acceptBanditQuest,turnInBanditQuest} from './bandit-quest.js';
import {GATHER_CAST_SECONDS,GATHER_RESPAWN_SECONDS} from '../planet-test/gather-world.js';
import {assertCharacterId,validateKillCredit,ProgressError} from './progress-rules.js';
import {creatureById,creatureKillReward} from '../planet-test/creature-registry.js';
import {CORPSE_COIN_ID,isValidCorpseCoins} from '../planet-test/creature-types.js';
import {CORPSE_LOOT_RANGE} from '../planet-test/interaction-targeting.js';
import {
 ECONOMY_CHEST_ID,ECONOMY_CHEST,ECONOMY_HERBALIST,
 ECONOMY_VENDOR,
 getGatherQuest,acceptGatherQuest,gatherNode,requireGatherAvailable,
 acceptMentorQuest,certifyMentorKill,certifyMentorInteraction,turnInMentorQuest,
 requireServerProximity,addOwnedStacks,buyFromMerchant,sellToMerchant,
 turnInGatherQuest,moveSharedChest
} from './economy-rules.js';
const {Pool}=pg;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(code,status=409)=>{throw new ProgressError(code,status)};
const revision= (state,expected)=>{
 if(state.revision!==expected)fail('stale_revision');
};
export function createEconomyStore({pool:externalPool,
 connectionString=process.env.DATABASE_URL,worldRunId=randomUUID()}={}){
 if(!externalPool&&!connectionString)throw Error('Economy store requires DATABASE_URL');
 const pool=externalPool||new Pool({
  connectionString,connectionTimeoutMillis:6000,idleTimeoutMillis:30000,
  max:3,ssl:{rejectUnauthorized:true}
 });
 const progress=createProgressStore({pool});
 const transaction=(args,handler)=>progress.trustedTransaction(
  args.accountId,args.characterId,args.expectedRevision,handler);
 async function ready(){
  const {rows}=await pool.query(
   "SELECT to_regclass('public.ngw_shared_chests') IS NOT NULL AS chest,"+
   "to_regclass('public.ngw_economy_receipts') IS NOT NULL AS receipts,"+
   "to_regclass('public.ngw_gather_nodes') IS NOT NULL AS nodes,"+
   "to_regclass('public.ngw_gather_casts') IS NOT NULL AS casts,to_regclass('public.ngw_mentor_kill_evidence') IS NOT NULL AS mentor");
  return Object.values(rows[0]||{}).every(Boolean);
 }
 function receiptDetails(args,kind,payload){
  if(typeof args.requestId!=='string'||!UUID.test(args.requestId))
   fail('invalid_request_id',400);
  return {kind,digest:createHash('sha256').update(JSON.stringify({kind,payload})).digest()};
 }
 async function executeReceipt(args,kind,payload,perform){
  const {digest}=receiptDetails(args,kind,payload);
  return transaction(args,async({client,state,save})=>{
   const prior=await client.query(
    'SELECT action_kind,payload_digest FROM ngw_economy_receipts WHERE character_id=$1 AND request_id=$2',
    [args.characterId,args.requestId]);
   if(prior.rowCount){
    const known=prior.rows[0];
    if(known.action_kind!==kind||!known.payload_digest.equals(digest))
     fail('idempotency_key_conflict');
    return {applied:false,reason:'duplicate',progress:state};
   }
   revision(state,args.expectedRevision);
   const operation=await perform({client,state});
   await client.query(
    'INSERT INTO ngw_economy_receipts(character_id,request_id,action_kind,payload_digest) VALUES($1,$2,$3,$4)',
    [args.characterId,args.requestId,kind,digest]);
   const saved=await save(operation.next);
   return {applied:true,progress:saved,...operation.result};
  });
 }
 // Corpse rewards live only for the current server-world epoch and mob life.
 // The :corpse suffix excludes older kills already auto-granted to inventory.
 function corpseKey({mobId,life,radius}){
  const spec=creatureById(mobId);
  if(!spec)fail('unknown_mob');
  return validateKillCredit({type:'killCredit',mobId,life,
   xp:creatureKillReward(spec).xp,gold:0,loot:[]},radius,worldRunId).eventKey+':corpse';
 }
 function checkCorpse(state,args){
  const corpse=args.corpse;
  if(!corpse||corpse.radius!==state.worldRadius)fail('corpse_unavailable');
  requireServerProximity(state,{...args.context,inCombat:false},corpse,CORPSE_LOOT_RANGE);
  return corpseKey(corpse);
 }
 async function readCorpseLoot(args){
  const state=await progress.load(args.accountId,args.characterId);
  const key=checkCorpse(state,args);
  const {rows}=await pool.query(
   'SELECT loot FROM ngw_progress_events WHERE character_id=$1 AND event_key=$2',
   [args.characterId,key]);
  return {loot:rows[0]?.loot||[]};
 }
 async function takeCorpseLoot(args){
  const key=corpseKey(args.corpse),itemId=args.itemId??null;
  if(itemId!==null&&typeof itemId!=='string')fail('invalid_loot_item');
  return transaction(args,async({client,state,save})=>{
   checkCorpse(state,args);
   const {rows}=await client.query(
    'SELECT loot FROM ngw_progress_events WHERE character_id=$1 AND event_key=$2 FOR UPDATE',
    [args.characterId,key]);
   if(!rows.length)fail('corpse_not_owned');
   // The locked transaction removes pending stacks and grants inventory
   // together. A retried command cannot grant the same stack twice.
   if(!rows[0].loot.length||(itemId!==null&&!rows[0].loot.some(row=>row.id===itemId)))
    return {applied:false,progress:state,loot:rows[0].loot,taken:[]};
   revision(state,args.expectedRevision);
   let inventory=state.inventory,remaining=[],taken=[],gold=state.gold;
   for(const row of rows[0].loot){
    if(itemId!==null&&row.id!==itemId){remaining.push(row);continue;}
    try{
     if(row.id===CORPSE_COIN_ID){
      if(!isValidCorpseCoins(row))fail('invalid_loot_item');
      if(gold>2147483647-row.qty)fail('gold_overflow');
      gold+=row.qty;taken.push(row);
     }else{inventory=addOwnedStacks(inventory,[row]);taken.push(row)}
    }
    catch(error){if(error.code!=='inventory_full')throw error;remaining.push(row)}
   }
   if(!taken.length)fail(rows[0].loot.length?'inventory_full':'corpse_empty');
   await client.query(
    'UPDATE ngw_progress_events SET loot=$3::jsonb,gold_granted=gold_granted+$4 WHERE character_id=$1 AND event_key=$2',
    [args.characterId,key,JSON.stringify(remaining),gold-state.gold]);
   return {applied:true,progress:await save({...state,inventory,gold}),loot:remaining,taken};
  });
 }
 async function buy(args){
  const {itemId,qty,context}=args;
  return executeReceipt(args,'merchant_buy',{itemId,qty},async({state})=>({
   next:buyFromMerchant(state,{itemId,qty},context)
  }));
 }
 async function sell(args){
  const {bagSlot,qty,context}=args;
  return executeReceipt(args,'merchant_sell',{bagSlot,qty},async({state})=>({
   next:sellToMerchant(state,{bagSlot,qty},context)
  }));
 }
 async function readChest({accountId,characterId,context}){
  assertCharacterId(accountId);assertCharacterId(characterId);
  const state=await progress.load(accountId,characterId);
  requireServerProximity(state,context,ECONOMY_CHEST,ECONOMY_CHEST.range);
  const {rows}=await pool.query(
   'SELECT revision,slots FROM ngw_shared_chests WHERE chest_id=$1',[ECONOMY_CHEST_ID]);
  if(!rows.length)fail('shared_chest_missing',503);
  return {revision:Number(rows[0].revision),slots:rows[0].slots};
 }
 async function readChestStatus(){
   // Public occupancy only. Inventory item IDs remain on the protected route.
   const {rows}=await pool.query(
    'SELECT revision,slots FROM ngw_shared_chests WHERE chest_id=$1',[ECONOMY_CHEST_ID]);
   if(!rows.length)fail('shared_chest_missing',503);
   return {revision:Number(rows[0].revision),
    occupied:rows[0].slots.filter(Boolean).length,total:ECONOMY_CHEST.slots};
  }
  async function moveChest(args){
  const {action,slot,context}=args;
  const kind=action==='deposit'?'chest_deposit':
   action==='withdraw'?'chest_withdraw':null;
  if(!kind)fail('invalid_chest_action',400);
  return executeReceipt(args,kind,{action,slot},async({client,state})=>{
   const result=await client.query(
    'SELECT revision,slots FROM ngw_shared_chests WHERE chest_id=$1 FOR UPDATE',
    [ECONOMY_CHEST_ID]);
   if(!result.rowCount)fail('shared_chest_missing',503);
   const original=result.rows[0];
   const moved=moveSharedChest(state,original.slots,{action,slot},context);
   const updated=await client.query(
    "UPDATE ngw_shared_chests SET slots=$2::jsonb,revision=revision+1,updated_at=now() WHERE chest_id=$1 RETURNING revision",
    [ECONOMY_CHEST_ID,JSON.stringify(moved.slots)]);
   return {next:moved.next,result:{
    chest:{revision:Number(updated.rows[0].revision),slots:moved.slots},
    item:moved.item
   }};
  });
 }
 async function acceptGather(args){
  const {context}=args;
  return transaction(args,async({state,save})=>{
   revision(state,args.expectedRevision);
   requireServerProximity(state,context,ECONOMY_HERBALIST,ECONOMY_HERBALIST.range);
   const next=acceptGatherQuest(state);
   return {progress:await save(next)};
  });
 }
 async function startGather(args){
  const {stage,index,context}=args;
  const node=gatherNode(stage,index);
  return transaction(args,async({client,state})=>{
   revision(state,args.expectedRevision);
   requireGatherAvailable(state,node,context);
   await client.query(
    'INSERT INTO ngw_gather_nodes(node_id) VALUES($1) ON CONFLICT DO NOTHING',
    [node.nodeId]);
   const {rows}=await client.query(
    "SELECT ready_at<=now() AS ready FROM ngw_gather_nodes WHERE node_id=$1 FOR UPDATE",
    [node.nodeId]);
   if(!rows[0]?.ready)fail('gather_node_respawning');
   await client.query(
    ["INSERT INTO ngw_gather_casts(character_id,node_id,started_at,expires_at)",
     "VALUES($1,$2,now(),now()+INTERVAL '20 seconds')",
     "ON CONFLICT(character_id) DO UPDATE SET node_id=$2,started_at=now(),",
     "expires_at=now()+INTERVAL '20 seconds'"].join(' '),
    [args.characterId,node.nodeId]);
   return {started:true,nodeId:node.nodeId,castMs:GATHER_CAST_SECONDS*1000};
  });
 }
 async function finishGather(args){
  const {stage,index,context}=args;
  const node=gatherNode(stage,index);
  return transaction(args,async({client,state,save})=>{
   revision(state,args.expectedRevision);
   requireGatherAvailable(state,node,context);
   const casting=await client.query(
    ["SELECT node_id,now()>=started_at+($2::double precision * INTERVAL '1 second') AS finished,",
     "expires_at>now() AS active FROM ngw_gather_casts",
     "WHERE character_id=$1 FOR UPDATE"].join(' '),
    [args.characterId,GATHER_CAST_SECONDS]);
   if(!casting.rowCount||casting.rows[0].node_id!==node.nodeId)
    fail('gather_cast_not_started');
   if(!casting.rows[0].active)fail('gather_cast_expired');
   if(!casting.rows[0].finished)fail('gather_cast_in_progress');
   const ready=await client.query(
    'SELECT ready_at<=now() AS ready FROM ngw_gather_nodes WHERE node_id=$1 FOR UPDATE',
    [node.nodeId]);
   if(!ready.rows[0]?.ready)fail('gather_node_respawning');
   const inventory=addOwnedStacks(state.inventory,[{id:node.itemId,qty:1}]);
   await client.query(
    "UPDATE ngw_gather_nodes SET ready_at=now()+($2::int*INTERVAL '1 second'),updated_at=now() WHERE node_id=$1",
    [node.nodeId,GATHER_RESPAWN_SECONDS]);
   await client.query('DELETE FROM ngw_gather_casts WHERE character_id=$1',[args.characterId]);
   const saved=await save({...state,inventory});
   return {progress:saved,item:{id:node.itemId,qty:1},nodeId:node.nodeId};
  });
 }
 async function turnInGather(args){
  const {context}=args;
  return transaction(args,async({client,state,save})=>{
   revision(state,args.expectedRevision);
   const {next,event}=turnInGatherQuest(state,context);
   const existing=await client.query(
    'SELECT 1 FROM ngw_progress_events WHERE character_id=$1 AND event_key=$2',
    [args.characterId,event.eventKey]);
   if(existing.rowCount)fail('quest_already_rewarded');
   await client.query(
    ["INSERT INTO ngw_progress_events",
     "(character_id,event_key,event_kind,xp_granted,gold_granted,loot)",
     "VALUES($1,$2,$3,$4,$5,'[]'::jsonb)"].join(' '),
    [args.characterId,event.eventKey,event.eventKind,event.xp,event.gold]);
   const saved=await save(next);
   return {progress:saved,reward:{xp:event.xp,gold:event.gold},
    nextStage:getGatherQuest(saved).stage};
  });
 }
 async function startBanditQuest(args){
  return transaction(args,async({state,save})=>{
   revision(state,args.expectedRevision);
   return {progress:await save(acceptBanditQuest(state,args.context))};
  });
 }
 async function finishBanditQuest(args){
  return transaction(args,async({client,state,save})=>{
   revision(state,args.expectedRevision);
   const {next,event}=turnInBanditQuest(state,args.context);
   const already=await client.query(
    'SELECT 1 FROM ngw_progress_events WHERE character_id=$1 AND event_key=$2',
    [args.characterId,event.eventKey]);
   if(already.rowCount)fail('bandit_quest_already_paid');
   await client.query(
    ["INSERT INTO ngw_progress_events",
     "(character_id,event_key,event_kind,xp_granted,gold_granted,loot)",
     "VALUES($1,$2,$3,$4,$5,'[]'::jsonb)"].join(' '),
    [args.characterId,event.eventKey,event.eventKind,event.xp,event.gold]);
   return {progress:await save(next),reward:{xp:event.xp,gold:event.gold}};
  });
 }
 async function startMentor(args){
  const {context}=args;
  return transaction(args,async({state,save})=>{
   revision(state,args.expectedRevision);
   return {progress:await save(acceptMentorQuest(state,context))};
  });
 }
 async function mentorInteract(args){
  const {kind,context}=args;
  return transaction(args,async({state,save})=>{
   revision(state,args.expectedRevision);
   return {progress:await save(certifyMentorInteraction(state,kind,context))};
  });
 }
 async function recordMentorKill(args){
  const {serverCredit}=args;
  return transaction(args,async({client,state,save})=>{
   // Check the durable ledger before testing a potentially already-advanced
   // quest state, so repeated PvE packets never increment objective counts.
   const credit=validateKillCredit(serverCredit,state.worldRadius,worldRunId);
   const existing=await client.query(
    'SELECT 1 FROM ngw_mentor_kill_evidence WHERE character_id=$1 AND event_key=$2',
    [args.characterId,credit.eventKey]);
   if(existing.rowCount)return {applied:false,reason:'duplicate',progress:state};
   revision(state,args.expectedRevision);
   const {next,evidence}=certifyMentorKill(state,serverCredit,worldRunId);
   await client.query(
    'INSERT INTO ngw_mentor_kill_evidence(character_id,event_key,quest_step) VALUES($1,$2,$3)',
    [args.characterId,evidence.eventKey,evidence.questStep]);
   return {applied:true,progress:await save(next)};
  });
 }
 async function turnInMentor(args){
  const {context}=args;
  return transaction(args,async({client,state,save})=>{
   revision(state,args.expectedRevision);
   const {next,event}=turnInMentorQuest(state,context);
   const existing=await client.query(
    'SELECT 1 FROM ngw_progress_events WHERE character_id=$1 AND event_key=$2',
    [args.characterId,event.eventKey]);
   if(existing.rowCount)fail('mentor_reward_already_paid');
   await client.query(
    ["INSERT INTO ngw_progress_events",
     "(character_id,event_key,event_kind,xp_granted,gold_granted,loot)",
     "VALUES($1,$2,$3,$4,$5,'[]'::jsonb)"].join(' '),
    [args.characterId,event.eventKey,event.eventKind,event.xp,event.gold]);
   return {progress:await save(next),
    reward:{xp:event.xp,gold:event.gold}};
  });
 }
 return {
  schemaReady:ready,buy,sell,readCorpseLoot,takeCorpseLoot,readChest,readChestStatus,moveChest,
  acceptGather,startGather,finishGather,turnInGather,
  startMentor,mentorInteract,recordMentorKill,turnInMentor,
  startBanditQuest,finishBanditQuest,
  close:()=>externalPool?Promise.resolve():pool.end()
 };
}
