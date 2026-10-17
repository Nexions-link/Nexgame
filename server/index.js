// NexGameWorld Alpha 0.6.30 — one active spherical-world WebSocket server.
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {existsSync,unlinkSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {createSphericalWorld,SPHERE_PROTOCOL} from './spherical-world.js';
const PORT=Number(process.env.PORT||3000),BUILD='0.6.31';
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
 }catch(error){
  console.error('NexGameWorld Neon connection: failed',error?.code||error?.name||'unknown');
 }finally{
  if(pool)try{await pool.end()}catch{}
 }
}
void verifyNeonConnection();
const http=createServer((req,res)=>{
 if(req.url?.split('?')[0]==='/health'){
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(JSON.stringify({ok:true,world:'nexgameworld',
   players:world.population(),sphericalPlayers:world.population(),mobs:world.mobCount(),
   protocol:SPHERE_PROTOCOL,build:BUILD,legacyCleanup,
   databaseConfigured:Boolean(process.env.DATABASE_URL)}));return;
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
http.listen(PORT,'0.0.0.0',()=>{
 console.log('NexGameWorld spherical server listening on '+PORT);
 console.log('NexGameWorld database URL present:',Boolean(process.env.DATABASE_URL));
});
process.on('SIGTERM',()=>{world.close();wss.close();http.close()});
