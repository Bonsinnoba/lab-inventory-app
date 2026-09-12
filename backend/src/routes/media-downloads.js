import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from '../db.js';
import { requireResourceEditor, requireResourceRead } from '../middleware/resource-access.js';
import { resolveStoragePath } from '../storage.js';
import { ensureYouTubeThumbnail } from '../media-downloads.js';

const router = Router();

function settingsPayload(row) {
  return { enabled: row.enabled, mode: row.mode, window_start: String(row.window_start).slice(0, 5), window_end: String(row.window_end).slice(0, 5), concurrent_downloads: row.concurrent_downloads, default_quality: row.default_quality };
}

router.get('/settings', async (_req, res) => {
  try {
    const result = await pool.query('SELECT * FROM media_download_settings WHERE id=1');
    res.json(settingsPayload(result.rows[0]));
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to fetch download settings' }); }
});

router.put('/settings', async (req, res) => {
  try {
    const mode = ['manual','scheduled','always'].includes(req.body.mode) ? req.body.mode : 'scheduled';
    const quality = ['best','1080p','720p','480p','audio'].includes(req.body.default_quality) ? req.body.default_quality : '720p';
    const concurrent = Math.max(1, Math.min(3, Number(req.body.concurrent_downloads) || 1));
    const result = await pool.query(`UPDATE media_download_settings SET enabled=$1, mode=$2, window_start=$3::time, window_end=$4::time, concurrent_downloads=$5, default_quality=$6, updated_at=CURRENT_TIMESTAMP WHERE id=1 RETURNING *`, [req.body.enabled !== false, mode, req.body.window_start || '00:00', req.body.window_end || '06:00', concurrent, quality]);
    res.json(settingsPayload(result.rows[0]));
  } catch (err) { res.status(400).json({ error: err.message || 'Failed to update download settings' }); }
});

router.get('/queue', async (_req, res) => {
  try {
    const result = await pool.query(`SELECT j.*, r.name AS resource_name, r.url AS resource_url, r.thumbnail_url, r.local_media_filename, r.local_media_size_bytes FROM resource_download_jobs j JOIN resources r ON r.id=j.resource_id ORDER BY CASE WHEN j.status IN ('downloading','paused') THEN 0 WHEN j.status IN ('queued','scheduled') THEN 1 ELSE 2 END, j.priority DESC, j.scheduled_for NULLS FIRST, j.created_at DESC`);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to fetch download queue' }); }
});

router.post('/queue', async (req, res) => {
  const { resource_id, quality, scheduled_for, priority } = req.body;
  if (!resource_id) return res.status(400).json({ error: 'resource_id is required' });
  try {
    const access = await requireResourceEditor(resource_id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const resource = await pool.query('SELECT * FROM resources WHERE id=$1', [resource_id]);
    if (!resource.rowCount) return res.status(404).json({ error: 'Resource not found' });
    if (resource.rows[0].kind !== 'link' || !resource.rows[0].url) return res.status(400).json({ error: 'Only URL resources can be downloaded' });
    if (resource.rows[0].local_media_path) return res.status(409).json({ error: 'This resource already has a local video copy' });
    const existing = await pool.query("SELECT id FROM resource_download_jobs WHERE resource_id=$1 AND status IN ('queued','scheduled','downloading','paused') LIMIT 1", [resource_id]);
    if (existing.rowCount) return res.status(409).json({ error: 'This resource is already in the download queue' });
    const settings = await pool.query('SELECT default_quality FROM media_download_settings WHERE id=1');
    const selectedQuality = ['best','1080p','720p','480p','audio'].includes(quality) ? quality : settings.rows[0]?.default_quality || '720p';
    const status = scheduled_for ? 'scheduled' : 'queued';
    const result = await pool.query(`INSERT INTO resource_download_jobs (resource_id, requested_by, status, quality, scheduled_for, priority) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [resource_id, req.user?.userId || null, status, selectedQuality, scheduled_for || null, Number(priority) || 0]);
    res.status(201).json(result.rows[0]);
  } catch (err) { res.status(400).json({ error: err.message || 'Failed to queue download' }); }
});

router.patch('/queue/:id', async (req, res) => {
  try {
    const job = await pool.query('SELECT * FROM resource_download_jobs WHERE id=$1', [req.params.id]);
    if (!job.rowCount) return res.status(404).json({ error: 'Download job not found' });
    const access = await requireResourceEditor(job.rows[0].resource_id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const allowed = ['queued','scheduled','paused','cancelled'];
    if (!allowed.includes(req.body.status)) return res.status(400).json({ error: 'Invalid queue status' });
    const result = await pool.query(`UPDATE resource_download_jobs SET status=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2 RETURNING *`, [req.body.status, req.params.id]);
    res.json(result.rows[0]);
  } catch (err) { res.status(400).json({ error: err.message || 'Failed to update download job' }); }
});

router.delete('/queue/:id', async (req, res) => {
  try {
    const job = await pool.query('SELECT * FROM resource_download_jobs WHERE id=$1', [req.params.id]);
    if (!job.rowCount) return res.status(404).json({ error: 'Download job not found' });
    const access = await requireResourceEditor(job.rows[0].resource_id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    if (job.rows[0].status === 'downloading') return res.status(409).json({ error: 'Downloading jobs must be paused or cancelled first' });
    await pool.query('DELETE FROM resource_download_jobs WHERE id=$1', [req.params.id]);
    res.status(204).send();
  } catch (err) { res.status(400).json({ error: err.message || 'Failed to remove download job' }); }
});

router.get('/:id/thumbnail', async (req, res) => {
  try {
    const resource = await pool.query('SELECT * FROM resources WHERE id=$1', [req.params.id]);
    if (!resource.rowCount) return res.status(404).end();
    const access = await requireResourceRead(req.params.id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const dir = resolveStoragePath(resource.rows[0].id);
    const files = await fs.readdir(dir).catch(() => []);
    const filename = files.find(name => /^thumbnail\.(jpg|jpeg|png|webp)$/i.test(name));
    if (!filename) return res.status(404).end();
    const ext = path.extname(filename).toLowerCase();
    res.setHeader('Content-Type', ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.resolve(dir, filename));
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to read thumbnail' }); }
});

// Re-fetch a thumbnail for an existing YouTube resource if the original attempt failed.
router.post('/:id/thumbnail', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM resources WHERE id=$1', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Resource not found' });
    const access = await requireResourceEditor(req.params.id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const thumbnailUrl = await ensureYouTubeThumbnail(result.rows[0]);
    if (thumbnailUrl) await pool.query('UPDATE resources SET thumbnail_url=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [thumbnailUrl, req.params.id]);
    res.json({ thumbnail_url: thumbnailUrl });
  } catch (err) { res.status(500).json({ error: err.message || 'Failed to download thumbnail' }); }
});

export default router;
