// Isolated account-to-world handshake (Alpha 0.7.3).
// No write operation and never trusts a browser-provided account ID, name,
// character stats, inventory or progress. This is NOT an open HTTP route.
import {tokenDigest} from './auth-crypto.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class WorldAuthError extends Error{
 constructor(code,status=401){super(code);this.code=code;this.status=status}
}
// A previous WebSocket may still be flushing its final saved checkpoint.
// This is transient, not an invalid password/session: mobile Safari must retry.
export function worldJoinCloseInfo(error){
 if(error?.code==='character_already_online')
  return {code:1013,reason:'Previous character session is still saving'};
 if(error instanceof WorldAuthError)
  return {code:1008,reason:'Account or character authorization failed'};
 return {code:1011,reason:'Character data temporarily unavailable'};
}
export function createWorldSessionGate({accountStore,progressStore}){
 if(!accountStore)throw Error('Account store required');
 const leases=new Map();
 const bySocket=new WeakMap();
 async function resolve({sessionToken,characterId}){
  const digest=tokenDigest(sessionToken);
  if(!digest)throw new WorldAuthError('invalid_session');
  if(typeof characterId!=='string'||!UUID.test(characterId))
   throw new WorldAuthError('invalid_character',400);
  const account=await accountStore.accountForSession(digest);
  if(!account)throw new WorldAuthError('session_expired');
  const character=await accountStore.loadCharacter(account.id,characterId);
  if(!character)throw new WorldAuthError('character_not_owned',403);
  const progress=progressStore?(typeof progressStore.initializeStarterPack==='function'?
   await progressStore.initializeStarterPack(account.id,characterId):
   await progressStore.load(account.id,characterId)):{
   revision:Number(character.revision),level:character.level,
   experience:character.experience,gold:character.gold,
   health:character.health,resource:character.resource,
   worldRadius:character.worldRadius,positionNormal:character.positionNormal,
   heading:character.heading,inventory:character.inventory,
   equipment:character.equipment,quests:character.quests,actionBar:character.actionBar
  };
  return {accountId:account.id,characterId:character.id,
   nickname:character.nickname,progress};
 }
 async function enter(socket,args){
  if(bySocket.has(socket))throw new WorldAuthError('socket_already_joined',409);
  // Lease before async store lookup is intentionally not held; after this
  // read, only one local WebSocket can own the character at a time.
  const session=await resolve(args);
  if(bySocket.has(socket))throw new WorldAuthError('socket_already_joined',409);
  if(leases.has(session.characterId))
   throw new WorldAuthError('character_already_online',409);
  leases.set(session.characterId,socket);
  bySocket.set(socket,{characterId:session.characterId,accountId:session.accountId,
   digest:tokenDigest(args.sessionToken)});
  return session;
 }
 async function validate(socket){
  const lease=bySocket.get(socket);
  if(!lease||leases.get(lease.characterId)!==socket)return false;
  const account=await accountStore.accountForSession(lease.digest);
  return account?.id===lease.accountId;
 }
 function leave(socket){
  const lease=bySocket.get(socket);
  if(lease&&leases.get(lease.characterId)===socket)
   leases.delete(lease.characterId);
  bySocket.delete(socket);
 }
 return {resolve,enter,validate,leave,online:()=>leases.size};
}
