import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorldPerformanceMonitor} from '../world-performance.js';

test('event loop and heap diagnostics expose only finite bounded metrics',()=>{
 const monitor=createWorldPerformanceMonitor({sampleMs:10000});
 try{
  const first=monitor.stats();
  assert.ok(first.heapUsedMiB>0&&Number.isFinite(first.heapUsedMiB));
  const data=monitor.takeSample();
  for(const key of ['eventLoopP95Ms','eventLoopMaxMs','eventLoopUtilization','sampleSeconds']){
   assert.ok(Number.isFinite(data[key])&&data[key]>=0,key);
  }
  assert.ok(data.eventLoopUtilization<=1,'event loop utilization never exceeds 100%');
  assert.equal(monitor.stats().sampleSeconds,10);
 }finally{monitor.close();monitor.close()}
});
