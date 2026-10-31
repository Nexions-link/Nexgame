import test from 'node:test';
import assert from 'node:assert/strict';
import {forestAssetLayout,ASSET_SCENERY_CAPS} from '../asset-forest-layout.js';

const anchors=[[-26,21,1.2],[54,35,1],[34,-26,.95],[-34,-30,1.15],
 [9,49,1.2],[-39,40,1.1],[51,25,1.3],[57,-21,.8],[-47,-7,1.1]];

test('real asset placements are deterministic and preserve village tree anchors',()=>{
 const first=forestAssetLayout({anchors});
 const second=forestAssetLayout({anchors});
 assert.deepEqual(first,second);
 assert.deepEqual(first.trees.slice(0,anchors.length).map(p=>[p.x,p.z,p.scale]),
  anchors);
 for(const [kind,cap] of Object.entries(ASSET_SCENERY_CAPS)){
  assert.ok(first[kind].length<=cap);
  assert.ok(first[kind].length>0,kind);
 }
});

test('non-anchored scenery respects the placement filter and stays on planet',()=>{
 const accepted=(x,z)=>x>=0&&z>=0;
 const plan=forestAssetLayout({anchors,accept:accepted});
 for(const category of Object.values(plan)){
  for(const p of category){
   assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.z));
   assert.ok(Number.isFinite(p.angle)&&Number.isFinite(p.scale));
   if(p.anchored)continue;
   assert.ok(accepted(p.x,p.z));
   assert.ok(Math.hypot(p.x,p.z)<=65);
  }
 }
});

test('forest integration is fail-open and preserves base art when assets cannot load',async()=>{
 const {readFileSync}=await import('node:fs');
 const {fileURLToPath}=await import('node:url');
 const read=path=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),'utf8');
 const client=read('../planet.js'),starter=read('../start-zone.js');
 assert.match(client,/import\('\.\/asset-forest\.js\?v=1'\)/);
 assert.match(client,/startZone\.setExternalTreesActive\(enabled\)/);
 assert.match(client,/\.catch\(error=>console\.warn\('NexGameWorld: CC0 asset pack fallback/);
 assert.match(starter,/nativeTreeRoots\.push\(g\)/);
 assert.match(starter,/villageVisuals\.setExternalTreesActive\(enabled\)/);
});
