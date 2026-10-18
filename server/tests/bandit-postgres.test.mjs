import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createProgressStore} from '../progress-store.js';
import {createEconomyStore} from '../economy-store.js';
import {BANDIT_QUEST_GIVER,creatureById,creatureKillReward} from '../../planet-test/creature-registry.js';
import {localToNormal} from '../spherical-pve.js';
const uri=process.env.NGW_PROGRESS_TEST_DATABASE;
const context=at=>({normal:localToNormal(at.x,at.z,261),radius:261,inCombat:false});
test('Postgres: bandit XP, manual coin pickup and unique quest reward after relog',
 {skip:!uri,timeout:55000},async()=>{
 const pool=new pg.Pool({connectionString:uri,max:4,ssl:false}),epoch=randomUUID();
 const progress=createProgressStore({pool,worldRunId:epoch});
 const economy=createEconomyStore({pool,worldRunId:epoch});
 try{
  for(const file of ['001_accounts_characters.sql','002_auth_rate_limits.sql',
   '003_progress_event_ledger.sql','004_economy_quests.sql','005_mentor_evidence.sql'])
   await pool.query(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const accountId=(await pool.query("INSERT INTO ngw_accounts(username,password_hash) VALUES('bandit_e2e','ci-only') RETURNING id")).rows[0].id;
  const characterId=(await pool.query("INSERT INTO ngw_characters(account_id,nickname) VALUES($1,'Следопыт') RETURNING id",[accountId])).rows[0].id;
  await pool.query('INSERT INTO ngw_character_progress(character_id) VALUES($1)',[characterId]);
  const args=(rev,at,other={})=>({accountId,characterId,expectedRevision:rev,
   requestId:randomUUID(),context:context(at),...other});
  let state=await progress.load(accountId,characterId);
  await assert.rejects(()=>economy.startBanditQuest(args(state.revision,BANDIT_QUEST_GIVER)),e=>e.code==='bandit_quest_level_too_low');
 await pool.query('UPDATE ngw_character_progress SET level=3 WHERE character_id=$1',[characterId]);
 state=await progress.load(accountId,characterId);
 state=(await economy.startBanditQuest(args(state.revision,BANDIT_QUEST_GIVER))).progress;
  assert.deepEqual(state.quests.bandit,{stage:1,kills:0});
  const credit=(id,loot=[])=>({type:'killCredit',mobId:id,life:1,xp:creatureKillReward(creatureById(id)).xp,gold:0,loot});
  const first=credit('bandit-0',[{id:'coins',qty:7}]);
  let killed=await progress.recordMobKill({accountId,characterId,expectedRevision:state.revision,radius:261,serverCredit:first,deferLoot:true});
  state=killed.progress;
  assert.equal(state.gold,30);assert.equal(state.quests.bandit.kills,1);
  const replay=await progress.recordMobKill({accountId,characterId,expectedRevision:state.revision,radius:261,serverCredit:first,deferLoot:true});
  assert.equal(replay.applied,false);
  const corpse={mobId:'bandit-0',life:1,radius:261,x:-40,z:9};
  assert.deepEqual((await economy.readCorpseLoot({...args(state.revision,corpse),corpse})).loot,[{id:'coins',qty:7}]);
  let taken=await economy.takeCorpseLoot(args(state.revision,corpse,{corpse,itemId:'coins'}));
  state=taken.progress;assert.equal(state.gold,37);
  taken=await economy.takeCorpseLoot(args(state.revision,corpse,{corpse,itemId:'coins'}));
  assert.equal(taken.applied,false);assert.equal(taken.progress.gold,37);
  for(const id of ['bandit-1','bandit-2']){
   killed=await progress.recordMobKill({accountId,characterId,expectedRevision:state.revision,
    radius:261,serverCredit:credit(id),deferLoot:true});
   state=killed.progress;
  }
  state=await progress.load(accountId,characterId);
  assert.deepEqual(state.quests.bandit,{stage:2,kills:3});
  const finish=await economy.finishBanditQuest(args(state.revision,BANDIT_QUEST_GIVER));
  assert.equal(finish.progress.gold,55);
  assert.deepEqual(finish.progress.quests.bandit,{stage:3,kills:3});
  await assert.rejects(()=>economy.finishBanditQuest(args(finish.progress.revision,BANDIT_QUEST_GIVER)),
   error=>error.code==='bandit_quest_not_ready');
  const {rows}=await pool.query("SELECT gold_granted FROM ngw_progress_events WHERE character_id=$1 AND event_key='bandit:quest:turnin:v1'",[characterId]);
  assert.equal(rows.length,1);assert.equal(Number(rows[0].gold_granted),18);
 }finally{await economy.close();await progress.close();await pool.end()}
});