// Private, authenticated player-to-player exchanges. This manager never trusts
// browser ownership, currency balances, positions or saved progress revisions.
import {randomUUID} from 'node:crypto';
import {ProgressError} from './progress-rules.js';
import {arcDistance} from './spherical-pve.js';
import {resolveTradeOffer,TRADE_RANGE,TRADE_INVITE_MS,TRADE_IDLE_MS} from './player-trade-rules.js';
import {inBothTradeQueues,unsafeTradeFailure} from './player-trade-queue.js';

const empty=()=>({items:[],gold:0});
const cloneOffer=offer=>({gold:offer.gold,items:offer.items.map(item=>({...item}))});
const fail=code=>{throw new ProgressError(code,409)};
const revisionOkay=value=>Number.isSafeInteger(value)&&value>=0;
export function createPlayerTradeManager({players,send,now=Date.now,newId=randomUUID,queueTimeoutMs=15000}){
 const sessions=new Map(),byPlayer=new Map(),lastInvite=new Map();
 const notice=(id,reason)=>send(id,{type:'tradeNotice',reason});
 function eligible(a,b,time=now()){
  if(!a||!b||a===b||!a.accountId||!a.characterId||!b.accountId||!b.characterId||
    typeof a.exchangeTrade!=='function'||typeof b.exchangeTrade!=='function'||
    typeof a.queueTradeSave!=='function'||typeof b.queueTradeSave!=='function')return 'trade_unavailable';
  if(a.radius!==b.radius)return 'trade_wrong_world';
  if(a.hp<=0||b.hp<=0)return 'trade_player_dead';
  if(time-(a.lastCombatAt||0)<5000||time-(b.lastCombatAt||0)<5000)return 'trade_in_combat';
  if(!Number.isFinite(arcDistance(a.normal,b.normal,a.radius))||
    arcDistance(a.normal,b.normal,a.radius)>TRADE_RANGE)return 'trade_too_far';
  return null;
 }
 function identity(player){
  return {id:player.id,name:player.name,level:player.level,
   classId:player.classId||'warrior',raceId:player.raceId||'hornfolk'};
 }
 function publish(session){
  for(let index=0;index<2;index++){
   const own=session.people[index],other=session.people[1-index];
   const self={...identity(own),...cloneOffer(session.offers[index]),accepted:session.accepted[index]};
   const counterpart=cloneOffer(session.offers[1-index]);
   counterpart.items=counterpart.items.map(({bagSlot,...item})=>item);
   send(own.id,{type:'tradeState',tradeId:session.id,revision:session.revision,
    phase:session.phase,self,other:{...identity(other),...counterpart,accepted:session.accepted[1-index]},
    expiresAt:session.expiresAt});
  }
 }
 function forget(session){
  sessions.delete(session.id);
  for(const person of session.people)if(byPlayer.get(person.id)===session.id)byPlayer.delete(person.id);
 }
 function close(session,reason,status='cancelled'){
  if(session.phase==='committing'){
   // A last-minute close may still cause the pre-COMMIT validation to roll
   // back, but cannot be announced as cancelled while COMMIT is in flight.
   session.invalidReason??=reason;return;
  }
  forget(session);
  for(const person of session.people)send(person.id,{type:'tradeClosed',tradeId:session.id,status,reason});
 }
 function member(playerId,tradeId){
  const session=sessions.get(tradeId);
  if(!session||byPlayer.get(playerId)!==tradeId)fail('trade_unavailable');
  return {session,index:session.people.findIndex(person=>person.id===playerId)};
 }
 function validate(session){
  if(session.invalidReason)fail(session.invalidReason);
  if(session.expiresAt<=now())fail('trade_expired');
  if(session.people.some(person=>players.get(person.id)!==person))fail('trade_disconnected');
  const reason=eligible(...session.people);
  if(reason)fail(reason);
 }
 function guard(playerId,operation){
  try{return operation()}
  catch(error){notice(playerId,error instanceof ProgressError?error.code:'trade_unavailable');return false}
 }
 function invite(playerId,targetId){return guard(playerId,()=>{
  const from=players.get(playerId),target=players.get(targetId),time=now();
  const reason=eligible(from,target,time);if(reason)fail(reason);
  if(byPlayer.has(playerId)||byPlayer.has(targetId))fail('trade_busy');
  if(time-(lastInvite.get(playerId)??-Infinity)<2000)fail('trade_invite_cooldown');
  lastInvite.set(playerId,time);
  const session={id:newId(),people:[from,target],offers:[empty(),empty()],accepted:[false,false],
   revision:0,phase:'invited',expiresAt:time+TRADE_INVITE_MS,invalidReason:null};
  sessions.set(session.id,session);byPlayer.set(playerId,session.id);byPlayer.set(targetId,session.id);
  send(targetId,{type:'tradeInvite',tradeId:session.id,from:identity(from),expiresAt:session.expiresAt});
  send(playerId,{type:'tradeState',tradeId:session.id,revision:0,phase:'invited',
   self:{...identity(from),...empty(),accepted:false},other:{...identity(target),...empty(),accepted:false},
   expiresAt:session.expiresAt});
  return true;
 })}
 function respond(playerId,tradeId,accept){return guard(playerId,()=>{
  const {session,index}=member(playerId,tradeId);
  if(index!==1||session.phase!=='invited')fail('trade_unavailable');
  if(accept!==true){close(session,'trade_declined');return true}
  validate(session);if(session.expiresAt<=now()){close(session,'trade_expired');return false}
  session.phase='open';session.expiresAt=now()+TRADE_IDLE_MS;publish(session);return true;
 })}
 function offer(playerId,message){return guard(playerId,()=>{
  const {session,index}=member(playerId,message.tradeId);
  if(session.phase!=='open')fail('trade_unavailable');
  validate(session);
  if(!revisionOkay(message.revision)||message.revision!==session.revision){publish(session);fail('trade_stale_offer')}
  const person=session.people[index];
  const offered=resolveTradeOffer({inventory:person.savedInventory,gold:person.savedGold},message);
  session.offers[index]=offered;session.revision++;
  session.accepted=[false,false];session.expiresAt=now()+TRADE_IDLE_MS;publish(session);return true;
 })}
 async function complete(session){
  try{
   const offers=session.offers.map(cloneOffer),people=session.people;
   await inBothTradeQueues(people,async()=>{
    validate(session);
    const participants=people.map(person=>({accountId:person.accountId,
     characterId:person.characterId,expectedRevision:person.savedRevision}));
    const result=await people[0].exchangeTrade({participants,offers,validate:()=>validate(session)});
    // COMMIT is known to have succeeded. A disconnect after its linearization
    // point cannot turn the completed transfer into a false cancellation.
    for(let index=0;index<2;index++)people[index].publishTradeProgress(result.progresses[index]);
   },{timeoutMs:queueTimeoutMs});
   forget(session);
   for(const person of session.people)send(person.id,{type:'tradeClosed',tradeId:session.id,status:'completed'});
  }catch(error){
   forget(session);
   if(unsafeTradeFailure(error)){
    // Queue failures close both sessions. Their reconnect must reload the
    // primary database; never retry with refreshed revisions after COMMIT.
    for(const person of session.people)notice(person.id,'trade_save_failed');
   }else for(const person of session.people)send(person.id,{type:'tradeClosed',tradeId:session.id,
    status:'cancelled',reason:error.code});
  }
 }
 function accept(playerId,message){return guard(playerId,()=>{
  const {session,index}=member(playerId,message.tradeId);
  if(session.phase!=='open')return session.phase==='committing';
  validate(session);
  if(typeof message.accept!=='boolean')fail('invalid_trade_offer');
  if(!revisionOkay(message.revision)||message.revision!==session.revision){publish(session);fail('trade_stale_offer')}
  session.accepted[index]=message.accept!==false;session.expiresAt=now()+TRADE_IDLE_MS;
  if(session.accepted.every(Boolean))session.phase='committing';
  publish(session);
  if(session.phase==='committing')void complete(session);
  return true;
 })}
 function cancel(playerId,tradeId){return guard(playerId,()=>{
  close(member(playerId,tradeId).session,'trade_cancelled');return true;
 })}
 function disconnect(playerId){
  const session=sessions.get(byPlayer.get(playerId));if(session)close(session,'trade_disconnected');
  lastInvite.delete(playerId);
 }
 function progressChanged(playerId){
  const session=sessions.get(byPlayer.get(playerId));
  if(!session||session.phase!=='open')return;
  const index=session.people.findIndex(person=>person.id===playerId),person=session.people[index];
  try{
   const current=resolveTradeOffer({inventory:person.savedInventory,gold:person.savedGold},session.offers[index]);
   if(current.items.some((item,i)=>item.itemId!==session.offers[index].items[i].itemId))throw Error('changed');
  }catch{
   session.offers[index]=empty();session.accepted=[false,false];session.revision++;
   publish(session);notice(playerId,'trade_item_changed');
  }
 }
 function tick(time=now()){
  for(const session of sessions.values()){
   const reason=session.people.some(person=>players.get(person.id)!==person)?'trade_disconnected':
    eligible(...session.people,time)||(session.expiresAt<=time?'trade_expired':null);
   if(reason)close(session,reason);
  }
 }
 function handle(playerId,message){
  if(message.type==='tradeInvite')return invite(playerId,message.targetId);
  if(message.type==='tradeRespond')return respond(playerId,message.tradeId,message.accept);
  if(message.type==='tradeOffer')return offer(playerId,message);
  if(message.type==='tradeAccept')return accept(playerId,message);
  if(message.type==='tradeCancel')return cancel(playerId,message.tradeId);
  return false;
 }
 return {handle,invite,respond,offer,accept,cancel,disconnect,progressChanged,tick,
  close:()=>{for(const session of sessions.values())close(session,'trade_disconnected')},
  get activeCount(){return sessions.size}};
}
