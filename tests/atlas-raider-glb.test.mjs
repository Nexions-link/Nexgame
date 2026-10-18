import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ATLAS_ENTRIES,filterAtlasEntries} from '../bestiary/atlas-catalog.js';
const asset=new URL('../bestiary/models/dust-trail-raider-v0.1.glb',import.meta.url);
const previewAsset=new URL('../bestiary/models/dust-trail-raider-v0.2.glb',import.meta.url);
const refinedAsset=new URL('../bestiary/models/dust-trail-raider-v0.3.glb',import.meta.url);
const clips=['Idle','Walk','Attack','Hurt','Death'];
test('C004 Atlas preview is refined v0.3 while live game retains reviewed v0.1',()=>{
 const entry=ATLAS_ENTRIES.find(e=>e.id==='bandit');
 assert.ok(entry);
 assert.equal(entry.category,'creatures');
 assert.equal(entry.number,'C004');
 assert.equal(entry.asset,'./models/dust-trail-raider-v0.3.glb');
 assert.equal(entry.version,'0.3');
 assert.match(entry.description,/заменой игрового прототипа/);
 assert.deepEqual(entry.animations,clips);
 assert.equal(filterAtlasEntries('creatures','разбойник').length,1);
 const game=readFileSync(new URL('../planet-test/offline-rpg.js',import.meta.url),'utf8');
 assert.match(game,/loader\.loadAsync\('\.\.\/bestiary\/models\/dust-trail-raider-v0\.1\.glb\?v=0\.1'\)/);
 assert.match(game,/attachBanditVisual\(mob,asset\)/);
 const atlas=readFileSync(new URL('../bestiary/atlas.js',import.meta.url),'utf8');
 assert.match(atlas,/atlas_refresh/);
 assert.match(atlas,/gltf\.animations/);
});
test('shared Raider GLB has valid GLB2 binary, skeleton-like hierarchy and all five playable animations',()=>{
 const data=readFileSync(asset);
 assert.ok(data.length>15000&&data.length<150000);
 assert.equal(data.toString('ascii',0,4),'glTF');
 assert.equal(data.readUInt32LE(4),2);
 assert.equal(data.readUInt32LE(8),data.length);
 const jsonLength=data.readUInt32LE(12);
 assert.equal(data.toString('ascii',16,20),'JSON');
 const binOffset=20+jsonLength;
 assert.equal(data.toString('ascii',binOffset+4,binOffset+8),'BIN\u0000');
 const gltf=JSON.parse(data.toString('utf8',20,binOffset));
 assert.ok(gltf.meshes.length>=10);
 assert.ok(gltf.materials.length>=8);
 assert.deepEqual(gltf.animations.map(x=>x.name),clips);
 for(const part of ['DustTrailRaider','Torso','Leg_L','Leg_R','Arm_L','Arm_R','Dagger','Cape'])
  assert.ok(gltf.nodes.some(x=>x.name===part),'missing '+part);
 for(const clip of gltf.animations){
  assert.ok(clip.channels.length>=2,'real independent animated joints in '+clip.name);
  assert.equal(clip.channels.length,clip.samplers.length);
  for(const ch of clip.channels){
   assert.ok(ch.target.node>=0&&ch.target.node<gltf.nodes.length);
   assert.equal(ch.target.path,'rotation');
  }
 }
 const count=gltf.accessors.length;
 assert.ok(gltf.meshes.every(m=>m.primitives.every(p=>
  p.attributes.POSITION<count&&p.attributes.NORMAL<count&&p.indices<count)));
 assert.equal(gltf.buffers[0].byteLength,data.readUInt32LE(binOffset));
 assert.equal(data.length,binOffset+8+gltf.buffers[0].byteLength);
});
test('new scout quest is locked on levels 1 and 2, and requires the server-authorized level 3',()=>{
 const server=readFileSync(new URL('../server/bandit-quest.js',import.meta.url),'utf8');
 const game=readFileSync(new URL('../planet-test/offline-rpg.js',import.meta.url),'utf8');
 assert.match(server,/state\.level<BANDIT_QUEST_MIN_LEVEL/);
 assert.match(game,/state\.level<BANDIT_QUEST_MIN_LEVEL/);
 assert.match(game,/bandit_quest_level_too_low/);
});

test('preview Raider v0.2 is an intact, higher-resolution humanoid with no orphaned scene branches',()=>{
 const data=readFileSync(previewAsset);
 assert.ok(data.length>100000&&data.length<650000);
 assert.equal(data.toString('ascii',0,4),'glTF');
 assert.equal(data.readUInt32LE(4),2);
 assert.equal(data.readUInt32LE(8),data.length);
 const jsonLength=data.readUInt32LE(12);
 assert.equal(data.toString('ascii',16,20),'JSON');
 const end=20+jsonLength,glb=JSON.parse(data.toString('utf8',20,end));
 assert.equal(glb.buffers[0].byteLength,data.readUInt32LE(end));
 assert.equal(data.length,end+8+glb.buffers[0].byteLength);
 assert.ok(glb.materials.length>=20);
 assert.ok(glb.meshes.length>=40);
 assert.deepEqual(glb.animations.map(a=>a.name),clips);
 const named=new Set(glb.nodes.map(n=>n.name));
 for(const part of ['DustTrailRaider','Body','Head','Arm_L','Arm_R','Forearm_L','Forearm_R',
   'Leg_L','Leg_R','Shin_L','Shin_R','Cape','Dagger'])
  assert.ok(named.has(part),'missing '+part);
 const sceneRoots=glb.scenes[glb.scene].nodes;
 assert.equal(sceneRoots.length,1);
 const reached=new Set();
 const walk=id=>{assert.ok(!reached.has(id),'duplicate node parent');reached.add(id);for(const c of glb.nodes[id].children||[])walk(c)};
 walk(sceneRoots[0]);
 assert.equal(reached.size,glb.nodes.length,'no detached parts in the GLB');
 const count=glb.accessors.length;
 let triangleCount=0;
 for(const mesh of glb.meshes)for(const p of mesh.primitives){
  assert.ok(p.attributes.POSITION<count&&p.attributes.NORMAL<count&&p.indices<count);
  assert.ok(glb.accessors[p.indices].count>=3);
  triangleCount+=glb.accessors[p.indices].count/3;
 }
 assert.ok(triangleCount>=4000&&triangleCount<=7000,'target detail comparable with longstrider');
 for(const clip of glb.animations){
  assert.ok(clip.channels.length>=3);
  assert.ok(clip.channels.every(ch=>ch.target.node<glb.nodes.length));
 }
});

test('Raider v0.3 is a valid refined GLB with connected cape, recognizable face, belt kit and five clips',()=>{
 const data=readFileSync(refinedAsset);
 assert.ok(data.length>500000&&data.length<900000);
 assert.equal(data.toString('ascii',0,4),'glTF');
 assert.equal(data.readUInt32LE(4),2);
 assert.equal(data.readUInt32LE(8),data.length);
 const len=data.readUInt32LE(12),binAt=20+len;
 assert.equal(data.toString('ascii',16,20),'JSON');
 assert.equal(data.toString('ascii',binAt+4,binAt+8),'BIN\u0000');
 const gltf=JSON.parse(data.toString('utf8',20,binAt));
 assert.ok(gltf.buffers[0].byteLength<=data.readUInt32LE(binAt));
 assert.ok(data.readUInt32LE(binAt)-gltf.buffers[0].byteLength<4);
 assert.equal(data.length,binAt+8+data.readUInt32LE(binAt));
 assert.equal(gltf.materials.length,22);
 assert.ok(gltf.meshes.length>=80,'refined geometry includes new details');
 const count=gltf.meshes.reduce((sum,m)=>sum+m.primitives.reduce((n,p)=>n+gltf.accessors[p.indices].count/3,0),0);
 assert.ok(count>=6500&&count<9000,'mesh detail increased above 5,112 triangles');
 assert.deepEqual(gltf.animations.map(x=>x.name),clips);
 const byName=new Map(gltf.nodes.map((n,i)=>[n.name,{...n,index:i}]));
 for(const name of ['Nose_bone_and_bridge','Chin_and_jaw','Belt_satchel','Satchel_brass_lock',
     'Cape_continuous_mantle','Cape_inner_lining','Cape_fastener_L','Cape_fastener_R',
     'Boot_outer_crossstrap_-1','Boot_outer_crossstrap_1','Dagger_honed_edge'])
  assert.ok(byName.has(name),'missing sculpted detail: '+name);
 const cape=byName.get('Cape');
 assert.equal(cape.mesh,undefined,'old segmented cape removed');
 for(const child of ['Cape_detail_50','Cape_detail_51'])
  assert.equal(byName.get(child).mesh,undefined,'previous floating rear pieces are hidden: '+child);
 for(const childName of ['Cape_continuous_mantle','Cape_inner_lining','Cape_fastener_L','Cape_fastener_R'])
  assert.ok(cape.children.includes(byName.get(childName).index));
 const root=gltf.scenes[gltf.scene].nodes;
 assert.equal(root.length,1);
 const reached=new Set();
 const visit=index=>{assert.ok(index>=0&&index<gltf.nodes.length);assert.ok(!reached.has(index));reached.add(index);
  for(const child of gltf.nodes[index].children||[])visit(child)};
 visit(root[0]);assert.equal(reached.size,gltf.nodes.length);
 for(const m of gltf.meshes)for(const primitive of m.primitives){
  const p=gltf.accessors[primitive.attributes.POSITION],n=gltf.accessors[primitive.attributes.NORMAL],i=gltf.accessors[primitive.indices];
  assert.equal(p.count,n.count);assert.ok(i.count>=3);
 }
});
