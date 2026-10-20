// Real SQL integration on a disposable Postgres 16 service in GitHub Actions.
// NEVER use the production Neon connection string for this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createEconomyStore} from '../economy-store.js';
import {createProgressStore} from '../progress-store.js';
import {gatherNode,ECONOMY_VENDOR,ECONOMY_HERBALIST,ECONOMY_CHEST,ECONOMY_MENTOR} from '../economy-rules.js';
import {localToNormal} from '../spherical-pve.js';
import {RELIC_POSITION,SCOUT_POSITION} from '../../planet-test/mentor-chain.js';
const connectionString=process.env.NGW_PROGRESS_TEST_DATABASE;
const ctx=(point,extra={})=>({
 normal:localToNormal(point.x,point.z,261),radius:261,inCombat:false,...extra
});
test('PostgreSQL: owner-bound economy, receipt replay, shared chest, gather cast and quest payouts',
 {skip:!connectionString,timeout:65000},async()=>{
 const pool=new pg.Pool({connectionString,max:8,ssl:false});
 const store=createEconomyStore({pool}),progress=createProgressStore({pool});
 try{
  for(const name of ['001_accounts_characters.sql','002_auth_rate_limits.sql',
   '003_progress_event_ledger.sql','004_economy_quests.sql',
   '005_mentor_evidence.sql']){
   await pool.query(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
  }
  assert.equal(await store.schemaReady(),true);
  const user=async name=>(await pool.query(
   "INSERT INTO ngw_accounts(username,password_hash) VALUES($1,'CI-only-test') RETURNING id",
   [name])).rows[0].id;
  const a=await user('economya'),b=await user('economyb'),c=await user('economyc');
  const hero=async(account,name)=>{
   const row=(await pool.query(
    'INSERT INTO ngw_characters(account_id,nickname) VALUES($1,$2) RETURNING id',
    [account,name])).rows[0];
   await pool.query('INSERT INTO ngw_character_progress(character_id) VALUES($1)',[row.id]);
   return row.id;
  };
  const alice=await hero(a,'Экономист'),bob=await hero(b,'Складовщик'),
   charlie=await hero(c,'Дубликатор');
  const base=(accountId,characterId,expectedRevision,context,more={})=>({
   accountId,characterId,expectedRevision,context,requestId:randomUUID(),...more
  });
  await assert.rejects(()=>store.buy(base(b,alice,0,ctx(ECONOMY_VENDOR),{
   itemId:'wornAxe',qty:1
  })),e=>e.status===404);
  await assert.rejects(()=>store.buy(base(a,alice,0,ctx({x:100,z:100}),{
   itemId:'wornAxe',qty:1
  })),e=>e.code==='interaction_too_far');
  const firstArgs=base(a,alice,0,ctx(ECONOMY_VENDOR),{itemId:'wornAxe',qty:1});
  const bought=await store.buy(firstArgs);
  assert.equal(bought.applied,true);
  assert.equal(bought.progress.revision,1);
  assert.equal(bought.progress.gold,22);
  assert.deepEqual(bought.progress.inventory[0],{id:'wornAxe',qty:1});
  const replay=await store.buy(firstArgs);
  assert.equal(replay.applied,false);
  assert.equal(replay.progress.gold,22);
  await assert.rejects(()=>store.buy({...firstArgs,qty:2}),e=>e.code==='idempotency_key_conflict');
  await assert.rejects(()=>store.buy(base(a,alice,0,ctx(ECONOMY_VENDOR),{
   itemId:'wornAxe',qty:1
  })),e=>e.code==='stale_revision');
  const parallel=await Promise.allSettled([0,1].map(()=>store.buy(base(a,alice,1,ctx(ECONOMY_VENDOR),{
   itemId:'batteredBuckler',qty:1
  }))));
  assert.equal(parallel.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(parallel.filter(x=>x.status==='rejected'&&x.reason.code==='stale_revision').length,1);
  const afterBuy=await progress.load(a,alice);
  assert.equal(afterBuy.revision,2);
  assert.equal(afterBuy.gold,12);
  // Alice deposits an owned item; Bob withdraws it into his DB backpack.
  const deposited=await store.moveChest(base(a,alice,2,ctx(ECONOMY_CHEST),{
   action:'deposit',slot:0
  }));
  assert.equal(deposited.progress.inventory[0],null);
  assert.deepEqual(deposited.chest.slots[0],{id:'wornAxe',qty:1});
  const itemInChest=await store.readChest({
   accountId:b,characterId:bob,context:ctx(ECONOMY_CHEST)
  });
  assert.equal(itemInChest.revision,1);
  const simultaneous=await Promise.allSettled([
   store.moveChest(base(b,bob,0,ctx(ECONOMY_CHEST),{action:'withdraw',slot:0})),
   store.moveChest(base(c,charlie,0,ctx(ECONOMY_CHEST),{action:'withdraw',slot:0}))
  ]);
  assert.equal(simultaneous.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(simultaneous.filter(x=>x.status==='rejected').length,1);
  const receivers=[await progress.load(b,bob),await progress.load(c,charlie)];
  assert.equal(receivers.reduce((sum,s)=>sum+s.inventory.filter(x=>x?.id==='wornAxe').length,0),1);
  assert.equal((await store.readChest({
   accountId:a,characterId:alice,context:ctx(ECONOMY_CHEST)
  })).slots.every(x=>!x),true);
  const sel=await store.sell(base(a,alice,3,ctx(ECONOMY_VENDOR),{
   bagSlot:0,qty:1
  })).catch(e=>e);
  // Alice's backpack slot 0 is empty after the deposit; no free gold.
  assert.equal(sel.code,'item_not_sellable');
  assert.equal((await progress.load(a,alice)).gold,12);
  // Accepting a gathering quest changes only the character's quest state.
  const accepted=await store.acceptGather(base(a,alice,3,ctx(ECONOMY_HERBALIST)));
  assert.equal(accepted.progress.quests.gather.stage,1);
  assert.equal(accepted.progress.quests.gather.accepted,true);
  let rev=accepted.progress.revision;
  for(let index=0;index<4;index++){
   const node=gatherNode(1,index);
   const started=await store.startGather(base(a,alice,rev,ctx(node),{stage:1,index}));
   assert.equal(started.started,true);
   if(index===0){
    await assert.rejects(()=>store.finishGather(base(a,alice,rev,ctx(node),{
     stage:1,index
    })),e=>e.code==='gather_cast_in_progress');
   }
   await pool.query("UPDATE ngw_gather_casts SET started_at=now()-INTERVAL '2 seconds' WHERE character_id=$1",[alice]);
   const collected=await store.finishGather(base(a,alice,rev,ctx(node),{stage:1,index}));
   assert.equal(collected.item.id,'meadowFlower');
   rev=collected.progress.revision;
   await assert.rejects(()=>store.finishGather(base(a,alice,rev,ctx(node),{stage:1,index})),
    e=>['gather_cast_not_started','quest_ingredients_complete'].includes(e.code));
   if(index===0){
    const other=await store.acceptGather(base(b,bob,(await progress.load(b,bob)).revision,
     ctx(ECONOMY_HERBALIST)));
    await assert.rejects(()=>store.startGather(base(b,bob,other.progress.revision,ctx(node),{
     stage:1,index
    })),e=>e.code==='gather_node_respawning');
   }
  }
  const ready=await progress.load(a,alice);
  assert.equal(ready.inventory.reduce((n,item)=>n+(item?.id==='meadowFlower'?item.qty:0),0),4);
  const turned=await store.turnInGather(base(a,alice,rev,ctx(ECONOMY_HERBALIST)));
  assert.equal(turned.reward.xp,35);
  assert.equal(turned.reward.gold,12);
  assert.equal(turned.progress.experience,35);
  assert.equal(turned.progress.gold,24);
  assert.deepEqual(turned.progress.quests.gather,{stage:2,accepted:false});
  assert.equal(turned.progress.inventory.some(row=>row?.id==='meadowFlower'),false);
  await assert.rejects(()=>store.turnInGather(base(a,alice,turned.progress.revision,ctx(ECONOMY_HERBALIST))),
   e=>e.code==='quest_not_ready');
  const questEvents=await pool.query(
   "SELECT count(*)::int AS n FROM ngw_progress_events WHERE character_id=$1 AND event_key='gather:turnin:1'",[alice]);
  assert.equal(questEvents.rows[0].n,1);
  // A full backpack fails the entire finishGather transaction; node stays ready,
  // cast stays active and nobody is awarded a phantom flower.
  const full=Array.from({length:12},()=>({id:'wornAxe',qty:1}));
  await pool.query('UPDATE ngw_character_progress SET inventory=$2::jsonb WHERE character_id=$1',
   [bob,JSON.stringify(full)]);
  const bobRevision=(await progress.load(b,bob)).revision;
  const node=gatherNode(1,4);
  await store.startGather(base(b,bob,bobRevision,ctx(node),{stage:1,index:4}));
  await pool.query("UPDATE ngw_gather_casts SET started_at=now()-INTERVAL '2 seconds' WHERE character_id=$1",[bob]);
  await assert.rejects(()=>store.finishGather(base(b,bob,bobRevision,ctx(node),{stage:1,index:4})),
   e=>e.code==='inventory_full');
  assert.equal((await progress.load(b,bob)).revision,bobRevision);
  assert.equal((await pool.query(
   'SELECT count(*)::int AS n FROM ngw_gather_casts WHERE character_id=$1',[bob]
  )).rows[0].n,1);
  assert.equal((await pool.query(
   'SELECT count(*)::int AS n FROM ngw_gather_nodes WHERE node_id=$1 AND ready_at>now()',[node.nodeId]
  )).rows[0].n,0);

  // Mentor quest chain is driven only by verified PvE evidence and interaction
  // positions; duplicate kills and repeated turn-ins never duplicate rewards.
  const normalKill=life=>({type:'killCredit',mobId:'dolgonog-0',
   life,xp:22,gold:0,loot:[{id:'feather',qty:1}]});
  const start=await store.startMentor(base(c,charlie,(await progress.load(c,charlie)).revision,
   ctx(ECONOMY_MENTOR)));
  let mentorRev=start.progress.revision;
  assert.equal(start.progress.quests.mentor.step,1);
  for(let life=1;life<=3;life++){
   const killed=await store.recordMentorKill(base(c,charlie,mentorRev,null,{
    serverCredit:normalKill(life)
   }));
   assert.equal(killed.applied,true);
   mentorRev=killed.progress.revision;
   const duplicate=await store.recordMentorKill(base(c,charlie,mentorRev-1,null,{
    serverCredit:normalKill(life)
   }));
   assert.equal(duplicate.applied,false);
  }
  assert.equal((await progress.load(c,charlie)).quests.mentor.step,2);
  await assert.rejects(()=>store.recordMentorKill(base(c,charlie,mentorRev,null,{
   serverCredit:{...normalKill(4),gold:999999}
  })),e=>e.code==='invalid_kill_reward');
  const mentorReward1=await store.turnInMentor(base(c,charlie,mentorRev,ctx(ECONOMY_MENTOR)));
  assert.equal(mentorReward1.reward.gold,25);
  assert.equal(mentorReward1.reward.xp,80);
  mentorRev=mentorReward1.progress.revision;
  await assert.rejects(()=>store.turnInMentor(base(c,charlie,mentorRev,ctx(ECONOMY_MENTOR))),
   e=>e.code==='mentor_reward_not_ready');
  const mentorStage4=await store.startMentor(base(c,charlie,mentorRev,ctx(ECONOMY_MENTOR)));
  mentorRev=mentorStage4.progress.revision;
  await assert.rejects(()=>store.mentorInteract(base(c,charlie,mentorRev,ctx({x:100,z:100}),{
   kind:'relic'
  })),e=>e.code==='interaction_too_far');
  const relic=await store.mentorInteract(base(c,charlie,mentorRev,ctx(RELIC_POSITION),{kind:'relic'}));
  mentorRev=relic.progress.revision;
  const mentorReward2=await store.turnInMentor(base(c,charlie,mentorRev,ctx(ECONOMY_MENTOR)));
  mentorRev=mentorReward2.progress.revision;
  const mentorStage7=await store.startMentor(base(c,charlie,mentorRev,ctx(ECONOMY_MENTOR)));
  mentorRev=mentorStage7.progress.revision;
  const scout=await store.mentorInteract(base(c,charlie,mentorRev,ctx(SCOUT_POSITION),{kind:'scout'}));
  mentorRev=scout.progress.revision;
  const mentorReward3=await store.turnInMentor(base(c,charlie,mentorRev,ctx(ECONOMY_MENTOR)));
  mentorRev=mentorReward3.progress.revision;
  const mentorStage10=await store.startMentor(base(c,charlie,mentorRev,ctx(ECONOMY_MENTOR)));
  mentorRev=mentorStage10.progress.revision;
  const boss={type:'killCredit',mobId:'dolgonog-9',life:1,
   xp:70,gold:0,loot:[{id:'giantFeather',qty:1}]};
  await assert.rejects(()=>store.recordMentorKill(base(c,charlie,mentorRev,null,{
   serverCredit:normalKill(5)
  })),e=>e.code==='wrong_mentor_target');
  const bossReward=await store.recordMentorKill(base(c,charlie,mentorRev,null,{
   serverCredit:boss
  }));
  mentorRev=bossReward.progress.revision;
  const mentorFinished=await store.turnInMentor(base(c,charlie,mentorRev,ctx(ECONOMY_MENTOR)));
  assert.equal(mentorFinished.progress.quests.mentor.step,12);
  assert.equal(mentorFinished.progress.gold,235); // Quest reward unchanged; no creature kill gold is paid in this test.
  assert.equal(mentorFinished.progress.level,4);
  assert.equal(mentorFinished.progress.experience,25);
  assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM ngw_progress_events WHERE character_id=$1 AND event_kind='quest_reward'",[charlie]
  )).rows[0].n,4);
  assert.equal((await pool.query(
   "SELECT count(*)::int AS n FROM ngw_mentor_kill_evidence WHERE character_id=$1",[charlie]
  )).rows[0].n,4);
  await pool.query('UPDATE ngw_characters SET deleted_at=now() WHERE id=$1',[alice]);
  await assert.rejects(()=>store.moveChest(base(a,alice,turned.progress.revision,
   ctx(ECONOMY_CHEST),{action:'withdraw',slot:0})),e=>e.status===404);
  // Did not silently create free currency or duplicate shared items.
  assert.equal((await pool.query(
   'SELECT count(*)::int AS n FROM ngw_economy_receipts WHERE character_id=$1',[alice]
  )).rows[0].n,3);
 }finally{
  await store.close();await progress.close();await pool.end();
 }
});

test('Postgres corpse loot: deferred grant, ownership, partial take-all, replay and atomic rollback',
 {skip:!connectionString,timeout:45000},async()=>{
 const pool=new pg.Pool({connectionString,max:4,ssl:false});
 const worldRunId=randomUUID(),store=createEconomyStore({pool,worldRunId}),progress=createProgressStore({pool,worldRunId});
 try{
  for(const name of ['001_accounts_characters.sql','002_auth_rate_limits.sql','003_progress_event_ledger.sql','004_economy_quests.sql','005_mentor_evidence.sql'])
   await pool.query(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
  const account=(await pool.query("INSERT INTO ngw_accounts(username,password_hash) VALUES($1,'test') RETURNING id",['loot'+randomUUID().replaceAll('-','').slice(0,12)])).rows[0].id;
  const makeHero=async nickname=>{
   const id=(await pool.query('INSERT INTO ngw_characters(account_id,nickname) VALUES($1,$2) RETURNING id',[account,nickname])).rows[0].id;
   await pool.query('INSERT INTO ngw_character_progress(character_id) VALUES($1)',[id]);return id;
  };
  const hero=await makeHero('Добытчик'),other=await makeHero('Чужой');
  const credit={type:'killCredit',mobId:'dolgonog-0',life:1,xp:22,gold:0,loot:[{id:'feather',qty:1},{id:'batteredBuckler',qty:1}]};
  const killed=await progress.recordMobKill({accountId:account,characterId:hero,expectedRevision:0,radius:261,serverCredit:credit,deferLoot:true});
  assert.equal(killed.progress.experience,22);assert.equal(killed.progress.gold,30);
  assert.equal(killed.progress.inventory.some(Boolean),false,'Kill must not auto-loot');
  const corpse={mobId:credit.mobId,life:1,radius:261,x:-9,z:-23};
  const args={accountId:account,characterId:hero,expectedRevision:1,context:ctx(corpse),corpse};
  assert.deepEqual((await store.readCorpseLoot(args)).loot,credit.loot);
  assert.deepEqual((await store.readCorpseLoot({...args,characterId:other})).loot,[]);
  await assert.rejects(()=>store.takeCorpseLoot({...args,characterId:other,expectedRevision:0,requestId:randomUUID()}),e=>e.code==='corpse_not_owned');
  await assert.rejects(()=>store.takeCorpseLoot({...args,context:ctx({x:50,z:50}),requestId:randomUUID()}),e=>e.code==='interaction_too_far');
  const requestId=randomUUID();
  const take=await store.takeCorpseLoot({...args,itemId:'feather',requestId});
  assert.deepEqual(take.loot,[{id:'batteredBuckler',qty:1}]);
  assert.deepEqual(take.progress.inventory[0],{id:'feather',qty:1});
  const duplicate=await store.takeCorpseLoot({...args,itemId:'feather',requestId});
  assert.equal(duplicate.applied,false);assert.equal(duplicate.progress.revision,2);
  assert.equal((await store.takeCorpseLoot({...args,itemId:'feather',expectedRevision:2})).applied,false);
  await pool.query('UPDATE ngw_character_progress SET inventory=$2::jsonb WHERE character_id=$1',[hero,JSON.stringify(Array.from({length:12},()=>({id:'wornAxe',qty:1})))]);
  await assert.rejects(()=>store.takeCorpseLoot({...args,expectedRevision:2,requestId:randomUUID()}),e=>e.code==='inventory_full');
  assert.deepEqual((await store.readCorpseLoot(args)).loot,[{id:'batteredBuckler',qty:1}]);
  const bag=Array.from({length:12},()=>({id:'wornAxe',qty:1}));bag[0]={id:'feather',qty:1};
  await pool.query('UPDATE ngw_character_progress SET inventory=$2::jsonb WHERE character_id=$1',[hero,JSON.stringify(bag)]);
  const killed2=await progress.recordMobKill({accountId:account,characterId:hero,expectedRevision:2,radius:261,serverCredit:{...credit,life:2},deferLoot:true});
  assert.equal(killed2.progress.experience,44,'Full bag must not block XP');
  const partial=await store.takeCorpseLoot({...args,expectedRevision:3,corpse:{...corpse,life:2},requestId:randomUUID()});
  assert.deepEqual(partial.taken,[{id:'feather',qty:1}]);
  assert.deepEqual(partial.loot,[{id:'batteredBuckler',qty:1}]);
  assert.equal(partial.progress.inventory[0].qty,2);
  assert.equal(partial.progress.experience,44);
  // Future humanoids deposit money rows in the same corpse ledger.
  // Simulate an authoritative server-created money row with a FULL bag.
  const moneyCorpse={...corpse,life:2};
  const priorCoins=partial.progress.gold;
  await pool.query(
   "UPDATE ngw_progress_events SET loot=$3::jsonb WHERE character_id=$1 AND event_key LIKE $2",
   [hero,'%:dolgonog-0:2:corpse',JSON.stringify([{id:'coins',qty:13},{id:'batteredBuckler',qty:1}])]);
  const beforeMoney=await store.readCorpseLoot({...args,corpse:moneyCorpse});
  assert.deepEqual(beforeMoney.loot[0],{id:'coins',qty:13});
  assert.equal((await progress.load(account,hero)).gold,priorCoins,'money not auto-collected');
  const picked=await store.takeCorpseLoot({...args,corpse:moneyCorpse,
   expectedRevision:partial.progress.revision,itemId:'coins',requestId:randomUUID()});
  assert.equal(picked.applied,true);
  assert.equal(picked.progress.gold,priorCoins+13);
  assert.deepEqual(picked.taken,[{id:'coins',qty:13}]);
  assert.deepEqual(picked.loot,[{id:'batteredBuckler',qty:1}]);
  assert.deepEqual(picked.progress.inventory,partial.progress.inventory,'currency uses no bag slot');
  const repeat=await store.takeCorpseLoot({...args,corpse:moneyCorpse,
   expectedRevision:picked.progress.revision,itemId:'coins',requestId:randomUUID()});
  assert.equal(repeat.applied,false);assert.equal(repeat.progress.gold,priorCoins+13);
  const ledger=await pool.query(
   "SELECT gold_granted FROM ngw_progress_events WHERE character_id=$1 AND event_key LIKE $2",
   [hero,'%:dolgonog-0:2:corpse']);
  assert.equal(Number(ledger.rows[0].gold_granted),13);
 }finally{await store.close();await progress.close();await pool.end()}
});

test('PostgreSQL: lost COMMIT acknowledgment cannot duplicate merchant item or charge',
 {skip:!connectionString,timeout:45000},async()=>{
 const pool=new pg.Pool({connectionString,max:4,ssl:false});
 let dropCommitAck=true;
 // The SQL COMMIT actually succeeds, but the caller receives a fake network
 // error. This models losing Neon connectivity after commit and before ACK.
 const wrappedPool={
  query:(...args)=>pool.query(...args),
  connect:async()=>{
   const client=await pool.connect();
   return {
    query:async (...args)=>{
     const result=await client.query(...args);
     if(args[0]==='COMMIT'&&dropCommitAck){
      dropCommitAck=false;
      throw Object.assign(Error('Connection terminated unexpectedly'),{code:'08006'});
     }
     return result;
    },
    release:()=>client.release()
   };
  }
 };
 const store=createEconomyStore({pool:wrappedPool});
 const progress=createProgressStore({pool});
 try{
  for(const file of ['001_accounts_characters.sql','002_auth_rate_limits.sql',
   '003_progress_event_ledger.sql','004_economy_quests.sql',
   '005_mentor_evidence.sql']){
   await pool.query(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
  }
  const suffix=randomUUID().replaceAll('-','').slice(0,11);
  const account=(await pool.query(
   "INSERT INTO ngw_accounts(username,password_hash) VALUES($1,'test-only') RETURNING id",
   ['a'+suffix])).rows[0].id;
  const character=(await pool.query(
   "INSERT INTO ngw_characters(account_id,nickname) VALUES($1,$2) RETURNING id",
   [account,'Hero'+suffix])).rows[0].id;
  await pool.query('INSERT INTO ngw_character_progress(character_id) VALUES($1)',[character]);
  const request={accountId:account,characterId:character,expectedRevision:0,
   context:ctx(ECONOMY_VENDOR),requestId:randomUUID(),itemId:'wornAxe',qty:1};
  await assert.rejects(()=>store.buy(request),e=>e.code==='08006');
  const committed=await progress.load(account,character);
  assert.equal(committed.revision,1,'transaction was COMMITTED before ACK disappeared');
  assert.equal(committed.gold,22);
  assert.deepEqual(committed.inventory[0],{id:'wornAxe',qty:1});
  const replay=await store.buy(request);
  assert.equal(replay.applied,false,'the same receipt must not grant loot again');
  assert.equal(replay.progress.revision,1);
  assert.equal(replay.progress.gold,22);
  assert.deepEqual(replay.progress.inventory[0],{id:'wornAxe',qty:1});
  await assert.rejects(()=>store.buy({...request,qty:2}),
   e=>e.code==='idempotency_key_conflict');
  await assert.rejects(()=>store.buy({...request,requestId:randomUUID()}),
   e=>e.code==='stale_revision');
  const receipt=await pool.query(
   'SELECT count(*)::int AS n FROM ngw_economy_receipts WHERE character_id=$1',
   [character]);
  assert.equal(receipt.rows[0].n,1,'only the single committed purchase is recorded');
 }finally{await store.close();await progress.close();await pool.end()}
});
