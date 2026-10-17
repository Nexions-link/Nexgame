// NexGameWorld Alpha 0.6.30 — one active spherical-world WebSocket server.
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {existsSync,unlinkSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {createSphericalWorld,SPHERE_PROTOCOL} from './spherical-world.js';
import {createAccountStore} from './account-store.js';
import {createAccountApi} from './account-api.js';
import {createWorldSessionGate} from './world-session-gate.js';
import {createProgressStore} from './progress-store.js';
import {runAccountSmoke} from './account-smoke.js';
const PORT=Number(process.env.PORT||3000),BUILD='0.6.32';
const configuredOrigins=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
const origins=new Set([...configuredOrigins,'https://nexions.ru',
 'https://www.nexions.ru','https://nexions-link.github.io']);
const previousFile=resolve(process.env.CHEST_DATA_FILE||'chest-data.json');
const activeFile=resolve(process.env.NGW_CHEST_DATA_FILE||
 join(dirname(previousFile),'nexgameworld-chest.json'));
const world=createSphericalWorld({chestFilePath:activeFile});
// Retire old NexGame persistent chest. Never touch the new NGW file.
let legacyCleanup='not_found';
if(previousFile!==activeFile){
 try{if(existsSync(previousFile)){unlinkSync(previousFile);legacyCleanup='removed';}}
 catch(error){legacyCleanup='error';console.error('Legacy chest cleanup error',error);}
}else legacyCleanup='skipped_same_storage_path';
// One-shot, read-only Neon check; never log the URL, credentials or data.
async function verifyNeonConnection(){
 if(!process.env.DATABASE_URL)return;
 let pool;
 try{
  const {default:pg}=await import('pg');
  pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
   ssl:{rejectUnauthorized:true},connectionTimeoutMillis:12000,max:1});
  await pool.query('SELECT 1 AS healthy');
  console.log('NexGameWorld Neon connection: ok');
  const schemaPresent=async()=>{
   const {rows}=await pool.query("SELECT to_regclass('public.ngw_accounts') AS accounts, to_regclass('public.ngw_sessions') AS sessions, to_regclass('public.ngw_characters') AS characters, to_regclass('public.ngw_character_progress') AS progress");
   return !!(rows[0]?.accounts&&rows[0]?.sessions&&rows[0]?.characters&&rows[0]?.progress);
  };
  let ready=await schemaPresent();
  if(!ready&&process.env.NGW_ACCOUNTS_MIGRATE==='yes'){
   const sql=await readFile(new URL('./migrations/001_accounts_characters.sql',import.meta.url),'utf8');
   await pool.query(sql);
   ready=await schemaPresent();
   console.log('NexGameWorld account tables:',ready?'created':'not_ready');
  }else console.log('NexGameWorld account tables:',ready?'ready':'not_created');
 }catch(error){
  console.error('NexGameWorld Neon connection: failed',error?.code||error?.name||'unknown');
 }finally{
  if(pool)try{await pool.end()}catch{}
 }
}
void verifyNeonConnection();
let accountStore=null, accountApi=null;
let authenticatedWorldGate=null,worldProgressStore=null;
let accountCleanupTimer=null;
let accountDbStatus=process.env.DATABASE_URL?'checking':'not_configured';
async function initializeAccounts(){
 if(!process.env.DATABASE_URL)return;
 try{
  accountStore=createAccountStore();
  await accountStore.ping();
  const ready=await accountStore.schemaReady();
  accountDbStatus=ready?'ready':'schema_missing';
  if(ready){
   accountCleanupTimer=setInterval(async()=>{
    try{await accountStore.pruneAuthData()}
    catch(error){console.error('NexGameWorld auth cleanup error:',error?.code||error?.name||'unknown')}
   },60*60*1000);
   accountCleanupTimer.unref?.();
  }
  if(ready&&process.env.NGW_ACCOUNTS_ENABLED==='true'){
   accountApi=createAccountApi({store:accountStore});
   console.log('NexGameWorld account API enabled');
   // The new authenticated route is opt-in until durable game progression
   // and authoritative chest/quest integrations have passed full tests.
   if(process.env.NGW_AUTH_WORLD_ENABLED==='true'){
    worldProgressStore=createProgressStore();
    if(!await worldProgressStore.schemaReady())throw Error('Progress event ledger is not ready');
    authenticatedWorldGate=createWorldSessionGate({accountStore,progressStore:worldProgressStore});
    console.log('NexGameWorld authenticated world gateway enabled');
   }
  }
 }catch(error){
  accountDbStatus='unavailable';
  console.error('NexGameWorld account API unavailable:',error?.code||error?.name||'unknown');
 }
}
const accountsReady=initializeAccounts();
const http=createServer((req,res)=>{
 if(req.url?.split('?')[0]==='/health'){
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({ok:true,world:'nexgameworld',
   players:world.population(),sphericalPlayers:world.population(),mobs:world.mobCount(),
   protocol:SPHERE_PROTOCOL,build:BUILD,legacyCleanup,
   databaseConfigured:Boolean(process.env.DATABASE_URL),
   accountDbStatus,accountApiEnabled:!!accountApi,
   authenticatedWorldEnabled:!!authenticatedWorldGate}));return;
 }
 if(req.url?.split('?')[0]?.startsWith('/api/ngw/')){
  if(accountApi){
   void accountApi(req,res).catch(error=>{
    console.error('NexGameWorld account request failed:',error?.code||error?.name||'unknown');
    if(!res.headersSent){
     res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});
     res.end(JSON.stringify({error:'Временная ошибка сервера'}));
    }
   });
   return;
  }
  res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({error:'Система регистрации ещё не включена'}));return;
 }
 res.writeHead(410,{'content-type':'text/plain','cache-control':'no-store'});
 res.end('Archived NexGame server is retired. Use NexGameWorld.');
});
const wss=new WebSocketServer({server:http,maxPayload:8192,
 verifyClient:({origin},done)=>done(!origin||origins.has(origin)||(!configuredOrigins.length&&origin.startsWith('https://')))});
wss.on('connection',(ws,req)=>{
 const path=req.url?.split('?')[0];
 if(path==='/ws/nexgameworld/auth'){
  if(!authenticatedWorldGate){
   ws.close(1013,'Authenticated world is not yet enabled');return;
  }
  let attempted=false;
  const deadline=setTimeout(()=>ws.close(1008,'Authentication required'),10000);
  deadline.unref?.();
  ws.once('message',async raw=>{
   if(attempted)return;
   attempted=true;clearTimeout(deadline);
   let message;
   try{message=JSON.parse(String(raw))}catch{ws.close(1008,'Malformed auth handshake');return}
   if(!message||message.type!=='authJoin'||typeof message.sessionToken!=='string'||
      typeof message.characterId!=='string'){
    ws.close(1008,'Invalid auth handshake');return;
   }
   try{
    const trusted=await authenticatedWorldGate.enter(ws,message);
    if(ws.readyState!==1){authenticatedWorldGate.leave(ws);return}
    const attached=world.attach(ws,{trustedCharacter:trusted,
     progressStore:worldProgressStore});
    ws.once('close',()=>{
     // Keep a character lease while outstanding committed rewards/position
     // writes finish. Never allow concurrent reconnect to race the last save.
     Promise.resolve(attached.drain()).finally(()=>authenticatedWorldGate.leave(ws));
    });
    // Synthetic join is generated from trusted Neon state only.
    ws.emit('message',Buffer.from(JSON.stringify({type:'join'})));
   }catch(error){
    authenticatedWorldGate.leave(ws);
    ws.close(1008,'Account or character authorization failed');
   }
  });
  ws.once('close',()=>clearTimeout(deadline));
  return;
 }
 if(path!=='/ws/nexgameworld'){
  ws.close(1008,'Flat NexGame is archived');return;
 }
 world.attach(ws);
});
http.listen(PORT,'0.0.0.0',()=>{
 console.log('NexGameWorld spherical server listening on '+PORT);
 console.log('NexGameWorld database URL present:',Boolean(process.env.DATABASE_URL));
 if(process.env.NGW_ACCOUNTS_SMOKE==='once'){
  void accountsReady.then(()=>{
   if(!accountApi)throw new Error('Account API is not enabled; smoke test skipped');
   return runAccountSmoke(PORT);
  }).catch(error=>console.error('NexGameWorld account smoke: FAILED:',error.message));
 }
});
process.on('SIGTERM',()=>{if(accountCleanupTimer)clearInterval(accountCleanupTimer);world.close();wss.close();http.close();void worldProgressStore?.close();void accountStore?.close()});
