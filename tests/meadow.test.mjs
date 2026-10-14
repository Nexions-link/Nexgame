import test from 'node:test';
import assert from 'node:assert/strict';
import {scatterMeadow} from '../meadow.js';

test('stable foliage positions do not depend on global gameplay random',()=>{
 const opts={count:180,seed:42,extent:60};
 const a=scatterMeadow(opts),b=scatterMeadow(opts);
 assert.deepEqual(a,b);assert.equal(a.length,180);
 for(const p of a){
  assert.ok(Math.abs(p.x)<=60&&Math.abs(p.z)<=60);
  assert.ok(p.angle>=0&&p.angle<Math.PI*2);
  assert.ok(p.scale>=.55&&p.scale<=1.4);
 }
 assert.notDeepEqual(a,scatterMeadow({...opts,seed:43}));
});
test('excluded roads, house footprints and spawn areas stay clear',()=>{
 const road=(x,z)=>Math.abs(x)<2;
 const building=(x,z)=>x>10&&x<30&&z>10&&z<30;
 const spawn=(x,z)=>Math.hypot(x,z)<9;
 const points=scatterMeadow({count:300,attempts:3000,seed:914,
  accept:(x,z)=>!road(x,z)&&!building(x,z)&&!spawn(x,z)});
 assert.equal(points.length,300);
 for(const p of points)assert.equal(road(p.x,p.z)||building(p.x,p.z)||spawn(p.x,p.z),false);
});
test('empty and blocked scatter end safely; invalid configurations rejected',()=>{
 assert.deepEqual(scatterMeadow({count:0}),[]);
 assert.deepEqual(scatterMeadow({count:10,attempts:70,accept:()=>false}),[]);
 assert.throws(()=>scatterMeadow({count:-1}),RangeError);
 assert.throws(()=>scatterMeadow({count:21000}),RangeError);
});
