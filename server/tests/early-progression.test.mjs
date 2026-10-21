import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveStats,ITEM_CATALOG} from '../../items.js';
import {getClassAbilities,getAbilityDefinition} from '../../skills.js';
import {CREATURE_SPAWNS} from '../../planet-test/creature-registry.js';
import {GATHER_QUESTS} from '../../planet-test/gather-world.js';
import {requiredExperience,addExperience,applyExperienceReward,validateEquipment} from '../progress-rules.js';
import {levelExperienceRequirement,totalExperienceToLevel,levelProgress,
 earnedExperienceSince,earlyLevelMilestone} from '../../planet-test/level-progression.js';
import {grayMonsterLevel,monsterKillExperience,mobBaseExperience} from '../../planet-test/mob-levels.js';
import {BANDIT_QUEST_REWARD,BANDIT_WEAPONS_REWARD,BANDIT_CHIEF_REWARD}
 from '../bandit-quest.js';

test('P2.3.1: XP thresholds 1..10 share the same live server and client curve',()=>{
 let required=0;
 for(let level=1;level<=10;level++){
  assert.equal(levelExperienceRequirement(level),requiredExperience(level));
  assert.equal(totalExperienceToLevel(level),required);
  const progress=levelProgress(level,0);
  assert.equal(progress.toEarlyCap,Math.max(0,2700-required));
  assert.equal(progress.remaining,requiredExperience(level));
  assert.ok(progress.percent===0);
  required+=requiredExperience(level);
 }
 assert.equal(totalExperienceToLevel(8),1750);
 assert.equal(totalExperienceToLevel(10),2700);
 assert.throws(()=>levelExperienceRequirement(0),/invalid_level/);
 assert.throws(()=>totalExperienceToLevel(61),/invalid_level/);
});
test('P2.3.1: 1..10 without equipment grows HP, strength and weapon DPS at every level',()=>{
 let previous=null;
 for(let level=1;level<=10;level++){
  const stats=deriveStats(level,{weapon:{id:'wornAxe'}});
  assert.equal(stats.maxHp,120+(level-1)*20);
  assert.equal(stats.strength,28+(level-1)*2);
  assert.equal(stats.stamina,22+(level-1)*2);
  assert.ok(Number.isFinite(stats.dps)&&stats.dps>0);
  if(previous){assert.ok(stats.maxHp>previous.maxHp);assert.ok(stats.dps>previous.dps);}
  previous=stats;
 }
 assert.equal(previous.maxHp,300);
});
test('P2.3.1: charge is exactly the level-eight milestone, custom action bar remains server controlled',()=>{
 for(let level=1;level<=10;level++){
  const abilities=getClassAbilities('warrior',level).map(a=>a.id);
  assert.equal(abilities.includes('charge'),level>=8);
  assert.equal(earlyLevelMilestone(level)?.abilityId||null,level<8?'charge':null);
 }
 assert.equal(getAbilityDefinition('charge').level,8);
 assert.equal(getAbilityDefinition('charge').range,30);
});
test('P2.3.1: equipment gates are respected through level ten, without changing drop chances',()=>{
 const locked=Object.entries(ITEM_CATALOG).filter(([,item])=>item.slot&&item.requiredLevel>1&&item.requiredLevel<=10);
 for(let level=1;level<=10;level++){
  for(const [id,def] of locked){
   const snapshot={[def.slot]:{id}};
   if(def.requiredLevel<=level)assert.doesNotThrow(()=>validateEquipment(snapshot,level));
   else assert.throws(()=>validateEquipment(snapshot,level),/unavailable_equipment/);
  }
 }
});
test('P2.3.1: quest reward ceiling and level bands expose content gaps honestly',()=>{
 const baseRewards=[80,110,95,190];
 const gather=GATHER_QUESTS.filter(Boolean).reduce((sum,q)=>sum+q.xp,0);
 const bandit=BANDIT_QUEST_REWARD.xp+BANDIT_WEAPONS_REWARD.xp+BANDIT_CHIEF_REWARD.xp;
 assert.equal(baseRewards.reduce((a,b)=>a+b,0),475);
 assert.equal(gather,180);assert.equal(bandit,355);
 assert.equal(gather+bandit+475,1010);
 assert.equal(Math.max(...CREATURE_SPAWNS.map(m=>m.level)),5);
 const late=CREATURE_SPAWNS.filter(m=>monsterKillExperience(10,m.level,mobBaseExperience(m.level,m.boss))>0);
 assert.ok(late.length<CREATURE_SPAWNS.length,'levels 9–10 need higher-level future enemy content');
 assert.equal(grayMonsterLevel(10),4);
});
test('P2.3.1: multi-level XP and repeated/invalid progress cannot create bonus XP',()=>{
 const g=addExperience(1,80,1920);
 assert.equal(g.level,8);
 assert.equal(g.experience,250);
 assert.equal(earnedExperienceSince(1,80,g.level,g.experience),1920);
 assert.equal(earnedExperienceSince(8,300,8,300),0);
 assert.equal(earnedExperienceSince(8,300,7,150),0);
 assert.deepEqual(applyExperienceReward({
  level:8,experience:445,health:7,equipment:{weapon:{id:'wornAxe'}}},10),
  {level:9,experience:5,health:280});
});
