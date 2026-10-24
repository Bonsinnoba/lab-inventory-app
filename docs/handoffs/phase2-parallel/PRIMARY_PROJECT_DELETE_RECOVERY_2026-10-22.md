# Native rejected-project deletion recovery

Identity / role: LABOS-P2-PRIMARY; primary work, not helper acceptance.

MODULE: B4 project rejection/recovery; A2 authored-work retention.

FILE: desktop/src-tauri/src/local_db.rs.

CURRENT WRITE PATH: Local project deletion saves the complete project in its
immutable outbox payload and removes it from the visible local project snapshot.
Pending root changes block replacement by project pulls. Server rejection creates
a sync conflict; explicit resolution retires the deletion and permits a later
authorized project pull.

WHY IT BYPASSES OFFLINE-FIRST: No transport bypass. The previous generic resolver
allowed blind retries of protected history deletions and lifecycle conflicts;
retired deletion snapshots existed only in the outbox, without a recovery record.

RISK: Repeated permanent rejection and confusion about invisible projects; an
unsafe restoration from old payloads could revive obsolete access or overwrite
newer child work. A storage failure must not retire the only pending intention.

RECOMMENDED CHANGE: Block blind protected-history/lifecycle-conflict retry. Preserve
authored deletion evidence atomically before explicit retirement; await an
authorized server pull for live data rather than restoring old permissions.

ACTUAL CHANGE MADE:
- Keep local rejects PROJECT_INVENTORY_HISTORY_PROTECTED and
  PROJECT_RECORDED_HISTORY_PROTECTED deletions with archive/reconciliation advice.
- PROJECT_LIFECYCLE_CONFLICT requires review/new decision, not an automatic
  revision overwrite or identical stale retry.
- Accept server and Dismiss preserve account/device/change/project identity,
  original payload and resolution in an account-scoped recovery record within
  the same transaction that retires the deletion and resolves the conflict.
- Original outbox payload remains unchanged. Other pending child changes are not
  retired. No cached project/permissions are restored from recovery evidence.
- If recovery storage fails, the deletion and conflict both remain pending.

VERIFICATION: Native test compilation passed. Actual labos-labos-api-1 container
stopped and its running state confirmed false; all 8 local_db tests PASS, including
4 added tests covering protected retry, payload/authorship retention, account
isolation, storage-failure atomicity and disk SQLite close/reopen durability.
PostgreSQL/storage were not stopped or reset. API restarted in finally; health
endpoint confirms API/database/storage OK afterward. Diff whitespace check passed.

STATUS: IMPLEMENTED — AWAITING DEPLOYMENT AND INTEGRATED VERIFICATION for this
bounded native resolver behavior. No production binary rebuild/restart or API
deployment in this batch. These are native tests, not full GUI acceptance. Recovery
listing/export UI, dependent child reconciliation, authoritative reconnect/pull,
revocation scenarios and concurrent clients remain open. B4/A2 not closed.
