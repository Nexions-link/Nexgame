import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {ITEM_CATALOG} from '../items.js';
import {ATLAS_ENTRIES} from '../bestiary/atlas-catalog.js';
import {SHIELD_MODELS,shieldModelForRarity,styleShieldGlb} from '../shield-assets.js';
const read=path=>readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)),'utf8');

test('both complete GLBs are valid and retain the intended geometry and colored materials',()=>{
 for(const [key,spec] of Object.entries(SHIELD_MODELS)){
  const file=readFileSync(fileURLToPath(new URL('../'+spec.path.slice(2),import.meta.url)));
  assert.equal(file.toString('ascii',0,4),'glTF');
  assert.equal(file.readUInt32LE(4),2);
  assert.equal(file.readUInt32LE(8),file.length);
  assert.equal(file.toString('ascii',16,20),'JSON');
  const json=JSON.parse(file.toString('utf8',20,20+file.readUInt32LE(12)));
  assert.ok(json.meshes.length>=8);
  assert.ok(json.materials.length>=7);
  assert.ok(json.accessors.every(a=>a.count>0&&a.min.every(Number.isFinite)));
  if(key==='round'){
   assert.ok(json.nodes.some(n=>n.name==='steel'));
   assert.ok(json.nodes.some(n=>n.name==='red'));
  }else{
   assert.ok(json.nodes.some(n=>n.name==='emerald'));
   assert.ok(json.nodes.some(n=>n.name==='glow'));
  }
 }
});
test('gray/common use round; green/blue use kite, independently of shield item id',()=>{
 assert.equal(shieldModelForRarity('poor'),'round');
 assert.equal(shieldModelForRarity('common'),'round');
 assert.equal(shieldModelForRarity('uncommon'),'kite');
 assert.equal(shieldModelForRarity('rare'),'kite');
 const gray=ITEM_CATALOG.bentShield;
 const green=ITEM_CATALOG.infantryBear;
 assert.equal(gray?.slot,'shield');
 assert.equal(green?.slot,'shield');
 assert.equal(shieldModelForRarity(gray.rarity),'round');
 assert.equal(shieldModelForRarity(green.rarity),'kite');
});
test('green and blue GLB inlays get distinct materials without touching actor sharing',()=>{
 const input=new THREE.MeshStandardMaterial({name:'emerald',color:0xffffff});
 const make=()=>{const group=new THREE.Group();const mesh=new THREE.Mesh(new THREE.BoxGeometry(),input);mesh.name='emerald';group.add(mesh);return {group,mesh}};
 const green=make(),blue=make();
 assert.equal(styleShieldGlb(THREE,green.group,'uncommon'),true);
 assert.equal(styleShieldGlb(THREE,blue.group,'rare'),true);
 assert.notEqual(green.mesh.material,input);
 assert.notEqual(blue.mesh.material,input);
 assert.notEqual(green.mesh.material,blue.mesh.material);
 assert.notEqual(green.mesh.material.color.getHex(),blue.mesh.material.color.getHex());
 assert.equal(input.color.getHex(),0xffffff);
 assert.equal(styleShieldGlb(THREE,green.group,'rare'),true);
 assert.equal(green.mesh.material.color.getHex(),blue.mesh.material.color.getHex());
 assert.equal(styleShieldGlb(THREE,green.group,'uncommon'),true);
 const clone=green.group.clone(true);
 styleShieldGlb(THREE,clone,'rare');
 assert.notEqual(clone.children[0].material,green.mesh.material);
});
test('model remains in left hand; no changes to previously tuned weapons or shields combat stats',()=>{
 const game=read('game.js'), quality=read('item-quality.js');
 assert.match(game,/const shield=group\(arms\[0\]\.hand,-\.12,-\.02,-\.34\)/);
 assert.match(game,/async function attachShieldAsset\(root,rarity\)/);
 assert.match(game,/void attachShieldAsset\(root,rarity\)/);
 assert.match(game,/void attachShieldAsset\(remote\.actor\.root,rarity\)/);
 assert.match(game,/previous=mount\.getObjectByName\('shield-glb-model'\)/);
 assert.match(game,/for\(const child of mount\.children\)if\(child!==model\)child\.visible=false/);
 assert.match(game,/styleShieldGlb\(THREE,glb,rarity\)/);
 assert.match(quality,/export function applyShieldQuality/);
 assert.match(read('axe-tuner.js'),/axeX:-165,axeY:-1,axeZ:-101/);
 assert.match(read('sword-tuner.js'),/swordX:-8,swordY:-169,swordZ:-101/);
 assert.match(read('dagger-tuner.js'),/daggerX:-3,daggerY:-180,daggerZ:-60/);
});
test('Atlas has two distinct 3D shields and versioned viewer links',()=>{
 const a=ATLAS_ENTRIES.find(e=>e.id==='shield-round');
 const b=ATLAS_ENTRIES.find(e=>e.id==='shield-kite');
 assert.equal(a.number,'S001');
 assert.equal(b.number,'S002');
 assert.equal(a.category,'armor');
 assert.equal(b.category,'armor');
 assert.match(a.asset,/round_shield/);
 assert.match(b.asset,/kite_shield/);
 assert.match(read('bestiary/atlas.js'),/atlas-catalog\.js\?v=0\.2\.4/);
 assert.match(read('bestiary/atlas.html'),/atlas\.js\?v=0\.2\.4/);
});
