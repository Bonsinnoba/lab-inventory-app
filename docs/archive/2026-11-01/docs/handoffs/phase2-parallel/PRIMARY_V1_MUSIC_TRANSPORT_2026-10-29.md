# V1 music transport hotfix — primary

Owner request: repair pause/resume, switching play/pause controls and intermittent
next/previous failures urgently in V1; retain the same repairs for V2.

## Findings and changes

- Both MusicDock and legacy MusicPlayer subscribed to audio focus in an effect
  depending on `playing` and the complete current track object. Each pause/play,
  track switch or artwork metadata update therefore ran the cleanup that released
  focus and then reacquired it. Playback and focus notifications fed one another.
- Multiple effects, timeouts/requestAnimationFrame callbacks and direct play calls
  raced with source assignment. An aborted older `play()` promise could set the
  newer track's UI to paused or trigger an irrelevant failure.
- MusicMiniPlayer selected the first audio element in the document and called
  play/pause directly, bypassing focus/manual-pause intent and potentially selecting
  resource audio instead of music.

New `musicTransport.ts` owns one media element, source identity, user intention,
focus token, pending-play generation and navigation history. `useMusicTransport`
binds this stable controller to React and both full players. Pause does not reload
the source or reset its position. Track selection binds/loads the intended source
before playing; obsolete promises cannot alter newer playback. Metadata repaint
does not release focus. Higher-priority interruption preserves the current source
and position; a manual pause cancels automatic resumption. Source switches during
interruption resume the new source, without restoring the old source's position.

Mini controls read only the dedicated music element and send toggles to that same
transport; next/previous retain the main control path. No direct mini play calls.
Previous uses actual playback history (including shuffled choices). Manual Next
is distinct from natural end/repeat-one, filters removed queue entries and wraps
at the library end. Automatic end with repeat off stops. Shuffle avoids repeating
the current track while alternatives exist. Empty/unavailable/unsupported media
reports a recoverable error instead of poisoning playback of the next selection.

No track/playlist store schema migration, server/API changes or audio uploads.
Existing imported music stays device-local. No new TTS/provider functionality;
broader Phase3/C3 audio integration is not closed by this targeted transport fix.

## Checks

-23 focused production transport/coordinator tests PASS: deferred play races,
  unchanged source/time on resume, no focus-generation churn on repaint, rapid
  toggles, mini event command, preemption/resumption, manual pause override,
  source change during interruption, legacy event guard, decoder failure recovery,
  reset/dispose, history and queue/repeat/shuffle semantics.
- Shared source TypeScript PASS; isolated V1 TypeScript + Vite PASS2,270 modules.
- Real React.StrictMode MusicDock + MusicMiniPlayer exercised with generated
  silent WAV blobs in IndexedDB on separate browser origin port1424. No real lab
  or music data accessed. Actual HTMLAudioElement pause/resume kept same blob URL
  and position14.396s ->15.085s; five Next/Previous cycles ended playing with
  readyState4 and no media error; minimized pause/resume kept position57.842s ->
  58.854s; speech-focus interruption resumed same source54.095s ->54.661s.
- One initial sample crossed the real track's60s end and correctly advanced to
  the next track. Repeated the pause/resume check away from that boundary above.
- These are real silent-WAV decode/state checks, not an auditory assessment of
  every imported codec or installed WebView2 end-to-end acceptance.

## Packaging and ownership

Isolated source `.tmp/v1-music-20261029/source` starts at HEAD ffbfb22 and includes
the previous V1 resource/viewer hotfix plus five music files. Matching hashes
confirm the shared V2 music files and V1 overlay have the same implementation.
Unfinished Phase2 backend/native/project/salvage changes excluded. V1 package is
2.2.3, same identifier/profile, frontend and native API base localhost:4010/api.
Existing bundled runtime and pinned V1 API remain unchanged.

STATUS: optimized installer build running. Preserve V1 SQLite, managed resources,
IndexedDB music/playlist storage and current pending work during installation.
Observed music IndexedDB is about1.01GB; back it up while V1 is closed before
updating. All edits must be saved before the approved shutdown. Final artifact,
backup and installed verification will be appended below.

## Artifact and pre-install recovery checkpoint

Optimized native build PASS8m38s; NSIS PASS. Installer31,850,022 bytes:
`desktop/src-tauri/target/release/bundle/nsis/LabOS V1_2.2.3_x64-setup.exe`.
SHA256 `89FCE9B57D4CD565D41A1FCA06AD2F83F00B6414C77F454B599CEAB3A5345525`.

Owner confirmed all edits saved and approved shutdown/backup/update/reopening.
Exact installed V1 process shut down. Backup retained at
`.tmp/v1-music-20261029/pre-update-backup`: top-level SQLite profile files,
previous2.2.2 executable, WebView IndexedDB (music/playlist blobs), Local Storage,
Session Storage and Local State.524 copied WebView storage files individually
SHA256-verified against closed originals; SQLite backup hash matched and its
quick_check returned `ok`. No managed resource directory or server data changed.
This is a local hotfix rollback backup; whole-server/off-device recovery remains
separate. Installation started only after successful verification.

## Installed result

- NSIS completed exit0. Existing installed V1 executable reports2.2.3.
- Before reopening, original SQLite hash and all524 IndexedDB/music/settings
  manifest hashes still matched the pre-update snapshot. No library or database
  replacement/reset performed. Existing playlists/imported blobs retained.
- Exact installed executable relaunched at2026-10-29T19:03:34 UTC; running process
  path and version independently verified. V1 API/database/storage health OK.
  No server rebuild, new migration or pinned API change was needed.
- Native desktop inspection timed out twice; one inspector reset/recovery attempt
  also timed out. No further UI input or guessed coordinates were used. Installed
  WebView2 playback of the owner's actual tracks is therefore NOT claimed as
  verified. Real-browser generated-WAV/React/mini/focus checks and23 focused tests
  above remain valid evidence; owner smoke testing is still appropriate.
- Temporary generated-audio browser tab/server/fixture source files were closed
  or removed. Installer, isolated build source and protected local rollback
  backup retained. Shared V2 source retains the same transport/player fixes.

STATUS: V1 2.2.3 INSTALLED AND RELAUNCHED. Targeted music source/testing/packaging
complete; actual owner-file codec/WebView2 smoke check remains. Broader Phase2/3
audio scope is still open; this is not a phase completion claim.
