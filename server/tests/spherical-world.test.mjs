import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {WebSocket} from 'ws';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){
 const s=createServer();
 await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 const p=s.address().port;
 await new Promise(resolve=>s.close(resolve));
 return p;
}
async function start(){
 const p=await port();
 const child=spawn(process.execPath,['index.js'],{
  cwd:new URL('../',import.meta.url),env:{...process.env,PORT:String(p)},stdio:['ignore','ignore','pipe']
 });
 let stderr='';child.stderr?.on('data',chunk=>{stderr+=String(chunk)});
 for(let i=0;i<80;i++){
  if(child.exitCode!==null)throw Error('server process exited: '+stderr);
  try{
   const h=await fetch('http://127.0.0.1:'+p+'/health');
   if(h.ok)return {p,child};
  }catch{}
  await wait(75);
 }
 child.kill();throw Error('server failed to start: '+stderr);
}
async function client(p,path='/ws/nexgameworld'){
 const socket=new WebSocket('ws://127.0.0.1:'+p+path);
 const events=[];
 socket.on('message',data=>events.push(JSON.parse(String(data))));
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});
 return {socket,events,send:m=>socket.send(JSON.stringify(m)),close:()=>socket.close()};
}
async function until(fn){
 for(let i=0;i<70;i++){const val=fn();if(val)return val;await wait(70);}
 throw Error('timed out waiting for expected socket message');
}
test('spherical presence is isolated by radius and archived flat-world socket is rejected', {timeout:14000},async()=>{
 const {p,child}=await start();let a,b,c,flat;
 try{
  [a,b,c,flat]=await Promise.all([client(p),client(p),client(p),client(p,'/')]);
  const n=[0,0,1];
  a.send({type:'join',name:'Первый',radius:261,normal:n,heading:0});
  b.send({type:'join',name:'Второй',radius:261,normal:n,heading:0});
  c.send({type:'join',name:'Третий',radius:87,normal:n,heading:0});
  const aWelcome=await until(()=>a.events.find(e=>e.type==='welcome'));
  const bWelcome=await until(()=>b.events.find(e=>e.type==='welcome'));
  const cWelcome=await until(()=>c.events.find(e=>e.type==='welcome'));
  assert.equal(aWelcome.protocol,2);
  assert.equal(cWelcome.radius,87);
  const aSnap=await until(()=>a.events.find(e=>e.type==='snapshot'&&e.players.length===2));
  const cSnap=await until(()=>c.events.find(e=>e.type==='snapshot'));
  assert.deepEqual(aSnap.players.map(e=>e.name).sort(),['Второй','Первый']);
  assert.equal(cSnap.players.length,1);
  await until(()=>flat.socket.readyState===WebSocket.CLOSED);
  assert.equal(flat.events.some(e=>e.type==='welcome'),false);
  assert.equal(aSnap.players.length,2);
  assert.notEqual(aWelcome.id,bWelcome.id);
  const h=await (await fetch('http://127.0.0.1:'+p+'/health')).json();
  assert.equal(h.sphericalPlayers,3);
  assert.equal(h.players,3);
  assert.equal(h.world,'nexgameworld');
  assert.equal(h.protocol,2);
 }finally{
  for(const x of [a,b,c,flat])x?.close();
  child.kill();
 }
});
test('spherical movement validates coordinates, prevents teleportation, and reports disconnect', {timeout:14000},async()=>{
 const {p,child}=await start();let a,b;
 try{
  [a,b]=await Promise.all([client(p),client(p)]);
  for(const x of [a,b])x.send({type:'join',radius:261,normal:[0,0,1],heading:0});
  const welcome=await until(()=>a.events.find(e=>e.type==='welcome'));
  await until(()=>b.events.find(e=>e.type==='welcome'));
  a.send({type:'move',radius:261,normal:[0,1,0],heading:0,moving:true});
  await wait(230);
  let snap=b.events.filter(e=>e.type==='snapshot').at(-1);
  assert.deepEqual(snap.players.find(x=>x.id===welcome.id).normal,[0,0,1]);
  a.send({type:'move',radius:261,normal:[0.001,0,Math.sqrt(1-.001**2)],heading:1,moving:true});
  await until(()=>b.events.find(e=>e.type==='snapshot'&&e.players.some(x=>x.id===welcome.id&&x.heading===1)));
  a.close();
  await until(()=>b.events.find(e=>e.type==='leave'&&e.id===welcome.id));
 }finally{a?.close();b?.close();child.kill()}
});
