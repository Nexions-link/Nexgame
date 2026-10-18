import test from 'node:test';
import assert from 'node:assert/strict';
import {createSphericalMobs,applySphereAttack,localToNormal} from '../spherical-pve.js';
import {validateKillCredit,readProgress} from '../progress-rules.js';
import {getBanditQuest,creditBanditQuestKill,acceptBanditQuest,turnInBanditQuest,
 BANDIT_QUEST_REWARD,BANDIT_QUEST_MIN_LEVEL,acceptBanditChiefQuest,creditBanditChiefKill,
 getBanditChiefQuest,turnInBanditChiefQuest,BANDIT_CHIEF_REWARD} from '../bandit-quest.js';
import {CREATURE_SPAWNS,BANDIT_SPAWNS,BANDIT_QUEST_GIVER,creatureById} from '../../planet-test/creature-registry.js';
import {canWalkCamp} from '../../planet-test/sphere-physics.js';
import {canWadeAtLocal} from '../../planet-test/start-zone.js';
const EPOCH='0de0fdc8-5ea3-4b10-8931-6a3c2900f4a2';
const context=at=>({normal:localToNormal(at.x,at.z,261),radius:261,inCombat:false});
const state=()=>readProgress({schemaVersion:1,revision:'0',level:2,experience:0,
 gold:30,health:120,resource:0,worldRadius:261,positionNormal:[0,0,1],heading:0,
 inventory:Array(12).fill(null),equipment:{},quests:{},actionBar:[]});
test('14 uniquely identified PvE creatures have valid spawns and 4 distinct bandits',()=>{
 const mobs=createSphericalMobs();
 assert.equal(mobs.length,14);
 assert.equal(new Set(mobs.map(x=>x.id)).size,14);
 const bandits=mobs.filter(x=>x.family==='bandit');
 assert.deepEqual(bandits.map(x=>x.id),['bandit-0','bandit-1','bandit-2','bandit-3']);
 assert.deepEqual(bandits.map(x=>x.level),[2,2,3,5]);
 assert.ok(bandits.every(x=>x.creatureType==='humanoid'));
 assert.equal(bandits[3].boss,true);
 assert.ok(mobs.slice(0,10).every(x=>x.creatureType==='beast'));
 for(const spec of CREATURE_SPAWNS){
  // canWalkCamp takes an entity collision radius, not the world's 261 m radius.
  const collisionRadius=spec.boss?.94:.52;
  assert.ok(canWalkCamp(spec.x,spec.z,collisionRadius),'solid ground for '+spec.id);
  assert.ok(canWadeAtLocal(spec.x,spec.z),'no spawns in lake: '+spec.id);
  assert.equal(creatureById(spec.id)?.index,spec.index);
 }
});
test('bandit kills have independent XP/items and server-validated coin loot',()=>{
 const bandit=createSphericalMobs()[10];bandit.hp=1;
 const p={id:'hero',joined:true,normal:localToNormal(bandit.x,bandit.z-2,261),radius:261,
  heading:Math.PI/2,hp:120,maxHp:120,level:2,equipment:{},resource:100,abilityCooldowns:{}};
 const hit=applySphereAttack([bandit],p,'thunderStomp',null,1000,()=>.5);
 assert.equal(hit.ok,true);assert.equal(bandit.phase,'corpse');
 const credit=hit.credits[0].event;
 assert.equal(credit.mobId,'bandit-0');
 assert.equal(credit.xp,26);assert.equal(credit.gold,0);
 assert.ok(credit.loot.some(x=>x.id==='coins'));
 assert.equal(validateKillCredit(credit,261,EPOCH).mobLevel,2);
 assert.throws(()=>validateKillCredit({...credit,loot:[{id:'coins',qty:999}]},261,EPOCH),/invalid_kill_loot/);
 assert.throws(()=>validateKillCredit({...credit,mobId:'dolgonog-0'},261,EPOCH),/invalid_kill_reward/);
});
test('scout mission requires proximity, exactly three real bandit kills and one turn-in',()=>{
 const s=state();
 assert.deepEqual(getBanditQuest(s),{stage:0,kills:0});
 assert.throws(()=>acceptBanditQuest(s,context({x:40,z:40})),/interaction_too_far/);
 assert.equal(BANDIT_QUEST_MIN_LEVEL,3);
 assert.throws(()=>acceptBanditQuest(s,context(BANDIT_QUEST_GIVER)),/bandit_quest_level_too_low/);
 let a=acceptBanditQuest({...s,level:3},context(BANDIT_QUEST_GIVER));
 assert.equal(getBanditQuest(a).stage,1);
 assert.throws(()=>acceptBanditQuest(a,context(BANDIT_QUEST_GIVER)),/bandit_quest_unavailable/);
 a=creditBanditQuestKill(a,'dolgonog-9');assert.equal(getBanditQuest(a).kills,0);
 a=creditBanditQuestKill(a,'bandit-3');assert.equal(getBanditQuest(a).kills,0);
 for(let i=0;i<3;i++)a=creditBanditQuestKill(a,'bandit-'+i);
 assert.deepEqual(getBanditQuest(a),{stage:2,kills:3});
 assert.deepEqual(getBanditQuest(creditBanditQuestKill(a,'bandit-0')),{stage:2,kills:3});
 assert.throws(()=>turnInBanditQuest(a,context({x:60,z:60})),/interaction_too_far/);
 const reward=turnInBanditQuest(a,context(BANDIT_QUEST_GIVER));
 assert.deepEqual(getBanditQuest(reward.next),{stage:3,kills:3});
 assert.equal(reward.next.gold,30+BANDIT_QUEST_REWARD.gold);
 assert.equal(reward.next.experience,BANDIT_QUEST_REWARD.xp);
 assert.throws(()=>turnInBanditQuest(reward.next,context(BANDIT_QUEST_GIVER)),/bandit_quest_not_ready/);
});

test('chief quest is locked until scout completion and level four, with single reward',()=>{
 const origin=state(),ctx=context(BANDIT_QUEST_GIVER);
 assert.throws(()=>acceptBanditChiefQuest(origin,ctx),/bandit_chief_quest_locked/);
 const completed={...origin,level:4,quests:{bandit:{stage:3,kills:3}}};
 let q=acceptBanditChiefQuest(completed,ctx);
 assert.equal(getBanditChiefQuest(q).stage,1);
 assert.equal(getBanditChiefQuest(creditBanditChiefKill(q,'bandit-0')).stage,1);
 q=creditBanditChiefKill(q,'bandit-3');
 assert.equal(getBanditChiefQuest(q).stage,2);
 assert.throws(()=>turnInBanditChiefQuest(q,context({x:70,z:70})),/interaction_too_far/);
 const reward=turnInBanditChiefQuest(q,ctx);
 assert.equal(getBanditChiefQuest(reward.next).stage,3);
 assert.equal(reward.next.gold,completed.gold+BANDIT_CHIEF_REWARD.gold);
 assert.equal(reward.event.eventKey,'bandit:chief:turnin:v1');
 assert.throws(()=>turnInBanditChiefQuest(reward.next,ctx),/bandit_chief_quest_not_ready/);
});
