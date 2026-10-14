import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {CHEST_X,CHEST_Z} from '../chest.js';
async function freePort(){
 const server=createServer();
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 await new Promise(r=>server.close(r));
 return port;
}
async function started(port){
 for(let tries=0;tries<90;tries++){
  try{const r=await fetch('http://127.0.0.1:'+port+'/health');
   if(r.ok)return r.json()}catch{}
  await new Promise(r=>setTimeout(r,70));
 }
 throw Error('Server did not start');
}
async function connect(port){
 const ws=new WebSocket('ws://127.0.0.1:'+port),history=[];
 ws.on('message',raw=>history.push(JSON.parse(String(raw))));
 await new Promise((r,reject)=>{ws.once('open',r);ws.once('error',reject)});
 const wait=async(predicate)=>{
  for(let tries=0;tries<100;tries++){
   const result=history.find(predicate);
   if(result)return result;
   await new Promise(r=>setTimeout(r,30));
  }
  throw Error('Missing chest event: '+JSON.stringify(history.slice(-6)));
 };
 return {ws,history,wait,send:value=>ws.send(JSON.stringify(value))};
}
test('two live players share a single server chest and cannot withdraw the same item twice',{timeout:16000},async()=>{
 const directory=mkdtempSync(join(tmpdir(),'nex-chest-net-')),port=await freePort();
 const child=spawn(process.execPath,['index.js'],{cwd:new URL('../',import.meta.url),
  env:{...process.env,PORT:String(port),CHEST_DATA_FILE:join(directory,'chest.json')},stdio:'ignore'});
 let a,b;
 try{
  const health=await started(port);assert.equal(health.protocol,6);
  a=await connect(port);b=await connect(port);
  const welcomeA=await a.wait(m=>m.type==='welcome'),welcomeB=await b.wait(m=>m.type==='welcome');
  assert.ok(welcomeA.id&&welcomeB.id);
  for(const player of [a,b])player.send({type:'join',name:'Хранитель',x:CHEST_X,z:CHEST_Z,yaw:0,level:2});
  await new Promise(r=>setTimeout(r,75));
  const bagA=Array(12).fill(null);bagA[0]={id:'chainBelt',qty:1};
  a.send({type:'chestOpen',inventory:bagA});
  b.send({type:'chestOpen',inventory:Array(12).fill(null)});
  assert.equal((await a.wait(m=>m.type==='chestState')).slots.length,18);
  assert.equal((await b.wait(m=>m.type==='chestState')).slots.length,18);
  a.send({type:'chestMove',action:'deposit',slot:0,requestId:'test-deposit-A'});
  const put=await a.wait(m=>m.type==='chestResult'&&m.requestId==='test-deposit-A');
  assert.equal(put.ok,true);assert.equal(put.inventory[0],null);
  assert.deepEqual(put.slots[0],{id:'chainBelt',qty:1});
  assert.ok(await b.wait(m=>m.type==='chestState'&&m.revision===1));
  b.send({type:'chestMove',action:'withdraw',slot:0,requestId:'test-take-B-1'});
  const take=await b.wait(m=>m.type==='chestResult'&&m.requestId==='test-take-B-1');
  assert.equal(take.ok,true);assert.deepEqual(take.inventory[0],{id:'chainBelt',qty:1});
  a.send({type:'chestMove',action:'withdraw',slot:0,requestId:'test-take-A-2'});
  const fail=await a.wait(m=>m.type==='chestResult'&&m.requestId==='test-take-A-2');
  assert.equal(fail.ok,false);
  assert.equal((await a.wait(m=>m.type==='chestState'&&m.revision===2)).slots[0],null);
  assert.equal(health.mobs,9);
 }finally{
  a?.ws.close();b?.ws.close();child.kill('SIGTERM');
  rmSync(directory,{force:true,recursive:true});
 }
});
