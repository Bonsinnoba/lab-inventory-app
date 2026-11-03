# Primary — next salvage implementation boundary

Read-only inspection during coordinated project build. No salvage code changed
by this report; no helper work or verification PASS claimed.

MODULE: Inventory salvage, B1/B2/B6

FILE: `desktop/src/api/items.ts` salvage functions; `backend/src/routes/items.js`
salvage recovery/inspection/release routes; migration
`backend/src/migrations/20261017_item_salvage_recovery.sql`.

CURRENT WRITE PATH: desktop create/inspect/release calls API directly. No native
salvage repository or outbox branch exists in these API functions. Read also
depends on HTTP. Existing custody and inventory repositories are separate.

WHY IT BYPASSES OFFLINE-FIRST: ordinary authored recovery records and review
intentions cannot be durably saved through this path without the server.

RISK: offline work unavailable; provenance, replay and stock effects require a
connected contract before treating the existing screens as completed B2 work.
Source release inserts item type `part`, absent from the original items schema
type list. Release to an existing item records movement quantity_before=0 and
quantity_after=recovered quantity instead of the actual balance. Reviewed value
is mapped to replacement_cost and unit_cost is forced to zero, which needs
review against the approved separate-recovery-value contract. These are source
findings, not failures reproduced against the deployed schema.

RECOMMENDED CHANGE: implement one stable-ID recovery intention contract using
native snapshot/outbox, server receipts and authoritative inspection/release.
Bind recovery to source custody/consumption and explicit human attestation for
unknown legacy provenance. Quarantined material must not increase usable stock.
Release must atomically validate state/permissions/remaining source quantities,
lock inventory, capture real before/after quantities, append stock provenance,
and record separately reviewed recovery value without fictitious cash refunds.
Repeated or lost-ACK requests must not credit stock twice. Use actual PostgreSQL
for schema, permission, rollback and concurrent release verification; stop only
development API for native offline persistence checks.

ACTUAL CHANGE MADE: documentation only.

VERIFICATION: inspected current source and migration; live reproduction and
remaining migration history inspection required before implementation.

STATUS: code remaining. Coordinate with custody; do not mark B2 completed from
the existing API/forms. Current project deployment remains a separate operation.
