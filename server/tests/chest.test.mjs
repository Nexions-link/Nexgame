import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSharedChest,transferChest,cleanInventory,CHEST_SLOTS,CHEST_X,CHEST_Z} from '../chest.js';
const empty=()=>Array(CHEST_SLOTS).fill(null);
test('chest uses exactly 18 slots, accepts equipment and stacks loot',()=>{
 const backpack=Array(12).fill(null);backpack[0]={id:'chainVest',qty:1};
 const first=transferChest(empty(),backpack,'deposit',0);
 assert.equal(first.ok,true);assert.deepEqual(first.slots[0],{id:'chainVest',qty:1});
 assert.equal(first.inventory[0],null);
 const back=transferChest(first.slots,first.inventory,'withdraw',0);
 assert.equal(back.ok,true);assert.equal(back.slots[0],null);
 assert.deepEqual(back.inventory[0],{id:'chainVest',qty:1});
 const stack=empty();stack[0]={id:'feather',qty:19};
 const ing=Array(12).fill(null);ing[0]={id:'feather',qty:3};
 const joined=transferChest(stack,ing,'deposit',0);
 assert.equal(joined.ok,true);assert.equal(joined.slots[0].qty,20);
 assert.deepEqual(joined.slots[1],{id:'feather',qty:2});
});
test('quest items are never deposited; capacity enforced on both sides',()=>{
 const inventory=Array(12).fill(null);inventory[0]={id:'meadowFlower',qty:1};
 assert.equal(transferChest(empty(),inventory,'deposit',0).ok,false);
 assert.ok(cleanInventory(inventory));
 const full=Array.from({length:18},()=>({id:'chainVest',qty:1}));
 const item=Array(12).fill(null);item[0]={id:'feather',qty:1};
 assert.equal(transferChest(full,item,'deposit',0).ok,false);
 const chest=empty();chest[0]={id:'feather',qty:2};
 assert.equal(transferChest(chest,full.slice(0,12),'withdraw',0).ok,false);
 assert.equal(cleanInventory([{id:'no_such_item',qty:1},...Array(11).fill(null)]),null);
});
test('two clients see the same item and only one may withdraw it; file survives restart',()=>{
 const folder=mkdtempSync(join(tmpdir(),'nex-chest-')),filePath=join(folder,'shared.json');
 const sent=new Map(),events=[],players=new Map([
 ['a',{x:CHEST_X,z:CHEST_Z}],['b',{x:CHEST_X,z:CHEST_Z}],
 ]);
 const send=(id,data)=>sent.set(id,data),broadcast=msg=>events.push(msg);
 try{
  const chest=createSharedChest({filePath,send,broadcast,players});
  const a=Array(12).fill(null);a[0]={id:'chainBelt',qty:1};
  const b=Array(12).fill(null);
  assert.equal(chest.open('a',a),true);assert.equal(chest.open('b',b),true);
  assert.equal(chest.move('a',{action:'deposit',slot:0,requestId:'deposit-test-123'}),true);
  assert.equal(chest.state().slots[0].id,'chainBelt');
  assert.equal(chest.move('b',{action:'withdraw',slot:0,requestId:'withdraw-test-456'}),true);
  assert.deepEqual(sent.get('b').inventory[0],{id:'chainBelt',qty:1});
  assert.equal(chest.move('a',{action:'withdraw',slot:0,requestId:'duplicate-test-99'}),false);
  assert.equal(events.length,2);
  assert.equal(JSON.parse(readFileSync(filePath)).revision,2);
  const revived=createSharedChest({filePath,send,broadcast,players});
  assert.equal(revived.state().slots.every(x=>x===null),true);
  assert.equal(revived.state().revision,2);
  players.get('b').x=100;
  assert.equal(revived.open('b',b),false);
 }finally{rmSync(folder,{force:true,recursive:true})}
});
