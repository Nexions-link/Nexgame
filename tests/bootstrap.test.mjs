import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const boot=readFileSync(resolve(root,'index.html'),'utf8');
const app=readFileSync(resolve(root,'app.html'),'utf8');
const game=readFileSync(resolve(root,'game.js'),'utf8');
const script=boot.match(/<script>([\s\S]*?)<\/script>/)?.[1];
const release=app.match(/NexGame\s*[·]\s*Alpha\s*(\d+\.\d+\.\d+\.\d+)/)?.[1];

test('canonical entrypoint is a stable bootstrap and app shell is separate',()=>{
 assert.ok(script,'self-contained boot script exists');
 assert.doesNotThrow(()=>new vm.Script(script),'bootstrap is valid JavaScript');
 assert.match(boot,/new URL\('\.\/app\.html',location\.href\)/);
 assert.match(boot,/url\.searchParams\.set\('_fresh',String\(Date\.now\(\)\)\)/);
 assert.match(boot,/fetch\(url\.href,\{cache:'no-store'\}\)/);
 assert.match(boot,/document\.head\.replaceChildren/);
 assert.match(boot,/document\.body\.replaceChildren/);
 assert.match(boot,/source\.searchParams\.set\('_fresh',stamp\)/);
 assert.ok(!boot.includes('<script type="module" src="./game.js'));
 assert.ok(app.includes('<div id="hudTop"'));
 assert.ok(app.includes('<div id="actionsBar"'));
 assert.ok(app.includes('<script type="module" src="./game.js?v='));
 assert.ok(!app.includes('checkForUpdate'));
});

test('release identifiers and first-party module version stay consistent',()=>{
 assert.ok(release,'app shell identifies release');
 assert.ok(app.includes('<title>NexGame · Мулгор · Alpha '+release+'</title>'));
 assert.ok(app.includes('style.css?v='+release));
 assert.ok(app.includes('game.js?v='+release));
 assert.ok(game.includes('online.js?v='+release));
 assert.ok(game.includes('online-config.js?v='+release));
 assert.ok(game.includes('party-map.js?v='+release));
 // Existing older browser entrypoints will detect release on the bootstrap page.
 assert.match(boot,/<meta name="nexgame-release" content="NexGame · Alpha \d+\.\d+\.\d+\.\d+">/);
});

function mockRuntime({offline=false}={}){
 const collected={fetched:[],modules:[],importMaps:[],order:[],styles:[],heads:[],bodies:[],stored:{},errors:[]};
 const appModule={getAttribute(name){return name==='src'?'./game.js?v='+release:''},remove(){}};
 const importMap={textContent:'{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js"}}',remove(){}};
 const cssLink={
  src:'./style.css?v='+release,
  getAttribute(name){return name==='href'?this.src:null},
  setAttribute(name,value){if(name==='href')this.src=value}
 };
 const parsed={
  documentElement:{lang:'ru'},
  head:{childNodes:[cssLink]},
  body:{childNodes:[{tag:'HUD'}]},
  querySelector(selector){return selector==='script[type="module"][src]'?appModule:
    selector==='script[type="importmap"]'?importMap:null},
  querySelectorAll(selector){
   if(selector==='script')return [importMap,appModule];
   if(selector==='link[rel="stylesheet"][href]')return [cssLink];
   return [];
  },
  getElementById(id){return ['scene','playerFrame','actionsBar'].includes(id)?{}:null}
 };
 const launchStatus={textContent:''};
 const retry={hidden:true,addEventListener(){}};
 const location={href:'https://example.com/Nexgame/',origin:'https://example.com',reload(){}};
 const document={
  hidden:false,
  documentElement:{lang:'ru'},
  head:{
   replaceChildren(...xs){collected.heads.push(xs)},
   appendChild(element){collected.importMaps.push(element);collected.order.push('map')}
  },
  body:{
   replaceChildren(...xs){collected.bodies.push(xs)},
   appendChild(script){collected.modules.push(script);collected.order.push('module')}
  },
  createElement(tag){assert.equal(tag,'script');return {}},
  getElementById(id){return id==='launchStatus'?launchStatus:id==='launchRetry'?retry:null},
  addEventListener(){}
 };
 const storage={
  getItem(key){return collected.stored[key]||null},
  setItem(key,value){collected.stored[key]=value}
 };
 const context={
  document,
  window:{addEventListener(){}},
  location,
  localStorage:storage,
  history:{replaceState(){}},
  URL,
  Date,
  console:{warn(...xs){collected.errors.push(xs)}},
  DOMParser:class {parseFromString(){return parsed}},
  fetch:async(url,options)=>{
   collected.fetched.push({url,options});
   if(offline)throw Error('No connection');
   return {ok:true,text:async()=>app};
  }
 };
 if(offline)collected.stored['nexgame-last-verified-app-html-v1']=app;
 return {context,collected,cssLink};
}

test('fresh launch loads app shell before one versioned module and refreshes CSS',async()=>{
 const {context,collected,cssLink}=mockRuntime();
 vm.runInNewContext(script,context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(collected.fetched.length,1);
 assert.match(collected.fetched[0].url,/\/Nexgame\/app\.html\?_fresh=\d+/);
 assert.equal(collected.fetched[0].options.cache,'no-store');
 assert.equal(collected.modules.length,1);
 assert.equal(collected.importMaps.length,1,'three.js import map is preserved');
 assert.equal(collected.importMaps[0].type,'importmap');
 assert.match(collected.importMaps[0].textContent,/"three":/);
 assert.deepEqual(collected.order,['map','module'],'import map must precede the module');
 assert.match(collected.modules[0].src,/\/Nexgame\/game\.js\?v=\d+\.\d+\.\d+\.\d+&_fresh=\d+/);
 assert.match(cssLink.src,/\/Nexgame\/style\.css\?v=\d+\.\d+\.\d+\.\d+&_fresh=\d+/);
 assert.equal(collected.heads.length,1);
 assert.equal(collected.bodies.length,1);
 assert.ok(collected.stored['nexgame-last-verified-app-html-v1']);
 assert.deepEqual(collected.errors,[]);
});

test('offline launcher can recover a cached app shell',async()=>{
 const {context,collected,cssLink}=mockRuntime({offline:true});
 vm.runInNewContext(script,context);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(collected.modules.length,1);
 assert.equal(collected.importMaps.length,1,'offline bootstrap keeps GLTFLoader import map');
 assert.deepEqual(collected.order,['map','module']);
 assert.equal(collected.modules[0].src,'https://example.com/Nexgame/game.js?v='+release);
 assert.equal(cssLink.src,'./style.css?v='+release);
 assert.equal(collected.bodies.length,1);
 assert.deepEqual(collected.errors,[]);
});
