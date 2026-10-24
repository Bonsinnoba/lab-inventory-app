# Conflict account/session boundary

Identity / role: LABOS-P2-PRIMARY.

MODULE: A1/B4 conflict inspection and explicit recovery resolution.

FILE: desktop/src/api/sync-conflict-client.ts and test; api/sync.ts;
src-tauri/src/local_db.rs; SyncStatus.tsx; SyncConflictsPage.tsx.

CURRENT WRITE PATH: Renderer conflict read/resolution -> native SQLite transaction.

WHY IT BYPASSES OFFLINE-FIRST: No transport bypass, but previously the read could
return old-account data after an account switch, and commands did not specify the
account intended by the requesting UI.

RISK: Late conflict response disclosure or misleading resolution success under
another session. Global/page-level account-switch display lifetime is a separate
remaining acceptance obligation; these guards do not certify all rendered state.

RECOMMENDED CHANGE: Capture account/session, bind native commands to the expected
account, reject late responses and recheck mutation identity inside the transaction.

ACTUAL CHANGE MADE: Dedicated adapter binds expectedAccountId for both commands;
signed-out calls fail before IPC, changed sessions reject results, native failures
do not fall back to HTTP. Native list checks expected account before/after reading;
resolution checks it under the immediate transaction. Failed conflict refreshes
clear displayed conflict arrays. Existing native payload redaction is unchanged.

VERIFICATION: TypeScript and native test build PASS. With actual Docker API stopped,
11 adapter/presentation tests and 9 native local_db tests PASS. API restored and
health endpoint API/database/storage OK. Native tests include expected-account
mismatch with no retirement/recovery writes. Adapter checks model session switches;
they are not two-login desktop acceptance. Diff whitespace checks PASS.

STATUS: IMPLEMENTED — AWAITING DEPLOYMENT/INTEGRATED VERIFICATION. UI and native
commands must ship together (expectedAccountId is required). Existing desktop
executable launched on owner request, PID 9792, confirmed responding; it is the
October 21 build and does NOT contain this source batch. No working data reset,
production binary replacement or migration. Recovery listing/export still open.
