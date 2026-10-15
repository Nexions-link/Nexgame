import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SWORD_TUNER_DEFAULTS,SWORD_TUNER_STORAGE_KEY,normalizeSwordTuning,serializeSwordTuning} from '../sword-tuner.js';
import {ATLAS_ENTRIES} from '../bestiary/atlas-catalog.js';
const read=path=>readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)),'utf8');
test('Sword GLB has valid binary header and crafted parts',()=>{
 const glb=readFileSync(fileURLToPath(new URL('../assets/weapons/plains-sword-v0.1.glb',import.meta.url)));
 assert.equal(glb.toString('ascii',0,4),'glTF');assert.equal(glb.readUInt32LE(4),2);
 assert.equal(glb.readUInt32LE(8),glb.length);
 const json=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));
 assert.ok(json.meshes.length>=15);assert.ok(json.materials.length>=6);
 for(const name of ['blade','grip','pommel'])assert.ok(json.nodes.some(n=>n.name.toLowerCase().includes(name)),name);
 assert.ok(ATLAS_ENTRIES.some(e=>e.id==='plains-sword'&&e.asset.includes('plains-sword-v0.1.glb')));
});
test('Sword tuning is independent, validates input and preserves axe configuration',()=>{
 assert.match(SWORD_TUNER_STORAGE_KEY,/sword/);
 assert.deepEqual(normalizeSwordTuning(null),SWORD_TUNER_DEFAULTS);
 const v=normalizeSwordTuning({handZ:-80,swordY:999,posX:.125,extra:true});
 assert.equal(v.handZ,-80);assert.equal(v.swordY,180);assert.equal(v.posX,.125);
 assert.ok(!('extra' in v));assert.deepEqual(JSON.parse(serializeSwordTuning(v)),v);
 assert.match(read('axe-tuner.js'),/handX:-180,handY:-67,handZ:-82/);
});
test('Game equips real sword GLB and permits non-destructive mobile preview',()=>{
 const game=read('game.js'),html=read('app.html');
 assert.match(game,/function attachSwordAsset\(actor\)/);
 assert.match(game,/plains-sword-v0\.1\.glb/);
 assert.match(game,/void attachSwordAsset\(hero\)/);
 assert.match(game,/void attachSwordAsset\(actor\)/);
 assert.match(game,/root===hero\.root&&swordPreview/);
 assert.match(game,/setWeaponVisuals\(root,visualKind,!!shield\)/);
 assert.match(game,/swordPreview=true/);
 assert.match(game,/swordPreview=false/);
 assert.match(game,/choice\('⚔ Тюнер меча · примерка',openSwordTuner\)/);
 for(const id of ['swordTuner','swordTunerControls','swordTunerReset','swordTunerCopy','swordTunerExport'])assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(read('bestiary/atlas.html'),/atlas\.js\?v=0\.2\.2/);
});

test('final sword grip uses all 9 confirmed user values independently of axe',()=>{
 const pose={handX:-180,handY:-67,handZ:-82,
  swordX:-8,swordY:-169,swordZ:-101,posX:-.225,posY:-.19,posZ:-.025};
 assert.deepEqual({...SWORD_TUNER_DEFAULTS},pose);
 assert.deepEqual(normalizeSwordTuning(null),pose);
 assert.deepEqual(JSON.parse(serializeSwordTuning(null)),pose);
 assert.equal(SWORD_TUNER_STORAGE_KEY,'nexgame-sword-tuner-v2');
 const game=read('game.js');
 assert.match(game,/g\.position\.set\(SWORD_TUNER_DEFAULTS\.posX,SWORD_TUNER_DEFAULTS\.posY,SWORD_TUNER_DEFAULTS\.posZ\)/);
 assert.match(game,/SWORD_TUNER_DEFAULTS\.swordZ\*Math\.PI\/180/);
 assert.match(game,/SWORD_TUNER_DEFAULTS\.handZ\*Math\.PI\/180/);
 assert.match(game,/model\.rotation\.set\(radians\(swordTuning\.swordX\),radians\(swordTuning\.swordY\),/);
 assert.match(game,/sword\.rotation\.copy\(old\.rotation\)/);
 const app=read('app.html'),index=read('index.html');
 const release=app.match(/NexGame · Мулгор · Alpha (\d+\.\d+\.\d+\.\d+)/)?.[1];
 assert.ok(release,'app shell has a release identifier');
 assert.ok(app.includes('game.js?v='+release));
 assert.ok(index.includes('NexGame · Alpha '+release));
 // Axe always retains its previously approved independent baseline.
 const axe=read('axe-tuner.js');
 assert.match(axe,/handX:-180,handY:-67,handZ:-82/);
 assert.match(axe,/axeX:-165,axeY:-1,axeZ:-101/);
 assert.match(axe,/posX:-0\.555,posY:-0\.19,posZ:-0\.025/);
});
