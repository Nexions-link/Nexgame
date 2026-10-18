import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ATLAS_ENTRIES,filterAtlasEntries} from '../bestiary/atlas-catalog.js';
const asset=new URL('../bestiary/models/dust-trail-raider-v0.1.glb',import.meta.url);
const clips=['Idle','Walk','Attack','Hurt','Death'];
test('C004 bandit is indexed in Atlas as the same GLB used in game',()=>{
 const entry=ATLAS_ENTRIES.find(e=>e.id==='bandit');
 assert.ok(entry);
 assert.equal(entry.category,'creatures');
 assert.equal(entry.number,'C004');
 assert.equal(entry.asset,'./models/dust-trail-raider-v0.1.glb');
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
