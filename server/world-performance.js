// P1.4: low-cost event-loop and heap observability for Render /health.
// No player data or server credentials are exposed.
import {monitorEventLoopDelay,performance} from 'node:perf_hooks';

export function createWorldPerformanceMonitor({sampleMs=5000}={}){
 const histogram=monitorEventLoopDelay({resolution:20});
 histogram.enable();
 let baseline=performance.eventLoopUtilization(),closed=false;
 const sample={eventLoopP95Ms:0,eventLoopMaxMs:0,eventLoopUtilization:0,
  sampleSeconds:0};
 const finite=(v)=>Number.isFinite(v)&&v>=0?v:0;
 const round=v=>Math.round(v*100)/100;
 const takeSample=()=>{
  if(closed)return {...sample};
  const delta=performance.eventLoopUtilization(baseline);
  baseline=performance.eventLoopUtilization();
  sample.eventLoopP95Ms=round(finite(histogram.count?histogram.percentile(95)/1e6:0));
  sample.eventLoopMaxMs=round(finite(histogram.count?histogram.max/1e6:0));
  sample.eventLoopUtilization=round(finite(delta.utilization));
  sample.sampleSeconds=sampleMs/1000;
  histogram.reset();
  return {...sample};
 };
 const timer=setInterval(takeSample,sampleMs);
 timer.unref?.();
 return {stats:()=>({...sample,
  heapUsedMiB:round(process.memoryUsage().heapUsed/1048576)
 }),takeSample,close:()=>{
  if(closed)return;
  closed=true;clearInterval(timer);histogram.disable();
 }};
}
