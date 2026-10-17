// NexGameWorld 0.7.2: server-only, revisioned PostgreSQL character progress.
// This module is deliberately NOT registered as an HTTP or WebSocket route.
// Call it only from a future authenticated, authoritative world controller.
import pg from 'pg';
import {
 assertCharacterId,parseRevision,readProgress,validateKillCredit,
 awardVerifiedKill,validateServerCheckpoint,equipOwnedItem,unequipOwnedItem,
 ProgressError
} from './progress-rules.js';
const {Pool}=pg;

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
 pool:externalPool=null}={}){
 if(!externalPool&&!connectionString)throw Error('Progress store requires DATABASE_URL');
 const pool=externalPool||new Pool({connectionString,
  connectionTimeoutMillis:6000,idleTimeoutMillis:30000,max:3,
  ssl:{rejectUnauthorized:true}});
 const ownsPool=!externalPool;
 const validateIds=(accountId,characterId)=>{
  assertCharacterId(accountId);assertCharacterId(characterId);
 };
 const select=async(client,accountId,characterId,locked=false)=>{
  const {rows}=await client.query(FIELDS+(locked?' FOR UPDATE OF p':''),[
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
 // Event MUST be produced by the trusted PvE process, never by a browser.
 // Identity is unique per hero, radius, mob and respawn life.
 async function recordMobKill({accountId,characterId,expectedRevision,
  radius,serverCredit}){
  const event=validateKillCredit(serverCredit,radius);
  return transaction(accountId,characterId,expectedRevision,async({client,state,save})=>{
   if(state.worldRadius!==radius)
    throw new ProgressError('wrong_world_radius',409);
   const duplicate=await client.query(
    'SELECT 1 FROM ngw_progress_events WHERE character_id=$1 AND event_key=$2',
    [characterId,event.eventKey]);
   if(duplicate.rowCount)
    return {applied:false,reason:'duplicate',progress:state};
   if(state.revision!==expectedRevision)throw conflict();
   const next=awardVerifiedKill(state,event);
   await client.query(
    ['INSERT INTO ngw_progress_events',
     '(character_id,event_key,event_kind,xp_granted,gold_granted,loot)',
     'VALUES($1,$2,$3,$4,$5,$6::jsonb)'].join(' '),
    [characterId,event.eventKey,event.eventKind,event.xp,event.gold,
     JSON.stringify(event.loot)]);
   return {applied:true,eventKey:event.eventKey,progress:await save(next)};
  });
 }
 // Call only AFTER server movement/speed/collision checks have passed.
 // This operation cannot change level, XP, gold, inventory or equipment.
 async function saveServerCheckpoint({accountId,characterId,expectedRevision,checkpoint}){
  return transaction(accountId,characterId,expectedRevision,async({state,save})=>{
   if(state.revision!==expectedRevision)throw conflict();
   const pos=validateServerCheckpoint(checkpoint,state.worldRadius);
   return {progress:await save({...state,...pos})};
  });
 }
 // The item must actually exist in the server-side saved inventory.
 async function equipInventoryItem({accountId,characterId,expectedRevision,
  bagSlot,equipmentSlot}){
  return transaction(accountId,characterId,expectedRevision,async({state,save})=>{
   if(state.revision!==expectedRevision)throw conflict();
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
  schemaReady,load,recordMobKill,saveServerCheckpoint,
  equipInventoryItem,unequipInventoryItem,
  close:()=>ownsPool?pool.end():Promise.resolve()
 };
}
