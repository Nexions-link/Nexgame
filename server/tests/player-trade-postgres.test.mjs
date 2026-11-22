// Real dual-row transactions against disposable LOCAL PostgreSQL only.
// Never fall back to DATABASE_URL or point this fixture at production Neon.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {createProgressStore} from '../progress-store.js';
import {createEconomyStore} from '../economy-store.js';
import {resolveTradeOffer} from '../player-trade-rules.js';
import {ProgressError} from '../progress-rules.js';
const connectionString=process.env.NGW_PROGRESS_TEST_DATABASE;
test('PostgreSQL: player exchanges lock both owners, conserve value, roll back together and never replay an uncertain COMMIT',
 {skip:!connectionString,timeout:65000},async()=>{
  const target=new URL(connectionString);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(target.hostname),'disposable local PostgreSQL only');
  assert.match(target.pathname,/test|ci/i,'fixture database must explicitly be a test database');
  const pool=new pg.Pool({connectionString,max:6,ssl:false}),accounts=[];
  const progress=createProgressStore({pool}),economy=createEconomyStore({pool});
  try{
   await pool.query(await readFile(new URL('../migrations/001_accounts_characters.sql',import.meta.url),'utf8'));
   const hero=async(label,items,gold)=>{
    const suffix=randomUUID().slice(0,8);
    const account=(await pool.query("INSERT INTO ngw_accounts(username,password_hash) VALUES($1,'CI-test-only') RETURNING id",['trade-'+suffix])).rows[0].id;
    accounts.push(account);
    const character=(await pool.query('INSERT INTO ngw_characters(account_id,nickname) VALUES($1,$2) RETURNING id',[account,label+suffix])).rows[0].id;
    await pool.query('INSERT INTO ngw_character_progress(character_id,inventory,gold) VALUES($1,$2::jsonb,$3)',
     [character,JSON.stringify([...items,...Array(12-items.length).fill(null)]),gold]);
    return {accountId:account,characterId:character};
   };
   const a=await hero('ОбменА',[{id:'feather',qty:10},{id:'wornAxe',qty:1}],30);
   const b=await hero('ОбменБ',[{id:'healingPotion',qty:5},{id:'chainVest',qty:1}],20);
   const read=()=>Promise.all([a,b].map(p=>progress.load(p.accountId,p.characterId)));
   const args=(states,offerRows)=>({participants:[a,b].map((p,i)=>({...p,expectedRevision:states[i].revision})),
    offers:states.map((s,i)=>resolveTradeOffer(s,offerRows[i]))});
   const before=await read();
   const original=args(before,[{items:[{tradeSlot:0,bagSlot:0,qty:4}],gold:7},
    {items:[{tradeSlot:1,bagSlot:0,qty:2}],gold:3}]);
   const result=await economy.exchangePlayers(original);
   assert.equal(result.progresses[0].gold,26);assert.equal(result.progresses[1].gold,24);
   assert.ok(result.progresses[0].inventory.some(row=>row?.id==='healingPotion'&&row.qty===2));
   assert.ok(result.progresses[1].inventory.some(row=>row?.id==='feather'&&row.qty===4));
   const after=await read();assert.deepEqual(after,result.progresses);
   await assert.rejects(()=>economy.exchangePlayers(original),e=>e.code==='stale_revision');
   assert.deepEqual(await read(),after,'an old revision pair cannot grant the same exchange twice');

   const next=args(after,[{items:[{tradeSlot:0,bagSlot:0,qty:1}],gold:1},{items:[],gold:0}]);
   await assert.rejects(()=>economy.exchangePlayers({...next,participants:[{...next.participants[0],accountId:b.accountId},next.participants[1]]}),e=>e.status===404);
   assert.deepEqual(await read(),after,'a forged owner cannot change either character');

   let writes=0;
   const failSecond={connect:async()=>{
    const client=await pool.connect();return {release:error=>client.release(error),query:async(sql,params)=>{
     if((sql.text||sql).startsWith('UPDATE ngw_character_progress SET')&&++writes===2)throw new ProgressError('test_second_write',409);
     return client.query(sql,params);
    }};
   }};
   await assert.rejects(()=>createEconomyStore({pool:failSecond}).exchangePlayers(next),e=>e.code==='test_second_write');
   assert.equal(writes,2);assert.deepEqual(await read(),after,'the first real SQL write rolls back when the second write fails');

   let eligible=true,validationCalls=0;
   const leaveDuringWrite={connect:async()=>{
    const client=await pool.connect();return {release:error=>client.release(error),query:async(sql,params)=>{
     const result=await client.query(sql,params);
     if((sql.text||sql).startsWith('UPDATE ngw_character_progress SET'))eligible=false;
     return result;
    }};
   }};
   await assert.rejects(()=>createEconomyStore({pool:leaveDuringWrite}).exchangePlayers({...next,validate:()=>{
    validationCalls++;if(!eligible)throw new ProgressError('trade_too_far',409);
   }}),e=>e.code==='trade_too_far');
   assert.equal(validationCalls,2);assert.deepEqual(await read(),after,'last-moment eligibility is checked after both writes but before COMMIT');

   const race=await Promise.allSettled([
    economy.exchangePlayers(next),
    economy.exchangePlayers({participants:[...next.participants].reverse(),offers:[...next.offers].reverse()})
   ]);
   assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(race.filter(r=>r.status==='rejected'&&r.reason.code==='stale_revision').length,1,
    'opposite participant order does not deadlock or commit two exchanges');
   const raced=await read();assert.equal(raced[0].gold+raced[1].gold,50);

   const uncertain=args(raced,[{items:[{tradeSlot:0,bagSlot:0,qty:1}],gold:1},{items:[],gold:0}]);
   const lostCommit={connect:async()=>{
    const client=await pool.connect();return {release:error=>client.release(error),query:async(sql,params)=>{
     const result=await client.query(sql,params);
     if((sql.text||sql)==='COMMIT')throw Object.assign(Error('test COMMIT response lost'),{code:'ECONNRESET'});
     return result;
    }};
   }};
   await assert.rejects(()=>createEconomyStore({pool:lostCommit}).exchangePlayers(uncertain),e=>e.tradeCommitUncertain===true);
   const committed=await read();assert.equal(committed[0].revision,raced[0].revision+1);
   assert.equal(committed[1].revision,raced[1].revision+1);
   await assert.rejects(()=>economy.exchangePlayers(uncertain),e=>e.code==='stale_revision');
   assert.deepEqual(await read(),committed,'lost acknowledgement cannot authorize a refreshed-revision retry');

   const concurrent=args(committed,[{items:[{tradeSlot:0,bagSlot:0,qty:1}],gold:1},{items:[],gold:0}]);
   const checkpoint=await Promise.allSettled([
    economy.exchangePlayers(concurrent),
    progress.saveServerCheckpoint({...a,expectedRevision:committed[0].revision,
     checkpoint:{normal:[0,0,1],radius:261,heading:.2}})
   ]);
   assert.equal(checkpoint.filter(r=>r.status==='fulfilled').length,1);
   assert.equal(checkpoint.filter(r=>r.status==='rejected'&&r.reason.code==='stale_revision').length,1);
   const latest=await read();assert.equal(latest[0].gold+latest[1].gold,50);
  }finally{
   if(accounts.length)await pool.query('DELETE FROM ngw_accounts WHERE id=ANY($1::uuid[])',[accounts]);
   await pool.end();
  }
 });
