import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {fileURLToPath} from 'node:url';
import * as Three from 'three';
const folder=process.argv[2]||fileURLToPath(new URL('../',import.meta.url));
const data=await import('../items.js');
class Element{
 constructor(tag='div',id=''){this.tagName=tag.toUpperCase();this.id=id;this.style={};this.children=[];this.listeners={};this.hidden=false;this.dataset={};this.attributes={};this.className='';this.value='10.5';this.min='4';this.max='22';this._width=300;this._height=150;
  this.classList={add:(...names)=>{this.className=[...new Set([...this.className.split(' '),...names])].join(' ')},remove:(...names)=>{this.className=this.className.split(' ').filter(x=>!names.includes(x)).join(' ')},toggle:(name,force)=>{const on=force??!this.className.split(' ').includes(name);this.classList[on?'add':'remove'](name);return on},contains:name=>this.className.split(' ').includes(name)};
 }
 get width(){return this._width}set width(v){this._width=v;if(this.surface)this.surface.width=v}
 get height(){return this._height}set height(v){this._height=v;if(this.surface)this.surface.height=v}
 appendChild(child){this.children.push(child);child.parentNode=this;return child}
 replaceChildren(...children){this.children=[];for(const c of children)this.appendChild(c)}
 remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(x=>x!==this)}
 setAttribute(k,v){this.attributes[k]=v}getAttribute(k){return this.attributes[k]}
 getContext(){if(!this.surface)this.surface=createCanvas(this.width,this.height);const ctx=this.surface.getContext('2d');if(!ctx.patched){const draw=ctx.drawImage.bind(ctx);ctx.drawImage=(img,...args)=>draw(img.surface||img,...args);ctx.patched=true}return ctx}
 addEventListener(k,fn){(this.listeners[k]??=[]).push(fn)}
 dispatch(k,e={}){for(const fn of this.listeners[k]||[])fn({target:this,preventDefault(){},stopPropagation(){},...e})}
 click(){this.dispatch('click',{detail:0})}
 focus(){document.activeElement=this}blur(){document.activeElement=null}
 getBoundingClientRect(){return this.className==='character-canvas'?{left:0,top:0,width:228,height:310}:{left:20,top:600,width:120,height:120}}
 setPointerCapture(){}hasPointerCapture(){return false}releasePointerCapture(){}
 querySelector(){return new Element()}
}
const ids=new Map(),html=fs.readFileSync(folder+'/index.html','utf8');for(const m of html.matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"/g)){assert.ok(!ids.has(m[2]),'unique HTML IDs');ids.set(m[2],new Element(m[1],m[2]))}
const document={getElementById:id=>ids.get(id),createElement:tag=>new Element(tag),hidden:false,activeElement:null,addEventListener(){}};
const events={},storage=new Map();let now=1000,renderer;
const oldSave={x:0,z:10,yaw:Math.PI,hp:63,level:3,xp:42,gold:78,potions:4,quest:10,kills:3,relic:false,inventory:[{id:'feather',qty:13},{id:'charm',qty:2},...Array(10).fill(null)],bags:[null,null,null,null],equipment:{head:null,shoulders:null,chest:null,wrists:null,hands:null,waist:null,legs:null,feet:null}};
storage.set('nexgame-mulgore-alpha02',JSON.stringify(oldSave));storage.set('nexgame-real3d-camera-follow','1');storage.set('nexgame-real3d-camera-distance','13.4');
class Renderer{
 constructor(){renderer=this;this.domElement=new Element('canvas');this.shadowMap={};this.calls=[];this.domElement.getContext()}
 setSize(w,h){this.w=w;this.h=h;this.domElement.width=w;this.domElement.height=h}
 setPixelRatio(r){this.ratio=r;if(this.w){this.domElement.width=Math.floor(this.w*r);this.domElement.height=Math.floor(this.h*r)}}getPixelRatio(){return this.ratio}
 setViewport(...args){this.viewport=args}setScissor(...args){this.scissor=args}setScissorTest(b){this.scissorTest=b}
 render(scene,camera){this.calls.push(scene);scene.updateMatrixWorld(true);camera.updateMatrixWorld(true)}
}
const context={console,URLSearchParams,Math,Number,JSON,Date,Set,Map,Object,Float32Array,performance:{now:()=>now},innerWidth:1280,innerHeight:720,devicePixelRatio:1.5,requestAnimationFrame(){},setTimeout(){},clearTimeout(){},HTMLButtonElement:Element,localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},document,addEventListener:(k,fn)=>events[k]=fn,__DATA:data,__THREE:{...Three,WebGLRenderer:Renderer}};
vm.createContext(context);
let source=fs.readFileSync(folder+'/game.js','utf8').replace(/^import \{([^}]+)\} from [^;]+;/, 'const {$1}=__DATA;').replace("THREE=await import('https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js')","THREE=__THREE");
const exposed='scene,world,M,hero,mentor,trader,camera,camFocus,enemies,keys,joy,update,movement,frame,animateTauren,animateCamera,attack,stomp,heal,mentorTalk,closeDialog,resetWorld,clearAt,heightAt,save,setCameraDistance,setCameraFollow,openDialog,bag,renderInventory,discardInventorySlot,storeItem,canStoreItem,showCorpseLoot,damageEnemy,setTarget,cycleTarget,updateHealthRegen,initial,getState:()=>state,setState:s=>{state={...state,...s}},getSelected:()=>selected,getModal:()=>modalKind,getCamera:()=>({cameraYaw,cameraPitch,cameraDistance,cameraFollow}),setPitch:v=>cameraPitch=v';
const extra=source.includes('function character()')?',settings,setGraphicsQuality,setShowFps,sampleFps,grass,grassCount,character,ensureCharacterView,renderCharacterPreview,normalizeEquipment,EQUIPMENT_SLOTS,getView:()=>characterView,armorer,npcs,interact,nearTarget,playerStats,rollMeleeDamage,incomingDamage,equipInventorySlot,unequipSlot,merchantTalk,renderMerchant,buyItem,sellItem,buyBackItem,rollCorpseLoot,normalizeInventory,ITEM_CATALOG,startingEquipment,getCombat:()=>({attackCooldown,attackElapsed}),setCombat:v=>{lastCombatAt=v?clock:-100;enemies.forEach((e,i)=>e.aggro=!!v&&i===0&&e.dead<=0)}':'';
source=source.replace("}catch(error){const text=$('loadText');",'globalThis.qa={'+exposed+extra+"};}catch(error){const text=$('loadText');");
vm.runInContext(source,context);const q=context.qa;assert.ok(q,'game initialized');
const checks=[];const check=(name,fn)=>{fn();checks.push(name)};
const walk=(el)=>[el,...el.children.flatMap(walk)];
const findButton=text=>[...walk(ids.get('mbody')),...walk(ids.get('choices'))].find(el=>el.tagName==='BUTTON'&&el.textContent?.includes(text));
const emptyBag=()=>Array(12).fill(null);
const reset=()=>{q.resetWorld();q.setCombat(false)};
check('0.2.9 save migration preserves all existing progress and adds starter weapon once',()=>{
 for(const [key,value] of Object.entries(oldSave)){if(key==='equipment'){for(const slot of Object.keys(value))assert.equal(q.getState().equipment[slot],null)}else assert.equal(JSON.stringify(q.getState()[key]),JSON.stringify(value),key);}
 assert.equal(Object.keys(q.getState().equipment).length,10);assert.equal(q.getState().equipment.weapon.id,'wornAxe');assert.equal(q.getState().equipment.shield,null);
 assert.equal(q.getCamera().cameraFollow,true);assert.equal(q.getCamera().cameraDistance,13.4);
 q.save();const saved=JSON.parse(storage.get('nexgame-mulgore-alpha02'));assert.equal(saved.equipment.weapon.id,'wornAxe');
});
check('catalog matches supported slots; grey items have no primary bonuses; all vendor items sell for less',()=>{
 const slots=new Set(q.EQUIPMENT_SLOTS.map(x=>x.id));
 for(const [id,item] of Object.entries(data.ITEM_CATALOG)){
  assert.ok(Number.isInteger(item.sell)&&item.sell>0,id);
  if(item.slot){assert.ok(slots.has(item.slot),id);assert.equal(data.itemStackLimit(id),1);assert.ok(item.sourceId>0)}
  if(item.rarity==='poor'){assert.ok(!item.strength);assert.ok(!item.stamina)}
  if(item.buy)assert.ok(item.buy>item.sell,id);
 }
 for(const id of data.MERCHANT_STOCK)assert.ok(data.ITEM_CATALOG[id].buy>0);
});
check('strength/AP, stamina/HP, weapon speed and armor/block formulas',()=>{
 const bare=data.deriveStats(1,{});assert.equal(bare.maxHp,120);assert.equal(bare.strength,28);assert.equal(bare.attackPower,39);assert.equal(bare.blockChance,0);
 const base=data.deriveStats(6,{weapon:{id:'wornAxe'}}),upgraded=data.deriveStats(6,{chest:{id:'warriorTunic'},legs:{id:'warriorPants'},weapon:{id:'scalpingStrength'},shield:{id:'infantryBear'}});
 assert.equal(upgraded.maxHp,base.maxHp+20);assert.equal(upgraded.strength,base.strength+4);assert.equal(upgraded.attackPower,base.attackPower+8);assert.equal(upgraded.speed,1.8);assert.ok(upgraded.dps>base.dps);assert.equal(upgraded.blockChance,.05);
 assert.equal(data.armorReduction(0,1),0);assert.ok(data.armorReduction(200,1)>data.armorReduction(200,5));assert.equal(data.armorReduction(999999,1),.75);
});
check('all equipment outcomes and reproducible 6%/1%, 18%/6% distributions',()=>{
 for(const boss of [false,true]){
  const expected=data.LOOT_CHANCES[boss?'boss':'normal'],counts={poor:0,uncommon:0,none:0};
  for(let i=0;i<10000;i++){let n=0;const item=data.rollEquipmentLoot(boss,()=>n++===0?(i+.5)/10000:.49);counts[item?data.ITEM_CATALOG[item.id].rarity:'none']++}
  assert.equal(counts.poor,expected.poor*10000);assert.equal(counts.uncommon,expected.uncommon*10000);
  for(const [quality,pool] of Object.entries(data.GEAR_LOOT))for(let i=0;i<pool.length;i++){
   let n=0;const rolls=[quality==='uncommon'?expected.uncommon/2:expected.uncommon+expected.poor/2,(i+.5)/pool.length,.9];
   const item=data.rollEquipmentLoot(boss,()=>rolls[n++]);assert.equal(item.id,pool[i]);assert.equal(item.qty,1);
  }
 }
 let n=0;const rolls=[.001,.6,.2];assert.equal(data.rollEquipmentLoot(false,()=>rolls[n++]).id,'scalpingStamina');
});
check('equipment can drop even if common-material roll fails; corpse looting does not reroll',()=>{
 reset();const original=Math.random;let rolls=[.02,0,.99];Math.random=()=>rolls.shift()??.99;
 try{assert.equal(q.rollCorpseLoot()[0].id,'chainVest');const e=q.enemies[0];q.setState({x:e.spawnX,z:e.spawnZ+1});rolls=[.02,0,.99];q.damageEnemy(e,999);assert.equal(e.loot[0].id,'chainVest');const copy=JSON.stringify(e.loot);q.showCorpseLoot(e);q.closeDialog();q.showCorpseLoot(e);assert.equal(JSON.stringify(e.loot),copy);findButton('Забрать всё').click();assert.equal(e.loot.length,0);assert.ok(q.getState().inventory.some(x=>x?.id==='chainVest'))}finally{Math.random=original}
});
check('looted chain belt equips immediately after the last kill, while backpack pauses the world',()=>{
 reset();const e=q.enemies[0];q.setState({x:e.spawnX,z:e.spawnZ+1});q.damageEnemy(e,999);e.loot=[{id:'chainBelt',qty:1}];q.showCorpseLoot(e);findButton('Забрать всё').click();q.bag();
 const beltCell=walk(ids.get('mbody')).find(el=>el.tagName==='BUTTON'&&el.getAttribute('aria-label')?.includes('Тонкий кольчужный пояс'));
 assert.ok(beltCell);beltCell.click();const equip=findButton('Надеть · Пояс');assert.ok(equip);equip.click();
 assert.equal(q.getState().equipment.waist?.id,'chainBelt','the looted belt must equip without closing the backpack and waiting');
 assert.equal(q.playerStats().armor,24);q.save();assert.equal(JSON.parse(storage.get('nexgame-mulgore-alpha02')).equipment.waist.id,'chainBelt');
 const backpackIcon=beltCell.children.find(el=>el.className==='slot-icon').textContent;q.character();
 let waist=walk(ids.get('mbody')).find(el=>el.dataset.slot==='waist');const icon=waist.children.find(el=>el.className==='equipment-item-icon');
 assert.ok(icon,'equipped belt must show an item image');assert.equal(icon.textContent,backpackIcon);assert.equal(icon.dataset.item,'chainBelt');assert.equal(waist.dataset.rarity,'poor');assert.equal(waist.children.find(el=>el.tagName==='SMALL').textContent,'Тонкий кольчужный пояс');
 waist.click();findButton('Снять в рюкзак').click();waist=walk(ids.get('mbody')).find(el=>el.dataset.slot==='waist');assert.ok(!waist.children.some(el=>el.className==='equipment-item-icon'));assert.ok(waist.innerHTML.includes('<svg'));assert.equal(waist.children.find(el=>el.tagName==='SMALL').textContent,'Пусто');
});
check('another living attacker still prevents changing equipment; last kill releases the restriction',()=>{
 reset();q.storeItem({id:'chainBelt',qty:1});q.setCombat(true);const first=q.enemies[0],second=q.enemies[1];second.aggro=true;
 assert.equal(q.equipInventorySlot(0),false);q.damageEnemy(first,999);assert.equal(q.equipInventorySlot(0),false);assert.equal(q.getState().equipment.waist,null);
 q.damageEnemy(second,999);assert.ok(q.equipInventorySlot(0));assert.equal(q.getState().equipment.waist.id,'chainBelt');
});
check('the first swing is combat even before impact; opening a bag cannot bypass it',()=>{
 reset();const e=q.enemies[0];q.setState({x:e.spawnX,z:e.spawnZ+2});q.hero.root.position.set(q.getState().x,0,q.getState().z);q.hero.root.rotation.y=Math.PI;q.storeItem({id:'chainBelt',qty:1});q.setTarget(e);q.attack();assert.equal(e.aggro,false);q.bag();assert.equal(q.equipInventorySlot(0),false);assert.equal(q.getState().equipment.waist,null);
});
check('immediate post-fight equipment does not remove the five-second regeneration delay',()=>{
 reset();q.setState({hp:60});q.damageEnemy(q.enemies[0],999);q.storeItem({id:'chainBelt',qty:1});assert.ok(q.equipInventorySlot(0));q.bag();const snapshot=JSON.stringify(q.getState());q.frame(10000);assert.equal(JSON.stringify(q.getState()),snapshot,'world and health still pause');q.closeDialog();
 q.update(4.9);assert.equal(q.getState().hp,60);q.update(.11);assert.ok(q.getState().hp>60);assert.equal(q.getState().equipment.waist.id,'chainBelt');
});
check('new armorer is reachable, pass-through, distinct and actually opens trade',()=>{
 reset();assert.equal(q.npcs.length,3);assert.ok(q.clearAt(6,11));q.setState({x:6,z:11});assert.equal(q.nearTarget().npc.type,'armorer');q.interact();assert.equal(q.getModal(),'merchant');assert.equal(ids.get('panel').classList.contains('merchant-modal'),true);assert.equal(ids.get('modalClose').hidden,false);
 assert.equal(q.buyItem('chainVest'),false);q.setState({gold:40});const buy=findButton('Купить · 32');assert.ok(buy);q.renderMerchant();findButton('Купить · 32').click();assert.equal(q.getState().gold,8);assert.equal(q.getState().inventory[0].id,'chainVest');
 q.closeDialog();assert.equal(ids.get('panel').classList.contains('merchant-modal'),false);assert.equal(q.buyItem('wornAxe'),false);
});
check('full backpack: buying and taking loot are atomic; equipment never stacks',()=>{
 reset();q.setState({x:6,z:11,gold:500,inventory:Array.from({length:12},()=>({id:'feather',qty:20}))});q.merchantTalk();const before=JSON.stringify(q.getState());assert.equal(q.buyItem('bentShield'),false);assert.equal(q.storeItem({id:'chainVest',qty:1}),false);assert.equal(JSON.stringify(q.getState()),before);
 q.setState({inventory:emptyBag()});assert.ok(q.storeItem({id:'bentShield',qty:2}));assert.equal(q.getState().inventory[0].qty,1);assert.equal(q.getState().inventory[1].qty,1);
 assert.ok(q.storeItem({id:'feather',qty:21}));assert.equal(q.getState().inventory[2].qty,20);assert.equal(q.getState().inventory[3].qty,1);
});
check('full-backpack gear swaps use the vacated cell, unequip needs a free cell',()=>{
 reset();q.setState({level:6,inventory:Array.from({length:12},(_,i)=>({id:i===0?'rustyHatchet':'feather',qty:1}))});assert.ok(q.equipInventorySlot(0));assert.equal(q.getState().equipment.weapon.id,'rustyHatchet');assert.equal(q.getState().inventory[0].id,'wornAxe');const copy=JSON.stringify(q.getState());assert.equal(q.unequipSlot('weapon'),false);assert.equal(JSON.stringify(q.getState()),copy);
 q.discardInventorySlot(1);assert.ok(q.unequipSlot('weapon'));assert.equal(q.getState().equipment.weapon,null);assert.equal(q.getState().inventory[1].id,'rustyHatchet');assert.equal(q.hero.root.getObjectByName('gear-axe').visible,false);
 assert.equal(Object.values(q.normalizeEquipment({head:{id:'feather'},weapon:{id:'chainVest'},feet:{id:'bad'}})).filter(Boolean).length,0);
});
check('level and combat restrictions; equipping/unequipping stamina cannot heal',()=>{
 reset();q.storeItem({id:'warriorPants',qty:1});assert.equal(q.equipInventorySlot(0),false);q.setState({level:6,hp:170});q.setCombat(true);assert.equal(q.equipInventorySlot(0),false);q.setCombat(false);assert.ok(q.equipInventorySlot(0));assert.equal(q.playerStats().maxHp,230);assert.equal(q.getState().hp,170);q.setState({hp:230});assert.ok(q.unequipSlot('legs'));assert.equal(q.getState().hp,220);assert.ok(q.equipInventorySlot(0));assert.equal(q.getState().hp,220);
 q.setState({hp:200,potions:1});assert.ok(q.heal(true));assert.equal(q.getState().hp,230);q.setState({hp:228});q.updateHealthRegen(1);assert.equal(q.getState().hp,230);
});
check('armor reduces actual enemy damage, shields block only from the front',()=>{
 reset();const e=q.enemies[0];q.setState({x:0,z:10});e.root.position.set(0,0,12);q.hero.root.rotation.y=0;
 const unarmored=q.incomingDamage(e,9,()=>.99);q.storeItem({id:'chainVest',qty:1});q.equipInventorySlot(0);assert.ok(q.incomingDamage(e,9,()=>.99)<unarmored);
 q.storeItem({id:'bentShield',qty:1});q.equipInventorySlot(0);const armorHit=q.incomingDamage(e,9,()=>.99),block=q.incomingDamage(e,9,()=>0);assert.ok(block<armorHit);
 q.hero.root.rotation.y=Math.PI;assert.equal(q.incomingDamage(e,9,()=>0),armorHit);
});
check('autoattack uses equipped damage range and attack speed',()=>{
 reset();q.setState({level:6});q.storeItem({id:'scalpingStrength',qty:1});q.equipInventorySlot(0);q.closeDialog();const e=q.enemies[0];q.setState({x:e.spawnX,z:e.spawnZ+2});q.hero.root.position.set(q.getState().x,0,q.getState().z);q.hero.root.rotation.y=Math.PI;q.setTarget(e);q.attack();assert.equal(q.getCombat().attackCooldown,1.8);const hp=e.hp;for(let i=0;i<8;i++)q.update(.05);const amount=hp-e.hp;assert.ok(amount>=Math.round(q.playerStats().damageMin)&&amount<=Math.round(q.playerStats().damageMax),String(amount));
});
check('sales, stale-button protection, persistent buyback and no buy/sell arbitrage',()=>{
 reset();q.setState({x:6,z:11,gold:60});q.merchantTalk();assert.ok(q.buyItem('bentShield'));assert.equal(q.getState().gold,36);const row=q.getState().inventory[0];assert.ok(q.sellItem(0,row));assert.equal(q.getState().gold,40);assert.equal(q.sellItem(0,row),false);assert.equal(q.getState().buyback.length,1);const offer=q.getState().buyback[0];assert.ok(q.buyBackItem(0,offer));assert.equal(q.getState().gold,36);assert.equal(q.buyBackItem(0,offer),false);
 q.storeItem({id:'feather',qty:13});assert.ok(q.sellItem(1));assert.equal(q.getState().buyback[0].qty,13);q.save();assert.equal(JSON.parse(storage.get('nexgame-mulgore-alpha02')).buyback[0].qty,13);
 q.setState({inventory:Array.from({length:12},()=>({id:'feather',qty:20}))});const copy=JSON.stringify(q.getState());assert.equal(q.buyBackItem(0),false);assert.equal(JSON.stringify(q.getState()),copy);
 reset();assert.equal(q.getState().buyback.length,0);assert.equal(q.initial.buyback.length,0);
});
check('10 UI slots, item comparison/equip actions, preview visual sync and shared resources',()=>{
 reset();q.setState({level:6});q.storeItem({id:'feebleSword',qty:1});q.storeItem({id:'infantryBear',qty:1});q.bag();const cells=walk(ids.get('mbody')).filter(x=>x.className.includes('inventory-slot')&&x.tagName==='BUTTON');cells[0].click();assert.ok(findButton('Надеть'));findButton('Надеть').click();assert.equal(q.getState().equipment.weapon.id,'feebleSword');q.equipInventorySlot(1);q.character();
 const buttons=walk(ids.get('mbody')).filter(x=>x.className.includes('equipment-slot'));assert.equal(buttons.length,10);assert.ok(buttons.find(x=>x.dataset.slot==='shield'));
 for(const [slot,id] of [['weapon','feebleSword'],['shield','infantryBear']]){const button=buttons.find(x=>x.dataset.slot===slot),icon=button.children.find(x=>x.className==='equipment-item-icon');assert.equal(icon.dataset.item,id);assert.equal(icon.textContent,data.ITEM_CATALOG[id].icon);assert.equal(button.dataset.rarity,data.ITEM_CATALOG[id].rarity)}
 const view=q.getView();assert.equal(view.actor.root.getObjectByName('gear-sword').visible,true);assert.equal(view.actor.root.getObjectByName('gear-axe').visible,false);assert.equal(view.actor.root.getObjectByName('gear-shield').visible,true);
 buttons.find(x=>x.dataset.slot==='shield').click();findButton('Снять в рюкзак').click();assert.equal(q.getState().equipment.shield,null);assert.equal(q.getView().actor.root.getObjectByName('gear-shield').visible,false);
 const saved=JSON.stringify(q.getState());q.frame(1200);assert.equal(JSON.stringify(q.getState()),saved);assert.equal(renderer.scissorTest,false);assert.equal(renderer.shadowMap.enabled,true);
});
check('save reload retains items, explicit empty weapon, buyback and HP above old health cap',()=>{
 reset();q.setState({level:6,hp:220,x:6,z:11,gold:200});q.storeItem({id:'warriorPants',qty:1});q.equipInventorySlot(0);q.setState({hp:230});q.unequipSlot('weapon');q.merchantTalk();q.storeItem({id:'feather',qty:3});q.sellItem(1);q.save();
 const snapshot=JSON.stringify(q.getState());const context2={...context,Math};vm.createContext(context2);vm.runInContext(source,context2);const reload=context2.qa.getState();assert.equal(reload.hp,230);assert.equal(reload.equipment.weapon,null);assert.equal(reload.equipment.legs.id,'warriorPants');assert.equal(reload.buyback[0].id,'feather');assert.equal(JSON.stringify(reload),snapshot);
});
check('quest, camera pitch and movement remain operational',()=>{
 reset();q.setPitch(.73);q.setCameraFollow(true);q.animateCamera(1);assert.equal(q.getCamera().cameraPitch,.73);q.keys.add('w');for(let i=0;i<40;i++)q.update(.05);q.keys.clear();assert.ok(q.getState().z<5);q.setState({quest:10});q.damageEnemy(q.enemies.find(e=>e.boss),999);assert.equal(q.getState().quest,11);assert.ok(q.enemies.find(e=>e.boss).loot.some(x=>x.id==='giantFeather'));
});
console.log(JSON.stringify({ok:true,version:'0.3.1',checks},null,2));
