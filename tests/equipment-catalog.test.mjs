import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
 ITEM_CATALOG,MERCHANT_STOCK,GEAR_LOOT,LOOT_CHANCES,
 rollEquipmentLoot,itemStackLimit,deriveStats,armorReduction
} from '../items.js';

test('equipment catalog references valid slots and safe item prices',()=>{
 const slots=new Set(['head','shoulders','chest','wrists','hands','waist','legs','feet','weapon','shield']);
 for(const [id,def] of Object.entries(ITEM_CATALOG)){
  if(!def.slot)continue;
  assert.ok(slots.has(def.slot),id);
  assert.ok(Number.isInteger(def.sourceId)&&def.sourceId>0,id);
  assert.equal(itemStackLimit(id),1,id);
  assert.ok(Number.isFinite(def.sell)&&def.sell>0,id);
  if(def.buy)assert.ok(def.buy>def.sell,id);
  if(def.rarity==='poor'){
   assert.ok(!def.strength&&!def.stamina,id);
  }
 }
 for(const id of MERCHANT_STOCK){
  assert.ok(ITEM_CATALOG[id]?.buy>0,id);
 }
 for(const [quality,pool] of Object.entries(GEAR_LOOT)){
  assert.ok(pool.length>0,quality);
  for(const id of pool)assert.equal(ITEM_CATALOG[id]?.rarity,quality,id);
 }
 assert.equal(ITEM_CATALOG.chainBelt.slot,'waist');
});

test('stamina, strength, shields, weapon damage and armor retain their bonuses',()=>{
 const bare=deriveStats(1,{});
 assert.equal(bare.maxHp,120);
 assert.equal(bare.strength,28);
 assert.equal(bare.attackPower,39);
 assert.equal(bare.blockChance,0);
 const base=deriveStats(6,{weapon:{id:'wornAxe'}});
 const upgraded=deriveStats(6,{
  chest:{id:'warriorTunic'},legs:{id:'warriorPants'},
  weapon:{id:'scalpingStrength'},shield:{id:'infantryBear'}
 });
 assert.equal(upgraded.maxHp,base.maxHp+20);
 assert.equal(upgraded.strength,base.strength+4);
 assert.equal(upgraded.speed,1.8);
 assert.equal(upgraded.blockChance,.05);
 assert.ok(upgraded.dps>base.dps);
 assert.ok(upgraded.armor>base.armor);
 assert.equal(armorReduction(0,1),0);
 assert.equal(armorReduction(999999,1),.75);
});

test('loot probabilities and boss chances do not change unexpectedly',()=>{
 for(const boss of [false,true]){
  const probabilities=LOOT_CHANCES[boss?'boss':'normal'];
  const counts={poor:0,uncommon:0,none:0};
  for(let i=0;i<10000;i++){
   let n=0;
   const item=rollEquipmentLoot(boss,()=>n++===0?(i+.5)/10000:.49);
   counts[item?ITEM_CATALOG[item.id].rarity:'none']++;
  }
  assert.equal(counts.uncommon,probabilities.uncommon*10000);
  assert.equal(counts.poor,probabilities.poor*10000);
 }
 assert.equal(itemStackLimit('feather'),20);
});

test('active gameplay connects the catalog to equipment, loot and visuals',()=>{
 const game=readFileSync(fileURLToPath(new URL('../game.js',import.meta.url)),'utf8');
 for(const name of ['equipInventorySlot','unequipSlot','rollCorpseLoot','syncEquipmentVisuals']){
  assert.ok(game.includes('function '+name+'('),name);
 }
 assert.ok(game.includes('const shield=group(arms[0].hand'));
 assert.ok(game.includes('const grip=hero.arms[1].hand'));
});

test('GLB axe blade faces forward while its lower tip points down at idle',async()=>{
 const {Euler,Vector3}=await import('three');
 const source=readFileSync(fileURLToPath(new URL('../game.js',import.meta.url)),'utf8');
 assert.ok(source.includes("axe.rotation.set(Math.PI/2,0,-Math.PI/2,'YXZ')"));
 assert.ok(source.includes('axe.rotation.copy(old.rotation);axe.scale.copy(old.scale);'));
 // The GLB has its cutting edge on local +X and lower point on -Y.
 // The right hand is pitched -90deg around X at rest.
 const hand=new Euler(-Math.PI/2,0,0,'XYZ');
 const axe=new Euler(Math.PI/2,0,-Math.PI/2,'YXZ');
 const transform=vector=>vector.clone().applyEuler(axe).applyEuler(hand);
 const blade=transform(new Vector3(1,0,0));
 const lowerTip=transform(new Vector3(0,-1,0));
 assert.ok(blade.z>0.999,'blade must face +Z, the character front');
 assert.ok(lowerTip.y<-.999,'blade lower tip must point down');
});
