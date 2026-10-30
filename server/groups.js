// NexGameWorld — server-validated 5-player parties with short authenticated reconnect grace.
// All invitations and membership mutations happen on the server.
import {randomUUID} from 'node:crypto';

export const PARTY_MAX_SIZE=5;
export const PARTY_INVITE_TTL_MS=60_000;
export const PARTY_RECONNECT_GRACE_MS=120_000;

export function createPartyManager({players,send,now=Date.now,reconnectGraceMs=PARTY_RECONNECT_GRACE_MS}){
 const groups=new Map(),membership=new Map(),pending=new Map(),suspended=new Map();
 const online=id=>typeof id==='string'&&players.has(id);
 const fail=(id,reason)=>{if(online(id))send(id,{type:'partyNotice',message:reason,error:true});return false};
 const roster=party=>party.members.map(id=>{
  const p=players.get(id),saved=suspended.get(id);
  return {id,name:p?.name||saved?.name||'Странник',level:p?.level||saved?.level||1,
   online:!!p};
 });
 const state=id=>{
  const party=groups.get(membership.get(id));
  return {type:'partyState',groupId:party?.id||null,
   leaderId:party?.leaderId||null,members:party?roster(party):[]};
 };
 const notify=party=>{
  if(party)for(const id of party.members)if(online(id))send(id,state(id));
 };
 const clearPending=id=>{
  for(const [target,invite] of pending)if(target===id||invite.from===id)pending.delete(target);
 };
 function invite(from,target){
  if(!online(from)||!online(target)||from===target)return fail(from,'Игрок недоступен');
  const source=groups.get(membership.get(from));
  if(source&&source.leaderId!==from)return fail(from,'Приглашать может только лидер группы');
  if(membership.has(target))return fail(from,'Игрок уже находится в группе');
  if(source&&source.members.length>=PARTY_MAX_SIZE)return fail(from,'В группе уже пять участников');
  const existing=pending.get(target);
  if(existing&&existing.expires>now())return fail(from,'У игрока уже есть приглашение');
  pending.set(target,{from,expires:now()+PARTY_INVITE_TTL_MS});
  send(target,{type:'partyInvite',fromId:from,fromName:players.get(from).name,
   expiresIn:Math.floor(PARTY_INVITE_TTL_MS/1000)});
  send(from,{type:'partyNotice',message:'Приглашение отправлено: '+players.get(target).name});
  return true;
 }
 function respond(target,from,accept){
  if(!online(target))return false;
  const entry=pending.get(target);
  if(!entry||entry.from!==from)return fail(target,'Приглашение уже недействительно');
  pending.delete(target);
  if(entry.expires<=now()||!online(from))return fail(target,'Срок приглашения истёк');
  if(!accept){
   send(from,{type:'partyNotice',message:players.get(target).name+' отклонил приглашение'});
   return true;
  }
  if(membership.has(target))return fail(target,'Ты уже состоишь в группе');
  let party=groups.get(membership.get(from));
  if(party&&party.leaderId!==from)return fail(target,'Лидер группы сменился');
  if(party&&party.members.length>=PARTY_MAX_SIZE)return fail(target,'Группа уже заполнена');
  if(!party){
   party={id:randomUUID(),leaderId:from,members:[from]};
   groups.set(party.id,party);membership.set(from,party.id);
  }
  party.members.push(target);membership.set(target,party.id);
  clearPending(target);
  notify(party);
  send(from,{type:'partyNotice',message:players.get(target).name+' присоединился к группе'});
  send(target,{type:'partyNotice',message:'Ты вступил в группу'});
  return true;
 }
 // Leaders may transfer control to an EXISTING connected member. Never
 // accept a caller-provided group ID or let outsiders seize a party.
 function promote(from,target){
  if(!online(from)||!online(target))return fail(from,'Игрок недоступен');
  const party=groups.get(membership.get(from));
  if(!party||party.leaderId!==from)return fail(from,'Назначить лидера может только лидер группы');
  if(from===target)return fail(from,'Вы уже лидер группы');
  if(membership.get(target)!==party.id||!party.members.includes(target))
   return fail(from,'Игрок не состоит в вашей группе');
  // Invitations issued by the old leader must not silently stay valid;
  // invalidating them immediately lets the new leader invite another player.
  for(const [recipient,invitation] of pending){
   if(invitation.from!==from)continue;
   pending.delete(recipient);
   if(online(recipient))send(recipient,{type:'partyNotice',error:true,
    message:'Приглашение отменено: лидер группы сменился'});
  }
  party.leaderId=target;
  const title=players.get(target)?.name||'Странник';
  for(const id of party.members)if(online(id))send(id,{type:'partyNotice',
   message:'Новый лидер группы: '+title});
  notify(party);
  return true;
 }
 function leave(id,{disconnected=false}={}){
  clearPending(id);
  suspended.delete(id);
  const party=groups.get(membership.get(id));
  membership.delete(id);
  if(!party)return false;
  party.members=party.members.filter(member=>member!==id);
  if(online(id)&&!disconnected)send(id,state(id));
  const departed=players.get(id)?.name||'Странник';
  for(const member of party.members)if(online(member))send(member,{type:'partyNotice',
   message:departed+(disconnected?' отключился и покинул группу':' покинул группу')});
  if(party.members.length<=1){
   groups.delete(party.id);
   for(const member of party.members){
    membership.delete(member);
    suspended.delete(member);
    if(online(member))send(member,state(member));
   }
  }else{
   if(party.leaderId===id){
    party.leaderId=party.members[0];
    for(const member of party.members)if(online(member))send(member,{type:'partyNotice',
     message:'Новый лидер группы: '+(players.get(party.leaderId)?.name||'Странник')});
   }
   notify(party);
  }
  return true;
 }
 // Retain a verified character's place during brief mobile network interruptions.
 // The reservation is never keyed by a user-controlled nickname or socket ID.
 function suspend(id,characterId,{name='Странник',level=1}={}){
  if(typeof characterId!=='string'||!characterId)return leave(id,{disconnected:true});
  clearPending(id);
  const party=groups.get(membership.get(id));
  if(!party)return false;
  suspended.set(id,{characterId,name,level,expires:now()+reconnectGraceMs});
  for(const member of party.members)if(member!==id&&online(member))
   send(member,{type:'partyNotice',message:name+' временно отключился'});
  if(party.leaderId===id){
   const next=party.members.find(member=>member!==id&&online(member));
   if(next){
    party.leaderId=next;
    for(const member of party.members)if(online(member))
     send(member,{type:'partyNotice',
      message:'Новый лидер группы: '+(players.get(next)?.name||'Странник')});
   }
  }
  notify(party);
  return true;
 }
 // The caller must supply a characterId from an already validated login.
 function resume(id,characterId){
  expire();
  if(!online(id)||membership.has(id)||typeof characterId!=='string'||!characterId)
   return false;
  for(const [oldId,held] of suspended){
   if(held.characterId!==characterId)continue;
   const party=groups.get(membership.get(oldId));
   if(!party||!party.members.includes(oldId))return false;
   // A verified character can reclaim only their own existing reservation.
   suspended.delete(oldId);
   membership.delete(oldId);
   party.members=party.members.map(member=>member===oldId?id:member);
   membership.set(id,party.id);
   if(party.leaderId===oldId||!online(party.leaderId))party.leaderId=id;
   notify(party);
   for(const member of party.members)if(member!==id&&online(member))
    send(member,{type:'partyNotice',message:(players.get(id)?.name||held.name)+' вернулся в группу'});
   return true;
  }
  return false;
 }
 function expire(){
  const current=now();
  for(const [id,held] of suspended)if(held.expires<=current)
   leave(id,{disconnected:true});
 }
 function getMemberIds(id){
  const party=groups.get(membership.get(id));
  return party?[...party.members]:null;
 }
 function renamed(id){
  const party=groups.get(membership.get(id));
  notify(party);
 }
 return {invite,respond,promote,leave,suspend,resume,expire,
  disconnect:id=>leave(id,{disconnected:true}),
  renamed,state,getPartyId:id=>membership.get(id)||null,getMemberIds,
  info:()=>({groups:groups.size,pending:pending.size,suspended:suspended.size})};
}
