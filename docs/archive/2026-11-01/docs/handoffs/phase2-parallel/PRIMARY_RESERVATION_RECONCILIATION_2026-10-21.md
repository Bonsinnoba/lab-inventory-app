# Reservation reconciliation and coordinated deployment

Identity: primary agent, not helper work.

MODULE: Reserved consumption / synchronization (B1/B3/B4).

FILE: `desktop/src-tauri/src/inventory_custody_persistence_test.rs`;
`backend/src/custody-sync-live-probe.mjs`.

CURRENT WRITE PATH: Native stock/allocation/movement/outbox transaction followed
by inventory sync; server project snapshots include fulfillment movement IDs.

WHY IT BYPASSES OFFLINE-FIRST: No new bypass introduced. These checks exercise
reconciliation boundaries rather than adding another write path.

RISK: ACK arriving before or after pull, restart, or repeated snapshots can cause
double deductions or restored allocation if movement inclusion is not respected.

RECOMMENDED CHANGE: Verify that server snapshot identities agree with fulfillment
history and native overlays stop deducting movements already included in it.

ACTUAL CHANGE MADE: Added disk-SQLite acceptance for ACK-before-pull and
pull-before-ACK after reopen, repeated project snapshots and inventory merges,
with one retained movement/outbox payload. Added real PostgreSQL project-pull
assertions for consumption movement identity and reservation-intention receipts.

VERIFICATION: API stopped for native batch: 37 PASS, one live-server test ignored.
Existing PostgreSQL source handler batch: 24 PASS, zero failures, outer rollback
verified. These are separate boundary checks, not one combined GUI/network test.

STATUS: User confirmed all edits saved and authorized a coordinated update.
Initial deployment attempt was not executed because approval review hit a usage
limit. After user continuation, existing API container was recreated from the new
image. PostgreSQL/storage volumes retained. API healthy; migrations
20261017_item_custody_and_canonical_demand, 20261017_item_salvage_recovery and
20261020_reservation_remaining_quantity applied successfully. Desktop build and
launch result follows in the evidence ledger. No phase parent closed; full GUI
acceptance and combined reconnect workflow remain open.

Deployment continuation: after user continuation, TypeScript and Vite production
build passed (2,256 modules). Locked offline native dev build passed in 7m03s.
Launched `desktop/src-tauri/target/debug/lab-inventory.exe`, newly built October 21
07:16 local time, against the existing app data. This is a rebuilt development
executable, not an installer replacement. Process startup is not GUI workflow
acceptance. No existing LabOS process was running when launch preparation began.
