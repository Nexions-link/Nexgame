import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 PLAINSTRIDER_GLB,PLAINSTRIDER_VISUAL_SCALE,PLAINSTRIDER_REQUIRED_CLIPS,
 validatePlainstriderGltf,plainstriderMotion,advancePlainstriderVisual,
 PLAINSTRIDER_WALK_GRACE,PLAINSTRIDER_BLEND_TIME
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
 const release=html.match(/NexGame · Мулгор · Alpha (\d+\.\d+\.\d+\.\d+)/)?.[1];
 assert.ok(release&&html.includes('game.js?v='+release),'live game module follows the HTML release');
 const registry=read('bestiary/catalog.js');
 assert.match(registry,/version:'0\.1'/);
 assert.match(registry,/asset:'models\/dolgonog-v0\.1\.glb'/);
 assert.doesNotMatch(registry,/versions:Object/);
 assert.doesNotMatch(read('bestiary/index.html'),/data-version=|version-picker/);
 assert.doesNotMatch(read('bestiary/main.js'),/selectedVersion|data-version/);
});

function mockAnimatedBird(){
 const events=[];
 const actions=Object.fromEntries(['Idle','Walk','Peck'].map(name=>[
  name,{
   name,
   reset(){events.push(['reset',name]);return this},
   setEffectiveTimeScale(){return this},
   setEffectiveWeight(){return this},
   setLoop(mode,repeat){events.push(['loop',name,mode,repeat]);return this},
   play(){events.push(['play',name]);return this},
   fadeIn(sec){events.push(['fade',name,sec]);return this},
   crossFadeFrom(previous,sec){events.push(['crossfade',name,previous.name,sec]);return this}
  }
 ]));
 const visual={
  container:{rotation:{x:0,z:0},position:{z:0}},
  mixer:{update(sec){events.push(['tick',sec])},stopAllAction(){events.push(['stop'])}},
  actions,mode:null,walkGrace:0,attackRemaining:0,lastAttackCd:0
 };
 const enemy={birdVisual:visual,attackCd:0,boss:false};
 const THREE={LoopOnce:'once',LoopRepeat:'repeat'};
 return {enemy,visual,actions,events,THREE};
}
test('network motion micro-pauses no longer repeatedly reset animated GLB legs',()=>{
 const {enemy,visual,events,THREE}=mockAnimatedBird();
 advancePlainstriderVisual(THREE,enemy,.016,.04);
 assert.equal(visual.mode,'Walk');
 assert.equal(visual.walkGrace,PLAINSTRIDER_WALK_GRACE);
 for(let i=0;i<12;i++)advancePlainstriderVisual(THREE,enemy,.016,0);
 assert.equal(visual.mode,'Walk','held walk survives 12 frames with no position delta');
 assert.equal(events.filter(x=>x[0]==='reset'&&x[1]==='Walk').length,1);
 for(let i=0;i<18;i++)advancePlainstriderVisual(THREE,enemy,.016,0);
 assert.equal(visual.mode,'Idle','returns to idle after a sustained stop');
 assert.ok(events.some(x=>x[0]==='crossfade'&&x[1]==='Idle'&&x[2]==='Walk'&&x[3]===PLAINSTRIDER_BLEND_TIME));
});
test('peck plays a full animation even when the combat cooldown drops',()=>{
 const {enemy,visual,events,THREE}=mockAnimatedBird();
 enemy.attackCd=1.5;
 advancePlainstriderVisual(THREE,enemy,.016,0);
 assert.equal(visual.mode,'Peck');
 assert.ok(events.some(x=>x[0]==='loop'&&x[1]==='Peck'&&x[2]==='once'));
 for(let i=0;i<42;i++){
  enemy.attackCd=Math.max(0,enemy.attackCd-.016);
  advancePlainstriderVisual(THREE,enemy,.016,0);
 }
 assert.equal(visual.mode,'Peck','full .8s peck lasts after cooldown threshold passes');
 for(let i=0;i<12;i++){
  enemy.attackCd=Math.max(0,enemy.attackCd-.016);
  advancePlainstriderVisual(THREE,enemy,.016,0);
 }
 assert.equal(visual.mode,'Idle');
 assert.equal(events.filter(x=>x[0]==='reset'&&x[1]==='Peck').length,1);
});
test('GLB loading and fallback status is inspectable from game HUD',()=>{
 const game=read('game.js');
 assert.match(game,/dolgonogRenderStatus='GLB'/);
 assert.match(game,/dolgonogRenderStatus='резерв'/);
 assert.match(game,/долгоноги: '\+dolgonogRenderStatus/);
 const loader=read('index.html');
 assert.match(loader,/const importMapText=parsed\.querySelector/);
 assert.match(loader,/document\.head\.appendChild\(map\)/);
});

test('GLB impact moves the visual container briefly and fully releases on recovery',async()=>{
 const {HIT_REACTION_SECONDS}=await import('../combat-feedback.js');
 const {enemy,visual,THREE}=mockAnimatedBird();
 enemy.hit=HIT_REACTION_SECONDS/2;
 advancePlainstriderVisual(THREE,enemy,.016,0);
 assert.ok(visual.container.rotation.x<0,'bird recoils backward');
 assert.ok(visual.container.position.z<0,'bird slips briefly away from the impact');
 enemy.hit=0;
 advancePlainstriderVisual(THREE,enemy,.016,0);
 assert.equal(visual.container.rotation.x,0);
 assert.equal(visual.container.rotation.z,0);
 assert.equal(visual.container.position.z,0);
 enemy.hit=HIT_REACTION_SECONDS/2;
 advancePlainstriderVisual(THREE,enemy,.016,0,true);
 assert.equal(visual.container.position.z,0,'corpse does not jerk');
});
