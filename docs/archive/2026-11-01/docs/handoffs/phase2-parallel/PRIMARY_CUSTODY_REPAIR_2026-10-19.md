# Primary custody repair — October 19, 2026

Identity: LABOS-P2-PRIMARY. Continues the interrupted October 18 repair of helper
review H1-1/H1-2. This is primary-authored review/fix evidence, not a helper report.
Delivery ID B1 remains PARTIAL. No whole Phase 2 or custody workflow sign-off.
Baseline inspected: `0c841fde962d37415ba1e846b0ba3adef629c51e`.

## Desktop custody intent and quantities

MODULE: physical issue, partial settlement and recipient transfer.

FILE: `desktop/src/api/items.ts`, `local-inventory.ts`,
`desktop/src/components/InventoryMovementPanel.tsx`,
`desktop/src-tauri/src/local_inventory.rs`, `inventory_custody.rs`, `main.rs`.

CURRENT WRITE PATH: previously the renderer's older movement adapter omitted
custody fields, applied storeroom consumption arithmetic to issued units, and
required a destination location even for transfers between recipients.

WHY IT BYPASSES OFFLINE-FIRST: outbox payload did not preserve the user's intent;
adding server custody tables alone could not establish local custody or balances.

RISK: missing custody, double stock debit, rejected transfers, and silent behavior
differences between newer frontend and older native builds.

RECOMMENDED CHANGE: dedicated native custody transaction, authoritative local
quantity validation, stable identities, account/permission checks and one outbox.

ACTUAL CHANGE MADE: custody intents use `save_local_inventory_custody_movement`.
Ordinary storeroom movement path remains separate. Missing native command fails
without HTTP fallback. The command checks the captured inventory base/account and
inventory.view/adjust_stock permissions, reads current custody within an immediate
transaction, derives quantities using thousandths, writes the item/movement/
custody projection and authored outbox event atomically. Recipient must exist in
the account's cached active directory; linked projects require cached access.
Checkout subtracts stock once; return credits only returned units; consume,
damage, loss and recipient transfer do not subtract stock again or move the
storeroom's location. New custody and settlement IDs derive from movement IDs;
duplicate local custody identities reject. Outbox predecessor/version stamping is
preserved. Pending custody-related movements prevent remote custody cache refresh
from overwriting optimistic balances. Old generic native writer refuses custody
fields instead of ignoring them. UI requires a checkout recipient and sends the
actual settlement type.

VERIFICATION: native pure-model tests cover issue, partial return, all settlement
types, serial unit quantities, three-decimal arithmetic, canonical IDs and
invalid/excessive settlements. Renderer tests confirm full DTO propagation to the
dedicated command, captured account, native receipt, unsupported-command/missing-
snapshot/account-switch failure without HTTP fallback. The follow-up below adds
on-disk SQLite failure injection and connection-reopen evidence. Account-revocation
races, conflict discard/reconciliation and deployed desktop cold restart/reconnect
acceptance have NOT been run for this new command.

STATUS: targeted custody command implemented; integrated verification pending.
This is not full B1 completion. Canonical demand/reservation effects, relationship
validation across tasks/experiments, full serial lifecycle and fine-grained stock
handler coverage remain part of the existing B1/B3/B4 work.

## Server movement/custody transaction ordering

MODULE: PostgreSQL issue/settlement apply.

FILE: `backend/src/inventory-apply.js`; `backend/src/custody-live-probe.mjs`.

CURRENT WRITE PATH: existing inventory HTTP/sync transaction and idempotency
receipt call the common movement apply function. Previous helper implementation
inserted custody/settlement rows before their referenced stock movement.

WHY IT BYPASSES OFFLINE-FIRST: server ordering/validation defect, not a new write
transport. Proper outbox delivery still failed immediate foreign keys.

RISK: rejected issues/transfers/settlements; unknown settlement kinds defaulting
to consumption; transferred custody clearing storeroom location; rounding errors.

RECOMMENDED CHANGE: validate/lock first, insert movement before dependent rows,
retain immediate foreign keys and caller transaction/receipt, validate quantity
and transition semantics, and use stable identities.

ACTUAL CHANGE MADE: deferred dependent INSERTs until after movement INSERT;
explicit numeric SQL casts for partial settlement; thousandths for custody
balances; valid transition/recipient/serial/range checks; active-recipient row
lock; UUID normalization; stable new custody and settlement IDs. Old explicit
consume+damage/loss/transfer payloads retain their stated meaning, not an unknown
default. Recipient transfer preserves storeroom stock/location. Existing generic
checkout without a recipient retains legacy semantics; new custody UI requires
one. Existing receipt/transaction authorization wrappers are unchanged.

VERIFICATION: real existing PostgreSQL, not SQLite substitution. The proposed
custody-table DDL and random fixtures ran inside one transaction with bounded lock
and statement timeouts; all were rolled back. The old source reproduced SQLSTATE
23503; revised issue succeeded. First full run exposed SQLSTATE 42P08 in the
settlement numeric parameter; fixed and reran the whole batch with per-check
savepoints and dependency blocking. Final run: 8 PASS, 0 FAIL, rollback verified.
Tests include partial return, consumption, transfer, invalid/excessive settlement,
inactive/missing recipient rejection, fractional serial rejection, decimal zero,
legacy damage semantics and duplicate movement rejection. Raw SQL apply is tested;
this is NOT new middleware, receipt-replay or concurrency acceptance evidence.

STATUS: H1-2 targeted ordering/numeric defect repaired and verified on PostgreSQL;
awaiting coordinated deployment and broader B1 integration acceptance.

## Check/deployment record

- Earlier inspection was blocked by approval usage limit; no alternate privileged
  route was attempted. Retried after owner continuation on October 19.
- Docker initially starting/restarting, then existing API and DB healthy. Read-only
  inspection confirmed custody tables absent before testing. They remain absent
  after rollback: no permanent migration or API replacement occurred.
- Probe source is supplied in memory to the existing API container. `source` is
  current inventory-apply.js, `baseline` is the above commit's file, `migration`
  is 20261017_item_custody_and_canonical_demand.sql, `script` is custody-live-probe.mjs.
  The probe imports the deployed DB/reservation helper but does not replace files.
  Only the migration's custody DDL section is exercised; B3 ALTERs are not tested.
- Initial probe import-path harness error happened before DB connection; corrected
  the absolute module URL, without changing assertions or bypassing constraints.
- Desktop Node batch: **55 PASS** with actual `labos-labos-api-1` stopped and state
  confirmed false. API restarted in finally; API and PostgreSQL subsequently
  confirmed running/healthy. Native/HTTP doubles remain doubles; this is not UI
  offline acceptance or actual new-command SQLite persistence evidence.
- TypeScript --noEmit PASS; cargo check PASS; native pure-model test batch 4 PASS;
  backend syntax and scoped tracked diff whitespace checks PASS.
- No app restart, release executable replacement, API image deployment, permanent
  migration, data reset, broad reseed, or edits to existing user stock records.
- Still open: integrated B1 outbox server replay and rejection/reconciliation tests,
  project/reservation/custody lifecycle coupling, salvage H1-3, H1-5 lifecycle/
  finance coverage and C3 audio integration. Parent statuses are unchanged.

## Follow-up — native persistence and cache isolation

Identity: LABOS-P2-PRIMARY; native verification, not helper acceptance.

MODULE: B1 custody transaction and account-scoped custody cache.

FILE: `desktop/src-tauri/src/local_inventory.rs`,
`desktop/src-tauri/src/inventory_custody_persistence_test.rs`.

CURRENT WRITE PATH: Tauri commands delegate to connection-based cores used unchanged
by tests. Each test opens a unique real SQLite file with the production local/outbox
schema and a disposable authorization fixture.

WHY IT BYPASSES OFFLINE-FIRST: no new transport bypass found. A cache identity gap
could associate a server record with the wrong item in the local read projection.

RISK: wrong-item balances; partial stock/custody commits without an outbox event.

RECOMMENDED CHANGE: exercise the real transaction, not only arithmetic/mocked IPC;
validate record/item identity during atomic cache replacement.

ACTUAL CHANGE MADE: extracted connection cores without changing command signatures
or adding fallbacks. Cache rejects wrong-item IDs, duplicate record IDs and existing
identities bound to another item; normalizes record/item UUIDs. Invalid responses
roll back the replacement and retain earlier records.

VERIFICATION:

- Initial full persistence batch: 3 PASS, 3 FAIL. One real defect: foreign-item cache
  acceptance. Two harness mistakes: checking actor_id instead of performed_by, and
  using an authorization-enforcing read to inspect an expired fixture. Corrected
  harness inspection without weakening the production lease check; fixed the cache;
  expanded and reran the whole native inventory batch.
- Final `cargo test ... inventory -- --nocapture`: **21 PASS, 0 FAIL, 1 IGNORED**.
  Includes eight new persistence tests and four custody arithmetic tests. Ignored:
  older opt-in live PostgreSQL/two-client test; not claimed as passing acceptance.
- Actual `labos-labos-api-1` stopped (confirmed false) for both runs. PostgreSQL
  stayed running. API restored in finally; API and DB subsequently confirmed healthy.
  SQLite tests verify the desktop engine, not a substitute server database.
- Cases: committed issue/partial return after connection close/reopen; author,
  version and predecessor persistence; injected snapshot/movement/custody/outbox
  failure with durable rollback; pending-safe cache/snapshot refresh; refresh after
  explicit ACK; wrong account, stale base, missing permission, expired lease and
  missing recipient refusal; duplicate movement/outbox rejection; malformed,
  duplicate and foreign cache rollback; stale competing local connection; failed
  transfer restoring both custody records, then successful transfer without a
  second stock debit.
- This does NOT prove lost-ACK server receipt replay, multi-device concurrency,
  Tauri IPC/UI integration or conflict discard/reconciliation. Earlier real
  PostgreSQL eight-case rollback probe remains separate evidence, not rerun here.

STATUS: native transaction/cache subcheck verified; B1 **PARTIAL**, not CLOSED.
Delivery table's stale PLANNED label corrected to PARTIAL to match implementation.
No deployment, migration, app restart, database reset or user stock edit. Integrated
replay/rejection and reservation/project lifecycle coupling remain open.
