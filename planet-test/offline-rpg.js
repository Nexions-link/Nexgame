// Offline spherical NexGame systems. Use the unchanged production rules for items,
// abilities, hotbar, loot and dummy statistics; do not connect to multiplayer or saves.
import {HOTBAR_ART,HOTBAR_SHORT} from './native-hotbar-art.js?v=1';
import {ITEM_CATALOG,MERCHANT_STOCK,rollEquipmentLoot,deriveStats,itemStackLimit} from '../items.js?v=0.3.5.17';
import {getAbilityDefinition,createAbilityRuntime,tickAbilityRuntime,activateAbility,changeResource,WARRIOR_RAGE_PER_HIT,WARRIOR_RAGE_ON_HURT} from '../skills.js?v=0.3.5';
import {DEFAULT_HOTBAR,normalizeHotbar,assignHotbarSlot,availableHotbarActions,actionDefinition} from '../hotbar.js?v=0.3.5.3';
import {TRAINING_DUMMY,createTrainingStats,applyTrainingHit,updateTrainingTarget} from '../training.js?v=0.3.5.1';
import {PLAINSTRIDER_REQUIRED_CLIPS,validatePlainstriderGltf} from '../plainstrider-model.js?v=0.3.7.0';
import {AXE_TUNER_DEFAULTS} from '../axe-tuner.js?v=0.3.7.0';
import {SWORD_TUNER_DEFAULTS} from '../sword-tuner.js?v=0.3.7.0';
import {DAGGER_TUNER_DEFAULTS} from '../dagger-tuner.js?v=0.3.7.0';
import {SHIELD_TUNER_DEFAULTS} from '../shield-tuner.js?v=0.3.7.0';
import {GATHER_QUESTS,OFFLINE_CHEST,createGatherWorld} from './gather-world.js?v=1';
import {createCampActions} from './camp-actions.js?v=1';

const UP_AXIS=[0,1,0], TAU=Math.PI*2;
const SPAWNS=[[-9,-23],[1,-28],[13,-22],[21,-33],[-22,-35],[-28,29],[15,36],[48,9]];
const SAVE_KEY='nexgame-planet-test-offline-rpg-v1';
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const pretty=num=>Number(num).toLocaleString('ru-RU',{maximumFractionDigits:1});
const LABEL={weapon:'Оружие',shield:'Щит',head:'Голова',chest:'Грудь',legs:'Ноги',hands:'Руки',waist:'Пояс',wrists:'Запястья',feet:'Ступни'};
const EQUIP_SLOTS=['weapon','shield','head','chest','legs','hands','waist','wrists','feet'];
const ICON={autoAttack:'⚔️',thunderStomp:'💥',heavyStrike:'🪓',healingPotion:'🧪'};
const initial=()=>({level:1,xp:0,gold:30,resource:0,hp:null,inventory:[{id:'wornAxe',qty:1},{id:'healingPotion',qty:3}],equipment:{},kills:0,quest:'available',gatherStage:0,gatherAvailable:false,chestInventory:[],hotbar:DEFAULT_HOTBAR});
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
  safe.quest=['available','active','ready','completed'].includes(raw.quest)?raw.quest:'available';
  safe.gatherStage=clamp(Math.floor(Number(raw.gatherStage)||0),0,4);
  safe.gatherAvailable=!!raw.gatherAvailable&&safe.gatherStage>=2&&safe.gatherStage<=3;
  safe.chestInventory=Array.isArray(raw.chestInventory)?
   raw.chestInventory.slice(0,OFFLINE_CHEST.slots).filter(entry=>entry&&ITEM_CATALOG[entry.id]&&Number.isFinite(entry.qty)&&entry.qty>0)
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
 const modelLoader=import('https://cdn.jsdelivr.net/npm/three@0.160.1/examples/jsm/loaders/GLTFLoader.js')
  .then(({GLTFLoader})=>new GLTFLoader()).catch(()=>null);
 let visualRequest=0;
 const radians=d=>d*Math.PI/180;
 async function updateEquipmentVisuals(){
  const request=++visualRequest;
  const weaponDef=ITEM_CATALOG[state.equipment.weapon?.id];
  const shieldDef=ITEM_CATALOG[state.equipment.shield?.id];
  const weaponKind=weaponDef?.weaponKind||null;
  const shieldKind=shieldDef?.rarity==='uncommon'?'kite':shieldDef?'round':null;
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
    const mesh=gltf.scene;mesh.name='planet-rpg-'+kind;
    mesh.position.set(tuning.posX,tuning.posY,tuning.posZ);
    const key=slot==='shield'?'shield':kind;
    mesh.rotation.set(radians(tuning[key+'X']),radians(tuning[key+'Y']),radians(tuning[key+'Z']),'YXZ');
    if(slot==='weapon')hand.rotation.set(radians(tuning.handX),radians(tuning.handY),radians(tuning.handZ),'XYZ');
    hand.add(mesh);modelSlots[slot]=mesh;
   }catch(err){console.warn('Planet equipment model unavailable',url,err);}
  }
 }

 let target=null,autoplay=false,swing=0,clock=0,messageUntil=0,pendingLoot=null,chooseSlot=-1,gatherCast=null;
 const group=new THREE.Group();scene.add(group);
 const up=new THREE.Vector3(...UP_AXIS),anchorQuat=new THREE.Quaternion(),spinQuat=new THREE.Quaternion();
 const mobs=[],entities=[];
 const hotbar=$('actionsBar'),modal=$('modal'),toast=$('toast');
 const nameEl=$('playerName'),objective=$('qtext');
 const originalControls=$('labSettingsSources');
 const settingsControls=[...originalControls.children];
 if(!hotbar||!modal||!toast||!nameEl||!$('playerFrame')||!$('minimap'))throw Error('Не загружен оригинальный интерфейс NexGame');
 const bind=(el,ev,fn)=>el.addEventListener(ev,fn);
 const stats=()=>deriveStats(state.level,state.equipment);
 if(state.hp==null)state.hp=stats().maxHp;
 function persist(){try{localStorage.setItem(SAVE_KEY,JSON.stringify(state))}catch{}}
 function msg(text,seconds=3){toast.textContent=text;toast.hidden=false;toast.classList.add('show');messageUntil=clock+seconds;}
 function setModelAt(entity){
  const normal=toNormal(entity.x,entity.z,getRadius());
  entity.root.position.copy(normal).multiplyScalar(getRadius()+heightAt(normal)+.09);
  anchorQuat.setFromUnitVectors(up,normal);
  entity.root.quaternion.copy(anchorQuat).multiply(spinQuat.setFromAxisAngle(up,entity.yaw||0));
 }
 function makeLabel(name){
  const canvasLabel=document.createElement('canvas');canvasLabel.width=512;canvasLabel.height=84;
  const c=canvasLabel.getContext('2d');
  c.font='600 31px system-ui';c.textAlign='center';c.textBaseline='middle';
  c.lineJoin='round';c.lineWidth=3;c.strokeStyle='rgba(17,19,12,.78)';
  c.strokeText(name.slice(0,27),256,43);
  c.fillStyle='#ffebbc';c.fillText(name.slice(0,27),256,43);
  const texture=new THREE.CanvasTexture(canvasLabel);
  const mat=new THREE.SpriteMaterial({map:texture,depthWrite:false,transparent:true});
  const sprite=new THREE.Sprite(mat);sprite.position.y=4.15;sprite.scale.set(6.3,1.05,1);
  return sprite;
 }
 function npc(kind,x,z,name){
  const root=new THREE.Group();root.name='planet-'+kind;group.add(root);
  // Full procedurally modelled Tauren identical to the playable hero.
  const npcActor=makeTauren();
  npcActor.root.scale.setScalar(kind==='mentor'?.97:.94);
  root.add(npcActor.root);
  root.add(makeLabel(name));
  const e={kind,name,x,z,yaw:.2,root,radius:1.5};entities.push(e);setModelAt(e);return e;
 }
 npc('mentor',-1.5,-5,'Наставник Каменный Рог');
 npc('vendor',6,11,'Борун Крепкая Ладонь');
 const herbalist=npc('herbalist',8,1,'Травница Тихая Заря');
 const herbMarker=makeLabel('!'),herbTurnin=makeLabel('?');
 for(const [glyph,sprite] of [['!',herbMarker],['?',herbTurnin]]){
  sprite.position.y=1.25;sprite.scale.set(1.6,1.7,1);
  sprite.userData.questMarker=true;sprite.userData.glyph=glyph;
  herbalist.root.add(sprite);
 }
 function createBird(x,z,i){
  const root=new THREE.Group();group.add(root);
  const mat=new THREE.MeshStandardMaterial({color:i%2?'#917044':'#826649',roughness:1});
  const body=new THREE.Mesh(new THREE.SphereGeometry(1,12,9),mat);
  body.scale.set(.58,.48,.8);body.position.y=1.25;root.add(body);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(.13,.19,.9,7),mat);neck.position.set(0,1.83,.57);neck.rotation.x=.45;root.add(neck);
  const head=new THREE.Mesh(new THREE.SphereGeometry(.28,9,7),mat);head.position.set(0,2.25,.74);root.add(head);
  const beak=new THREE.Mesh(new THREE.ConeGeometry(.18,.5,7),new THREE.MeshStandardMaterial({color:'#d5b16f'}));
  beak.rotation.x=Math.PI/2;beak.position.set(0,2.17,1.1);root.add(beak);
  for(const side of [-1,1]){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.08,.075,1.2,6),mat);leg.position.set(side*.25,.6,0);root.add(leg);}
  const entity={kind:'mob',index:i,name:'Долгоног',root,x,z,yaw:.1,
   spawnX:x,spawnZ:z,hp:73,maxHp:73,aggro:false,attackCd:1.2,stun:0,dead:0,loot:null,corpse:false,
   respawn:0,returning:false,walk:0,visual:null};
  root.add(makeLabel(entity.name));
  mobs.push(entity);entities.push(entity);setModelAt(entity);return entity;
 }
 SPAWNS.forEach(([x,z],i)=>createBird(x,z,i));
 const dummyRoot=new THREE.Group();group.add(dummyRoot);
 const straw=new THREE.MeshStandardMaterial({color:'#bb9665',roughness:1});
 const dummyBody=new THREE.Mesh(new THREE.CylinderGeometry(.56,.63,2.2,12),straw);
 dummyBody.position.y=1.45;dummyRoot.add(dummyBody);
 for(const s of [-1,1]){const arm=new THREE.Mesh(new THREE.CylinderGeometry(.16,.16,1.65,8),straw);arm.rotation.z=Math.PI/2;arm.position.set(s*.7,2.2,0);dummyRoot.add(arm);}
 dummyRoot.add(makeLabel(TRAINING_DUMMY.name));
 const dummy={kind:'dummy',name:TRAINING_DUMMY.name,root:dummyRoot,x:TRAINING_DUMMY.x,z:TRAINING_DUMMY.z,
  yaw:0,trainingDummy:true,maxHp:TRAINING_DUMMY.maxHp,hp:TRAINING_DUMMY.maxHp,trainingStats:createTrainingStats()};
 entities.push(dummy);setModelAt(dummy);
 // Preserve original locations in metres and project every mesh onto the sphere.
 const gathering=createGatherWorld({THREE,parent:group,place:e=>{entities.push(e);setModelAt(e);}});
 const gatherNodes=gathering.nodes;
 // Use the exact approved longstrider model and clips when the shared GLB loads.
 // Procedural fallback remains available if the CDN or asset fails.
 void (async()=>{
  try{
   const loader=await modelLoader;
   if(!loader)throw Error('GLTFLoader unavailable');
   const asset=await loader.loadAsync('../bestiary/models/dolgonog-v0.1.glb?v=0.3.5.43');
   if(!validatePlainstriderGltf(asset))throw Error('Unexpected Dolgonog clips');
   for(const mob of mobs){
    const model=asset.scene.clone(true);model.scale.setScalar(.6);mob.root.add(model);
    for(const child of [...mob.root.children])if(child.isMesh)child.visible=false;
    const mixer=new THREE.AnimationMixer(model);
    const anim=Object.fromEntries(PLAINSTRIDER_REQUIRED_CLIPS.map(k=>[k,mixer.clipAction(asset.animations.find(a=>a.name===k))]));
    anim.Idle.play();mob.visual={mixer,anim,mode:'Idle'};
   }
  }catch(err){console.warn('Planet offline Dolgonog fallback:',err);}
 })();
 function birdAnimation(mob,dt,moving=false,peck=false){
  if(!mob.visual)return;
  const {mixer,anim}=mob.visual,desired=peck?'Peck':moving?'Walk':'Idle';
  if(mob.visual.mode!==desired){
   anim[mob.visual.mode]?.fadeOut(.18);
   const act=anim[desired];act.reset();
   if(desired==='Peck'){act.setLoop(THREE.LoopOnce,1);act.clampWhenFinished=true;}
   else{act.setLoop(THREE.LoopRepeat,Infinity);act.clampWhenFinished=false;}
   act.fadeIn(.18).play();mob.visual.mode=desired;
  }
  mixer.update(dt);
 }
 function player(){return toLocal(playerNormal(),getRadius());}
 function distance(entity){const p=player();return Math.hypot(p.x-entity.x,p.z-entity.z);}
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
 function lootMob(mob){
  if(!mob?.corpse||!mob.loot)return;
  const remaining=[];
  for(const item of mob.loot){if(addItem(item.id,item.qty)){msg('Получено: '+(ITEM_CATALOG[item.id]?.name||item.id));}
   else remaining.push(item);}
  mob.loot=remaining;
  if(!remaining.length){mob.corpse=false;mob.root.visible=false;mob.respawn=12;target=null;}
  draw();
 }
 function targetEntity(entity){
  if(entity?.kind==='mob'&&entity.dead&&!entity.corpse)return;
  target=entity;
  draw();
 }
 function targetNearest(){
  const nearest=entities.filter(x=>x.root.visible&&!(x.kind==='mob'&&x.dead&&!x.corpse))
   .map(x=>({entity:x,d:distance(x)})).filter(x=>x.d<18).sort((a,b)=>a.d-b.d)[0];
  if(nearest){targetEntity(nearest.entity);msg('Цель: '+nearest.entity.name);}
  else msg('Рядом никого нет');
 }
 function openWindow(kind){
  if(kind!=='gatherLoot')camp.cancel();
  modal.hidden=false;modal.dataset.kind=kind;renderModal();
 }
 function closeWindow(){modal.hidden=true;}
 function interact(){
  if(!target)return targetNearest();
  if(distance(target)>(target.kind==='gather'?2.8:target.kind==='chest'?OFFLINE_CHEST.range:4.5))return msg('Подойди ближе к цели');
  if(camp.interact(target)){draw();return;}
  if(target.kind==='mentor'){
   if(state.quest==='available'){state.quest='active';persist();msg('Задание: победить 3 долгоногов');}
   else if(state.quest==='ready'){
    state.quest='completed';state.gold+=10;state.xp+=45;persist();levelCheck();msg('Задание выполнено! +10 монет, +45 опыта');
   }else msg(state.quest==='active'?'Победи долгоногов: '+state.kills+'/3':'Спасибо за помощь!');
   openWindow('quests');
  }else if(target.kind==='vendor')openWindow('merchant');
  else if(target.kind==='mob'&&target.corpse)lootMob(target);
  else if(target.kind==='dummy')msg('Тренировочный манекен: бей для проверки урона');
  else msg('Используй способности на панели');
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
  if(enemy.kind==='dummy'){applyTrainingHit(enemy,damage,clock,skill);msg('Манекен: '+Math.round(damage)+' урона',1.2);draw();return;}
  if(enemy.kind!=='mob'||enemy.dead)return;
  enemy.hp=Math.max(0,enemy.hp-damage);enemy.aggro=true;enemy.returning=false;
  state.resource=changeResource(state.resource,WARRIOR_RAGE_PER_HIT,'warrior');
  if(enemy.hp===0){
   enemy.dead=6;enemy.corpse=true;enemy.aggro=false;enemy.attackCd=0;autoplay=false;
   enemy.root.rotateX(1.15);
   enemy.loot=[{id:'feather',qty:1}];
   if(Math.random()<.38)enemy.loot.push({id:Math.random()<.6?'beak':'down',qty:1});
   const gear=rollEquipmentLoot(false);if(gear)enemy.loot.push(gear);
   state.xp+=12;state.gold+=2;levelCheck();
   if(state.quest==='active'){state.kills=Math.min(3,state.kills+1);if(state.kills===3)state.quest='ready';}
   msg('Долгоног повержен · нажми «Взаимодействие» для добычи');
   persist();
  }
  draw();
 }
 function hitEnemy(enemy,bonus=0,skill='autoAttack'){
  if(!enemy||!['mob','dummy'].includes(enemy.kind)||enemy.dead)return msg('Нет подходящей цели');
  if(distance(enemy)>3.45)return msg('Цель слишком далеко');
  const s=stats(),damage=s.damageMin+Math.random()*(s.damageMax-s.damageMin)+bonus;
  harm(enemy,damage,skill);
 }
 function useAbility(slot){
  const entry=state.hotbar[slot],action=actionDefinition(entry,'warrior',state.level);
  if(!action)return msg('Пустая ячейка');
  const def=getAbilityDefinition(action.abilityId),d=target?distance(target):Infinity;
  if(action.id==='autoAttack'){
   if(!target||!['mob','dummy'].includes(target.kind)||target.dead)return msg('Сначала выбери противника');
   autoplay=!autoplay;swing=0;msg(autoplay?'Автоатака включена':'Автоатака выключена');draw();return;
  }
  const ctx={runtime,classId:'warrior',level:state.level,resource:state.resource,
   hasTarget:!!target&&['mob','dummy'].includes(target.kind)&&!target.dead,range:d,facing:true,
   hasConsumable:itemCount('healingPotion')>0,needsHealing:state.hp<stats().maxHp};
  const result=activateAbility(def,ctx);
  if(!result.ok)return msg(result.error);
  state.resource=result.resource;
  if(action.id==='healingPotion'){takeItem('healingPotion');state.hp=Math.min(stats().maxHp,state.hp+55);msg('Здоровье восстановлено');}
  else if(action.id==='heavyStrike')hitEnemy(target,def.damageBonus||8,action.id);
  else if(action.id==='thunderStomp'){
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
  $('combatState').textContent=autoplay?'Автоатака':'Готов к бою';
  $('xpFill').style.width=Math.min(100,state.xp/(state.level*100)*100)+'%';
  $('xpText').textContent='Опыт '+state.xp+' / '+(state.level*100);
  const hostile=target&&['mob','dummy'].includes(target.kind);
  $('targetFrame').hidden=!hostile;$('targetPlaceholder').hidden=!!hostile;
  if(hostile){
    $('targetName').textContent=target.name;
    $('targetFill').style.width=clamp(target.hp/target.maxHp*100,0,100)+'%';
    $('targetHp').textContent=Math.ceil(target.hp)+' / '+target.maxHp;
    $('targetDistance').textContent='Дистанция: '+pretty(distance(target))+' м';
    $('targetStatus').textContent=target.corpse?'Доступна добыча':autoplay?'Автоатака':'Нажми 1 для автоатаки';
    $('dummyStats').hidden=target.kind!=='dummy';
  }
  const questText=state.quest==='active'?'Победи долгоногов: '+state.kills+' / 3':
    state.quest==='ready'?'Вернись к наставнику':state.quest==='completed'?'Задание выполнено':
    'Поговори с наставником в лагере';
  objective.textContent=questText;
  $('qtitle').textContent='Испытание охотника';$('mainQuestTracker').hidden=state.quest==='completed';
  $('quest-progress').textContent=state.quest==='active'?'Прогресс: '+state.kills+' / 3':'Одиночное задание';
  const canInteract=!!target&&target.root.visible&&distance(target)<
    (target.kind==='gather'?2.8:target.kind==='chest'?OFFLINE_CHEST.range:5.5);
  $('interact').hidden=!canInteract;
  if(canInteract)$('interact').textContent=target.kind==='gather'?'Собрать':
    target.kind==='chest'?'Открыть сундук':target.corpse?'Забрать добычу':
    target.kind==='mentor'||target.kind==='herbalist'?'Поговорить':
    target.kind==='vendor'?'Торговец':'Взаимодействие';
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
   button.append(key,icon,caption);
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
   button.classList.toggle('is-cooldown',!!def&&def.cooldown>0&&(runtime.cooldowns[def.id]||0)>0);
   button.classList.toggle('is-active',entry?.id==='autoAttack'&&autoplay);
  }
 }
 function renderModal(){
  const kind=modal.dataset.kind,title=$('mtitle'),body=$('mbody');
  $('panel').classList.toggle('character-modal',kind==='character');
  $('panel').classList.toggle('inventory-modal',kind==='bag');
  $('msub').textContent='NEXGAME · ОФЛАЙН · КРУГЛЫЙ МИР';
  title.textContent=({bag:'Рюкзак',character:'Персонаж',quests:'Журнал заданий',
   merchant:'Торговец',spells:'Книга способностей',loot:'Добыча',menu:'Меню',herbalist:'Травница Тихая Заря',chest:'Сундук',gatherLoot:'Собранный ресурс'})[kind]||'NexGame';
  body.replaceChildren();
  const line=(label,caption,actions=[])=>{
   const row=document.createElement('div');row.className='rpgRow';
   const name=document.createElement('div');name.innerHTML='<strong></strong><small></small>';
   name.querySelector('strong').textContent=label;name.querySelector('small').textContent=caption;
   row.append(name);for(const [caption,fn] of actions){const b=document.createElement('button');b.type='button';b.textContent=caption;b.addEventListener('click',fn);row.append(b);}
   body.append(row);
  };
  if(camp.render(kind,body,line))return;
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
      cell.setAttribute('aria-label',item?(def?.name||'Лечебный настой'):'Пустая ячейка '+(i+1));
      if(item){
        const icon=document.createElement('span');icon.className='slot-icon';icon.textContent=def?.icon||'🧪';
        const qty=document.createElement('span');qty.className='slot-count';qty.textContent=item.qty>1?item.qty:'';
        cell.append(icon,qty);
        cell.addEventListener('click',()=>{
          detail.replaceChildren();
          const name=document.createElement('strong');name.textContent=def?.name||'Лечебный настой';
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
   if(state.gatherStage===0)line('Дары Мулгора','Новое задание у Тихой Зари (8, 1)');
   else if(state.gatherStage===4)line('Дары Мулгора','Три собирательных задания выполнены!');
   else{
    const q=GATHER_QUESTS[state.gatherStage];
    if(q)line(q.title,'Собрано: '+camp.gatherCount+'/'+q.count+
      (state.gatherAvailable?' · Новое поручение у травницы':' · '+q.hint));
   }
   const summary=state.quest==='available'?'Доступно: поговори с Наставником Каменным Рогом':
    state.quest==='active'?'Убито долгоногов: '+state.kills+'/3':
    state.quest==='ready'?'Готово: вернись к Наставнику Каменному Рогу':'Выполнено!';
   line('Испытание охотника','Победи 3 долгоногов. '+summary);
   line('Награда','45 опыта и 10 монет');
  }else if(kind==='merchant'){
   line('Борун Крепкая Ладонь','Твои монеты: '+pretty(state.gold));
   for(const id of MERCHANT_STOCK){const item=ITEM_CATALOG[id];if(!item?.buy)continue;
    line((item.icon||'📦')+' '+item.name,item.buy+' монет · '+LABEL[item.slot],
      [['Купить',()=>{if(state.gold<item.buy)return msg('Недостаточно монет');
       if(!addItem(id))return msg('Сумка заполнена');
       state.gold-=item.buy;persist();draw();msg('Куплено: '+item.name);}]]);}
  }else if(kind==='spells'){
   const intro=document.createElement('p');intro.className='spellbook-intro';
   intro.textContent='Выбери способность и ячейку панели: сначала нажми свободную ячейку, затем открой книгу.';
   body.append(intro);
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
  ['targetNext',targetNearest],['interact',interact],
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
  if(key==='tab'){targetNearest();e.preventDefault();}
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
  targetEntity(selected||null);
 });
 function resetWorldTransforms(){for(const e of entities)setModelAt(e);draw();}
 function canMoveTo(x,z){
  const near=entities.filter(e=>e.kind==='mentor'||e.kind==='vendor').some(e=>Math.hypot(x-e.x,z-e.z)<.8);
  if(near)return false;
  for(const [tx,tz,r] of [[11,-7,3.6],[-15,12,3.3],[13,16,2.9],[-23,-15,2.6]])
   if(Math.hypot(x-tx,z-tz)<r)return false;
  // Exact main house orientation is PI/2. Allow the 6.8m doorway on the +Z side.
  const lx=-(z+2),lz=x+27;
  if(Math.abs(lx)<10.1&&Math.abs(lz)<10.9){
   if((Math.abs(lx)>9.05||Math.abs(lz)>9.9)&&!(Math.abs(lx)<3.45&&lz>9.2))return false;
  }
  return true;
 }
 function update(dt){
  clock+=dt;
  if(!toast.hidden&&clock>messageUntil){toast.classList.remove('show');toast.hidden=true;}
  tickAbilityRuntime(runtime,dt);
  camp.update(dt);
  const local=player();
  swing-=dt;
  if(autoplay&&target&&['mob','dummy'].includes(target.kind)&&!target.dead&&distance(target)<3.45&&swing<=0){
   hitEnemy(target);swing=stats().speed;
  }
  for(const mob of mobs){
   if(!mob.root.visible){
    mob.respawn-=dt;
    if(mob.respawn<=0){mob.dead=0;mob.corpse=false;mob.hp=mob.maxHp;mob.x=mob.spawnX;mob.z=mob.spawnZ;
     mob.root.visible=true;mob.returning=false;mob.aggro=false;mob.attackCd=1.2;setModelAt(mob);}
    continue;
   }
   if(mob.corpse)continue;
   if(mob.dead>0){mob.dead=Math.max(0,mob.dead-dt);continue;}
   mob.attackCd=Math.max(0,mob.attackCd-dt);mob.stun=Math.max(0,mob.stun-dt);
   const playerSpawnDistance=Math.hypot(local.x-mob.spawnX,local.z-mob.spawnZ);
   const dist=Math.hypot(local.x-mob.x,local.z-mob.z);
   if(mob.aggro&&playerSpawnDistance>23){mob.aggro=false;mob.returning=true;mob.hp=mob.maxHp;}
   if(!mob.aggro&&!mob.returning&&dist<7&&playerSpawnDistance<23&&state.hp>0)mob.aggro=true;
   let dx=0,dz=0;
   if(mob.returning){dx=mob.spawnX-mob.x;dz=mob.spawnZ-mob.z;if(Math.hypot(dx,dz)<.25){mob.returning=false;mob.hp=mob.maxHp;}}
   else if(mob.aggro){dx=local.x-mob.x;dz=local.z-mob.z;}
   const len=Math.hypot(dx,dz),moving=len>.06&&mob.stun<=0;
   if(moving&&(!mob.aggro||len>2.35)){
    const amount=Math.min(len,dt*(mob.aggro?2.05:1.45));
    mob.x+=dx/len*amount;mob.z+=dz/len*amount;mob.yaw=Math.atan2(dx/len,dz/len);
   }
   if(mob.aggro&&dist<2.6&&mob.attackCd<=0&&mob.stun<=0&&state.hp>0){
    const armor=stats().armor;
    state.hp=Math.max(0,state.hp-Math.max(1,Math.round((5+Math.random()*3)*(1-armor/(armor+485)))));
    mob.attackCd=2.1;state.resource=changeResource(state.resource,WARRIOR_RAGE_ON_HURT,'warrior');
    if(state.hp<=0){state.hp=stats().maxHp;state.resource=0;autoplay=false;mob.aggro=false;
     msg('Герой возродился у костра');resetPosition?.();}
    persist();
   }
   setModelAt(mob);
   birdAnimation(mob,dt,moving,mob.aggro&&mob.attackCd>1.38);
  }
  updateTrainingTarget(dummy,clock);
  if(Math.floor(clock*5)!==Math.floor((clock-dt)*5))draw(false);
 }
 let resetPosition=null;
 function onRespawn(fn){resetPosition=fn;}
 function handleSlotKey(key){
  const n=Number(key);if(Number.isInteger(n)&&n>=1&&n<=8){useAbility(n-1);return true;}
  return false;
 }
 persist();draw();void updateEquipmentVisuals();msg('Офлайн RPG: выбери долгонога или поговори с наставником',5);
 return {update,targetNearest,interact,resetWorldTransforms,canMoveTo,onRespawn,handleSlotKey,draw,get state(){return state}};
}
