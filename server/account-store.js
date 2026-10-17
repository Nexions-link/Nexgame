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
  const {rows}=await query("SELECT to_regclass('public.ngw_accounts') AS accounts, to_regclass('public.ngw_characters') AS characters, to_regclass('public.ngw_character_progress') AS progress, to_regclass('public.ngw_sessions') AS sessions, to_regclass('public.ngw_auth_rate_limits') AS limits");
  return !!(rows[0]?.accounts&&rows[0]?.characters&&rows[0]?.progress&&rows[0]?.sessions&&rows[0]?.limits);
 }
 async function createAccount(username,passwordHash,recoveryDigests){
  const normalized=normalizeUsername(username);
  if(!Array.isArray(recoveryDigests)||recoveryDigests.length!==8||
   !recoveryDigests.every(x=>Buffer.isBuffer(x)&&x.length===32))
   throw new TypeError('Требуется восемь резервных кодов');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   // Serialize account creation to enforce alpha capacity under concurrent requests.
   await client.query('SELECT pg_advisory_xact_lock(707010)');
   const maxAccounts=Number(process.env.NGW_MAX_ACCOUNTS||10);
   if(!Number.isInteger(maxAccounts)||maxAccounts<1||maxAccounts>500)
    throw new Error('Invalid NGW_MAX_ACCOUNTS configuration');
   const count=await client.query('SELECT count(*)::int AS used FROM ngw_accounts');
   if(count.rows[0].used>=maxAccounts)
    throw Object.assign(Error('Регистрация в альфе временно закрыта: лимит аккаунтов достигнут'),{status:409});
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
 async function consumeAuthRate(bucketKey,maxAttempts,windowSeconds){
  if(typeof bucketKey!=='string'||!/^[a-z]+(?:-[a-z]+)*:[0-9a-f]{64}$/.test(bucketKey)||
    !Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>1000||
    !Number.isInteger(windowSeconds)||windowSeconds<30||windowSeconds>86400)
   throw new TypeError('Incorrect auth throttle parameters');
  const {rows}=await query(`
   INSERT INTO ngw_auth_rate_limits (bucket_key,attempts,window_start,last_attempt_at)
    VALUES($1,1,now(),now())
   ON CONFLICT(bucket_key) DO UPDATE SET
    attempts=CASE WHEN ngw_auth_rate_limits.window_start <
      now() - ($2::int * INTERVAL '1 second') THEN 1
      ELSE ngw_auth_rate_limits.attempts + 1 END,
    window_start=CASE WHEN ngw_auth_rate_limits.window_start <
      now() - ($2::int * INTERVAL '1 second') THEN now()
      ELSE ngw_auth_rate_limits.window_start END,
    last_attempt_at=now()
   RETURNING attempts`,[bucketKey,windowSeconds]);
  return rows[0].attempts<=maxAttempts;
 }
 async function pruneAuthData(){
  // Safe cleanup: only expired/revoked sessions and expired rate counters.
  const sessions=await query(
   "DELETE FROM ngw_sessions WHERE expires_at < now() OR revoked_at < now() - INTERVAL '7 days'");
  const buckets=await query(
   "DELETE FROM ngw_auth_rate_limits WHERE last_attempt_at < now() - INTERVAL '2 days'");
  return {sessions:sessions.rowCount,buckets:buckets.rowCount};
 }
 async function passwordRecordById(accountId){
  const {rows}=await query(
   "SELECT id,username,password_hash,status FROM ngw_accounts WHERE id=$1 AND status='active'",
   [accountId]);
  return rows[0]||null;
 }
 async function changePassword(accountId,expectedHash,newHash){
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const result=await client.query(
    "UPDATE ngw_accounts SET password_hash=$1,updated_at=now() "+
    "WHERE id=$2 AND password_hash=$3 AND status='active' RETURNING id",
    [newHash,accountId,expectedHash]);
   if(!result.rowCount){await client.query('ROLLBACK');return false}
   await client.query(
    "UPDATE ngw_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL",
    [accountId]);
   await client.query('COMMIT');
   return true;
  }catch(error){try{await client.query('ROLLBACK')}catch{}throw error}
  finally{client.release()}
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
   const progress=await client.query('INSERT INTO ngw_character_progress(character_id) VALUES($1) RETURNING level,experience,gold',[row.id]);
   await client.query('COMMIT');
   return {...row,level:progress.rows[0].level,experience:progress.rows[0].experience,gold:progress.rows[0].gold};
  }catch(e){
   try{await client.query('ROLLBACK')}catch{}
   return dbError(e);
  }finally{client.release()}
 }
 // Soft deletion removes the hero from active slots without destroying their
 // progression. Lock the account, just as character creation does, to avoid
 // races between simultaneous delete and create requests.
 async function deleteCharacter(accountId,characterId,confirmNickname){
  if(typeof characterId!=='string'||!UUID.test(characterId)||
     typeof confirmNickname!=='string'||!confirmNickname||
     confirmNickname.length>24)return false;
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const owner=await client.query(
    "SELECT id FROM ngw_accounts WHERE id=$1 AND status='active' FOR UPDATE",
    [accountId]);
   if(!owner.rowCount){await client.query('ROLLBACK');return false;}
   const {rows}=await client.query(
    'UPDATE ngw_characters SET deleted_at=now() '+
    'WHERE id=$1 AND account_id=$2 AND deleted_at IS NULL AND nickname=$3 '+
    'RETURNING id',
    [characterId,accountId,confirmNickname]);
   await client.query('COMMIT');
   return rows.length===1;
  }catch(error){
   try{await client.query('ROLLBACK')}catch{}
   throw error;
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
  saveRecoveryCodes,consumeRecoveryCode,consumeAuthRate,pruneAuthData,
  passwordRecordById,changePassword,
  revokeSession,listCharacters,createCharacter,deleteCharacter,loadCharacter,close:()=>pool.end()};
}
