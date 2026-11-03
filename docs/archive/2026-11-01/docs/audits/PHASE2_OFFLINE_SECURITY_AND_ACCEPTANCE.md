# Phase 2: offline completeness, authentication and mandatory outage testing

Remaining delivery/status is tracked in
[PHASE2_DELIVERY_CHECKLIST.md](PHASE2_DELIVERY_CHECKLIST.md), approved October 13.
This document remains the detailed offline/security contract and acceptance
procedure, not a second expanding backlog. Follow the phase-end cadence below.

Owner directive: consolidate the October 9 offline/security discussion into
Phase 2. October 10 supersedes the original per-change testing cadence: batch
implementation, retaining quick build and critical safety checks, then run the
complete acceptance sweep at phase end. Collect independent failures before
batched repair and full regression; block only dependent tests unless a data-loss,
corruption or security risk requires stopping affected work. Real stopped-Docker
API desktop coverage remains required for all offline changes before sign-off.
This document is part of Phase 2, not a fourth phase. It supersedes earlier
wording that deferred all real desktop outage checks to Phase 3.

Status: planned/open unless supported by a dated PHASE2_EVIDENCE.md checkpoint.
Writing this plan does not implement or verify any of the changes below.

## Required behavior

- Every server record and server-held attached file that the account is authorized
  to access must have a synchronized PC copy, not metadata-only availability.
  Separate SQLite metadata from device file storage; replication includes
  thumbnails, attachment content and editor copies. External links alone are not
  downloaded content. Explicitly report incomplete transfers or storage failures.
- Read and work from local authorized data without requiring a server token.
  Local writes and outbox intents commit atomically with stable IDs and authorship.
- Authorized offline deletion hides/removes the local record immediately and
  persists a deletion intent for server replay; stale pulls must not resurrect it.
  File cleanup must respect other references, pending uploads and crash recovery.
- Permission-revocation eviction is local cleanup, NOT a server deletion request.
- Server execution may wait for reconnection without blocking local preparation.
  Distinguish pending intent, server acceptance and completed effect. Current
  server permissions and conflict checks still govern acceptance.
- Preserve the agreed 24-hour privileged and current 7-day ordinary offline
  leases. Missing data is unknown, not zero; local read time is not sync time.

## P2-A — Repair and harden offline identity/security first

1. Unify desktop session identity around the central account ID. Keep the local
   credential-row ID internal. Repair offline login/restoration returning a local
   ID where callers expect a central ID, and the token-removal versus
   captureAccountSession token requirement. A valid native session must authorize
   local access independently of a server JWT. Track session generation/account
   changes to discard stale asynchronous reads, writes and acknowledgements.
2. Audit every native read/mutation and secondary projection for permission,
   account ownership, project/record visibility and lease checks. Preserve author
   ownership when switching users; another account cannot submit pending work.
   Test maintenance, catalogs, comments, notifications, preferences, inventory,
   resources and composite pages, not just the first failing screen.
3. Replace renderer-asserted authority in cache_server_user/cache_server_permissions
   with native-verified server authorization (authenticated native exchange or a
   signed, account/device-bound authorization package). Bind permissions, expiry,
   credential/security version and audience; reject alteration, wrong account,
   old-version replay and unauthorized lease renewal. Do not trust a role string
   or editable localStorage as authority. Document the chosen trust design before
   implementation; signing alone does not encrypt cached data.
4. Add credential/session versioning or equivalent server revocation. The October 9
   server-only versioning slice is implemented (audit finding 36 and
   ../architecture/credential-revocation.md); the October 10 local observation
   bridge is implemented, while end-to-end desktop acceptance remains open. Password
   changes/resets must invalidate affected existing server sessions; observed
   disable/revoke decisions must update local authorization appropriately. Preserve
   pending authored work without silently approving it under a different user.
   Permission refresh, app restart and offline login must not extend a lease.
5. Harden storage: move server credentials to OS-protected storage and design
   encryption/key lifecycle for SQLite and device files, including WAL/temp,
   thumbnails, exports and backups. Document shared-Windows-user and unlocked-PC
   limitations; do not promise protection against a fully compromised OS. Decide
   key recovery, logout locking and restore behavior before migrating real data;
   present material recovery/usability tradeoffs to the owner before committing.
6. Add persistent offline login throttling/backoff and clear expired/locked/session
   states. Detect suspicious backward-clock changes without silently renewing
   access; define reauthentication recovery and clock-skew tolerance. Do not claim
   a local clock is tamper-proof. Preserve native session checks, not cosmetic UI
   gates. Review renderer content isolation/CSP and token-bearing media URLs as
   part of the same desktop credential threat model.
7. Verify cold restart, explicit logout, failed logout, offline password login,
   online-to-offline transition, expired lease, ordinary/privileged/delegated roles,
   malformed authorization, account switch during requests, changed password,
   disabled account and revoked scope. Rejected local pending work remains
   recoverable but not visible to an unauthorized account.

Current source anchors: desktop/src/api/auth.ts; desktop/src/App.tsx;
desktop/src/api/http.ts; desktop/src/api/sync.ts;
desktop/src-tauri/src/local_auth.rs; desktop/src-tauri/src/local_db.rs;
backend/src/middleware/auth.js; backend/src/routes/auth.js.

## P2-B — Complete local reads, processing and queued intentions

Use the existing common SQLite/outbox architecture and server idempotent apply;
do not add alternate direct-server fallbacks after local failure.

| Area | Remaining delivery |
| --- | --- |
| Dashboard / Operations / Lab Intelligence | Fix session guards; persist per-domain initial-download completeness, last successful sync and pending status; keep partial authorized sections usable. |
| Reports | Local reporting projection and local generation over authorized snapshots; distinguish pending/local totals from consolidated server totals. |
| Collaboration | Persist authorized activity feed; finish native-session/revocation coverage for local comments and notifications. |
| Downloads | Persist queue/history and settings; offline enqueue, quality/priority/schedule/settings edits, cancellation/removal intents; reconcile with server jobs. |
| Projects | Local review/reservation/history/context projections; queue submissions, requests and decisions where authorized, without claiming global approval or stock reservation before server acceptance; local experiment repeat/revisions; remove missing-record HTTP fallbacks. |
| Inventory | Local field/assignment history and authorized assignee directory; local inventory Excel template/export; finish missing-snapshot and movement-history session behavior. |
| Finance / purchases | Local templates, export, preview and transactional workbook imports; synchronize resulting records rather than requiring server workbook processing. |
| Resources / canvas / item pictures / search datasheets | Full file replication, local file access/manifest/editor operations, staged uploads/copies, attachment moves, deletion and resumable transfers. |
| Automation | Local due-item projection and durable run intentions; server execution remains explicit and idempotent. |
| Users / permissions / settings | Authorized cached directory and permission views; local ordinary preferences/profile intents where approved. Administrative intentions may queue, but cannot grant new effective authority offline. Password changes/resets and other sensitive credential actions remain server-confirmed; never queue plaintext passwords. |

Relevant server-only adapters are catalogued in the October 9 conversation and
finding 34. Expand the audit records with exact operation-level file/function
references, actual changes and verification as each conversion is implemented.

Download contract:

- Local queue changes survive desktop restart while the API is stopped.
- Display distinct states: pending sync, accepted/queued on server, running on
  server, completed on server, copying to PC, available on this PC, failed/conflict.
- Offline pause/cancel is a pending request, not evidence that a server job stopped.
- A cancel racing completion must reconcile without falsely claiming no output.
- Shared settings use versions/conflict handling. Replay must not duplicate jobs;
  repeated run/import requests use stable IDs and receipts.
- Completed server files/thumbnails automatically replicate to authorized PCs;
  verify content integrity, interrupted-copy resume, storage exhaustion, account
  isolation, revocation and pending deletion before marking device availability.

## P2-C — Mandatory real outage acceptance in the phase-end sweep

This is a phase-end gate covering all offline-related implementation batches.
Unit tests, mocked fetch failures, browser fixtures and native tests alone are
insufficient. Phase 3 still performs the release matrix, but does not replace
Phase 2 acceptance. Record each test as PASS, FAIL, BLOCKED (with prerequisite) or
NOT RUN; an implementation/build pass is not an acceptance pass.

1. Record the exact tested revision/dirty diff, desktop executable, active fixture
   account, affected features and current Compose service state. Use the existing
   actual PostgreSQL service with isolated, clearly named fixtures. Never reset,
   replace or broadly reseed the user's databases. Establish online baseline,
   completed snapshot/file transfer and pending count.
2. Announce the brief interruption. Inspect current jobs; do not interrupt an
   unrelated active import/download/backup without coordinating a safe window.
   Stop ONLY the LabOS API service. Leave PostgreSQL, volumes, Docker Desktop and
   the frontend dev server intact. Confirm the API is unreachable: changing
   navigator.onLine or mocking HTTP is not the required outage.
3. Exercise affected workflows in the actual Tauri desktop: existing open view,
   navigation and refresh, then close/reopen the desktop while API remains down.
   Test cached-session restore and explicit offline login for auth-related changes.
   Read synchronized records and actual device files; perform scoped permitted
   create/edit/delete/queue/settings actions and verify local persistence/outbox.
   Check denied actions and another account as applicable. No false empty success,
   hangs, duplicate rows, data leakage or dependence on React's in-memory cache.
4. For timeout/retry/cancellation or reachability changes, additionally test Docker
   API pause (hung connections), with bounded calls and guaranteed unpause. A stop
   test is still mandatory; pause is supplementary. Verify deadlines do not turn
   a late completion into a cross-account update.
5. Restore the prior service state in a finally/cleanup path even on test failure.
   Unpause if this test paused it; start it if it was running before this test.
   If already stopped before testing, preserve that state unless the owner asks
   to start it; obtain a reconnect window to finish acceptance. Verify health,
   then reconnection/push/pull and actual PostgreSQL results, file integrity,
   exact-once logical effects, delete propagation and second-client convergence
   where relevant. Pending deletions must not resurrect on refresh/restart.
6. Record commands, outage confirmation, tested actions, before/after counts,
   assertion results, relevant sanitized logs/screenshots and restoration health
   in PHASE2_EVIDENCE.md and the corresponding audit finding. Clean only exact
   test-owned fixtures safely. If desktop interaction, Docker or reconnect testing
   is unavailable, mark acceptance BLOCKED/UNVERIFIED rather than claiming a pass.

Verified Compose service names (deploy/docker-compose.yml): project labos,
API service labos-api, database service db. Example commands from repository root:

```powershell
docker compose -p labos -f deploy/docker-compose.yml ps
docker compose -p labos -f deploy/docker-compose.yml stop labos-api
# Verify API unreachable; exercise actual desktop while stopped.
# In guaranteed cleanup, if API was initially running:
docker compose -p labos -f deploy/docker-compose.yml start labos-api
Invoke-RestMethod -TimeoutSec 5 http://localhost:4000/api/health
```

Do not use `down -v`, volume removal, database deletion or an unrelated Docker
project. A documentation-only update does not require stopping the server.

## Sequence and closure

Repair session identity first; harden authorization/revocation alongside local
projection work; establish binary replication and the shared job-intent model;
then finish domain conversions and their outage/reconnect tests. Existing salvage,
audio-focus and permissioned assistant-planning additions remain in Phase 2 as
defined in PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md. Assistant generation remains
online-dependent; history/draft persistence must not be confused with generation.

Retain exactly three phases. Phase 2 cannot close with any offline operation
declared complete solely from mocked or online tests. Record unresolved security
design choices and failures explicitly; do not silently weaken permissions to
make offline demonstrations pass.
