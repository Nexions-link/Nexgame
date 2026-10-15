import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {AXE_TUNER_DEFAULTS,normalizeAxeTuning,serializeAxeTuning,AXE_TUNER_GROUPS} from '../axe-tuner.js';
const read=name=>readFileSync(fileURLToPath(new URL('../'+name,import.meta.url)),'utf8');

test('mobile tuner has all axes with clamped local-only persisted values',()=>{
 assert.equal(AXE_TUNER_GROUPS.flatMap(group=>group.fields).length,9);
 assert.deepEqual(normalizeAxeTuning(null),AXE_TUNER_DEFAULTS);
 const values=normalizeAxeTuning({handZ:999,axeY:-95,posX:0.125,posZ:Infinity,unknown:4});
 assert.equal(values.handZ,180);
 assert.equal(values.axeY,-95);
 assert.equal(values.posX,.125);
 assert.equal(values.posZ,AXE_TUNER_DEFAULTS.posZ);
 assert.ok(!('unknown' in values));
 assert.deepEqual(JSON.parse(serializeAxeTuning(values)),values);
});

test('tuner changes wrist after animation and handles asynchronous GLB replacement',()=>{
 const src=read('game.js');
 assert.match(src,/actor===hero/);
 assert.match(src,/rightWristBaseX=arm\.hand\.rotation\.x;applyAxeWristTuning\(\)/);
 assert.match(src,/applyAxeTransform\(\)/);
 assert.match(src,/old\.name='gear-axe-fallback';axe\.name='gear-axe';\s*applyAxeTransform\(\)/);
 assert.match(src,/choice\('🛠 Тюнер кисти и топора',openAxeTuner\)/);
 assert.match(src,/localStorage\.setItem\(AXE_TUNER_STORAGE_KEY,serializeAxeTuning\(axeTuning\)\)/);
 assert.match(src,/axe\.rotation\.set\(radians\(axeTuning\.axeX\),radians\(axeTuning\.axeY\),/);
});

test('release and touch-friendly control panel are present',()=>{
 const app=read('app.html'),css=read('style.css');
 for(const id of ['axeTuner','axeTunerControls','axeTunerSide','axeTunerCollapse','axeTunerClose','axeTunerReset','axeTunerCopy']){
  assert.ok(app.includes('id="'+id+'"'),id);
 }
 assert.match(css,/\.axe-tuner-field input/);
 assert.match(css,/\.axe-tuner\[hidden\]/);
 assert.match(css,/52dvh/);
});
