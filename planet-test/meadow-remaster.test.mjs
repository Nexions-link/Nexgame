import test from 'node:test';
import assert from 'node:assert/strict';
import {meadowGrassBladeData} from './sphere-meadow.js';

test('remastered turf has curved, visible, finite blade geometry',()=>{
 const data=meadowGrassBladeData();
 assert.equal(data.bladeCount,7);
 assert.equal(data.positions.length,7*5*3*3);
 assert.equal(data.colors.length,data.positions.length);
 assert.ok(data.positions.every(Number.isFinite));
 assert.ok(data.colors.every(Number.isFinite));
 let maxHeight=0,maxReach=0;
 for(let i=0;i<data.positions.length;i+=3){
  maxHeight=Math.max(maxHeight,data.positions[i+1]);
  maxReach=Math.max(maxReach,Math.hypot(data.positions[i],data.positions[i+2]));
 }
 assert.ok(maxHeight>.8);
 assert.ok(maxReach>.4);
});
