// True SQL integration test. Runs ONLY against disposable PostgreSQL in CI.
// NEVER point NGW_PROGRESS_TEST_DATABASE at production Neon.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createProgressStore} from '../progress-store.js';
import {ProgressError} from '../progress-rules.js';
const connectionString=process.env.NGW_PROGRESS_TEST_DATABASE;
const credit=(life,loot=[{id:'feather',qty:1}],mobId='dolgonog-0')=>({
 type:'killCredit',mobId,life,xp:22,gold:4,loot
});
test('real Postgres: owner isolation, exactly-once rewards, concurrent retries, CAS, rollback and loadout',
 {skip:!connectionString,timeout:55000},async()=>{
 const pool=new pg.Pool({connectionString,max:6,ssl:false});
 const store=createProgressStore({pool});
 try{
  for(const id of ['001_accounts_characters.sql',
    '002_auth_rate_limits.sql','003_progress_event_ledger.sql']){
   const sql=await readFile(new URL('../migrations/'+id,import.meta.url),'utf8');
   await pool.query(sql);
  }
  assert.equal(await store.schemaReady(),true);
  const createAccount=async name=>{
   const r=await pool.query(
    "INSERT INTO ngw_accounts(username,password_hash) VALUES($1,'test-only-ephemeral-hash') RETURNING id",
    [name]);return r.rows[0].id;
  };
  const a=await createAccount('progressa');
  const b=await createAccount('progressb');
  const char=await pool.query(
   "INSERT INTO ngw_characters(account_id,nickname) VALUES($1,'Tester') RETURNING id",[a]);
  const id=char.rows[0].id;
  await pool.query("INSERT INTO ngw_character_progress(character_id) VALUES($1)",[id]);
  const initial=await store.load(a,id);
  assert.equal(initial.revision,0);
  assert.equal(initial.inventory.length,12);
  assert.equal(initial.level,1);
  await assert.rejects(()=>store.load(b,id),e=>e instanceof ProgressError&&e.status===404);
  await assert.rejects(()=>store.recordMobKill({
   accountId:b,characterId:id,expectedRevision:0,radius:261,serverCredit:credit(1)
  }),e=>e.status===404);
  await assert.rejects(()=>store.recordMobKill({
   accountId:a,characterId:id,expectedRevision:0,radius:261,
   serverCredit:{...credit(1),xp:9999}
  }),e=>e.code==='invalid_kill_reward');
  const first=await store.recordMobKill({
   accountId:a,characterId:id,expectedRevision:0,radius:261,serverCredit:credit(1)
  });
  assert.equal(first.applied,true);
  assert.equal(first.progress.revision,1);
  assert.equal(first.progress.experience,22);
  assert.equal(first.progress.gold,34);
  assert.deepEqual(first.progress.inventory[0],{id:'feather',qty:1});
  const replay=await store.recordMobKill({
   accountId:a,characterId:id,expectedRevision:0,radius:261,serverCredit:credit(1)
  });
  assert.equal(replay.applied,false);
  assert.equal(replay.reason,'duplicate');
  assert.equal(replay.progress.revision,1);
  const concurrent=await Promise.all([0,1].map(()=>store.recordMobKill({
   accountId:a,characterId:id,expectedRevision:1,radius:261,serverCredit:credit(2)
  })));
  assert.deepEqual(concurrent.map(r=>r.applied).sort(),[false,true]);
  assert.equal((await store.load(a,id)).revision,2);
  await assert.rejects(()=>store.recordMobKill({
   accountId:a,characterId:id,expectedRevision:1,radius:261,serverCredit:credit(3)
  }),e=>e.code==='stale_revision');
  const events=await pool.query(
   "SELECT count(*)::int AS n FROM ngw_progress_events WHERE character_id=$1",[id]);
  assert.equal(events.rows[0].n,2);
  const checkpoint=await store.saveServerCheckpoint({
   accountId:a,characterId:id,expectedRevision:2,
   checkpoint:{normal:[0,0.6,0.8],heading:0.5,radius:261}
  });
  assert.equal(checkpoint.progress.revision,3);
  assert.deepEqual(checkpoint.progress.positionNormal,[0,0.6,0.8]);
  assert.equal(checkpoint.progress.gold,38);
  await assert.rejects(()=>store.saveServerCheckpoint({
   accountId:a,characterId:id,expectedRevision:3,
   checkpoint:{normal:[0,0,1],heading:0,radius:261,gold:100000}
  }),e=>e.code==='invalid_checkpoint');
  const shieldLoot=await store.recordMobKill({
   accountId:a,characterId:id,expectedRevision:3,radius:261,
   serverCredit:credit(3,[{id:'batteredBuckler',qty:1}])
  });
  assert.equal(shieldLoot.progress.revision,4);
  assert.deepEqual(shieldLoot.progress.inventory[1],{id:'batteredBuckler',qty:1});
  const equipped=await store.equipInventoryItem({
   accountId:a,characterId:id,expectedRevision:4,bagSlot:1,equipmentSlot:'shield'
  });
  assert.deepEqual(equipped.progress.equipment.shield,{id:'batteredBuckler'});
  assert.equal(equipped.progress.inventory[1],null);
  await assert.rejects(()=>store.equipInventoryItem({
   accountId:a,characterId:id,expectedRevision:5,bagSlot:1,equipmentSlot:'weapon'
  }),e=>e.code==='item_not_owned');
  const unequipped=await store.unequipInventoryItem({
   accountId:a,characterId:id,expectedRevision:5,bagSlot:1,equipmentSlot:'shield'
  });
  assert.deepEqual(unequipped.progress.inventory[1],{id:'batteredBuckler',qty:1});
  assert.equal(unequipped.progress.equipment.shield,undefined);
  await pool.query(
   "UPDATE ngw_character_progress SET inventory=$2::jsonb WHERE character_id=$1",
   [id,JSON.stringify(Array.from({length:12},()=>({id:'wornAxe',qty:1})))]);
  const before=await store.load(a,id);
  await assert.rejects(()=>store.recordMobKill({
   accountId:a,characterId:id,expectedRevision:before.revision,
   radius:261,serverCredit:credit(4)
  }),e=>e.code==='inventory_full');
  const after=await store.load(a,id);
  assert.equal(after.revision,before.revision);
  assert.equal(after.gold,before.gold);
  assert.equal(after.experience,before.experience);
  const rolledBack=await pool.query(
   'SELECT count(*)::int AS n FROM ngw_progress_events WHERE character_id=$1',[id]);
  assert.equal(rolledBack.rows[0].n,3);
  // Starter pack is granted by the server only, once for a fresh hero.
  const starterHero=await pool.query(
   "INSERT INTO ngw_characters(account_id,nickname) VALUES($1,'StarterHero') RETURNING id",[a]);
  const starterId=starterHero.rows[0].id;
  await pool.query("INSERT INTO ngw_character_progress(character_id) VALUES($1)",[starterId]);
  const starter=await store.initializeStarterPack(a,starterId);
  assert.equal(starter.revision,1);
  assert.equal(starter.inventory[0]?.id,'wornAxe');
  assert.deepEqual(starter.inventory[1],{id:'healingPotion',qty:3});
  const repeat=await store.initializeStarterPack(a,starterId);
  assert.equal(repeat.revision,1);
  assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM ngw_progress_events WHERE character_id=$1 AND event_key='starter:default:v1'",[starterId]
  )).rows[0].n,1);
  await assert.rejects(()=>store.initializeStarterPack(b,starterId),e=>e.status===404);
  const healed=await store.useHealingPotion({
   accountId:a,characterId:starterId,expectedRevision:1,currentHp:60,maxHp:120
  });
  assert.equal(healed.progress.health,115);
  assert.equal(healed.progress.revision,2);
  assert.deepEqual(healed.progress.inventory[1],{id:'healingPotion',qty:2});
  await assert.rejects(()=>store.useHealingPotion({
   accountId:a,characterId:starterId,expectedRevision:2,currentHp:120,maxHp:120
  }),e=>e.code==='potion_not_needed');
  await assert.rejects(()=>store.useHealingPotion({
   accountId:a,characterId:starterId,expectedRevision:1,currentHp:30,maxHp:120
  }),e=>e.code==='stale_revision');
  await assert.rejects(()=>store.useHealingPotion({
   accountId:b,characterId:starterId,expectedRevision:2,currentHp:30,maxHp:120
  }),e=>e.status===404);
  assert.equal((await store.load(a,starterId)).inventory[1].qty,2);

  // Render restarts reset mob.life to 1. A new process epoch must allow
  // a legitimately new kill without colliding with the old durable ledger.
  const epochHero=await pool.query(
   "INSERT INTO ngw_characters(account_id,nickname) VALUES($1,'EpochHero') RETURNING id",[a]);
  const epochId=epochHero.rows[0].id;
  await pool.query("INSERT INTO ngw_character_progress(character_id) VALUES($1)",[epochId]);
  const oldRunKill=await store.recordMobKill({
   accountId:a,characterId:epochId,expectedRevision:0,radius:261,serverCredit:credit(1)
  });
  const restartedServerStore=createProgressStore({pool});
  const newRunKill=await restartedServerStore.recordMobKill({
   accountId:a,characterId:epochId,expectedRevision:1,radius:261,serverCredit:credit(1)
  });
  assert.equal(oldRunKill.applied,true);
  assert.equal(newRunKill.applied,true);
  assert.notEqual(oldRunKill.eventKey,newRunKill.eventKey);
  assert.equal((await store.load(a,epochId)).gold,38);
  assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM ngw_progress_events WHERE character_id=$1",[epochId]
  )).rows[0].n,2);
  await pool.query('UPDATE ngw_characters SET deleted_at=now() WHERE id=$1',[id]);
  await assert.rejects(()=>store.load(a,id),e=>e.status===404);
  await assert.rejects(()=>store.recordMobKill({
   accountId:a,characterId:id,expectedRevision:after.revision,
   radius:261,serverCredit:credit(5)
  }),e=>e.status===404);
 }finally{
  await store.close();
  await pool.end();
 }
});
