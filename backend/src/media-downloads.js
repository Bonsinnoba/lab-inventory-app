import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db.js';
import { resolveStoragePath } from './storage.js';

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const POLL_MS = 5000;
const MAX_ERROR_LENGTH = 2000;
let timer = null;
let ticking = false;
const processes = new Map();

function qualityFormat(quality) {
  const height = quality === 'best' ? null : Number.parseInt(quality, 10) || 720;
  if (!height) return 'best';
  return `best[height<=${height}]/best[ext=mp4][height<=${height}]/best`;
}
function terminate(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  } catch {}
}
function parseProgress(line) {
  const match = line.match(/download:(\d+(?:\.\d+)?)%\|(\d+)\|([^|]*)\|([^|]*)\|([^|]*)/i);
  if (match) { const total=Number(match[3]); return { progress:Math.min(100,Number(match[1])), downloaded:Number(match[2]), total:Number.isFinite(total)?total:null }; }
  const percent=line.match(/(\d+(?:\.\d+)?)%/); return percent?{progress:Math.min(100,Number(percent[1])),downloaded:null,total:null}:null;
}
function run(command,args,{jobId,onProgress}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{windowsHide:true}); if(jobId)processes.set(jobId,child);
    let stderr='',stdout='',settled=false;
    const finish=(fn,value)=>{if(settled)return;settled=true;if(jobId)processes.delete(jobId);fn(value);};
    child.stdout.on('data',c=>{stdout+=c.toString();});
    child.stderr.on('data',c=>{const text=c.toString();stderr+=text;for(const line of text.split(/\r?\n/)){if(!line.trim())continue;const p=parseProgress(line.trim());if(p)void onProgress?.(p);}});
    child.on('error',e=>finish(reject,e));
    child.on('close',code=>code===0?finish(resolve,{stdout,stderr}):finish(reject,Object.assign(new Error(stderr.trim().split(/\r?\n/).slice(-1)[0]||`yt-dlp exited with code ${code}`),{code})));
  });
}
async function getStopState(jobId) {
  const r=await pool.query('SELECT cancel_requested,status,stop_requested_status FROM resource_download_jobs WHERE id=$1',[jobId]);
  if(!r.rowCount)return 'cancelled'; const row=r.rows[0];
  return row.stop_requested_status || (row.cancel_requested ? 'cancelled' : null);
}
async function cleanMediaFiles(dir,base){const entries=await fs.readdir(dir).catch(()=>[]);await Promise.all(entries.filter(n=>n.startsWith(`${base}.`)&&!/^thumbnail\./i.test(n)).map(n=>fs.rm(path.join(dir,n),{force:true})));}
async function startJob(job){
  const resourceResult=await pool.query('SELECT * FROM resources WHERE id=$1',[job.resource_id]);
  if(!resourceResult.rowCount)throw new Error('Resource no longer exists');
  const resource=resourceResult.rows[0]; if(resource.kind!=='link'||!resource.url)throw new Error('Only URL resources can be downloaded');
  const dir=resolveStoragePath(resource.id);await fs.mkdir(dir,{recursive:true});
  const base=(resource.name||'video').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').trim()||'video';
  const outputTemplate=path.join(dir,`${base}.%(ext)s`);const maxAttempts=Math.max(1,Math.min(5,Number(job.max_attempts)||3));
  await pool.query(`UPDATE resource_download_jobs SET status='downloading',cancel_requested=FALSE,stop_requested_status=NULL,attempts=attempts+1,progress=0,bytes_downloaded=0,total_bytes=NULL,error_message=NULL,started_at=CURRENT_TIMESTAMP,process_started_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$1`,[job.id]);
  const args=['--no-playlist','--newline','--progress','--progress-template','download:%(progress._percent_str)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.speed)s|%(progress.eta)s','--restrict-filenames','-f',qualityFormat(job.quality),'-o',outputTemplate,resource.url];
  try {
    await run(YTDLP,args,{jobId:job.id,onProgress:async p=>{const stop=await getStopState(job.id);if(stop){terminate(processes.get(job.id));return;}await pool.query(`UPDATE resource_download_jobs SET progress=$1,bytes_downloaded=$2,total_bytes=$3,last_progress_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$4 AND status='downloading'`,[p.progress,p.downloaded,p.total,job.id]).catch(()=>{});}});
    const stop=await getStopState(job.id); if(stop){await cleanMediaFiles(dir,base);await pool.query(`UPDATE resource_download_jobs SET status=$1,cancel_requested=$2,stop_requested_status=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$3`,[stop,stop==='cancelled',job.id]);return;}
    const entries=await fs.readdir(dir);const mediaName=entries.find(n=>n.startsWith(`${base}.`)&&!/^thumbnail\./i.test(n));if(!mediaName)throw new Error('yt-dlp completed but no local video file was found');
    const output=path.join(dir,mediaName);const stat=await fs.stat(output);if(!stat.isFile()||stat.size<=0)throw new Error('yt-dlp produced an empty media file');
    const lower=mediaName.toLowerCase();const mimeType=lower.endsWith('.mp4')?'video/mp4':lower.endsWith('.webm')?'video/webm':lower.endsWith('.mkv')?'video/x-matroska':'video/*';const relativePath=`${resource.id}/${mediaName}`;
    await pool.query(`UPDATE resources SET local_media_path=$1,local_media_filename=$2,local_media_mime_type=$3,local_media_size_bytes=$4,local_media_downloaded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=$5`,[relativePath,mediaName,mimeType,stat.size,resource.id]);
    await pool.query(`UPDATE resource_download_jobs SET status='completed',progress=100,total_bytes=$1,bytes_downloaded=$1,completed_at=CURRENT_TIMESTAMP,last_progress_at=CURRENT_TIMESTAMP,stop_requested_status=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[stat.size,job.id]);
  } catch(err) {
    processes.delete(job.id);const stop=await getStopState(job.id).catch(()=>null);await cleanMediaFiles(dir,base);
    if(stop){await pool.query(`UPDATE resource_download_jobs SET status=$1,cancel_requested=$2,stop_requested_status=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=$3`,[stop,stop==='cancelled',job.id]);return;}
    const current=(await pool.query('SELECT attempts,max_attempts FROM resource_download_jobs WHERE id=$1',[job.id])).rows[0];const retry=current&&current.attempts<Math.max(1,Math.min(5,current.max_attempts||maxAttempts));const message=String(err?.message||'Download failed').slice(0,MAX_ERROR_LENGTH);
    await pool.query(`UPDATE resource_download_jobs SET status=$1,error_message=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$3`,[retry?'queued':'failed',message,job.id]);
  }
}

export async function ensureYouTubeThumbnail(resource) {
  if (!resource?.id || !resource?.url) return null;
  let url;
  try { url = new URL(resource.url); } catch { return null; }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'youtube.com' && host !== 'youtu.be' && !host.endsWith('.youtube.com')) return null;

  const dir = resolveStoragePath(resource.id);
  await fs.mkdir(dir, { recursive: true });
  const existing = (await fs.readdir(dir).catch(() => []))
    .find(name => /^thumbnail\.(jpg|jpeg|png|webp)$/i.test(name));
  if (existing) return `/api/media-downloads/${resource.id}/thumbnail`;

  const outputTemplate = path.join(dir, 'thumbnail.%(ext)s');
  await run(YTDLP, [
    '--skip-download',
    '--write-thumbnail',
    '--no-playlist',
    '--restrict-filenames',
    '-o',
    outputTemplate,
    resource.url,
  ]);

  const filename = (await fs.readdir(dir).catch(() => []))
    .find(name => /^thumbnail\.(jpg|jpeg|png|webp)$/i.test(name));
  if (!filename) throw new Error('yt-dlp completed but no YouTube thumbnail was found');
  const stat = await fs.stat(path.join(dir, filename));
  if (!stat.isFile() || stat.size <= 0) throw new Error('yt-dlp produced an empty YouTube thumbnail');
  return `/api/media-downloads/${resource.id}/thumbnail`;
}

function isWithinWindow(start,end,now){if(start===end)return true;const minutes=now.getHours()*60+now.getMinutes();const [sh,sm]=String(start).slice(0,5).split(':').map(Number);const [eh,em]=String(end).slice(0,5).split(':').map(Number);const s=sh*60+sm,e=eh*60+em;return s<e?minutes>=s&&minutes<e:minutes>=s||minutes<e;}
async function recoverInterruptedJobs(){await pool.query(`UPDATE resource_download_jobs SET status='queued',error_message=COALESCE(error_message,'Download worker restarted before completion'),updated_at=CURRENT_TIMESTAMP WHERE status='downloading' AND cancel_requested=FALSE`);await pool.query(`UPDATE resource_download_jobs SET status=COALESCE(stop_requested_status,'cancelled'),stop_requested_status=NULL,updated_at=CURRENT_TIMESTAMP WHERE status='downloading' AND cancel_requested=TRUE`);}
async function tick(){if(ticking)return;ticking=true;try{const settings=(await pool.query('SELECT * FROM media_download_settings WHERE id=1')).rows[0];if(!settings?.enabled)return;const now=new Date();if(settings.mode==='scheduled'&&!isWithinWindow(settings.window_start,settings.window_end,now))return;const slots=Math.max(1,Math.min(3,settings.concurrent_downloads||1));const active=await pool.query("SELECT COUNT(*)::int AS count FROM resource_download_jobs WHERE status='downloading'");const available=Math.max(0,slots-active.rows[0].count);if(!available)return;const eligibility=settings.mode==='manual'?'(scheduled_for IS NOT NULL AND scheduled_for <= CURRENT_TIMESTAMP)':'(scheduled_for IS NULL OR scheduled_for <= CURRENT_TIMESTAMP)';const jobs=await pool.query(`SELECT * FROM resource_download_jobs WHERE status IN ('queued','scheduled') AND cancel_requested=FALSE AND ${eligibility} ORDER BY priority DESC,scheduled_for NULLS FIRST,created_at ASC LIMIT $1`,[available]);await Promise.all(jobs.rows.map(job=>startJob(job)));}catch(err){console.error('Media download worker:',err.message);}finally{ticking=false;}}
export function startMediaDownloadWorker(){if(timer)return;void recoverInterruptedJobs().catch(err=>console.error('Media download recovery:',err.message));timer=setInterval(()=>void tick(),POLL_MS);timer.unref?.();void tick();}
export async function stopMediaDownloadWorker(){if(timer)clearInterval(timer);timer=null;for(const child of processes.values())terminate(child);processes.clear();}
export async function stopMediaDownloadJob(jobId,finalStatus='cancelled'){const status=['paused','cancelled'].includes(finalStatus)?finalStatus:'cancelled';await pool.query(`UPDATE resource_download_jobs SET cancel_requested=TRUE,stop_requested_status=$1,status=CASE WHEN status IN ('queued','scheduled','paused','failed') THEN $1 ELSE status END,updated_at=CURRENT_TIMESTAMP WHERE id=$2`,[status,jobId]);terminate(processes.get(jobId));}
