import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {ITEM_CATALOG} from '../items.js';
import {
 WEAPON_KINDS,weaponSwingProfile,visibleWeaponKind,equippedWeaponKind,setWeaponVisuals
} from '../weapon-visuals.js';
const source=path=>readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)),'utf8');

function mockRoot(){
 const objects=Object.fromEntries([...WEAPON_KINDS.map(kind=>'gear-'+kind),'gear-shield'].map(name=>[name,{name,visible:false}]));
 return {objects,getObjectByName:name=>objects[name]};
}
test('weapon categories use a common equipment-to-visual resolver',()=>{
 assert.equal(equippedWeaponKind({weapon:{id:'wornAxe'}},ITEM_CATALOG),'axe');
 assert.equal(equippedWeaponKind({weapon:{id:'feebleSword'}},ITEM_CATALOG),'sword');
 assert.equal(equippedWeaponKind({weapon:{id:'letterOpener'}},ITEM_CATALOG),'dagger');
 assert.equal(equippedWeaponKind({weapon:null},ITEM_CATALOG),'none');
 assert.equal(equippedWeaponKind({weapon:{id:'unknown'}},ITEM_CATALOG),'none');
});
test('equipping/switching/unequipping changes only the intended model',()=>{
 const actor=mockRoot();
 for(const kind of ['axe','sword','dagger','none','sword','axe']){
  setWeaponVisuals(actor,kind,kind==='sword');
  assert.deepEqual(WEAPON_KINDS.filter(k=>actor.objects['gear-'+k].visible),kind==='none'?[]:[kind]);
  assert.equal(actor.objects['gear-shield'].visible,kind==='sword');
  assert.equal(visibleWeaponKind(actor),kind);
 }
});
test('axe and sword have different full-swing silhouettes without changing combat timing',()=>{
 const axe=weaponSwingProfile('axe'),sword=weaponSwingProfile('sword'),dagger=weaponSwingProfile('dagger');
 assert.equal(axe.shoulderWindup,1.85);
 assert.equal(axe.wristSwing,.85);
 assert.equal(axe.shoulderSlash,0);
 assert.notEqual(sword.shoulderWindup,axe.shoulderWindup);
 assert.notEqual(sword.wristSwing,axe.wristSwing);
 assert.ok(sword.shoulderSlash<0);
 assert.ok(dagger.shoulderSwing>sword.shoulderSwing);
 assert.notStrictEqual(sword,axe);
 const game=source('game.js');
 assert.ok(game.includes('const swingProfile=weaponSwingProfile('));
 assert.match(game,/attackElapsed>=\.8/);
 assert.match(game,/attackCooldown=playerStats\(\)\.speed/);
});
test('both GLB weapons preserve approved grips and refresh their loaded visibility',()=>{
 const game=source('game.js');
 assert.match(game,/applyAxeTransform\(\);syncEquipmentVisuals\(\)/);
 assert.match(game,/applySwordTransform\(\);\s*syncEquipmentVisuals\(\)/);
 assert.match(game,/nexgameGlbWeapon=true/);
 const sword=source('sword-tuner.js'),axe=source('axe-tuner.js');
 assert.match(sword,/swordX:-8,swordY:-169,swordZ:-101/);
 assert.match(axe,/axeX:-165,axeY:-1,axeZ:-101/);
});
test('server snapshots advertise validated weapon ID and shield only',()=>{
 const server=source('server/index.js');
 assert.match(server,/weapon:p\.equipment\?\.weapon\?\.id\|\|null/);
 assert.match(server,/shield:!!p\.equipment\?\.shield/);
 assert.match(source('game.js'),/setWeaponVisuals\(remote\.actor\.root,remoteKind/);
});
