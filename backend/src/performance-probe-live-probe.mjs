// Disposable PostgreSQL/HTTP measurement check, never the personal lab database.
import assert from 'node:assert/strict';
import http from 'node:http';
import pg from 'pg';
const database=process.env.PGDATABASE;
if(!/^labos_perf_probe_[0-9_]+$/.test(database||''))throw Error('Dedicated labos_perf_probe_<digits> PostgreSQL database required');
const {createServerPerformanceProbe}=await import(process.env.LABOS_PROBE_MODULE?'data:text/javascript;base64,'+process.env.LABOS_PROBE_MODULE:'./performance-probe.js');
const pool=new pg.Pool({max:2,database,connectionTimeoutMillis:3000});
let probe,server;
try{
 assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name,database);
 await pool.query('CREATE TABLE performance_fixture (id integer PRIMARY KEY, category integer NOT NULL, payload text NOT NULL)');
 await pool.query("INSERT INTO performance_fixture SELECT i, i%10, repeat('synthetic',16) FROM generate_series(1,10000) i");
 const output=[];probe=createServerPerformanceProbe({enabled:true,pool,write:sample=>output.push(sample)});
 server=http.createServer((req,res)=>probe.middleware({path:'/api/resources'},res,()=>{
  void (async()=>{
   try{
    const data=await pool.query('SELECT count(*)::integer AS count FROM performance_fixture WHERE category=$1',[0]);
    await pool.query('SELECT pg_sleep(0.025)');
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data.rows[0]));
   }catch{res.statusCode=500;res.end('{}');}
  })();
 }));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 let peakWaiting=0;const sampler=setInterval(()=>{peakWaiting=Math.max(peakWaiting,pool.waitingCount);},2);
 try{
  await Promise.all(Array.from({length:16},async()=>{
   const response=await fetch(url);assert.equal(response.status,200);assert.equal((await response.json()).count,1000);
  }));
 }finally{clearInterval(sampler);}
 const sample=probe.flush();assert.equal(sample.routes.resources.requests,16);assert.equal(sample.routes.resources.errors,0);assert.equal(sample.routes.resources.aborted,0);assert.equal(sample.active_requests,0);
 assert.ok(peakWaiting>0,'Real PostgreSQL pool saturation must be exercised');assert.equal(sample.pool.waiting,0);assert.ok(sample.pool.total<=2);
 assert.doesNotMatch(JSON.stringify(output),/performance_fixture|payload|PGPASSWORD|synthetic/);
 console.log(JSON.stringify({status:'PASS',synthetic_rows:10000,concurrent_requests:16,peak_pool_waiters:peakWaiting,sample},null,2));
}finally{
 probe?.stop();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await pool.end();
}
