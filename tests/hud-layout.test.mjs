import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'index.html'),'utf8');
const css=readFileSync(resolve(root,'style.css'),'utf8');
const game=readFileSync(resolve(root,'game.js'),'utf8');
const order=['playerFrame','targetFrame','allyFrame','targetPlaceholder','minimapFrame'];

test('all upper HUD panels share one responsive grid',()=>{
 const begin=html.indexOf('<div id="hudTop"'),end=html.indexOf('</div>\n<div id="zoneTitle"');
 assert.ok(begin>=0&&end>begin,'top HUD wrapper exists');
 const top=html.slice(begin,end);
 let last=-1;
 for(const id of order){
  const at=top.indexOf('id="'+id+'"');
  assert.ok(at>last,'inside the top HUD in expected order: '+id);
  assert.equal(html.split('id="'+id+'"').length-1,1,'single '+id+' element');
  last=at;
 }
 assert.ok(css.includes('grid-template-columns:minmax(0,1fr) minmax(0,1fr) var(--hud-map-size)'));
 assert.ok(css.includes('@media(max-width:360px)'));
});

test('minimap renders a square canvas inside an inset compass frame',()=>{
 assert.match(html,/<canvas id="minimap" width="240" height="240"/);
 assert.ok(css.includes('#hudTop #minimapFrame'));
 assert.ok(css.includes('aspect-ratio:1'));
 assert.ok(css.includes('border:2px solid #b8a06c;outline:none;border-radius:9px'));
 assert.ok(css.includes('#hudTop #mapLabel'));
 assert.ok(css.includes('#hudTop .north'));
});

test('target enemy, ally and empty placeholder are mutually exclusive',()=>{
 assert.ok(game.includes("$('targetPlaceholder').hidden=isAliveTarget(selected)||!!remote;"));
 assert.ok(game.includes("$('targetPlaceholder').hidden=valid||!!remotePlayers.get(selectedPlayerId);"));
 assert.ok(game.includes("$('targetFrame').hidden=!valid"));
 assert.ok(game.includes("panel.hidden=!remote"));
 assert.ok(css.includes('#hudTop #targetFrame.dummy-target'));
 assert.ok(css.includes('height:94px;min-height:94px;max-height:94px'));
 assert.ok(css.includes('overflow-y:auto;overflow-x:hidden'));
});

test('responsive widths preserve space for 2 frames and a square map',()=>{
 for(const viewport of [320,360,375,390,430,600,760]){
  const map=Math.min(108,Math.max(76,viewport*.24));
  const card=(viewport-16-12-map)/2;
  assert.ok(card>=106,'target and player frames fit at viewport '+viewport);
  assert.ok(Math.abs(2*card+map+12+16-viewport)<.001);
 }
});
