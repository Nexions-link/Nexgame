import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {flushWorldOnShutdown} from '../world-shutdown.js';

function fakeSocket(){
 const socket=new EventEmitter();
 socket.readyState=1;
 socket.terminate=()=>{
  socket.readyState=3;
  socket.emit('close');
 };
 return socket;
}
test('shutdown waits for exit checkpoint and pending economy saves before pool disposal',async()=>{
 const socket=fakeSocket(),events=[];
 let finishSave;
 const committed=new Promise(resolve=>{finishSave=resolve});
 let saveQueue=Promise.resolve();
 socket.on('close',()=>{
  events.push('socket-closed');
  saveQueue=saveQueue.then(()=>committed).then(()=>events.push('checkpoint-committed'));
 });
 const session={drain:()=>saveQueue};
 const stopping=flushWorldOnShutdown({
  world:{close:()=>events.push('world-stopped')},
  wss:{clients:new Set([socket])},
  sessions:new Set([session]),
  timeoutMs:1000
 });
 let done=false;void stopping.then(()=>{done=true});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(done,false,'shutdown must not complete while save is pending');
 assert.deepEqual(events.slice(0,2),['world-stopped','socket-closed']);
 finishSave();
 const result=await stopping;
 assert.equal(result.closedSockets,1);
 assert.equal(result.drainedSessions,1);
 assert.deepEqual(events,['world-stopped','socket-closed','checkpoint-committed']);
});
test('a character save failure is reported instead of claimed successful',async()=>{
 const socket=fakeSocket();
 const result=flushWorldOnShutdown({
  world:{close(){}},wss:{clients:new Set([socket])},
  sessions:new Set([{drain:()=>Promise.reject(Error('disk offline'))}]),
  timeoutMs:1000
 });
 await assert.rejects(result,/save queue rejected/);
});
test('no connected sessions drains cleanly',async()=>{
 const result=await flushWorldOnShutdown({
  world:{close(){}},wss:{clients:new Set()},sessions:new Set(),timeoutMs:1000
 });
 assert.deepEqual(result,{closedSockets:0,drainedSessions:0});
});
