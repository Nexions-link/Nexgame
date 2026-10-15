import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {SHIELD_TUNER_VARIANTS,SHIELD_TUNER_DEFAULTS,SHIELD_TUNER_FIELDS,SHIELD_TUNER_GROUPS,
 shieldTunerStorageKey,normalizeShieldTuning,serializeShieldTuning} from '../shield-tuner.js';
const read=p=>readFileSync(fileURLToPath(new URL('../'+p,import.meta.url)),'utf8');
test('round and kite shields have independently approved nine-axis defaults',()=>{
 assert.deepEqual(SHIELD_TUNER_VARIANTS,['round','kite']);
 assert.equal(shieldTunerStorageKey('round'),'nexgame-shield-round-tuner-v2');
 assert.equal(shieldTunerStorageKey('kite'),'nexgame-shield-kite-tuner-v2');
 assert.notEqual(shieldTunerStorageKey('round'),shieldTunerStorageKey('kite'));
 assert.throws(()=>shieldTunerStorageKey('other'));
 assert.throws(()=>normalizeShieldTuning(null,'other'));
 assert.deepEqual(SHIELD_TUNER_GROUPS.flatMap(g=>g.fields).sort(),Object.keys(SHIELD_TUNER_DEFAULTS.round).sort());
 assert.equal(Object.keys(SHIELD_TUNER_FIELDS).length,9);
 const grip={handX:0,handY:0,handZ:0,posX:-.12,posY:-.02,posZ:-.34};
 assert.deepEqual({...SHIELD_TUNER_DEFAULTS.round},{...grip,shieldX:0,shieldY:-140,shieldZ:0});
 assert.deepEqual({...SHIELD_TUNER_DEFAULTS.kite},{...grip,shieldX:-16,shieldY:-160,shieldZ:-180});
 for(const kind of SHIELD_TUNER_VARIANTS){
  const expected={...SHIELD_TUNER_DEFAULTS[kind]};
  assert.deepEqual(normalizeShieldTuning(null,kind),expected);
  assert.deepEqual(normalizeShieldTuning({},kind),expected);
  assert.deepEqual(JSON.parse(serializeShieldTuning(null,kind)),expected);
  assert.deepEqual(normalizeShieldTuning(expected,kind),expected);
 }
 const p=normalizeShieldTuning({posX:.215,shieldZ:-54,handY:-200,posY:5,bogus:4},'kite');
 assert.equal(p.posX,.215);assert.equal(p.shieldZ,-54);assert.equal(p.handY,-180);assert.equal(p.posY,1.5);
 assert.ok(!('bogus' in p));assert.deepEqual(JSON.parse(serializeShieldTuning(p,'kite')),p);
});
test('game supports safe shield preview, live transform, remote players and restores equipment',()=>{
 const s=read('game.js'),ui=read('app.html');
 for(const id of ['shieldTuner','shieldTunerRound','shieldTunerKite','shieldTunerControls','shieldTunerSide','shieldTunerCollapse','shieldTunerClose','shieldTunerReset','shieldTunerCopy','shieldTunerExport'])
  assert.ok(ui.includes('id="'+id+'"'),id);
 assert.match(s,/function applyShieldTransform\(root,kind\)/);
 assert.match(s,/function applyShieldWristPose\(actor,baseX\)/);
 assert.match(s,/if\(i===0\)applyShieldWristPose\(actor,arm\.hand\.rotation\.x\+block\.wristX\)/);
 assert.match(s,/mount\.position\.set\(p\.posX,p\.posY,p\.posZ\)/);
 assert.match(s,/const previewKind=root===hero\.root\?shieldPreview:null/);
 assert.match(s,/setWeaponVisuals\(root,visualKind,!!shield\|\|!!previewKind\)/);
 assert.match(s,/void attachShieldAsset\(root,rarity\)/);
 assert.match(s,/applyShieldTransform\(root,key\)/);
 assert.match(s,/function closeShieldTuner\(\)\{shieldPreview=null;shieldTunerPanel\.hidden=true;syncEquipmentVisuals\(\)\}/);
 assert.match(s,/choice\('🛡 Тюнер круглого щита'/);
 assert.match(s,/choice\('🛡 Тюнер вытянутого щита'/);
});
test('all four tuners use one collapsible group on iPhone without shifting approved grips',()=>{
 const game=read('game.js'),css=read('style.css');
 assert.match(game,/for\(const panel of \[axeTunerPanel,swordTunerPanel,daggerTunerPanel,shieldTunerPanel\]\)/);
 assert.match(css,/\.axe-tuner-section:not\(\.is-open\) \.axe-tuner-field\{display:none\}/);
 assert.match(css,/width:min\(202px,calc\(100vw - 20px\)\)/);
 assert.match(read('axe-tuner.js'),/axeX:-165,axeY:-1,axeZ:-101/);
 assert.match(read('sword-tuner.js'),/swordX:-8,swordY:-169,swordZ:-101/);
 assert.match(read('dagger-tuner.js'),/daggerX:-3,daggerY:-180,daggerZ:-60/);
});

test('game loads, saves, copies and resets each real shield variant separately',()=>{
 const s=read('game.js');
 assert.match(s,/return \[kind,normalizeShieldTuning\(input,kind\)\]/);
 assert.match(s,/normalizeShieldTuning\(\{\.\.\.shieldTuning\[shieldTunerKind\],\[key\]:Number\(slider\.value\)\},shieldTunerKind\)/);
 assert.match(s,/serializeShieldTuning\(shieldTuning\[shieldTunerKind\],shieldTunerKind\)/);
 assert.match(s,/shieldTuning\[shieldTunerKind\]=\{\.\.\.SHIELD_TUNER_DEFAULTS\[shieldTunerKind\]\}/);
 assert.match(s,/mount\.rotation\.set\(radians\(p\.shieldX\),radians\(p\.shieldY\),radians\(p\.shieldZ\),'YXZ'\)/);
 assert.match(s,/const p=shieldTuning\[mount\.userData\.shieldPoseKind\|\|'round'\]/);
 assert.match(s,/applyShieldTransform\(root,previewKind\|\|shieldModelForRarity\(rarity\)\)/);
 assert.match(s,/applyShieldTransform\(remote\.actor\.root,shieldModelForRarity\(rarity\)\)/);
});
