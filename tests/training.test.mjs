import assert from 'node:assert/strict';
import {
 TRAINING_DUMMY,createTrainingStats,resetTrainingTarget,
 applyTrainingHit,updateTrainingTarget,trainingDps
} from '../training.js';
const checks=[];
function test(title,fn){fn();checks.push(title)}
const target=()=>({kind:'trainingDummy',trainingDummy:true,name:TRAINING_DUMMY.name,
 maxHp:TRAINING_DUMMY.maxHp,hp:TRAINING_DUMMY.maxHp,
 trainingStats:createTrainingStats(),dead:0,aggro:false,loot:[]});
test('dummy is placed inside camp with 99,999 HP',()=>{
 assert.equal(TRAINING_DUMMY.name,'Тренировочный манекен');
 assert.equal(TRAINING_DUMMY.x,-7);assert.equal(TRAINING_DUMMY.z,15);
 assert.equal(TRAINING_DUMMY.maxHp,99999);
 assert.equal(TRAINING_DUMMY.resetAfter,3);
});
test('regular attacks record a hit and its ability without aggro',()=>{
 const d=target();
 assert.equal(applyTrainingHit(d,35,2,'autoAttack'),35);
 assert.equal(d.hp,99964);
 assert.equal(d.trainingStats.hits,1);
 assert.equal(d.trainingStats.totalDamage,35);
 assert.equal(d.trainingStats.lastAbility,'autoAttack');
 assert.equal(d.aggro,false);
});
test('different abilities contribute to the same damage session',()=>{
 const d=target();
 applyTrainingHit(d,20,0,'autoAttack');
 applyTrainingHit(d,40,2,'heavyStrike');
 applyTrainingHit(d,6,2.4,'thunderStomp');
 assert.equal(d.trainingStats.hits,3);
 assert.equal(d.trainingStats.totalDamage,66);
 assert.equal(d.trainingStats.lastDamage,6);
 assert.equal(d.trainingStats.lastAbility,'thunderStomp');
 assert.equal(trainingDps(d),27.5);
});
test('target cannot die even from catastrophic damage',()=>{
 const d=target();
 assert.equal(applyTrainingHit(d,500000,0),99998);
 assert.equal(d.hp,1);assert.equal(d.dead,0);
 assert.equal(applyTrainingHit(d,1000,1),0);
 assert.equal(d.hp,1);
 assert.equal(d.trainingStats.hits,2);
});
test('health does not reset until 3 seconds pass',()=>{
 const d=target();applyTrainingHit(d,300,10);
 assert.equal(updateTrainingTarget(d,12.99),false);
 assert.equal(d.hp,99699);
 assert.equal(updateTrainingTarget(d,13),true);
 assert.equal(d.hp,d.maxHp);
 assert.equal(d.trainingStats.restored,true);
 assert.equal(updateTrainingTarget(d,13.2),false);
 assert.equal(d.trainingStats.hits,1,'keep last session stats for inspection');
});
test('new hits after the idle reset start fresh statistics',()=>{
 const d=target();applyTrainingHit(d,300,5);
 updateTrainingTarget(d,8);
 assert.equal(applyTrainingHit(d,42,8.5,'heavyStrike'),42);
 assert.equal(d.trainingStats.hits,1);
 assert.equal(d.trainingStats.totalDamage,42);
 assert.equal(d.trainingStats.lastAbility,'heavyStrike');
 assert.equal(d.hp,99957);
});
test('new hits start fresh even when HP was already full',()=>{
 const d=target();
 applyTrainingHit(d,4,10);
 applyTrainingHit(d,1,13.2);
 assert.equal(d.trainingStats.hits,1);
 assert.equal(d.trainingStats.totalDamage,1);
});
test('manual reset restores HP and clears previous session',()=>{
 const d=target();
 applyTrainingHit(d,80,10);
 resetTrainingTarget(d);
 assert.equal(d.hp,d.maxHp);
 assert.equal(d.trainingStats.hits,0);
 assert.equal(d.trainingStats.totalDamage,0);
 assert.equal(trainingDps(d),0);
});
test('invalid values and non-dummies never cause damage',()=>{
 const d=target();
 assert.equal(applyTrainingHit(d,NaN,2),0);
 assert.equal(applyTrainingHit(d,-1,2),0);
 assert.equal(applyTrainingHit({...d,trainingDummy:false},20,2),0);
 assert.equal(updateTrainingTarget({...d,trainingDummy:false},100),false);
 assert.equal(d.hp,99999);
});
console.log('NexGame training dummy tests passed: '+checks.length+' groups.');
