import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const migration = read('src/migrations/034_media_download_queue.sql');
const infrastructureMigration = read('src/migrations/035_media_download_infrastructure.sql');
const pauseMigration = read('src/migrations/036_media_download_pause_state.sql');
const route = read('src/routes/media-downloads.js');
const worker = read('src/media-downloads.js');
const api = read(path.join('..', 'desktop/src/api/mediaDownloads.ts'));
const page = read(path.join('..', 'desktop/src/pages/DownloadsPage.tsx'));
const resources = read(path.join('..', 'desktop/src/pages/ResourcesPage.tsx'));

const checks = [
  ['migration creates resource download jobs', migration.includes('CREATE TABLE IF NOT EXISTS resource_download_jobs')],
  ['migration creates global settings', migration.includes('CREATE TABLE IF NOT EXISTS media_download_settings')],
  ['infrastructure persists cancellation and retry state', infrastructureMigration.includes('cancel_requested') && infrastructureMigration.includes('max_attempts')],
  ['infrastructure persists pause intent', pauseMigration.includes('stop_requested_status')],
  ['route exposes queue GET/POST', route.includes("router.get('/queue'") && route.includes("router.post('/queue'")],
  ['route exposes queue PATCH', route.includes("router.patch('/queue/:id'")],
  ['route exposes explicit start action', route.includes("router.post('/queue/:id/start'")],
  ['route exposes cancellation action', route.includes("stopMediaDownloadJob") && route.includes("'cancelled'")],
  ['worker uses yt-dlp', worker.includes('YTDLP') && worker.includes('spawn(command,args')],
  ['worker does not require ffmpeg', !worker.includes('FFMPEG') && !worker.includes('--ffmpeg-location') && !worker.includes('--merge-output-format')],
  ['worker prefers a single progressive format', worker.includes('best[height<=') && worker.includes('best[ext=mp4]')],
  ['worker tracks persistent progress', worker.includes('bytes_downloaded') && worker.includes('last_progress_at')],
  ['worker recovers interrupted jobs', worker.includes('recoverInterruptedJobs') && worker.includes("status='queued'")],
  ['worker supports active process cancellation', worker.includes('processes') && worker.includes('taskkill') && worker.includes('terminate')],
  ['worker retries failed jobs within max attempts', worker.includes('max_attempts') && worker.includes("retry?'queued':'failed'" )],
  ['worker starts independently of UI', worker.includes('startMediaDownloadWorker') && worker.includes('setInterval')],
  ['manual mode requires explicit scheduled_for', worker.includes("settings.mode==='manual'") && worker.includes('scheduled_for IS NOT NULL')],
  ['API exposes start job', api.includes('startDownloadJob')],
  ['API exposes cancel job', api.includes('cancelDownloadJob')],
  ['API supports per-job scheduling fields', api.includes('scheduled_for') && api.includes('priority') && api.includes('quality')],
  ['API exposes retry settings', api.includes('max_retries')],
  ['Downloads page has global schedule', page.includes('Download schedule') && page.includes('window_start') && page.includes('window_end')],
  ['Downloads page has per-job schedule editor', page.includes('datetime-local') && page.includes('Save job')],
  ['Resources page downloads YouTube thumbnail', resources.includes('downloadYouTubeThumbnail')],
  ['Resources page queues video by default', resources.includes('useState(true)') && resources.includes('Download video')],
  ['Resources page uses authenticated local thumbnail URL', resources.includes('getLocalThumbnailUrl')],
];

let failed = 0;
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) failed++; }
if (failed) process.exitCode = 1;
else console.log(`Media download static checks passed: ${checks.length}/${checks.length}`);
