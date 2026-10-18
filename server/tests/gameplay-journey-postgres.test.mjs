// Durable end-to-end progression journey; disposable PostgreSQL ONLY.
// Login HTTP and real-time PvE transport have separate tests. This exercises
// the actual account-owned SQL operations and a fresh post-reconnect store.
// Never set NGW_PROGRESS_TEST_DATABASE to the production Neon connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createProgressStore} from '../progress-store.js';
import {createEconomyStore} from '../economy-store.js';
import {ECONOMY_CHEST} from '../economy-rules.js';
import {creatureById,creatureKillReward} from '../../planet-test/creature-registry.js';
import {localToNormal} from '../spherical-pve.js';

const connectionString=process.env.NGW_PROGRESS_TEST_DATABASE;
const inRange=({x,z})=>({
 normal:localToNormal(x,z,261),radius:261,inCombat:false
});
const occupied=slots=>slots.filter(Boolean).length;

test('Postgres journey: starter -> verified kill -> corpse loot -> equip -> chest -> relog -> withdraw',
 {skip:!connectionString,timeout:65000},async()=>{
 const pool=new pg.Pool({connectionString,max:5,ssl:false});
 const epoch=randomUUID();
 const progress=createProgressStore({pool,worldRunId:epoch});
 const economy=createEconomyStore({pool,worldRunId:epoch});
 let replayProgress,replayEconomy;
 try{
  for(const file of ['001_accounts_characters.sql','002_auth_rate_limits.sql',
   '003_progress_event_ledger.sql','004_economy_quests.sql','005_mentor_evidence.sql']){
   await pool.query(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  }
  const username='journey_'+randomUUID().replaceAll('-','').slice(0,12);
  const accountId=(await pool.query(
   "INSERT INTO ngw_accounts(username,password_hash) VALUES($1,'test-only') RETURNING id",
   [username])).rows[0].id;
  const characterId=(await pool.query(
   "INSERT INTO ngw_characters(account_id,nickname) VALUES($1,'Путешественник') RETURNING id",
   [accountId])).rows[0].id;
  const strangerId=(await pool.query(
   "INSERT INTO ngw_accounts(username,password_hash) VALUES($1,'test-only') RETURNING id",
   ['other_'+randomUUID().replaceAll('-','').slice(0,12)])).rows[0].id;
  await pool.query('INSERT INTO ngw_character_progress(character_id) VALUES($1)',[characterId]);

  // First account join: the server awards its own starter kit, once.
  const started=await progress.initializeStarterPack(accountId,characterId);
  assert.equal(started.revision,1);
  assert.deepEqual(started.inventory[0],{id:'wornAxe',qty:1});
  assert.deepEqual(started.inventory[1],{id:'healingPotion',qty:3});
  assert.equal((await progress.initializeStarterPack(accountId,characterId)).revision,1);
  await assert.rejects(()=>progress.load(strangerId,characterId),e=>e.status===404);

  // A combat victory is trusted ONLY once the server sends kill credit.
  const mobId='dolgonog-0',mob=creatureById(mobId);
  const serverCredit={type:'killCredit',mobId,life:1,
   xp:creatureKillReward(mob).xp,gold:0,
   loot:[{id:'feather',qty:2},{id:'batteredBuckler',qty:1}]};
  const killArgs={accountId,characterId,expectedRevision:started.revision,
   radius:261,serverCredit,deferLoot:true};
  const killed=await progress.recordMobKill(killArgs);
  assert.equal(killed.applied,true);
  assert.ok(killed.progress.experience>started.experience);
  assert.equal(killed.progress.gold,started.gold,'beasts must not mint gold');
  assert.deepEqual(killed.progress.inventory,started.inventory,
   'corpse items must not silently enter the backpack');
  const repeatedKill=await progress.recordMobKill(killArgs);
  assert.equal(repeatedKill.applied,false);
  assert.equal(repeatedKill.progress.revision,killed.progress.revision);

  const corpse={mobId,life:1,radius:261,x:-9,z:-23};
  const lootContext={accountId,characterId,context:inRange(corpse),corpse};
  assert.deepEqual((await economy.readCorpseLoot(lootContext)).loot,serverCredit.loot);
  const feather=await economy.takeCorpseLoot({...lootContext,
   expectedRevision:killed.progress.revision,itemId:'feather',requestId:randomUUID()});
  assert.deepEqual(feather.taken,[{id:'feather',qty:2}]);
  assert.equal(feather.progress.inventory.filter(x=>x?.id==='feather').length,1);
  const buckler=await economy.takeCorpseLoot({...lootContext,
   expectedRevision:feather.progress.revision,itemId:'batteredBuckler',requestId:randomUUID()});
  assert.equal((await economy.readCorpseLoot(lootContext)).loot.length,0);
  assert.equal(buckler.progress.gold,started.gold);
  const exhausted=await economy.takeCorpseLoot({...lootContext,
   expectedRevision:buckler.progress.revision,itemId:'feather',requestId:randomUUID()});
  assert.equal(exhausted.applied,false);
  assert.equal(exhausted.progress.revision,buckler.progress.revision);

  // Equipping and transferring use authoritative sparse slot indices.
  const shieldSlot=buckler.progress.inventory.findIndex(x=>x?.id==='batteredBuckler');
  assert.ok(shieldSlot>=0);
  const equipped=(await progress.equipInventoryItem({
   accountId,characterId,expectedRevision:buckler.progress.revision,
   bagSlot:shieldSlot,equipmentSlot:'shield'
  })).progress;
  assert.deepEqual(equipped.equipment.shield,{id:'batteredBuckler'});
  assert.equal(equipped.inventory[shieldSlot],null);
  const featherSlot=equipped.inventory.findIndex(x=>x?.id==='feather');
  assert.ok(featherSlot>=0);
  const chestContext=inRange(ECONOMY_CHEST);
  const beforeChest=await economy.readChest({accountId,characterId,context:chestContext});
  const depositArgs={accountId,characterId,expectedRevision:equipped.revision,
   context:chestContext,requestId:randomUUID(),action:'deposit',slot:featherSlot};
  const deposited=await economy.moveChest(depositArgs);
  assert.equal(deposited.applied,true);
  assert.equal(deposited.progress.inventory[featherSlot],null);
  assert.equal(occupied(deposited.chest.slots),occupied(beforeChest.slots)+1);
  const newlyFilled=deposited.chest.slots.findIndex((row,index)=>
   !beforeChest.slots[index]&&row?.id==='feather'&&row.qty===2);
  assert.ok(newlyFilled>=0,'the deposited stack must occupy a single free chest slot');
  const dupDeposit=await economy.moveChest(depositArgs);
  assert.equal(dupDeposit.applied,false);
  assert.equal((await economy.readChestStatus()).occupied,occupied(deposited.chest.slots));

  // A reconnect is a new server-side repository instance, never localStorage.
  replayProgress=createProgressStore({pool,worldRunId:epoch});
  replayEconomy=createEconomyStore({pool,worldRunId:epoch});
  const rejoined=await replayProgress.load(accountId,characterId);
  assert.equal(rejoined.revision,deposited.progress.revision);
  assert.equal(rejoined.level,deposited.progress.level);
  assert.equal(rejoined.experience,deposited.progress.experience);
  assert.equal(rejoined.gold,started.gold);
  assert.deepEqual(rejoined.equipment.shield,{id:'batteredBuckler'});
  assert.equal(rejoined.inventory.some(x=>x?.id==='feather'),false);
  assert.deepEqual((await replayEconomy.readChest({
   accountId,characterId,context:chestContext
  })).slots[newlyFilled],{id:'feather',qty:2});

  const withdrawArgs={accountId,characterId,expectedRevision:rejoined.revision,
   context:chestContext,requestId:randomUUID(),action:'withdraw',slot:newlyFilled};
  const withdrawn=await replayEconomy.moveChest(withdrawArgs);
  assert.equal(withdrawn.applied,true);
  assert.equal(withdrawn.chest.slots[newlyFilled],null);
  const retry=await replayEconomy.moveChest(withdrawArgs);
  assert.equal(retry.applied,false,'network retry must not duplicate a chest transfer');
  const final=await progress.load(accountId,characterId);
  assert.equal(final.inventory.filter(x=>x?.id==='feather').length,1);
  assert.equal(final.inventory.find(x=>x?.id==='feather')?.qty,2);
  assert.deepEqual(final.equipment.shield,{id:'batteredBuckler'});
  assert.equal(final.experience,killed.progress.experience);
  assert.equal(final.gold,started.gold);
  assert.equal(occupied((await economy.readChest({
   accountId,characterId,context:chestContext
  })).slots),occupied(beforeChest.slots));
  const ledger=await pool.query(
   "SELECT count(*)::int AS count FROM ngw_progress_events WHERE character_id=$1 AND event_kind='mob_kill'",
   [characterId]);
  assert.equal(ledger.rows[0].count,1,'replayed kill must not pay twice');
  const receipts=await pool.query(
   "SELECT count(*)::int AS count FROM ngw_economy_receipts WHERE character_id=$1",
   [characterId]);
  assert.equal(receipts.rows[0].count,2,'only deposit and withdraw must have receipts');
 }finally{
  await replayEconomy?.close();
  await replayProgress?.close();
  await economy.close();
  await progress.close();
  await pool.end();
 }
});
