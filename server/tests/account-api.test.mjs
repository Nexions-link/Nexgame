import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createAccountApi} from '../account-api.js';
import {validateCharacterOptions} from '../account-rules.js';
const ORIGIN='https://nexions.ru';

function mockStore(){
 const accounts=new Map(),tokens=new Map(),characters=new Map();
 let count=0;
 return {
  async createAccount(email,password_hash){
   if(accounts.has(email))throw Object.assign(Error('Адрес занят'),{status:409});
   const account={id:'account-'+(++count),email,password_hash,
    status:'active',email_verified_at:null};
   accounts.set(email,account);
   return account;
  },
  async passwordRecord(email){return accounts.get(email)||null},
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
 const api=createAccountApi({store:mockStore(),allowUnverified:true});
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
   email:'test@example.com',password:'enough-long-password!'
  },null,'https://attacker.invalid')).status,403);
  assert.equal((await post('/api/ngw/register',{
   email:'test@example.com',password:'short'
  })).status,400);
  assert.equal((await post('/api/ngw/register',{
   email:'test@example.com',password:'enough-long-password!'
  })).status,201);
  assert.equal((await post('/api/ngw/login',{
   email:'test@example.com',password:'not-correct-password'
  })).status,401);
  const logged=await post('/api/ngw/login',{
   email:'test@example.com',password:'enough-long-password!'
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
  assert.equal((await get('/api/ngw/characters',token)).json.characters.length,1);
  assert.equal((await get('/api/ngw/characters/char-1',token)).status,404);
  assert.equal((await post('/api/ngw/characters',{
   nickname:'Маг',classId:'mage'
  },token)).status,400);
  assert.equal((await post('/api/ngw/logout',{},token)).status,200);
  assert.equal((await get('/api/ngw/me',token)).status,401);
 }finally{
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
 }
});
