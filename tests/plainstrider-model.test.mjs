import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 PLAINSTRIDER_GLB,PLAINSTRIDER_VISUAL_SCALE,PLAINSTRIDER_REQUIRED_CLIPS,
 validatePlainstriderGltf,plainstriderMotion
} from '../plainstrider-model.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
test('original animated GLB remains the sole bestiary creature asset',()=>{
 const path=resolve(root,'bestiary/models/dolgonog-v0.1.glb');
 const bytes=readFileSync(path);
 assert.equal(bytes.toString('ascii',0,4),'glTF');
 assert.equal(bytes.readUInt32LE(4),2);
 assert.equal(bytes.readUInt32LE(8),bytes.length);
 assert.equal(bytes.length,365768);
 assert.ok(PLAINSTRIDER_GLB.includes('./bestiary/models/dolgonog-v0.1.glb'));
 assert.equal(PLAINSTRIDER_VISUAL_SCALE,.6);
 assert.equal(PLAINSTRIDER_REQUIRED_CLIPS.join(','),'Idle,Walk,Peck');
 for(const name of ['dolgonog-v0.2.glb','dolgonog-v0.2-ref.glb']){
  assert.equal(existsSync(resolve(root,'bestiary/models',name)),false);
 }
 const jsonLen=bytes.readUInt32LE(12);
 const parsed=JSON.parse(bytes.toString('utf8',20,20+jsonLen));
 assert.deepEqual(parsed.animations.map(a=>a.name),['Idle','Walk','Peck']);
 assert.equal(parsed.meshes.length,12);
 assert.equal(parsed.materials.length,1);
});
test('rig validation rejects partial or incorrect animation setups',()=>{
 const known=new Set(['Body','Head','Neck','Leg_L','Leg_R','Body_mesh','Head_mesh']);
 const gltf={scene:{getObjectByName:name=>known.has(name)?{name}:null},animations:[{name:'Idle'},{name:'Walk'},{name:'Peck'}]};
 assert.equal(validatePlainstriderGltf(gltf),true);
 assert.equal(validatePlainstriderGltf({...gltf,animations:[{name:'Idle'}]}),false);
 assert.equal(validatePlainstriderGltf({...gltf,scene:{getObjectByName:()=>null}}),false);
});
test('animation selection supports free-roaming, attack, corpse and giant',()=>{
 assert.equal(plainstriderMotion({}), 'Idle');
 assert.equal(plainstriderMotion({moved:.01,dt:.016}), 'Walk');
 assert.equal(plainstriderMotion({attackCd:1.1,moved:.1}), 'Peck');
 assert.equal(plainstriderMotion({attackCd:1.45,boss:true}), 'Peck');
 assert.equal(plainstriderMotion({dead:true,attackCd:1.2,moved:.1}), 'corpse');
 assert.equal(plainstriderMotion({moved:.0001,dt:.02}), 'Idle');
});
test('original GLB is connected to wild birds, giant and both wildlife update paths',()=>{
 const game=read('game.js');
 assert.match(game,/loadOriginalDolgonogs\(\)/);
 assert.match(game,/new GLTFLoader\(\)\.loadAsync\(PLAINSTRIDER_GLB\)/);
 assert.match(game,/for\(const enemy of enemies\)if\(!enemy\.trainingDummy\)/);
 assert.match(game,/attachPlainstriderGltf\(THREE,enemy,gltf\)/);
 assert.match(game,/resetPlainstriderVisual\(e\)/);
 assert.ok((game.match(/advancePlainstriderVisual\(THREE,e,dt/g)||[]).length>=4);
 assert.match(game,/giant\.baseScale=1\.8/);
 assert.match(game,/giant\.maxHp=giant\.hp=108/);
 assert.match(game,/makeTrainingDummy\(\)/);
 assert.match(game,/catch\(error\)[\s\S]{0,180}procedural fallback/);
 const html=read('app.html');
 assert.match(html,/type="importmap"/);
 assert.match(html,/game\.js\?v=0\.3\.5\.42/);
 const registry=read('bestiary/catalog.js');
 assert.match(registry,/version:'0\.1'/);
 assert.match(registry,/asset:'models\/dolgonog-v0\.1\.glb'/);
 assert.doesNotMatch(registry,/versions:Object/);
 assert.doesNotMatch(read('bestiary/index.html'),/data-version=|version-picker/);
 assert.doesNotMatch(read('bestiary/main.js'),/selectedVersion|data-version/);
});
