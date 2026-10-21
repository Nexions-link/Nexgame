// Only live server position and server-side stage changes certify exploration.
import {ProgressError,applyExperienceReward} from './progress-rules.js';
import {requireServerProximity} from './economy-rules.js';
import {EXPEDITION_LEVEL,EXPEDITION_MENTOR,EXPEDITION_SCOUT,EXPEDITION_SITES,
 EXPEDITION_REWARD,defaultExpedition} from '../planet-test/expedition-quest.js';
const fail=code=>{throw new ProgressError(code,409)};
export function getExpedition(state){
 const q=state.quests?.expedition;
 if(q===undefined)return defaultExpedition();
 if(!q||!Number.isInteger(q.stage)||q.stage<0||q.stage>4||
   !Array.isArray(q.visited)||q.visited.length!==3||
   q.visited.some(v=>typeof v!=='boolean'))fail('corrupt_expedition_quest');
 return {stage:q.stage,visited:[...q.visited]};
}
const assign=(s,q)=>({...s,quests:{...s.quests,expedition:q}});
export function acceptExpedition(state,context){
 if(state.level<EXPEDITION_LEVEL||getExpedition(state).stage!==0)fail('expedition_not_available');
 requireServerProximity(state,context,EXPEDITION_MENTOR,EXPEDITION_MENTOR.range);
 return assign(state,{stage:1,visited:[false,false,false]});
}
export function arriveExpedition(state,context){
 const q=getExpedition(state);
 if(q.stage!==1)fail('expedition_arrival_unavailable');
 requireServerProximity(state,context,EXPEDITION_SCOUT,EXPEDITION_SCOUT.range);
 return assign(state,{...q,stage:2});
}
export function discoverExpedition(state,context,index){
 if(!Number.isInteger(index)||index<0||index>=EXPEDITION_SITES.length)fail('invalid_expedition_site');
 const q=getExpedition(state);
 if(q.stage!==2||q.visited[index])fail('expedition_site_unavailable');
 const p=EXPEDITION_SITES[index];
 requireServerProximity(state,context,p,p.range);
 const visited=[...q.visited];visited[index]=true;
 return assign(state,{stage:visited.every(Boolean)?3:2,visited});
}
export function finishExpedition(state,context){
 const q=getExpedition(state);
 if(q.stage!==3||!q.visited.every(Boolean))fail('expedition_not_ready');
 requireServerProximity(state,context,EXPEDITION_SCOUT,EXPEDITION_SCOUT.range);
 const {xp,gold}=EXPEDITION_REWARD;
 if(state.gold>2147483647-gold)fail('gold_overflow');
 return {next:assign({...state,...applyExperienceReward(state,xp),gold:state.gold+gold},{...q,stage:4}),
  event:{eventKey:'expedition:survey:v1',eventKind:'quest_reward',xp,gold}};
}