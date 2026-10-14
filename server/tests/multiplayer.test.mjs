import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {WebSocket} from 'ws';

async function freePort(){
 const server=createServer();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
 const port=server.address().port;
 await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 return port;
}
async function ready(port,timeout=8000){
 const until=Date.now()+timeout;
 while(Date.now()<until){
  try{
   const response=await fetch('http://127.0.0.1:'+port+'/health');
   if(response.ok)return response.json();
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,70));
 }
 throw Error('World server did not become healthy');
}
async function connect(port){
 const ws=new WebSocket('ws://127.0.0.1:'+port);
 const snapshots=new Map();let welcome=null;
 ws.on('message',message=>{
  const payload=JSON.parse(String(message));
  if(payload.type==='welcome')welcome=payload;
  if(payload.type==='snapshot'&&Number.isInteger(payload.tick)){
   snapshots.set(payload.tick,payload);
  }
 });
 await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
 return {ws,snapshots,getWelcome:()=>welcome};
}

test('two players receive identical mob states on the same world tick', {timeout:14000},async()=>{
 const port=await freePort();
 const child=spawn(process.execPath,['index.js'],{
  cwd:new URL('../',import.meta.url),
  env:{...process.env,PORT:String(port)},
  stdio:'ignore'
 });
 let a,b;
 try{
  const health=await ready(port);
  assert.equal(health.protocol,2);
  assert.equal(health.mobs,9);
  a=await connect(port);b=await connect(port);
  await new Promise(resolve=>setTimeout(resolve,650));
  assert.equal(a.getWelcome()?.mobs?.length,9);
  assert.equal(b.getWelcome()?.mobs?.length,9);
  const matches=[...a.snapshots.keys()].filter(tick=>b.snapshots.has(tick));
  assert.ok(matches.length>=2,'both clients must receive multiple identical ticks');
  for(const tick of matches){
   const am=a.snapshots.get(tick).mobs,bm=b.snapshots.get(tick).mobs;
   assert.equal(am.length,9);
   assert.deepEqual(am,bm,'mobs and animation phases must match at tick '+tick);
  }
 }finally{
  a?.ws.close();b?.ws.close();child.kill('SIGTERM');
 }
});
