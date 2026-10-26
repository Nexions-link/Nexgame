import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../mount-controls.css',import.meta.url),'utf8');
const gameCss=readFileSync(new URL('../../style.css',import.meta.url),'utf8');
test('mount cast is a compact single-row, narrow progress panel',()=>{
 assert.match(css,/#mountCast\{[\s\S]*?width:min\(236px,68vw\)/);
 assert.match(css,/border:1px solid #bfa26a/);
 assert.match(css,/padding:7px 10px 8px/);
 assert.match(css,/#mountCast \.mount-cast-track\{[\s\S]*?height:7px/);
 assert.match(css,/@media\(max-width:760px\)\{[\s\S]*?#mountCast\{[\s\S]*?width:min\(220px,66vw\)/);
 assert.match(css,/@media\(max-width:760px\)\{[\s\S]*?#mountCast \.mount-cast-track\{height:6px\}/);
});
test('portrait and landscape cast overlays clear the utility row',()=>{
 const positions=[
  {width:390,bottom:140,utility:91,utilityHeight:40},
  {width:320,bottom:132,utility:84,utilityHeight:40},
  {width:1024,bottom:156,utility:105,utilityHeight:42},
  {width:844,bottom:128,utility:78,utilityHeight:40}
 ];
 for(const p of positions)
  assert.ok(p.bottom-p.utility-p.utilityHeight>=7,
   'mount cast should be above utility row at viewport width '+p.width);
 assert.match(css,/bottom:calc\(140px/);
 assert.match(css,/bottom:calc\(132px/);
 assert.match(css,/bottom:calc\(156px/);
 assert.match(css,/@media\(max-height:510px\) and \(min-width:600px\)/);
 assert.match(css,/bottom:calc\(128px/);
 assert.match(gameCss,/#hotbarUtilities\{right:12px;bottom:calc\(91px/);
});
test('cast indicator is perfectly centered with the ability hotbar on every phone width',()=>{
 assert.match(gameCss,/#actionsBar\{[\s\S]*?left:50%;right:auto;bottom:calc\(19px/);
 assert.match(css,/#mountCast\{\s*position:fixed;\s*z-index:25;\s*left:50%;\s*transform:translateX\(-50%\)/);
 assert.doesNotMatch(css,/left:calc\(50%\s*\+/,'cast must never be pushed to the right');
 // Its center X remains exactly half the viewport, regardless of responsive width.
 for(const width of [320,360,375,390,430,760,1024]){
  const narrow=width<=360;
  const size=width<=760?(narrow?Math.min(210,width*.62):Math.min(220,width*.66)):Math.min(236,width*.68);
  const left=(width-size)/2;
  const right=left+size;
  assert.ok(Math.abs((left+right)/2-width/2)<.01,'center aligns at '+width+'px');
  assert.ok(left>=7&&right<=width-7,'cast fits inside viewport at '+width+'px');
 }
 assert.match(css,/@media\(max-width:360px\)\{[\s\S]*?width:min\(210px,62vw\)/);
 assert.match(css,/pointer-events:none/);
});
