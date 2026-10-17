import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createAccountApi} from '../account-api.js';
import {hashPassword} from '../auth-crypto.js';

function memoryStore(){
 const users=new Map(),sessions=new Map(),limits=new Map();
 let next=0;
 return {
  limits,
  async createAccount(username,password_hash,digests){
   if(users.has(username))throw Object.assign(Error('Логин занят'),{status:409});
   const user={id:'user-'+(++next),username,password_hash,status:'active'};
   users.set(username,user);return user;
  },
  async passwordRecord(username){return users.get(username)||null;},
  async passwordRecordById(id){return [...users.values()].find(u=>u.id===id)||null;},
  async saveSession(id,digest){
   sessions.set(digest.toString('hex'),[...users.values()].find(u=>u.id===id));
  },
  async accountForSession(digest){return sessions.get(digest.toString('hex'))||null;},
  async revokeSession(digest){sessions.delete(digest.toString('hex'));},
  async consumeAuthRate(key,max){
   const count=(limits.get(key)||0)+1;
   limits.set(key,count);return count<=max;
  },
  async changePassword(id,oldHash,newHash){
   const user=[...users.values()].find(u=>u.id===id);
   if(!user||user.password_hash!==oldHash)return false;
   user.password_hash=newHash;
   for(const [key,value] of sessions)if(value.id===id)sessions.delete(key);
   return true;
  }
 };
}
test('alpha invitation and password change revoke existing sessions', {timeout:35000},async()=>{
 const store=memoryStore();
 const handler=createAccountApi({store,alphaInvite:'NGW-private-invite',
  rateSecret:'hardening-test-secret',allowedOrigins:['https://nexions.ru']});
 const server=createServer(async(req,res)=>{
  const handled=await handler(req,res);
  if(!handled){res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 async function post(path,body,token){
  const res=await fetch(base+path,{method:'POST',
   headers:{Origin:'https://nexions.ru','Content-Type':'application/json',
    ...(token?{Authorization:'Bearer '+token}:{})},
   body:JSON.stringify(body)});
  return {status:res.status,data:await res.json()};
 }
 try{
  const identity={username:'alphauser',password:'abc123'};
  assert.equal((await post('/api/ngw/register',identity)).status,403);
  assert.equal((await post('/api/ngw/register',{...identity,inviteCode:'wrong'})).status,403);
  const registered=await post('/api/ngw/register',{...identity,inviteCode:'NGW-private-invite'});
  assert.equal(registered.status,201);
  assert.equal(registered.data.recoveryCodes.length,8);
  const login=await post('/api/ngw/login',identity);
  assert.equal(login.status,200);
  const token=login.data.token;
  assert.equal((await post('/api/ngw/password',{currentPassword:'bad123',newPassword:'zxc123'},token)).status,401);
  assert.equal((await post('/api/ngw/password',{currentPassword:'abc123',newPassword:'abc123'},token)).status,400);
  assert.equal((await post('/api/ngw/password',{currentPassword:'abc123',newPassword:'zxc123'},token)).status,200);
  assert.equal((await post('/api/ngw/password',{currentPassword:'zxc123',newPassword:'hello77'},token)).status,401);
  assert.equal((await post('/api/ngw/login',identity)).status,401);
  assert.equal((await post('/api/ngw/login',{...identity,password:'zxc123'})).status,200);
  // Verify database-backed rate counters instead of memory-only per instance.
  assert.ok(store.limits.size>=2);
  const limit=async username=>{
   for(let i=0;i<44;i++){
    const result=await post('/api/ngw/login',{username,password:'wrongpass'});
    if(result.status===429)return true;
   }
   return false;
  };
  assert.equal(await limit('nonexistentalpha'),true);
 }finally{
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 }
});
