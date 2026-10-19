import test from 'node:test';
import assert from 'node:assert/strict';
import {readProgress,validateKillCredit,awardVerifiedKill} from '../progress-rules.js';
import {localToNormal} from '../spherical-pve.js';
import {creatureById,creatureKillReward,BANDIT_QUEST_GIVER} from '../../planet-test/creature-registry.js';
import {GATHER_QUESTS} from '../../planet-test/gather-world.js';
import {ECONOMY_MENTOR,ECONOMY_HERBALIST,acceptMentorQuest,certifyMentorKill,
 turnInMentorQuest,acceptGatherQuest,turnInGatherQuest,addOwnedStacks} from '../economy-rules.js';
import {acceptBanditQuest,creditBanditQuestKill,turnInBanditQuest,
 acceptBanditWeaponsQuest,turnInBanditWeaponsQuest,
 acceptBanditChiefQuest,creditBanditChiefKill,turnInBanditChiefQuest} from '../bandit-quest.js';

const WORLD_RUN='0de0fdc8-5ea3-4b10-8931-6a3c2900f4a2';
const context=point=>({normal:localToNormal(point.x,point.z,261),radius:261,inCombat:false});
const mentor=context(ECONOMY_MENTOR),herbalist=context(ECONOMY_HERBALIST),scout=context(BANDIT_QUEST_GIVER);
const initial=()=>readProgress({schemaVersion:1,revision:'0',level:1,experience:0,
 gold:30,health:120,resource:0,worldRadius:261,positionNormal:[0,0,1],heading:0,
 inventory:Array(12).fill(null),equipment:{},quests:{},actionBar:[]});
let life=1;
function kill(state,mobId){
 const mob=creatureById(mobId);
 const event={type:'killCredit',mobId,life:life++,xp:creatureKillReward(mob).xp,gold:0,loot:[]};
 const credit=validateKillCredit(event,261,WORLD_RUN);
 return {state:awardVerifiedKill(state,credit),event};
}

test('a new character can follow normal quests to level five without XP grinding or progress reset',()=>{
 life=1;
 let s=initial();
 assert.equal(s.level,1);
 assert.throws(()=>acceptBanditQuest(s,scout),/bandit_quest_level_too_low/);
 s=acceptMentorQuest(s,mentor);
 for(const id of ['dolgonog-0','dolgonog-1','dolgonog-2']){
  const hit=kill(s,id);s=certifyMentorKill(hit.state,hit.event,WORLD_RUN).next;
 }
 assert.equal(s.quests.mentor.step,2);
 s=turnInMentorQuest(s,mentor).next;
 assert.equal(s.level,2);
 assert.equal(s.quests.mentor.step,3);
 // Picking quest resources is server-controlled; simulate items delivered by its
 // authenticated cast and test the real server turn-in transactions/rules.
 for(let stage=1;stage<=3;stage++){
  const mission=GATHER_QUESTS[stage];
  s=acceptGatherQuest(s);
  s={...s,inventory:addOwnedStacks(s.inventory,[{id:mission.item,qty:mission.count}])};
  s=turnInGatherQuest(s,herbalist).next;
  assert.equal(s.quests.gather.stage,stage+1);
  assert.equal(s.inventory.some(row=>row?.id===mission.item),false);
 }
 assert.equal(s.level,3,'gathering helps unlock bandits at level three');
 assert.equal(s.quests.gather.stage,4);
 s=acceptBanditQuest(s,scout);
 for(const id of ['bandit-0','bandit-1','bandit-2']){
  const hit=kill(s,id);s=creditBanditQuestKill(hit.state,id);
 }
 assert.equal(s.quests.bandit.stage,2);
 s=turnInBanditQuest(s,scout).next;
 assert.equal(s.level,4,'scouting pays enough XP to meet the chief level gate');
 s=acceptBanditWeaponsQuest(s,scout);
 s={...s,inventory:addOwnedStacks(s.inventory,[{id:'banditDagger',qty:3}])};
 s=turnInBanditWeaponsQuest(s,scout).next;
 assert.equal(s.quests.banditWeapons.stage,2);
 assert.equal(s.inventory.some(row=>row?.id==='banditDagger'),false);
 s=acceptBanditChiefQuest(s,scout);
 const boss=kill(s,'bandit-3');s=creditBanditChiefKill(boss.state,'bandit-3');
 assert.equal(s.quests.banditChief.stage,2);
 const reward=turnInBanditChiefQuest(s,scout,'trailbreakerAxe');
 s={...reward.next,inventory:addOwnedStacks(reward.next.inventory,[{id:'trailbreakerAxe',qty:1}])};
 assert.equal(s.level,5,'chief reward completes level 1–5 route naturally');
 assert.equal(s.quests.banditChief.stage,3);
 assert.equal(s.inventory.filter(row=>row?.id==='trailbreakerAxe').length,1);
 assert.equal(s.inventory.some(row=>row?.id==='trailwardenShield'),false);
 assert.throws(()=>turnInBanditChiefQuest(s,scout,'trailbreakerAxe'),/bandit_chief_quest_not_ready/);
});
