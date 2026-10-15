// Original Dolgonog v0.1 asset adapter shared by the game and regression tests.
// Deliberately no reference to the old experimental models.
export const PLAINSTRIDER_GLB='./bestiary/models/dolgonog-v0.1.glb?v=0.3.5.42';
export const PLAINSTRIDER_VISUAL_SCALE=.6;
export const PLAINSTRIDER_REQUIRED_CLIPS=Object.freeze(['Idle','Walk','Peck']);
export const PLAINSTRIDER_REQUIRED_PARTS=Object.freeze(['Body','Head','Neck','Leg_L','Leg_R','Body_mesh','Head_mesh']);
export function validatePlainstriderGltf(gltf){
 if(!gltf?.scene||!Array.isArray(gltf.animations))return false;
 const clips=new Set(gltf.animations.map(a=>a.name));
 if(!PLAINSTRIDER_REQUIRED_CLIPS.every(c=>clips.has(c)))return false;
 return PLAINSTRIDER_REQUIRED_PARTS.every(n=>!!gltf.scene.getObjectByName(n));
}
export function plainstriderMotion({dead=false,attackCd=0,boss=false,moved=0,dt=1/60}={}){
 if(dead)return 'corpse';
 // The fight system uses a longer attack cooldown for the giant.
 if(attackCd>(boss?1.2:.95))return 'Peck';
 if(moved>Math.max(0.0002,dt*.08))return 'Walk';
 return 'Idle';
}
export function attachPlainstriderGltf(THREE,enemy,gltf){
 if(!validatePlainstriderGltf(gltf))throw Error('Original dolgonog GLB: rig or animation clips missing');
 const bird=gltf.scene.clone(true); // Geometry/material data are shared across all instances.
 const container=new THREE.Group();
 container.name='dolgonog-original-v0.1';
 container.scale.setScalar(PLAINSTRIDER_VISUAL_SCALE);
 container.add(bird);
 enemy.root.add(container);
 bird.traverse(o=>{
  if(o.isMesh){
   o.castShadow=/^(Body|Head|Neck|Wing)/.test(o.name);
   o.receiveShadow=false;
  }
 });
 // Hide all the old shapes, but retain gameplay/body/leg bookkeeping until
 // the complete wildlife physics system is decoupled from legacy poses.
 enemy.body.visible=false;
 for(const leg of enemy.legs)leg.visible=false;
 const mixer=new THREE.AnimationMixer(bird);
 const actions=Object.fromEntries(PLAINSTRIDER_REQUIRED_CLIPS.map(name=>[name,mixer.clipAction(gltf.animations.find(c=>c.name===name))]));
 enemy.birdVisual={container,bird,mixer,actions,mode:null};
 return enemy.birdVisual;
}
export function advancePlainstriderVisual(THREE,enemy,dt,moved=0,dead=false){
 const visual=enemy.birdVisual;if(!visual)return;
 const next=plainstriderMotion({dead,attackCd:enemy.attackCd,boss:enemy.boss,moved,dt});
 if(visual.mode!==next){
  visual.mixer.stopAllAction();
  visual.mode=next;
  if(next!=='corpse'){
   const action=visual.actions[next];
   action.reset();
   action.setLoop(next==='Peck'?THREE.LoopOnce:THREE.LoopRepeat,Infinity);
   action.clampWhenFinished=false;
   action.play();
  }
 }
 if(next!=='corpse')visual.mixer.update(Math.max(0,dt));
}
export function resetPlainstriderVisual(enemy){
 const visual=enemy.birdVisual;if(!visual)return;
 visual.mixer.stopAllAction();
 visual.mode=null;
}
