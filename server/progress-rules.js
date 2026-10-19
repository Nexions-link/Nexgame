// NexGameWorld Alpha 0.7.2 — trusted SERVER-ONLY progression rules.
// Do not invoke these with untrusted HTTP/WebSocket payloads.
// Current PvE emits killCredit from server/spherical-pve.js; those credits
// can be persisted only after the session is bound to an owned DB character.
import {ITEM_CATALOG,itemStackLimit,deriveStats} from '../items.js';
import {DEFAULT_HOTBAR,normalizeHotbar,actionDefinition,assignHotbarSlot} from '../hotbar.js';
import {CREATURE_LOOT_TABLES,creatureGearPool} from '../planet-test/loot-tables.js';
import {creatureById,creatureKillReward} from '../planet-test/creature-registry.js';
import {CREATURE_TYPE_BEAST,creatureTypeForMob,CORPSE_COIN_ID} from '../planet-test/creature-types.js';
import {DOLGONOG_BOSS_INDEX,mobLevelForIndex,mobBaseExperience,monsterKillExperience} from '../planet-test/mob-levels.js';

export const PROGRESS_SCHEMA=1;
export const BASE_BAG_SLOTS=12,MAX_BAG_SLOTS=108,MAX_LEVEL=60;
const MAX_INT=2147483647, RADII=new Set([87,174,261]);
const EQUIPMENT_SLOTS=new Set(['weapon','shield','head','chest','legs',
 'hands','waist','wrists','feet']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


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
export function validateKillCredit(event,radius,worldRunId){
 if(typeof worldRunId!=='string'||!UUID.test(worldRunId))invalid('invalid_world_epoch');
 if(!plain(event)||!RADII.has(radius)||
    Object.keys(event).some(key=>!['type','mobId','life','xp','gold','loot'].includes(key))||
    event.type!=='killCredit'||typeof event.mobId!=='string'||
    !integer(event.life,1,MAX_INT))invalid('unverified_kill_event');
 const spec=creatureById(event.mobId);
 if(!spec)invalid('unknown_mob');
 const reward=creatureKillReward(spec),mobLevel=spec.level;
 if(event.xp!==reward.xp||event.gold!==0||
    !Array.isArray(event.loot)||event.loot.length>8)
  invalid('invalid_kill_reward');
 const table=CREATURE_LOOT_TABLES[spec.family];
 const rows=new Map(table.materials.map(row=>[row.id,row]));
 const allowedGear=new Set([...creatureGearPool(spec.family,'poor'),
  ...creatureGearPool(spec.family,'uncommon')]);
 const unique=new Set();
 let equipmentCount=0;
 const loot=event.loot.map(item=>{
  if(!plain(item)||Object.keys(item).some(key=>!['id','qty'].includes(key))||
     typeof item.id!=='string'||!integer(item.qty,1,100000)||
     unique.has(item.id))invalid('invalid_kill_loot');
  unique.add(item.id);
  const row=rows.get(item.id);
  if(item.id===CORPSE_COIN_ID){
   if(spec.type===CREATURE_TYPE_BEAST||
      item.qty<1+2*spec.level||item.qty>4+3*spec.level)invalid('invalid_kill_loot');
  }else if(row){
   if(item.qty<row.min||item.qty>row.max)invalid('invalid_kill_loot');
  }else if(allowedGear.has(item.id)){
   if(item.qty!==1||++equipmentCount>1)invalid('invalid_kill_loot');
  }else invalid('invalid_kill_loot');
  return {id:item.id,qty:item.qty};
 });
 return {eventKey:'mob:'+worldRunId+':'+radius+':'+event.mobId+':'+event.life,
  eventKind:'mob_kill',xp:event.xp,mobLevel,gold:event.gold,loot};
}
export function awardVerifiedKill(state,verified){
 if(!plain(verified)||verified.eventKind!=='mob_kill'||
    !integer(verified.xp,0,100000)||!integer(verified.mobLevel,1,60)||!integer(verified.gold,0,100000)||
    !Array.isArray(verified.loot))invalid('unverified_kill_event');
 const xp=addExperience(state.level,state.experience,
  monsterKillExperience(state.level,verified.mobLevel,verified.xp));
 if(verified.gold!==0)invalid('invalid_kill_reward');
 const inventory=addStacks(state.inventory,verified.loot);
 return {...state,...xp,inventory}; // Coins require an explicit corpse-loot transaction.
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
// Values originate from the server simulation, never a browser checkpoint.
export function validateServerVitals(raw,state){
 if(!plain(raw)||Object.keys(raw).some(k=>!['health','resource'].includes(k))||
    typeof raw.health!=='number'||!Number.isFinite(raw.health)||raw.health<0||
    typeof raw.resource!=='number'||!Number.isFinite(raw.resource)||
    raw.resource<0||raw.resource>100)invalid('invalid_server_vitals');
 const maxHp=deriveStats(state.level,state.equipment).maxHp;
 return {health:Math.round(Math.max(1,Math.min(maxHp,raw.health))),
  resource:Math.round(raw.resource)};
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

// Only a slot and a known, level-appropriate action may be changed by the UI.
export function setActionBarSlot(state,slot,entry){
 if(!integer(slot,0,7))invalid('invalid_action_bar_slot');
 if(entry!==null){
  if(!plain(entry)||Object.keys(entry).some(k=>!['kind','id'].includes(k))||
     !actionDefinition(entry,'warrior',state.level))invalid('invalid_action_bar_entry');
 }
 const base=state.actionBar.length?state.actionBar:DEFAULT_HOTBAR;
 return {...state,actionBar:assignHotbarSlot(normalizeHotbar(base,'warrior',state.level),slot,entry,'warrior',state.level)};
}
