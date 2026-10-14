import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Exercise the actual game.js touch/mouse event handlers with deterministic
// raycast hits, including the same multitouch constraints as mobile Safari.
const script=readFileSync(fileURLToPath(new URL('../game.js',import.meta.url)),'utf8');
const from="const canvas=renderer.domElement,pickRay=new THREE.Raycaster();canvas.style.touchAction='none';";
const to="canvas.addEventListener('contextmenu'";
const start=script.indexOf(from),end=script.indexOf(to,start);
assert.ok(start>=0&&end>start,'Game world pointer handlers must exist');
const source=script.slice(start,end);
const scene={name:'scene'};
const root=name=>({name,parent:scene,visible:true});
const enemy={root:root('enemy'),hp:54,dead:0,corpseAge:0};
const dummy={root:root('dummy'),hp:99999,dead:0,corpseAge:0};
const corpse={root:root('corpse'),hp:0,dead:55,corpseAge:1};
const hero={root:root('hero')},npc={actor:{root:root('npc')},nameTag:root('npcName')};
const resource={root:root('resource')};
const relic=root('relic'),merchantLabel=root('merchantLabel');
const questMarker=root('questMarker'),herbalistMarker=root('herbalistMarker');
const targets={enemy:enemy.root,dummy:dummy.root,corpse:corpse.root,resource:resource.root,
 hero:hero.root,npc:npc.actor.root,npcName:npc.nameTag,relic,merchantLabel,questMarker,herbalistMarker};
const children=Object.fromEntries(Object.entries(targets).map(([key,value])=>[key,{parent:value}]));
const canvas={handlers:{},style:{},addEventListener(type,fn){(this.handlers[type]??=[]).push(fn)},
 emit(type,args={}){const event={pointerId:8,pointerType:'touch',button:0,clientX:500,clientY:300,...args};
  for(const fn of this.handlers[type]||[])fn(event)},
 setPointerCapture(){},hasPointerCapture(){return false},releasePointerCapture(){}};
let now=1000,mode='empty',clears=0,selects=0,loots=0,harvests=0,finishes=0;
const ctx={
 scene,renderer:{domElement:canvas},hero,npcs:[npc],relic,merchantLabel,questMarker,herbalistMarker,
 gatherNodes:[resource],enemies:[enemy,dummy,corpse],
 look:{id:null,x:0,y:0,startX:0,startY:0,selectOnly:false},
 modalKind:null,selected:enemy,autoAttack:true,joy:{id:45,y:-1},
 innerWidth:1000,innerHeight:700,camera:{},cameraYaw:0,cameraPitch:.5,cameraFollowCooldown:0,
 cameraSlider:{blur(){}},document:{activeElement:null},performance:{now:()=>now},
 THREE:{Vector2:class {constructor(x,y){this.x=x;this.y=y}},
 Raycaster:class {setFromCamera(){} intersectObjects(objects){
  const item=targets[mode];return item&&objects.includes(item)?[{object:children[mode]}]:[];
 }}},
 wrapYaw:n=>n,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),
 gatherNodeAvailable:()=>true,showCorpseLoot:()=>loots++,
 startGather:()=>{harvests++;return true},
 setTarget:target=>{ctx.selected=target;selects++},
 clearTarget:()=>{ctx.selected=null;ctx.autoAttack=false;clears++},
 finishLook:()=>{ctx.look.id=null;finishes++},
};
const api=new Function('ctx','with(ctx){'+source+'\nreturn {handleWorldTap};}')(ctx);
const checks=[];
function test(label,fn){fn();checks.push(label)}
function tap(hit='empty',options={}){
 mode=hit;
 canvas.emit('pointerdown',{pointerId:12,clientX:500,clientY:300,...options.down});
 now+=(options.wait??80);
 for(const [x,y] of options.moves||[])canvas.emit('pointermove',{pointerId:12,clientX:x,clientY:y});
 canvas.emit('pointerup',{pointerId:12,clientX:options.upX??500,clientY:options.upY??300});
}
test('short tap on empty terrain drops target and stops autoattack',()=>{
 tap();assert.equal(ctx.selected,null);assert.equal(ctx.autoAttack,false);assert.equal(clears,1);
});
test('the joystick is not released by a different finger tapping the world',()=>{
 assert.equal(ctx.joy.id,45);assert.equal(ctx.joy.y,-1);
});
test('empty tap with no selected enemy is harmless',()=>{tap();assert.equal(clears,1)});
test('tapping the training dummy selects instead of clearing',()=>{
 ctx.selected=enemy;tap('dummy');assert.equal(ctx.selected,dummy);assert.equal(selects,1);
});
test('tapping an enemy selects it',()=>{
 tap('enemy');assert.equal(ctx.selected,enemy);assert.equal(selects,2);
});
test('corpse tap opens loot, keeping target',()=>{
 tap('corpse');assert.equal(loots,1);assert.equal(ctx.selected,enemy);
});
test('gatherable tap starts collection, keeping target',()=>{
 tap('resource');assert.equal(harvests,1);assert.equal(ctx.selected,enemy);
});
for(const key of ['npc','hero','relic','npcName','merchantLabel','questMarker','herbalistMarker']){
 test('tapping '+key+' does not clear selected unit',()=>{
  tap(key);assert.equal(ctx.selected,enemy);assert.equal(clears,1);
 });
}
test('camera dragging never clears targets',()=>{
 tap('empty',{moves:[[520,300]],upX:520});assert.equal(ctx.selected,enemy);
});
test('a camera gesture that returns to its starting position still does not clear',()=>{
 tap('empty',{moves:[[507,300],[500,300]]});assert.equal(ctx.selected,enemy);
});
test('a long press does not deselect accidentally',()=>{
 tap('empty',{wait:520});assert.equal(ctx.selected,enemy);
});
test('cancelled touch does not deselect',()=>{
 canvas.emit('pointerdown',{pointerId:21});
 canvas.emit('pointercancel',{pointerId:21});
 assert.equal(ctx.selected,enemy);
});
test('multi-touch on the canvas does not deselect',()=>{
 canvas.emit('pointerdown',{pointerId:26});
 canvas.emit('pointerdown',{pointerId:27});
 canvas.emit('pointerup',{pointerId:26});
 canvas.emit('pointerup',{pointerId:27});
 assert.equal(ctx.selected,enemy);
});
test('modal dialogs block world taps',()=>{
 ctx.modalKind='inventory';tap();assert.equal(ctx.selected,enemy);ctx.modalKind=null;
});
test('right mouse button is not treated as a tap',()=>{
 canvas.emit('pointerdown',{pointerId:31,button:2});
 canvas.emit('pointerup',{pointerId:31,button:2});
 assert.equal(ctx.selected,enemy);
});
test('a new short tap on empty ground clears the selected enemy',()=>{
 tap();assert.equal(ctx.selected,null);assert.equal(clears,2);
});
test('pointer ownership is released after the gesture',()=>{
 assert.equal(ctx.look.id,null);assert.ok(finishes>0);
});
assert.equal(clears,2,'No unexpected target clear');
console.log('Targeting click-to-clear regression tests passed: '+checks.length+' cases.');
