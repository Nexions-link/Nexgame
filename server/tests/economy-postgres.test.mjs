// Real SQL integration on a disposable Postgres 16 service in GitHub Actions.
// NEVER use the production Neon connection string for this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createEconomyStore} from '../economy-store.js';
import {createProgressStore} from '../progress-store.js';
import {gatherNode,ECONOMY_VENDOR,ECONOMY_HERBALIST,ECONOMY_CHEST} from '../economy-rules.js';
import {localToNormal} from '../spherical-pve.js';
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
   '003_progress_event_ledger.sql','004_economy_quests.sql']){
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
    e=>e.code==='gather_cast_not_started');
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
