// NexGameWorld stage 1: isolated spherical player presence.
// Legacy flat-world combat, mobs, parties and protocol remain untouched.
import {randomUUID} from 'node:crypto';
import {WebSocket} from 'ws';

export const SPHERE_PROTOCOL=1;
const RADII=new Set([87,174,261]);
const TICK_MS=100;
const MAX_PLAYERS=100;
const MAX_SPEED=7; // metres per second, with allowance for network jitter.
const cleanName=name=>typeof name==='string'
 ? name.trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,24)||'Странник':'Странник';
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const normalFrom=raw=>{
 if(!Array.isArray(raw)||raw.length!==3||!raw.every(finite))return null;
 const length=Math.hypot(...raw);
 if(length<.99||length>1.01)return null;
 return raw.map(n=>n/length);
};
const boundedHeading=h=>finite(h)&&Math.abs(h)<=Math.PI*4;
const angleBetween=(a,b)=>Math.acos(Math.min(1,Math.max(-1,a[0]*b[0]+a[1]*b[1]+a[2]*b[2])));
const safeSend=(ws,data)=>{
 if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));
};
const publicPlayer=p=>({
 id:p.id,name:p.name,normal:p.normal,heading:p.heading,moving:p.moving,radius:p.radius
});

export function createSphericalWorld(){
 const players=new Map();
 const connections=new Map();
 let tick=0;
 const inRoom=radius=>[...players.values()].filter(p=>p.radius===radius);
 const publish=(radius,data)=>{
  for(const [ws,p] of connections)if(p?.radius===radius)safeSend(ws,data);
 };
 function attach(ws){
  if(connections.size>=MAX_PLAYERS){ws.close(1013,'World is full');return}
  connections.set(ws,null);
  const cleanup=()=>{
   if(!connections.has(ws))return;
   const p=connections.get(ws);
   connections.delete(ws);
   if(p){
    players.delete(p.id);
    publish(p.radius,{type:'leave',id:p.id});
   }
  };
  ws.on('message',raw=>{
   if(raw.length>2048)return;
   let m;try{m=JSON.parse(String(raw))}catch{return}
   if(!m||typeof m!=='object')return;
   const current=connections.get(ws);
   if(m.type==='join'){
    if(current||!RADII.has(m.radius))return;
    const normal=normalFrom(m.normal);
    if(!normal||!boundedHeading(m.heading))return;
    const player={
     id:randomUUID(),name:cleanName(m.name),normal,heading:m.heading,
     moving:false,radius:m.radius,updatedAt:Date.now()
    };
    players.set(player.id,player);
    connections.set(ws,player);
    safeSend(ws,{
     type:'welcome',id:player.id,world:'nexgameworld',protocol:SPHERE_PROTOCOL,
     radius:player.radius,tickMs:TICK_MS,players:inRoom(player.radius)
       .filter(p=>p.id!==player.id).map(publicPlayer)
    });
    return;
   }
   if(!current||m.type!=='move')return;
   if(m.radius!==current.radius||typeof m.moving!=='boolean'||!boundedHeading(m.heading))return;
   const normal=normalFrom(m.normal);
   if(!normal)return;
   const now=Date.now(),dt=Math.min(1,(now-current.updatedAt)/1000);
   if(dt<.075)return;
   const distance=current.radius*angleBetween(normal,current.normal);
   if(distance>MAX_SPEED*dt+.8)return;
   current.normal=normal;
   current.heading=m.heading;
   current.moving=m.moving;
   current.updatedAt=now;
  });
  ws.on('close',cleanup);
  ws.on('error',cleanup);
 }
 const timer=setInterval(()=>{
  tick++;
  const rooms=new Set([...players.values()].map(p=>p.radius));
  for(const radius of rooms){
   const snapshot={type:'snapshot',protocol:SPHERE_PROTOCOL,tick,
    radius,players:inRoom(radius).map(publicPlayer)};
   publish(radius,snapshot);
  }
 },TICK_MS);
 timer.unref?.();
 return {attach,population:()=>players.size,close:()=>clearInterval(timer)};
}
