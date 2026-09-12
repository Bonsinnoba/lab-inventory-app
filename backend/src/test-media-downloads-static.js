import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const migration = read('src/migrations/034_media_download_queue.sql');
const route = read('src/routes/media-downloads.js');
const worker = read('src/media-downloads.js');
const api = read(path.join('..', 'desktop/src/api/mediaDownloads.ts'));
const page = read(path.join('..', 'desktop/src/pages/DownloadsPage.tsx'));
const resources = read(path.join('..', 'desktop/src/pages/ResourcesPage.tsx'));

const checks = [
  ['migration creates resource download jobs', migration.includes('CREATE TABLE IF NOT EXISTS resource_download_jobs')],
  ['migration creates global settings', migration.includes('CREATE TABLE IF NOT EXISTS media_download_settings')],
  ['route exposes queue GET/POST', route.includes("router.get('/queue'") && route.includes("router.post('/queue'" )],
  ['route exposes queue PATCH', route.includes("router.patch('/queue/:id'" )],
  ['route exposes explicit start action', route.includes("router.post('/queue/:id/start'" )],
  ['worker uses yt-dlp', worker.includes('YTDLP') && worker.includes("spawn(command, args")],
  ['worker uses ffmpeg for merged mp4', worker.includes('--ffmpeg-location') && worker.includes('--merge-output-format')],
  ['manual mode requires explicit scheduled_for', worker.includes("settings.mode === 'manual'") && worker.includes('scheduled_for IS NOT NULL')],
  ['API exposes start job', api.includes('startDownloadJob')],
  ['API supports per-job scheduling fields', api.includes('scheduled_for') && api.includes('priority') && api.includes('quality')],
  ['Downloads page has global schedule', page.includes('Download schedule') && page.includes('window_start') && page.includes('window_end')],
  ['Downloads page has per-job schedule editor', page.includes('datetime-local') && page.includes('Save job')],
  ['Resources page downloads YouTube thumbnail', resources.includes('downloadYouTubeThumbnail')],
  ['Resources page queues video by default', resources.includes('useState(true)') && resources.includes('Download video')],
  ['Resources page uses authenticated local thumbnail URL', resources.includes('getLocalThumbnailUrl')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
if (failed) process.exitCode = 1;
else console.log(`Media download static checks passed: ${checks.length}/${checks.length}`);
