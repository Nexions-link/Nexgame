// PostgreSQL errors at/after COMMIT can leave the outcome uncertain.
// Do not attempt another mutation on the same stale in-memory character.
// Force reconnection and reload persisted revision from the primary database.
const SQLSTATE=new Set(['40001','40P01','53300','53400','55P03',
 '57P01','57P02','57P03','XX000']);
const NETWORK_CODES=new Set(['ECONNRESET','ECONNREFUSED','ECONNABORTED',
 'ETIMEDOUT','EPIPE','ENOTFOUND','EAI_AGAIN','ERR_STREAM_DESTROYED']);
const CONNECTION_PATTERN=/connection (?:terminated|ended|closed|lost)|client has encountered a connection error|connection timeout|timeout exceeded when trying to connect|server closed the connection unexpectedly|cannot use a pool after calling end/i;
export function isUnsafeDatabaseFailure(error){
 if(!error||typeof error!=='object')return false;
 const code=String(error.code||'').toUpperCase();
 if(code.startsWith('08')||SQLSTATE.has(code)||NETWORK_CODES.has(code))return true;
 if((error.name==='ConnectionError'||error.name==='ConnectionTimeoutError')&&
  typeof error.message==='string')return true;
 if(typeof error.message==='string'&&CONNECTION_PATTERN.test(error.message))return true;
 return Boolean(error.cause&&error.cause!==error&&isUnsafeDatabaseFailure(error.cause));
}
