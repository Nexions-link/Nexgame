import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CREATURES,DRAFT_KEY,normalizeCreatureParams,humanBytes} from '../bestiary/catalog.js';
import {DEFAULT_DOLGONOG,createDolgonog,countTriangles,disposeDolgonog} from '../bestiary/dolgonog.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path),'utf8');
test('catalog has stable unique IDs and original source is not misrepresented',()=>{
 assert.ok(CREATURES.length>=1);
 assert.equal(new Set(CREATURES.map(c=>c.id)).size,CREATURES.length);
 const bird=CREATURES.find(c=>c.id==='dolgonog');
 assert.ok(bird);assert.equal(bird.number,'001');
 assert.equal(bird.source,'original-glb');
 assert.equal(bird.asset,'models/dolgonog-v0.1.glb');
 assert.ok(bird.animations.includes('idle')&&bird.animations.includes('walk')&&bird.animations.includes('attack'));
});
test('editor sanitizes imported settings and keeps colors constrained to CSS hex',()=>{
 const result=normalizeCreatureParams({body:17,neck:-10,crest:NaN,wings:'#abcdef',crestColor:'javascript:alert(1)',extra:true},DEFAULT_DOLGONOG);
 assert.equal(result.body,1.6);assert.equal(result.neck,.55);
 assert.equal(result.crest,DEFAULT_DOLGONOG.crest);
 assert.equal(result.wings,'#abcdef');
 assert.equal(result.crestColor,DEFAULT_DOLGONOG.crestColor);
 assert.equal(Object.hasOwn(result,'extra'),false);
 assert.deepEqual(normalizeCreatureParams(null,DEFAULT_DOLGONOG),{...DEFAULT_DOLGONOG});
 assert.match(DRAFT_KEY,/bestiary/);
});
test('size helper is stable for model import feedback',()=>{
 assert.equal(humanBytes(357*1024),'357 КБ');
 assert.equal(humanBytes(1048576),'1.00 МБ');
 assert.equal(humanBytes(NaN),'—');
});
test('published atlas unifies creature and weapon collections, preserving legacy links',()=>{
 const home=read('bestiary/index.html'),weapon=read('bestiary/weapons.html');
 const atlas=read('bestiary/atlas.html'),viewer=read('bestiary/atlas.js'),style=read('bestiary/atlas.css');
 const catalog=read('bestiary/atlas-catalog.js');
 assert.match(home,/atlas\.html/);
 assert.match(weapon,/atlas\.html\?item=tauren-axe/);
 assert.match(atlas,/type="importmap"/);
 assert.match(atlas,/id="viewerCanvas"/);
 assert.match(atlas,/id="categories"/);
 assert.match(atlas,/id="entries"/);
 assert.match(atlas,/id="search"/);
 assert.match(atlas,/atlas\.js\?v=0\.2\.0/);
 assert.match(style,/@media\(max-width:900px\)/);
 assert.match(viewer,/GLTFLoader/);
 assert.match(viewer,/OrbitControls/);
 assert.match(viewer,/setAnimation/);
 assert.match(catalog,/dolgonog-v0\.1\.glb/);
 assert.match(catalog,/tauren-axe-v0\.1\.glb/);
 for(const category of ['creatures','weapons','armor','items','world'])assert.ok(catalog.includes("id:'"+category+"'"));
});
test('dolgonog model API has independent preview and animation hooks',()=>{
 assert.equal(typeof createDolgonog,'function');
 assert.equal(typeof countTriangles,'function');
 assert.equal(typeof disposeDolgonog,'function');
 const source=read('bestiary/dolgonog.js');
 assert.match(source,/function update\(seconds,animation='idle'\)/);
 assert.match(source,/walk/);assert.match(source,/attack/);
 assert.match(source,/root\.userData\.creatureId='dolgonog'/);
});

test('checked-in original GLB contains the actual authored bird and animations',()=>{
 const bin=readFileSync(resolve(root,'bestiary/models/dolgonog-v0.1.glb'));
 assert.equal(bin.length,365768);
 assert.equal(bin.toString('ascii',0,4),'glTF');
 assert.equal(bin.readUInt32LE(4),2);
 assert.equal(bin.readUInt32LE(8),bin.length);
 const jsonLength=bin.readUInt32LE(12);
 assert.equal(bin.toString('ascii',16,20),'JSON');
 const parsed=JSON.parse(bin.toString('utf8',20,20+jsonLength));
 assert.equal(parsed.meshes.length,12);
 assert.equal(parsed.materials.length,1);
 assert.deepEqual(parsed.animations.map(a=>a.name),['Idle','Walk','Peck']);
 const triangleCount=parsed.meshes.reduce((total,mesh)=>
  total+mesh.primitives.reduce((n,p)=>n+parsed.accessors[p.attributes.POSITION].count/3,0),0);
 assert.equal(triangleCount,3226);
 assert.ok(parsed.nodes.some(n=>n.name==='Body'));
 assert.ok(parsed.nodes.some(n=>n.name==='Head_mesh'));
 assert.ok(parsed.nodes.some(n=>n.name==='Wing_L'));
});
test('3D viewer uses the original GLB and allows editing its real mesh',()=>{
 const js=read('bestiary/main.js');
 const edit=read('bestiary/original-edits.js');
 assert.match(js,/loadOfficialGlb\(\)/);
 assert.match(js,/models\/dolgonog-v0\.1\.glb/);
 assert.match(js,/source==='glb'&&imported\?\.editable/);
 assert.match(js,/attack:\/attack\|peck\|hit/);
 assert.match(js,/animations:source==='glb'/);
 assert.match(edit,/isDolgonogRig/);
 assert.match(edit,/pos\.setXYZ/);
 assert.match(edit,/attribute\.setXYZ/);
 assert.doesNotMatch(edit,/attribute\.array\[/);
});
