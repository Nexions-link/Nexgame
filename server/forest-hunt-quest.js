// All interactions use the authenticated player's live server position.
// Only verified killCredits can increase the objective counter.
import {ProgressError,applyExperienceReward} from './progress-rules.js';
import {requireServerProximity} from './economy-rules.js';
import {getExpedition} from './expedition-quest.js';
import {creatureById} from '../planet-test/creature-registry.js';
import {FOREST_HUNT_LEVEL,FOREST_HUNT_KILLS,FOREST_HUNT_REWARD,
 FOREST_HUNT_SCOUT,FOREST_DEN_SITES,emptyForestHunt} from '../planet-test/forest-hunt-quest.js';
const fail=code=>{throw new ProgressError(code,409)};
export function getForestHunt(state){
 const q=state.quests?.forestHunt;
 if(q===undefined)return emptyForestHunt();
 if(!q||!Number.isInteger(q.stage)||q.stage<0||q.stage>5||
  !Number.isInteger(q.kills)||q.kills<0||q.kills>FOREST_HUNT_KILLS||
  !Array.isArray(q.traces)||q.traces.length!==2||q.traces.some(v=>typeof v!=='boolean'))
  fail('corrupt_forest_hunt');
 return {stage:q.stage,kills:q.kills,traces:[...q.traces]};
}
const assign=(s,q)=>({...s,quests:{...s.quests,forestHunt:q}});
export function acceptForestHunt(state,context){
 if(state.level<FOREST_HUNT_LEVEL||getExpedition(state).stage<2||getForestHunt(state).stage!==0)
  fail('forest_hunt_unavailable');
 requireServerProximity(state,context,FOREST_HUNT_SCOUT,FOREST_HUNT_SCOUT.range);
 return assign(state,{stage:1,kills:0,traces:[false,false]});
}
export function creditForestWolfKill(state,mobId){
 const q=getForestHunt(state),spec=creatureById(mobId);
 if(q.stage!==1||spec?.family!=='forestWolf')return state;
 const kills=Math.min(FOREST_HUNT_KILLS,q.kills+1);
 return assign(state,{...q,kills,stage:kills===FOREST_HUNT_KILLS?2:1});
}
export function reportForestHunt(state,context){
 const q=getForestHunt(state);
 if(q.stage!==2||q.kills!==FOREST_HUNT_KILLS)fail('forest_hunt_not_ready');
 requireServerProximity(state,context,FOREST_HUNT_SCOUT,FOREST_HUNT_SCOUT.range);
 return assign(state,{...q,stage:3});
}
export function inspectForestDen(state,context,index){
 if(!Number.isInteger(index)||index<0||index>=FOREST_DEN_SITES.length)
  fail('invalid_forest_den');
 const q=getForestHunt(state);
 if(q.stage!==3||q.traces[index])fail('forest_den_unavailable');
 requireServerProximity(state,context,FOREST_DEN_SITES[index],FOREST_DEN_SITES[index].range);
 const traces=[...q.traces];traces[index]=true;
 return assign(state,{...q,traces,stage:traces.every(Boolean)?4:3});
}
export function finishForestHunt(state,context){
 const q=getForestHunt(state);
 if(q.stage!==4||q.kills!==FOREST_HUNT_KILLS||!q.traces.every(Boolean))
  fail('forest_hunt_not_ready');
 requireServerProximity(state,context,FOREST_HUNT_SCOUT,FOREST_HUNT_SCOUT.range);
 const {xp,gold}=FOREST_HUNT_REWARD;
 if(state.gold>2147483647-gold)fail('gold_overflow');
 return {next:assign({...state,...applyExperienceReward(state,xp),gold:state.gold+gold},
  {...q,stage:5}),
  event:{eventKey:'forest-hunt:den:v1',eventKind:'quest_reward',xp,gold}};
}
