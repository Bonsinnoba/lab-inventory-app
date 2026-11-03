# Retained project-deletion recovery index

Deployment update October 23: coordinated frontend/native build passed and desktop
launched with this command and UI. Source-only status below is historical.
Integrated desktop acceptance/export remain open. See PRIMARY_SYNC_PANEL_READS_2026-10-23.md.

Identity / role: LABOS-P2-PRIMARY.

MODULE: A2/B4 recovery visibility.

FILE: desktop/src-tauri/src/local_db.rs and main.rs;
desktop/src/api/sync-conflict-client.ts and test; SyncConflictsPage.tsx.

CURRENT WRITE PATH: No new writes. Account-bound native SQLite query joins retained
recovery keys to their owned project-delete outbox/conflict records; renderer shows
metadata independently from the unresolved-conflict list.

WHY IT BYPASSES OFFLINE-FIRST: No bypass. Recovery records were previously retained
without any user-facing indication after conflict resolution.

RISK: Exposing historical project payloads after access revocation or implying that
a retained snapshot is a live project, restorable permission grant or file backup.

RECOMMENDED CHANGE: Read-only owned metadata index first; separately authorize
payload inspection/export. Never use recovery rows to restore cached authority.

ACTUAL CHANGE MADE: Required account identity and valid local login lease; native
query returns only change ID, original timestamp, resolution timestamp/type.
No project name/ID, payload, child content or grants returned. Shows newest 50
records with explicit has-more notice; older records remain retained. Current
project read permission is not required for this restricted owned receipt metadata.
Renderer checks session before/after IPC, reports missing-command/read errors rather
than pretending the index is empty. Conflict list failure and index failure remain
independent. UI explicitly states export/restore are not yet available.

VERIFICATION: TypeScript and native test build PASS. With actual API stopped,
12 adapter/render tests PASS and 10 native local_db tests PASS, including recovery
index metadata exclusion, foreign-account/expired-lease rejection and disk reopen.
API restarted after each stopped-server batch and health endpoint confirmed
API/database/storage OK. Diff whitespace checks passed. These are native/adapter
tests, not full desktop visual/two-login acceptance.

STATUS: Source implementation, not deployed. No
recovery export, payload inspection, restoration or parent A2/B4 closure claimed.
