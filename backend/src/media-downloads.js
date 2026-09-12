import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { pool } from './db.js';
import { STORAGE_DIR, resolveStoragePath } from './storage.js';

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const POLL_MS = 5000;
let timer = null;
let running = false;

function qualityFormat(quality) {
  const height = quality === 'best' ? null : Number.parseInt(quality, 10) || 720;
  if (!height) return 'bv*+ba/b';
  return `bv*[height<=${height}]+ba/b[height<=${height}]/b[height<=${height}]/b`;
}

function run(command, args, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/)) if (line.trim()) onLine?.(line.trim());
    });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim().split(/\r?\n/).slice(-1)[0] || `yt-dlp exited with code ${code}`)));
  });
}

function parseProgress(line) {
  const match = line.match(/(\d+(?:\.\d+)?)%/);
  return match ? Math.min(100, Number(match[1])) : null;
}

async function youtubeThumbnail(resource) {
  if (!resource.url || !/(youtube\.com|youtu\.be)/i.test(resource.url)) return resource.thumbnail_url || null;
  const dir = resolveStoragePath(resource.id);
  await fs.mkdir(dir, { recursive: true });
  const template = path.join(dir, 'thumbnail.%(ext)s');
  await run(YTDLP, ['--skip-download', '--write-thumbnail', '--no-playlist', '--output', template, resource.url], null);
  const entries = await fs.readdir(dir);
  const thumbnail = entries.find(name => /^thumbnail\.(jpg|jpeg|png|webp)$/i.test(name));
  if (!thumbnail) return resource.thumbnail_url || null;
  return `/api/media-downloads/${resource.id}/thumbnail`;
}

export async function ensureYouTubeThumbnail(resource) {
  try {
    return await youtubeThumbnail(resource);
  } catch (err) {
    console.warn(`YouTube thumbnail failed for ${resource.id}:`, err.message);
    return resource.thumbnail_url || null;
  }
}

function localVideoName(resource) {
  const base = (resource.name || 'video').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'video';
  return `${base}.mp4`;
}

async function startJob(job) {
  const resourceResult = await pool.query('SELECT * FROM resources WHERE id = $1', [job.resource_id]);
  if (!resourceResult.rowCount) throw new Error('Resource no longer exists');
  const resource = resourceResult.rows[0];
  if (resource.kind !== 'link' || !resource.url) throw new Error('Only URL resources can be downloaded');

  const dir = resolveStoragePath(resource.id);
  await fs.mkdir(dir, { recursive: true });
  const filename = localVideoName(resource);
  const output = path.join(dir, filename);

  await pool.query(`UPDATE resource_download_jobs SET status='downloading', attempts=attempts+1, progress=0, started_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$1`, [job.id]);

  const args = [
    '--no-playlist', '--newline', '--restrict-filenames', '--merge-output-format', 'mp4',
    '--ffmpeg-location', FFMPEG,
    '-f', qualityFormat(job.quality),
    '-o', output,
    resource.url,
  ];

  try {
    await run(YTDLP, args, async line => {
      const progress = parseProgress(line);
      if (progress !== null) {
        await pool.query('UPDATE resource_download_jobs SET progress=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2', [progress, job.id]).catch(() => {});
      }
    });
    const stat = await fs.stat(output);
    const relativePath = `${resource.id}/${filename}`;
    await pool.query(`UPDATE resources SET local_media_path=$1, local_media_filename=$2, local_media_mime_type='video/mp4', local_media_size_bytes=$3, local_media_downloaded_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$4`, [relativePath, filename, stat.size, resource.id]);
    await pool.query(`UPDATE resource_download_jobs SET status='completed', progress=100, total_bytes=$1, bytes_downloaded=$1, completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [stat.size, job.id]);
  } catch (err) {
    await fs.rm(output, { force: true }).catch(() => {});
    await pool.query(`UPDATE resource_download_jobs SET status='failed', error_message=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2`, [err.message.slice(0, 2000), job.id]);
  }
}

function isWithinWindow(start, end, now) {
  if (start === end) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = String(start).slice(0, 5).split(':').map(Number);
  const [eh, em] = String(end).slice(0, 5).split(':').map(Number);
  const s = sh * 60 + sm; const e = eh * 60 + em;
  return s < e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const settingsResult = await pool.query('SELECT * FROM media_download_settings WHERE id=1');
    const settings = settingsResult.rows[0];
    if (!settings?.enabled) return;
    // Manual mode intentionally never starts jobs automatically. The Downloads
    // page uses the explicit Start Now action, which puts one job at the front
    // of the runnable queue without bypassing the worker/concurrency limits.
    if (settings.mode === 'manual') return;
    const now = new Date();
    if (settings.mode === 'scheduled' && !isWithinWindow(settings.window_start, settings.window_end, now)) return;
    const slots = Math.max(1, Math.min(3, settings.concurrent_downloads || 1));
    const active = await pool.query("SELECT COUNT(*)::int AS count FROM resource_download_jobs WHERE status='downloading'");
    const available = Math.max(0, slots - active.rows[0].count);
    if (!available) return;
    const jobs = await pool.query(`SELECT * FROM resource_download_jobs WHERE status IN ('queued','scheduled') AND (scheduled_for IS NULL OR scheduled_for <= CURRENT_TIMESTAMP) ORDER BY priority DESC, scheduled_for NULLS FIRST, created_at ASC LIMIT $1`, [available]);
    await Promise.all(jobs.rows.map(job => startJob(job)));
  } catch (err) {
    console.error('Media download worker:', err.message);
  } finally {
    running = false;
  }
}

export function startMediaDownloadWorker() {
  if (timer) return;
  timer = setInterval(() => void tick(), POLL_MS);
  timer.unref?.();
  void tick();
}

export async function stopMediaDownloadWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
