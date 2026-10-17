// No external dependencies or reversible password storage.
// Opaque session tokens are returned only to the client; PostgreSQL stores
// a SHA-256 digest, never the original token.
import {randomBytes,createHash,scrypt as nativeScrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {validatePassword} from './account-rules.js';
const scrypt=promisify(nativeScrypt);
const N=32768,R=8,P=1,KEY_LENGTH=64,MAXMEM=64*1024*1024;
const HEX=/^[0-9a-f]+$/;
export async function hashPassword(password){
 validatePassword(password);
 const salt=randomBytes(16);
 const key=await scrypt(password,salt,KEY_LENGTH,{N,r:R,p:P,maxmem:MAXMEM});
 return ['scrypt',N,R,P,salt.toString('hex'),key.toString('hex')].join('$');
}
export async function verifyPassword(password,stored){
 if(typeof password!=='string'||typeof stored!=='string')return false;
 const parts=stored.split('$');
 if(parts.length!==6||parts[0]!=='scrypt'||parts[1]!==String(N)||
    parts[2]!==String(R)||parts[3]!==String(P)||
    parts[4].length!==32||parts[5].length!==KEY_LENGTH*2||
    !HEX.test(parts[4])||!HEX.test(parts[5]))return false;
 const expected=Buffer.from(parts[5],'hex');
 const actual=await scrypt(password,Buffer.from(parts[4],'hex'),KEY_LENGTH,
  {N,r:R,p:P,maxmem:MAXMEM});
 return timingSafeEqual(actual,expected);
}
export function newSessionToken(){return randomBytes(32).toString('base64url');}
export function tokenDigest(token){
 if(typeof token!=='string'||token.length!==43||
    !/^[A-Za-z0-9_-]{43}$/.test(token))return null;
 return createHash('sha256').update(token,'utf8').digest();
}
