// Offline spherical NexGame systems. Use the unchanged production rules for items,
// abilities, hotbar, loot and dummy statistics; do not connect to multiplayer or saves.
import {HOTBAR_ART,HOTBAR_SHORT} from './native-hotbar-art.js?v=1';
import {ITEM_CATALOG,MERCHANT_STOCK,rollEquipmentLoot,deriveStats,itemStackLimit} from '../items.js?v=0.3.5.17';
import {getAbilityDefinition,createAbilityRuntime,tickAbilityRuntime,activateAbility,changeResource,WARRIOR_RAGE_PER_HIT,WARRIOR_RAGE_ON_HURT,WARRIOR_RAGE_DECAY} from '../skills.js?v=0.3.5';
import {DEFAULT_HOTBAR,normalizeHotbar,assignHotbarSlot,availableHotbarActions,actionDefinition} from '../hotbar.js?v=0.3.5.3';
import {TRAINING_DUMMY,createTrainingStats,applyTrainingHit,updateTrainingTarget} from '../training.js?v=0.3.5.1';
import {PLAINSTRIDER_REQUIRED_CLIPS,validatePlainstriderGltf,advancePlainstriderVisual,resetPlainstriderVisual,PLAINSTRIDER_VISUAL_SCALE} from '../plainstrider-model.js?v=0.3.7.0';
import {AXE_TUNER_DEFAULTS} from '../axe-tuner.js?v=0.3.7.0';
import {SWORD_TUNER_DEFAULTS} from '../sword-tuner.js?v=0.3.7.0';
import {DAGGER_TUNER_DEFAULTS} from '../dagger-tuner.js?v=0.3.7.0';
import {SHIELD_TUNER_DEFAULTS} from '../shield-tuner.js?v=0.3.7.0';
import {GATHER_QUESTS,OFFLINE_CHEST,createGatherWorld} from './gather-world.js?v=6';
import {createCampActions} from './camp-actions.js?v=6';
import {HIT_REACTION_SECONDS} from '../combat-feedback.js?v=0.3.7.0';
import {createSphereCombatFeedback} from './sphere-combat-feedback.js?v=1';
import {cycleHostileTarget,nearbyInteractable} from './interaction-targeting.js?v=4';
import {sphereFacingYaw,turnSphereYaw,sphereFacingError} from './mob-facing.js?v=1';
import {BOSS_POSITION,SCOUT_POSITION,RELIC_POSITION,QUEST_LINES,mentorChainNumber,mentorGlyph,mentorJournalRows,migrateMentorQuest,createMentorChain} from './mentor-chain.js?v=1';
import {createMentorWorld} from './mentor-world.js?v=1';
import {createSphericalTargetRing} from './spherical-target-ring.js?v=1';
import {animateSphericalTauren} from './tauren-animation.js?v=2';
import {incomingShieldHit,sphericalMeleeFacing,MELEE_ANIMATION_SECONDS,MELEE_IMPACT_SECONDS,attackProgress} from './sphere-combat.js?v=2';
import {applyWeaponQuality,itemRarity,QUALITY_VISUALS,highestLootRarity} from '../item-quality.js?v=0.3.7.1';
import {styleShieldGlb} from '../shield-assets.js?v=0.3.7.1';
import {canWalkCamp} from './sphere-physics.js?v=3';
import {createSphericalStomp} from './sphere-skill-effects.js?v=1';

const UP_AXIS=[0,1,0], TAU=Math.PI*2;
const SPAWNS=[[-9,-23],[1,-28],[13,-22],[21,-33],[-22,-35],[-28,29],[15,36],[48,9]];
const SAVE_KEY='nexgame-planet-test-offline-rpg-v1';
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pretty=num=>Number(num).toLocaleString('ru-RU',{maximumFractionDigits:1});
const LABEL={weapon:'Оружие',shield:'Щит',head:'Голова',chest:'Грудь',legs:'Ноги',hands:'Руки',waist:'Пояс',wrists:'Запястья',feet:'Ступни'};
const EQUIP_SLOTS=['weapon','shield','head','chest','legs','hands','waist','wrists','feet'];
const ICON={autoAttack:'⚔️',thunderStomp:'💥',heavyStrike:'🪓',healingPotion:'🧪'};
const initial=()=>({level:1,xp:0,gold:30,resource:0,hp:null,inventory:[{id:'wornAxe',qty:1},{id:'healingPotion',qty:3}],equipment:{},kills:0,quest:0,gatherStage:0,gatherAvailable:false,chestInventory:[],hotbar:DEFAULT_HOTBAR});
function restore(){
 try {
  const raw=JSON.parse(localStorage.getItem(SAVE_KEY));
  if(!raw||typeof raw!=='object')return initial();
  const safe=initial();
  safe.level=clamp(Math.floor(Number(raw.level)||1),1,30);
  safe.xp=clamp(Math.floor(Number(raw.xp)||0),0,999999);
  safe.gold=clamp(Math.floor(Number(raw.gold)||0),0,999999);
  safe.resource=clamp(Number(raw.resource)||0,0,100);
  safe.hp=raw.hp==null?null:Math.max(1,Number(raw.hp)||1);
  safe.kills=clamp(Math.floor(Number(raw.kills)||0),0,3);
  safe.quest=migrateMentorQuest(raw.quest);
  safe.gatherStage=clamp(Math.floor(Number(raw.gatherStage)||0),0,4);
  safe.gatherAvailable=!!raw.gatherAvailable&&safe.gatherStage>=2&&safe.gatherStage<=3;
  safe.chestInventory=Array.isArray(raw.chestInventory)?
   raw.chestInventory.slice(0,OFFLINE_CHEST.slots).filter(entry=>entry&&(ITEM_CATALOG[entry.id]||entry.id==='healingPotion')&&Number.isFinite(entry.qty)&&entry.qty>0)
    .map(entry=>({id:entry.id,qty:clamp(Math.floor(entry.qty),1,itemStackLimit(entry.id))})):[];
  safe.inventory=Array.isArray(raw.inventory)?raw.inventory.slice(0,12).filter(x=>x&&
   (ITEM_CATALOG[x.id]||x.id==='healingPotion')&&Number.isFinite(x.qty)&&x.qty>0).map(x=>({id:x.id,qty:Math.min(itemStackLimit(x.id),Math.floor(x.qty))})):safe.inventory;
  safe.equipment={};
  for(const slot of EQUIP_SLOTS){const id=raw.equipment?.[slot]?.id;if(ITEM_CATALOG[id]?.slot===slot)safe.equipment[slot]={id};}
  safe.hotbar=normalizeHotbar(raw.hotbar,'warrior',safe.level);
  return safe;
 }catch{return initial();}
}
export function createOfflineRpg({THREE,scene,hero,makeTauren,playerNormal,getRadius,toNormal,toLocal,heightAt,camera,canvas}){
 const state=restore(),runtime=createAbilityRuntime();
 const rightHand=hero.arms[1]?.hand,leftHand=hero.arms[0]?.hand;
 const modelSlots={weapon:null,shield:null};
 hero.root.userData.equipmentGrip={};
 hero.root.userData.weaponKind='none';
 const modelLoader=import('https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/loaders/GLTFLoader.js')
  .then(({GLTFLoader})=>new GLTFLoader()).catch(()=>null);
 let visualRequest=0;
 const radians=d=>d*Math.PI/180;
 async function updateEquipmentVisuals(){
  const request=++visualRequest;
  const weaponDef=ITEM_CATALOG[state.equipment.weapon?.id];
  const shieldDef=ITEM_CATALOG[state.equipment.shield?.id];
  const weaponKind=weaponDef?.weaponKind||null;
  const shieldKind=shieldDef?.rarity==='uncommon'||shieldDef?.rarity==='rare'?'kite':shieldDef?'round':null;
  hero.root.userData.weaponKind=weaponKind||'none';
  hero.root.userData.equipmentGrip={};
  for(const [slot,model] of Object.entries(modelSlots)){
   if(model){model.removeFromParent();modelSlots[slot]=null;}
  }
  if(rightHand)rightHand.rotation.set(0,0,0);
  if(leftHand)leftHand.rotation.set(0,0,0);
  const loader=await modelLoader;if(!loader||request!==visualRequest)return;
  const desired=[];
  if(weaponKind&&rightHand){
   const data={axe:['tauren-axe-v0.1.glb',AXE_TUNER_DEFAULTS,'axe'],sword:['plains-sword-v0.1.glb',SWORD_TUNER_DEFAULTS,'sword'],dagger:['steppe-dagger-v0.1.glb',DAGGER_TUNER_DEFAULTS,'dagger']}[weaponKind];
   if(data)desired.push(['weapon','../assets/weapons/'+data[0],data[1],data[2],rightHand]);
  }
  if(shieldKind&&leftHand){
   const name=shieldKind==='kite'?'nexgame_kite_shield_quality.glb':'nexgame_round_shield_poor.glb';
   desired.push(['shield','../assets/shields/'+name,SHIELD_TUNER_DEFAULTS[shieldKind],shieldKind,leftHand]);
  }
  for(const [slot,url,tuning,kind,hand] of desired){
   try{
    const gltf=await loader.loadAsync(url);
    if(request!==visualRequest)return;
    const mesh=gltf.scene;mesh.name='gear-'+(slot==='shield'?'shield':kind);
    mesh.position.set(tuning.posX,tuning.posY,tuning.posZ);
    const key=slot==='shield'?'shield':kind;
    mesh.rotation.set(radians(tuning[key+'X']),radians(tuning[key+'Y']),radians(tuning[key+'Z']),'YXZ');
    if(slot==='weapon')hand.rotation.set(radians(tuning.handX),radians(tuning.handY),radians(tuning.handZ),'XYZ');
    hand.add(mesh);modelSlots[slot]=mesh;
    const grip=hand.rotation;
    hero.root.userData.equipmentGrip[slot]={x:grip.x,y:grip.y,z:grip.z,order:grip.order};
    if(slot==='weapon')applyWeaponQuality(THREE,hero.root,kind,weaponDef?.rarity);
    if(slot==='shield')styleShieldGlb(THREE,mesh,shieldDef?.rarity);
   }catch(err){console.warn('Planet equipment model unavailable',url,err);}
  }
 }

 let target=null,autoplay=false,swing=0,clock=0,messageUntil=0,pendingLoot=null,chooseSlot=-1,gatherCast=null,
  attackRemaining=0,stompPulse=0,blockRemaining=0;
 const pendingHits=[];
 let lastCombatAt=-100;
 function inCombat(){
  return pendingHits.length>0||mobs.some(m=>m.root.visible&&m.hp>0&&!m.corpse&&m.aggro);
 }
 let journalTab='current';
 const group=new THREE.Group();scene.add(group);
 // The mesh is bent vertex-by-vertex onto the actual spherical terrain:
 // no texture intersection/z-fighting and a saturated red outline.
 const targetRing=createSphericalTargetRing({THREE,parent:group,getRadius,toNormal,heightAt});
 const stompEffect=createSphericalStomp({THREE,parent:group,getRadius,heightAt});
 const up=new THREE.Vector3(...UP_AXIS),anchorQuat=new THREE.Quaternion(),spinQuat=new THREE.Quaternion();
 const mobs=[],entities=[],citizens=[];
 const hotbar=$('actionsBar'),modal=$('modal'),toast=$('toast');
 const feedbackLayer=$('combatFeedback');
 if(!feedbackLayer)throw Error('Отсутствует слой чисел урона');
 const combatFeedback=createSphereCombatFeedback({THREE,document,camera,layer:feedbackLayer});
 const nameEl=$('playerName'),objective=$('qtext');
 const originalControls=$('labSettingsSources');
 const settingsControls=[...originalControls.children];
 if(!hotbar||!modal||!toast||!nameEl||!$('playerFrame')||!$('minimap'))throw Error('Не загружен оригинальный интерфейс NexGame');
 const bind=(el,ev,fn)=>el.addEventListener(ev,fn);
 const stats=()=>deriveStats(state.level,state.equipment);
 if(state.hp==null)state.hp=stats().maxHp;
 function persist(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(state))}catch{}}
 function msg(text,seconds=2.35){
  toast.textContent=text;toast.hidden=false;toast.classList.add('show');
  messageUntil=clock+Math.min(4,Math.max(1,seconds));
 }
 function setModelAt(entity){
  const normal=toNormal(entity.x,entity.z,getRadius());
  entity.root.position.copy(normal).multiplyScalar(getRadius()+heightAt(normal)+.09);
  anchorQuat.setFromUnitVectors(up,normal);
  entity.root.quaternion.copy(anchorQuat).multiply(spinQuat.setFromAxisAngle(up,entity.yaw||0));
  if(entity.kind==='mob'&&entity.corpse)entity.root.rotateX(1.15);
 }
 // Identical native NexGame spriteText typography and palette, no backdrop.
 function makeLabel(name,color='#f9df91',size=32){
  const canvasLabel=document.createElement('canvas');canvasLabel.width=512;canvasLabel.height=96;
  const ctx=canvasLabel.getContext('2d');
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='bold '+size+'px Georgia';
  ctx.lineWidth=5;ctx.strokeStyle='#302817';ctx.fillStyle=color;
  ctx.strokeText(String(name).slice(0,42),256,48);
  ctx.fillText(String(name).slice(0,42),256,48);
  const texture=new THREE.CanvasTexture(canvasLabel);texture.colorSpace=THREE.SRGBColorSpace;
  const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,depthWrite:false,transparent:true}));
  sprite.scale.set(4.3,.81,1);
  return sprite;
 }
 function npc(kind,x,z,name){
  const root=new THREE.Group();root.name='planet-'+kind;group.add(root);
  // Full procedurally modelled Tauren identical to the playable hero.
  // Match the original NexGame NPC materials and scale.
  const looks={
   mentor:{fur:0x725438,clothColor:0x427b70,scale:.95},
   vendor:{fur:0x665043,clothColor:0x987046,scale:.94},
   herbalist:{fur:0x978064,clothColor:0x9d7d50,scale:.89}
  };
  const appearance=looks[kind]||looks.mentor;
  const npcActor=makeTauren(appearance);
  npcActor.root.scale.setScalar(appearance.scale);
  root.add(npcActor.root);
  const tag=makeLabel(name,'#d9e2a1',25);tag.position.y=4.45;root.add(tag);
  const e={kind,name,x,z,yaw:.2,root,radius:1.5,actor:npcActor};entities.push(e);citizens.push(e);setModelAt(e);return e;
 }
 const mentor=npc('mentor',-1.5,-5,'Наставник Каменный Рог');
 for(const glyph of ['!','?','·']){
  const marker=makeLabel(glyph,glyph==='·'?'#b4b395':'#ffe180',72);
  marker.position.y=5.45;marker.scale.set(2.5,1.6,1);
  marker.userData.questMarker=true;marker.userData.glyph=glyph;
  mentor.root.add(marker);
 }
 const vendor=npc('vendor',6,11,'Борун Крепкая Ладонь');
 const merchantLabel=makeLabel('Оружие и доспехи','#e5c574',23);
 merchantLabel.position.y=3.85;vendor.root.add(merchantLabel);
 const herbalist=npc('herbalist',8,1,'Травница Тихая Заря');
 const herbMarker=makeLabel('!','#ffe180',72),herbTurnin=makeLabel('?','#ffe180',72);
 for(const [glyph,sprite] of [['!',herbMarker],['?',herbTurnin]]){
  sprite.position.y=5.65;sprite.scale.set(2.5,1.48,1);
  sprite.userData.questMarker=true;sprite.userData.glyph=glyph;
  herbalist.root.add(sprite);
 }
 // Shared radial ground-shadow texture. Only one transparent plane per mob.
 const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;
 const shadowContext=shadowCanvas.getContext('2d');
 const shadowGradient=shadowContext.createRadialGradient(32,32,2,32,32,32);
 shadowGradient.addColorStop(0,'rgba(12,24,16,0.36)');
 shadowGradient.addColorStop(.5,'rgba(12,24,16,0.22)');
 shadowGradient.addColorStop(1,'rgba(12,24,16,0)');
 shadowContext.fillStyle=shadowGradient;shadowContext.fillRect(0,0,64,64);
 const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
 const shadowGeometry=new THREE.PlaneGeometry(2.7,2.3);
 const shadowMaterial=new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false,side:THREE.DoubleSide});
 function addContactShadow(parent,scale=1){
  const shadow=new THREE.Mesh(shadowGeometry,shadowMaterial);
  shadow.rotation.x=-Math.PI/2;shadow.position.y=.06;
  shadow.scale.setScalar(scale);shadow.renderOrder=1;parent.add(shadow);
  return shadow;
 }
 function createBird(x,z,i){
  const root=new THREE.Group();group.add(root);
  const contactShadow=addContactShadow(root);
  const mat=new THREE.MeshStandardMaterial({color:i%2?'#917044':'#826649',roughness:1});
  const body=new THREE.Mesh(new THREE.SphereGeometry(1,12,9),mat);
  body.scale.set(.58,.48,.8);body.position.y=1.25;root.add(body);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.13,.19,.9,7),mat);neck.position.set(0,1.83,.57);neck.rotation.x=.45;root.add(neck);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.28,9,7),mat);head.position.set(0,2.25,.74);root.add(head);
  const beak=new THREE.Mesh(new THREE.ConeGeometry(.18,.5,7),new THREE.MeshStandardMaterial({color:'#d5b16f'}));
  beak.rotation.x=Math.PI/2;beak.position.set(0,2.17,1.1);root.add(beak);
  for(const side of [-1,1]){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.08,.075,1.2,6),mat);leg.position.set(side*.25,.6,0);root.add(leg);}
  const entity={kind:'mob',index:i,name:'Равнинный долгоног',root,x,z,yaw:.1,
   spawnX:x,spawnZ:z,hp:54,maxHp:54,aggro:false,attackCd:1.2,stun:0,dead:0,loot:null,corpse:false,
   respawn:0,returning:false,walk:0,visual:null,hit:0,attackWindup:0,alertRemaining:0,corpseAge:0,boss:false,contactShadow,roamTime:i*1.73};
  const tag=makeLabel(entity.name,'#f9df91',26);tag.position.y=4.25;root.add(tag);
  const alertTag=makeLabel('!','#ffc978',78);
  alertTag.position.y=4.95;alertTag.scale.set(1.55,1.4,1);alertTag.visible=false;
  root.add(alertTag);entity.alertTag=alertTag;
  const lootMarker=makeLabel('◆','#ffffff',68);
  lootMarker.position.y=1.58;lootMarker.scale.set(1.3,1.06,1);
  lootMarker.material.opacity=.95;lootMarker.visible=false;
  root.add(lootMarker);entity.lootMarker=lootMarker;
  mobs.push(entity);entities.push(entity);setModelAt(entity);return entity;
 }
 SPAWNS.forEach(([x,z],i)=>createBird(x,z,i));
 // The original Narache elite uses the same GLB at 1.8× scale.
 const giant=createBird(BOSS_POSITION.x,BOSS_POSITION.z,mobs.length);
 giant.name='Грозоклюв — огромный долгоног';giant.boss=true;
 giant.hp=giant.maxHp=108;giant.root.scale.setScalar(1.8);
 const oldTag=giant.root.children.find(child=>child.isSprite&&child!==giant.alertTag);
 if(oldTag)oldTag.visible=false;
 const bossTag=makeLabel('Грозоклюв · Исполин','#f9bd91',27);
 bossTag.position.y=3.4;bossTag.scale.set(4.7,.84,1);
 giant.root.add(bossTag);giant.alertTag.position.y=4.0;
 const dummyRoot=new THREE.Group();group.add(dummyRoot);addContactShadow(dummyRoot,1.1);
 const straw=new THREE.MeshStandardMaterial({color:'#bb9665',roughness:1});
 const dummyBody=new THREE.Mesh(new THREE.CylinderGeometry(.56,.63,2.2,12),straw);
 dummyBody.position.y=1.45;dummyRoot.add(dummyBody);
 for(const s of [-1,1]){const arm=new THREE.Mesh(new THREE.CylinderGeometry(.16,.16,1.65,8),straw);arm.rotation.z=Math.PI/2;arm.position.set(s*.7,2.2,0);dummyRoot.add(arm);}
 const dummyTag=makeLabel(TRAINING_DUMMY.name,'#f4dfa6',26);dummyTag.position.y=4.04;dummyTag.scale.set(4.7,.82,1);dummyRoot.add(dummyTag);
 const dummy={kind:'dummy',name:TRAINING_DUMMY.name,root:dummyRoot,x:TRAINING_DUMMY.x,z:TRAINING_DUMMY.z,
  yaw:0,trainingDummy:true,maxHp:TRAINING_DUMMY.maxHp,hp:TRAINING_DUMMY.maxHp,trainingStats:createTrainingStats()};
 entities.push(dummy);setModelAt(dummy);
 // Preserve original locations in metres and project every mesh onto the sphere.
 const gathering=createGatherWorld({THREE,parent:group,place:e=>{entities.push(e);setModelAt(e);}});
 const gatherNodes=gathering.nodes;
 const chestLabel=makeLabel('Общий сундук · 18','#ffe0a0',24);
 chestLabel.position.y=5.4;gathering.chest.root.add(chestLabel);
 const mentorWorld=createMentorWorld({THREE,parent:group,
  place:e=>{entities.push(e);setModelAt(e);},getRadius,toNormal,heightAt});
 // Use the exact approved longstrider model and clips when the shared GLB loads.
 // Procedural fallback remains available if the CDN or asset fails.
 void (async()=>{
  try{
   const loader=await modelLoader;
   if(!loader)throw Error('GLTFLoader unavailable');
   const asset=await loader.loadAsync('../bestiary/models/dolgonog-v0.1.glb?v=0.3.5.43');
   if(!validatePlainstriderGltf(asset))throw Error('Unexpected Dolgonog clips');
   for(const mob of mobs){
    const bird=asset.scene.clone(true);
    const container=new THREE.Group();container.name='dolgonog-original-v0.1';
    container.scale.setScalar(PLAINSTRIDER_VISUAL_SCALE);
    container.add(bird);mob.root.add(container);
    for(const child of [...mob.root.children])if(child.isMesh&&child!==mob.contactShadow)child.visible=false;
    bird.traverse(obj=>{if(obj.isMesh){obj.castShadow=/^(Body|Head|Neck|Wing)/.test(obj.name);obj.receiveShadow=false;}});
    const mixer=new THREE.AnimationMixer(bird);
    const actions=Object.fromEntries(PLAINSTRIDER_REQUIRED_CLIPS.map(k=>[k,mixer.clipAction(asset.animations.find(a=>a.name===k))]));
    mob.birdVisual={container,bird,mixer,actions,mode:null,walkGrace:0,attackRemaining:0,lastAttackCd:mob.attackCd};
    advancePlainstriderVisual(THREE,mob,1/60,0,!!mob.corpse);
   }
  }catch(err){console.warn('Planet offline Dolgonog fallback:',err);}
 })();
 // Smooth original NexGame GLB Idle, Walk, Peck and hit reactions.
 function birdAnimation(mob,dt,moved=0){
  if(mob.birdVisual)advancePlainstriderVisual(THREE,mob,dt,moved,!!mob.corpse);
 }
 function player(){return toLocal(playerNormal(),getRadius());}
 function distance(entity){
  const a=playerNormal(),b=toNormal(entity.x,entity.z,getRadius());
  return getRadius()*Math.acos(clamp(a.dot(b),-1,1));
 }
 function updateSelection(){targetRing.update(target);}
 function addItem(id,qty=1){
  if(!ITEM_CATALOG[id]&&id!=='healingPotion')return false;
  const cap=itemStackLimit(id);
  let left=qty;
  for(const slot of state.inventory){if(slot.id===id&&slot.qty<cap){const n=Math.min(left,cap-slot.qty);slot.qty+=n;left-=n;}}
  while(left>0&&state.inventory.length<12){const n=Math.min(left,cap);state.inventory.push({id,qty:n});left-=n;}
  persist();return left===0;
 }
 function takeItem(id,qty=1){
  let remaining=qty;
  for(let i=state.inventory.length-1;i>=0&&remaining>0;i--){
   const item=state.inventory[i];if(item.id!==id)continue;
   const n=Math.min(remaining,item.qty);item.qty-=n;remaining-=n;
   if(!item.qty)state.inventory.splice(i,1);
  }
  if(remaining===0)persist();return remaining===0;
 }
 const itemCount=id=>state.inventory.filter(x=>x.id===id).reduce((sum,x)=>sum+x.qty,0);
 const camp=createCampActions({state,herbalist,gathering,mobs,hero,distance,addItem,takeItem,
  itemCount,persist,levelCheck,draw,openWindow,closeWindow,msg,getClock:()=>clock});
 const mentorChain=createMentorChain({state,persist,levelCheck,closeWindow,draw,msg});
 function equip(id){
  const def=ITEM_CATALOG[id];if(!def?.slot||!LABEL[def.slot])return msg('Предмет нельзя экипировать');
  if(state.level<(def.requiredLevel||1))return msg('Требуется '+def.requiredLevel+' уровень');
  if(!itemCount(id))return;
  const previous=state.equipment[def.slot]?.id;
  // Removing the new piece from inventory frees room for the old piece.
  if(!takeItem(id))return;
  if(previous)addItem(previous);
  const maxBefore=stats().maxHp;
  state.equipment[def.slot]={id};
  state.hp=Math.min(stats().maxHp,state.hp+Math.max(0,stats().maxHp-maxBefore));
  persist();draw();void updateEquipmentVisuals();msg('Надето: '+def.name);
 }
 function updateLootMarker(mob){
  if(!mob?.lootMarker)return;
  const available=mob.corpse&&mob.root.visible&&mob.loot?.length>0;
  mob.lootMarker.visible=!!available;
  if(!available)return;
  const rarity=highestLootRarity(mob.loot,ITEM_CATALOG);
  mob.lootMarker.material.color.setHex(QUALITY_VISUALS[rarity].marker);
  mob.lootMarker.userData.rarity=rarity;
 }
 function lootMob(mob){
  if(!mob?.corpse||!mob.loot)return;
  const remaining=[];
  for(const item of mob.loot){if(addItem(item.id,item.qty)){msg('Получено: '+(ITEM_CATALOG[item.id]?.name||item.id));}
   else remaining.push(item);}
  mob.loot=remaining;
  updateLootMarker(mob);
  if(!remaining.length){mob.corpse=false;mob.root.visible=false;mob.respawn=12;target=null;updateSelection();}
  draw();
 }
 function targetEntity(entity){
  if(entity&&!['mob','dummy'].includes(entity.kind))entity=null;
  if(entity&&(entity.hp<=0||entity.dead||!entity.root.visible))entity=null;
  if(target!==entity)autoplay=false;
  target=entity;
  updateSelection();draw();
 }
 function targetNearest(step=1){
  if(!modal.hidden)return;
  // The production target cycle searches living hostiles within 40 m,
  // not nearby NPCs, collectibles or chests.
  const next=cycleHostileTarget(mobs,dummy,target,distance,step);
  if(next){targetEntity(next);}
  else if(!target)msg('В радиусе 40 м нет противников');
 }
 function nearestInteraction(){
  return nearbyInteractable(entities,distance,camp.available);
 }
 function openWindow(kind){
  if(kind!=='gatherLoot')camp.cancel();
  modal.hidden=false;modal.dataset.kind=kind;renderModal();
 }
 function closeWindow(){modal.hidden=true;}
 function interact(){
  if(!modal.hidden||camp.casting)return;
  // Approach alone enables NPC dialogue, gathering, storage and corpse loot.
  // It never requires a selected combat target.
  const nearby=nearestInteraction();
  if(!nearby)return msg('Подойди к жителю или предмету ближе');
  if(camp.interact(nearby)){draw();return;}
  if(nearby.kind==='mentor')openWindow('mentor');
  else if(nearby.kind==='relic')mentorChain.pickedRelic();
  else if(nearby.kind==='vendor')openWindow('merchant');
  else if(nearby.kind==='mob'&&nearby.corpse)lootMob(nearby);
  draw();
 }
 function levelCheck(){
  while(state.xp>=state.level*100){
   state.xp-=state.level*100;state.level++;
   const oldMax=stats().maxHp;state.hp=oldMax;msg('Новый уровень: '+state.level+'!');
  }
  state.hotbar=normalizeHotbar(state.hotbar,'warrior',state.level);persist();
 }
 function harm(enemy,damage,skill='autoAttack'){
  if(!enemy||!enemy.root.visible)return;
  if(enemy.kind==='dummy'){applyTrainingHit(enemy,damage,clock,skill);combatFeedback.hit(enemy,damage,skill);draw();return;}
  if(enemy.kind!=='mob'||enemy.dead)return;
  lastCombatAt=clock;enemy.hp=Math.max(0,enemy.hp-damage);enemy.aggro=true;enemy.returning=false;enemy.hit=HIT_REACTION_SECONDS;
  combatFeedback.hit(enemy,damage,skill);
  state.resource=changeResource(state.resource,WARRIOR_RAGE_PER_HIT,'warrior');
  if(enemy.hp===0){
   enemy.dead=6;enemy.corpse=true;enemy.aggro=false;enemy.attackCd=0;enemy.attackWindup=0;autoplay=false;
   setModelAt(enemy);birdAnimation(enemy,1/60,0);
   enemy.loot=[{id:'feather',qty:1}];
   if(Math.random()<.38)enemy.loot.push({id:Math.random()<.6?'beak':'down',qty:1});
   if(enemy.boss)enemy.loot.push({id:'giantFeather',qty:1});
   const gear=rollEquipmentLoot(!!enemy.boss);if(gear)enemy.loot.push(gear);
   updateLootMarker(enemy);
   state.xp+=enemy.boss?70:22;state.gold+=enemy.boss?12:4;
   levelCheck();mentorChain.killed(enemy);
   if(!enemy.boss)msg('Долгоног повержен · доступна добыча');
   persist();
  }
  draw();
 }
 function facesTarget(enemy){
  if(!enemy)return false;
  return sphericalMeleeFacing(THREE,playerNormal(),hero.root,
   toNormal(enemy.x,enemy.z,getRadius()));
 }
 function hitEnemy(enemy,bonus=0,skill='autoAttack'){
  if(!enemy||!['mob','dummy'].includes(enemy.kind)||enemy.dead||!enemy.root.visible)return msg('Нет подходящей цели');
  if(distance(enemy)>3.45)return msg('Цель слишком далеко');
  // Use the same .8 s model swing as production and apply damage at
  // 340 ms (0.425 animation progress). A player changing weapons keeps
  // the combat timeline, just as it does in the original game.
  const s=stats(),damage=s.damageMin+Math.random()*(s.damageMax-s.damageMin)+bonus;
  lastCombatAt=clock;pendingHits.push({enemy,damage,skill,remaining:MELEE_IMPACT_SECONDS});
  attackRemaining=MELEE_ANIMATION_SECONDS;
 }
 function useAbility(slot){
  const entry=state.hotbar[slot],action=actionDefinition(entry,'warrior',state.level);
  if(!action)return msg('Пустая ячейка');
  const def=getAbilityDefinition(action.abilityId),d=target?distance(target):Infinity;
  if(action.id==='autoAttack'){
   if(autoplay){autoplay=false;draw();return;}
   // Match main NexGame: pressing autoattack can acquire a living hostile
   // even if the user hasn't clicked the target-cycle button yet.
   if(!target||target.hp<=0||target.dead||!target.root.visible){
    const found=cycleHostileTarget(mobs,dummy,null,distance);
    if(!found)return msg('В радиусе 40 м нет противников');
    target=found;
   }
   if(distance(target)>20){msg('Цель слишком далеко — подойди на 20 м');draw();return;}
   autoplay=true;swing=0;
   draw();return;
  }
  const ctx={runtime,classId:'warrior',level:state.level,resource:state.resource,
   hasTarget:!!target&&['mob','dummy'].includes(target.kind)&&!target.dead,range:d,facing:!target||facesTarget(target),
   hasConsumable:itemCount('healingPotion')>0,needsHealing:state.hp<stats().maxHp};
  const result=activateAbility(def,ctx);
  if(!result.ok)return msg(result.error);
  state.resource=result.resource;
  if(action.id==='healingPotion'){takeItem('healingPotion');state.hp=Math.min(stats().maxHp,state.hp+55);msg('Здоровье восстановлено');}
  else if(action.id==='heavyStrike')hitEnemy(target,def.damageBonus||8,action.id);
  else if(action.id==='thunderStomp'){
   stompPulse=.55;stompEffect.trigger(playerNormal());
   let hits=0;for(const mob of mobs)if(!mob.dead&&distance(mob)<4.5){mob.stun=2.5;harm(mob,6,action.id);hits++;}
   msg('Громовая поступь: '+hits+' целей');
  }
  persist();draw();
 }
 function draw(refreshInteractive=true){
  const s=stats();state.hp=clamp(state.hp,0,s.maxHp);
  nameEl.textContent='Странник';$('levelBadge').textContent=state.level;
  $('className').textContent='Таурен · Воин';
  $('hpFill').style.width=clamp(state.hp/s.maxHp*100,0,100)+'%';
  $('hpText').textContent=Math.ceil(state.hp)+' / '+s.maxHp;
  $('rageFill').style.width=state.resource+'%';
  $('rageText').textContent='Ярость '+Math.floor(state.resource)+' / 100';
  $('resourceBar').setAttribute('aria-valuenow',Math.floor(state.resource));
  $('combatState').textContent=inCombat()?'В бою':
   state.hp<s.maxHp?(clock-lastCombatAt<5?'Отдых после боя':'Восстановление'):'Готов к бою';
  $('xpFill').style.width=Math.min(100,state.xp/(state.level*100)*100)+'%';
  $('xpText').textContent='Опыт '+state.xp+' / '+(state.level*100);
  const hostile=target&&['mob','dummy'].includes(target.kind)&&target.root.visible&&target.hp>0&&!target.dead;
  $('targetFrame').hidden=!hostile;$('targetPlaceholder').hidden=!!hostile;
  if(hostile){
    $('targetName').textContent=target.boss?'Грозоклюв · 5 · Элитный':target.name;
    $('targetFill').style.width=clamp(target.hp/target.maxHp*100,0,100)+'%';
    $('targetHp').textContent=Math.ceil(target.hp)+' / '+target.maxHp;
    $('targetDistance').textContent='Дистанция: '+pretty(distance(target))+' м';
    $('targetStatus').textContent=target.corpse?'Доступна добыча':autoplay?'Автоатака':'Нажми 1 для автоатаки';
    $('dummyStats').hidden=target.kind!=='dummy';
  }
  const stage=state.quest,lines=QUEST_LINES[stage]||QUEST_LINES[12];
  objective.textContent=stage===1?'Победи долгоногов: '+state.kills+' / 3':lines[1];
  $('qtitle').textContent=lines[0];
  $('mainQuestTracker').hidden=stage===12;
  $('quest-progress').textContent=stage===12?'Цепочка · 5 / 5 ✓':'Цепочка · '+mentorChainNumber(stage)+' / 5';
  const guidance=$('questGuidance');
  guidance.hidden=stage!==7&&stage!==10;
  if(stage===7)guidance.textContent='Разведка: найди каменную развилку (12, 37).';
  if(stage===10)guidance.textContent='Красный пунктир ведёт к Грозоклюву · 108 HP';
  const glyph=mentorGlyph(state.quest);
  for(const child of mentor.root.children)if(child.userData.questMarker)child.visible=child.userData.glyph===glyph;
  const nearby=modal.hidden&&!camp.casting?nearestInteraction():null;
  $('interact').hidden=!nearby;
  if(nearby)$('interact').textContent=nearby.kind==='gather'?
    (nearby.pending?'Забрать':'Собрать'):nearby.kind==='relic'?'Взять перо':nearby.kind==='chest'?'Открыть сундук':
    nearby.kind==='mob'?'Обыскать':nearby.kind==='vendor'?'Торговец':'Поговорить';
  $('targetNext')?.classList.toggle('target-selected',!!target&&target.hp>0&&!target.dead);
  if(refreshInteractive){
  hotbar.replaceChildren();
  state.hotbar.forEach((entry,i)=>{
   const button=document.createElement('button');button.type='button';button.dataset.slot=String(i);
   button.className='ability';button.title=entry?.id||'Назначить умение';
   const key=document.createElement('kbd');key.textContent=String(i+1);
   const icon=document.createElement('span');icon.className='planetAbilityIcon';if(entry&&HOTBAR_ART[entry.id])icon.innerHTML=HOTBAR_ART[entry.id];else icon.textContent='＋';
   const caption=document.createElement('span');caption.className='planetAbilityName';
   const entryDef=entry?actionDefinition(entry,'warrior',state.level):null;
   caption.textContent=entry?HOTBAR_SHORT[entry.id]||entryDef?.name||'Умение':'Пусто';
   const cooldownShade=document.createElement('span');cooldownShade.className='planetCooldownShade';
   const gcdShade=document.createElement('span');gcdShade.className='planetGcdShade';
   const cooldownText=document.createElement('span');cooldownText.className='planetCooldownText';
   button.append(key,icon,caption,cooldownShade,gcdShade,cooldownText);
   button.classList.toggle('is-empty',!entry);
   if(entry?.id==='autoAttack'&&autoplay)button.classList.add('is-active');
   const ability=entry?getAbilityDefinition(entry.id==='healingPotion'?'healingPotion':entry.id):null;
   if(ability?.cooldown&&runtime.cooldowns[ability.id]>0)button.classList.add('is-cooldown');
   button.addEventListener('click',()=>{if(chooseSlot>=0){chooseSlot=i;openWindow('spells');}else useAbility(i)});
   hotbar.append(button);
  });
  if(!modal.hidden)renderModal();
  }
  // Don't destroy pressed buttons during each 200ms HUD refresh.
  for(const [i,entry] of state.hotbar.entries()){
   const button=hotbar.children[i];if(!button)continue;
   const def=entry?getAbilityDefinition(entry.id):null;
   const remain=def?(runtime.cooldowns[def.id]||0):0,ratio=def?.cooldown?clamp(remain/def.cooldown,0,1):0;
   const shade=button.querySelector('.planetCooldownShade');
   const cd=button.querySelector('.planetCooldownText');
   const gcd=button.querySelector('.planetGcdShade');
   if(shade)shade.style.height=(ratio*100).toFixed(2)+'%';
   if(cd)cd.textContent=remain>0?remain>=10?String(Math.ceil(remain)):remain.toFixed(1):'';
   if(gcd)gcd.style.transform='scaleY('+(def?.gcd?clamp(runtime.gcd/1.5,0,1):0)+')';
   button.classList.toggle('is-cooldown',remain>0);
   button.classList.toggle('is-active',entry?.id==='autoAttack'&&autoplay);
  }
 }
 function renderModal(){
  const kind=modal.dataset.kind,title=$('mtitle'),body=$('mbody');
  $('panel').classList.toggle('character-modal',kind==='character');
  $('panel').classList.toggle('inventory-modal',kind==='bag');
  $('msub').textContent='NEXGAME · ОФЛАЙН · КРУГЛЫЙ МИР';
  $('cameraControl').hidden=kind!=='menu';
  title.textContent=({bag:'Рюкзак',character:'Персонаж',quests:'Журнал заданий',
   merchant:'Торговец',spells:'Книга способностей',loot:'Добыча',menu:'Меню',herbalist:'Травница Тихая Заря',chest:'Сундук',gatherLoot:'Собранный ресурс',mentor:'Наставник Каменный Рог'})[kind]||'NexGame';
  body.replaceChildren();
  const line=(label,caption,actions=[])=>{
   const row=document.createElement('div');row.className='rpgRow';
   const name=document.createElement('div');name.innerHTML='<strong></strong><small></small>';
   name.querySelector('strong').textContent=label;name.querySelector('small').textContent=caption;
   row.append(name);for(const [caption,fn] of actions){const b=document.createElement('button');b.type='button';b.textContent=caption;b.addEventListener('click',fn);row.append(b);}
   body.append(row);
  };
  if(camp.render(kind,body,line))return;
  if(kind==='mentor'){mentorChain.render(line);return;}
  if(kind==='menu'){
   line('Сферический мир','Меняй радиус планеты, вращай её свайпами и проверяй оригинальную NexGame.');
   for(const item of settingsControls)body.append(item);
   line('Сетевая игра','Тестовая сборка работает локально, без сервера Render.');
  }else if(kind==='bag'){
    const summary=document.createElement('div');summary.className='inventory-summary';
    summary.textContent='Ячейки '+state.inventory.length+' / 12 · Монеты '+pretty(state.gold)+' · Настои '+itemCount('healingPotion');
    const grid=document.createElement('div');grid.className='inventory-grid';
    const detail=document.createElement('div');detail.className='inventory-detail';
    detail.textContent='Нажми на предмет, чтобы узнать подробности.';
    for(let i=0;i<12;i++){
      const item=state.inventory[i],def=item&&ITEM_CATALOG[item.id];
      const cell=document.createElement('button');cell.type='button';
      cell.className='inventory-slot'+(item?' occupied':' empty');
      if(def){cell.classList.add('rarity-'+itemRarity(def.rarity));
       cell.style.setProperty('--item-quality-color',QUALITY_VISUALS[itemRarity(def.rarity)].color);}
      cell.setAttribute('aria-label',item?(def?.name||'Лечебный настой'):'Пустая ячейка '+(i+1));
      if(item){
        const icon=document.createElement('span');icon.className='slot-icon';icon.textContent=def?.icon||'🧪';
        const qty=document.createElement('span');qty.className='slot-count';qty.textContent=item.qty>1?item.qty:'';
        cell.append(icon,qty);
        cell.addEventListener('click',()=>{
          detail.replaceChildren();
          const name=document.createElement('strong');name.textContent=def?.name||'Лечебный настой';
     if(def)name.style.color=QUALITY_VISUALS[itemRarity(def.rarity)].color;
          const description=document.createElement('p');description.textContent=def?.description||'Восстанавливает здоровье';
          detail.append(name,description);
          const commands=[...(def?.slot?[['Надеть',()=>equip(item.id)]]:[]),
            ['🗑 Удалить',()=>{takeItem(item.id,1);draw();}]];
          for(const [label,action] of commands){
            const b=document.createElement('button');b.type='button';b.className='choice';b.textContent=label;
            b.addEventListener('click',action);detail.append(b);
          }
          for(const el of grid.children)el.classList.remove('active');
          cell.classList.add('active');
        });
      }else{const dot=document.createElement('span');dot.className='slot-empty-mark';dot.textContent='·';cell.append(dot);}
      grid.append(cell);
    }
    body.append(summary,grid,detail);
  }else if(kind==='character'){
    const values=stats(),summary=document.createElement('div');summary.className='inventory-summary';
    summary.textContent='Таурен · Воин · '+state.level+' ур. · '+state.xp+'/'+state.level*100+' опыта · '+pretty(state.gold)+' монет';
    body.append(summary);
    const statsBlock=document.createElement('dl');statsBlock.className='character-stats';
    for(const [name,value] of [['Сила',values.strength],['Выносливость',values.stamina],['Броня',values.armor]]){
      const cell=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');
      dt.textContent=name;dd.textContent=value;cell.append(dt,dd);statsBlock.append(cell);
    }
    body.append(statsBlock);
    const gear=document.createElement('div');gear.className='planetEquipmentGrid';
    for(const slot of EQUIP_SLOTS){
      const id=state.equipment[slot]?.id,def=ITEM_CATALOG[id];
      const btn=document.createElement('button');btn.type='button';
      btn.className='equipment-slot'+(def?' equipped':'');
      const icon=document.createElement('span');icon.textContent=def?.icon||'◇';icon.style.fontSize='25px';
      const caption=document.createElement('small');caption.textContent=LABEL[slot]+': '+(def?.name||'Пусто');
      btn.append(icon,caption);btn.title=def?'Снять '+def.name:LABEL[slot];
      if(def)btn.addEventListener('click',()=>{
        if(state.inventory.length>=12)return msg('Сумка заполнена');
        addItem(id);delete state.equipment[slot];state.hp=Math.min(state.hp,stats().maxHp);
        persist();draw();void updateEquipmentVisuals();
      });
      gear.append(btn);
    }
    body.append(gear);
    line('Урон и здоровье',pretty(values.damageMin)+'–'+pretty(values.damageMax)+' урона · '+Math.ceil(state.hp)+' / '+values.maxHp+' HP');
  }else if(kind==='quests'){
   const tabs=document.createElement('div');tabs.className='planet-journal-tabs';tabs.setAttribute('role','tablist');
   const labels={current:'Текущие',available:'Доступные',completed:'Выполненные'};
   for(const [tab,label] of Object.entries(labels)){
    const button=document.createElement('button');button.type='button';button.className='choice'+(journalTab===tab?' is-selected':'');
    button.setAttribute('role','tab');button.setAttribute('aria-selected',String(journalTab===tab));
    button.textContent=label;button.addEventListener('click',()=>{journalTab=tab;renderModal();});tabs.append(button);
   }
   body.append(tabs);
   const entries=mentorJournalRows(state).map(item=>({...item,npc:'Наставник Каменный Рог'}));
   for(let i=1;i<=3;i++){
    const quest=GATHER_QUESTS[i],stage=state.gatherStage;
    const status=stage>i?'completed':stage===i?(state.gatherAvailable?'available':'current'):i===1&&stage===0?'available':null;
    if(!status)continue;
    const count=status==='completed'?quest.count:state.inventory.filter(entry=>entry.id===quest.item).reduce((sum,entry)=>sum+entry.qty,0);
    entries.push({id:'gather-'+i,status,title:quest.title,
     objective:'Собрать '+quest.count+' шт.: '+(ITEM_CATALOG[quest.item]?.name||quest.item),
     progress:status==='completed'?'Сдано травнице':status==='available'?'Доступно у травницы':'Собрано '+count+' / '+quest.count,
     reward:quest.gold+' монет · '+quest.xp+' опыта',npc:'Травница Тихая Заря'});
   }
   const visible=entries.filter(entry=>entry.status===journalTab);
   for(const entry of visible)line((entry.status==='completed'?'✓ ':entry.status==='available'?'! ':'• ')+entry.title,
    entry.objective+' · '+entry.progress+(entry.reward?' · '+entry.reward:'')+' · '+entry.npc);
   if(!visible.length)line('Пока пусто','В этом разделе заданий пока нет.');
  }else if(kind==='merchant'){
   line('Борун Крепкая Ладонь','Твои монеты: '+pretty(state.gold));
   for(const id of MERCHANT_STOCK){const item=ITEM_CATALOG[id];if(!item?.buy)continue;
    line((item.icon||'📦')+' '+item.name,item.buy+' монет · '+LABEL[item.slot],
      [['Купить',()=>{if(state.gold<item.buy)return msg('Недостаточно монет');
       if(!addItem(id))return msg('Сумка заполнена');
       state.gold-=item.buy;persist();draw();msg('Куплено: '+item.name);}]]);}
  }else if(kind==='spells'){
   const intro=document.createElement('p');intro.className='spellbook-intro';
   intro.textContent='Выбери ячейку 1–8, затем способность или предмет. Занятую ячейку тоже можно заменить.';
   body.append(intro);
   const picker=document.createElement('div');picker.className='planet-hotbar-slot-picker';
   for(let i=0;i<8;i++){
    const button=document.createElement('button');button.type='button';
    button.className='choice'+(chooseSlot===i?' is-selected':'');
    button.textContent=String(i+1);button.title='Выбрать ячейку '+(i+1);
    button.setAttribute('aria-pressed',String(chooseSlot===i));
    button.addEventListener('click',()=>{chooseSlot=i;renderModal();});
    picker.append(button);
   }
   body.append(picker);
   const list=document.createElement('div');list.className='spellbook-list';
   const abilities=availableHotbarActions('warrior',state.level);
   for(const info of [...abilities.abilities,...abilities.items]){
     const btn=document.createElement('button');btn.type='button';btn.className='spellbook-entry';
     const icon=document.createElement('span');icon.className='spellbook-entry-icon';if(HOTBAR_ART[info.id])icon.innerHTML=HOTBAR_ART[info.id];else icon.textContent=ICON[info.id]||'✨';
     const block=document.createElement('span');block.className='spellbook-entry-content';
     const title=document.createElement('span');title.className='spellbook-entry-title';title.textContent=info.name;
     const detail=document.createElement('span');detail.className='spellbook-entry-desc';detail.textContent=info.description;
     const meta=document.createElement('span');meta.className='spellbook-entry-meta';
     meta.textContent=info.kind==='item'?'Настоев: '+itemCount('healingPotion'):
      (info.resourceCost?info.resourceCost+' ярости · ':'')+(info.cooldown?info.cooldown+' с восстановления':'Без перезарядки');
     block.append(title,detail,meta);
     const arrow=document.createElement('span');arrow.className='spellbook-entry-use';arrow.textContent='➜';
     btn.append(icon,block,arrow);
     btn.addEventListener('click',()=>{
       const slot=chooseSlot>=0?chooseSlot:state.hotbar.findIndex(entry=>entry===null);
       if(slot<0)return msg('Нажми нужную ячейку на панели');
       state.hotbar=assignHotbarSlot(state.hotbar,slot,{kind:info.kind,id:info.id},'warrior',state.level);
       chooseSlot=-1;persist();draw();msg('Назначено в ячейку '+(slot+1));
     });list.append(btn);
   }
   const clear=document.createElement('button');clear.type='button';
   clear.className='spellbook-entry spellbook-remove';clear.textContent='✕ Очистить выбранную ячейку';
   clear.addEventListener('click',()=>{
     if(chooseSlot<0)return msg('Сначала выбери ячейку панели');
     state.hotbar=assignHotbarSlot(state.hotbar,chooseSlot,null,'warrior',state.level);
     chooseSlot=-1;persist();draw();
   });list.append(clear);body.append(list);
  }
 }
 const actions=[
  ['targetNext',()=>targetNearest(1)],['interact',interact],
  ['bag',()=>openWindow('bag')],['character',()=>openWindow('character')],
  ['journal',()=>openWindow('quests')],['questJournalOpen',()=>openWindow('quests')],
  ['spellbookButton',()=>{chooseSlot=-1;openWindow('spells')}],
  ['pause',()=>openWindow('menu')],
  ['partyOpen',()=>msg('Группы будут доступны после подключения онлайн-мира')],
  ['targetClear',()=>{targetEntity(null);autoplay=false;draw()}],
  ['dummyReset',()=>{dummy.trainingStats=createTrainingStats();draw();}]
 ];
 for(const [id,fn] of actions){const node=$(id);if(node)bind(node,'click',fn);}
 bind($('modalClose'),'click',()=>{chooseSlot=-1;closeWindow();});
 document.addEventListener('keydown',e=>{
  const key=e.key.toLowerCase();
  if(key==='escape'&&!modal.hidden){closeWindow();e.preventDefault();}
  if(!modal.hidden)return;
  const shortcut={i:'bag',c:'character',j:'quests',b:'spells'};
  if(shortcut[key]&&!e.repeat){openWindow(shortcut[key]);e.preventDefault();}
  if(key==='tab'){targetNearest(e.shiftKey?-1:1);e.preventDefault();}
  if(key==='e'){interact();e.preventDefault();}
 });
 // Tap actors by their actual Three.js shapes; ordinary terrain taps clear selection.
 const picker=new THREE.Raycaster(),startPointer=new Map();
 canvas.addEventListener('pointerdown',e=>{startPointer.set(e.pointerId,{x:e.clientX,y:e.clientY});});
 canvas.addEventListener('pointercancel',e=>startPointer.delete(e.pointerId));
 canvas.addEventListener('pointerup',e=>{
  const start=startPointer.get(e.pointerId);startPointer.delete(e.pointerId);
  if(!start||Math.hypot(e.clientX-start.x,e.clientY-start.y)>14)return;
  const rect=canvas.getBoundingClientRect();
  const x=(e.clientX-rect.left)/rect.width*2-1,y=-((e.clientY-rect.top)/rect.height*2-1);
  picker.setFromCamera(new THREE.Vector2(x,y),camera);
  const visible=entities.filter(o=>o.root.visible&&!(o.kind==='mob'&&o.dead&&!o.corpse));
  const roots=visible.map(o=>o.root);
  const intersects=picker.intersectObjects(roots,true);
  const hit=intersects.find(v=>v.distance<100)?.object;
  const selected=hit?visible.find(o=>{let p=hit;while(p){if(p===o.root)return true;p=p.parent;}return false;}):null;
  if(selected?.kind==='mob'&&selected.corpse){
   if(distance(selected)<=3.1)lootMob(selected);
   return;
  }
  targetEntity(selected||null);
 });
 function resetWorldTransforms(){for(const e of entities)setModelAt(e);mentorWorld.rebuild();targetRing.invalidate();stompEffect.invalidate();updateSelection();draw();}
 function canMoveTo(x,z){
  // Friendly NPCs are interaction targets, not physical colliders in the
  // main NexGame. Use the shared geometry for houses, furniture and nature.
  return canWalkCamp(x,z);
 }
 function getApproachTarget(){
  if(!autoplay||modal.hidden===false||camp.casting||state.hp<=0)return null;
  if(!target||target.hp<=0||target.dead||!target.root.visible)return null;
  const d=distance(target);
  return d>3.25&&d<=20?target:null;
 }
 function stopAutoApproach(){
  if(autoplay){autoplay=false;msg('Путь к цели перекрыт');draw();}
 }
 function update(dt){
  clock+=dt;
  attackRemaining=Math.max(0,attackRemaining-dt);
  stompPulse=Math.max(0,stompPulse-dt);
  blockRemaining=Math.max(0,blockRemaining-dt);
  for(let i=pendingHits.length-1;i>=0;i--){
   const hit=pendingHits[i];hit.remaining-=dt;
   if(hit.remaining>0)continue;
   pendingHits.splice(i,1);
   if(!hit.enemy.root.visible||hit.enemy.hp<=0||hit.enemy.dead||distance(hit.enemy)>3.65)continue;
   if(!facesTarget(hit.enemy)){
    // Native NexGame checks melee facing on the IMPACT frame.
    // A turn during the 340ms wind-up may avoid landing the strike.
    if(hit.skill!=='autoAttack')msg('Цель не перед вами',1.1);
    continue;
   }
   harm(hit.enemy,hit.damage,hit.skill);
  }
  if(!toast.hidden&&clock>messageUntil){toast.classList.remove('show');toast.hidden=true;}
  tickAbilityRuntime(runtime,dt);
  // Original NexGame regenerates +3 HP/s and loses 5 rage/s after five
  // seconds of peace. This local test does not depend on network snapshots.
  if(inCombat())lastCombatAt=clock;
  else if(clock-lastCombatAt>5){
   const hpBefore=state.hp,rageBefore=state.resource;
   state.hp=Math.min(stats().maxHp,state.hp+3*dt);
   if(state.resource>0)state.resource=changeResource(state.resource,-WARRIOR_RAGE_DECAY*dt,'warrior');
   if((state.hp!==hpBefore||state.resource!==rageBefore)&&Math.floor(clock/2)!==Math.floor((clock-dt)/2))persist();
  }
  camp.update(dt);
  // The original inhabitants have subtle idle breathing instead of frozen T-poses.
  for(let i=0;i<citizens.length;i++){
   animateSphericalTauren(citizens[i].actor,{dt,time:clock+i*1.47,walk:0,phase:0});
  }
  mentorWorld.update(state,clock);
  if(state.quest===7&&distance(mentorWorld.scout)<5.5)mentorChain.discoveredScout();
  const local=player();
  swing-=dt;
  if(autoplay&&target&&['mob','dummy'].includes(target.kind)&&!target.dead&&distance(target)<3.45&&swing<=0){
   hitEnemy(target);swing=stats().speed;
  }
  for(const mob of mobs){
   mob.hit=Math.max(0,(mob.hit||0)-dt);
   mob.alertRemaining=Math.max(0,(mob.alertRemaining||0)-dt);
   if(mob.lootMarker?.visible){
    const tier=mob.lootMarker.userData.rarity;
    const t=tier==='rare'?.12:tier==='uncommon'?.065:.02;
    const pulse=Math.sin(clock*(tier==='rare'?4:2.7)+mob.index);
    mob.lootMarker.scale.setScalar(1+.12*pulse*t);
    mob.lootMarker.position.y=1.58+.12*Math.sin(clock*3.6);
    mob.lootMarker.material.opacity=.86+.13*Math.pow(Math.sin(clock*2.6),2);
   }
   if(mob.contactShadow)mob.contactShadow.visible=mob.root.visible&&!mob.corpse;
   if(mob.alertTag){
    mob.alertTag.visible=mob.alertRemaining>0&&mob.root.visible&&!mob.corpse;
    if(mob.alertTag.visible)mob.alertTag.position.y=(mob.boss?4:4.95)+Math.sin(clock*7)*.1;
   }
   if(!mob.root.visible){
    mob.respawn-=dt;
    if(mob.respawn<=0){mob.dead=0;mob.corpse=false;mob.hp=mob.maxHp;mob.x=mob.spawnX;mob.z=mob.spawnZ;
     mob.root.visible=true;mob.returning=false;mob.aggro=false;mob.attackCd=1.2;mob.attackWindup=0;mob.hit=0;mob.corpseAge=0;mob.alertRemaining=0;
     updateLootMarker(mob);
     resetPlainstriderVisual(mob);setModelAt(mob);}
    continue;
   }
   if(mob.corpse){
    mob.corpseAge=(mob.corpseAge||0)+dt;
    if(mob.corpseAge>32){
     mob.corpse=false;mob.root.visible=false;mob.respawn=12;mob.loot=[];updateLootMarker(mob);
     if(target===mob){target=null;autoplay=false;}
    }
    continue;
   }
   if(mob.dead>0){mob.dead=Math.max(0,mob.dead-dt);continue;}
   mob.attackCd=Math.max(0,mob.attackCd-dt);mob.stun=Math.max(0,mob.stun-dt);mob.roamTime+=dt;
   const spawnNormal=toNormal(mob.spawnX,mob.spawnZ,getRadius());
   const playerSpawnDistance=getRadius()*Math.acos(clamp(playerNormal().dot(spawnNormal),-1,1));
   const dist=distance(mob);
   if(mob.aggro&&playerSpawnDistance>23){mob.aggro=false;mob.returning=true;mob.hp=mob.maxHp;mob.attackWindup=0;}
   if(!mob.aggro&&!mob.returning&&dist<(mob.boss?9:7)&&playerSpawnDistance<23&&state.hp>0){
    mob.aggro=true;mob.alertRemaining=1.05;
   }
   let dx=0,dz=0;
   if(mob.returning){dx=mob.spawnX-mob.x;dz=mob.spawnZ-mob.z;if(Math.hypot(dx,dz)<.25){mob.returning=false;mob.hp=mob.maxHp;}}
   else if(mob.aggro){dx=local.x-mob.x;dz=local.z-mob.z;}
   else{
    // Original calm wildlife slowly wanders within a couple of metres.
    const tx=mob.spawnX+Math.sin(mob.roamTime*.18+mob.index)*2.2;
    const tz=mob.spawnZ+Math.cos(mob.roamTime*.14+mob.index)*2.2;
    dx=tx-mob.x;dz=tz-mob.z;
   }
   const len=Math.hypot(dx,dz),moving=len>.06&&mob.stun<=0;
   const beforeX=mob.x,beforeZ=mob.z;
   if(moving&&(!mob.aggro||len>(mob.boss?3:2.35))&&mob.attackWindup<=0){
    const amount=Math.min(len,dt*(mob.aggro?(mob.boss?1.75:2.05):1.45));
    const nx=mob.x+dx/len*amount,nz=mob.z+dz/len*amount;
    if(canMoveTo(nx,nz)){mob.x=nx;mob.z=nz;}
   }
   // Three.js bird GLB faces local +Z, and local up is radial to the sphere.
   // Map-plane atan2(dx,dz) points in the wrong direction on the curved world.
   const aim=mob.aggro&&state.hp>0?playerNormal():
    mob.returning?toNormal(mob.spawnX,mob.spawnZ,getRadius()):
    len>.05?toNormal(mob.x+dx/len,mob.z+dz/len,getRadius()):null;
   const normal=toNormal(mob.x,mob.z,getRadius());
   const desiredYaw=aim?sphereFacingYaw(THREE,normal,aim):null;
   // Face the moving player on EVERY frame, including stationary melee/Peck.
   mob.yaw=turnSphereYaw(mob.yaw,desiredYaw,dt,mob.attackWindup>0?16:12);
   const close=distance(mob)<(mob.boss?3:2.6);
   if(mob.stun>0||!mob.aggro||state.hp<=0||!close){
    mob.attackWindup=0;
   }else if(mob.attackCd<=0){
    if(mob.attackWindup<=0)mob.attackWindup=mob.boss?.45:.4;
    else{
     mob.attackWindup=Math.max(0,mob.attackWindup-dt);
     // An attack cannot land until the bird is visibly facing the player.
     if(mob.attackWindup<=0&&sphereFacingError(mob.yaw,desiredYaw)>.32)
      mob.attackWindup=.09;
     else if(mob.attackWindup<=0){
      const result=incomingShieldHit({
       THREE,heroNormal:playerNormal(),heroRoot:hero.root,
       enemyNormal:toNormal(mob.x,mob.z,getRadius()),stats:stats(),
       raw:mob.boss?14:9,attackerLevel:mob.boss?5:1
      });
      lastCombatAt=clock;state.hp=Math.max(0,state.hp-result.damage);
      if(result.blocked){
       blockRemaining=result.blockSeconds;
       msg('Блок щитом · отражено '+result.absorbed+' урона',1.1);
      }
      mob.attackCd=mob.boss?1.8:2.1;
      state.resource=changeResource(state.resource,WARRIOR_RAGE_ON_HURT,'warrior');
      if(state.hp<=0){
       // End the ENTIRE encounter before moving the hero back to the fire.
       // Otherwise other aggro mobs keep swinging at the old position or
       // instantly damage the freshly respawned hero during the same tick.
       state.hp=stats().maxHp;state.resource=0;
       autoplay=false;blockRemaining=0;attackRemaining=0;
       pendingHits.length=0;target=null;swing=stats().speed;
       lastCombatAt=clock;
       for(const enemy of mobs){
        enemy.aggro=false;enemy.returning=!enemy.corpse&&enemy.hp>0;
        enemy.attackWindup=0;enemy.attackCd=1.5;enemy.alertRemaining=0;
       }
       msg('Герой возродился у костра');resetPosition?.();
       updateSelection();
      }
      persist();
     }
    }
   }
   setModelAt(mob);
   birdAnimation(mob,dt,Math.hypot(mob.x-beforeX,mob.z-beforeZ));
  }
  updateTrainingTarget(dummy,clock);
  combatFeedback.update(dt);
  stompEffect.update(dt);
  updateSelection();
  if(Math.floor(clock*5)!==Math.floor((clock-dt)*5))draw(false);
 }
 let resetPosition=null;
 function onRespawn(fn){resetPosition=fn;}
 function getAnimationState(){
  return {gather:camp.casting,attack:attackProgress(attackRemaining),
   stomp:stompPulse/.55,blockRemaining,weaponKind:hero.root.userData.weaponKind||'none'};
 }
 function getQuestMapState(){
  return {
   stage:state.quest,guide:state.quest===10,
   scout:state.quest===7||state.quest===8,
   relic:state.quest===4,
   bossAlive:giant.root.visible&&!giant.corpse&&giant.hp>0,
   boss:{x:giant.x,z:giant.z},scoutPosition:SCOUT_POSITION,relicPosition:RELIC_POSITION
  };
 }
 function handleSlotKey(key){
  const n=Number(key);if(Number.isInteger(n)&&n>=1&&n<=8){useAbility(n-1);return true;}
  return false;
 }
 persist();draw();void updateEquipmentVisuals();
 return {update,targetNearest,interact,resetWorldTransforms,canMoveTo,onRespawn,handleSlotKey,getApproachTarget,stopAutoApproach,getAnimationState,getQuestMapState,draw,get state(){return state}};
}
