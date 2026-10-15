import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {ITEM_CATALOG} from '../items.js';
import {QUALITY_VISUALS,itemRarity,highestLootRarity,applyWeaponQuality,applyShieldQuality} from '../item-quality.js';
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


test('shield quality visually changes the ACTUAL equipped mesh, not just its inventory icon',()=>{
 const rawWood=new THREE.MeshStandardMaterial({color:0xb18d65,roughness:.75});
 const rawMetal=new THREE.MeshStandardMaterial({color:0x92979a,metalness:.72});
 const newActor=()=>{
  const root=new THREE.Group(),shield=new THREE.Group();shield.name='gear-shield';
  const face=new THREE.Mesh(new THREE.CylinderGeometry(.56,.56,.11,12),rawWood);face.name='shield-face';shield.add(face);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(.53,.04,6,16),rawMetal);rim.name='shield-rim';shield.add(rim);
  const boss=new THREE.Mesh(new THREE.SphereGeometry(.16,8,6),rawMetal);boss.name='shield-boss';shield.add(boss);
  root.add(shield);return {root,shield,face,rim,boss};
 };
 const gray=newActor(),green=newActor(),blue=newActor();
 assert.equal(applyShieldQuality(THREE,gray.root,'poor'),true);
 assert.equal(applyShieldQuality(THREE,green.root,'uncommon'),true);
 assert.equal(applyShieldQuality(THREE,blue.root,'rare'),true);
 const colored=(a)=>a.face.material.color.getHex();
 assert.notEqual(colored(gray),colored(green));
 assert.notEqual(colored(green),colored(blue));
 assert.notEqual(gray.rim.material.color.getHex(),green.rim.material.color.getHex());
 assert.notEqual(rawWood.color.getHex(),colored(gray));
 assert.equal(rawWood.color.getHex(),0xb18d65,'original shared material untouched');
 const emblem=green.shield.getObjectByName('shield-quality-insignia');
 assert.equal(gray.shield.getObjectByName('shield-quality-insignia').visible,false);
 assert.equal(emblem.visible,true);
 assert.equal(blue.shield.getObjectByName('shield-quality-insignia').visible,true);
 assert.equal(emblem.children.length,4);
 assert.equal(emblem.children.filter(m=>m.visible!==false).length,4);
 const faceBefore=green.face.geometry;
 assert.equal(applyShieldQuality(THREE,green.root,'uncommon'),false);
 assert.equal(applyShieldQuality(THREE,green.root,'poor'),true);
 assert.equal(emblem.visible,false,'remove enchanted appearance on switch to gray');
 assert.equal(applyShieldQuality(THREE,green.root,'rare'),true);
 assert.equal(emblem.visible,true,'enchant appearance returns when rare shield equipped');
 assert.equal(green.face.geometry,faceBefore,'no geometry swap or model position change');
 assert.equal(emblem.children.length,4,'insignia not duplicated by equipment swap');
});

test('changing shield tier on a cloned character preview does not recolor world hero',()=>{
 const raw=new THREE.MeshStandardMaterial({color:0xc8aa7f});
 const hero=new THREE.Group(),shield=new THREE.Group();shield.name='gear-shield';
 const face=new THREE.Mesh(new THREE.CylinderGeometry(.56,.56,.11,12),raw);face.name='shield-face';
 shield.add(face);hero.add(shield);
 applyShieldQuality(THREE,hero,'uncommon');
 const heroColor=face.material.color.getHex();
 const preview=hero.clone(true);
 applyShieldQuality(THREE,preview,'rare');
 const previewFace=preview.getObjectByName('shield-face');
 assert.notEqual(previewFace.material,face.material);
 assert.notEqual(previewFace.material.color.getHex(),heroColor);
 assert.equal(face.material.color.getHex(),heroColor);
 const inner=preview.getObjectByName('shield-quality-insignia');
 assert.equal(inner.visible,true);
 const heroEmblem=hero.getObjectByName('shield-quality-insignia');
 assert.notEqual(inner.children[0].material,heroEmblem.children[0].material);
 assert.notEqual(inner.children[0].material.color.getHex(),heroEmblem.children[0].material.color.getHex());
 applyShieldQuality(THREE,preview,'poor');
 assert.equal(previewFace.material.color.getHex(),new THREE.Color(0xc8aa7f).lerp(new THREE.Color(0x596166),.68).getHex());
});

test('server exposes shield item id without sharing whole equipment or inventory',()=>{
 const server=read('server/index.js'),game=read('game.js');
 assert.match(server,/shieldId:p\.equipment\?\.shield\?\.id\|\|null/);
 assert.match(server,/shield:!!p\.equipment\?\.shield/);
 assert.match(game,/applyShieldQuality\(THREE,root,shield\.rarity\)/);
 assert.match(game,/applyShieldQuality\(THREE,remote\.actor\.root,rarity\)/);
 assert.match(game,/void attachShieldAsset\(remote\.actor\.root,rarity\)/);
 assert.match(game,/disk\.name='shield-face'/);
 assert.match(game,/rim\.name='shield-rim'/);
 assert.match(game,/boss\.name='shield-boss'/);
});
