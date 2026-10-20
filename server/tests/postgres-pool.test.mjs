import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {watchPgPool} from '../postgres-pool.js';
test('administrator disconnect cannot crash idle PostgreSQL pool',()=>{
 const pool=new EventEmitter(),logs=[],events=[];let now=100000;
 watchPgPool(pool,{label:'account',onIdleError:e=>events.push(e.code),
  clock:()=>now,log:v=>logs.push(v)});
 assert.equal(pool.listenerCount('error'),1);
 assert.doesNotThrow(()=>pool.emit('error',Object.assign(Error('secret'),{code:'57P01'})));
 assert.deepEqual(events,['57P01']);
 assert.match(logs[0],/57P01/);assert.doesNotMatch(logs[0],/secret/);
 for(let n=0;n<100;n++)pool.emit('error',{code:'08006'});
 assert.equal(logs.length,1);
 now+=30001;pool.emit('error',{code:'08006'});
 assert.equal(logs.length,2);assert.match(logs[1],/repeated=100/);
});
test('failed SQL writes still reject: no fictional saving of character progress',async()=>{
 const pool=new EventEmitter();
 pool.query=async()=>{throw Object.assign(Error('connection failed'),{code:'08006'})};
 watchPgPool(pool,{log:()=>{}});
 assert.doesNotThrow(()=>pool.emit('error',{code:'57P01'}));
 await assert.rejects(pool.query('UPDATE game_state'),{code:'08006'});
});
test('logging and monitoring bugs cannot turn idle disconnect into a crash',()=>{
 const pool=new EventEmitter();
 watchPgPool(pool,{log:()=>{throw Error('logger error')},onIdleError:()=>{throw Error('observer error')}});
 assert.doesNotThrow(()=>pool.emit('error',{}));
});
