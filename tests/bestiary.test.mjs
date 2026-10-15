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
 assert.equal(bird.asset,'models/dolgonog-v0.2-ref.glb');
 assert.equal(bird.versions['0.1'],'models/dolgonog-v0.1.glb');
 assert.equal(bird.versions['0.2'],'models/dolgonog-v0.2.glb');
 assert.equal(bird.versions['0.2-ref'],'models/dolgonog-v0.2-ref.glb');
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
test('separate published bestiary is self-contained and versioned',()=>{
 const html=read('bestiary/index.html'),js=read('bestiary/main.js'),style=read('bestiary/style.css');
 assert.match(html,/type="importmap"/);
 assert.match(html,/src="\.\/main\.js\?v=0\.2\.1"/);
 assert.match(html,/href="\.\/style\.css\?v=0\.2\.1"/);
 assert.match(html,/id="viewerCanvas"/);
 assert.match(html,/id="glbUpload"/);
 assert.match(html,/id="saveDraft"/);
 assert.match(html,/id="creatureList"/);
 assert.match(html,/href="\.\.\/"/);
 assert.match(style,/@media\(max-width:680px\)/);
 assert.match(js,/GLTFLoader/);
 assert.match(js,/GLTFExporter/);
 assert.match(js,/setPointerCapture/);
 assert.match(js,/localStorage\.setItem/);
 assert.match(js,/normalizeCreatureParams/);
 assert.match(js,/createDolgonog/);
 assert.match(js,/source==='glb'/);
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
 assert.match(js,/dolgonog-v'\+loadingVersion/);
 assert.match(js,/source==='glb'&&imported\?\.editable/);
 assert.match(js,/attack:\/attack\|peck\|hit/);
 assert.match(js,/animations:source==='glb'/);
 assert.match(edit,/isDolgonogRig/);
 assert.match(edit,/pos\.setXYZ/);
 assert.match(edit,/attribute\.setXYZ/);
 assert.doesNotMatch(edit,/attribute\.array\[/);
});

test('v0.2 is a valid lightweight animated GLB, preserving the original rig',()=>{
 const path=resolve(root,'bestiary/models/dolgonog-v0.2.glb');
 const bin=readFileSync(path);
 assert.equal(bin.length,485068);
 assert.equal(bin.toString('ascii',0,4),'glTF');
 assert.equal(bin.readUInt32LE(8),bin.length);
 const l=bin.readUInt32LE(12);
 const j=JSON.parse(bin.toString('utf8',20,20+l));
 assert.equal(j.meshes.length,12);
 assert.equal(j.materials.length,1);
 assert.deepEqual(j.animations.map(a=>a.name),['Idle','Walk','Peck']);
 const triangles=j.meshes.reduce((total,m)=>total+m.primitives.reduce((n,p)=>n+j.accessors[p.attributes.POSITION].count/3,0),0);
 assert.equal(triangles,3472);
 assert.ok(triangles<5000);
 assert.ok(j.nodes.some(n=>n.name==='Head_mesh'));
});
test('comparison loads both versions and preserves camera control',()=>{
 const html=read('bestiary/index.html');
 const js=read('bestiary/main.js');
 assert.match(html,/data-version="0\.1"/);
 assert.match(html,/data-version="0\.2"/);
 assert.match(js,/selectedVersion='0\.2-ref'/);
 assert.match(js,/dolgonog-v'\+loadingVersion/);
 assert.match(js,/loadOfficialGlb\(\)/);
});

test('reference-inspired model fits 5000 triangle budget and keeps source rig',()=>{
 const bin=readFileSync(resolve(root,'bestiary/models/dolgonog-v0.2-ref.glb'));
 assert.equal(bin.toString('ascii',0,4),'glTF');
 assert.equal(bin.readUInt32LE(4),2);
 assert.equal(bin.readUInt32LE(8),738912);
 const l=bin.readUInt32LE(12);
 const j=JSON.parse(bin.toString('utf8',20,20+l));
 assert.equal(j.meshes.length,12);
 assert.equal(j.materials.length,1);
 assert.deepEqual(j.animations.map(a=>a.name),['Idle','Walk','Peck']);
 const tris=j.meshes.reduce((sum,m)=>sum+m.primitives.reduce((n,p)=>n+j.accessors[p.attributes.POSITION].count/3,0),0);
 assert.equal(tris,4512);
 assert.ok(tris<=5000);
 const node=j.nodes.find(n=>n.name==='Body_mesh');
 const p=j.meshes[node.mesh].primitives[0];
 assert.ok(j.accessors[p.attributes.POSITION].count/3>1300);
 for(const a of j.animations)assert.ok(a.channels.length>0);
});
test('versions compare without destroying previous releases',()=>{
 const html=read('bestiary/index.html'),js=read('bestiary/main.js');
 for(const version of ['0.1','0.2','0.2-ref'])assert.ok(html.includes('data-version="'+version+'"'));
 assert.match(js,/token!==undefined&&token!==currentLoad/);
});
