import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const path=new URL('../bestiary/models/dust-trail-raider-v0.2-preview.glb',import.meta.url);
function asset(){
 const buf=readFileSync(path);
 assert.equal(buf.toString('ascii',0,4),'glTF');
 assert.equal(buf.readUInt32LE(4),2);
 assert.equal(buf.readUInt32LE(8),buf.length);
 assert.equal(buf.toString('ascii',16,20),'JSON');
 const jsonLength=buf.readUInt32LE(12);
 const gltf=JSON.parse(buf.toString('utf8',20,20+jsonLength));
 return {buf,gltf};
}
test('raider v0.2 draft has a complete joined humanoid silhouette with visible armor and face',()=>{
 const {buf,gltf}=asset();
 assert.ok(buf.length>65000&&buf.length<250000);
 assert.ok(gltf.meshes.length>=45,'separately shaped torso, sleeves, garments and equipment');
 assert.ok(gltf.materials.length>=12);
 const names=new Set(gltf.nodes.map(n=>n.name));
 for(const name of ['Raider_Root','Torso','Human_head','Hood_cowl','Leather_armor','Leg_L','Leg_R',
  'Arm_L','Arm_R','Forearm_L','Forearm_R','Scarf_neck','Blade','Boot_toe_cap'])
  assert.ok(names.has(name),'missing '+name);
 assert.ok([...names].filter(x=>x==='Leather_foot').length===2);
 assert.ok(![...names].some(x=>/Cape_stitch|Cape_cloth|Cone_Cape|Rear_Pixel/.test(x)),'no detached fabric at rear');
 const triangles=gltf.meshes.reduce((t,m)=>t+m.primitives.reduce((a,p)=>
  a+gltf.accessors[p.indices].count/3,0),0);
 assert.ok(triangles>=2900,'match the established Dolgonog geometric detail');
 assert.ok(triangles<=7500,'keep mobile render affordable');
});
test('raider draft has genuine five-track joint animations',()=>{
 const {gltf}=asset();
 assert.deepEqual(gltf.animations.map(a=>a.name),['Idle','Walk','Attack','Hurt','Death']);
 for(const anim of gltf.animations){
  assert.ok(anim.channels.length>=4);
  assert.equal(anim.channels.length,anim.samplers.length);
  for(const channel of anim.channels){
   assert.ok(channel.target.node<gltf.nodes.length);
   assert.equal(channel.target.path,'rotation');
  }
 }
});
