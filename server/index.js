// NexGame world server — alpha presence prototype. No combat or inventory authority yet.
// One process = one global world; use persistent infrastructure for deployment.
import {createServer} from 'node:http';
import {WebSocketServer,WebSocket} from 'ws';
import {randomUUID} from 'node:crypto';

const PORT=Number(process.env.PORT||3000);
const MAX_PLAYERS=100;
const TICK_MS=100; // 10 world snapshots per second.
const MAX_MESSAGE_BYTES=1024;
const MAX_SPEED=7; // anti-teleport cap for 4.05 world units/sec client movement.
const ALLOWED_ORIGINS=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean);
const players=new Map();
const clients=new Map();
const integer=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const cleanName=name=>typeof name==='string'?name.trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,24):'';
const encode=value=>JSON.stringify(value);
const send=(socket,payload)=>{if(socket.readyState===WebSocket.OPEN)socket.send(encode(payload));};

const http=createServer((req,res)=>{
 if(req.url==='/health'){
  res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
  res.end(encode({ok:true,world:'mulgore',players:players.size}));
  return;
 }
 res.writeHead(404);res.end('Not found');
});
const wss=new WebSocketServer({server:http,maxPayload:MAX_MESSAGE_BYTES,
 verifyClient:({origin},done)=>done(!ALLOWED_ORIGINS.length||ALLOWED_ORIGINS.includes(origin))});
function disconnect(ws){
 const id=clients.get(ws);if(!id)return;
 clients.delete(ws);players.delete(id);
 for(const client of clients.keys())send(client,{type:'leave',id});
}
wss.on('connection',ws=>{
 if(clients.size>=MAX_PLAYERS){ws.close(1013,'World is full');return}
 const id=randomUUID(),now=Date.now();
 const player={id,name:'Странник',x:0,z:10,yaw:Math.PI,level:1,moving:false,updatedAt:now};
 clients.set(ws,id);players.set(id,player);
 send(ws,{type:'welcome',id,world:'mulgore',tickMs:TICK_MS,
  players:[...players.values()].filter(other=>other.id!==id)});
 ws.on('message',raw=>{
  let data;try{data=JSON.parse(String(raw))}catch{return}
  if(!data||typeof data!=='object')return;
  if(data.type==='join'){
   const name=cleanName(data.name);if(name)player.name=name;
   return;
  }
  if(data.type!=='move')return;
  if(!finite(data.x,-1000,1000)||!finite(data.z,-1000,1000)||
     !finite(data.yaw,-Math.PI*4,Math.PI*4)||typeof data.moving!=='boolean')return;
  const now=Date.now(),dt=Math.min(1,(now-player.updatedAt)/1000);
  if(dt<.075)return; // Limit client input to about 10 updates/sec.
  const dx=data.x-player.x,dz=data.z-player.z;
  if(Math.hypot(dx,dz)>MAX_SPEED*dt+1) return;
  player.x=data.x;player.z=data.z;player.yaw=data.yaw;
  player.moving=data.moving;player.updatedAt=now;
  if(integer(data.level,1,60))player.level=data.level; // Display-only for prototype.
 });
 ws.on('close',()=>disconnect(ws));
 ws.on('error',()=>disconnect(ws));
});
const interval=setInterval(()=>{
 const snapshot=[...players.values()].map(p=>({id:p.id,name:p.name,x:p.x,z:p.z,yaw:p.yaw,level:p.level,moving:p.moving}));
 for(const client of clients.keys())send(client,{type:'snapshot',players:snapshot});
},TICK_MS);
interval.unref();
http.listen(PORT,'0.0.0.0',()=>console.log('NexGame world listening on '+PORT));
