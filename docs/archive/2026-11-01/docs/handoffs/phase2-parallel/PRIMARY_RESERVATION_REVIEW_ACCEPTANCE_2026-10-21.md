# Reservation review and rejected-intent retry acceptance

Identity / role: primary agent; not helper work.

MODULE: Reservation requests, review, release and conflict retry (B1/B3/B4).

FILE: `desktop/src-tauri/src/local_db.rs` and
`desktop/src-tauri/src/inventory_custody_persistence_test.rs`.

CURRENT WRITE PATH: Native disk SQLite intention/outbox -> deployed HTTP sync ->
existing PostgreSQL -> authoritative reservation pull. Offline approvals remain
intentions, not confirmed allocations.

WHY IT BYPASSES OFFLINE-FIRST: No write fallback was introduced. The defect was
that the shared conflict permission handler did not recognize project_reservation,
so preserved rejected intentions could not be retried.

RISK: Users could become stuck after a temporary allocation conflict. Allowing
retry without checking current project access and role could requeue privileged
work after a downgrade. Sync acknowledgements must not grant stock authority.

RECOMMENDED CHANGE: Support reservation conflict reads/retries with current cached
project access, lease/permissions and request/review role checks. Keep the original
change ID and payload; the server revalidates authority and allocation capacity.

ACTUAL CHANGE MADE: Added reservation-specific conflict permission handling.
Requests require owner/lead/admin and inventory-view access; decisions require
admin. Added a downgrade regression and extended the existing opt-in deployed
HTTP test through offline request, offline approval, rejection for insufficient
unallocated stock, unused allocation release and unchanged approval retry.

VERIFICATION:
- First live run failed at conflict retry with Unsupported conflict domain.
- After the fix, the complete native/HTTP lifecycle passed: 1 PASS, 0 FAIL,
  33.30 seconds. Includes previous consumption/lost-ACK checks, duplicate request
  and approval replay, unchanged retry payload and no local confirmation from ACK
  alone. Stock remains 8 after reservation review/release; consumption alone
  reduced it from 10. API was stopped for each offline save.
- Complete native inventory filter with API stopped: 38 PASS, 0 FAIL, 2 ignored
  opt-in live tests. The extended live test was run separately above.
- Locked offline test compilation and diff whitespace check passed.
- Guarded cleanup completed; independent PostgreSQL query found zero matching
  fixture users/items/projects. API restored running/healthy. Existing data was
  not reset or replaced.

STATUS: VERIFIED CLOSED for the bounded native/HTTP request-review/rejected-retry
subcase in tested source. Native production executable has NOT been rebuilt with
the conflict-handler fix; include it in the next coordinated desktop build.
This is not GUI interaction, interactive login, multi-client contention or whole
B1/B3/B4 acceptance. Fixture authentication is constructed and project snapshots
are stored by the test harness; full desktop pull orchestration is not certified
by this test. Parent checklist states remain PARTIAL.
