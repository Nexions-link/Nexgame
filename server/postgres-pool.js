// A pg.Pool emits 'error' when a disconnected IDLE client is removed.
// Without a listener, EventEmitter terminates the entire Render process.
import pg from 'pg';
export function watchPgPool(pool,{label='pool',onIdleError=()=>{},
 log=message=>console.error(message),clock=Date.now,logIntervalMs=30000}={}){
 if(!pool||typeof pool.on!=='function')throw TypeError('Invalid PostgreSQL pool');
 let last=-Infinity,missed=0;
 pool.on('error',error=>{
  try{onIdleError(error)}catch{ /* Observer never takes down the process. */ }
  const now=clock();
  if(now-last>=logIntervalMs){
   const code=typeof error?.code==='string'&&/^[a-z0-9_-]{1,30}$/i.test(error.code)
    ?error.code:'connection_closed';
   const suffix=missed?'; repeated='+missed:'';
   try{log('NGW PostgreSQL '+label+' idle connection lost: '+code+suffix)}catch{}
   last=now;missed=0;
  }else missed++;
 });
 return pool;
}
export function createResilientPgPool(options,{label,onIdleError,log}={}){
 return watchPgPool(new pg.Pool(options),{label,onIdleError,log});
}
