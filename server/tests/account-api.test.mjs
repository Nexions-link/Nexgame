import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createAccountApi} from '../account-api.js';
import {validateCharacterOptions} from '../account-rules.js';
const ORIGIN='https://nexions.ru';

function mockStore(){
 const accounts=new Map(),tokens=new Map(),characters=new Map(),codeSets=new Map();
 let count=0;
 return {
  async createAccount(username,password_hash,digests){
   if(accounts.has(username))throw Object.assign(Error('Адрес занят'),{status:409});
   const account={id:'account-'+(++count),username,password_hash,
    status:'active'};
   accounts.set(username,account);
   codeSets.set(account.id,new Set(digests.map(x=>x.toString('hex'))));
   return account;
  },
  async passwordRecord(username){return accounts.get(username)||null},
  async consumeRecoveryCode(username,digest,newPasswordHash){
   const a=accounts.get(username),key=digest.toString('hex');
   if(!a||!codeSets.get(a.id)?.has(key))return false;
   codeSets.get(a.id).delete(key);a.password_hash=newPasswordHash;
   for(const [token,user] of tokens)if(user.id===a.id)tokens.delete(token);
   return true;
  },
  async saveSession(id,digest){
   const account=[...accounts.values()].find(a=>a.id===id);
   tokens.set(digest.toString('hex'),account);
  },
  async accountForSession(digest){return tokens.get(digest.toString('hex'))||null},
  async revokeSession(digest){tokens.delete(digest.toString('hex'))},
  async listCharacters(id){return characters.get(id)||[]},
  async createCharacter(id,raw){
   const character=validateCharacterOptions(raw);
   const rows=characters.get(id)||[];
   if(rows.length>=3)throw Object.assign(Error('Нет слотов'),{status:409});
   const row={id:'char-'+(rows.length+1),...character,level:1};
   rows.push(row);characters.set(id,rows);
   return row;
  },
  async loadCharacter(id,charId){
   return (characters.get(id)||[]).find(row=>row.id===charId)||null;
  }
 };
}
test('account API requires safe origin and session; creates a character without client state writes',
 {timeout:20000},async()=>{
 const api=createAccountApi({store:mockStore()});
 const server=createServer(async(req,res)=>{
  const handled=await api(req,res);
  if(!handled){res.statusCode=404;res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const host='http://127.0.0.1:'+server.address().port;
 const post=async(path,data,token=null,origin=ORIGIN)=>{
  const res=await fetch(host+path,{method:'POST',headers:{
   Origin:origin,'Content-Type':'application/json',
   ...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
  return {status:res.status,json:await res.json()};
 };
 const get=async(path,token=null)=>{
  const res=await fetch(host+path,{headers:{Origin:ORIGIN,
   ...(token?{Authorization:'Bearer '+token}:{})}});
  return {status:res.status,json:await res.json()};
 };
 try{
  assert.equal((await post('/api/ngw/register',{
   username:'herotest',password:'enough-long-password!'
  },null,'https://attacker.invalid')).status,403);
  assert.equal((await post('/api/ngw/register',{
   username:'herotest',password:'1234567'
  })).status,400);
  const registration=await post('/api/ngw/register',{
   username:'herotest',password:'enough-long-password!'
  });
  assert.equal(registration.status,201);
  assert.equal((await post('/api/ngw/register',{
   username:'alphatest',password:'12345678'
  })).status,201);
  assert.equal(registration.json.recoveryCodes.length,8);
  assert.equal((await post('/api/ngw/login',{
   username:'herotest',password:'not-correct-password'
  })).status,401);
  const logged=await post('/api/ngw/login',{
   username:'herotest',password:'enough-long-password!'
  });
  assert.equal(logged.status,200);
  assert.equal(typeof logged.json.token,'string');
  const token=logged.json.token;
  assert.equal((await get('/api/ngw/characters')).status,401);
  assert.equal((await get('/api/ngw/characters',token)).status,200);
  const character=await post('/api/ngw/characters',{
   nickname:'Копытце',raceId:'hornfolk',classId:'warrior'
  },token);
  assert.equal(character.status,201);
  assert.equal(character.json.character.nickname,'Копытце');
  assert.equal(character.json.character.level,1);
  assert.equal((await post('/api/ngw/characters',{
   nickname:'СтарыйГерой',legacySave:{level:60,gold:30000}
  },token)).status,400);
  assert.equal((await post('/api/ngw/characters',{
   nickname:'Подмена',level:50,inventory:[{id:'legendary_weapon'}]
  },token)).status,400);

  assert.equal((await get('/api/ngw/characters',token)).json.characters.length,1);
  assert.equal((await get('/api/ngw/characters/char-1',token)).status,404);
  assert.equal((await post('/api/ngw/characters',{
   nickname:'Маг',classId:'mage'
  },token)).status,400);
  assert.equal((await post('/api/ngw/logout',{},token)).status,200);
  assert.equal((await get('/api/ngw/me',token)).status,401);
  const recovered=await post('/api/ngw/recover',{
   username:'herotest',recoveryCode:registration.json.recoveryCodes[0],
   newPassword:'new-password-for-account!'
  });
  assert.equal(recovered.status,200);
  assert.equal((await post('/api/ngw/recover',{
   username:'herotest',recoveryCode:registration.json.recoveryCodes[0],
   newPassword:'new-password-for-account!'
  })).status,401);
 }finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
 }
});
