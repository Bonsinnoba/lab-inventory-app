# Sync runtime status and retry isolation

Identity / role: LABOS-P2-PRIMARY. Primary implementation, not helper sign-off.

MODULE: A1 sync-session isolation and operational retry state.

FILE: desktop/src/api/sync-runtime-state.ts and test; desktop/src/api/sync.ts.

CURRENT WRITE PATH: Operational status/backoff only, persisted to account-keyed
localStorage v2 records. Ordinary native SQLite/outbox and server writes unchanged.

WHY IT BYPASSES OFFLINE-FIRST: No transport bypass. Previous operational status
and retry keys were installation-global; late error handlers could publish after
account switching, and an active sync promise could be returned to another login.

RISK: Cross-account error display/backoff contamination, stale same-account login
callbacks, and misleading completion from another account's in-flight run.

RECOMMENDED CHANGE: Scope operational persistence by account and updates by full
login generation/token identity. Never adopt unowned historical status into an
account. Keep one sync run at a time and reject new-login joining of an old run.

ACTUAL CHANGE MADE: Added account-keyed state store, session-checked publish/retry
schedule/clear, bounded persisted delay, corruption/storage-failure tolerance and
auth-event refresh. Tokens are used in memory for session checks, not persisted
in the status record. Old v1 status/retry records remain untouched but unread.
Sync captures its session before preflight, verifies it after the awaited legacy
queue read, and uses generation-aware session checks. Another login gets an
explicit retry-shortly error until the previous run finishes, not its promise.

VERIFICATION: TypeScript PASS. 25 focused tests PASS while Docker API was confirmed
stopped; original API restarted in finally. Tests include store restart/account
isolation, logout, stale generation, unowned legacy records, corrupt/unavailable
storage, bounded delays and actual sync.ts execution with mocked native preflight
and delayed pending-queue failure. These are not full native/HTTP/two-login GUI
acceptance. API/database/storage health and diff whitespace checks PASS.

STATUS: Source-only, awaiting the next coordinated frontend/native deployment and
integrated login/reconnect acceptance. No backend migration or data removal.
This is not encryption of localStorage, nor a complete native authorization audit.
No A1 parent closure claimed.
