# Primary — salvage release correctness

Identity: primary implementation/review agent. This is a bounded B2 correction,
not completion of the offline salvage architecture.

MODULE: Inventory salvage inspection/release

FILES: `backend/src/routes/items.js`, `backend/src/salvage-release.js`,
`backend/src/salvage-release-live-probe.mjs`.

CURRENT WRITE PATH: existing desktop HTTP functions -> permissioned HTTP routes
-> PostgreSQL. Release now delegates to one transaction-owned service. Desktop
salvage does not yet have a native repository/outbox reader/writer.

WHY IT BYPASSES OFFLINE-FIRST: unchanged and still open. This batch repairs stock
and valuation correctness before duplicating behavior into native intentions.

RISK / ACTUAL CHANGE MADE:

- Invalid new item type `part` replaced with valid component type; equipment
  returns preserve the source type when available.
- Existing item balance is locked/read; stock and movement carry actual before
  and after quantities. PostgreSQL performs quantity arithmetic.
- Repeating release of an already released recovery returns its current record
  without a second credit or movement. Recovery row lock serializes that state.
- Scrap clears destination metadata and never creates stock or a receive event.
- Release rejects unapproved/uninspected/unusable material, retired destinations,
  mismatched known units, and damaged material directed into usable stock.
- Reviewed recovery value stays on the recovery; it is no longer mapped into
  replacement cost or a fabricated zero purchase cost. No cash entry is made.
- Inspection UPDATE now excludes released rows atomically, protecting against
  inspection overwriting a release after the earlier read. Numeric valuation
  must be finite. Incoming recovery quantities must fit the schema's positive
  three-decimal range.
- All release changes remain in the route's transaction; ledger failure rolls
  back the inventory change.

VERIFICATION: actual development PostgreSQL rollback probe passed existing/new
stock, true balances, sequential repeat, separate valuation, scrap, quarantine,
condition/unit guards and injected ledger failure. Syntax/whitespace checks
passed. Follow-up retired destination and stale scrap destination checks PASS.
All test records and movements are verified absent after rollback. No personal
data reset and no V1 writes.

STATUS: source implemented, not deployed. Live simultaneous committed release/
inspection races and HTTP permission tests remain separate from this service
probe. Native salvage intentions, stable create/inspect retries, source custody/
consumption links, over-recovery prevention and quantity settlement remain code
obligations. Release idempotence by recovery identity does not prevent two
distinct recoveries claiming the same source quantity. Do not mark B2 closed.
