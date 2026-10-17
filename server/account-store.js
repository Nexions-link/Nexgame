// NexGameWorld Alpha 0.7: durable account/character persistence.
// A database URL is read from Render only. Never send it to the browser.
// Do not enable routes in production before the schema migration is applied.
import pg from 'pg';
const {Pool}=pg;
import {normalizeUsername,validateCharacterOptions,CHARACTER_SLOT_LIMIT} from './account-rules.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function dbError(error){
 if(error?.code==='23505')throw Object.assign(Error('Этот логин или ник уже занят'),{status:409});
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
 async function createAccount(username,passwordHash,recoveryDigests){
  const normalized=normalizeUsername(username);
  if(!Array.isArray(recoveryDigests)||recoveryDigests.length!==8||
   !recoveryDigests.every(x=>Buffer.isBuffer(x)&&x.length===32))
   throw new TypeError('Требуется восемь резервных кодов');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const result=await client.query(
    'INSERT INTO ngw_accounts(username,password_hash) VALUES($1,$2) RETURNING id,username,created_at',
    [normalized,passwordHash]);
   const account=result.rows[0];
   for(const digest of recoveryDigests){
    await client.query('INSERT INTO ngw_recovery_codes(code_digest,account_id) VALUES($1,$2)',[digest,account.id]);
   }
   await client.query('COMMIT');
   return account;
  }catch(error){
   try{await client.query('ROLLBACK')}catch{}
   return dbError(error);
  }finally{client.release()}
 }
 async function passwordRecord(username){
  const {rows}=await query(
   'SELECT id,username,password_hash,status FROM ngw_accounts WHERE lower(username)=lower($1) LIMIT 1',
   [normalizeUsername(username)]);
  return rows[0]||null;
 }
 async function saveSession(accountId,digest,expiresAt){
  await query('INSERT INTO ngw_sessions(token_digest,account_id,expires_at) VALUES($1,$2,$3)',
   [digest,accountId,expiresAt]);
 }
 async function accountForSession(digest){
  const {rows}=await query(
   'SELECT a.id,a.username,a.status FROM ngw_sessions s JOIN ngw_accounts a ON a.id=s.account_id WHERE s.token_digest=$1 AND s.revoked_at IS NULL AND s.expires_at > now() AND a.status=\'active\' LIMIT 1',
   [digest]);
  return rows[0]||null;
 }
 async function saveRecoveryCodes(accountId,digests){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await client.query('DELETE FROM ngw_recovery_codes WHERE account_id=$1',[accountId]);
   for(const digest of digests){
    await client.query('INSERT INTO ngw_recovery_codes(code_digest,account_id) VALUES($1,$2)',[digest,accountId]);
   }
   await client.query('COMMIT');
  }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
  finally{client.release()}
 }
 async function consumeRecoveryCode(username,digest,newPasswordHash){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const user=await client.query("SELECT id FROM ngw_accounts WHERE lower(username)=lower($1) AND status='active' FOR UPDATE",[normalizeUsername(username)]);
   if(!user.rowCount){await client.query('ROLLBACK');return false}
   const id=user.rows[0].id;
   const codes=await client.query('UPDATE ngw_recovery_codes SET used_at=now() WHERE account_id=$1 AND code_digest=$2 AND used_at IS NULL RETURNING code_digest',[id,digest]);
   if(!codes.rowCount){await client.query('ROLLBACK');return false}
   await client.query('UPDATE ngw_accounts SET password_hash=$1,updated_at=now() WHERE id=$2',[newPasswordHash,id]);
   await client.query('UPDATE ngw_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL',[id]);
   await client.query('COMMIT');
   return true;
  }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
  finally{client.release()}
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
  saveRecoveryCodes,consumeRecoveryCode,
  revokeSession,listCharacters,createCharacter,loadCharacter,close:()=>pool.end()};
}
