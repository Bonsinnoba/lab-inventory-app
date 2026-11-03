# Primary reservation-backed custody server foundation — 2026-10-20

Identity / role: primary agent; not helper or visual-agent work.
Scope: B1/B3 server allocation-to-custody coupling. **Partial delivery**, not
offline-first reservation completion, deployment, or Phase 2 closure.

## Stock issue / matching allocation

- MODULE: inventory custody and project reservations.
- FILE: `backend/src/inventory-apply.js`.
- CURRENT WRITE PATH: existing immutable movement outbox -> sync broker ->
  inventory version/permission boundary -> transactional stock/custody writer.
- WHY IT BYPASSES OFFLINE-FIRST: the broker is not a bypass. The gap was that
  checkout protected the entire reserved-stock floor without recognizing its own
  reservation; local reservation projection/intent integration is still missing.
- RISK: legitimate reserved issues rejected; naive exclusion could consume other
  allocations or decrement inventory twice.
- RECOMMENDED CHANGE: validate identity, authority, state and quantity; atomically
  decrement only the matching allocation, create custody and fulfillment history,
  and use the existing audit/idempotency transaction.
- ACTUAL CHANGE MADE:
  - Reservation-backed movement requires checkout with a recipient, matching
    item/project, a confirmed remaining quantity and an open planning/active project.
  - Rechecks current active account, projects.edit and project editor authority.
  - Optional task/experiment/requirement references must agree within the project.
  - Quantity arithmetic uses the existing custody thousandths contract.
  - Only the matching fulfilled quantity is deducted from the reserved floor.
    Other reservations remain protected.
  - Movement precedes FK-dependent custody/fulfillment rows. The reservation
    quantity, fulfilled quantity and status update in the broker transaction.
  - Fulfillment request identity uses the movement UUID; exact outbox replay uses
    the existing receipt and does not repeat stock/custody/history/audit writes.
  - Original payload is copied before normalization; immutable receipt input stays
    unchanged. Settlement movement project comes from the stored custody record.
  - Returns restore physical stock but do not automatically reopen an allocation,
    undo consumption history or create any finance transaction.
- VERIFICATION: final **13 PASS / 0 FAIL** real PostgreSQL push-handler batch,
  including five new reservation groups plus the eight earlier custody/project
  groups. Checks cover matching/other allocations, partial/final issue, scope,
  quantity, recipient, active account/role, rollback at receipt failure and replay.
- STATUS: server implementation verified at handler/SQL boundary; native projection,
  reservation selector and full desktop acceptance remain CODE REMAINING.

## Reservation schema and direct-route compatibility

- MODULE: reservation requests, decisions and direct consumption fulfillment.
- FILE: `backend/src/routes/projects.js`;
  `backend/src/migrations/20261020_reservation_remaining_quantity.sql`.
- CURRENT WRITE PATH: existing direct HTTP APIs; not converted to offline intents.
- WHY IT BYPASSES OFFLINE-FIRST: request/review/fulfillment still require server
  connectivity. This checkpoint does not disguise them as offline capable.
- RISK: requests omitted NOT NULL original_quantity; final fulfillment attempted
  zero remaining quantity against CHECK(quantity > 0). Opposite reservation/item
  lock order could deadlock with an inventory issue.
- RECOMMENDED CHANGE: preserve original quantity, allow zero only on fulfilled
  reservations, and align lock order before integrating native intent handling.
- ACTUAL CHANGE MADE: request INSERT includes original_quantity; data-preserving
  migration permits zero only for fulfilled status; decision/fulfillment acquire
  item before reservation and recheck item identity.
- VERIFICATION: actual existing PostgreSQL constraint inspected; migration applied
  only inside rollback probe; final issue to zero passed and original constraint
  definition was verified restored afterward. Route syntax checked. Direct HTTP
  routes and true multi-client concurrency have NOT been exercised in this batch.
- STATUS: source changes; migration NOT deployed. Lock-order/live HTTP acceptance
  remains awaiting verification.

## Presentation

- MODULE: project reservations.
- FILE: `desktop/src/components/ProjectReservations.tsx`.
- CURRENT WRITE PATH: unchanged.
- WHY IT BYPASSES OFFLINE-FIRST: unchanged online-only request controls.
- RISK: labeling all fulfillment as “consumed” misrepresents issued equipment.
- RECOMMENDED CHANGE: distinguish fulfillment from physical consumption/settlement.
- ACTUAL CHANGE MADE: summary says “fulfilled”; help text explains issue versus
  consumption and retains the explicit offline-unavailable notice.
- VERIFICATION: TypeScript check; no visual/native interaction acceptance claimed.
- STATUS: source-only wording update.

## Test boundaries and operations

`backend/src/custody-sync-live-probe.mjs` now accepts `reservationMigration` alongside
route, sync, apply, migration and script source. Uses real existing PostgreSQL and
current source loaded in memory. A request/response adapter invokes the actual
push handler; nested savepoints stand in for per-change transactions inside one
outer rollback transaction. Audit implementation's default connection is redirected
into that outer transaction. No actual HTTP/auth middleware, concurrent clients,
desktop SQLite reservation flow or outage acceptance is claimed.

The first expanded batch completed 11 PASS / 1 FAIL because the test inspected
movement data in an intentionally minimal receipt. Changed the assertion to query
the stored movement, without widening receipt exposure; reran the full batch,
then added denied-authority coverage and reran all 13 successfully.

Existing API and PostgreSQL were running when inspected and remain running.
No reset, reseed, persistent test accounts, storage changes, outbox retirement,
desktop restart or deployed API replacement. Test item/user/receipt cleanup and
constraint rollback were verified. No production migration applied.

## Next bounded implementation

1. Native reservation snapshots plus account/permission-bound provisional
   allocation changes in the same SQLite transaction as custody and outbox.
2. Preserve pending/rejected work across project pulls; reconcile accepted movement
   identities before allowing an older reservation snapshot to overwrite them.
3. Wire reservation-backed checkout into the project UI without direct API fallback.
4. Test the native flow with Docker API stopped, reopen/retry, then real PostgreSQL
   reconnect and competing-allocation checks. Reservation requests/review intents,
   lifecycle release/settlement and prior direct-route parity remain in Phase 2.
