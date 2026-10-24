# Reserved consumable fulfillment — server checkpoint

Identity / role: Primary agent; implementation and verification, not helper work.

MODULE: Inventory movements / project reservation fulfillment (B1/B3/B4).

FILE: `backend/src/inventory-apply.js`, `backend/src/custody-sync-live-probe.mjs`.

CURRENT WRITE PATH: Desktop `fulfillProjectReservation` still calls the legacy
HTTP fulfillment endpoint. This checkpoint adds the matching server sync contract;
it does not switch desktop writes yet.

WHY IT BYPASSES OFFLINE-FIRST: The existing desktop fulfillment adapter has not
yet been moved to the native atomic stock/allocation/outbox writer.

RISK: Direct consumption must not create fictitious custody, consume returnable
equipment, debit stock twice on retry, or consume another confirmed allocation.

RECOMMENDED CHANGE: Reuse the inventory sync broker's version checks, immutable
receipts, authorization and atomic reservation fulfillment history. Then extend
the native transaction and desktop adapter with the same explicit operation.

ACTUAL CHANGE MADE: Sync accepts explicit `consume` against a matching confirmed
reservation for non-returnable inventory. It rejects equipment/instrument/tool
consumption, recipient/serial ambiguity, and invalid remaining quantities. Stock
arithmetic uses thousandths; stock, reservation quantity, fulfillment history,
audit and receipt remain in the broker transaction. No custody record is created.
Existing checkout and settlement paths are preserved.

VERIFICATION: Complete real existing PostgreSQL handler probe: 23 PASS, 0 FAIL,
outer rollback verified. Three added checks cover consumption/replay/no custody,
receipt-write rollback, excessive quantity and returnable-item rejection. Initial
fixture assertion incorrectly expected no version change after deliberate item
type edits; fixture isolated with a savepoint, then full batch rerun successfully.
Syntax checks and diff whitespace check passed. Probe uses real handlers with a
request adapter, not HTTP/authentication middleware or simultaneous clients.

STATUS: Server source only, not deployed. Desktop/native consumption integration,
stable submission identity, stopped-API acceptance and live round-trip remain
open. API remained running for the PostgreSQL checks; no offline claim is made
for this server-only checkpoint. No data reset, restart or phase closure.
