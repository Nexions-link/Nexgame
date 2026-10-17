// Isolated account-to-world handshake (Alpha 0.7.3).
// No write operation and never trusts a browser-provided account ID, name,
// character stats, inventory or progress. This is NOT an open HTTP route.
import {tokenDigest} from './auth-crypto.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export class WorldAuthError extends Error{
 constructor(code,status=401){super(code);this.code=code;this.status=status}
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
  const progress=progressStore?await progressStore.initializeStarterPack(account.id,characterId):{
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
  bySocket.set(socket,session.characterId);
  return session;
 }
 function leave(socket){
  const characterId=bySocket.get(socket);
  if(characterId&&leases.get(characterId)===socket)
   leases.delete(characterId);
  bySocket.delete(socket);
 }
 return {resolve,enter,leave,online:()=>leases.size};
}
