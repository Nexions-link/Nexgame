// NexGameWorld Alpha 0.7: durable account/character persistence.
// A database URL is read from Render only. Never send it to the browser.
// Do not enable routes in production before the schema migration is applied.
import {Pool} from 'pg';
import {normalizeEmail,validateCharacterOptions,CHARACTER_SLOT_LIMIT} from './account-rules.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function dbError(error){
 if(error?.code==='23505')throw Object.assign(Error('Этот адрес или ник уже занят'),{status:409});
 throw error;
}
export function createAccountStore({connectionString=process.env.DATABASE_URL,pool:providedPool=null}={}){
 if(!providedPool&&!connectionString)throw Error('DATABASE_URL is required');
 const pool=providedPool||new Pool({
  connectionString,connectionTimeoutMillis:6000,idleTimeoutMillis:30000,
  max:5,ssl:{rejectUnauthorized:true}
 });
 const query=(sql,params=[])=>pool.query(sql,params);
 async function ping(){await query('SELECT 1 AS ok');return true}
 async function schemaReady(){
  const {rows}=await query("SELECT to_regclass('public.ngw_accounts') AS accounts, to_regclass('public.ngw_characters') AS characters, to_regclass('public.ngw_character_progress') AS progress, to_regclass('public.ngw_sessions') AS sessions");
  return !!(rows[0]?.accounts&&rows[0]?.characters&&rows[0]?.progress&&rows[0]?.sessions);
 }
 async function createAccount(email,passwordHash){
  try{
   const {rows}=await query(
    'INSERT INTO ngw_accounts(email,password_hash) VALUES($1,$2) RETURNING id,email,created_at',
    [normalizeEmail(email),passwordHash]);
   return rows[0];
  }catch(e){return dbError(e)}
 }
 async function passwordRecord(email){
  const {rows}=await query(
   'SELECT id,email,password_hash,status,email_verified_at FROM ngw_accounts WHERE lower(email)=lower($1) LIMIT 1',
   [normalizeEmail(email)]);
  return rows[0]||null;
 }
 async function saveSession(accountId,digest,expiresAt){
  await query('INSERT INTO ngw_sessions(token_digest,account_id,expires_at) VALUES($1,$2,$3)',
   [digest,accountId,expiresAt]);
 }
 async function accountForSession(digest){
  const {rows}=await query(
   'SELECT a.id,a.email,a.email_verified_at,a.status FROM ngw_sessions s JOIN ngw_accounts a ON a.id=s.account_id WHERE s.token_digest=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND a.status=\'active\' LIMIT 1',
   [digest]);
  return rows[0]||null;
 }
 async function revokeSession(digest){
  await query('UPDATE ngw_sessions SET revoked_at=now() WHERE token_digest=$1 AND revoked_at IS NULL',
   [digest]);
 }
 async function listCharacters(accountId){
  const {rows}=await query(
   'SELECT c.id,c.nickname,c.race_id AS "raceId",c.class_id AS "classId",c.appearance,c.created_at AS "createdAt",p.level,p.world_radius AS "worldRadius" FROM ngw_characters c JOIN ngw_character_progress p ON p.character_id=c.id WHERE c.account_id=$1 AND c.deleted_at IS NULL ORDER BY c.created_at,c.id',
   [accountId]);
  return rows;
 }
 async function createCharacter(accountId,input){
  const character=validateCharacterOptions(input);
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const owner=await client.query(
    'SELECT id FROM ngw_accounts WHERE id=$1 AND status=\'active\' FOR UPDATE',[accountId]);
   if(!owner.rowCount)throw Object.assign(Error('Аккаунт не найден'),{status:401});
   const count=await client.query(
    'SELECT count(*)::int AS used FROM ngw_characters WHERE account_id=$1 AND deleted_at IS NULL',
    [accountId]);
   if(count.rows[0].used>=CHARACTER_SLOT_LIMIT)
    throw Object.assign(Error('Все слоты персонажей заняты'),{status:409});
   const created=await client.query(
    'INSERT INTO ngw_characters(account_id,nickname,race_id,class_id,appearance) VALUES($1,$2,$3,$4,$5::jsonb) RETURNING id,nickname,race_id AS "raceId",class_id AS "classId",appearance',
    [accountId,character.nickname,character.raceId,character.classId,
     JSON.stringify(character.appearance)]);
   const row=created.rows[0];
   await client.query('INSERT INTO ngw_character_progress(character_id) VALUES($1)',[row.id]);
   await client.query('COMMIT');
   return row;
  }catch(e){
   try{await client.query('ROLLBACK')}catch{}
   return dbError(e);
  }finally{client.release()}
 }
 async function loadCharacter(accountId,characterId){
  if(typeof characterId!=='string'||!UUID.test(characterId))return null;
  const {rows}=await query(
   'SELECT c.id,c.account_id AS "accountId",c.nickname,c.race_id AS "raceId",c.class_id AS "classId",c.appearance,p.schema_version AS "schemaVersion",p.revision,p.level,p.experience,p.gold,p.health,p.resource,p.world_radius AS "worldRadius",p.position_normal AS "positionNormal",p.heading,p.inventory,p.equipment,p.quests,p.action_bar AS "actionBar" FROM ngw_characters c JOIN ngw_character_progress p ON p.character_id=c.id WHERE c.id=$1 AND c.account_id=$2 AND c.deleted_at IS NULL LIMIT 1',
   [characterId,accountId]);
  return rows[0]||null;
 }
 return {ping,schemaReady,createAccount,passwordRecord,saveSession,accountForSession,
  revokeSession,listCharacters,createCharacter,loadCharacter,close:()=>pool.end()};
}
