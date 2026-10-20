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
  assert.deepEqual(heartbeat.stats(),{pingsSent:4,staleTerminations:1,pingFailures:0});
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
  assert.deepEqual(heartbeat.stats(),{pingsSent:1,staleTerminations:0,pingFailures:1});
 }finally{heartbeat.close()}
});
