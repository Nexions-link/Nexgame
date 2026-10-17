import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccountStore} from '../account-store.js';

// The live API uses hyphenated scopes. PostgreSQL throttle validation must
// accept all of them (not just the test-only in-memory mock scopes).
test('persistent auth throttles accept every real API scope',async()=>{
 const calls=[];
 const fakePool={
  async query(sql,args){
   calls.push({sql,args});
   return {rows:[{attempts:1}]};
  }
 };
 const store=createAccountStore({pool:fakePool});
 const scopes=['register-ip','login-ip','login-user','recover-ip',
  'recover-user','password-user'];
 for(const scope of scopes){
  const key=scope+':'+('a'.repeat(64));
  assert.equal(await store.consumeAuthRate(key,40,900),true);
 }
 assert.equal(calls.length,scopes.length);
 for(const row of calls){
  assert.match(row.sql,/INSERT INTO ngw_auth_rate_limits/);
  assert.equal(row.args.length,2);
  assert.equal(row.args[1],900);
 }
});
test('persistent auth throttles still reject malformed keys and invalid bounds',async()=>{
 const fakePool={async query(){throw new Error('unexpected DB call')}};
 const store=createAccountStore({pool:fakePool});
 const valid='login-user:'+('a'.repeat(64));
 for(const bad of [
  'login_user:'+('a'.repeat(64)),
  'login--user:'+('a'.repeat(64)),
  'login-user:'+('x'.repeat(64)),
  'login-user:'+('a'.repeat(63)),
  'login-user:'+('a'.repeat(65)),
  'login-user;drop:'+('a'.repeat(64)),
  'login-user:'+('a'.repeat(64))+';drop'
 ]){
  await assert.rejects(()=>store.consumeAuthRate(bad,40,900),
   /Incorrect auth throttle parameters/);
 }
 for(const [limit,seconds] of [[0,900],[1001,900],[10,20],[10,86401]]){
  await assert.rejects(()=>store.consumeAuthRate(valid,limit,seconds),
   /Incorrect auth throttle parameters/);
 }
});
