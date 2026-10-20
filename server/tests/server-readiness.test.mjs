import test from 'node:test';
import assert from 'node:assert/strict';
import {assertWorldReady} from '../server-readiness.js';
import {createProgressStore} from '../progress-store.js';
import {createEconomyStore} from '../economy-store.js';

function fixture(){
 const queries={account:0,progress:0,economy:0},down=new Set();
 const store=key=>({async ping(){
  queries[key]++;
  if(down.has(key))throw Object.assign(Error('Neon unavailable'),{code:'08006'});
  return true;
 }});
 return {
  opts:{accountApi:{},authenticatedWorldGate:{},accountStore:store('account'),
   worldProgressStore:store('progress'),worldEconomyStore:store('economy')},queries,down
 };
}
test('readiness checks all three independent Neon pools before advertising ready',async()=>{
 const {opts,queries}=fixture();
 assert.equal(await assertWorldReady(opts),true);
 assert.deepEqual(queries,{account:1,progress:1,economy:1});
});
test('an unavailable progress or economy pool fails readiness and recovers on next check',async()=>{
 const {opts,down}=fixture();
 down.add('progress');await assert.rejects(()=>assertWorldReady(opts),{code:'08006'});
 down.delete('progress');down.add('economy');
 await assert.rejects(()=>assertWorldReady(opts),{code:'08006'});
 down.clear();assert.equal(await assertWorldReady(opts),true);
});
test('stopping, missing dependencies and missing ping always fail closed',async()=>{
 const {opts,queries}=fixture();
 for(const key of ['accountApi','authenticatedWorldGate','accountStore',
  'worldProgressStore','worldEconomyStore']){
  await assert.rejects(()=>assertWorldReady({...opts,[key]:null}),
   /world_dependencies_unavailable/);
 }
 await assert.rejects(()=>assertWorldReady({...opts,stopping:true}),/server_stopping/);
 assert.deepEqual(queries,{account:0,progress:0,economy:0});
 await assert.rejects(()=>assertWorldReady({...opts,worldEconomyStore:{}}),
  /world_pool_not_monitorable/);
});
test('progress/economy stores use read-only ping against independent pools',async()=>{
 const queries=[];
 const pool={query:async sql=>{queries.push(sql);return {rows:[{ok:1}]}}};
 const progress=createProgressStore({pool});
 const economy=createEconomyStore({pool});
 try{
  assert.equal(await progress.ping(),true);
  assert.equal(await economy.ping(),true);
  assert.deepEqual(queries,['SELECT 1 AS ok','SELECT 1 AS ok']);
 }finally{await progress.close();await economy.close()}
});
test('connection failure propagates and future checks reconnect after Neon recovery',async()=>{
 let down=true;
 const pool={query:async sql=>{
  assert.equal(sql,'SELECT 1 AS ok');
  if(down)throw Object.assign(Error('connection lost'),{code:'08006'});
  return {rows:[{ok:1}]};
 }};
 const progress=createProgressStore({pool});
 try{
  await assert.rejects(()=>progress.ping(),{code:'08006'});
  down=false;assert.equal(await progress.ping(),true);
 }finally{await progress.close()}
});
