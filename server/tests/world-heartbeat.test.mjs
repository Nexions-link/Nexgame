import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createWorldHeartbeat} from '../world-heartbeat.js';
test('missed browser pong responses release stale sockets',()=>{
 const socket=new EventEmitter();socket.readyState=1;socket.pingCount=0;
 socket.ping=()=>{socket.pingCount++};
 socket.terminate=()=>{socket.readyState=3};
 const heartbeat=createWorldHeartbeat({wss:{clients:new Set([socket])},intervalMs:60000,maxMissed:3});
 try{
  heartbeat.track(socket);
  heartbeat.sweep();heartbeat.sweep();
  assert.equal(socket.pingCount,2);assert.equal(socket.readyState,1);
  socket.emit('pong');
  heartbeat.sweep();heartbeat.sweep();
  assert.equal(socket.readyState,1);
  heartbeat.sweep();
  assert.equal(socket.readyState,3);
  assert.equal(heartbeat.stats().pingsSent,4);
  assert.equal(heartbeat.stats().staleTerminations,1);
  assert.equal(heartbeat.stats().pingFailures,0);
 }finally{heartbeat.close()}
});

test('broken ping terminates only the failed WebSocket, not healthy players',()=>{
 const broken=new EventEmitter(),healthy=new EventEmitter();
 broken.readyState=healthy.readyState=1;
 broken.ping=()=>{throw Error('socket transport failed')};
 broken.terminate=()=>{broken.readyState=3};
 let healthyPings=0;
 healthy.ping=()=>{healthyPings++};
 healthy.terminate=()=>{healthy.readyState=3};
 const heartbeat=createWorldHeartbeat({
  wss:{clients:new Set([broken,healthy])},intervalMs:60000,maxMissed:3
 });
 try{
  heartbeat.track(broken);heartbeat.track(healthy);heartbeat.sweep();
  assert.equal(broken.readyState,3);
  assert.equal(healthy.readyState,1);
  assert.equal(healthyPings,1);
  assert.equal(heartbeat.stats().pingsSent,1);
  assert.equal(heartbeat.stats().staleTerminations,0);
  assert.equal(heartbeat.stats().pingFailures,1);
 }finally{heartbeat.close()}
});

test('real close codes distinguish normal, network and heartbeat termination with no identifiers',()=>{
 const normal=new EventEmitter(),network=new EventEmitter(),stale=new EventEmitter();
 for(const ws of [normal,network,stale]){
  ws.readyState=1;ws.ping=()=>{};
  ws.terminate=()=>{ws.readyState=3;ws.emit('close',1006)};
 }
 const wss={clients:new Set([normal,network,stale])};
 const heartbeat=createWorldHeartbeat({wss,intervalMs:60000,maxMissed:2});
 try{
  for(const ws of wss.clients)heartbeat.track(ws);
  normal.readyState=3;normal.emit('close',1000);
  network.readyState=3;network.emit('close',1006);
  heartbeat.sweep();heartbeat.sweep();
  const stats=heartbeat.stats();
  assert.equal(stats.totalClosed,3);
  assert.equal(stats.abnormalClosed,2);
  assert.equal(stats.closeCodes['1000'],1);
  assert.equal(stats.closeCodes['1006'],2);
  assert.equal(stats.closeCauses.client_normal,1);
  assert.equal(stats.closeCauses.transport_abnormal,1);
  assert.equal(stats.closeCauses.heartbeat_timeout,1);
  assert.equal(stats.openSockets,0);
  assert.ok(stats.recentCloses.every(x=>x.at&&typeof x.code==='number'&&x.cause));
  assert.equal(JSON.stringify(stats).includes('sessionToken'),false);
 }finally{heartbeat.close()}
});
test('ping exception is recorded separately from server-side heartbeat timeout',()=>{
 const broken=new EventEmitter();
 broken.readyState=1;broken.ping=()=>{throw Error('unavailable transport')};
 broken.terminate=()=>{broken.readyState=3;broken.emit('close',1006)};
 const hb=createWorldHeartbeat({wss:{clients:new Set([broken])},intervalMs:60000});
 try{
  hb.track(broken);hb.sweep();
  assert.equal(hb.stats().pingFailures,1);
  assert.equal(hb.stats().closeCauses.ping_error,1);
  assert.equal(hb.stats().closeCauses.heartbeat_timeout,undefined);
 }finally{hb.close()}
});
