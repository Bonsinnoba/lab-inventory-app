# Reserved consumable fulfillment — native checkpoint

Identity: primary agent, not helper work.

MODULE: Reservation fulfillment / inventory (B1/B3/B4).

FILE: `desktop/src/api/projects.ts`, `items.ts`, `local-inventory.ts`,
`desktop/src-tauri/src/inventory_custody.rs`, `inventory_reservations.rs`,
`inventory_custody_persistence_test.rs`, `desktop/src/components/ProjectReservations.tsx`,
`desktop/src/api/project-reservation-boundaries.test.mjs`.

CURRENT WRITE PATH: Desktop fulfillment validates the account and reservation,
then invokes the native inventory transaction through createItemMovement.
Stock, allocation overlay, movement and outbox commit together. Browser HTTP
fulfillment remains unchanged. Native errors do not authorize HTTP fallback.

WHY IT BYPASSES OFFLINE-FIRST: The desktop fulfillment HTTP bypass is removed in
source by this checkpoint; deployed binaries are not updated yet.

RISK: Double consumption after an uncertain response, consumption of returnable
equipment, partial writes, and premature reuse of an allocation after ACK.

RECOMMENDED CHANGE: Reuse the stock transaction and reservation overlays, keep the
submission identity stable, and distinguish direct consumption from custody.

ACTUAL CHANGE MADE: Native transaction supports explicit reservation consumption
without a recipient/custody record; rejects equipment, instrument, tool and unknown
item type. Existing project access, pending-review, quantity and snapshot checks
remain enforced natively. Adapter preserves requestId as movement identity.
Duplicate saved movement IDs fail without another debit (not a replay-success
receipt); callers must inspect saved history after an uncertain response. UI
allocation text now describes both local issue and consumption deductions.

VERIFICATION: With Docker API confirmed stopped, 36 native inventory tests passed,
one live-server test was excluded. New disk-SQLite tests cover partial deduction,
reopen, duplicate submission, no custody creation, equipment rejection and outbox
failure rollback. 54 adapter tests passed, including no HTTP fallback and stable
submission identity. Diff and TypeScript checks passed. API restored and healthy
after the offline batch, no data reset.

STATUS: Source implementation, not deployed. Full native-to-server reconnect and
GUI acceptance remain open. Prior server contract independently passed 23 real
PostgreSQL checks; this is not a combined end-to-end claim. Parent checklist
closure unchanged. Old server/new desktop deployment must be coordinated.
