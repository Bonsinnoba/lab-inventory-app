import {localBackend} from './local-backend';
import {captureServerRequest,isServerRequestCurrent,getToken,observeNativeAuthFailure,type ServerRequestContext} from './auth';
import {isTauriRuntime} from '../lib/runtime';
import {refreshLocalFileAccess} from './resource-uploads';
import type {Resource} from './resources';

type CopyStatus={state:string};
type Work={identity:string;context:ServerRequestContext;resources:Resource[];revision:number;statusRevision:number;
  statuses:Record<string,CopyStatus>;cursor:string;failures:Map<string,{attempts:number;until:number}>;
  pauseUntil:number;nextBatchAt:number;transportFailures:number;dirty:boolean;publishedAt:number};
// A chunk performs permission, manifest and range requests. Four calls per six
// seconds leave room beneath the shared API quota for metadata and user actions.
const BATCH=4,YIELD_MS=250,BATCH_GAP_MS=6_000,RETRY_MS=30_000,MAX_RETRY_MS=300_000,PUBLISH_MS=2_000;
let work:Work|null=null,running=false,timer:ReturnType<typeof window.setTimeout>|null=null,requestSequence=0;
function current(job:Work):boolean{return work===job&&isServerRequestCurrent(job.context);}
function clearTimer(){if(timer!==null){window.clearTimeout(timer);timer=null;}}
function stop(){clearTimer();work=null;}
function delay(attempts:number):number{return Math.min(MAX_RETRY_MS,RETRY_MS*2**Math.min(attempts-1,4));}
function pending(job:Work):Resource[]{return job.resources.filter(row=>job.statuses[row.id]?.state!=='ready').sort((a,b)=>a.id.localeCompare(b.id));}
function schedule(){
  clearTimer();const job=work;if(!job||!current(job)){stop();return;}
  const rows=pending(job);if(!rows.length&&!job.dirty&&job.statusRevision===job.revision)return;
  const now=Date.now();
  const earliest=rows.reduce((earliest,row)=>Math.min(earliest,job.failures.get(row.id)?.until??0),rows.length?Infinity:now);
  const wait=Math.max(YIELD_MS,job.pauseUntil-now,job.nextBatchAt-now,earliest-now);
  timer=window.setTimeout(async()=>{timer=null;try{await runBatch();}catch{/* Native failures retain progress; runBatch schedules bounded retry. */}},wait);
}
async function publishCopies(job:Work,force=false){
  if(!job.dirty||!current(job)||(!force&&Date.now()-job.publishedAt<PUBLISH_MS))return;
  await refreshLocalFileAccess();
  if(!current(job))return;
  job.dirty=false;job.publishedAt=Date.now();window.dispatchEvent(new Event('labos:resource-copies-updated'));
}
async function runBatch():Promise<void>{
  const job=work;if(running||!job||!current(job))return;
  if(Math.max(job.pauseUntil,job.nextBatchAt)>Date.now()){schedule();return;}
  running=true;
  try{
    if(typeof navigator!=='undefined'&&!navigator.onLine){job.pauseUntil=Date.now()+RETRY_MS;return;}
    if(job.statusRevision!==job.revision){
      const revision=job.revision;
      const statuses=await localBackend.invoke<Record<string,CopyStatus>>('local_resource_copy_status',{expectedAccountId:job.context.accountId});
      if(!current(job))return;
      if(!statuses||typeof statuses!=='object'||Array.isArray(statuses))throw Error('Native copy status unavailable');
      job.statuses=statuses;job.statusRevision=revision;
      if(revision!==job.revision)return;
    }
    const rows=pending(job).filter(row=>(job.failures.get(row.id)?.until??0)<=Date.now());
    if(!rows.length){await publishCopies(job,true);return;}
    let start=rows.findIndex(row=>row.id>job.cursor);if(start<0)start=0;
    const batch=[...rows.slice(start),...rows.slice(0,start)].slice(0,BATCH),revision=job.revision;
    job.nextBatchAt=Date.now()+BATCH_GAP_MS;
    let progressed=false;
    for(const row of batch){
      if(!current(job)||revision!==job.revision)return;
      job.cursor=row.id;
      try{
        // Hints never authorize a file: native code rechecks the current session,
        // grants, revision, quota and authenticated bytes for every chunk.
        const result=await localBackend.invoke<CopyStatus>('replicate_local_resource',{
          expectedAccountId:job.context.accountId,expectedSessionToken:job.context.nativeSessionToken,
          serverToken:job.context.token,resourceId:row.id,
        });
        if(!current(job)||revision!==job.revision)return;
        if(!result||!['ready','copying'].includes(result.state))throw Error('Native copy progress unavailable');
        job.statuses[row.id]=result;job.failures.delete(row.id);job.transportFailures=0;
        progressed=true;
        if(result.state==='ready')job.dirty=true;
      }catch(error){
        await observeNativeAuthFailure(error,job.context);
        if(!current(job))return;
        if(/quota|no space|disk.*full|os error 112|resource permission revoked/i.test(String(error))){job.pauseUntil=Date.now()+MAX_RETRY_MS;break;}
        if(/HTTP 429|AUTH_THROTTLED|AUTH_UNAVAILABLE|AUTH_REJECTED|timed out|error sending request|network unavailable|HTTP 5\d\d/i.test(String(error))){
          job.pauseUntil=Date.now()+delay(++job.transportFailures);break;
        }
        const attempts=(job.failures.get(row.id)?.attempts??0)+1;
        job.failures.set(row.id,{attempts,until:Date.now()+delay(attempts)});
      }
    }
    if(!progressed&&pending(job).length)job.pauseUntil=Math.max(job.pauseUntil,Date.now()+RETRY_MS);
    await publishCopies(job,!pending(job).length||job.pauseUntil>Date.now());
  }catch(error){
    if(current(job))job.pauseUntil=Date.now()+delay(++job.transportFailures);
    throw error;
  }finally{
    running=false;
    // A newer snapshot/login can arrive during a native call. Continue only the
    // latest queue, never an abandoned session's timer.
    if(work&&!current(work))stop();else schedule();
  }
}

// Intake comes from authorized metadata; copying drains independently in four-
// call batches, with event-loop yields, fair rotation and bounded failure backoff.
export async function pullResourceFiles(resources:Resource[]):Promise<void>{
  const sequence=++requestSequence;
  if(!isTauriRuntime()){stop();return;}
  const token=getToken();if(!token||token.startsWith('local:')){stop();return;}
  const context=await captureServerRequest(token);
  if(sequence!==requestSequence||!isServerRequestCurrent(context))return;
  if(!context.accountId||!context.nativeSessionToken){stop();return;}
  const identity=JSON.stringify([context.accountId,context.nativeSessionToken,token]);
  if(work?.identity!==identity){
    clearTimer();work={identity,context,resources:[],revision:0,statusRevision:-1,statuses:{},cursor:'',failures:new Map(),pauseUntil:0,nextBatchAt:0,transportFailures:0,dirty:false,publishedAt:-Infinity};
  }
  const job=work!;
  job.resources=resources.filter(row=>row.kind==='file'||(row.kind==='link'&&!!row.local_media_filename)).map(row=>({...row}));
  job.revision++;
  const ids=new Set(job.resources.map(row=>row.id));for(const id of job.failures.keys())if(!ids.has(id))job.failures.delete(id);
  clearTimer();if(!running)await runBatch();
}
if(typeof window!=='undefined'){
  const checkSession=()=>{if(work&&!current(work))stop();};
  window.addEventListener('labos-user-updated',checkSession);
  window.addEventListener('labos:auth-expired',checkSession);
}
