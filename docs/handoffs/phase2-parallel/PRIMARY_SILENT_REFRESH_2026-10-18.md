# Primary review: silent refresh stability — October 18, 2026

Identity / role: LABOS-P2-PRIMARY, implementing the owner's report of blinking
images and text during silent refreshes. No helper delivery is credited here.

## Findings and changes

MODULE: Resource image/file access.

FILE: `desktop/src/api/resource-uploads.ts`.

CURRENT WRITE PATH: presentation cache populated by native read-only capability
checks; no authored database/server write.

WHY IT BYPASSES OFFLINE-FIRST: not an outbox violation. The cache was cleared
before every asynchronous read, briefly making still-authorized files unavailable
to renders elsewhere in the app.

RISK: image/availability flicker; overlapping reads could publish stale results.

RECOMMENDED CHANGE: atomic publication, session guards and latest-read ordering.

ACTUAL CHANGE MADE: retain the current session's capabilities while refreshing;
replace on success, clear on latest failure, discard superseded responses. Native
file requests still enforce authorization; no permission/lease relaxation.

VERIFICATION: deferred-read tests cover stable URLs, removed access, failure,
stale-result races and account changes. Existing upload tests remain passing.

STATUS: implemented; native visual acceptance pending deployment.

---

MODULE: Video previews in Resources, embedded panels and Downloads.

FILE: `desktop/src/components/VideoResourcePoster.tsx`.

CURRENT WRITE PATH: native authorized poster read -> in-memory blob URL.

WHY IT BYPASSES OFFLINE-FIRST: no write-path bypass. Every metadata sync emits a
poster-refresh event; unchanged bytes previously produced a fresh URL, reloading
the image. Same-account profile notifications also cleared the preview.

RISK: recurring blink, unnecessary decoding, and stale async preview publication.

RECOMMENDED CHANGE: preserve the URL for identical authorized bytes, retain strict
resource/revision/account boundaries, revalidate on profile events.

ACTUAL CHANGE MADE: byte comparison within the existing effect scope; unchanged
bytes keep their URL. Changed content replaces it; missing/denied reads clear it.
Session/revision changes never render the previous scope's image. Cleanup and
sequence guards prevent late loads reviving expired/replaced previews.

VERIFICATION: hook lifecycle tests cover no-op sync, profile refresh, changed
bytes, missing/denied reads, revisions, accounts, expiration and overlapping loads.

STATUS: implemented; actual no-blink native acceptance pending deployment.

---

MODULE: Background page refresh presentation.

FILE: `desktop/src/hooks/useManualRefresh.ts`; Resources, Downloads,
Collaboration, Projects, Users, Reports, Lab Intelligence, Financials, Ledger and
Project Finance pages; `desktop/src/components/ReadAvailabilityNotice.tsx`.

CURRENT WRITE PATH: unchanged query reads/invalidations; React presentation only.

WHY IT BYPASSES OFFLINE-FIRST: not a write-path violation. Query isFetching was
displayed as spinning icons, changing button labels and inserted Updating text
on every automatic poll, even when query data was unchanged.

RISK: distracting motion/layout changes; chart redraw animations replaying.

RECOMMENDED CHANGE: explicit-user refresh progress distinct from background
fetching; preserve real data/error and permission changes.

ACTUAL CHANGE MADE: shared manual-action busy hook on ten pages, fixed Refresh
labels for Downloads/Collaboration, and disabled report/finance chart animation.
Local read timestamp moved to the notice tooltip instead of changing visible
text every poll. Freshness disclaimer remains. Initial loading, read errors,
authorization, query keys, outbox and synchronization frequency are unchanged.
TanStack structural sharing already preserves unchanged data; no global policy
was added that could hide actual edits, deletions or permission failures.

VERIFICATION: manual-action/double-click/error lifecycle and actual QueryClient
structural-sharing tests (identical data, one changed row, deletion).

STATUS: implemented; visual acceptance pending deployment.

## Collected checks and deployment boundary

- 34 focused tests passed, then the same 34 passed again while the actual
  labos-labos-api-1 container was stopped. These are adapter/hook contract tests,
  not new PostgreSQL fixtures or native UI acceptance.
- Existing PostgreSQL was left running; API restored in finally and confirmed
  running/healthy. All databases, stored files and outboxes preserved.
- TypeScript --noEmit passed; scoped git diff --check passed.
- Expanded final batch: 45 PASS, including existing overview availability and
  automatic download intake cases. Initial overview tests failed because their
  custom module loader did not know the new hook; it now loads the actual hook
  with React, without bypassing availability assertions. All 45 were rerun.
- Frontend bundle verification uses `.tmp/silent-refresh-build-20261018`, not
  the app's current dist. Initial sandboxed Vite invocation failed reading its
  configuration; elevated retry passed (2,254 modules). No current app assets
  were replaced by this isolated build.
- No native code, backend, schema or sync-write path was changed by this batch.
  No desktop rebuild/restart or deployment occurred. The dirty worktree also
  contains unrelated Phase 2 changes; do not claim they were verified here.

Remaining acceptance: deploy the reviewed frontend/native combination safely,
observe multiple unchanged sync cycles with images/charts/text stable, then
verify actual edits/deletes and access revocation still update the display.
Repeat the local-media observation with API stopped and restore it afterward.

## Owner-authorized desktop deployment

Owner requested restart to see these changes. To avoid deploying the dirty
custody/salvage and audio integration work, primary prepared an isolated build at
`.tmp/silent-refresh-desktop-20261018/desktop`: committed baseline `0a5deb4` plus
the explicit refresh/presentation files, reviewed Reports freshness correction,
existing resource status styling and media quality type, and reviewed icon
write-if-changed build fix. The original workspace changes remain untouched.
Native domain commands use the committed baseline; main.rs Git blob verified
`bf8006a937db2149efe65df3215536bcde761539`, matching HEAD exactly. No API rebuild,
database migration, outbox reset or database replacement is part of this update.

Candidate TypeScript and Vite build passed (2,253 modules). Candidate regression
batch: 55 PASS, including Reports projection/export, refresh, upload, preview,
download intake and overview availability checks. This is the isolated candidate,
not the earlier whole-dirty-tree verification bundle.

Candidate index.html SHA-256:
`6CE2A017F271D64F3A608B2D072953544E655268AD65375F27632961E6B56D57`.
Entrypoint: `assets/index-BlSE7Wls.js`.

Rollback executable saved before closing:
`.tmp/silent-refresh-desktop-20261018/lab-inventory-before-refresh.exe`.
SHA-256: `3C78DB6C4DA0E405E18542BB5B2E1F7AE9CF2520ED27E16F61B338B0D87288BE`.
User-authorized close issued from the observed Dashboard (no edit dialog); process
exit confirmed before native output replacement. Native compile and actual-window
verification are recorded in the following completion checkpoint.

### Deployment completion checkpoint

The first native compile was interrupted during the pause before producing a new
executable. Retry using the installed stable Rust compiler completed successfully
in 1m03s. The updated executable at
`desktop/src-tauri/target/debug/lab-inventory.exe` was built October 18 at 13:30:49,
size 24,743,424 bytes, SHA-256:
`7E53B6CB03AAA2BCB9D37F2BEE1C2F47ADB5AA21FBE44D4EE1DE5E712AF6BDE0`.

Primary launched that executable and inspected the actual native Dashboard.
Saved local data loaded, and the new static `Local snapshot.` notice was visible,
confirming the updated frontend is running. Resources navigation encountered a
desktop-control coordinate-geometry error; this is not evidence of an app failure.
No claim is made of full no-blink acceptance across online refresh cycles.

Docker's Linux-engine named pipe was unavailable after the pause: Docker is now
stopped/unavailable, unlike the earlier restored-health checkpoint. The desktop
was left open using local data. No API deployment, migration, database reset,
manual SQLite repair or authentication automation was performed.

Keep the isolated candidate directory and its runtime junction until the next
reviewed native build: debug DOCX runtime resolution uses the compile-time
manifest directory. The rollback executable remains available. Online unchanged
refresh, actual-change/access-revocation, and cold-media acceptance remain open.
