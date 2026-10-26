import test from 'node:test';
import assert from 'node:assert/strict';
import {localToNormal} from '../spherical-pve.js';
import {mountOwned,FIRST_MOUNT_ID} from '../mount-rules.js';
import {MOUNT_QUEST_SCOUT,MOUNT_QUEST_SITES,mountQuestJournal,readMountQuest} from '../../planet-test/mount-quest.js';
import {acceptMountQuest,inspectMountTracks,finishMountQuest,getOwnedMounts} from '../mount-quest.js';

const state=(level=10,stage=5)=>({
 revision:0,level,worldRadius:261,quests:{
  expedition:{stage:4,visited:[true,true,true]},
  forestHunt:{stage,kills:3,traces:[true,true]}
 },inventory:[],equipment:{},gold:100,experience:0,health:150
});
const at=point=>({normal:localToNormal(point.x,point.z,261),radius:261,inCombat:false});
const fails=(fn,code)=>assert.throws(fn,error=>error?.code===code);
test('level 10 and completed scout protection are mandatory',()=>{
 fails(()=>acceptMountQuest(state(9),at(MOUNT_QUEST_SCOUT)),'mount_quest_locked');
 fails(()=>acceptMountQuest(state(10,4),at(MOUNT_QUEST_SCOUT)),'mount_quest_locked');
 const s=state();s.quests.expedition.stage=1;
 fails(()=>acceptMountQuest(s,at(MOUNT_QUEST_SCOUT)),'mount_quest_locked');
});
test('quest progression requires real trusted proximity for every site',()=>{
 let s=state();
 fails(()=>acceptMountQuest(s,at({x:0,z:0})),'interaction_too_far');
 s=acceptMountQuest(s,at(MOUNT_QUEST_SCOUT));
 assert.equal(s.quests.mountQuest.stage,1);
 fails(()=>inspectMountTracks(s,at(MOUNT_QUEST_SCOUT),0),'interaction_too_far');
 fails(()=>inspectMountTracks(s,at(MOUNT_QUEST_SITES[0]),-1),'invalid_mount_tracks');
 s=inspectMountTracks(s,at(MOUNT_QUEST_SITES[0]),0);
 assert.deepEqual(s.quests.mountQuest.traces,[true,false]);
 fails(()=>inspectMountTracks(s,at(MOUNT_QUEST_SITES[0]),0),'mount_tracks_unavailable');
 fails(()=>finishMountQuest(s,at(MOUNT_QUEST_SCOUT)),'mount_quest_not_ready');
 s=inspectMountTracks(s,at(MOUNT_QUEST_SITES[1]),1);
 assert.equal(s.quests.mountQuest.stage,2);
 fails(()=>finishMountQuest(s,at(MOUNT_QUEST_SITES[1])),'interaction_too_far');
 const {next,event,mountId}=finishMountQuest(s,at(MOUNT_QUEST_SCOUT));
 assert.equal(next.quests.mountQuest.stage,3);
 assert.equal(mountId,FIRST_MOUNT_ID);
 assert.deepEqual(getOwnedMounts(next),[FIRST_MOUNT_ID]);
 assert.equal(mountOwned(next),true);
 assert.equal(event.eventKey,'mount-quest:forest-wolf:v1');
 assert.equal(event.xp,0);
 fails(()=>finishMountQuest(next,at(MOUNT_QUEST_SCOUT)),'mount_quest_not_ready');
 fails(()=>acceptMountQuest(next,at(MOUNT_QUEST_SCOUT)),'mount_quest_locked');
});
test('combat and forged proximity cannot grant',()=>{
 const base=acceptMountQuest(state(),at(MOUNT_QUEST_SCOUT));
 const unsafe={...at(MOUNT_QUEST_SITES[0]),inCombat:true};
 fails(()=>inspectMountTracks(base,unsafe,0),'untrusted_interaction_context');
 fails(()=>inspectMountTracks(base,{normal:[0,0,1],radius:87,inCombat:false},0),'untrusted_interaction_context');
 assert.equal(mountOwned(base),false);
});
test('browser journal maps persisted states without granting mounts',()=>{
 assert.equal(readMountQuest(null).stage,0);
 assert.equal(mountQuestJournal({stage:1,traces:[true,false]},
  {level:10}).status,'current');
 assert.equal(mountQuestJournal({stage:3,traces:[true,true]},{level:10}).status,'completed');
});
