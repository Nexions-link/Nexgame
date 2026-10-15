import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {DAGGER_TUNER_STORAGE_KEY,DAGGER_TUNER_DEFAULTS,DAGGER_TUNER_GROUPS,normalizeDaggerTuning,serializeDaggerTuning} from '../dagger-tuner.js';
import {ATLAS_ENTRIES} from '../bestiary/atlas-catalog.js';
import {ITEM_CATALOG} from '../items.js';
import {equippedWeaponKind} from '../weapon-visuals.js';
const read=path=>readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)),'utf8');
test('the original Steppe Dagger GLB is complete with blade, hilt, fittings and facets',()=>{
 const bin=readFileSync(fileURLToPath(new URL('../assets/weapons/steppe-dagger-v0.1.glb',import.meta.url)));
 assert.equal(bin.toString('ascii',0,4),'glTF');
 assert.equal(bin.readUInt32LE(4),2);
 assert.equal(bin.readUInt32LE(8),bin.length);
 assert.equal(bin.toString('ascii',16,20),'JSON');
 const length=bin.readUInt32LE(12);
 const parsed=JSON.parse(bin.toString('utf8',20,20+length));
 assert.ok(parsed.meshes.length>=20);
 assert.ok(parsed.materials.length>=7);
 for(const term of ['blade','guard','handle','pommel'])
  assert.ok(parsed.nodes.some(n=>n.name.toLowerCase().includes(term)),term);
 assert.ok(parsed.accessors.every(a=>a.count>0&&a.min.every(Number.isFinite)&&a.max.every(Number.isFinite)));
 assert.ok(ATLAS_ENTRIES.some(e=>e.id==='steppe-dagger'&&e.number==='W003'&&e.asset.includes('steppe-dagger-v0.1.glb')));
});
test('real dagger item selects dagger visual instead of axe or sword',()=>{
 assert.equal(ITEM_CATALOG.letterOpener.slot,'weapon');
 assert.equal(ITEM_CATALOG.letterOpener.weaponKind,'dagger');
 assert.equal(equippedWeaponKind({weapon:{id:'letterOpener'}},ITEM_CATALOG),'dagger');
});
test('dagger has independent, constrained 9-parameter tuning',()=>{
 assert.equal(DAGGER_TUNER_STORAGE_KEY,'nexgame-dagger-tuner-v1');
 assert.equal(DAGGER_TUNER_GROUPS.flatMap(x=>x.fields).length,9);
 assert.deepEqual(normalizeDaggerTuning(null),DAGGER_TUNER_DEFAULTS);
 const selected=normalizeDaggerTuning({daggerY:-197,handX:999,posZ:.125,unknown:99});
 assert.equal(selected.daggerY,-180);
 assert.equal(selected.handX,180);
 assert.equal(selected.posZ,.125);
 assert.ok(!('unknown' in selected));
 assert.deepEqual(JSON.parse(serializeDaggerTuning(selected)),selected);
});
test('dagger GLB replacement, equipment, remote heroes and preview are wired together',()=>{
 const game=read('game.js'),app=read('app.html');
 assert.match(game,/function attachDaggerAsset\(actor\)/);
 assert.match(game,/steppe-dagger-v0\.1\.glb/);
 assert.match(game,/void attachDaggerAsset\(hero\)/);
 assert.match(game,/void attachDaggerAsset\(actor\)/);
 assert.match(game,/old\.name='gear-dagger-fallback'/);
 assert.match(game,/dagger\.name='gear-dagger'/);
 assert.match(game,/applyDaggerTransform\(\);\s*syncEquipmentVisuals\(\)/);
 assert.match(game,/if\(daggerVisible\)/);
 assert.match(game,/applyDaggerWristTuning\(\)/);
 assert.match(game,/root===hero\.root&&daggerPreview\?'dagger'/);
 assert.match(game,/daggerPreview=true/);
 assert.match(game,/daggerPreview=false/);
 assert.match(game,/choice\('🗡 Тюнер кинжала · примерка',openDaggerTuner\)/);
 for(const id of ['daggerTuner','daggerTunerControls','daggerTunerSide','daggerTunerCollapse','daggerTunerClose','daggerTunerReset','daggerTunerCopy','daggerTunerExport'])
  assert.ok(app.includes('id="'+id+'"'),id);
 const sword=read('sword-tuner.js'),axe=read('axe-tuner.js');
 assert.match(sword,/swordX:-8,swordY:-169,swordZ:-101/);
 assert.match(axe,/axeX:-165,axeY:-1,axeZ:-101/);
});
test('atlas, launcher and real build tag remain internally consistent',()=>{
 assert.match(read('bestiary/atlas.html'),/atlas\.js\?v=0\.2\.3/);
 const app=read('app.html'),index=read('index.html');
 const version=app.match(/NexGame · Мулгор · Alpha (\d+\.\d+\.\d+\.\d+)/)?.[1];
 assert.ok(version);
 assert.ok(app.includes('game.js?v='+version));
 assert.ok(index.includes('NexGame · Alpha '+version));
});
