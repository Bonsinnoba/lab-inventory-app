import { Router } from 'express';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pool } from '../db.js';
import { requireResourceEditor, requireResourceRead } from '../middleware/resource-access.js';
import { hasPermission } from '../middleware/permissions.js';
import { ensureYouTubeThumbnail, getMediaToolStatus } from '../media-downloads.js';
import { controlDownloadHttp } from '../download-job-control.js';
import { resolveStoragePath } from '../storage.js';
import { downloadSettingsPayload, updateDownloadSettingsHttp } from '../download-settings-sync.js';
import { enqueueDownloadHttp } from '../download-queue-http.js';

const router = Router();
const requireDownloadPermission = hasPermission('resources.edit');
const settingsPayload=downloadSettingsPayload;
router.get('/snapshot',requireDownloadPermission,async(req,res)=>{
  try{
    const at=new Date().toISOString();
    const [jobs,settings,tombstones]=await Promise.all([
      pool.query('SELECT j.*,r.name AS resource_name,r.url AS resource_url,r.thumbnail_url,r.local_media_filename,r.local_media_size_bytes FROM resource_download_jobs j JOIN resources r ON r.id=j.resource_id ORDER BY j.created_at DESC,j.id'),
      pool.query('SELECT * FROM media_download_settings WHERE id=1'),
      pool.query('SELECT t.job_id,t.resource_id FROM download_job_tombstones t JOIN resources r ON r.id=t.resource_id'),
    ]);
    const visible=[];for(const job of jobs.rows)if((await requireResourceRead(job.resource_id,req.user)).ok)visible.push(job);
    const removed=[];for(const tombstone of tombstones.rows)if((await requireResourceRead(tombstone.resource_id,req.user)).ok)removed.push(tombstone.job_id);
    res.setHeader('Cache-Control','no-store');
    // Tool diagnostics are optional: their failure cannot erase queue/settings.
    const tools=await getMediaToolStatus().catch(()=>null);
    res.json({jobs:visible,settings:settingsPayload(settings.rows[0]),last_synced_at:at,snapshot_complete:true,tools_status:tools,removed_job_ids:removed});
  }catch(error){res.status(500).json({error:'Unable to synchronize download snapshot'});}
});
router.get('/settings', requireDownloadPermission, async (_req,res)=>{ try { const r=await pool.query('SELECT * FROM media_download_settings WHERE id=1'); res.json(settingsPayload(r.rows[0])); } catch(err){res.status(500).json({error:err.message||'Failed to fetch download settings'});} });
router.put('/settings',requireDownloadPermission,async(req,res)=>{try{res.json(await updateDownloadSettingsHttp(pool,req));}catch(error){res.status(error.status||500).json({error:{code:error.code||'DOWNLOAD_SETTINGS_ERROR',message:error.message}});}});
router.get('/tools/status', requireDownloadPermission, async (_req,res)=>{ try { res.setHeader('Cache-Control','no-store');res.json(await getMediaToolStatus()); } catch(err){res.status(500).json({error:err.message||'Failed to inspect media tools'});} });
router.get('/queue', requireDownloadPermission, async(req,res)=>{ try { const r=await pool.query(`SELECT j.*,r.name AS resource_name,r.url AS resource_url,r.thumbnail_url,r.local_media_filename,r.local_media_size_bytes FROM resource_download_jobs j JOIN resources r ON r.id=j.resource_id ORDER BY CASE WHEN j.status IN ('downloading','paused') THEN 0 WHEN j.status IN ('queued','scheduled') THEN 1 ELSE 2 END,j.priority DESC,j.scheduled_for NULLS FIRST,j.created_at DESC`); const visible=[];for(const job of r.rows){if((await requireResourceRead(job.resource_id,req.user)).ok)visible.push(job)}res.json(visible); } catch(err){res.status(500).json({error:err.message||'Failed to fetch download queue'});} });
router.post('/queue',requireDownloadPermission,async(req,res)=>{
  try{res.status(201).json(await enqueueDownloadHttp(pool,req));}
  catch(error){res.status(error.status||500).json({error:{code:error.code||'DOWNLOAD_QUEUE_ERROR',message:error.message}});}
});
const controlRoute=(action,operation)=>(async(req,res)=>{
  try{
    const requested=action==='edit'?req.body?.action:action;
    res.json(await controlDownloadHttp(pool,req,requested||'edit',operation,action==='edit'?(req.body?.patch||{}):{}));
  }catch(error){res.status(error.status||500).json({error:{code:error.code||'DOWNLOAD_CONTROL_ERROR',message:error.message}});}
});
router.patch('/queue/:id',requireDownloadPermission,controlRoute('edit','update'));
router.post('/queue/:id/start',requireDownloadPermission,controlRoute('start','update'));
router.delete('/queue/:id',requireDownloadPermission,controlRoute('remove','delete'));
async function streamLocal(resource,res){ if(!resource.local_media_path)return res.status(404).json({error:'No local media is available'}); const filePath=resolveStoragePath(resource.local_media_path); const stat=await fs.stat(filePath); const range=res.req.headers.range; res.setHeader('Content-Type',resource.local_media_mime_type||'video/mp4'); res.setHeader('Accept-Ranges','bytes'); res.setHeader('Content-Disposition',`inline; filename="${encodeURIComponent(resource.local_media_filename||'video.mp4')}"`); if(range){const [a,b]=range.replace(/bytes=/,'').split('-');const start=Number.parseInt(a,10);const end=b?Number.parseInt(b,10):stat.size-1;if(!Number.isFinite(start)||start<0||start>=stat.size)return res.status(416).end();res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Content-Length':end-start+1});(await import('node:fs')).createReadStream(filePath,{start,end}).pipe(res);}else{res.setHeader('Content-Length',stat.size);(await import('node:fs')).createReadStream(filePath).pipe(res);} }
router.get('/:id/media',async(req,res)=>{try{const r=await pool.query('SELECT * FROM resources WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).end();const access=await requireResourceRead(req.params.id,req.user);if(!access.ok)return res.status(access.status).json({error:access.error});await streamLocal(r.rows[0],res);}catch(err){res.status(500).json({error:err.message||'Failed to stream local media'});}});
router.get('/:id/thumbnail',async(req,res)=>{try{const r=await pool.query('SELECT * FROM resources WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).end();const access=await requireResourceRead(req.params.id,req.user);if(!access.ok)return res.status(access.status).json({error:access.error});const dir=resolveStoragePath(r.rows[0].id);let files=await fs.readdir(dir).catch(()=>[]);let filename=files.find(name=>/^thumbnail\.(jpg|jpeg|png|webp)$/i.test(name));if(!filename&&r.rows[0].url){try{const thumbnailUrl=await ensureYouTubeThumbnail(r.rows[0]);if(thumbnailUrl)await pool.query('UPDATE resources SET thumbnail_url=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2',[thumbnailUrl,req.params.id]);files=await fs.readdir(dir).catch(()=>[]);filename=files.find(name=>/^thumbnail\.(jpg|jpeg|png|webp)$/i.test(name));}catch(err){console.error('Social video thumbnail repair failed:',err);}}if(!filename)return res.status(404).end();const filePath=resolveStoragePath(`${r.rows[0].id}/${filename}`);const stat=await fs.stat(filePath);const ext=path.extname(filename).toLowerCase();const contentType=ext==='.png'?'image/png':ext==='.webp'?'image/webp':'image/jpeg';res.setHeader('Content-Type',contentType);res.setHeader('Content-Length',stat.size);res.setHeader('Content-Disposition','inline');res.setHeader('Cache-Control','private, max-age=86400');fsSync.createReadStream(filePath).pipe(res);}catch(err){console.error('Thumbnail stream failed:',err);res.status(500).json({error:err.message||'Failed to read thumbnail'});}});
router.post('/:id/thumbnail',requireDownloadPermission,async(req,res)=>{try{const r=await pool.query('SELECT * FROM resources WHERE id=$1',[req.params.id]);if(!r.rowCount)return res.status(404).json({error:'Resource not found'});const access=await requireResourceEditor(req.params.id,req.user);if(!access.ok)return res.status(access.status).json({error:access.error});const thumbnailUrl=await ensureYouTubeThumbnail(r.rows[0]);if(thumbnailUrl)await pool.query('UPDATE resources SET thumbnail_url=$1,updated_at=CURRENT_TIMESTAMP WHERE id=$2',[thumbnailUrl,req.params.id]);res.json({thumbnail_url:thumbnailUrl});}catch(err){res.status(500).json({error:err.message||'Failed to download thumbnail'});}});
export default router;
