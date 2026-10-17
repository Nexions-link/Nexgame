// NexGameWorld Alpha 0.7.2 — trusted SERVER-ONLY progression rules.
// Do not invoke these with untrusted HTTP/WebSocket payloads.
// Current PvE emits killCredit from server/spherical-pve.js; those credits
// can be persisted only after the session is bound to an owned DB character.
import {ITEM_CATALOG,itemStackLimit,GEAR_LOOT,deriveStats} from '../items.js';
import {CREATURE_LOOT_TABLES} from '../planet-test/loot-tables.js';
import {SPHERE_MOB_SPAWNS} from './spherical-pve.js';

export const PROGRESS_SCHEMA=1;
export const BASE_BAG_SLOTS=12,MAX_BAG_SLOTS=108,MAX_LEVEL=60;
const MAX_INT=2147483647, RADII=new Set([87,174,261]);
const EQUIPMENT_SLOTS=new Set(['weapon','shield','head','chest','legs',
 'hands','waist','wrists','feet']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GEAR_DROP_IDS=new Set([
 ...GEAR_LOOT.poor,...GEAR_LOOT.uncommon,'scalpingStamina'
]);

export class ProgressError extends Error {
 constructor(code,status=400){
  super(code);this.name='ProgressError';this.code=code;this.status=status;
 }
}
const invalid=(message='invalid_progress')=>{throw new ProgressError(message);};
const plain=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.getPrototypeOf(x)===Object.prototype;
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const jsonValue=x=>JSON.parse(JSON.stringify(x));
export function assertCharacterId(id){
 if(typeof id!=='string'||!UUID.test(id))invalid('invalid_character_id');
 return id;
}
export function parseRevision(raw){
 const value=typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):raw;
 if(!integer(value,0,Number.MAX_SAFE_INTEGER))invalid('invalid_revision');
 return value;
}
export function requiredExperience(level){
 if(!integer(level,1,MAX_LEVEL))invalid('invalid_level');
 return 100+(level-1)*50;
}
export function addExperience(level,experience,gain){
 if(!integer(level,1,MAX_LEVEL)||!integer(experience,0,MAX_INT)||
    !integer(gain,0,100000))invalid('invalid_experience');
 let remaining=experience+gain,nextLevel=level;
 while(nextLevel<MAX_LEVEL && remaining>=requiredExperience(nextLevel)){
  remaining-=requiredExperience(nextLevel);
  nextLevel++;
 }
 if(nextLevel===MAX_LEVEL)remaining=0;
 if(!integer(remaining,0,MAX_INT))invalid('experience_overflow');
 return {level:nextLevel,experience:remaining};
}
export function validateInventory(input){
 if(!Array.isArray(input)||input.length>MAX_BAG_SLOTS||
   (input.length>0&&input.length<BASE_BAG_SLOTS))
  invalid('invalid_inventory_size');
 const target=input.length===0?Array(BASE_BAG_SLOTS).fill(null):input;
 return target.map(row=>{
  if(row==null)return null;
  if(!plain(row)||typeof row.id!=='string'||!integer(row.qty,1,20))
   invalid('invalid_inventory_stack');
  const def=ITEM_CATALOG[row.id];
  if(!def&&row.id!=='healingPotion')invalid('unknown_inventory_item');
  if(row.qty>(def?itemStackLimit(row.id):20))invalid('invalid_inventory_stack');
  return {id:row.id,qty:row.qty};
 });
}
export function validateEquipment(raw,level){
 if(!plain(raw))invalid('invalid_equipment');
 const result={};
 for(const [slot,item] of Object.entries(raw)){
  if(!EQUIPMENT_SLOTS.has(slot)||!plain(item)||
      typeof item.id!=='string'||Object.keys(item).length!==1)
   invalid('invalid_equipment');
  const def=ITEM_CATALOG[item.id];
  if(!def||def.slot!==slot||(def.requiredLevel||1)>level)
   invalid('unavailable_equipment');
  result[slot]={id:item.id};
 }
 return result;
}
export function readProgress(row){
 if(!plain(row))invalid('missing_progress');
 const version=row.schemaVersion??row.schema_version;
 if(version!==PROGRESS_SCHEMA)invalid('unsupported_progress_schema');
 const level=row.level,experience=row.experience,gold=row.gold;
 const health=row.health,resource=row.resource;
 const radius=row.worldRadius??row.world_radius;
 const normal=row.positionNormal??row.position_normal;
 const heading=row.heading,revision=parseRevision(row.revision);
 if(!integer(level,1,MAX_LEVEL)||!integer(experience,0,MAX_INT)||
    !integer(gold,0,MAX_INT)||!integer(health,0,MAX_INT)||
    !integer(resource,0,100)||!RADII.has(radius)||
    !Array.isArray(normal)||normal.length!==3||
    !normal.every(n=>typeof n==='number'&&Number.isFinite(n))||
    !(Math.abs(Math.hypot(...normal)-1)<.01)||
    typeof heading!=='number'||!Number.isFinite(heading))
  invalid('corrupt_character_progress');
 const inventory=validateInventory(row.inventory);
 const equipment=validateEquipment(row.equipment,level);
 const quests=row.quests,actionBar=row.actionBar??row.action_bar;
 if(!plain(quests)||!Array.isArray(actionBar)||actionBar.length>8)
  invalid('corrupt_character_progress');
 return {
  revision,level,experience,gold,health,resource,worldRadius:radius,
  positionNormal:[...normal],heading,inventory,equipment,
  quests:jsonValue(quests),actionBar:jsonValue(actionBar)
 };
}
function addStacks(bag,drops){
 const next=bag.map(row=>row?{...row}:null);
 for(const {id,qty} of drops){
  const limit=ITEM_CATALOG[id]?itemStackLimit(id):20;
  let remaining=qty;
  for(let slot=0;slot<next.length&&remaining;slot++){
   const row=next[slot];
   if(!row||row.id!==id||row.qty>=limit)continue;
   const amount=Math.min(remaining,limit-row.qty);
   row.qty+=amount;remaining-=amount;
  }
  for(let slot=0;slot<next.length&&remaining;slot++){
   if(next[slot]!==null)continue;
   const amount=Math.min(remaining,limit);
   next[slot]={id,qty:amount};remaining-=amount;
  }
  if(remaining)throw new ProgressError('inventory_full',409);
 }
 return next;
}
export function validateKillCredit(event,radius){
 if(!plain(event)||!RADII.has(radius)||
    Object.keys(event).some(key=>!['type','mobId','life','xp','gold','loot'].includes(key))||
    event.type!=='killCredit'||!/^dolgonog-(0|[1-8])$/.test(event.mobId)||
    !integer(event.life,1,MAX_INT))invalid('unverified_kill_event');
 const index=Number(event.mobId.split('-')[1]);
 if(index>=SPHERE_MOB_SPAWNS.length)invalid('unknown_mob');
 const boss=index===SPHERE_MOB_SPAWNS.length-1;
 const mobType=boss?'stormbeak':'dolgonog';
 if(event.xp!==(boss?70:22)||event.gold!==(boss?12:4)||
    !Array.isArray(event.loot)||event.loot.length>8)
  invalid('invalid_kill_reward');
 const table=CREATURE_LOOT_TABLES[mobType];
 const rows=new Map(table.materials.map(row=>[row.id,row]));
 const unique=new Set();
 let equipmentCount=0;
 const loot=event.loot.map(item=>{
  if(!plain(item)||Object.keys(item).some(key=>!['id','qty'].includes(key))||
     typeof item.id!=='string'||!integer(item.qty,1,20)||
     unique.has(item.id))invalid('invalid_kill_loot');
  unique.add(item.id);
  const row=rows.get(item.id);
  if(row){
   if(item.qty<row.min||item.qty>row.max)invalid('invalid_kill_loot');
  }else if(GEAR_DROP_IDS.has(item.id)){
   if(item.qty!==1||++equipmentCount>1)invalid('invalid_kill_loot');
  }else invalid('invalid_kill_loot');
  return {id:item.id,qty:item.qty};
 });
 return {eventKey:'mob:'+radius+':'+event.mobId+':'+event.life,
  eventKind:'mob_kill',xp:event.xp,gold:event.gold,loot};
}
export function awardVerifiedKill(state,verified){
 if(!plain(verified)||verified.eventKind!=='mob_kill'||
    !integer(verified.xp,0,100000)||!integer(verified.gold,0,100000)||
    !Array.isArray(verified.loot))invalid('unverified_kill_event');
 const xp=addExperience(state.level,state.experience,verified.xp);
 if(state.gold>MAX_INT-verified.gold)invalid('gold_overflow');
 const inventory=addStacks(state.inventory,verified.loot);
 return {...state,...xp,gold:state.gold+verified.gold,inventory};
}
export function validateServerCheckpoint(raw,previousRadius){
 if(!plain(raw)||Object.keys(raw).some(k=>!['normal','heading','radius'].includes(k))||
    raw.radius!==previousRadius||!RADII.has(raw.radius)||
    !Array.isArray(raw.normal)||raw.normal.length!==3||
    !raw.normal.every(v=>typeof v==='number'&&Number.isFinite(v)))
  invalid('invalid_checkpoint');
 const len=Math.hypot(...raw.normal);
 if(len<.99||len>1.01||typeof raw.heading!=='number'||
   !Number.isFinite(raw.heading)||Math.abs(raw.heading)>4*Math.PI)
  invalid('invalid_checkpoint');
 return {worldRadius:raw.radius,positionNormal:raw.normal.map(n=>n/len),
  heading:raw.heading};
}
export function equipOwnedItem(state,bagSlot,slot){
 if(!integer(bagSlot,0,state.inventory.length-1)||
    !EQUIPMENT_SLOTS.has(slot))invalid('invalid_equipment_slot');
 const item=state.inventory[bagSlot];
 if(!item||item.qty!==1)throw new ProgressError('item_not_owned',409);
 const def=ITEM_CATALOG[item.id];
 if(!def||def.slot!==slot||(def.requiredLevel||1)>state.level)
  throw new ProgressError('equipment_requirements_not_met',409);
 const inventory=state.inventory.map(row=>row?{...row}:null);
 const equipment={...state.equipment};
 const previous=equipment[slot]||null;
 inventory[bagSlot]=previous?{id:previous.id,qty:1}:null;
 equipment[slot]={id:item.id};
 const maxHP=deriveStats(state.level,equipment).maxHp;
 return {...state,inventory,equipment,health:Math.min(state.health,maxHP)};
}
export function unequipOwnedItem(state,slot,bagSlot){
 if(!EQUIPMENT_SLOTS.has(slot)||!integer(bagSlot,0,state.inventory.length-1))
  invalid('invalid_equipment_slot');
 const equipped=state.equipment[slot];
 if(!equipped)throw new ProgressError('equipment_slot_empty',409);
 if(state.inventory[bagSlot]!==null)
  throw new ProgressError('inventory_slot_occupied',409);
 const inventory=state.inventory.map(row=>row?{...row}:null);
 inventory[bagSlot]={id:equipped.id,qty:1};
 const equipment={...state.equipment};
 delete equipment[slot];
 const maxHP=deriveStats(state.level,equipment).maxHp;
 return {...state,inventory,equipment,health:Math.min(state.health,maxHP)};
}
