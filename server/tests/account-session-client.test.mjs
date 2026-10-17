import test from 'node:test';
import assert from 'node:assert/strict';
import {getAccountLaunch,fetchAuthenticatedProfile} from '../../planet-test/account-session.js';
const id='c01be28a-b89c-4400-a860-eb0701f197e3';
const token='A'.repeat(43);
test('account selection only reads same-origin session storage; no URL bearer token',()=>{
 const good={getItem:key=>key==='ngw-alpha-session'?token:id};
 assert.deepEqual(getAccountLaunch(good),{sessionToken:token,characterId:id});
 assert.equal(getAccountLaunch({getItem:()=>null}),null);
 assert.equal(getAccountLaunch({getItem:key=>key==='ngw-alpha-session'?'invalid':id}),null);
 assert.equal(getAccountLaunch({getItem(){throw Error('no storage')}}),null);
});
test('profile requests authenticate and verify hero identity without sending token in URL',async()=>{
 let url,opts;
 const data={character:{id,nickname:'Герой',worldRadius:261,
  positionNormal:[0,0,1],heading:0,level:1,experience:0,gold:30,
  inventory:[],equipment:{}}};
 const p=await fetchAuthenticatedProfile({sessionToken:token,characterId:id},async(u,o)=>{
  url=u;opts=o;return {ok:true,json:async()=>data};
 });
 assert.equal(p.nickname,'Герой');
 assert.match(url,/\/characters\//);
 assert.equal(url.includes(token),false);
 assert.equal(opts.headers.Authorization,'Bearer '+token);
 await assert.rejects(()=>fetchAuthenticatedProfile({sessionToken:token,characterId:id},
  async()=>({ok:true,json:async()=>({character:{...data.character,id:'c01be28a-b89c-4400-a860-eb0701f197e4'}})})),
  /другого персонажа/);
 await assert.rejects(()=>fetchAuthenticatedProfile({sessionToken:token,characterId:id},
  async()=>({ok:false,status:401})),/Сессия завершена/);
});
