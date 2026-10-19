import test from 'node:test';
import assert from 'node:assert/strict';
import {ADMIN_BATTLEFURY_CHARACTER_ID,ADMIN_BATTLEFURY_ACCOUNT_ID,isAuthorizedBattlefuryEquipped} from '../admin-battlefury.js';
test('one-hit privilege requires verified account, character and weapon',()=>{
 const owner={characterId:ADMIN_BATTLEFURY_CHARACTER_ID,accountId:ADMIN_BATTLEFURY_ACCOUNT_ID,equipment:{weapon:{id:'adminBattlefury'}}};
 assert.equal(isAuthorizedBattlefuryEquipped(owner),true);
 assert.equal(isAuthorizedBattlefuryEquipped({...owner,characterId:'other'}),false);
 assert.equal(isAuthorizedBattlefuryEquipped({...owner,accountId:'other'}),false);
 assert.equal(isAuthorizedBattlefuryEquipped({...owner,equipment:{weapon:{id:'wornAxe'}}}),false);
});
