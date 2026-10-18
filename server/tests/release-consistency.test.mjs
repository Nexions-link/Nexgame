import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL(path,import.meta.url),'utf8');

test('server build, playable HTML and public release manifest use one version',()=>{
 const manifest=JSON.parse(read('../../planet-test/version.json'));
 const client=read('../../planet-test/index.html');
 const server=read('../index.js');
 const match=server.match(/\bBUILD\s*=\s*['"]([0-9]+(?:\.[0-9]+){2,3})['"]/);
 assert.ok(match,'server/index.js must declare a numerical BUILD version');
 assert.equal(match[1],manifest.version,'Render /health and /ready build must match the published client');
 const declared=[...client.matchAll(/\bdata-build="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(declared,[manifest.version],'the game launcher must load the same release');
});

test('authenticated gameplay is the default, guest world must be explicitly enabled',()=>{
 const server=read('../index.js');
 assert.match(server,/guestWorldEnabled\s*=\s*process\.env\.NGW_GUEST_WORLD_ENABLED\s*===\s*'true'/);
 assert.match(server,/if\(!guestWorldEnabled\)\{ws\.close\(1008,'Account login required'\)/);
 assert.match(server,/path==='\/ws\/nexgameworld\/auth'/);
});
