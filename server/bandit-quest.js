// Server-owned first humanoid quest; state lives in the existing quests JSONB.
// No browser-provided kill, reward, position, or quest-count claim is trusted.
import {ProgressError,addExperience} from './progress-rules.js';
import {BANDIT_QUEST_GIVER,BANDIT_QUEST_KILLS,BANDIT_QUEST_MIN_LEVEL,creatureById} from '../planet-test/creature-registry.js';
import {requireServerProximity} from './economy-rules.js';
const reject=code=>{throw new ProgressError(code,409)};
export const BANDIT_QUEST_REWARD=Object.freeze({xp:85,gold:18});
export function getBanditQuest(state){
 const q=state.quests?.bandit;
 if(q===undefined)return {stage:0,kills:0};
 if(!q||!Number.isInteger(q.stage)||q.stage<0||q.stage>3||
    !Number.isInteger(q.kills)||q.kills<0||q.kills>BANDIT_QUEST_KILLS)
  reject('corrupt_bandit_quest');
 return {stage:q.stage,kills:q.kills};
}
export {BANDIT_QUEST_MIN_LEVEL};
const put=(state,bandit)=>({...state,quests:{...state.quests,bandit}});
export function acceptBanditQuest(state,context){
 requireServerProximity(state,context,BANDIT_QUEST_GIVER,BANDIT_QUEST_GIVER.range);
 if(state.level<BANDIT_QUEST_MIN_LEVEL)reject('bandit_quest_level_too_low');
 if(getBanditQuest(state).stage!==0)reject('bandit_quest_unavailable');
 return put(state,{stage:1,kills:0});
}
export function creditBanditQuestKill(state,mobId){
 const q=getBanditQuest(state),spec=creatureById(mobId);
 if(q.stage!==1||(spec?.family!=='bandit'||spec.boss))return state;
 const kills=Math.min(BANDIT_QUEST_KILLS,q.kills+1);
 return put(state,{stage:kills===BANDIT_QUEST_KILLS?2:1,kills});
}
export function turnInBanditQuest(state,context){
 requireServerProximity(state,context,BANDIT_QUEST_GIVER,BANDIT_QUEST_GIVER.range);
 const quest=getBanditQuest(state);
 if(quest.stage!==2)reject('bandit_quest_not_ready');
 if(state.gold>2147483647-BANDIT_QUEST_REWARD.gold)reject('gold_overflow');
 const xp=addExperience(state.level,state.experience,BANDIT_QUEST_REWARD.xp);
 return {next:put({...state,...xp,gold:state.gold+BANDIT_QUEST_REWARD.gold},
    {stage:3,kills:BANDIT_QUEST_KILLS}),
  event:{eventKey:'bandit:quest:turnin:v1',eventKind:'quest_reward',
   xp:BANDIT_QUEST_REWARD.xp,gold:BANDIT_QUEST_REWARD.gold}};
}

export const BANDIT_CHIEF_REWARD=Object.freeze({xp:180,gold:35});
export function getBanditChiefQuest(state){
 const q=state.quests?.banditChief;
 if(q===undefined)return {stage:0};
 if(!q||!Number.isInteger(q.stage)||q.stage<0||q.stage>3)reject('corrupt_bandit_chief_quest');
 return {stage:q.stage};
}
const putChief=(state,stage)=>({...state,quests:{...state.quests,banditChief:{stage}}});
export function acceptBanditChiefQuest(state,context){
 requireServerProximity(state,context,BANDIT_QUEST_GIVER,BANDIT_QUEST_GIVER.range);
 if(getBanditQuest(state).stage!==3||state.level<4)reject('bandit_chief_quest_locked');
 if(getBanditChiefQuest(state).stage!==0)reject('bandit_chief_quest_unavailable');
 return putChief(state,1);
}
export function creditBanditChiefKill(state,mobId){
 if(getBanditChiefQuest(state).stage!==1||mobId!=='bandit-3')return state;
 return putChief(state,2);
}
export function turnInBanditChiefQuest(state,context){
 requireServerProximity(state,context,BANDIT_QUEST_GIVER,BANDIT_QUEST_GIVER.range);
 if(getBanditChiefQuest(state).stage!==2)reject('bandit_chief_quest_not_ready');
 if(state.gold>2147483647-BANDIT_CHIEF_REWARD.gold)reject('gold_overflow');
 const xp=addExperience(state.level,state.experience,BANDIT_CHIEF_REWARD.xp);
 return {next:putChief({...state,...xp,gold:state.gold+BANDIT_CHIEF_REWARD.gold},3),
  event:{eventKey:'bandit:chief:turnin:v1',eventKind:'quest_reward',
   xp:BANDIT_CHIEF_REWARD.xp,gold:BANDIT_CHIEF_REWARD.gold}};
}
