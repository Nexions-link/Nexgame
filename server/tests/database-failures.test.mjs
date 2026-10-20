import test from 'node:test';
import assert from 'node:assert/strict';
import {isUnsafeDatabaseFailure} from '../database-failures.js';

test('connection loss and ambiguous COMMIT failure must fail closed',()=>{
 for(const code of ['08006','08P01','ECONNRESET','ETIMEDOUT',
  '57P01','57P03','40001','40P01','53300','XX000']){
  assert.equal(isUnsafeDatabaseFailure(Object.assign(Error('connection lost'),{code})),
   true,code);
 }
 for(const message of ['Connection terminated unexpectedly',
  'Client has encountered a connection error and is not queryable',
  'timeout exceeded when trying to connect']){
  assert.equal(isUnsafeDatabaseFailure(Error(message)),true,message);
 }
 assert.equal(isUnsafeDatabaseFailure(Error('wrapper',{cause:Object.assign(
  Error('timed out'),{code:'ETIMEDOUT'})})),true);
});
test('ordinary gameplay and authorization errors do not disconnect a healthy client',()=>{
 for(const code of ['inventory_full','stale_revision','interaction_too_far',
  'idempotency_key_conflict','23505']){
  assert.equal(isUnsafeDatabaseFailure(Object.assign(Error('not allowed'),{code})),
   false,code);
 }
 assert.equal(isUnsafeDatabaseFailure(null),false);
 assert.equal(isUnsafeDatabaseFailure(Error('invalid request')),false);
});
