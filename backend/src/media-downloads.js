import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
import { config } from './config.js';
import { resolveStoragePath } from './storage.js';
import { createMediaToolInspector } from './media-tool-status.js';
import { randomUUID } from 'node:crypto';
import { downloadRequesterDenial } from './download-worker-access.js';
import { ownsDownloadAttempt,downloadStopReason,publicationDecision } from './download-worker-state.js';
import { runMediaProcess } from './media-process.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = path.resolve(MODULE_DIR, '..');
const DEFAULT_YTDLP = process.platform === 'win32' ? path.join(BACKEND_DIR, 'yt-dlp.exe') : path.join(BACKEND_DIR, 'yt-dlp');
const DEFAULT_FFMPEG = process.platform === 'win32' ? path.join(BACKEND_DIR, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe') : path.join(BACKEND_DIR, 'tools', 'ffmpeg', 'bin', 'ffmpeg');
const YTDLP = process.env.YTDLP_PATH || DEFAULT_YTDLP;
const FFMPEG = process.env.FFMPEG_PATH || DEFAULT_FFMPEG;
const POLL_MS = 5000;
let timer = null;
let stopTimer = null;
let ticking = false;
let observing = false;
let stopping = false;
const processes = new Map();
const activeAttempts = new Map();

function qualityFormat(quality) { const height = quality === 'best' ? null : Number.parseInt(quality, 10) || 720; if (!height) return 'bv*+ba/b'; return `bv*[height<=${height}]+ba/b[height<=${height}]/b`; }
function ytDlpRuntimeArgs() { return process.execPath ? ['--js-runtimes', `node:${process.execPath}`] : []; }
const terminating=new WeakSet();
function terminate(child,force=false){
  if(!child||(!force&&terminating.has(child)))return;
  terminating.add(child);
  try{
    if(process.platform==='win32'&&child.pid){
      const killer=spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>{});
    }else if(child.pid){process.kill(-child.pid,force?'SIGKILL':'SIGTERM');}
    else child.kill(force?'SIGKILL':'SIGTERM');
  }catch{}
  if(!force){const escalation=setTimeout(()=>terminate(child,true),2000);escalation.unref?.();child.once('close',()=>clearTimeout(escalation));}
}
function terminateAttempt(attempt){
  if(activeAttempts.get(attempt.id)?.job.worker_run_id===attempt.worker_run_id)terminate(processes.get(attempt.id));
}
function parseProgress(line) { const text = String(line).replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '').trim(); const match = text.match(/^download:\s*(\d+(?:\.\d+)?)%\s*\|\s*(\d+)\s*\|\s*([^|]*)\|\s*([^|]*)\|\s*([^|]*)/i); if (match) { const downloaded = Number(match[2]); const total = Number(match[3]); return { progress: Math.min(100, Number(match[1])), downloaded: Number.isFinite(downloaded) ? downloaded : null, total: Number.isFinite(total) ? total : null }; } const percent = text.match(/(?:^|\s)(\d+(?:\.\d+)?)%/); return percent ? { progress: Math.min(100, Number(percent[1])), downloaded: null, total: null } : null; }
function run(command,args,options={}){return runMediaProcess(command,args,{...options,processes,parseProgress,terminate});}
async function getStopState(attempt) {
  if(stopping||attempt.lease_lost)return 'shutdown';
  const current=(await pool.query('SELECT * FROM resource_download_jobs WHERE id=$1',[attempt.id])).rows[0];
  return downloadStopReason(current,attempt);
}
function isSupportedVideoUrl(value) { try { const host = new URL(value).hostname.toLowerCase().replace(/^www\./, ''); return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com') || host === 'facebook.com' || host.endsWith('.facebook.com') || host === 'fb.watch' || host === 'instagram.com' || host.endsWith('.instagram.com'); } catch { return false; } }

export async function ensureYouTubeThumbnail(resource,jobId) {
  if (!resource?.id || !resource?.url || !isSupportedVideoUrl(resource.url)) return null;
  const dir = resolveStoragePath(resource.id); await fs.mkdir(dir, { recursive: true });
  const existing = (await fs.readdir(dir).catch(() => [])).find(name => /^thumbnail\.(jpg|jpeg|png|webp)$/i.test(name));
  if (existing) return `/api/media-downloads/${resource.id}/thumbnail`;
  const outputTemplate = path.join(dir, 'thumbnail.%(ext)s');
  await run(YTDLP, [...ytDlpRuntimeArgs(), '--skip-download', '--write-thumbnail', '--convert-thumbnails', 'jpg', '--ffmpeg-location', FFMPEG, '--no-playlist', '--restrict-filenames', '-o', outputTemplate, resource.url],{jobId});
  const filename = (await fs.readdir(dir).catch(() => [])).find(name => /^thumbnail\.(jpg|jpeg|png|webp)$/i.test(name));
  if (!filename) throw new Error('yt-dlp completed but no supported video thumbnail was found');
  const stat = await fs.stat(path.join(dir, filename)); if (!stat.isFile() || stat.size <= 0) throw new Error('yt-dlp produced an empty social video thumbnail');
  return `/api/media-downloads/${resource.id}/thumbnail`;
}

async function prepareJobThumbnail(resource,job,dir){
  if(!isSupportedVideoUrl(resource.url))return null;
  const existing=(await fs.readdir(dir)).find(name=>/^thumbnail\.(jpg|jpeg|png|webp)$/i.test(name));
  if(existing)return existing;
  const base='thumbnail-'+job.worker_run_id;
  await run(YTDLP,[...ytDlpRuntimeArgs(),'--skip-download','--write-thumbnail','--convert-thumbnails','jpg','--ffmpeg-location',FFMPEG,'--no-playlist','--restrict-filenames','-o',path.join(dir,base+'.%(ext)s'),resource.url],{jobId:job.id,timeoutMs:15000});
  const name=(await fs.readdir(dir)).find(name=>name.startsWith(base+'.')&&/\.(jpg|jpeg|png|webp)$/i.test(name));
  if(!name)return null;
  const stat=await fs.stat(path.join(dir,name));return stat.isFile()&&stat.size>0?name:null;
}

async function startJob(candidate) {
  const client=await pool.connect();
  // The dedicated connection owns the lease for the entire subprocess lifetime.
  // Another server's recovery skips this job, instead of stealing its attempt.
  let leased=false;
  const connectionFailed=()=>{
    const active=activeAttempts.get(candidate.id);if(active)active.job.lease_lost=true;
    terminate(processes.get(candidate.id));
  };
  client.on('error',connectionFailed);
  try{
    leased=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',['download-job:'+candidate.id])).rows[0].locked;
    if(!leased||stopping)return;
    await executeDownloadAttempt(client,candidate);
  }finally{
    if(leased)activeAttempts.delete(candidate.id);
    client.removeListener('error',connectionFailed);
    // Destroying the dedicated session releases its lock even after an uncertain
    // transaction/connection failure; never return a session lock to the pool.
    client.release(true);
  }
}
async function executeDownloadAttempt(client,candidate){
  let job,resource;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['download-scheduler']);
    const settings=(await client.query('SELECT * FROM media_download_settings WHERE id=1')).rows[0];
    const active=(await client.query("SELECT COUNT(*)::int AS count FROM resource_download_jobs WHERE status='downloading'")).rows[0].count;
    const now=new Date(),due=candidate.scheduled_for&&new Date(candidate.scheduled_for)<=now;
    if(stopping||!settings?.enabled||active>=Math.max(1,Math.min(3,settings.concurrent_downloads||1))||
      (candidate.scheduled_for&&!due)||(!due&&(settings.mode==='manual'||settings.mode==='scheduled'&&!isWithinWindow(settings.window_start,settings.window_end,now)))){
      await client.query('ROLLBACK');return;
    }
    resource=(await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[candidate.resource_id])).rows[0];
    const current=(await client.query('SELECT * FROM resource_download_jobs WHERE id=$1 FOR UPDATE',[candidate.id])).rows[0];
    if(!current||!['queued','scheduled'].includes(current.status)||current.control_version!==candidate.control_version||current.cancel_requested||current.stop_requested_status){await client.query('ROLLBACK');return;}
    const denial=current.attempts>=20?'Download retry limit reached; queue a new request':
      (!resource||resource.local_media_path||resource.kind!=='link'||!resource.url)?'Resource is no longer downloadable; existing media is preserved':await downloadRequesterDenial(current);
    if(denial){
      await client.query("UPDATE resource_download_jobs SET status='cancelled',cancel_requested=TRUE,stop_requested_status=NULL,error_message=$2,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1",[current.id,denial]);
      await client.query('COMMIT');return;
    }
    // Conditional claim prevents a queued pause, edit or cancellation being erased.
    job=(await client.query(`UPDATE resource_download_jobs SET status='downloading',attempts=attempts+1,
      progress=0,bytes_downloaded=0,total_bytes=NULL,error_message=NULL,started_at=CURRENT_TIMESTAMP,
      process_started_at=CURRENT_TIMESTAMP,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond')
      WHERE id=$1 AND status IN ('queued','scheduled') AND cancel_requested=FALSE
      AND stop_requested_status IS NULL AND control_version=$2 RETURNING *`,[candidate.id,candidate.control_version])).rows[0];
    if(job){
      job.worker_run_id=randomUUID();
      await client.query('UPDATE resource_download_jobs SET worker_run_id=$2 WHERE id=$1',[job.id,job.worker_run_id]);
    }
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
  if(!job)return;
  activeAttempts.set(job.id,{job,resource});
  const dir=resolveStoragePath(resource.id);
  // Never overwrite/remove a previous attempt after an interrupted or uncertain
  // publication. Retention/reclamation is separate from download state changes.
  const base='download-'+job.id+'-'+job.worker_run_id;
  let media,thumbnail=null;
  try {
    await fs.mkdir(dir,{recursive:true});
    if(!await getStopState(job)){
      // Optional artwork cannot fail a valid video download. New artwork is
      // attempt-local until the guarded publication transaction.
      try{thumbnail=await prepareJobThumbnail(resource,job,dir);}catch{/* Retain prior artwork, if any. */}
    }
    if(!await getStopState(job)){
      const args=[...ytDlpRuntimeArgs(),'--no-playlist','--newline','--progress','--progress-template',
        'download:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s',
        '--restrict-filenames','-f',qualityFormat(job.quality),'--merge-output-format','mp4','--ffmpeg-location',FFMPEG,
        '-o',path.join(dir,base+'.%(ext)s'),resource.url];
      await run(YTDLP,args,{jobId:job.id,onProgress:async p=>{
        try{
          if(await getStopState(job)){terminateAttempt(job);return;}
          await pool.query(`UPDATE resource_download_jobs SET progress=$1,bytes_downloaded=$2,total_bytes=$3,
            last_progress_at=CURRENT_TIMESTAMP,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$4 AND status='downloading' AND worker_run_id=$5`,
            [p.progress,p.downloaded,p.total,job.id,job.worker_run_id]);
        }catch{/* Keep the process result authoritative; avoid unhandled callback rejection. */}
      }});
      const entries=await fs.readdir(dir);
      const name=entries.find(n=>n.startsWith(base+'.')&&/\.(mp4|webm|mkv)$/i.test(n));
      if(!name)throw new Error('Download produced no supported media file');
      const stat=await fs.stat(path.join(dir,name));
      if(!stat.isFile()||stat.size<=0)throw new Error('Download produced an empty media file');
      media={name,size:stat.size,thumbnail,mime:name.endsWith('.mp4')?'video/mp4':name.endsWith('.webm')?'video/webm':'video/x-matroska'};
    }
  }catch(error){
    await finishDownloadJob(client,job,resource,null,error);
    return;
  }
  // Database failure/uncertain COMMIT must not clean up potentially published media.
  await finishDownloadJob(client,job,resource,media,stopping?new Error('Download worker stopping; retry after restart'):null);
}

async function finishDownloadJob(client,job,resource,media,error){
  try{
    await client.query('BEGIN');
    const existing=(await client.query('SELECT * FROM resources WHERE id=$1 FOR UPDATE',[resource.id])).rows[0];
    const current=(await client.query('SELECT * FROM resource_download_jobs WHERE id=$1 FOR UPDATE',[job.id])).rows[0];
    if(!ownsDownloadAttempt(current,job)){await client.query('ROLLBACK');return;}
    const denial=await downloadRequesterDenial(current);
    const decision=publicationDecision({current,attempt:job,resource:existing,source:resource,denial,error,media});
    if(decision.action==='stop'){
      const status=decision.status;
      await client.query(`UPDATE resource_download_jobs SET status=$2,cancel_requested=$3,stop_requested_status=NULL,
        error_message=$4,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1`,
        [job.id,status,status==='cancelled',decision.error]);
    }else{
      let thumbnailUrl=null;
      if(media.thumbnail){
        const dir=resolveStoragePath(resource.id),target='thumbnail'+path.extname(media.thumbnail).toLowerCase();
        try{
          if(media.thumbnail!==target)await fs.copyFile(path.join(dir,media.thumbnail),path.join(dir,target),fsConstants.COPYFILE_EXCL);
          thumbnailUrl=`/api/media-downloads/${resource.id}/thumbnail`;
        }catch(err){if(err.code==='EEXIST')thumbnailUrl=`/api/media-downloads/${resource.id}/thumbnail`;}
      }
      await client.query(`UPDATE resources SET local_media_path=$1,local_media_filename=$2,local_media_mime_type=$3,
        local_media_size_bytes=$4,local_media_downloaded_at=CURRENT_TIMESTAMP,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond'),
        thumbnail_url=COALESCE($6,thumbnail_url) WHERE id=$5`,
        [resource.id+'/'+media.name,media.name,media.mime,media.size,resource.id,thumbnailUrl]);
      await client.query(`UPDATE resource_download_jobs SET status='completed',progress=100,total_bytes=$1,bytes_downloaded=$1,
        completed_at=CURRENT_TIMESTAMP,last_progress_at=CURRENT_TIMESTAMP,cancel_requested=FALSE,
        stop_requested_status=NULL,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$2`,[media.size,job.id]);
    }
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}

export const getMediaToolStatus=createMediaToolInspector({commands:{yt_dlp:{path:YTDLP,args:['--version']},ffmpeg:{path:FFMPEG,args:['-version']},node:{path:process.execPath,args:['--version']}},production:config.isProduction});
function isWithinWindow(start,end,now) { if(start===end)return true; const minutes=now.getHours()*60+now.getMinutes(); const [sh,sm]=String(start).slice(0,5).split(':').map(Number); const [eh,em]=String(end).slice(0,5).split(':').map(Number); const s=sh*60+sm,e=eh*60+em; return s<e?minutes>=s&&minutes<e:minutes>=s||minutes<e; }
async function recoverInterruptedJobs(){
  const jobs=(await pool.query("SELECT id FROM resource_download_jobs WHERE status='downloading'")).rows;
  for(const job of jobs){
    if(activeAttempts.has(job.id))continue;
    const client=await pool.connect();
    try{
      const locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',['download-job:'+job.id])).rows[0].locked;
      if(!locked)continue;
      // Revoke attempt ownership before retry; retain files after uncertain COMMIT.
      await client.query(`UPDATE resource_download_jobs SET status=CASE
        WHEN stop_requested_status IS NOT NULL THEN stop_requested_status
        WHEN cancel_requested THEN 'cancelled'
        WHEN attempts>=max_attempts THEN 'failed' ELSE 'queued' END,
        worker_run_id=NULL,stop_requested_status=NULL,
        error_message=COALESCE(error_message,'Download worker interrupted; previous files preserved'),
        updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1 AND status='downloading'`,[job.id]);
    }finally{client.release(true);}
  }
}
async function tick() { if(ticking)return; ticking=true; try { const settings=(await pool.query('SELECT * FROM media_download_settings WHERE id=1')).rows[0]; if(!settings?.enabled)return; const now=new Date(); const withinWindow=isWithinWindow(settings.window_start,settings.window_end,now); if(settings.mode==='scheduled'&&!withinWindow){const due=await pool.query(`SELECT id FROM resource_download_jobs WHERE status IN ('queued','scheduled') AND cancel_requested=FALSE AND scheduled_for IS NOT NULL AND scheduled_for<=CURRENT_TIMESTAMP LIMIT 1`);if(!due.rowCount)return;} const slots=Math.max(1,Math.min(3,settings.concurrent_downloads||1)); const active=await pool.query("SELECT COUNT(*)::int AS count FROM resource_download_jobs WHERE status='downloading'"); const available=Math.max(0,slots-active.rows[0].count); if(!available)return; let eligibility; if(settings.mode==='manual')eligibility='(scheduled_for IS NOT NULL AND scheduled_for<=CURRENT_TIMESTAMP)'; else if(settings.mode==='scheduled'&&!withinWindow)eligibility='(scheduled_for IS NOT NULL AND scheduled_for<=CURRENT_TIMESTAMP)'; else eligibility='(scheduled_for IS NULL OR scheduled_for<=CURRENT_TIMESTAMP)'; const jobs=await pool.query(`SELECT * FROM resource_download_jobs WHERE status IN ('queued','scheduled') AND cancel_requested=FALSE AND ${eligibility} ORDER BY priority DESC,scheduled_for NULLS FIRST,created_at ASC LIMIT $1`,[available]); await Promise.all(jobs.rows.map(job=>startJob(job))); } catch(err){console.error('Media download worker:',err.message);} finally{ticking=false;} }
// Observe committed requests even when yt-dlp emits no progress or the scheduler
// is disabled. Only the worker owning the process signals it.
async function observeStopRequests(){
  if(observing||!activeAttempts.size)return;
  observing=true;
  try{
    for(const {job,resource} of activeAttempts.values()){
      if(await getStopState(job)){terminateAttempt(job);continue;}
      const source=(await pool.query('SELECT url,kind FROM resources WHERE id=$1',[job.resource_id])).rows[0];
      const denial=!source||source.url!==resource.url||source.kind!=='link'?'Resource source changed during download':await downloadRequesterDenial(job);
      if(denial){
        await pool.query("UPDATE resource_download_jobs SET cancel_requested=TRUE,stop_requested_status='cancelled',error_message=$3,updated_at=GREATEST(clock_timestamp(),updated_at+interval '1 millisecond') WHERE id=$1 AND worker_run_id=$2 AND status='downloading'",[job.id,job.worker_run_id,denial]);
        terminateAttempt(job);
      }
    }
  }catch(error){
    // An authorization/database outage must not leave unmonitored network work.
    for(const child of processes.values())terminate(child);
    console.error('Media stop observer:',error.message);
  }finally{observing=false;}
}
export function startMediaDownloadWorker(){
  if(timer)return;
  stopping=false;
  let polling=false;
  const poll=async()=>{
    if(polling||stopping)return;polling=true;
    try{await recoverInterruptedJobs();if(!stopping)await tick();}
    catch(err){console.error('Media download recovery:',err.message);}
    finally{polling=false;}
  };
  timer=setInterval(()=>void poll(),POLL_MS);timer.unref?.();
  stopTimer=setInterval(()=>void observeStopRequests(),1000);stopTimer.unref?.();
  void poll();
}
export async function stopMediaDownloadWorker(){
  stopping=true;
  if(timer)clearInterval(timer);if(stopTimer)clearInterval(stopTimer);timer=null;stopTimer=null;
  for(const child of processes.values())terminate(child);
}
