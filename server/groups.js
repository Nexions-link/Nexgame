// NexGame Alpha 0.3.5.25 — ephemeral 5-player party management.
// All invitations and membership mutations happen on the server.
import {randomUUID} from 'node:crypto';

export const PARTY_MAX_SIZE=5;
export const PARTY_INVITE_TTL_MS=60_000;

export function createPartyManager({players,send,now=Date.now}){
 const groups=new Map(),membership=new Map(),pending=new Map();
 const online=id=>typeof id==='string'&&players.has(id);
 const fail=(id,reason)=>{if(online(id))send(id,{type:'partyNotice',message:reason,error:true});return false};
 const roster=party=>party.members.map(id=>{
  const p=players.get(id);
  return {id,name:p?.name||'Странник',level:p?.level||1};
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
 function leave(id,{disconnected=false}={}){
  clearPending(id);
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
 function getMemberIds(id){
  const party=groups.get(membership.get(id));
  return party?[...party.members]:null;
 }
 function renamed(id){
  const party=groups.get(membership.get(id));
  notify(party);
 }
 return {invite,respond,leave,disconnect:id=>leave(id,{disconnected:true}),
  renamed,state,getPartyId:id=>membership.get(id)||null,getMemberIds,
  info:()=>({groups:groups.size,pending:pending.size})};
}
