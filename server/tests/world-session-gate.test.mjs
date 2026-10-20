import test from 'node:test';
import assert from 'node:assert/strict';
import {newSessionToken,tokenDigest} from '../auth-crypto.js';
import {createWorldSessionGate,worldJoinCloseInfo,WorldAuthError} from '../world-session-gate.js';
const account='3be1ac10-23de-4631-8a55-3f11e36a2c54';
const mine='46de3e24-6ec2-4301-9345-61c554b55c82';
const foreign='4aadebea-72c0-4987-839d-de5059a75f38';
const token=newSessionToken();
function createFixture(){
 let allowed=true;
 const accountStore={
  async accountForSession(digest){
   return allowed&&digest.equals(tokenDigest(token))?{id:account}:null;
  },
  async loadCharacter(id,characterId){
   return id===account&&characterId===mine?
    {id:mine,nickname:'МойГерой'}:null;
  }
 };
 const progressStore={
  async load(id,characterId){
   assert.equal(id,account);assert.equal(characterId,mine);
   return {revision:2,level:3,experience:12,gold:44,health:137,
    resource:25,worldRadius:261,positionNormal:[0,0,1],
    heading:0,inventory:Array(12).fill(null),equipment:{},quests:{},actionBar:[]};
  }
 };
 return {gate:createWorldSessionGate({accountStore,progressStore}),
  expire(){allowed=false}};
}
test('world admission reads trusted character and stats only from stores',async()=>{
 const {gate}=createFixture();
 const client={};
 const joined=await gate.enter(client,{sessionToken:token,characterId:mine,
  level:60,gold:900000,inventory:[{id:'legendary',qty:99}],nickname:'Fake'});
 assert.equal(joined.accountId,account);
 assert.equal(joined.nickname,'МойГерой');
 assert.equal(joined.progress.level,3);
 assert.equal(joined.progress.gold,44);
 assert.equal(joined.progress.inventory.length,12);
 assert.equal(gate.online(),1);
 gate.leave(client);assert.equal(gate.online(),0);
});
test('world admission rejects invalid and foreign IDs plus expired sessions',async()=>{
 const {gate,expire}=createFixture();
 for(const args of [
  {sessionToken:'forged',characterId:mine},
  {sessionToken:token,characterId:'not-uuid'},
  {sessionToken:token,characterId:foreign}
 ])await assert.rejects(()=>gate.enter({},args),e=>e.status>=400);
 expire();
 await assert.rejects(()=>gate.enter({},{sessionToken:token,characterId:mine}),
  /session_expired/);
 assert.equal(gate.online(),0);
});
test('one character cannot join from two simultaneous browser connections',async()=>{
 const {gate}=createFixture();
 const first={id:'first'},second={id:'second'};
 const results=await Promise.allSettled([gate.enter(first,{sessionToken:token,characterId:mine}),
  gate.enter(second,{sessionToken:token,characterId:mine})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.code==='character_already_online').length,1);
 assert.equal(gate.online(),1);
 gate.leave(first);gate.leave(second);
 assert.equal(gate.online(),0);
 const third={id:'reconnected'};
 assert.equal((await gate.enter(third,{sessionToken:token,characterId:mine})).characterId,mine);
 gate.leave(third);
});
test('same browser cannot bind twice without disconnect',async()=>{
 const {gate}=createFixture(),socket={};
 await gate.enter(socket,{sessionToken:token,characterId:mine});
 await assert.rejects(()=>gate.enter(socket,{sessionToken:token,characterId:mine}),
  /socket_already_joined/);
 gate.leave(socket);
 assert.equal(gate.online(),0);
});

test('a connected character session is invalidated after logout or password reset',async()=>{
 const {gate,expire}=createFixture(),socket={};
 await gate.enter(socket,{sessionToken:token,characterId:mine});
 assert.equal(await gate.validate(socket),true);
 expire();
 assert.equal(await gate.validate(socket),false);
 gate.leave(socket);
 assert.equal(await gate.validate(socket),false);
});

test('pending save lease uses retryable WebSocket close, invalid token remains fatal',()=>{
 assert.deepEqual(worldJoinCloseInfo(new WorldAuthError('character_already_online',409)),
  {code:1013,reason:'Previous character session is still saving'});
 assert.equal(worldJoinCloseInfo(new WorldAuthError('session_expired')).code,1008);
 assert.equal(worldJoinCloseInfo(new WorldAuthError('character_not_owned',403)).code,1008);
 assert.equal(worldJoinCloseInfo(Error('database temporarily unavailable')).code,1011);
});
test('reconnect must wait for saved checkpoint lease to finish',async()=>{
 const {gate}=createFixture(),first={},second={};
 await gate.enter(first,{sessionToken:token,characterId:mine});
 let finish;
 const saving=new Promise(resolve=>{finish=resolve});
 void saving.then(()=>gate.leave(first));
 await assert.rejects(()=>gate.enter(second,{sessionToken:token,characterId:mine}),
  error=>worldJoinCloseInfo(error).code===1013);
 finish();
 await saving;
 // Allow the drain callback to release the original character lease.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal((await gate.enter(second,{sessionToken:token,characterId:mine})).characterId,mine);
 gate.leave(second);
});
