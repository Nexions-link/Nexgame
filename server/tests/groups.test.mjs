import test from 'node:test';
import assert from 'node:assert/strict';
import {createPartyManager,PARTY_MAX_SIZE,PARTY_INVITE_TTL_MS} from '../groups.js';

function setup(count=7){
 const players=new Map(Array.from({length:count},(_,i)=>['p'+i,{id:'p'+i,name:'Воин '+i,level:i+1}]));
 const messages=new Map();
 let time=10_000;
 const send=(id,message)=>{if(!messages.has(id))messages.set(id,[]);messages.get(id).push(message)};
 const parties=createPartyManager({players,send,now:()=>time});
 return {players,messages,parties,advance:n=>{time+=n},last:(id,type)=>[...(messages.get(id)||[])].reverse().find(m=>m.type===type)};
}
test('invite, accept and server roster include same leader and members',()=>{
 const w=setup();
 assert.equal(w.parties.invite('p0','p1'),true);
 assert.equal(w.last('p1','partyInvite').fromName,'Воин 0');
 assert.equal(w.parties.respond('p1','p0',true),true);
 const a=w.last('p0','partyState'),b=w.last('p1','partyState');
 assert.deepEqual(a,b);
 assert.equal(a.members.length,2);
 assert.equal(a.leaderId,'p0');
 assert.equal(a.members[1].name,'Воин 1');
 assert.equal(w.parties.invite('p1','p2'),false,'only leader can invite');
});
test('maximum 5 players and no cross-party invitations',()=>{
 const w=setup();
 for(let i=1;i<PARTY_MAX_SIZE;i++){
  assert.equal(w.parties.invite('p0','p'+i),true);
  assert.equal(w.parties.respond('p'+i,'p0',true),true);
 }
 assert.equal(w.last('p0','partyState').members.length,PARTY_MAX_SIZE);
 assert.equal(w.parties.invite('p0','p5'),false);
 assert.equal(w.parties.invite('p5','p1'),false);
});
test('decline, expiry and wrong inviter cannot add players',()=>{
 const w=setup();
 assert.equal(w.parties.invite('p0','p1'),true);
 assert.equal(w.parties.respond('p1','p2',true),false);
 assert.equal(w.parties.respond('p1','p0',false),true);
 assert.equal(w.parties.state('p1').groupId,null);
 assert.equal(w.parties.invite('p0','p1'),true);
 w.advance(PARTY_INVITE_TTL_MS+1);
 assert.equal(w.parties.respond('p1','p0',true),false);
 assert.equal(w.parties.state('p1').groupId,null);
});
test('leader departure promotes next player, last member disbands',()=>{
 const w=setup();
 for(const id of ['p1','p2']){
  w.parties.invite('p0',id);w.parties.respond(id,'p0',true);
 }
 assert.equal(w.parties.leave('p0'),true);
 assert.equal(w.last('p1','partyState').leaderId,'p1');
 assert.equal(w.last('p1','partyState').members.length,2);
 assert.equal(w.parties.leave('p2'),true);
 assert.equal(w.parties.state('p1').groupId,null);
});
test('disconnect removes member and clears stale invites',()=>{
 const w=setup();
 w.parties.invite('p0','p1');w.parties.respond('p1','p0',true);
 w.parties.invite('p0','p2');
 w.parties.disconnect('p0');
 w.players.delete('p0');
 assert.equal(w.last('p1','partyState').groupId,null);
 assert.equal(w.parties.respond('p2','p0',true),false);
});
test('changing a party member name broadcasts updated roster',()=>{
 const w=setup();
 w.parties.invite('p0','p1');w.parties.respond('p1','p0',true);
 w.players.get('p1').name='Громовой Рог';
 w.parties.renamed('p1');
 assert.equal(w.last('p0','partyState').members[1].name,'Громовой Рог');
});

test('leader can promote an existing member, preserving group identity and roster',()=>{
 const w=setup();
 for(const id of ['p1','p2']){
  assert.equal(w.parties.invite('p0',id),true);
  assert.equal(w.parties.respond(id,'p0',true),true);
 }
 const prior=w.parties.getPartyId('p0');
 assert.equal(w.parties.promote('p0','p2'),true);
 for(const id of ['p0','p1','p2']){
  const state=w.last(id,'partyState');
  assert.equal(state.groupId,prior,'leader transfer must preserve group ID');
  assert.equal(state.leaderId,'p2');
  assert.equal(state.members.length,3);
 }
 assert.equal(w.parties.invite('p0','p3'),false,'old leader loses invite privileges');
 assert.equal(w.parties.invite('p2','p3'),true,'new leader gains invite privileges');
 assert.equal(w.parties.respond('p3','p2',true),true);
 assert.equal(w.last('p1','partyState').members.length,4);
});

test('leader transfer revokes old invitations without allowing stale acceptance',()=>{
 const w=setup();
 w.parties.invite('p0','p1');w.parties.respond('p1','p0',true);
 w.parties.invite('p0','p2');
 assert.equal(w.parties.info().pending,1);
 assert.equal(w.parties.promote('p0','p1'),true);
 assert.equal(w.parties.info().pending,0);
 assert.equal(w.last('p2','partyNotice').error,true);
 assert.equal(w.parties.respond('p2','p0',true),false);
 assert.equal(w.parties.state('p2').groupId,null);
 assert.equal(w.parties.invite('p1','p2'),true);
 assert.equal(w.parties.respond('p2','p1',true),true);
 assert.equal(w.last('p0','partyState').members.length,3);
});

test('only current leader may promote their own connected group member',()=>{
 const w=setup();
 w.parties.invite('p0','p1');w.parties.respond('p1','p0',true);
 w.parties.invite('p2','p3');w.parties.respond('p3','p2',true);
 const groupId=w.parties.getPartyId('p0');
 for(const [from,target] of [
  ['p1','p0'],['p0','p0'],['p0','p3'],['p2','p1'],['p4','p1'],
  ['p0','p4'],['missing','p1'],['p0','missing']
 ]){
  assert.equal(w.parties.promote(from,target),false,from+' may not promote '+target);
  assert.equal(w.parties.state('p0').leaderId,'p0');
  assert.equal(w.parties.getPartyId('p0'),groupId);
 }
 w.players.delete('p1');
 assert.equal(w.parties.promote('p0','p1'),false,'offline member cannot become leader');
});

test('transferred leader disconnect promotes next surviving player and invalidates his invites',()=>{
 const w=setup();
 for(const id of ['p1','p2']){
  w.parties.invite('p0',id);w.parties.respond(id,'p0',true);
 }
 const groupId=w.parties.getPartyId('p0');
 w.parties.promote('p0','p1');
 w.parties.invite('p1','p3');
 assert.equal(w.parties.disconnect('p1'),true);
 w.players.delete('p1');
 assert.equal(w.parties.getPartyId('p1'),null);
 assert.equal(w.parties.respond('p3','p1',true),false);
 for(const id of ['p0','p2']){
  assert.equal(w.last(id,'partyState').groupId,groupId);
  assert.equal(w.last(id,'partyState').leaderId,'p0');
 }
 const nextId='p7';
 w.players.set(nextId,{id:nextId,name:'Возвращённый',level:2});
 assert.equal(w.parties.getPartyId(nextId),null,'a reconnect is not silently trusted as old member');
 assert.equal(w.parties.promote(nextId,'p2'),false);
 assert.equal(w.parties.invite('p0',nextId),true);
 assert.equal(w.parties.respond(nextId,'p0',true),true);
 assert.equal(w.parties.state(nextId).groupId,groupId);
});
