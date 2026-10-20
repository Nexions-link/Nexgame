// NexGameWorld 0.7.2: server-only, revisioned PostgreSQL character progress.
// This module is deliberately NOT registered as an HTTP or WebSocket route.
// Call it only from a future authenticated, authoritative world controller.
import {creditBanditQuestKill,creditBanditChiefKill} from './bandit-quest.js';
import {monsterKillExperience,DOLGONOG_BOSS_INDEX} from '../planet-test/mob-levels.js';
import {randomUUID} from 'node:crypto';
import {createResilientPgPool} from './postgres-pool.js';
import {getMentorQuest,certifyMentorKill} from './economy-rules.js';
import {
 assertCharacterId,parseRevision,readProgress,validateKillCredit,
 awardVerifiedKill,validateServerCheckpoint,validateServerVitals,equipOwnedItem,unequipOwnedItem,
 ProgressError,setActionBarSlot
} from './progress-rules.js';

const FIELDS=[
 'SELECT p.schema_version AS "schemaVersion",p.revision,p.level,p.experience,',
 'p.gold,p.health,p.resource,p.world_radius AS "worldRadius",',
 'p.position_normal AS "positionNormal",p.heading,p.inventory,',
 'p.equipment,p.quests,p.action_bar AS "actionBar"',
 'FROM ngw_character_progress p',
 'JOIN ngw_characters c ON c.id=p.character_id',
 'JOIN ngw_accounts a ON a.id=c.account_id',
 "WHERE p.character_id=$1 AND c.account_id=$2 AND c.deleted_at IS NULL",
 "AND a.status='active'"
].join(' ');
const missing=()=>new ProgressError('character_not_found',404);
const conflict=()=>new ProgressError('stale_revision',409);

export function createProgressStore({connectionString=process.env.DATABASE_URL,
 pool:externalPool=null,worldRunId=randomUUID()}={}){
 if(!externalPool&&!connectionString)throw Error('Progress store requires DATABASE_URL');
 const pool=externalPool||createResilientPgPool({connectionString,
  connectionTimeoutMillis:6000,idleTimeoutMillis:30000,max:3,
  ssl:{rejectUnauthorized:true}},{label:'progress'});
 const ownsPool=!externalPool;
 const validateIds=(accountId,characterId)=>{
  assertCharacterId(accountId);assertCharacterId(characterId);
 };
 const select=async(client,accountId,characterId,locked=false)=>{
  const {rows}=await client.query(FIELDS+(locked?' FOR UPDATE OF p,c':''),[
   characterId,accountId]);
  return rows[0]?readProgress(rows[0]):null;
 };
 async function write(client,characterId,original,next){
  const {rows}=await client.query(
   ['UPDATE ngw_character_progress SET',
    'revision=revision+1,level=$2,experience=$3,gold=$4,',
    'health=$5,resource=$6,world_radius=$7,',
    'position_normal=$8::jsonb,heading=$9,',
    'inventory=$10::jsonb,equipment=$11::jsonb,',
    'quests=$12::jsonb,action_bar=$13::jsonb,updated_at=now()',
    'WHERE character_id=$1 AND revision=$14',
    'RETURNING revision'].join(' '),
   [characterId,next.level,next.experience,next.gold,
    next.health,next.resource,next.worldRadius,
    JSON.stringify(next.positionNormal),next.heading,
    JSON.stringify(next.inventory),JSON.stringify(next.equipment),
    JSON.stringify(next.quests),JSON.stringify(next.actionBar),
    original.revision]);
  if(rows.length!==1)throw conflict();
  return {...next,revision:parseRevision(rows[0].revision)};
 }
 async function transaction(accountId,characterId,expectedRevision,handler){
  validateIds(accountId,characterId);
  parseRevision(expectedRevision);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const state=await select(client,accountId,characterId,true);
   if(!state)throw missing();
   const result=await handler({client,state,expectedRevision,
    save:next=>write(client,characterId,state,next)});
   await client.query('COMMIT');
   return result;
  }catch(error){
   try{await client.query('ROLLBACK')}catch{}
   throw error;
  }finally{client.release()}
 }
 async function schemaReady(){
  const {rows}=await pool.query(
   "SELECT to_regclass('public.ngw_character_progress') IS NOT NULL AS progress,"+
   " to_regclass('public.ngw_progress_events') IS NOT NULL AS events");
  return !!(rows[0]?.progress&&rows[0]?.events);
 }
 async function load(accountId,characterId){
  validateIds(accountId,characterId);
  const state=await select(pool,accountId,characterId);
  if(!state)throw missing();
  return state;
 }
 // Initialize a new Neon hero's server-owned starter pack exactly once.
 // Never import the old browser localStorage character.
 async function initializeStarterPack(accountId,characterId){
  validateIds(accountId,characterId);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const state=await select(client,accountId,characterId,true);
   if(!state)throw missing();
   const {rowCount}=await client.query(
    'SELECT 1 FROM ngw_progress_events WHERE character_id=$1 AND event_key=$2',
    [characterId,'starter:default:v1']);
   if(rowCount||state.revision!==0||state.inventory.some(Boolean)||
      Object.keys(state.equipment).length){
    await client.query('COMMIT');return state;
   }
   const loot=[{id:'wornAxe',qty:1},{id:'healingPotion',qty:3}];
   const inventory=[...loot,...Array(state.inventory.length-2).fill(null)];
   await client.query(
    ["INSERT INTO ngw_progress_events",
     "(character_id,event_key,event_kind,xp_granted,gold_granted,loot)",
     "VALUES($1,'starter:default:v1','starter_pack',0,0,$2::jsonb)"].join(' '),
    [characterId,JSON.stringify(loot)]);
   const saved=await write(client,characterId,state,{...state,inventory});
   await client.query('COMMIT');return saved;
  }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
  finally{client.release()}
 }
 // Event MUST be produced by the trusted PvE process, never by a browser.
 // Identity is unique per hero, radius, mob and respawn life.
 async function recordMobKill({accountId,characterId,expectedRevision,
  radius,serverCredit,deferLoot=false}){
  const event=validateKillCredit(serverCredit,radius,worldRunId);
  if(deferLoot)event.eventKey+=':corpse';
  return transaction(accountId,characterId,expectedRevision,async({client,state,save})=>{
   if(state.worldRadius!==radius)
    throw new ProgressError('wrong_world_radius',409);
   const duplicate=await client.query(
    'SELECT 1 FROM ngw_progress_events WHERE character_id=$1 AND event_key=$2',
    [characterId,event.eventKey]);
   if(duplicate.rowCount)
    return {applied:false,reason:'duplicate',progress:state};
   if(state.revision!==expectedRevision)throw conflict();
   let next=awardVerifiedKill(state,deferLoot?{...event,loot:[]}:event);
   next=creditBanditQuestKill(next,serverCredit.mobId);
    next=creditBanditChiefKill(next,serverCredit.mobId);
   // Quest kill objectives share the exact same transaction and world-run
   // identity as the reward: duplicate packets cannot advance objectives.
   const mentor=getMentorQuest(next);
   const boss=serverCredit.mobId==='dolgonog-'+DOLGONOG_BOSS_INDEX;
   if(serverCredit.mobId.startsWith('dolgonog-')&&((mentor.step===1&&!boss)||(mentor.step===10&&boss))){
    const credited=certifyMentorKill(next,serverCredit,worldRunId);
    await client.query(
     'INSERT INTO ngw_mentor_kill_evidence(character_id,event_key,quest_step) VALUES($1,$2,$3)',
     [characterId,credited.evidence.eventKey,credited.evidence.questStep]);
    next=credited.next;
   }
   await client.query(
    ['INSERT INTO ngw_progress_events',
     '(character_id,event_key,event_kind,xp_granted,gold_granted,loot)',
     'VALUES($1,$2,$3,$4,$5,$6::jsonb)'].join(' '),
    [characterId,event.eventKey,event.eventKind,
      monsterKillExperience(state.level,event.mobLevel,event.xp),0,
     JSON.stringify(event.loot)]);
   return {applied:true,eventKey:event.eventKey,progress:await save(next)};
  });
 }
 async function saveActionBarSlot({accountId,characterId,expectedRevision,slot,entry}){
  return transaction(accountId,characterId,expectedRevision,async({state,save})=>{
   if(state.revision!==expectedRevision)throw conflict();
   return {progress:await save(setActionBarSlot(state,slot,entry))};
  });
 }
 // Call only AFTER server movement/speed/collision checks have passed.
 // This operation cannot change level, XP, gold, inventory or equipment.
 async function saveServerCheckpoint({accountId,characterId,expectedRevision,checkpoint,serverVitals=null}){
  return transaction(accountId,characterId,expectedRevision,async({state,save})=>{
   if(state.revision!==expectedRevision)throw conflict();
   const pos=validateServerCheckpoint(checkpoint,state.worldRadius);
   const vitals=serverVitals===null?{}:validateServerVitals(serverVitals,state);
   return {progress:await save({...state,...pos,...vitals})};
  });
 }
 // The item must actually exist in the server-side saved inventory.
 // Consume an owned potion and heal using only SERVER vitals, not packet values.
 async function useHealingPotion({accountId,characterId,expectedRevision,currentHp,maxHp}){
  if(!Number.isFinite(currentHp)||!Number.isFinite(maxHp)||
     currentHp<=0||maxHp<=0||currentHp>=maxHp)
   throw new ProgressError('potion_not_needed',409);
  return transaction(accountId,characterId,expectedRevision,async({state,save})=>{
   if(state.revision!==expectedRevision)throw conflict();
   const slot=state.inventory.findIndex(row=>row?.id==='healingPotion'&&row.qty>0);
   if(slot<0)throw new ProgressError('item_not_owned',409);
   const inventory=state.inventory.map(row=>row?{...row}:null);
   inventory[slot].qty--;
   if(!inventory[slot].qty)inventory[slot]=null;
   // Simulation HP may be fractional (out-of-combat regeneration), but the
   // durable health column is INTEGER. Never pass fractional HP to PostgreSQL.
   const health=Math.round(Math.min(maxHp,currentHp+55));
   return {progress:await save({...state,inventory,health})};
  });
 }
 async function equipInventoryItem({accountId,characterId,expectedRevision,
  bagSlot,equipmentSlot}){
  return transaction(accountId,characterId,expectedRevision,async({state,save})=>{
   if(state.revision!==expectedRevision)throw conflict();
   if(state.inventory?.[bagSlot]?.id==='adminBattlefury'&&
     (characterId!=='ccfdf7dc-fdbf-4857-9d9f-5b8b0301fd98'||accountId!=='4aadebea-72c0-4987-839d-de5059a75f38'))
    throw new ProgressError('item_not_owned',403);
   return {progress:await save(equipOwnedItem(state,bagSlot,equipmentSlot))};
  });
 }
 async function unequipInventoryItem({accountId,characterId,expectedRevision,
  bagSlot,equipmentSlot}){
  return transaction(accountId,characterId,expectedRevision,async({state,save})=>{
   if(state.revision!==expectedRevision)throw conflict();
   return {progress:await save(unequipOwnedItem(state,equipmentSlot,bagSlot))};
  });
 }
 return {
  schemaReady,load,initializeStarterPack,recordMobKill,saveServerCheckpoint,saveActionBarSlot,
  equipInventoryItem,unequipInventoryItem,useHealingPotion,
  // Internal server-only transaction hook; never export via HTTP or WS.
  trustedTransaction:transaction,
  close:()=>ownsPool?pool.end():Promise.resolve()
 };
}
