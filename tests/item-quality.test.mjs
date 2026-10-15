import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {ITEM_CATALOG} from '../items.js';
import {QUALITY_VISUALS,itemRarity,highestLootRarity,applyWeaponQuality} from '../item-quality.js';
const read=name=>readFileSync(fileURLToPath(new URL('../'+name,import.meta.url)),'utf8');
test('all four real item tiers have a stable color order without changing item stats',()=>{
 assert.deepEqual(Object.keys(QUALITY_VISUALS),['poor','common','uncommon','rare']);
 assert.equal(ITEM_CATALOG.chainVest.rarity,'poor');
 assert.equal(ITEM_CATALOG.wornAxe.rarity,'common');
 assert.equal(ITEM_CATALOG.scalpingStrength.rarity,'uncommon');
 assert.equal(ITEM_CATALOG.giantFeather.rarity,'rare');
 assert.equal(itemRarity('unknown'),'common');
 for(const [name,item] of Object.entries(ITEM_CATALOG))
  assert.ok(QUALITY_VISUALS[itemRarity(item.rarity)],name);
});
test('highest quality in a corpse controls its marker and gracefully downgrades',()=>{
 const loot=[{id:'chainVest',qty:1},{id:'scalpingStrength',qty:1},{id:'giantFeather',qty:1}];
 assert.equal(highestLootRarity(loot,ITEM_CATALOG),'rare');
 loot.pop();assert.equal(highestLootRarity(loot,ITEM_CATALOG),'uncommon');
 loot.pop();assert.equal(highestLootRarity(loot,ITEM_CATALOG),'poor');
 assert.equal(highestLootRarity([]),'common');
});
test('3D weapon quality owns only its material; GLB geometry and other actors stay unchanged',()=>{
 const raw=new THREE.MeshStandardMaterial({color:0x999999,roughness:.54,metalness:.6});
 const make=()=>{
  const root=new THREE.Group(),weapon=new THREE.Group();
  weapon.name='gear-axe';
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),raw);mesh.name='Bronze guard';
  weapon.add(mesh);root.add(weapon);return {root,mesh};
 };
 const a=make(),b=make(),geometry=a.mesh.geometry;
 assert.equal(applyWeaponQuality(THREE,a.root,'axe','uncommon'),true);
 assert.equal(applyWeaponQuality(THREE,b.root,'axe','rare'),true);
 assert.notEqual(a.mesh.material,b.mesh.material);
 assert.notEqual(a.mesh.material,raw);
 assert.equal(a.mesh.geometry,geometry);
 assert.equal(raw.color.getHex(),0x999999);
 assert.notEqual(a.mesh.material.color.getHex(),b.mesh.material.color.getHex());
 assert.ok(a.mesh.material.emissiveIntensity<.3);
 assert.ok(b.mesh.material.emissiveIntensity<.3);
 assert.equal(applyWeaponQuality(THREE,a.root,'axe','uncommon'),false);
 assert.equal(applyWeaponQuality(THREE,a.root,'axe','poor'),true);
 assert.equal(applyWeaponQuality(THREE,a.root,'axe','common'),true);
 assert.equal(a.mesh.material.color.getHex(),raw.color.getHex());
 assert.equal(a.mesh.material.roughness,raw.roughness);
 assert.equal(applyWeaponQuality(THREE,a.root,'dagger','rare'),false);
});
test('Three clone(true) never carries dyed shared weapon material into other player',()=>{
 const raw=new THREE.MeshStandardMaterial({color:0x848e90});
 const root=new THREE.Group(),weapon=new THREE.Group();weapon.name='gear-sword';
 weapon.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),raw));root.add(weapon);
 applyWeaponQuality(THREE,root,'sword','rare');
 const clone=root.clone(true);
 applyWeaponQuality(THREE,clone,'sword','poor');
 const original=root.getObjectByName('gear-sword').children[0];
 const remote=clone.getObjectByName('gear-sword').children[0];
 assert.notEqual(original.material,remote.material);
 assert.notEqual(original.material.color.getHex(),remote.material.color.getHex());
});
test('rarity displays in backpack, equipped slots, merchant, loot and preview',()=>{
 const game=read('game.js'),css=read('style.css');
 assert.match(game,/cell\.dataset\.rarity=itemRarity\(ITEM_CATALOG\[item\.id\]\.rarity\)/);
 assert.match(game,/button\.dataset\.rarity=itemRarity\(def\.rarity\)/);
 assert.match(game,/row\.dataset\.rarity=itemRarity\(def\.rarity\)/);
 assert.match(game,/loot-item-name/);
 assert.match(game,/applyWeaponQuality\(THREE,root,visualKind/);
 assert.match(game,/applyWeaponQuality\(THREE,remote\.actor\.root,remoteKind/);
 assert.match(game,/refreshLootMarkerQuality\(enemy\)/);
 assert.match(game,/animateLootMarkerQuality\(enemy\)/);
 assert.match(css,/\.merchant-item\[data-rarity\]/);
 assert.match(css,/\.equipment-slot\.equipped/);
 assert.match(css,/\.loot-item\[data-rarity="rare"\]::after/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});
