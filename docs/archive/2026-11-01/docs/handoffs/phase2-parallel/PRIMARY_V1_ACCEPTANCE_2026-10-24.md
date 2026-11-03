# V1 acceptance batch — resources/downloads/sync, October 24

Identity: LABOS-P2-PRIMARY. Candidate identity and build hashes are recorded in
PRIMARY_V1_CANDIDATE_2026-10-24.md. This is partial acceptance, not release sign-off.

## Results

| Check | Result | Evidence / boundary |
| --- | --- | --- |
| Actual PostgreSQL download probe | PASS | Deployed candidate phase2-downloads-live-probe.mjs: settings versions/dependencies, scheduled enqueue/deduplication, controls, stale-control rejection, late-completion semantics. Settings/jobs rolled back; generated fixture account/resource cleaned up by exact IDs. No real media fetched. |
| Existing completed server jobs | PASS | Read-only join: all 3 completed jobs have resource media paths, existing server files and matching recorded sizes. This does not prove their copies exist on the PC or their bytes match a prior hash. |
| Frontend adapter/presentation regressions | PASS, 147 | download*, resource*, component download*, sync receipts/runtime/conflicts, account-read gate, offline auth, overview availability. Actual API stopped and its stopped state confirmed during the batch. Adapters use mocks; not a live desktop transport test. |
| Native resource regressions | PASS, 40 | local_resource filter: attachment chains, authority, confirmation, replication presentation, UUID merge and parent validation. Actual API stopped. |
| Native download regressions | PASS, 7 | local_downloads ordinary cases; 2 opt-in existing-DB tests skipped in this ordinary run. Actual API stopped. |
| Native database regressions | PASS, 12 | local_db: ownership, immutable retry, conflict/recovery, persistent reopen and snapshot protections. Actual API stopped. |
| Actual desktop SQLite offline reader | BLOCKED prerequisite; test exits 101 | Explicit read-only opt-in test against the existing com.lab-inventory.app/labos-local.db refused with: No authorized local account is active. Sign in again before syncing. No authorization bypass or database edits attempted. Not proof of a cache defect or successful cache read. |
| Deployed server regressions | PASS, 49 | download-worker-state, download-queue-http, resource-binaries, resource-confirmation, resource-authority, resource-upload-staging, sync-receipts, routes/sync-resource-media. Isolated fixtures, not real media acquisition. |
| API recovery | PASS | API restarted in finally after both outage batches. Final health reports API/database/storage OK. |

Native test executable: lab_inventory-b7c57ecec0694c05.exe, built October 24
before the candidate app build. No native source changed between those builds.
Repeated frontend run was for concise result capture; 147 is the unique batch
count, not the sum of repeated runs. Total focused regressions: 255 passes;
real-PostgreSQL scenario probe counted separately.

## Required follow-through

1. Establish a valid desktop login using the normal app flow, then repeat the
   real SQLite read probe with the API stopped. Do not fabricate cached grants.
2. Verify the three server-completed media files' current PC replicas and local
   playback with the server stopped. Metadata/server completion alone is not
   sufficient evidence.
3. Exercise real desktop upload, link scheduling, native outbox -> PostgreSQL
   -> confirmation -> pull, including restart, lost response and conflict paths.
4. Complete independent core inventory/project/finance acceptance and recovery
   gates in V1_LAB_PILOT_RELEASE.md. No gate is closed by unit counts alone.

No application code fix was made in this batch. Existing records/storage were
not reset or reseeded. User pending work was not manually acknowledged, cleared,
or rewritten. The running app may perform its ordinary background synchronization.
