// Private-by-default NexGameWorld account HTTP API.
// Install on the Render Node server only after a durable DB is provisioned.
// This API does not accept arbitrary client-side XP, inventory or gold writes.
import {
 normalizeUsername,validatePassword,CHARACTER_SLOT_LIMIT
} from './account-rules.js';
import {hashPassword,verifyPassword,newSessionToken,tokenDigest,
 createRecoveryCodes,recoveryCodeDigest} from './auth-crypto.js';

const MAX_BODY=4096,SESSION_DAYS=7,WINDOW_MS=15*60*1000;
const VALID_ORIGINS=new Set(['https://nexions.ru','https://www.nexions.ru']);
const json=(res,status,data)=>{
 res.writeHead(status,{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(JSON.stringify(data));
};
function readJson(req){
 return new Promise((resolve,reject)=>{
  if(!String(req.headers['content-type']||'').startsWith('application/json'))
   return reject(Object.assign(Error('Требуется JSON'),{status:415}));
  let body='',length=0,tooLarge=false;
  req.on('data',chunk=>{
   length+=chunk.length;
   if(length>MAX_BODY){tooLarge=true;return}
   body+=chunk.toString('utf8');
  });
  req.on('error',reject);
  req.on('end',()=>{
   if(tooLarge)return reject(Object.assign(Error('Слишком большой запрос'),{status:413}));
   try{
    const object=JSON.parse(body);
    if(!object||typeof object!=='object'||Array.isArray(object))throw Error();
    resolve(object);
   }catch{reject(Object.assign(Error('Некорректный JSON'),{status:400}))}
  });
 });
}
export function createAccountApi({store,allowedOrigins=VALID_ORIGINS}){
 if(!store)throw Error('Account store is required');
 const buckets=new Map();
 const allowed=new Set(allowedOrigins);
 const dummyHash=hashPassword('nonexistent-account-placeholder-secret');
 const rateLimit=(key,max)=>{
  const now=Date.now(),row=buckets.get(key);
  if(!row||row.until<now){buckets.set(key,{until:now+WINDOW_MS,count:1});return true;}
  row.count++;
  return row.count<=max;
 };
 const auth=async req=>{
  const h=String(req.headers.authorization||'');
  if(!h.startsWith('Bearer '))return null;
  const digest=tokenDigest(h.slice(7));
  return digest?store.accountForSession(digest):null;
 };
 return async function handleAccountApi(req,res){
  const method=req.method||'GET',path=new URL(req.url||'/', 'https://nexions.ru').pathname;
  if(!path.startsWith('/api/ngw/'))return false;
  const origin=req.headers.origin;
  if(origin){
   if(!allowed.has(origin)){json(res,403,{error:'Недопустимый источник'});return true;}
   res.setHeader('access-control-allow-origin',origin);
   res.setHeader('vary','Origin');
   res.setHeader('access-control-allow-headers','Authorization,Content-Type');
   res.setHeader('access-control-allow-methods','GET,POST,OPTIONS');
  }
  if(method==='OPTIONS'){res.writeHead(204);res.end();return true;}
  if(method!=='GET'&&method!=='POST'){
   json(res,405,{error:'Метод не поддерживается'});return true;
  }
  try{
   if(method==='POST'&&path==='/api/ngw/register'){
    const key='register:'+String(req.socket.remoteAddress||'unknown');
    if(!rateLimit(key,5)){json(res,429,{error:'Попробуйте позже'});return true;}
    const data=await readJson(req);
    const username=normalizeUsername(data.username),password=validatePassword(data.password);
    const account=await store.createAccount(username,await hashPassword(password));
    const codes=createRecoveryCodes();
    try{
     await store.saveRecoveryCodes(account.id,codes.map(recoveryCodeDigest));
    }catch(error){
     // Prevent an account without recovery codes from entering normal use.
     console.error('Account recovery code creation failed',error?.code||error?.name||'unknown');
     throw error;
    }
    // Show recovery codes ONCE. We never store or return their plaintext later.
    json(res,201,{accountId:account.id,username:account.username,
     recoveryCodes:codes});
    return true;
   }
   if(method==='POST'&&path==='/api/ngw/login'){
    const key='login:'+String(req.socket.remoteAddress||'unknown');
    if(!rateLimit(key,12)){json(res,429,{error:'Попробуйте позже'});return true;}
    const data=await readJson(req);
    const username=normalizeUsername(data.username),password=validatePassword(data.password);
    const record=await store.passwordRecord(username);
    const verified=await verifyPassword(password,record?.password_hash||await dummyHash);
    if(!record||!verified||record.status!=='active'){
     json(res,401,{error:'Неверный логин или пароль'});
     return true;
    }
    const token=newSessionToken(),expiresAt=new Date(Date.now()+SESSION_DAYS*86400000);
    await store.saveSession(record.id,tokenDigest(token),expiresAt);
    json(res,200,{token,expiresAt:expiresAt.toISOString(),
     account:{id:record.id,username:record.username}});
    return true;
   }
   if(method==='POST'&&path==='/api/ngw/recover'){
    const key='recover:'+String(req.socket.remoteAddress||'unknown');
    if(!rateLimit(key,5)){json(res,429,{error:'Попробуйте позже'});return true;}
    const data=await readJson(req);
    const username=normalizeUsername(data.username);
    const digest=recoveryCodeDigest(data.recoveryCode);
    const newPassword=validatePassword(data.newPassword);
    if(!digest){json(res,400,{error:'Некорректный резервный код'});return true;}
    const ok=await store.consumeRecoveryCode(username,digest,await hashPassword(newPassword));
    if(!ok){json(res,401,{error:'Неверный логин или резервный код'});return true;}
    json(res,200,{ok:true,sessionsRevoked:true});return true;
   }
   const account=await auth(req);
   if(!account){json(res,401,{error:'Требуется вход в аккаунт'});return true;}
   if(method==='POST'&&path==='/api/ngw/logout'){
    const digest=tokenDigest(String(req.headers.authorization).slice(7));
    await store.revokeSession(digest);
    json(res,200,{ok:true});return true;
   }
   if(method==='GET'&&path==='/api/ngw/me'){
    json(res,200,{id:account.id,username:account.username});return true;
   }
   if(method==='GET'&&path==='/api/ngw/characters'){
    const characters=await store.listCharacters(account.id);
    json(res,200,{characters,slots:CHARACTER_SLOT_LIMIT});return true;
   }
   if(method==='POST'&&path==='/api/ngw/characters'){
    const data=await readJson(req);
    const character=await store.createCharacter(account.id,data);
    json(res,201,{character});return true;
   }
   const match=path.match(/^\/api\/ngw\/characters\/([a-f0-9-]+)$/i);
   if(method==='GET'&&match){
    const character=await store.loadCharacter(account.id,match[1]);
    json(res,character?200:404,character?{character}:{error:'Персонаж не найден'});
    return true;
   }
   json(res,404,{error:'Маршрут не найден'});return true;
  }catch(error){
   const status=Number.isInteger(error?.status)?error.status:
    error instanceof TypeError?400:500;
   if(status===500)console.error('NexGameWorld account API error',error?.code||error?.name||'unknown');
   json(res,status,{error:status===500?'Временная ошибка сервера':error.message});
   return true;
  }
 };
}
