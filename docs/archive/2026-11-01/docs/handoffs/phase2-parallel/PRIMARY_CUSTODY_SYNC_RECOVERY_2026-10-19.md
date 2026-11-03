# Primary custody sync replay and rejection recovery — October 19, 2026

Identity: LABOS-P2-PRIMARY. Continuation of PRIMARY_CUSTODY_REPAIR_2026-10-19.md;
not a helper report and not whole-B1 or Phase 2 acceptance.

## Server receipt/rejection verification

MODULE: B1 movement sync, receipt identity, transaction failure and replay.

FILE: `backend/src/custody-sync-live-probe.mjs`; exercises current source from
`routes/sync.js`, `inventory-sync.js`, `inventory-apply.js` and custody migration.

CURRENT WRITE PATH: actual push handler -> permission check -> receipt ownership/
payload check -> version/dependency validation -> stock/custody mutation -> audit
and idempotency receipt in the same transaction.

WHY IT BYPASSES OFFLINE-FIRST: no new bypass found in this tested path. Previous
raw-apply evidence did not test receipt replay or the sync handler transaction.

RISK: a lost reply could duplicate stock; a failed receipt write could leave an
applied movement without a durable acknowledgement; rejected dependencies could
leave partial settlement effects.

RECOMMENDED CHANGE: verify the production handler against existing PostgreSQL,
including failed transaction and replay; do not replace it with another writer.

ACTUAL CHANGE MADE: added a rollback-only probe. Production server code unchanged
in this follow-up. Sources load in memory; deployed files stay untouched. The real
route's BEGIN/COMMIT/ROLLBACK are mapped to nested savepoints on a real PostgreSQL
connection inside one outer transaction. Real SQL, constraints, version triggers,
audit and receipt logic run. Fixture users have non-login hashes and random IDs.
Only the exact custody DDL section is used; unrelated canonical-demand ALTERs are
not applied. An injected error at receipt insertion tests the handler's rollback.

VERIFICATION: **5 PASS, 0 FAIL**, rollback verified for users, item, receipts and
original custody table presence. Cases:

1. Replayed issue: one stock debit, custody row, movement and audit entry.
2. Chained return/transfer: predecessor receipts honored; replay changes nothing.
3. Changed payload, foreign device or foreign user cannot reuse the receipt.
4. Missing predecessor and excessive settlement leave no receipt/partial effects.
5. Receipt-write failure rolls back all domain/audit effects; identical retry
   succeeds once, and its replay is a no-op.

Limits: request/response transport and upstream authentication middleware are NOT
exercised. User context is supplied directly to the real handler. This is sequential
handler-level replay, NOT parallel HTTP/multi-device acceptance, real network ACK
loss or a deployed desktop-to-server round trip. Permission revocation mid-request
is not covered. Existing native/renderer checks remain separate evidence.

STATUS: handler-level replay/rejection transaction subcheck verified; deployment,
HTTP/native integration and concurrency acceptance remain open.

## Local rejection resolution without losing authored work

MODULE: B1 connected inventory/custody rejection resolution; A2 preservation.

FILE: `desktop/src-tauri/src/inventory_sync_state.rs`, `local_db.rs`,
`inventory_custody_persistence_test.rs`.

CURRENT WRITE PATH: explicit Accept server/Dismiss retires the connected pending
inventory chain in a local transaction. Previously it left optimistic custody
balances active until a future refresh.

WHY IT BYPASSES OFFLINE-FIRST: not a transport bypass; local state could remain a
rejected projection with no pending event protecting/explaining it, then be used
as the basis for another stock operation.

RISK: stale custody settlement or new stock edits after rejecting their basis;
loss of visible recovery context once the unresolved-conflict list clears.

RECOMMENDED CHANGE: retain the authored chain and recovery context, invalidate its
active custody projection, and require server reconciliation before further writes.

ACTUAL CHANGE MADE: within existing resolution transaction, archive affected item
and custody JSON, owner, reason and connected change IDs in an account-scoped
`inventory_recovery_<uuid>` state entry. Original outbox payloads remain unchanged
and retained, but explicitly retired chains stop uploading. Remove only affected
active custody rows/completeness markers. Persist per-item reconciliation markers;
shared native version stamping refuses further writes against marked items. An
authorized server item/tombstone merge clears its marker. Wrong-account pulls
cannot clear it. Archive/write failure rolls the resolution back. No new network
fallback, automatic retry with fresh IDs, overwrite, ownership reassignment or
automatic recovery-package pruning.

VERIFICATION: native inventory batch **24 PASS, 0 FAIL, 1 IGNORED**, with Docker
API and PostgreSQL confirmed stopped. Includes prior 21 passes plus three on-disk
tests: immutable rejected retry/overwrite refusal; connected issue/return archival,
reopen persistence, write block, wrong-account pull refusal and authorized rebase;
injected archive failure retaining pending/conflicted work and active projections.
Renderer receipt batch **3 PASS** (missing/duplicate ACK, independent failures,
session switch). The ignored opt-in PostgreSQL two-client native test is not counted
as passing; the separate real PostgreSQL handler probe is described above.
Related native local DB regression batch **4 PASS**; local workbook import batch
**3 PASS**, including permission, stale-account and atomic outbox failure checks.

STATUS: local preservation/reconciliation write barrier implemented and targeted
tests passed, not deployed. Recovery data is retained in SQLite; a user-facing
recovery browser/export, retention policy, per-item reconciliation display and
full native/network round trip remain unfinished. The last item snapshot remains
readable until refreshed; the write barrier prevents using it as a new write base.
This does not close A2 or B1. Project/reservation/serial integration remains open.

## Runtime and preservation record

Both existing containers were found stopped (exit 0); the first probe did not run.
Started those existing containers temporarily, ran the rollback-only PostgreSQL
probe, then restored both to stopped before native offline tests. No production
image replacement, permanent migration, stock edits, broad seeding or database
reset. Running desktop not restarted/replaced. Temporary SQLite test databases
contain only generated fixtures; their test-owned files are removed after checks.
