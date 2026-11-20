import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPlayerTradeManager} from '../player-trades.js';
import {exchangeTradeProgress} from '../player-trade-rules.js';
import {ProgressError} from '../progress-rules.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r}),get resolve(){return resolve}}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function setup(){
 let time=1000000,calls=0,hook=null;
 const players=new Map(),events=[],states=new Map();
 const make=(name,items,gold)=>{
  let queue=Promise.resolve();const failures=[];
  const p={id:randomUUID(),accountId:randomUUID(),characterId:randomUUID(),name,
   level:2,classId:'warrior',raceId:'orc',radius:261,normal:[0,0,1],hp:100,lastCombatAt:0,
   savedRevision:0,savedInventory:[...items,...Array(12-items.length).fill(null)],savedGold:gold,failures};
  states.set(p.characterId,{revision:0,inventory:structuredClone(p.savedInventory),gold});
  p.queueTradeSave=operation=>{const result=queue.then(operation);queue=result.catch(error=>failures.push(error));return result};
  p.drain=()=>queue;
  p.publishTradeProgress=progress=>{p.savedRevision=progress.revision;p.savedInventory=progress.inventory;p.savedGold=progress.gold};
  p.exchangeTrade=async({participants,offers,validate})=>{
   calls++;validate();if(hook)await hook();
   const current=participants.map(participant=>{
    const value=states.get(participant.characterId);
    if(value.revision!==participant.expectedRevision)throw new ProgressError('stale_revision',409);
    return value;
   });
   const next=exchangeTradeProgress(current,offers).map(value=>({...value,revision:value.revision+1}));
   validate();
   participants.forEach((p,index)=>states.set(p.characterId,next[index]));
   return {progresses:next};
  };
  players.set(p.id,p);return p;
 };
 const a=make('Алиса',[{id:'feather',qty:10}],30),b=make('Борис',[{id:'healingPotion',qty:3}],20),c=make('Чужой',[],40);
 const manager=createPlayerTradeManager({players,send:(id,event)=>events.push({id,...structuredClone(event)}),now:()=>time});
 const forPlayer=p=>events.filter(event=>event.id===p.id);
 const state=p=>forPlayer(p).filter(event=>event.type==='tradeState').at(-1);
 const open=()=>{
  assert.equal(manager.invite(a.id,b.id),true);
  const id=state(a).tradeId;assert.equal(manager.respond(b.id,id,true),true);return id;
 };
 const offer=(p,id,items,gold=0)=>manager.offer(p.id,{tradeId:id,revision:state(p).revision,items,gold});
 const accept=(p,id,revision=state(p).revision)=>manager.accept(p.id,{tradeId:id,revision,accept:true});
 return {a,b,c,players,events,states,manager,forPlayer,state,open,offer,accept,
  get calls(){return calls},setHook:value=>{hook=value},advance:ms=>{time+=ms;manager.tick(time)}};
}
const item=(tradeSlot,bagSlot,qty)=>({tradeSlot,bagSlot,qty});
test('only both approvals of the current server offer can complete one private exchange',async()=>{
 const h=setup(),id=h.open();
 h.offer(h.a,id,[item(0,0,4)],9);h.offer(h.b,id,[item(1,0,1)],2);
 const before=h.state(h.a).revision;
 h.accept(h.a,id);assert.equal(h.calls,0);
 h.offer(h.b,id,[item(1,0,2)],3);
 assert.equal(h.state(h.a).self.accepted,false);assert.equal(h.state(h.b).self.accepted,false);
 assert.equal(h.accept(h.a,id,before),false,'an older review cannot approve edited items');
 assert.equal(h.calls,0);
 h.accept(h.a,id);h.accept(h.b,id);h.accept(h.b,id);
 await flush();
 assert.equal(h.calls,1);assert.equal(h.manager.activeCount,0);
 assert.equal(h.a.savedGold,24);assert.equal(h.b.savedGold,26);
 assert.equal(h.a.savedRevision,1);assert.equal(h.b.savedRevision,1);
 assert.ok(h.forPlayer(h.a).some(event=>event.type==='tradeClosed'&&event.status==='completed'));
 assert.equal(h.accept(h.a,id),false);assert.equal(h.calls,1);
 const offered=h.events.find(event=>event.type==='tradeState'&&event.other.items.length);
 assert.equal('bagSlot' in offered.other.items[0],false,'partner bag references are private');
 assert.equal('accountId' in offered.self,false);assert.equal('characterId' in offered.other,false);
 assert.equal(h.forPlayer(h.c).length,0,'unrelated players never receive a trade snapshot');
});
test('guests, third parties, forged identity and a second invitation cannot hijack a session',()=>{
 const h=setup(),id=h.open();
 assert.equal(h.manager.respond(h.c.id,id,true),false);
 assert.equal(h.manager.offer(h.c.id,{tradeId:id,revision:0,items:[],gold:0,accountId:h.a.accountId}),false);
 assert.equal(h.manager.cancel(h.c.id,id),false);
 assert.equal(h.manager.invite(h.c.id,h.b.id),false);
 assert.equal(h.manager.activeCount,1);
 h.c.accountId=null;assert.equal(h.manager.invite(h.c.id,h.a.id),false);
 assert.ok(h.forPlayer(h.c).every(event=>event.type==='tradeNotice'));
});
test('a server inventory change removes an invalid offer and clears both approvals',()=>{
 const h=setup(),id=h.open();h.offer(h.a,id,[item(0,0,4)],5);h.accept(h.b,id);
 h.a.savedInventory[0]={id:'wolfPelt',qty:1};h.manager.progressChanged(h.a.id);
 assert.equal(h.state(h.a).self.items.length,0);assert.equal(h.state(h.a).self.gold,0);
 assert.equal(h.state(h.b).self.accepted,false);
 assert.ok(h.forPlayer(h.a).some(event=>event.reason==='trade_item_changed'));
});
for(const change of ['range','death','combat','disconnect','expired']){
 test('open exchange is cancelled by '+change,()=>{
  const h=setup();h.open();
  if(change==='range')h.b.normal=[0,Math.sin(8/261),Math.cos(8/261)];
  if(change==='death')h.b.hp=0;
  if(change==='combat')h.b.lastCombatAt=1000000;
  if(change==='disconnect'){h.manager.disconnect(h.b.id);h.players.delete(h.b.id)}
  h.advance(change==='expired'?120001:1);
  assert.equal(h.manager.activeCount,0);assert.equal(h.calls,0);
  assert.ok(h.forPlayer(h.a).some(event=>event.type==='tradeClosed'&&event.status==='cancelled'));
 });
}
for(const change of ['range','death','disconnect','cancel']){
 test('a change during database work rolls back before COMMIT: '+change,async()=>{
  const h=setup(),id=h.open(),gate=deferred();h.setHook(()=>gate.promise);
  h.offer(h.a,id,[item(0,0,4)],5);h.accept(h.a,id);h.accept(h.b,id);await flush();
  assert.equal(h.state(h.a).phase,'committing');
  if(change==='range')h.b.normal=[0,Math.sin(8/261),Math.cos(8/261)];
  if(change==='death')h.b.hp=0;
  if(change==='disconnect'){h.manager.disconnect(h.b.id);h.players.delete(h.b.id)}
  if(change==='cancel')h.manager.cancel(h.a.id,id);
  h.advance(1);
  assert.equal(h.forPlayer(h.a).some(event=>event.type==='tradeClosed'),false,'COMMIT outcome is still unknown');
  gate.resolve();await flush();await flush();
  assert.equal(h.states.get(h.a.characterId).revision,0);assert.equal(h.states.get(h.b.characterId).revision,0);
  assert.equal(h.a.failures.length,0);assert.equal(h.b.failures.length,0);
  assert.ok(h.forPlayer(h.a).some(event=>event.type==='tradeClosed'&&event.status==='cancelled'));
 });
}
