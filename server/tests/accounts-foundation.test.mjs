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
test('new online characters cannot import legacy saves or choose their own progress',()=>{
 const expected=validateCharacterOptions({nickname:'НовыйГерой'});
 assert.deepEqual(expected,{
  nickname:'НовыйГерой',raceId:INITIAL_RACE,classId:INITIAL_CLASS,appearance:{}
 });
 for(const [field,value] of [
  ['level',60],['experience',25000],['gold',999999],
  ['inventory',[{id:'legacy_axe'}]],['equipment',{weapon:'legendary'}],
  ['quests',{completed:['all']}],['worldRadius',87],
  ['positionNormal',[0,1,0]],['progress',{level:60}],
  ['legacySave',{level:60}],['import',true],
  ['accountId','legacy-account'],['characterId','legacy-character']
 ]){
  assert.throws(()=>validateCharacterOptions({nickname:'НовыйГерой',[field]:value}),
    /Перенос старого прогресса/);
 }
});

test('passwords are salted and never stored as plaintext',async()=>{
 assert.throws(()=>validatePassword('12345'));
 assert.equal(validatePassword('123456'),'123456');
 assert.equal(validatePassword('1234567'),'1234567');
 assert.equal(validatePassword('12345678'),'12345678');
 assert.throws(()=>validatePassword('x'.repeat(129)));
 assert.equal(validatePassword('x'.repeat(128)).length,128);
 assert.equal(validatePassword('пароЛь12'),'пароЛь12');
 const password='test-password-2026!';
 const one=await hashPassword(password),two=await hashPassword(password);
 assert.notEqual(one,two);
 assert.ok(!one.includes(password));
 assert.equal(await verifyPassword(password,one),true);
 assert.equal(await verifyPassword('wrong-password-2026',one),false);
 assert.equal(await verifyPassword(password,'invalid'),false);
 const shortHash=await hashPassword('ab12!?');
 assert.equal(await verifyPassword('ab12!?',shortHash),true);
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
