// NexGame Alpha 0.3.5.27 — server-routed text chat.
// World messages go to all connected players; party messages only to verified members.
// Nothing in this module stores chat persistently or trusts the client's sender identity.
export const CHAT_LIMIT=180;
export const CHAT_COOLDOWN_MS=900;
export const CHAT_BURST_WINDOW_MS=10_000;
export const CHAT_BURST_LIMIT=6;

export function normalizeChatMessage(value){
 if(typeof value!=='string')return null;
 const text=value.trim().replace(/[\u0000-\u001f\u007f-\u009f]/g,' ')
  .replace(/\s+/g,' ');
 return text&&Array.from(text).length<=CHAT_LIMIT?text:null;
}
export function createChatManager({players,parties,send,broadcast,now=Date.now}){
 const limits=new Map();
 const reject=(id,reason)=>{send(id,{type:'chatRejected',reason});return false};
 function handle(id,data){
  const author=players.get(id);
  if(!author)return false;
  const channel=data?.channel;
  if(channel!=='world'&&channel!=='party')return reject(id,'Выбери канал чата');
  const text=normalizeChatMessage(data?.text);
  if(!text)return reject(id,'Сообщение должно содержать от 1 до 180 символов');
  const members=channel==='party'?parties.getMemberIds(id):null;
  if(channel==='party'&&(!members||members.length<2))return reject(id,'Сначала вступи в группу');
  const time=now();
  const limit=limits.get(id)||{last:-Infinity,times:[]};
  const recent=limit.times.filter(t=>t>time-CHAT_BURST_WINDOW_MS);
  if(time-limit.last<CHAT_COOLDOWN_MS||recent.length>=CHAT_BURST_LIMIT)
   return reject(id,'Слишком часто. Подожди немного перед отправкой');
  limit.last=time;limit.times=[...recent,time];limits.set(id,limit);
  const message={type:'chat',channel,fromId:id,name:author.name||'Странник',
   text,at:time};
  if(channel==='world')broadcast(message);
  else{
   message.groupId=parties.getPartyId(id);
   for(const member of members)send(member,message);
  }
  return true;
 }
 return {handle,disconnect(id){limits.delete(id)}};
}
