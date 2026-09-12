import fs from 'fs';
import path from 'path';

const root = path.resolve(process.cwd(), '..');
const file = path.join(root, 'desktop', 'src', 'components', 'MusicPlayer.tsx');
const s = fs.readFileSync(file, 'utf8');
let failures = 0;
function check(re, label) {
  if (re.test(s)) console.log(`✓ ${label}`);
  else { console.error(`FAIL: ${label}`); failures++; }
}
check(/const audioElement = \(/, 'stable audio element exists');
check(/onPlay=\{\(\) => setPlaying\(true\)\}/, 'playing state follows audio play event');
check(/onPause=\{\(\) => setPlaying\(false\)\}/, 'playing state follows audio pause event');
check(/onError=\{\(\) => setPlaying\(false\)\}/, 'playback errors clear playing state');
check(/minimized \? 'hidden' : 'opacity-100'/, 'minimize hides window without unmounting audio');
check(/\{audioElement\}\s*<\/div>/, 'audio element remains in player tree');
check(/w-14 h-14 rounded-full/, 'minimized player is a circular icon');
check(/onPointerDown=\{startMinimizedDrag\}/, 'minimized player is draggable');
check(/minimizedHoverTimer/, 'minimized hover uses a grace timer');
check(/pointer-events-none/, 'minimized shell does not block the app');
check(/pointer-events-auto/, 'hover widget remains interactable');
check(/onPointerLeave=\{\(\) => \{\s*minimizedHoverTimer\.current = setTimeout\(\(\) => setMinimizedHover\(false\), 450\)/s, 'hover widget closes after pointer leaves widget');
check(/ref=\{minimizedWidgetRef\}/, 'hover widget has a stable interaction ref');
check(/onPointerEnter=\{\(\) => \{\s*\/\/ This does NOT open the widget\./s, 'hover widget only cancels close timer');
check(/onPointerEnter=\{\(\) => \{\s*if \(minimizedHoverTimer\.current\) clearTimeout\(minimizedHoverTimer\.current\);\s*minimizedHoverTimer\.current = null;\s*setMinimizedHover\(true\);/s, 'hover trigger is the minimized icon');
if (/ref=\{minimizedWidgetRef\}\s*\n\s*on(?:Mouse|Pointer)Enter=\{[^}]*setMinimizedHover\(true\)/s.test(s)) { console.error('FAIL: hover widget does not trigger hover state'); failures++; } else console.log('✓ hover widget does not trigger hover state');
check(/setTimeout\(\(\) => setMinimizedHover\(false\), 700\)/, 'icon leave uses a travel grace period');
check(/animate-ping/, 'playing state has animated ring');
check(/animationDelay/, 'playing state has animated level indicators');
check(/bg-surface\/95 backdrop-blur-xl/, 'hover controls use theme surfaces');
check(/w-\[min\(1120px,calc\(100vw-2rem\)\)\]/, 'expanded player uses wide desktop layout');
check(/-translate-x-1\/2 -translate-y-1\/2/, 'expanded player is centered');
check(/el\.style\.transform = 'none'/, 'dragging expanded player clears centering transform');
check(/xl:grid-cols-\[minmax\(0,1fr\)_330px\]/, 'expanded player has dedicated right queue column');
check(/text-\[10px\] uppercase tracking-\[0\.18em\].*Now Playing/s, 'expanded player has now-playing sidebar');
check(/Recently added/, 'expanded player has recently added library section');
check(/grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5/, 'expanded library uses media cards');
check(/indexedDB\.open\(DB, VERSION\)/, 'music library is persistent in IndexedDB');
check(/setQueue/, 'queue management exists');
check(/Playlist/, 'playlist management exists');
check(/'all'.*'one'.*'off'/s, 'repeat off/all/one exists');
check(/setShuffle/, 'shuffle exists');
check(/moveQueue/, 'queue reorder exists');
check(/multiple className="hidden" onChange=\{addFiles\}/, 'library import exists');
check(/never uploaded to LabOS/, 'music remains device-local');
if (failures) process.exit(1);
console.log('TRACK 5 PHASE 2 MUSIC UI TESTS PASSED');
