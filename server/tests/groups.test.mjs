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
