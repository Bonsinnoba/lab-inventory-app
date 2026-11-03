# V1 acceptance continuation — October 25, 2026

Identity: LABOS-P2-PRIMARY. Controlled owner-lab pilot; NOT release sign-off.

## Passed checks

- SQLite read-only inspection confirmed zero pending outbox entries. All six
  original events have completed through normal sync; no manual ACK or purge.
- Fresh consistent backup at `C:\Users\balik\LabOS-Backups\v1-pilot-20261025`:
  saved desktop closed, API stopped, owner confirmed no other writers. API
  restarted after capture. PostgreSQL and both file stores preserved.
- Backup verifier: 66 manifest files, 362,229,896 bytes; hashes match. SQLite
  integrity OK, zero foreign-key violations, 75 events, zero pending. Four ready
  authored files and seven ready replicas match size/hash. Backup is confidential,
  access-controlled, NOT encrypted or off-device recovery proof.
- Fresh dump restored into `labos-v1-restore-check-20261025`, network none,
  tmpfs database, no live mounts/ports. pg_restore single-transaction with
  exit-on-error succeeded: 6 projects, 50 items, 8 resources, 86 receipts.
- Actual native `existing_desktop_download_snapshot_is_readable` passed against
  current SQLite with API stopped (read-only). Existing October 24 test binary;
  no subsequent native reader changes claimed/tested by this result.
- Actual desktop cold-start with API stopped restored the authorized session and
  populated dashboard: 3 active projects, 18 overdue tasks, 5 low-stock items.
- Downloads offline populated saved settings, three completed jobs and PC-copy
  status. Resources offline populated eight entries; good image and media
  thumbnails appeared after local decoding. No writes exercised in these checks.

## Failures / follow-through (collect before grouped fixes)

1. **Release blocker: create-after-delete resurrection.** Resource
   `ac7046e8-a331-4199-af71-0f0564add409` (zero bytes) was deleted in original
   intent, but its delete was acknowledged before the failed create retried.
   Delete receipt `31fa27da-d2aa-468d-83ba-21b9636b7d3e` was acknowledged locally
   at 13:19:01; create `3a4ad987-d599-4c62-a499-7e2719033f8e` at 13:30:28.
   Server now contains that zero-byte resource and no tombstone. The create fix
   exposed pre-existing ordering behavior: deleting a server-absent resource
   returns success, but a later create is not guarded by that deletion receipt.
   Do not equate an empty queue with correct final state. Repair authorization
   requested for this exact resource; no corrective deletion yet performed.
2. Download tool snapshot reports yt-dlp version command failure (2/3 tools).
   Verify live worker/tool health after Docker startup; snapshot is not proof of
   current failure. Existing media playback does not prove new downloads work.
3. Playback not signed off. At resumed session the MP4 viewer showed end time
   3:09/3:09, but primary did not observe playback progression; user input
   interrupted the replay attempt. Do not mark PASS based on end-time alone.
4. Remaining: independent core inventory/project/finance operations; offline
   writes/restart/reconnect and conflict paths; full app recovery/key portability
   and off-device backup. No source changes made by this acceptance batch yet.

At 20:47 UTC Docker engine was no longer reachable after session interruption.
Docker Desktop startup requested. Restore service health before calling reconnect
verified. Never reset live data to satisfy a release gate.

## Evening independent checks

- Docker recovered; existing `labos-db-1` and `labos-labos-api-1` started, preserving
  all volumes. API/database/storage health OK at 20:51:14 UTC.
- Deployed `project-lifecycle-live-probe.mjs`: 23 checks PASS on real PostgreSQL,
  all fixtures rolled back. No migration run (probe migration input SELECT 1).
  Covers recorded financial/scientific history, custody, reservation release,
  lifecycle revision conflicts, archive/reopen, and unchanged physical quantities.
- Deployed `custody-sync-live-probe.mjs`: 29 checks PASS, zero failures, rollback
  verified on real PostgreSQL. Uses real push handlers with nested savepoints,
  not HTTP/auth middleware. Covers partial returns/transfers, immutable receipts,
  failed-receipt atomicity, canonical task/experiment/BOM demand, cross-project
  links, reservations/consumption and lifecycle/history protection. No migrations
  applied (marker plus SELECT 1). pg emitted a concurrent-query deprecation
  warning; test passed, but this is not a claim of compatibility with pg v9.
- Live `/usr/local/bin/yt-dlp --version` returned `2026.08.19`. Earlier 2/3 tool
  snapshot is not reproduced as a current executable failure. External download
  completion remains a separate end-to-end check.
- Disposable restore container stopped after verification. No live containers or
  storage removed. Desktop remains open. Playback action was interrupted by user
  input; do not automate against stale screenshot coordinates or claim PASS.

Decision unchanged: release blocked by proven resource resurrection; no corrective
deletion or ordering patch made in this acceptance batch. Remaining independent
UI/transport/recovery checks are not closed by these 52 PostgreSQL checks.

## Recovery artifacts

- SQLite verification copy: `C:\Users\balik\LabOS-Backups\v1-restore-check-20261025`.
- Retained dump in live DB container:
  `/tmp/labos-pilot-935200d4dcc941a9a9baed4e942bb12a.dump`.
- Backup captures the resurrected resource too, permitting forensic review.
- Do not delete these artifacts or copy confidential configuration into Git.
