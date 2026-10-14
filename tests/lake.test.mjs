import test from 'node:test';
import assert from 'node:assert/strict';
import {
 LAKE_BLUEPRINT,createLake,normalizedLakeRadius,lakeTerrainHeight,
 lakeWaterDepth,canWadeAt,lakePointAt,lakeDryShorePoint,fishingCastPoint
} from '../lake.js';
const lake=createLake(1.7);
const approx=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`Expected ${a} ≈ ${b}`);

test('old painted pond is replaced with lake several times larger and several character-heights deep',()=>{
 const oldArea=Math.PI*8.4*4.32,newArea=Math.PI*lake.radiusX*lake.radiusZ;
 assert.ok(newArea/oldArea>4,'lake area must increase by several times');
 assert.equal(lake.type,'fishableWater');
 assert.equal(lake.swimmingEnabled,false);
 assert.ok(lake.maxDepth>=9.5);
 approx(lakeWaterDepth(lake.x,lake.z,lake),lake.maxDepth);
 approx(lakeTerrainHeight(lake.x,lake.z,2,lake),lake.surfaceY-lake.maxDepth);
});
test('shoreline smoothly reconnects to the natural terrain',()=>{
 for(const angle of [0,.7,1.8,3.6,5.1]){
  const shore=lakePointAt(angle,1,lake),dry=lakePointAt(angle,1.28,lake);
  approx(normalizedLakeRadius(shore.x,shore.z,lake),1);
  approx(lakeTerrainHeight(dry.x,dry.z,3.7,lake),3.7);
  assert.ok(lakeTerrainHeight(shore.x,shore.z,2,lake)>lake.surfaceY);
  assert.equal(lakeWaterDepth(dry.x,dry.z,lake),0);
 }
});
test('wading is allowed only in the shallows until swimming is implemented',()=>{
 const shallow=lakePointAt(.4,.92,lake);
 const deep=lakePointAt(.4,.52,lake);
 assert.equal(canWadeAt(shallow.x,shallow.z,lake),true);
 assert.equal(canWadeAt(deep.x,deep.z,lake),false);
 const rescue=lakeDryShorePoint(deep.x,deep.z,lake);
 assert.ok(normalizedLakeRadius(rescue.x,rescue.z,lake)>1.1);
 assert.equal(canWadeAt(rescue.x,rescue.z,lake),true);
});
test('future fishing receives a valid cast point from accessible banks',()=>{
 for(const angle of [0,1,2.4,4.6]){
  const bank=lakePointAt(angle,1.09,lake);
  const cast=fishingCastPoint(bank.x,bank.z,lake);
  assert.ok(cast,`No fishing spot at angle ${angle}`);
  assert.equal(cast.waterId,lake.id);approx(cast.y,lake.surfaceY);
  assert.ok(Math.hypot(cast.x-bank.x,cast.z-bank.z)<=lake.fishing.maxCastDistance);
  assert.ok(lakeWaterDepth(cast.x,cast.z,lake)>=lake.fishing.minCastDepth);
 }
 assert.equal(fishingCastPoint(lake.x,lake.z,lake),null);
 assert.equal(fishingCastPoint(0,0,lake),null);
});
