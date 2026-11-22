import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
import {createSphericalWorld} from '../spherical-world.js';
import {exchangeTradeProgress} from '../player-trade-rules.js';
const deferred=()=>{let resolve;return {promise:new Promise(r=>{resolve=r}),get resolve(){return resolve}}};
async function waitFor(check,timeout=4000){
 const end=Date.now()+timeout;
 while(Date.now()<end){const found=check();if(found)return found;await new Promise(r=>setTimeout(r,10))}
 throw Error('Timed out awaiting player trade');
}
async function fixture(){
 const world=createSphericalWorld();world.close(); // deterministic manual ticks
 const server=createServer(),wss=new WebSocketServer({server}),attached=[];
 const states=new Map(),heroes=new Map(),log=[];let exchangeHook=null,checkpointHook=null,commitLost=false,exchanges=0;
 for(const [name,items,gold] of [['alice',[{id:'feather',qty:10}],30],['bob',[{id:'healingPotion',qty:5}],20]]){
  const hero={accountId:randomUUID(),characterId:randomUUID(),nickname:name,raceId:'orc',classId:'warrior'};
  states.set(hero.characterId,{revision:0,level:2,experience:0,gold,health:120,resource:0,
   worldRadius:261,positionNormal:[0,0,1],heading:0,equipment:{},quests:{},actionBar:[],
   inventory:[...items,...Array(12-items.length).fill(null)]});heroes.set(name,hero);
 }
 const progressStore={
  async saveServerCheckpoint(args){
   if(checkpointHook)await checkpointHook(args);
   const current=states.get(args.characterId);assert.equal(args.expectedRevision,current.revision,'checkpoint uses the latest committed revision');
   const next={...current,revision:current.revision+1,positionNormal:[...args.checkpoint.normal],heading:args.checkpoint.heading,
    health:Math.round(args.serverVitals.health),resource:Math.round(args.serverVitals.resource)};
   states.set(args.characterId,next);log.push({kind:'checkpoint',id:args.characterId,revision:next.revision});
   return {progress:structuredClone(next)};
  },async recordMobKill(){throw Error('No combat expected')}
 };
 const economyStore={async exchangePlayers(args){
  exchanges++;args.validate();if(exchangeHook)await exchangeHook(args);
  const original=args.participants.map(p=>{
   assert.ok([...heroes.values()].some(hero=>hero.accountId===p.accountId&&hero.characterId===p.characterId),
    'only server-owned participant identities enter the store');
   const state=states.get(p.characterId);assert.equal(p.expectedRevision,state.revision);return state;
  });
  const next=exchangeTradeProgress(original,args.offers).map(s=>({...s,revision:s.revision+1}));args.validate();
  args.participants.forEach((p,i)=>states.set(p.characterId,next[i]));log.push({kind:'trade'});
  if(commitLost)throw Object.assign(Error('COMMIT acknowledgement lost'),{tradeCommitUncertain:true,code:'ECONNRESET'});
  return {progresses:structuredClone(next)};
 }};
 wss.on('connection',(ws,request)=>{
  const hero=heroes.get(request.url.slice(1));
  attached.push(world.attach(ws,hero?{trustedCharacter:{...hero,progress:structuredClone(states.get(hero.characterId))},progressStore,economyStore}:{}));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const clients={};
 for(const name of ['alice','bob','guest']){
  const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/'+name),events=[];
  ws.on('message',raw=>events.push(JSON.parse(String(raw))));
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject)});
  ws.send(JSON.stringify({type:'join',name,normal:[0,0,1],radius:261,heading:0,level:2}));
  const welcome=await waitFor(()=>events.find(event=>event.type==='welcome'));
  clients[name]={ws,events,id:welcome.id,send:message=>ws.send(JSON.stringify(message)),
   state:()=>events.filter(e=>e.type==='tradeState').at(-1)};
 }
 const [a,b,guest]=['alice','bob','guest'].map(name=>clients[name]);
 const open=async()=>{
  a.send({type:'tradeInvite',targetId:b.id});
  const invite=await waitFor(()=>b.events.find(e=>e.type==='tradeInvite'));
  b.send({type:'tradeRespond',tradeId:invite.tradeId,accept:true});
  await waitFor(()=>a.state()?.phase==='open'&&b.state()?.phase==='open');return invite.tradeId;
 };
 const offers=async id=>{
  a.send({type:'tradeOffer',tradeId:id,revision:a.state().revision,
   items:[{tradeSlot:0,bagSlot:0,qty:4,itemId:'adminBattlefury'}],gold:5,
   accountId:'forged',characterId:'forged',expectedRevision:999999,context:{radius:87,inCombat:false}});
  await waitFor(()=>a.state()?.revision===1&&b.state()?.revision===1);
  b.send({type:'tradeOffer',tradeId:id,revision:b.state().revision,items:[{tradeSlot:1,bagSlot:0,qty:2}],gold:1});
  await waitFor(()=>a.state()?.revision===2&&b.state()?.revision===2);
 };
 const accept=async id=>{
  for(const client of [a,b])client.send({type:'tradeAccept',tradeId:id,revision:2,accept:true});
  await waitFor(()=>a.state()?.phase==='committing');
 };
 const cleanup=async()=>{
  for(const client of Object.values(clients))if(client.ws.readyState===WebSocket.OPEN)client.ws.close();
  await waitFor(()=>Object.values(clients).every(client=>client.ws.readyState===WebSocket.CLOSED));
  await Promise.allSettled(attached.map(session=>session.drain()));world.close();
  await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>server.close(resolve));
 };
 return {world,a,b,guest,heroes,states,log,open,offers,accept,cleanup,
  setExchangeHook:hook=>{exchangeHook=hook},setCheckpointHook:hook=>{checkpointHook=hook},loseCommit:()=>{commitLost=true},
  get exchanges(){return exchanges}};
}
test('real sockets keep trade private and reserve both progress queues before publishing atomic revisions',
 {timeout:15000},async()=>{
 const h=await fixture();
 try{
  h.guest.send({type:'tradeInvite',targetId:h.a.id});
  await waitFor(()=>h.guest.events.some(e=>e.type==='tradeNotice'));
  assert.equal(h.world.trade.activeCount,0);
  const id=await h.open();await h.offers(id);
  assert.equal(h.a.state().self.items[0].itemId,'feather','forged item IDs cannot become grants');
  assert.equal('bagSlot' in h.b.state().other.items[0],false);
  h.guest.send({type:'tradeAccept',tradeId:id,revision:2,accept:true});
  const a=h.world.players.get(h.a.id),b=h.world.players.get(h.b.id),gate=deferred();let first=true;
  h.setCheckpointHook(async args=>{if(args.characterId===a.characterId&&first){first=false;await gate.promise}});
  const previous=a.queueCheckpoint({normal:[...a.normal],heading:0,radius:261},'before-trade');
  await h.accept(id);assert.equal(h.exchanges,0,'the earlier A save blocks the two-party reservation');
  const laterA=a.queueCheckpoint({normal:[...a.normal],heading:.1,radius:261},'after-trade');
  const laterB=b.queueCheckpoint({normal:[...b.normal],heading:.2,radius:261},'after-trade');
  a.hp=83.5;a.resource=11;b.hp=91.25;b.resource=24;gate.resolve();
  await Promise.all([previous,laterA,laterB]);
  await waitFor(()=>h.a.events.some(e=>e.type==='tradeClosed'&&e.status==='completed'));
  assert.equal(h.exchanges,1);assert.equal(a.savedRevision,3);assert.equal(b.savedRevision,2);
  assert.equal(a.hp,83.5);assert.equal(b.hp,91.25);assert.equal(a.resource,11);assert.equal(b.resource,24);
  assert.equal(h.states.get(a.characterId).gold,26);assert.equal(h.states.get(b.characterId).gold,24);
  assert.deepEqual(h.log.map(e=>e.kind),['checkpoint','trade','checkpoint','checkpoint']);
  assert.equal(h.world.metrics().progressSaveFailures,0);
  assert.equal(h.a.ws.readyState,WebSocket.OPEN);assert.equal(h.b.ws.readyState,WebSocket.OPEN);
  assert.ok(!h.guest.events.some(e=>['tradeState','tradeInvite','tradeClosed'].includes(e.type)));
  h.a.send({type:'tradeAccept',tradeId:id,revision:2,accept:true});
  await waitFor(()=>h.a.events.some(e=>e.type==='tradeNotice'&&e.reason==='trade_unavailable'));
  assert.equal(h.exchanges,1,'a completed session cannot replay after another checkpoint');
 }finally{await h.cleanup()}
 });
test('real socket COMMIT ambiguity closes both sessions and never announces a false cancellation',
 {timeout:12000},async()=>{
 const h=await fixture();
 try{
  const id=await h.open();await h.offers(id);h.loseCommit();await h.accept(id);
  await waitFor(()=>h.a.ws.readyState===WebSocket.CLOSED&&h.b.ws.readyState===WebSocket.CLOSED);
  assert.equal(h.exchanges,1);assert.equal(h.world.metrics().progressSaveFailures,2);
  for(const client of [h.a,h.b])assert.ok(!client.events.some(e=>e.type==='tradeClosed'),
   'neither completed nor cancelled can be claimed after an unknown COMMIT response');
  const saved=[...h.states.values()];assert.equal(saved[0].gold,26);assert.equal(saved[1].gold,24);
  assert.equal(h.world.trade.activeCount,0);
 }finally{await h.cleanup()}
 });
