import test from 'node:test';
import assert from 'node:assert/strict';
import {modernPreviewEnabled,modernLightingValues} from './modern-lighting-preview.js';
test('lighting preview is opt-in only',()=>{
  assert.equal(modernPreviewEnabled(''),false);
  assert.equal(modernPreviewEnabled('?gfx-modern=1'),true);
  assert.equal(modernPreviewEnabled('?gfx-modern=0'),false);
});
test('baseline is unchanged, modern daylight adds directional contrast',()=>{
 const base={hemi:1.7,sun:2.8,fill:.62,exposure:1.14};
 assert.deepEqual(modernLightingValues(base,.8,false),base);
 const modern=modernLightingValues(base,.8,true);
 assert.ok(modern.hemi<base.hemi);
 assert.ok(modern.sun>base.sun);
 assert.ok(modern.exposure<base.exposure);
 for(const value of Object.values(modern))assert.ok(Number.isFinite(value)&&value>0);
});
