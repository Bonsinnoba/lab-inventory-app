# Native account-bound queue status

Identity / role: LABOS-P2-PRIMARY. Primary implementation.

MODULE: A1 sync queue read authority / preflight.

FILE: desktop/src-tauri/src/local_db.rs and main.rs;
desktop/src/api/sync-conflict-client.ts and related adapter/runtime tests.

CURRENT WRITE PATH: No new writes. A dedicated native command reads queue counts
from SQLite after validating expected account and active local login lease.

WHY IT BYPASSES OFFLINE-FIRST: No bypass. The former diagnostic command supplied
counts for whichever native account was active, without caller identity binding.

RISK: Renderer/native account disagreement; turning unauthenticated status into
zero counts; exposing unnecessary diagnostic metadata to ordinary queue readers.

RECOMMENDED CHANGE: Dedicated account-bound counts-only read, native validation
before and after one consistent SQL statement, no compatibility fallback.

ACTUAL CHANGE MADE: Registered get_local_sync_queue_status with required expected
account ID. Uses require_sync_account before/after read, returns four counts only.
Pending/conflict counts are scoped to that account; legacy ownerless metadata
counts remain installation-level for the existing protective pause. Renderer
passes the captured account and retains its after-response generation guard.
No HTTP or older-command fallback. Existing local_database_status protocol probes
remain unchanged; this is not a complete audit/removal of that diagnostic surface.

VERIFICATION: TypeScript and native test build PASS. With actual Docker API
confirmed stopped, 28 frontend adapter/gate/runtime tests and 12 native local_db
tests PASS. Native tests cover account mismatch, foreign-count exclusion,
acknowledged/resolved count changes, expired/disabled/signed-out rejection and
storage failures. Prior recovery/outbox tests also passed. API restored in finally,
API/database/storage health OK, diff whitespace PASS. Isolated SQLite tests are
not production-database or full desktop interaction acceptance.

STATUS: Source-only. Must deploy matching frontend/native together; not a parent
A1 closure or integrated desktop/two-login acceptance. Data preserved.
