// NexGameWorld Alpha 0.6.30 — one active spherical-world WebSocket server.
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {existsSync,unlinkSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createSphericalWorld,SPHERE_PROTOCOL} from './spherical-world.js';
import {createAccountStore} from './account-store.js';
import {createAccountApi} from './account-api.js';
const PORT=Number(process.env.PORT||3000),BUILD='0.6.31';
const configuredOrigins=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
const origins=new Set([...configuredOrigins,'https://nexions.ru',
 'https://www.nexions.ru','https://nexions-link.github.io']);
const previousFile=resolve(process.env.CHEST_DATA_FILE||'chest-data.json');
const activeFile=resolve(process.env.NGW_CHEST_DATA_FILE||
 join(dirname(previousFile),'nexgameworld-chest.json'));
const world=createSphericalWorld({chestFilePath:activeFile});
// Existing gameplay remains available while account storage is configured.
// Endpoints are disabled unless the opt-in flag is explicitly enabled.
let accountStore=null,accountApi=null;
let accountDbStatus=process.env.DATABASE_URL?'checking':'not_configured';
async function initializeAccounts(){
 if(!process.env.DATABASE_URL)return;
 try{
  accountStore=createAccountStore();
  await accountStore.ping();
  const ready=await accountStore.schemaReady();
  accountDbStatus=ready?'ready':'schema_missing';
  if(ready&&process.env.NGW_ACCOUNTS_ENABLED==='true'){
   accountApi=createAccountApi({store:accountStore,
    allowedOrigins:['https://nexions.ru','https://www.nexions.ru']});
  }
 }catch(error){
  accountDbStatus='unavailable';
  console.error('NexGameWorld accounts database unavailable:',error?.code||error?.name||'unknown');
 }
}
void initializeAccounts();
// Retire old NexGame persistent chest. Never touch the new NGW file.
let legacyCleanup='not_found';
if(previousFile!==activeFile){
 try{if(existsSync(previousFile)){unlinkSync(previousFile);legacyCleanup='removed';}}
 catch(error){legacyCleanup='error';console.error('Legacy chest cleanup error',error);}
}else legacyCleanup='skipped_same_storage_path';
const http=createServer((req,res)=>{
 if(req.url?.split('?')[0]==='/health'){
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({ok:true,world:'nexgameworld',
   players:world.population(),sphericalPlayers:world.population(),mobs:world.mobCount(),
   protocol:SPHERE_PROTOCOL,build:BUILD,legacyCleanup,
   accountDbStatus,accountApiEnabled:!!accountApi}));return;
 }
 if(req.url?.split('?')[0]?.startsWith('/api/ngw/')){
  if(accountApi){void accountApi(req,res).catch(()=>{
   if(!res.headersSent){res.writeHead(500,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'Ошибка сервера'}));}
  });return;}
  res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({error:'Система аккаунтов ещё подготавливается'}));return;
 }
 res.writeHead(410,{'content-type':'text/plain','cache-control':'no-store'});
 res.end('Archived NexGame server is retired. Use NexGameWorld.');
});
const wss=new WebSocketServer({server:http,maxPayload:8192,
 verifyClient:({origin},done)=>done(!origin||origins.has(origin)||(!configuredOrigins.length&&origin.startsWith('https://')))});
wss.on('connection',(ws,req)=>{
 if(req.url?.split('?')[0]!=='/ws/nexgameworld'){
  ws.close(1008,'Flat NexGame is archived');return;
 }
 world.attach(ws);
});
http.listen(PORT,'0.0.0.0',()=>console.log('NexGameWorld spherical server listening on '+PORT));
process.on('SIGTERM',()=>{world.close();wss.close();http.close();void accountStore?.close()});
