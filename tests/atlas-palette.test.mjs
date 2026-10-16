import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
 BOAR_PALETTE_PARTS,BOAR_PALETTE_DEFAULTS,BOAR_PALETTE_STORAGE,
 normalizeBoarPalette,boarRGB,boarRemapChannel,recolorBoarGLB
} from '../bestiary/atlas-palette.js';
const read=path=>readFileSync(fileURLToPath(new URL('../'+path,import.meta.url)));
function glbJSON(bytes){
 const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 const size=dv.getUint32(12,true);
 return JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+size)));
}
test('boar editor exposes every material with stable names and safe hex validation',()=>{
 assert.equal(BOAR_PALETTE_PARTS.length,21);
 assert.equal(new Set(BOAR_PALETTE_PARTS.map(p=>p.id)).size,21);
 assert.match(BOAR_PALETTE_STORAGE,/boar-palette-0\.1/);
 assert.equal(BOAR_PALETTE_DEFAULTS.hide,'#6b412a');
 assert.equal(BOAR_PALETTE_DEFAULTS.nose,'#a47064');
 assert.deepEqual(boarRGB('#0fA11c'),[15,161,28]);
 assert.deepEqual(normalizeBoarPalette({hide:'#aaBBcc',nose:'javascript:alert(1)',extra:'#000000'}),{
  ...BOAR_PALETTE_DEFAULTS,hide:'#aabbcc'
 });
 assert.equal(boarRemapChannel(100,'hide',0,'#6b412a'),100);
 assert.ok(boarRemapChannel(100,'hide',0,'#ff412a')>100);
});
test('GLB palette exporter changes only COLOR_0 bytes while preserving all animations',()=>{
 const src=read('bestiary/models/wild-boar-v0.1.glb');
 const source=new Uint8Array(src);
 const model=glbJSON(source);
 assert.deepEqual(model.animations.map(x=>x.name),['Idle','Walk','Attack']);
 assert.equal(model.meshes.length,21);
 const palette={...BOAR_PALETTE_DEFAULTS,hide:'#aa563d',nose:'#ebad95',ivory:'#ffffff'};
 const output=recolorBoarGLB(src.buffer.slice(src.byteOffset,src.byteOffset+src.byteLength),palette);
 assert.equal(output.length,source.length);
 assert.equal(output[0],0x67);
 const newer=glbJSON(output);
 assert.deepEqual(newer,model);
 assert.deepEqual(newer.animations,model.animations);
 assert.equal(source[0],0x67);
 const empty=recolorBoarGLB(src.buffer.slice(src.byteOffset,src.byteOffset+src.byteLength),BOAR_PALETTE_DEFAULTS);
 assert.deepEqual(empty,source);
 let modified=0;
 for(let i=0;i<source.length;i++)if(output[i]!==source[i])modified++;
 assert.ok(modified>50 && modified<source.length/4,modified);
});
test('published Atlas displays palette controls only for C002 and offers local save and GLB export',()=>{
 const src=new TextDecoder().decode(read('bestiary/atlas.js'));
 const html=new TextDecoder().decode(read('bestiary/atlas.html'));
 const editor=new TextDecoder().decode(read('bestiary/atlas-palette-editor.js'));
 assert.match(html,/id="palettePanel"/);
 assert.match(src,/if\(entry\.id==='wild-boar'\)/);
 assert.match(src,/mountBoarPaletteEditor/);
 assert.match(src,/ambient\.intensity=entry\.id==='wild-boar'/);
 assert.match(editor,/localStorage\.setItem/);
 assert.match(editor,/localStorage\.removeItem/);
 assert.match(editor,/recolorBoarGLB\(glbBuffer,palette\)/);
 assert.doesNotMatch(new TextDecoder().decode(read('game.js')),/wild-boar-v0\\.1\\.glb/);
});
