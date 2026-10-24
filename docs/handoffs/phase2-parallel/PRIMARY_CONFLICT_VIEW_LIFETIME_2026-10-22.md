# Conflict/recovery view request lifetime

Deployment update October 23: coordinated frontend/native build passed and desktop
launched with these guards. Source-only status below is historical. Integrated
desktop acceptance remains open. See PRIMARY_SYNC_PANEL_READS_2026-10-23.md.

Identity / role: LABOS-P2-PRIMARY. Primary implementation, not helper acceptance.

MODULE: A1/B4 conflict and retained recovery display.

FILE: desktop/src/api/account-read-gate.ts and its test;
desktop/src/pages/SyncConflictsPage.tsx.

CURRENT WRITE PATH: Existing account-bound native conflict resolution remains
unchanged. This batch only controls renderer request lifetime and display state.

WHY IT BYPASSES OFFLINE-FIRST: No transport bypass. Previously a late refresh
could replace newer display state; already-rendered records were not explicitly
cleared by this page on user-update/authentication-expiry events.

RISK: Stale conflict/recovery display, old failure callbacks clearing newer data,
or a resolution continuation emitting success/refresh after account switching.

RECOMMENDED CHANGE: Latest-request and account-session guards, cleanup on unmount,
clear on authentication events, independent concurrent reads, guarded resolution
continuations. Do not broaden recovery payload disclosure.

ACTUAL CHANGE MADE: Added a per-view read gate invalidated by subsequent reads
and unmount. Both list success/failure/finalizer callbacks check it. The page
clears records on user-update and auth-expiry, reloading only for a signed-in
user. Resolution checks session after each awaited stage before subsequent
sync/UI effects. Existing native authorization remains authoritative.

VERIFICATION: TypeScript check PASS. 15 focused gate/adapter/render tests PASS with actual Docker API
confirmed stopped; API restored in finally and health confirmed API/database/
storage OK. These tests use mocked adapter/session boundaries, not a desktop
two-login interaction or real IPC acceptance. Diff whitespace check PASS.

STATUS: Source-only, alongside the undeployed recovery index. Desktop restart,
integrated two-login checks, recovery payload inspection/export and broader A1/B4
acceptance remain open. No database or file contents modified by this batch.
