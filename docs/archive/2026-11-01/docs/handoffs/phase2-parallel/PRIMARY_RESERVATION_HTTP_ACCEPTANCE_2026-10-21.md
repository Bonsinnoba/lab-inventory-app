# Reserved consumption — deployed HTTP acceptance

Identity / role: primary agent, not helper work.

MODULE: Inventory/reservation consumption and reconnect (B1/B3/B4).

FILE: `backend/src/reservation-client-fixture.mjs`;
`desktop/src-tauri/src/inventory_custody_persistence_test.rs`.

CURRENT WRITE PATH: Production native transaction on isolated disk SQLite ->
real deployed HTTP `/sync/push` with authenticated fixture token -> existing
PostgreSQL -> real project/item reads -> native inventory merge and allocation
projection. No in-memory server handler substitution in this test.

WHY IT BYPASSES OFFLINE-FIRST: It does not. This test verifies the implemented
local-first path across the deployed transport boundary.

RISK: Lost acknowledgements or replayed snapshots could debit stock/allocation
twice. Test fixtures must never delete or overwrite working records.

RECOMMENDED CHANGE: Verify an actual outage, disk reopen, lost-ACK replay and
snapshot convergence, with uniquely owned disposable records and guarded cleanup.

ACTUAL CHANGE MADE: Added an opt-in native integration test and UUID-named fixture
creator/cleanup. Fixture script is streamed into the existing container; it is
not an application endpoint. API is stopped for the local consumption transaction
and restarted before sync. A missing local acknowledgement is simulated, identical
outbox payload replayed, and project/stock snapshots applied repeatedly. Fixture
cleanup checks its dedicated owner identity and names before removing records.

VERIFICATION: `inventory_reserved_consumption_live_http_reconnect --ignored
--nocapture` with `LABOS_RESERVATION_LIVE=1`: **1 PASS, 0 FAIL**, 4.83 seconds.
Verified stock 10 -> 8; reservation 6 -> 4; included movement identity; one
effective debit after lost-ACK retry. Native test binary compilation, fixture
JavaScript syntax and diff checks passed. Cleanup succeeded; independent query
confirmed zero matching probe users/items/projects. API running/healthy afterward;
existing desktop process still responding. Temporary SQLite fixture removed.

STATUS: VERIFIED CLOSED for this bounded native transaction / HTTP reconnect /
lost-ACK consumption subcase. Not GUI-click acceptance, login-flow acceptance,
simultaneous independent-client contention, request/review rejection lifecycle,
or overall B1/B3/B4 closure. Test constructs an authorized cached fixture account
and uses a fixture JWT, rather than exercising interactive sign-in. Parent
checklist items remain PARTIAL. No user data reset or desktop rebuild required
for these test-only changes.
