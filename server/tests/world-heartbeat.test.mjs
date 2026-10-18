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
 }finally{heartbeat.close()}
});
