# Primary — project save dates, persistence and reservation rule parity

Owner: primary implementation/review agent.

## Actual changes

Project edit forms now normalize server date/timestamp strings into calendar
dates accepted by HTML date fields. No device-timezone conversion is applied,
so a written date does not shift to the previous day. Both initial form creation
and post-refresh initialization use the same helper. Budget zero and lifecycle
revision are preserved. The earlier header Save repair remains in place.

The native `update_local_project` command delegates its unchanged production
write path to a connection-based helper, enabling direct testing of the actual
update, snapshot transaction and outbox insertion with a disk database.

## Verification

- 50 frontend tests PASS: date form behavior, account changes, local-only review
  reads, unknown data, overlap calculations, project/reservation boundaries and
  related existing regressions. TypeScript compilation exit 0.
- 17 native project tests PASS with development API explicitly stopped. New test
  inserts a failure trigger on the outbox: the update fails and the old project
  description remains. After removing the trigger, an actual update persists;
  closing/reopening SQLite retains authored text, original start/due dates,
  unchanged lifecycle revision and exactly one event with before/after payloads.
  This test uses disposable on-disk SQLite, not the personal database.
- Authenticated production reservation-review route PASS on real development
  PostgreSQL: reusable assets count only overlapping confirmed commitments;
  consumables count confirmed commitments across time windows and projects.
  Confirmed rows stay outside the review queue and physical stock is unchanged.
  Probe uses an ephemeral loopback listener and rollback-only fixtures. All
  fixture users/projects/items/reservations confirmed absent after rollback.
  Initial fixture run failed because current schema requires original_quantity;
  fixture corrected, rollback absence verified on both runs, final exit 0.
- `git diff --check` PASS.

Probe: `backend/src/reservation-review-http-live-probe.mjs`, explicitly gated
by `LABOS_DEV_REVIEW_PROBE=rollback-only`. Uses actual authentication and project
router against development PostgreSQL, without modifying production code or V1.

## Remaining boundaries

The SQLite test verifies production persistence and reopen, not successful GUI
interaction or an actual desktop restart. The PostgreSQL probe validates read
allocation rules, not concurrent review decisions or dropped-ack reconciliation.
The newest date and queue frontend changes still need a coordinated Preview
build and GUI verification. No phase parent item is closed by this batch.
Development API restarted after offline tests; V1 was untouched.
