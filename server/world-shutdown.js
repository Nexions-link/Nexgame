// Stop authenticated WebSockets before closing the database pools.
// The world socket's 'close' listener queues a final server-owned checkpoint;
// its save queue must drain before Render completes SIGTERM.
function deadline(promise,timeoutMs,label){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Timed out draining '+label)),timeoutMs);
  // Keep shutdown alive until either completion or the safety timeout.
  promise.then(result=>{clearTimeout(timer);resolve(result)},
   error=>{clearTimeout(timer);reject(error)});
 });
}
export async function flushWorldOnShutdown({world,wss,sessions,timeoutMs=12000}){
 if(!world||!wss||!sessions)throw TypeError('World shutdown dependencies missing');
 world.close(); // Stop simulation before capturing final state.
 const sockets=[...wss.clients];
 const closed=sockets.map(socket=>new Promise(resolve=>{
  if(socket.readyState===3){resolve();return;}
  socket.once('close',resolve);
  try{socket.terminate()}catch{resolve()}
 }));
 // 'close' handlers enqueue exit checkpoint synchronously.
 await deadline(Promise.allSettled(closed),timeoutMs,'websocket connections');
 // The session set retains recently closed connections until their save queue
 // is fully flushed; capture it AFTER close events have enqueued checkpoints.
 const active=[...sessions];
 const results=await deadline(Promise.allSettled(active.map(x=>x.drain())),
  timeoutMs,'character progress');
 if(results.some(row=>row.status==='rejected'))
  throw Error('A character save queue rejected during shutdown');
 return {closedSockets:sockets.length,drainedSessions:active.length};
}
