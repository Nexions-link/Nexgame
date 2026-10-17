// One-time local end-to-end check for the opt-in alpha account API.
// Generates test credentials in memory; never logs or writes them anywhere.
import {randomBytes} from 'node:crypto';
async function jsonRequest(base,path,{method='GET',body=null,token=null}={}){
 const headers={'accept':'application/json'};
 if(body!==null)headers['content-type']='application/json';
 if(token)headers.authorization='Bearer '+token;
 const res=await fetch(base+path,{method,headers,body:body===null?undefined:JSON.stringify(body)});
 const json=await res.json();
 return {status:res.status,data:json};
}
function requireResponse(response,status,step){
 if(response.status!==status)throw new Error('Account smoke '+step+' returned HTTP '+response.status);
 return response.data;
}
export async function runAccountSmoke(port){
 const base='http://127.0.0.1:'+port+'/api/ngw';
 const username='ngwtest'+randomBytes(5).toString('hex');
 const password=randomBytes(24).toString('base64url');
 const nickname='Тест'+randomBytes(4).toString('hex');
 const register=requireResponse(await jsonRequest(base,'/register',{
  method:'POST',body:{username,password}}),201,'register');
 if(register.username!==username||register.recoveryCodes?.length!==8)
  throw new Error('Account smoke recovery codes invalid');
 requireResponse(await jsonRequest(base,'/login',{method:'POST',body:{
  username,password:'incorrect-pass-12'}}),401,'reject wrong password');
 const login=requireResponse(await jsonRequest(base,'/login',{method:'POST',
  body:{username,password}}),200,'login');
 const token=login.token;
 if(typeof token!=='string'||token.length!==43)throw Error('Account smoke session invalid');
 const before=requireResponse(await jsonRequest(base,'/characters',{token}),200,'empty list');
 if(before.characters.length!==0)throw Error('Account smoke new account not empty');
 const character=requireResponse(await jsonRequest(base,'/characters',{
  token,method:'POST',body:{nickname}}),201,'create character').character;
 if(character.nickname!==nickname||character.level!==1||!character.id)
  throw new Error('Account smoke new character wrong defaults');
 const list=requireResponse(await jsonRequest(base,'/characters',{token}),200,'list character');
 if(list.characters.length!==1||list.characters[0].nickname!==nickname||list.characters[0].level!==1)
  throw new Error('Account smoke character not persisted');
 const saved=requireResponse(await jsonRequest(base,'/characters/'+character.id,{token}),200,'load character').character;
 if(saved.level!==1||saved.experience!==0||saved.gold!==30||
    !Array.isArray(saved.inventory)||saved.inventory.length!==0)
  throw new Error('Account smoke starting progress does not match database');
 requireResponse(await jsonRequest(base,'/characters',{
  token,method:'POST',body:{nickname:'СтарыйТест',legacySave:{level:60}}}),400,'reject old saves');
 requireResponse(await jsonRequest(base,'/characters/'+character.id,{method:'DELETE',body:{confirmNickname:nickname},token}),200,'remove hero');
 requireResponse(await jsonRequest(base,'/characters/'+character.id,{token}),404,'removed hero inaccessible');
 const activeAfter= requireResponse(await jsonRequest(base,'/characters',{token}),200,'after deletion');
 if(activeAfter.characters.length!==0)throw Error('Removed test hero still active');

 requireResponse(await jsonRequest(base,'/logout',{token,method:'POST',body:{}}),200,'logout');
 requireResponse(await jsonRequest(base,'/characters',{token}),401,'revoked session');
 console.log('NexGameWorld account smoke: ok (registered, signed in, created level-1 hero, verified persistent record, rejected old saves, logged out)');
 return true;
}
