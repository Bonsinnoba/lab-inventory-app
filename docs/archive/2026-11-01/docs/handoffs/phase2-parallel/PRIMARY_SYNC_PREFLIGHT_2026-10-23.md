# Fail-closed local sync preflight

Identity / role: LABOS-P2-PRIMARY. Primary implementation.

MODULE: A1/A2 local queue preflight and legacy-owner protection.

FILE: desktop/src/api/sync.ts; sync-runtime-state.test.mjs.

CURRENT WRITE PATH: Normal native SQLite/outbox and server reconciliation remain
unchanged. Preflight reads the shared strict native-status adapter before reading
pending events or starting transfers/push/pulls.

WHY IT BYPASSES OFFLINE-FIRST: Previous count helpers caught local-read errors and
returned zero. Preflight consequently treated an unreadable owner-status count as
proof that no unattributed changes existed and continued.

RISK: Unsafe continuation when local ownership status is unknown; false empty
queue reporting; repeated immediate retries when local storage is failing.

RECOMMENDED CHANGE: Propagate missing/malformed/failed reads. Stop sync before
pending-event reads/server work, record a session-bound error and apply backoff.
An explicit retry must repeat preflight, never bypass it.

ACTUAL CHANGE MADE: Existing exported count helpers now delegate to strict
account/session-checked reads and no longer return zero on error. Conflict count
uses the account-bound conflict list. Preflight catches local-read failures only
after verifying the original session, publishes a specific failure, schedules
retry and returns without progressing. Positive unattributed counts continue to
pause sync; no adoption, deletion or modification of those records occurs.

VERIFICATION: TypeScript PASS; 28 focused tests PASS with actual Docker API
confirmed stopped, original API restarted in finally, health API/database/storage
OK. New tests cover failed/malformed preflight, automatic backoff versus explicit
retry, positive legacy count, and error propagation through all count helpers.
The sync tests execute sync.ts with mocked native responses, not full native/HTTP
or GUI acceptance. Diff whitespace PASS.

STATUS: Source-only, to deploy with the preceding runtime-isolation batch.
No migration/data reset, no parent A1/A2 closure or full offline certification.
