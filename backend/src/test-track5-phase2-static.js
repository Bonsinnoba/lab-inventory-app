import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const checks=[
['daily-use migration',()=>read('src/migrations/030_intelligence_daily_completion.sql').includes('user_daily_use_preferences')],
['daily preferences route',()=>read('src/routes/system.js').includes("'/daily-preferences'")],
['admin JSON export',()=>read('src/routes/system.js').includes("router.get('/export', requireRole('admin')")],
['health diagnostics',()=>read('src/routes/system.js').includes("router.get('/health-details'")],
['system router mounted',()=>read('src/index.js').includes("app.use('/api/system', authenticateToken, systemRouter)")],
['automation route preserved',()=>read('src/routes/automation.js').includes("router.post('/run'")],
['notifications API preserved',()=>read('src/routes/collaboration.js').includes("router.get('/notifications'")],
['local media uses IndexedDB',()=>read('../desktop/src/components/MusicPlayer.tsx').includes('indexedDB.open(DB,1)')],
['music never uploads to LabOS',()=>read('../desktop/src/components/MusicPlayer.tsx').includes('never sent to LabOS')],
['music floating player',()=>read('../desktop/src/components/MusicPlayer.tsx').includes('fixed z-[75]')],
['music minimize restore',()=>read('../desktop/src/components/MusicPlayer.tsx').includes('onMinimize')&&read('../desktop/src/components/MusicPlayer.tsx').includes('onRestore')],
['music pause resume protocol',()=>read('../desktop/src/components/MusicPlayer.tsx').includes('labos:pause-music')&&read('../desktop/src/components/MusicPlayer.tsx').includes('labos:resume-music')],
['assistant TTS coordinates music',()=>read('../desktop/src/components/AssistantChat.tsx').includes('labos:pause-music')&&read('../desktop/src/components/AssistantChat.tsx').includes('labos:resume-music')],
['system API client',()=>read('../desktop/src/api/system.ts').includes('downloadLabosExport')],
['daily use UI',()=>read('../desktop/src/components/DailyUsePanel.tsx').includes('Daily Use & System')],
['media manager UI',()=>read('../desktop/src/components/MediaManager.tsx').includes('Media Manager')],
['global media mount',()=>read('../desktop/src/App.tsx').includes('<MediaManager')&&read('../desktop/src/App.tsx').includes('<MusicPlayer')],
['daily use route',()=>read('../desktop/src/App.tsx').includes('path="/daily-use"')],
['music topbar launcher',()=>read('../desktop/src/components/TopBar.tsx').includes('labos:music-player')],
['media command',()=>read('../desktop/src/components/CommandPalette.tsx').includes('labos:media-manager')],
['right rail remains three docked panels',()=>{const a=read('../desktop/src/components/ActivityRail.tsx');return a.includes("'assistant'")&&a.includes("'notebook'")&&a.includes("'search'")&&a.includes('Engineering Tools')}],
];
let failed=0;for(const [name,fn] of checks){try{if(fn())console.log(`✓ ${name}`);else{console.log(`FAIL: ${name}`);failed++}}catch(e){console.log(`FAIL: ${name} (${e.message})`);failed++}}
if(failed){console.error(`\nTRACK 5 PHASE 2 STATIC TESTS FAILED: ${failed}`);process.exit(1)}
console.log('\nTRACK 5 PHASE 2 STATIC TESTS PASSED');
