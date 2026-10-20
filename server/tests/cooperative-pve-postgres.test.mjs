// Real PostgreSQL P1.2: two contributors to the SAME mob life have
// separate durable experience, personal corpse loot and reconnect state.
// Uses GitHub Actions disposable Postgres; NEVER use the live Neon URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createProgressStore} from '../progress-store.js';
import {createEconomyStore} from '../economy-store.js';
import {localToNormal} from '../spherical-pve.js';

const connectionString=process.env.NGW_PROGRESS_TEST_DATABASE;
const corpse={mobId:'dolgonog-0',life:1,radius:261,x:-9,z:-23};
const context={
 normal:localToNormal(corpse.x,corpse.z,261),radius:261,inCombat:false
};
const credit=loot=>({type:'killCredit',mobId:corpse.mobId,life:1,xp:22,gold:0,loot});

test('cooperative PvE: distinct accounts keep independent rewards and loot across reconnect',
 {skip:!connectionString,timeout:60000},async()=>{
 const pool=new pg.Pool({connectionString,max:7,ssl:false});
 const epoch=randomUUID();
 const progress=createProgressStore({pool,worldRunId:epoch});
 const economy=createEconomyStore({pool,worldRunId:epoch});
 let relogProgress,relogEconomy;
 try{
  for(const name of ['001_accounts_characters.sql','002_auth_rate_limits.sql',
   '003_progress_event_ledger.sql','004_economy_quests.sql',
   '005_mentor_evidence.sql']){
   await pool.query(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
  }
  const suffix=randomUUID().replaceAll('-','').slice(0,12);
  const createHero=async (index)=>{
   const accountId=(await pool.query(
    "INSERT INTO ngw_accounts(username,password_hash) VALUES($1,'synthetic') RETURNING id",
    ['coop'+index+suffix])).rows[0].id;
   const characterId=(await pool.query(
    "INSERT INTO ngw_characters(account_id,nickname) VALUES($1,$2) RETURNING id",
    [accountId,'Союзник'+index])).rows[0].id;
   await pool.query('INSERT INTO ngw_character_progress(character_id) VALUES($1)',
    [characterId]);
   return {accountId,characterId};
  };
  const a=await createHero(1),b=await createHero(2),spectator=await createHero(3);
  const lootA=[{id:'feather',qty:1}],lootB=[{id:'batteredBuckler',qty:1}];
  const rewardA={...a,expectedRevision:0,radius:261,serverCredit:credit(lootA),deferLoot:true};
  const rewardB={...b,expectedRevision:0,radius:261,serverCredit:credit(lootB),deferLoot:true};
  // Concurrent DB transactions represent two contributors credited for one
  // authoritative creature death, not two independent mob respawns.
  const [earnedA,earnedB]=await Promise.all([
   progress.recordMobKill(rewardA),progress.recordMobKill(rewardB)
  ]);
  for(const earned of [earnedA,earnedB]){
   assert.equal(earned.applied,true);
   assert.equal(earned.progress.experience,22);
   assert.equal(earned.progress.gold,30,'corpse coins cannot auto-grant');
   assert.equal(earned.progress.inventory.filter(Boolean).length,0,
    'loot is not silently added before a corpse interaction');
   assert.equal(earned.progress.revision,1);
  }
  assert.equal((await progress.load(spectator.accountId,spectator.characterId)).experience,0,
   'a player who never damaged the mob gets no XP');
  const replays=await Promise.all([
   progress.recordMobKill(rewardA),progress.recordMobKill(rewardB)
  ]);
  assert.ok(replays.every(row=>row.applied===false&&row.reason==='duplicate'),
   'replaying a shared kill cannot mint more XP');
  // Pretend both clients lost their WebSocket, then rejoin from persisted Neon
  // state using NEW store instances within the SAME server-world epoch.
  relogProgress=createProgressStore({pool,worldRunId:epoch});
  relogEconomy=createEconomyStore({pool,worldRunId:epoch});
  const [savedA,savedB]=await Promise.all([
   relogProgress.load(a.accountId,a.characterId),
   relogProgress.load(b.accountId,b.characterId)
  ]);
  assert.equal(savedA.experience,22);
  assert.equal(savedB.experience,22);
  const argsA={...a,corpse,context,expectedRevision:savedA.revision};
  const argsB={...b,corpse,context,expectedRevision:savedB.revision};
  assert.deepEqual((await relogEconomy.readCorpseLoot(argsA)).loot,lootA);
  assert.deepEqual((await relogEconomy.readCorpseLoot(argsB)).loot,lootB,
   'each participant reopens only their personal drop');
  await assert.rejects(()=>relogEconomy.readCorpseLoot({
   ...argsA,accountId:a.accountId,characterId:b.characterId
  }),error=>error.status===404,'one account cannot inspect another hero');
  await assert.rejects(()=>relogEconomy.takeCorpseLoot({
   ...argsA,accountId:a.accountId,characterId:b.characterId,requestId:randomUUID()
  }),error=>error.status===404,'one account cannot take another hero loot');

  // Two duplicate taps in Safari race for one stack: exactly one may claim it.
  const [take1,take2]=await Promise.all([
   relogEconomy.takeCorpseLoot({...argsA,itemId:'feather',requestId:randomUUID()}),
   relogEconomy.takeCorpseLoot({...argsA,itemId:'feather',requestId:randomUUID()})
  ]);
  assert.equal([take1,take2].filter(x=>x.applied).length,1,
   'two concurrent taps must not duplicate personal loot');
  assert.equal([take1,take2].filter(x=>!x.applied).length,1);
  const takenB=await relogEconomy.takeCorpseLoot({
   ...argsB,itemId:'batteredBuckler',requestId:randomUUID()
  });
  assert.equal(takenB.applied,true);
  const [finalA,finalB]=await Promise.all([
   relogProgress.load(a.accountId,a.characterId),
   relogProgress.load(b.accountId,b.characterId)
  ]);
  assert.deepEqual(finalA.inventory.filter(Boolean),lootA);
  assert.deepEqual(finalB.inventory.filter(Boolean),lootB);
  assert.equal(finalA.experience,22);
  assert.equal(finalB.experience,22);
  assert.equal(finalA.gold,30);
  assert.equal(finalB.gold,30);
  assert.deepEqual((await relogEconomy.readCorpseLoot(argsA)).loot,[]);
  assert.deepEqual((await relogEconomy.readCorpseLoot(argsB)).loot,[]);
  const ledger=await pool.query(
   "SELECT character_id,count(*)::int AS receipts FROM ngw_progress_events WHERE character_id=ANY($1::uuid[]) GROUP BY character_id",
   [[a.characterId,b.characterId,spectator.characterId]]
  );
  assert.equal(ledger.rows.length,2);
  assert.ok(ledger.rows.every(row=>row.receipts===1),
   'exactly one immutable kill credit for each contributor');
 }finally{
  await relogProgress?.close();await relogEconomy?.close();
  await progress.close();await economy.close();await pool.end();
 }
});
