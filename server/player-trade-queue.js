// A trade reserves both existing save queues. Earlier checkpoints finish first;
// later writes cannot run until both newly committed revisions are published.
import {ProgressError} from './progress-rules.js';
import {isUnsafeDatabaseFailure} from './database-failures.js';

export const unsafeTradeFailure=error=>!!(error?.tradeQueueFailure||
 error?.tradeCommitUncertain||isUnsafeDatabaseFailure(error)||!(error instanceof ProgressError));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
export async function inBothTradeQueues(players,operation,{timeoutMs=15000}={}){
 if(!Array.isArray(players)||players.length!==2||players[0]===players[1]||
   players.some(player=>typeof player?.queueTradeSave!=='function'))
  throw new ProgressError('trade_unavailable',409);
 const released=deferred(),ready=players.map(()=>deferred());
 const holds=players.map((player,index)=>{
  try{return Promise.resolve(player.queueTradeSave(async()=>{
   ready[index].resolve();
   const error=await released.promise;
   if(error)throw error;
  }))}catch(error){return Promise.reject(error)}
 });
 // Observe every rejection immediately, including a queue that already failed.
 const priorFailure=new Promise((_resolve,reject)=>{
  for(const hold of holds)void hold.catch(reject);
 });
 const timeout=deferred();
 const timer=setTimeout(()=>{
  const error=Object.assign(Error('trade_save_timeout'),{code:'trade_save_timeout',tradeQueueFailure:true});
  timeout.reject(error);
 },timeoutMs);
 timer.unref?.();
 try{
  await Promise.race([Promise.all(ready.map(item=>item.promise)),priorFailure,timeout.promise]);
  const result=await operation();
  released.resolve(null);
  await Promise.all(holds);
  return result;
 }catch(error){
  // Resolve the other barrier even if one queue failed before reaching it.
  // Do not wait for a broken earlier operation to finish while holding its peer.
  released.resolve(unsafeTradeFailure(error)?error:null);
  void Promise.allSettled(holds);
  throw error;
 }finally{clearTimeout(timer)}
}
