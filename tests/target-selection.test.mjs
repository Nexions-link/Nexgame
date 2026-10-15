import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
 TARGET_ACQUISITION_RADIUS,targetDistance2D,targetsByProximity,
 nextTargetByProximity,targetIsInRange
} from '../target-selection.js';
const source=path=>readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)),'utf8');
const enemy=(id,x,z,hp=30,dead=0)=>({id,index:id,root:{position:{x,z}},hp,dead});
const alive=e=>e.hp>0&&e.dead<=0;
const player={x:0,z:0};
test('only living enemies at 40 metres or closer may be targeted',()=>{
 const near=enemy(1,3,4),edge=enemy(2,40,0),outside=enemy(3,40.001,0),
  dead=enemy(4,1,0,0,12),missing={id:7,root:{position:{x:NaN,z:0}},hp:1,dead:0};
 assert.equal(TARGET_ACQUISITION_RADIUS,40);
 assert.equal(targetDistance2D(player,near),5);
 assert.equal(targetIsInRange(edge,player),true);
 assert.equal(targetIsInRange(outside,player),false);
 assert.deepEqual(targetsByProximity([outside,edge,dead,near,missing],player,alive),[near,edge]);
 assert.deepEqual(targetsByProximity([outside],player,alive),[]);
});
test('first press locks nearest, further presses follow distance and wrap around',()=>{
 const distant=enemy(0,33,0),closest=enemy(1,2,0),middle=enemy(2,15,0);
 const mixed=[distant,middle,closest];
 assert.equal(nextTargetByProximity(mixed,null,player,alive),closest);
 assert.equal(nextTargetByProximity(mixed,closest,player,alive),middle);
 assert.equal(nextTargetByProximity(mixed,middle,player,alive),distant);
 assert.equal(nextTargetByProximity(mixed,distant,player,alive),closest);
 assert.equal(nextTargetByProximity(mixed,closest,player,alive,-1),distant);
});
test('distance is recalculated when the player moves or a target dies',()=>{
 const a=enemy(0,4,0),b=enemy(1,30,0);
 assert.equal(nextTargetByProximity([b,a],null,player,alive),a);
 assert.equal(nextTargetByProximity([b,a],null,{x:38,z:0},alive),b);
 a.hp=0;
 assert.equal(nextTargetByProximity([b,a],null,player,alive),b);
 assert.equal(nextTargetByProximity([a],null,player,alive),null);
});
test('equidistant enemies use stable world order, not arbitrary selection',()=>{
 const a=enemy(3,0,10),b=enemy(1,10,0),c=enemy(2,0,-10);
 assert.deepEqual(targetsByProximity([a,b,c],player,alive),[a,b,c]);
 assert.equal(nextTargetByProximity([a,b,c],a,player,alive),b);
});
test('out-of-range old selection does not block the nearest valid target',()=>{
 const far=enemy(0,41,0),near=enemy(1,16,0);
 assert.equal(nextTargetByProximity([far,near],far,player,alive),near);
 assert.equal(nextTargetByProximity([far],null,player,alive),null);
});
test('all hostile acquisition paths use the same 40 m boundary',()=>{
 const game=source('game.js');
 assert.match(game,/const MELEE_RANGE=3\.45,TARGET_RANGE=TARGET_ACQUISITION_RADIUS/);
 assert.match(game,/return targetsByProximity\(enemies,targetPosition\(\),isAliveTarget\)\[0\]\|\|null/);
 assert.match(game,/nextTargetByProximity\(enemies,selected,targetPosition\(\),isAliveTarget,step\)/);
 assert.match(game,/if\(isAliveTarget\(e\)&&!validTargetInRange\(e\)\)return false/);
 assert.match(game,/if\(selected&&!validTargetInRange\(selected\)\)clearTarget\(\)/);
 assert.match(game,/if\(!e\)return false; \/\/ Beyond 40 metres/);
 assert.match(game,/const living=validTargetInRange\(selected\)/);
 assert.match(game,/selection\.visible=validTargetInRange\(selected\)/);
 assert.match(source('app.html'),/радиусе 40 метров/);
});
