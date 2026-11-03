# Compact sync panel read accuracy

Identity / role: LABOS-P2-PRIMARY, primary implementation.

MODULE: A1/B4 sync status/conflict display.

FILE: desktop/src/components/SyncStatus.tsx;
desktop/src/api/sync-conflict-client.ts and test.

CURRENT WRITE PATH: No new write path. Existing native conflict resolution and
normal synchronization remain authoritative.

WHY IT BYPASSES OFFLINE-FIRST: No bypass added. Previous status helpers swallowed
SQLite/IPC failures as zero counts. Multiple sequential reads and older refreshes
could overwrite the panel with stale information.

RISK: Reporting a clear queue when its state is unknown; showing stale conflict
details across account changes; late resolution callbacks affecting a new view.

RECOMMENDED CHANGE: Read counts once, reject malformed/failed responses, gate
display callbacks by request and session, clear on authentication events.

ACTUAL CHANGE MADE: Strict queue-count adapter with signed-in and returned-session
checks; compact panel uses shared request-lifetime gate and parallel count/conflict
reads. Failures show unavailable rather than zero/no conflicts. Account events
clear records and close the popup. Resolution/retry continuations check session.
Legacy count helpers elsewhere and global persisted sync-runtime status are NOT
changed or certified account-isolated by this batch. The database-status command
itself is unchanged; renderer fencing is not a replacement for native authority.

VERIFICATION: TypeScript and Vite production build (2260 modules) PASS. Initial
planned Docker stop failed because Docker was not running. After starting Docker,
the API container was confirmed stopped and all 18 focused mocked adapter/gate/
render checks were rerun successfully. Existing PostgreSQL/API containers then
started; API/database/storage health passed. This is confirmed stopped-API test
execution, not real desktop/IPC two-login acceptance. Diff whitespace check PASS.

STATUS: Coordinated frontend/native build passed and rebuilt desktop launched
October 23 after saved-edit approval. Includes the previously source-only recovery
index and full conflict-page lifetime guards. Native build retained the existing
unused resolve_conflict helper warning. Existing API image unchanged; no migration.
Integrated desktop/two-login interaction checks remain pending. No A1/B4 closure.
