# Project inventory history protection

Identity / role: primary agent, not helper work.

MODULE: B4 project lifecycle; B1 custody provenance.

FILE: `backend/src/project-lifecycle.js`, `backend/src/routes/projects.js`,
`backend/src/routes/sync.js`, `backend/src/project-lifecycle-live-probe.mjs`,
`backend/src/custody-sync-live-probe.mjs`.

CURRENT WRITE PATH: Desktop deletion intention reaches transactional sync apply;
browser deletion uses the existing transactional project DELETE route. Both now
call the same guard after locking the project and before deleting anything.

WHY IT BYPASSES OFFLINE-FIRST: No new bypass. The defect is destructive lifecycle
behavior: custody project references use ON DELETE SET NULL, losing provenance.
Fulfillment references can instead cause opaque database errors. Explicitly
rejecting deletion preserves history and returns a meaningful conflict code.

RISK: Outstanding and settled custody, unreserved movements and reservation
fulfillment history must remain associated with their originating project.

RECOMMENDED CHANGE: Refuse deletion of projects with inventory history; preserve
them while cancellation, archive and settlement workflows are completed.

ACTUAL CHANGE MADE: Shared PROJECT_INVENTORY_HISTORY_PROTECTED (409) guard for any
project custody, stock movement or reservation fulfillment. Browser error response
preserves the conflict code. Sync rejection occurs before tombstones or successful
receipts. No stock adjustment, history deletion, schema migration or deployment.
Extended source-in-memory probe supports loading the current helper without
overwriting the deployed API.

VERIFICATION: Existing PostgreSQL, rollback-only fixtures: 6 focused checks PASS
(empty project allowed; outstanding custody; settled custody; unreserved movements;
fulfillment without custody/project-linked movement; no stock effects). Initial
fixture omitted mandatory movement quantity_before/after; corrected and full
focused batch rerun. Full real sync-handler batch: 25 PASS, 0 FAIL, rollback
verified, including protected deletion with no tombstone or success receipt.
JavaScript syntax and diff checks passed. No working data reset or replacement.
The handler harness bypasses HTTP/auth middleware. PostgreSQL emitted a query
concurrency deprecation warning from the existing harness; not a test failure.

STATUS: IMPLEMENTED, source-level PostgreSQL checks passed; deployment and browser/
native end-to-end acceptance pending. Does not certify deletion of projects with
other history (finance/results), child-record deletion, archive support, lifecycle
revision fencing, cancellation propagation, settlement computation or concurrent
multi-client races. These remain B4 work. Native deletion can still queue an
intention later rejected by the server; local conflict presentation/recovery must
be included in desktop acceptance. No B4 parent closure claimed.
