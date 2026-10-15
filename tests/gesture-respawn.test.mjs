import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>readFileSync(resolve(root,name),'utf8');

test('iOS double-tap zoom is cancelled before the browser performs smart zoom',()=>{
 const game=read('game.js'),css=read('style.css');
 assert.match(game,/addEventListener\('touchstart',event=>/);
 assert.match(game,/event\.preventDefault\(\);lastTouchTap=null/);
 assert.match(game,/\{passive:false,capture:true\}/);
 assert.match(game,/addEventListener\('dblclick',event=>/);
 assert.match(css,/html,body,#scene,#scene canvas,#hudTop,#actionsBar\{touch-action:none!important/);
 assert.match(read('app.html'),/user-scalable=no/);
});

test('client respawn blocks stale hits until server acknowledges teleport',()=>{
 const game=read('game.js');
 assert.match(game,/let respawnGraceUntil=0,respawnPending=false/);
 assert.ok(game.indexOf('let respawnGraceUntil=0,respawnPending=false')<game.indexOf('const worldConnection=createWorldPresence'));
 assert.match(game,/respawnPending=!!worldConnection\?\.connected\?\.\(\)/);
 assert.match(game,/if\(respawnPending\|\|performance\.now\(\)<respawnGraceUntil\|\|/);
 assert.match(game,/onRespawnAccepted:packet=>/);
 assert.match(game,/respawnPending=false;/);
 assert.match(read('online.js'),/onRespawnAccepted\?\.\(m\)/);
});

test('world server clears aggro and broadcasts fresh mob state at respawn',()=>{
 const server=read('server/index.js');
 assert.match(server,/releaseMulgoreAggroForPlayer\(mobs,id\)/);
 assert.match(server,/broadcast\(\{type:'mobSnapshot',mobs:snapshotMulgoreMobs\(mobs,now\)\}\)/);
 assert.match(server,/player\.lastMobAttackAt=0/);
 assert.match(read('online.js'),/m\.type==='mobSnapshot'/);
 const release=read('app.html').match(/NexGame · Мулгор · Alpha (\d+\.\d+\.\d+\.\d+)/)?.[1];
 assert.ok(release,'game release exists');
 assert.ok(server.includes("WORLD_BUILD='"+release+"'"),'world server build matches game release');
});
