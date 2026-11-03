# Primary download deployment — October 18, 2026

Identity: LABOS-P2-PRIMARY. User reported another completed download remaining
LINK ONLY and no file in the PC storage folder. Audio integration was deferred
to investigate this concrete failure. No helper work is credited by this report.

## Finding and correction

MODULE: A6 Downloads / A4 resource replication.

FILE: `backend/src/routes/sync.js`, GET `/resources/pull`; deployment uses only
that projection correction, not the repository's unreviewed domain changes.

CURRENT WRITE PATH: external video -> server worker -> Docker storage + atomic
PostgreSQL resource/job completion -> resource metadata pull -> SQLite -> native
verified binary replication -> account-scoped PC file.

WHY IT BYPASSES OFFLINE-FIRST: deployed metadata pull omitted local_media_*.
SQLite therefore retained a link without media information; the desktop's file
replication selector never attempted this media. Server completion alone did not
mean PC availability. The source correction existed but was not deployed.

RISK: repeated apparent success with stale LINK ONLY resources and no offline
copy; unnecessary retries could waste downloads without fixing propagation.

RECOMMENDED CHANGE: deploy the canonical metadata fix narrowly, then allow normal
authorized sync and verify actual local bytes. Do not mutate SQLite manually,
invent PC-ready flags, recreate resources, reset outboxes or redownload providers.

ACTUAL CHANGE MADE:

- Started existing stopped LabOS DB/API only. Other Docker projects untouched.
- Inspected recent real PostgreSQL jobs and corresponding server files read-only.
- Copied the running image's sync.js into an ignored `.tmp/download-media-hotfix-20261018`
  deployment context and changed only the resource SELECT to include all five media
  fields. No repository-wide backend copy, new migrations or native rebuild.
- Built a derived image, syntax-checked its route, then recreated only the API
  using existing Compose volumes and the narrow image override.
- Kept the original image under `labos-api-base:download-metadata-20261018` for
  rollback. Tagged the new image both `labos-labos-api:download-metadata-20261018`
  and `labos-labos-api:latest` so ordinary no-build starts do not reuse the old bug.
- Opened the existing desktop for natural sync. It requires online sign-in due
  to an expired local lease; credentials were not entered by automation.

VERIFICATION:

- Latest job `4e965b66-d6ca-47e5-b192-87dd75b848f8`, resource
  `b1383134-c3af-4c5c-87a1-4449f11516f7`: completed October 17 21:17:11 UTC.
  Actual server file exists: 3,361,603 bytes, matching PostgreSQL job/resource size.
- Earlier FB resource `62c0386a-047f-4674-8385-8613992bd171`: 8,147,966 bytes;
  earlier YouTube resource `1bdca3f2-d362-450b-8c69-71daae732bcf`: 93,958,024 bytes.
  Both server files exist and match their recorded sizes.
- Read-only desktop SQLite before login: all three have null media filename/date;
  no copy or copy-error row for these IDs. This confirms missing metadata, not a
  recorded transfer failure. No SQL state was repaired by the diagnostic.
- Extracted the actual deployed SELECT and executed it against real PostgreSQL:
  latest resource now returns its filename and byte count. PostgreSQL bigint is
  a numeric string; the native resource DTO already accepts numeric strings.
- API and DB both healthy after deployment. Mounts unchanged:
  `labos_storage:/app/storage`, `labos_postgres:/var/lib/postgresql/data`.
- Backend resource projection/visibility tests: 6 PASS. Desktop replication and
  device-status tests: 12 PASS. These 18 checks remain unit/contract tests, not
  live PC playback acceptance.
- Desktop opened at an expired-lease login screen. Owner asked to sign in through
  the computer-use handoff; live PC copy and offline playback NOT YET VERIFIED.

STATUS: SERVER PATCH DEPLOYED / PC REPLICATION ACCEPTANCE WAITING FOR SIGN-IN.
Not A4/A6 or Phase 2 closure. Server/API are left running for reconnection.

## Deployment identity and reproduction

Original image:
`sha256:d3f18cda2f32457b6c92ebd092ba42f03ccb471cd927e5518ef0d519f2f1874a`.

Corrected running image:
`sha256:c98e503aafc4d0eaf62e0d924e5fb57066fff352920fcae18e31e7fcc84307b3`.

The derived Dockerfile is two lines: FROM the retained local base tag, COPY only
the patched sync.js into `/app/src/routes/sync.js` owned by node. The initial use
of `FROM sha256:...` was rejected by BuildKit as a registry reference; it changed
no runtime. Explicitly tagging the already-local image resolved that build issue.
The regular repository source already contains the same SELECT correction and
its regression tests. Do not rebuild the entire dirty backend merely to reproduce
this patch until the independent custody/salvage review findings are resolved.

Server and PC locations are intentionally different:

- Server: named Docker volume `labos_storage`, not the repository storage folder.
- Desktop copies: `%APPDATA%/com.lab-inventory.app/resource-copies/<account>/<resource>/<sha256>.content`.
- PC-origin staged uploads: `%APPDATA%/com.lab-inventory.app/resource-files`.
- SQLite contains metadata/status, not these large binary media files.

## Sign-in follow-up — actual PC replication and stopped-API check

Identity: LABOS-P2-PRIMARY. This supersedes the waiting-for-sign-in checkpoint
above. After owner sign-in, normal synchronization populated canonical media
metadata and produced ready, verified local copies for all three existing UUIDs.
No manual SQL repair, provider redownload or database reset was performed.

Read-only SQLite inspection showed verified_bytes equal to size_bytes, ready
state and no copy errors for these resources. All three actual PC files exist.
SHA-256 was calculated independently from actual PC and server file bytes:

| Resource | Bytes on each side | Matching SHA-256 |
| --- | ---: | --- |
| b1383134-c3af-4c5c-87a1-4449f11516f7 | 3,361,603 | e3500735e05f98e8e567f82da73df36f82d9d2ba015cc6ee3ae1dfce3ccd342e |
| 62c0386a-047f-4674-8385-8613992bd171 | 8,147,966 | 0674a7f9199ddae7e794847378d277df2efa25839f2424714ffd3fc0da13d6f7 |
| 1bdca3f2-d362-450b-8c69-71daae732bcf | 93,958,024 | c446b20e9a02908387c6e34cbc4c46271fe7f67e6fb96d7f6e71f45797bcc5dc |

Native desktop Resources displayed Local and Downloaded for all three with
thumbnails. The canonical kind remains Link to preserve source provenance; this
is not the previous LINK ONLY availability state.

Stopped only labos-labos-api-1, confirmed exited, and opened the newest video in
the native ResourceViewer. It loaded a video frame through labos-file.localhost
while the API was stopped. This verifies local viewer/file loading, not advancing
playback: Play attempts did not establish timeline progress, and subsequent
coordinate input failed because the control tool reported a 12-by-12 window.
User activity then closed the viewer; further UI interaction was not forced.

Restored the existing API and confirmed running/healthy. PostgreSQL remained
running and all data was preserved throughout.

STATUS: LIVE PC REPLICATION VERIFIED FOR THESE THREE RESOURCES; STOPPED-API
LOCAL VIEWER LOAD VERIFIED. Advancing playback, offline cold restart and
reconnect duplicate/replay acceptance remain unverified. Not whole A4/A6 or
Phase 2 closure.

## Remaining acceptance steps

1. Confirm advancing video playback and cold-start access with API stopped.
2. Confirm reconnect/replay does not duplicate jobs/resources, then restore API.
   Do not label unit tests or a loaded video frame as complete playback acceptance.

All databases, stored files and authored work preserved. No fixture data seeded.
