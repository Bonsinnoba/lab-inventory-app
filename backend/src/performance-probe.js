import {monitorEventLoopDelay, performance} from 'node:perf_hooks';

// Explicit server-console opt-in. Never record paths, SQL, IDs, bodies, headers,
// tokens or provider responses. Fixed buckets and rings bound resident memory.
const groups = ['auth','sync','resources','media-downloads','reports','projects','items','other'];
const SAMPLE_LIMIT = 512;
const finite = value => Number.isFinite(value) ? Math.max(0,value) : 0;
export function createServerPerformanceProbe({enabled=false,intervalMs=10000,pool,write=sample=>console.log('LABOS_PERFORMANCE '+JSON.stringify(sample)),clock=()=>performance.now()}={}) {
  if(!enabled)return {middleware:(_req,_res,next)=>next(),flush:()=>null,stop:()=>{}};
  const buckets=new Map(groups.map(group=>[group,{count:0,errors:0,throttled:0,aborted:0,max:0,samples:new Float64Array(SAMPLE_LIMIT),size:0,cursor:0}]));
  const delay=monitorEventLoopDelay({resolution:20});delay.enable();
  let previous=clock(),cpu=process.cpuUsage(),util=performance.eventLoopUtilization(),active=0,stopped=false;
  function flush(){
    if(stopped)return null;
    const now=clock(),elapsed=Math.max(1,now-previous),used=process.cpuUsage(cpu),nextCpu=process.cpuUsage(),nextUtil=performance.eventLoopUtilization();
    const loop=performance.eventLoopUtilization(nextUtil,util),memory=process.memoryUsage(),routes={};
    for(const [group,bucket] of buckets){
      if(!bucket.count)continue;
      const samples=Array.from(bucket.samples.subarray(0,bucket.size)).sort((a,b)=>a-b);
      const quantile=q=>samples[Math.max(0,Math.ceil(samples.length*q)-1)]||0;
      routes[group]={requests:bucket.count,errors:bucket.errors,throttled:bucket.throttled,aborted:bucket.aborted,sample_count:samples.length,p50_ms:quantile(.5),p95_ms:quantile(.95),p99_ms:quantile(.99),max_ms:bucket.max};
      bucket.count=bucket.errors=bucket.throttled=bucket.aborted=bucket.max=bucket.size=bucket.cursor=0;
    }
    const sample={format:1,interval_ms:elapsed,active_requests:active,rss_bytes:memory.rss,heap_used_bytes:memory.heapUsed,external_bytes:memory.external,cpu_core_percent:finite((used.user+used.system)/elapsed/10),event_loop_utilization:finite(loop.utilization),event_loop_p95_ms:finite(delay.percentile(95)/1e6),event_loop_max_ms:finite(delay.max/1e6),pool:{total:finite(pool?.totalCount),idle:finite(pool?.idleCount),waiting:finite(pool?.waitingCount)},latency_sample_policy:'last_512_completions_per_group_per_interval',routes};
    previous=now;cpu=nextCpu;util=nextUtil;delay.reset();
    try{write(sample);}catch{/* Diagnostics cannot fail an API request or timer. */}
    return sample;
  }
  const period=Number.isFinite(intervalMs)?Math.max(5000,Math.min(60000,intervalMs)):10000;
  const timer=setInterval(flush,period);timer.unref();
  return {
    middleware(req,res,next){
      if(stopped)return next();
      // Express path excludes the query. Retain only a fixed group, never the path.
      const match=/^\/api\/([^/]+)(?:\/|$)/.exec(req.path||'');
      const group=match&&buckets.has(match[1])?match[1]:'other',bucket=buckets.get(group),started=clock();
      active++;let completed=false;
      function done(){
        if(completed)return;completed=true;active--;res.removeListener('finish',done);res.removeListener('close',done);
        if(stopped)return;
        const elapsed=finite(clock()-started);bucket.count++;bucket.errors+=res.statusCode>=500?1:0;bucket.throttled+=res.statusCode===429?1:0;bucket.aborted+=res.writableFinished?0:1;bucket.max=Math.max(bucket.max,elapsed);
        bucket.samples[bucket.cursor]=elapsed;bucket.cursor=(bucket.cursor+1)%SAMPLE_LIMIT;bucket.size=Math.min(SAMPLE_LIMIT,bucket.size+1);
      }
      res.once('finish',done);res.once('close',done);next();
    },flush,
    stop(){if(stopped)return;flush();stopped=true;clearInterval(timer);delay.disable();},
  };
}
