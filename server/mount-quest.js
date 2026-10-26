// Trusted world-only quest transitions: no client-side grant or position claims.
import {ProgressError} from './progress-rules.js';
import {requireServerProximity} from './economy-rules.js';
import {getExpedition} from './expedition-quest.js';
import {getForestHunt} from './forest-hunt-quest.js';
import {MOUNT_QUEST_LEVEL,MOUNT_QUEST_SCOUT,MOUNT_QUEST_SITES,
 defaultMountQuest} from '../planet-test/mount-quest.js';
import {FIRST_MOUNT_ID} from './mount-rules.js';
const fail=code=>{throw new ProgressError(code,409)};
export function getMountQuest(state){
 const raw=state.quests?.mountQuest;
 if(raw===undefined)return defaultMountQuest();
 if(!raw||!Number.isInteger(raw.stage)||raw.stage<0||raw.stage>3||
  !Array.isArray(raw.traces)||raw.traces.length!==2||
  raw.traces.some(value=>typeof value!=='boolean'))fail('corrupt_mount_quest');
 return {stage:raw.stage,traces:[...raw.traces]};
}
const mounts=state=>state.quests?.mounts===undefined?[]:state.quests.mounts;
export function getOwnedMounts(state){
 const owned=mounts(state);
 if(!Array.isArray(owned)||owned.some(id=>id!==FIRST_MOUNT_ID))
  fail('corrupt_mount_collection');
 return [...new Set(owned)];
}
const assign=(state,quest,collection=getOwnedMounts(state))=>({
 ...state,quests:{...state.quests,mountQuest:quest,mounts:collection}
});
export function acceptMountQuest(state,context){
 const current=getMountQuest(state);
 if(state.level<MOUNT_QUEST_LEVEL||getExpedition(state).stage<2||
  getForestHunt(state).stage!==5||current.stage!==0||getOwnedMounts(state).includes(FIRST_MOUNT_ID))
  fail('mount_quest_locked');
 requireServerProximity(state,context,MOUNT_QUEST_SCOUT,MOUNT_QUEST_SCOUT.range);
 return assign(state,{stage:1,traces:[false,false]});
}
export function inspectMountTracks(state,context,index){
 if(!Number.isInteger(index)||index<0||index>=MOUNT_QUEST_SITES.length)
  fail('invalid_mount_tracks');
 const q=getMountQuest(state);
 if(q.stage!==1||q.traces[index])fail('mount_tracks_unavailable');
 const site=MOUNT_QUEST_SITES[index];
 requireServerProximity(state,context,site,site.range);
 const traces=[...q.traces];traces[index]=true;
 return assign(state,{stage:traces.every(Boolean)?2:1,traces});
}
export function finishMountQuest(state,context){
 const q=getMountQuest(state),owned=getOwnedMounts(state);
 if(q.stage!==2||!q.traces.every(Boolean)||owned.includes(FIRST_MOUNT_ID))
  fail('mount_quest_not_ready');
 requireServerProximity(state,context,MOUNT_QUEST_SCOUT,MOUNT_QUEST_SCOUT.range);
 return {
  next:assign(state,{stage:3,traces:[true,true]},[...owned,FIRST_MOUNT_ID]),
  event:{eventKey:'mount-quest:forest-wolf:v1',eventKind:'quest_reward',xp:0,gold:0},
  mountId:FIRST_MOUNT_ID
 };
}
