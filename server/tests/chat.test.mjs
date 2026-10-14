import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatManager,normalizeChatMessage,CHAT_LIMIT,CHAT_COOLDOWN_MS,CHAT_BURST_LIMIT}
 from '../chat.js';
import {createPartyManager} from '../groups.js';

function setup(){
 let time=100_000;
 const players=new Map(['a','b','c'].map(id=>[id,{id,name:'Игрок '+id,level:1}]));
 const inbox=new Map([...players.keys()].map(id=>[id,[]]));
 const send=(id,data)=>{inbox.get(id)?.push(data)};
 const broadcast=data=>{for(const id of players.keys())send(id,data)};
 const now=()=>time;
 const parties=createPartyManager({players,send,now});
 const chat=createChatManager({players,parties,send,broadcast,now});
 const messages=(id,type='chat')=>(inbox.get(id)||[]).filter(event=>event.type===type);
 return {players,inbox,parties,chat,messages,advance:ms=>{time+=ms}};
}
test('world chat only uses server-owned sender identity and reaches everyone',()=>{
 const w=setup();
 assert.equal(w.chat.handle('a',{channel:'world',text:'  Привет   Мулгор!  ',name:'Подмена'}),true);
 for(const id of ['a','b','c']){
  const event=w.messages(id)[0];
  assert.equal(event.name,'Игрок a');
  assert.equal(event.fromId,'a');
  assert.equal(event.channel,'world');
  assert.equal(event.text,'Привет Мулгор!');
  assert.equal(typeof event.at,'number');
 }
});
test('party channel excludes outsiders and requires actual membership',()=>{
 const w=setup();
 assert.equal(w.chat.handle('c',{channel:'party',text:'Привет'}),false);
 w.parties.invite('a','b');w.parties.respond('b','a',true);
 assert.equal(w.chat.handle('a',{channel:'party',text:'Только для своих'}),true);
 assert.equal(w.messages('a').length,1);
 assert.equal(w.messages('b').length,1);
 assert.equal(w.messages('c').length,0);
 assert.equal(w.messages('b')[0].groupId,w.parties.getPartyId('a'));
 w.parties.leave('b');
 w.advance(CHAT_COOLDOWN_MS+1);
 assert.equal(w.chat.handle('a',{channel:'party',text:'Больше группы нет'}),false);
 assert.equal(w.messages('c').length,0);
});
test('chat body is bounded, plain-text, whitespace-normalized and rejects invalid input',()=>{
 assert.equal(normalizeChatMessage('\n  Тест \t текста  '),'Тест текста');
 assert.equal(normalizeChatMessage(''),null);
 assert.equal(normalizeChatMessage(' '.repeat(30)),null);
 assert.equal(normalizeChatMessage('а'.repeat(CHAT_LIMIT+1)),null);
 assert.equal(normalizeChatMessage('🙂'.repeat(CHAT_LIMIT))?.length,CHAT_LIMIT*2);
 assert.equal(normalizeChatMessage({text:'bad'}),null);
 const w=setup();
 assert.equal(w.chat.handle('a',{channel:'world',text:' '}),false);
 assert.equal(w.chat.handle('a',{channel:'unknown',text:'text'}),false);
 assert.equal(w.messages('b').length,0);
 assert.ok(w.messages('a','chatRejected').length>=2);
});
test('rate limit rejects rapid sends and sustained bursts',()=>{
 const w=setup();
 for(let n=0;n<CHAT_BURST_LIMIT;n++){
  assert.equal(w.chat.handle('a',{channel:'world',text:'Сообщение '+n}),true);
  if(n<CHAT_BURST_LIMIT-1)w.advance(CHAT_COOLDOWN_MS);
 }
 w.advance(CHAT_COOLDOWN_MS);
 assert.equal(w.chat.handle('a',{channel:'world',text:'Лимит'}),false);
 assert.equal(w.messages('b').length,CHAT_BURST_LIMIT);
 w.advance(10_100);
 assert.equal(w.chat.handle('a',{channel:'world',text:'После ожидания'}),true);
});
test('disconnect cleans throttling and invalid sender never broadcasts',()=>{
 const w=setup();
 assert.equal(w.chat.handle('a',{channel:'world',text:'Старт'}),true);
 assert.equal(w.chat.handle('ghost',{channel:'world',text:'Невидимка'}),false);
 w.chat.disconnect('a');
 assert.equal(w.chat.handle('a',{channel:'world',text:'После переподключения'}),true);
 assert.equal(w.messages('b').length,2);
});
