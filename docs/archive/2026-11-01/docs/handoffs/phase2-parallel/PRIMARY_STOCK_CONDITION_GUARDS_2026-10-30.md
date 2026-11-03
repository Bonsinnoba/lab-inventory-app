# Phase 2 B1/B2/B4 — unusable stock cannot be issued

Identity: primary agent. No helper attribution or parent closure claimed.

MODULE: Inventory condition, salvage destination and reservation fulfillment.

FILE: server `stock-condition.js`, `inventory-apply.js`, `salvage-release.js`,
`salvage-custody-return.js`, `routes/projects.js`; native `inventory_sync_state.rs`,
`inventory_custody.rs`; inventory/custody native tests and salvage live probes.

CURRENT WRITE PATH: standard movement server writer and both native stock/custody
writers, plus the legacy direct HTTP reservation-fulfillment route.

WHY IT BYPASSES OFFLINE-FIRST: the paths already save locally/outbox where native,
but they did not enforce repair/damage status when issuing or consuming stock.
Positive quantity on a repair bucket could therefore become normal work stock.
An offline intent could also reach a server whose item condition had changed.

RISK: repairable salvage entering usable work before clearance, mixing usable
returns into a damaged destination and a direct-route escape from the shared
movement writer. Rejecting every custody action would create another error by
preventing damage/loss/consumption settlement of units already physically issued.

RECOMMENDED CHANGE: enforce stored current item status at the stock mutation
boundary. Preserve ordinary allowed statuses and existing issued-unit settlement.
Reservation confirmation already rejects unavailable stock; retain that rule.

ACTUAL CHANGE MADE:

- Shared server policy allows new issue/consumption for `available`, `low_stock`
  and the existing `in_use` status. Repair, damaged, replacement, retired and
  unknown statuses cannot create new checkout/consumption movements.
- Server policy is checked after locking/readback of the current item. Offline
  additive intent cannot bypass newly committed repair status.
- Native custody creation and general movement persistence check the stored
  snapshot. A renderer-supplied next snapshot claiming `available` does not
  override the current stored condition. Failure leaves snapshot/outbox unchanged.
- Existing custody settlements remain possible without another storeroom debit.
  Repair-out, loss, damage and count corrections are not silently treated as new
  usable issues. Clearing an item remains an explicit authorized status change;
  completing a maintenance note does not automatically clear it.
- Usable salvage cannot merge into damaged/repair/replacement stock. Inspected
  custody returns require a usable original destination. Damaged-repairable
  salvage still goes only to a repair bucket, which is itself non-issuable.
- Direct HTTP reservation fulfillment now enforces the same clearance rule.
  Reservation approval's existing availability check was inspected and retained.
- No schema changes, new financial transactions, V1 update or data reset.

VERIFICATION:

- Native grouped checks: 23 PASS / two explicit opt-in live tests ignored; five
  custody arithmetic/regression checks PASS. API unavailable during these native
  tests. Real SQLite rejects a forged next snapshot atomically. Pure custody
  checks preserve already-issued damage settlements and canonical quantities.
- First native run caught a wrong module path for the new helper. Moved the
  shared native helper into the existing common inventory module; rerun PASS.
  Fixtures now explicitly identify normal stock as available rather than omit
  a field required by the guarded production path.
- Actual development PostgreSQL + authenticated HTTP PASS: new repair bucket
  cannot issue/consume; unusable status cases reject; already-issued damage
  settlement leaves storeroom stock unchanged; late offline intent creates no
  movement or receipt; direct reservation fulfillment preserves its allocation.
- Independent real PostgreSQL race PASS: stock issue waiting on an item lock
  observes the newly committed `needs_repair` status, rejects and leaves stock
  unchanged. Earlier source/batch/custody/rollback races still PASS. All isolated
  committed/rollback fixtures absent after scoped cleanup.
- Source whitespace check PASS. Native test compilation PASS. No desktop input
  was attempted; the earlier geometry/screenshot tooling failure remains separate.

STATUS: condition guards implemented and tested; coordinated package results
follow below. B1/B2/B4 remain PARTIAL. A separate damaged-return repair-location
workflow and form/restart/reconnect acceptance are not completed by these guards.

## Packaging

Development API and native Preview builds PASS. Frontend source was
unchanged in this batch; reused the previously verified assets (index SHA256
`BB1E4AEC78782EBEBAE52F6C2545D9327AA75F852E7DA01A5AA2D93BC9B399C3`).
Both native/frontend development API origin stays `http://127.0.0.1:4000/api`.

Final native build PASS (1m21s; existing unused `resolve_conflict` warning only).
Frontend index hash verified unchanged afterward. Preview was not launched and
no native UI acceptance is claimed.

Packaged development API image:
`sha256:93ab9ce47549a9ce8a3c66cf70d584a56c4491cf304414b72c24d2b7f879cfa2`.
HTTP and independent PostgreSQL race matrices PASS from the packaged image without
source mounts. Recreated only development API, preserving existing volumes.
Final API health returned HTTP200, API/database/storage OK at03:59:19 UTC on
October30. Preview artifact is25,617,408 bytes, written03:57:08 UTC. No new
migration or V1 restart/update.
