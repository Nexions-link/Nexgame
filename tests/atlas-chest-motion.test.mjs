import test from 'node:test';
import assert from 'node:assert/strict';
import {createChestMotion} from '../bestiary/chest-preview-motion.js';
import {ATLAS_CATEGORIES} from '../bestiary/atlas-catalog.js';
function advance(motion, steps=90) {
 for (let i=0;i<steps;i++) motion.update(1/60);
}
test('close after open starts at current pose and ends closed', () => {
 const hinge={rotation:{x:0}}, motion=createChestMotion(hinge);
 motion.select('Open'); advance(motion);
 assert.ok(Math.abs(hinge.rotation.x+1.65)<1e-5);
 motion.select('Close');
 assert.ok(Math.abs(hinge.rotation.x+1.65)<1e-5, 'selection must not snap the hinge');
 motion.update(1/60);
 assert.ok(hinge.rotation.x > -1.65 && hinge.rotation.x < -1.60, 'first frame moves toward closed');
 const afterFirst=hinge.rotation.x;
 motion.update(1/60);
 assert.ok(hinge.rotation.x > afterFirst, 'closing movement is monotonic');
 advance(motion);
 assert.equal(hinge.rotation.x, 0);
 assert.equal(motion.isMoving, false);
});
test('closing a closed chest never opens it', () => {
 const hinge={rotation:{x:0}}, motion=createChestMotion(hinge);
 motion.select('Close'); advance(motion);
 assert.equal(hinge.rotation.x,0);
});
test('reversing a partial opening keeps current pose', () => {
 const hinge={rotation:{x:0}}, motion=createChestMotion(hinge);
 motion.select('Open'); advance(motion,22);
 const partial=hinge.rotation.x;
 assert.ok(partial<0 && partial>-1.65);
 motion.select('Close');
 assert.equal(hinge.rotation.x,partial);
 motion.update(1/60);
 assert.ok(hinge.rotation.x>partial);
 advance(motion);
 assert.equal(hinge.rotation.x,0);
});
test('Idle pauses without resetting lid angle', () => {
 const hinge={rotation:{x:0}}, motion=createChestMotion(hinge);
 motion.select('Open'); advance(motion,22);
 const partial=hinge.rotation.x;
 motion.select('Idle'); advance(motion);
 assert.equal(hinge.rotation.x,partial);
});
test('all Atlas categories have distinct icons', () => {
 const icons=ATLAS_CATEGORIES.map(x=>x.icon);
 assert.equal(new Set(icons).size,icons.length);
 assert.notEqual(ATLAS_CATEGORIES.find(x=>x.id==='items').icon,ATLAS_CATEGORIES.find(x=>x.id==='weapons').icon);
});
