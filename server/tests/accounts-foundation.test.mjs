import test from 'node:test';
import assert from 'node:assert/strict';
import {
 CHARACTER_SLOT_LIMIT,INITIAL_CLASS,INITIAL_RACE,
 normalizeUsername,validatePassword,normalizeNickname,validateCharacterOptions
} from '../account-rules.js';
import {hashPassword,verifyPassword,newSessionToken,tokenDigest,createRecoveryCodes,recoveryCodeDigest} from '../auth-crypto.js';

test('username normalization and invalid login names',()=>{
 assert.equal(normalizeUsername('  HERO_01  '),'hero_01');
 for(const bad of ['','a','a@b.com','name with spaces','-bad','тест'])
  assert.throws(()=>normalizeUsername(bad));
});
test('nickname rules accept Cyrillic, reject control/markup/unsupported classes',()=>{
 assert.equal(normalizeNickname('  Грозный_Тур  '),'Грозный_Тур');
 assert.equal(normalizeNickname('Axe-01'),'Axe-01');
 for(const bad of ['a',' name with spaces ','<script>','\nHero','-bad','bad-'])
  assert.throws(()=>normalizeNickname(bad));
 assert.deepEqual(validateCharacterOptions({nickname:'Северный',raceId:INITIAL_RACE,classId:INITIAL_CLASS}),
  {nickname:'Северный',raceId:INITIAL_RACE,classId:INITIAL_CLASS,appearance:{}});
 assert.throws(()=>validateCharacterOptions({nickname:'Северный',classId:'mage'}));
 assert.equal(CHARACTER_SLOT_LIMIT,3);
});
test('passwords are salted and never stored as plaintext',async()=>{
 assert.throws(()=>validatePassword('short'));
 const password='test-password-2026!';
 const one=await hashPassword(password),two=await hashPassword(password);
 assert.notEqual(one,two);
 assert.ok(!one.includes(password));
 assert.equal(await verifyPassword(password,one),true);
 assert.equal(await verifyPassword('wrong-password-2026',one),false);
 assert.equal(await verifyPassword(password,'invalid'),false);
});
test('sessions store only fixed-size hash of a random secret',()=>{
 const a=newSessionToken(),b=newSessionToken(),hash=tokenDigest(a);
 assert.equal(a.length,43);
 assert.notEqual(a,b);
 assert.equal(hash.length,32);
 assert.deepEqual(tokenDigest(a),hash);
 assert.notDeepEqual(tokenDigest(b),hash);
 assert.equal(tokenDigest('malformed'),null);
});

test('recovery codes are unique one-time secrets not their stored hashes',()=>{
 const codes=createRecoveryCodes();
 assert.equal(codes.length,8);
 assert.equal(new Set(codes).size,8);
 for(const code of codes){assert.match(code,/^[0-9A-F]{32}$/);assert.equal(recoveryCodeDigest(code).length,32)}
 assert.equal(recoveryCodeDigest('invalid'),null);
});
