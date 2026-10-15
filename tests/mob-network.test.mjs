import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSharedMobTargets,mobSnapshotErrorLabel,MOB_SNAPSHOT_WORLD_BOUND} from '../mob-network.js';
const spawns=[[-9,-23],[1,-28],[13,-22],[21,-33],[-22,-35],[-28,29],[15,36],[48,9],[39,47]];
const enemies=[...spawns.map(([x,z])=>({spawnX:x,spawnZ:z,root:{rotation:{y:.3}}})),{trainingDummy:true}];
const packet=()=>spawns.map(([x,z],id)=>({id,x,z,yaw:.2,phase:id,hp:54,maxHp:54,life:1,dead:false,aggroId:null,stunned:false}));

test('all nine authoritative mobs remain valid beyond the 23m leash',()=>{
 const rows=packet();
 rows.slice(0,7).forEach((row,i)=>{row.x+=30+i;row.z+=3;});
 const result=collectSharedMobTargets(rows,enemies);
 assert.equal(result.targets.size,9,'avoid old 2/9 snapshot failure');
 assert.deepEqual(result.rejected,{id:0,position:0,outsideWorld:0,duplicate:0});
 assert.equal(result.targets.get(0).x,21);
 assert.equal(MOB_SNAPSHOT_WORLD_BOUND,80);
});
test('unknown yaw is safely filled rather than dropping a valid mob',()=>{
 const rows=packet();delete rows[3].yaw;
 const result=collectSharedMobTargets(rows,enemies);
 assert.equal(result.targets.size,9);
 assert.equal(result.targets.get(3).yaw,.3);
});
test('malformed packets provide a meaningful diagnostic',()=>{
 const rows=packet();
 rows[0].x=NaN;rows[1].z=1000;rows[2].id=99;
 rows.push({...rows[3]});rows.push({id:9,x:0,z:0,yaw:0});
 const {targets,rejected}=collectSharedMobTargets(rows,enemies);
 assert.equal(targets.size,6);
 assert.deepEqual(rejected,{id:2,position:1,outsideWorld:1,duplicate:1});
 assert.match(mobSnapshotErrorLabel(rejected,targets.size,9),/6\/9.*координаты:1.*вне карты:1/);
});
