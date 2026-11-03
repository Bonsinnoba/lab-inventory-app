# Native reservation intentions — primary agent

Identity: primary implementation/review agent, not either helper.

MODULE: Project reservations / reserved custody (B1/B3/B4).

FILE: `desktop/src-tauri/src/local_reservations.rs`, `local_projects.rs`,
`inventory_custody_persistence_test.rs`; `desktop/src/components/ProjectReservations.tsx`;
`desktop/src/api/project-reservation-boundaries.test.mjs`.

CURRENT WRITE PATH: Desktop request/review adapters call the native intention
transaction, storing the account-scoped projection and immutable outbox payload
together. Server receipts in subsequent project snapshots reconcile the display.
The browser retains its HTTP path. Consumable fulfillment remains separate and open.

WHY IT BYPASSES OFFLINE-FIRST: Request/review adapters no longer bypass it. This
checkpoint verifies the previously added native path and fixes its compile and
recovery gaps; it does not certify all reservation workflows.

RISK: A queued approval must never authorize physical stock issue. ACK alone must
not erase a pending intention. Explicitly retiring a rejected review must not
unlock old cached allocation authority. UI controls alone are not enforcement.

RECOMMENDED CHANGE: Keep intentions distinct from allocation authority, enforce
pending/recovery blocks natively, retain rejected authorship, and clear a recovery
block only with a newly applied authoritative reservation snapshot.

ACTUAL CHANGE MADE:
- Updated request/review explanatory text and disabled review, release and
  consumption controls while the native projection reports an unresolved issue.
- Added account-scoped reconciliation blocks when retiring review conflicts;
  original intentions are archived and outbox payloads retained.
- Project pull clears those blocks in the same transaction as its cached snapshot,
  only for incoming reservations with receipt protocol support. Pending project
  roots skipped by pull cannot clear a block.
- Replaced an undeclared date-library use with SQLite date parsing and UTC timestamps.
- Added on-disk SQLite tests for request persistence across ACK/reopen, no premature
  stock authority, pending release issue blocking, duplicate review blocking,
  outbox-failure rollback, and rejected-review preservation/blocking.
- Added adapter tests proving native request/review paths do not fall back to HTTP.

VERIFICATION: With Docker API confirmed stopped: 53 adapter tests, TypeScript,
34 native inventory tests and 4 project regression tests passed. One live-server
inventory test was deliberately ignored in the offline batch. First native compile
exposed an undeclared date dependency; corrected before the passing rerun. Restored
the existing API and reran the real PostgreSQL sync-handler probe: 20 passed, zero
failed, outer rollback verified. Handler probe excludes transport/auth middleware
and independent simultaneous clients. Recovery-block clearing is implemented in
the project pull transaction, but its complete live UI lifecycle still needs
acceptance testing. No production data was reset or replaced.

STATUS: Source changes, not deployed. Live desktop interaction, complete server
round-trip acceptance, consumable fulfillment parity and wider Phase 2 acceptance
remain open. No parent checklist item is closed by this checkpoint.
