import test from 'node:test';
import assert from 'node:assert/strict';
import {inBothTradeQueues} from '../player-trade-queue.js';
import {ProgressError} from '../progress-rules.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r}),get resolve(){return resolve}}};
function player(){
 let queue=Promise.resolve();const failures=[];
 return {failures,queueTradeSave(operation){const pending=queue.then(operation);queue=pending.catch(error=>{failures.push(error)});return pending},drain:()=>queue};
}
test('a transfer waits for both previous saves and publishes before either next checkpoint',async()=>{
 const a=player(),b=player(),gate=deferred(),events=[];
 a.queueTradeSave(async()=>{await gate.promise;events.push('priorA')});
 b.queueTradeSave(async()=>events.push('priorB'));
 const transfer=inBothTradeQueues([a,b],async()=>{events.push('commit');events.push('publishA','publishB')});
 const afterA=a.queueTradeSave(async()=>events.push('afterA'));
 const afterB=b.queueTradeSave(async()=>events.push('afterB'));
 await new Promise(r=>setImmediate(r));assert.deepEqual(events,['priorB']);
 gate.resolve();await Promise.all([transfer,afterA,afterB]);
 assert.ok(events.indexOf('commit')>events.indexOf('priorA'));
 assert.ok(events.indexOf('afterA')>events.indexOf('publishB'));
 assert.ok(events.indexOf('afterB')>events.indexOf('publishB'));
});
test('ordinary validation rollback releases both queues without save failure',async()=>{
 const a=player(),b=player();
 await assert.rejects(()=>inBothTradeQueues([a,b],async()=>{throw new ProgressError('inventory_full',409)}),e=>e.code==='inventory_full');
 await Promise.all([a.queueTradeSave(async()=>{}),b.queueTradeSave(async()=>{})]);
 assert.equal(a.failures.length,0);assert.equal(b.failures.length,0);
});
test('uncertain COMMIT fails both reserved queues instead of retrying the exchange',async()=>{
 const a=player(),b=player();let calls=0;
 const error=Object.assign(Error('response lost'),{tradeCommitUncertain:true});
 await assert.rejects(()=>inBothTradeQueues([a,b],async()=>{calls++;throw error}),e=>e===error);
 await Promise.all([a.drain(),b.drain()]);
 assert.equal(calls,1);assert.equal(a.failures[0],error);assert.equal(b.failures[0],error);
});
test('one failed or stuck earlier queue cannot leave its peer held forever',async()=>{
 const b=player();let ran=false;
 const a={queueTradeSave:()=>Promise.reject(Error('session_save_failed'))};
 await assert.rejects(()=>inBothTradeQueues([a,b],async()=>{ran=true}));
 await b.drain();assert.equal(ran,false);assert.equal(b.failures.length,1);
 const c=player(),d=player(),gate=deferred();c.queueTradeSave(()=>gate.promise);
 const pending=inBothTradeQueues([c,d],async()=>{ran=true},{timeoutMs:20});
 // The timeout must stay observable even when the application has no sockets.
 const keepAlive=setTimeout(()=>{},80);
 await assert.rejects(()=>pending,e=>e.code==='trade_save_timeout');
 clearTimeout(keepAlive);await d.drain();assert.equal(ran,false);
 gate.resolve();await c.drain();assert.equal(c.failures.length,1);
});
test('a queue adapter that skips its handler cannot start a transfer before both reservations',async()=>{
 const b=player();let ran=false;
 const a={queueTradeSave:()=>Promise.resolve()};
 const keepAlive=setTimeout(()=>{},80);
 await assert.rejects(()=>inBothTradeQueues([a,b],async()=>{ran=true},{timeoutMs:20}),
  error=>error.code==='trade_save_timeout');
 clearTimeout(keepAlive);await b.drain();assert.equal(ran,false);assert.equal(b.failures.length,1);
});
