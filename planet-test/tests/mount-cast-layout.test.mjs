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
test('mobile panel stays within the visible viewport and clears left joystick',()=>{
 for(const width of [320,360,375,390,430]){
  const narrow=width<=360;
  const size=narrow?Math.min(210,width*.62):Math.min(220,width*.66);
  const offset=narrow?45:40;
  const left=width/2+offset-size/2;
  const right=left+size;
  const joystickRight=narrow?99:110;
  assert.ok(left>=joystickRight-2,'left edge clears joystick at '+width+' px');
  assert.ok(right<=width-7,'right edge is on-screen at '+width+' px');
 }
 assert.match(css,/@media\(max-width:360px\)\{[\s\S]*?width:min\(210px,62vw\)/);
 assert.match(css,/pointer-events:none/);
});
