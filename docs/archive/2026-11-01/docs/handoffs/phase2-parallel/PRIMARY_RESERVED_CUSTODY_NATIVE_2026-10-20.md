# Primary review — native reserved-custody projection, October 20, 2026

Identity: primary implementation/review agent, not Helper 1 or Helper 2.
Scope: B1/B3 reservation-backed issues and their A1/A5 account/recovery boundaries.
Source implementation only; no native release or API deployment in this batch.

## Atomic offline issue

- MODULE: desktop inventory custody / project allocations.
- FILE: `desktop/src-tauri/src/local_inventory.rs`, `inventory_reservations.rs`,
  `inventory_custody.rs`; `desktop/src/api/local-inventory.ts`.
- CURRENT WRITE PATH: UI adapter -> native immediate SQLite transaction -> item,
  movement, custody, immutable outbox event and account-scoped allocation overlay.
- WHY IT BYPASSES OFFLINE-FIRST: the former custody path had no native reservation
  projection/validation. Reservation-only intent could also select the ordinary
  movement adapter, which did not retain that reference.
- RISK: lost reservation identity, repeated allocation while offline, or stock and
  outbox succeeding without a matching local allocation deduction.
- RECOMMENDED CHANGE: bind all effects to one transaction and fail closed on
  missing snapshot, project permission, quantity or work provenance.
- ACTUAL CHANGE MADE: canonical project/reservation/work references; leased
  account and project editor checks; planning/active project check; confirmed
  reservation/item/remaining-quantity checks; same-project task/experiment and
  canonical requirement agreement. Allocation overlays commit with custody,
  item, movement and outbox. Reservation-only intent routes to this writer and
  fails if recipient/checkout requirements are missing. No HTTP fallback.
- VERIFICATION: six new real disk SQLite tests, included in 30 passing inventory
  tests with Docker API stopped. Adapter boundary batch: 48 passing tests.
- STATUS: implemented, awaiting integrated desktop/reconnect acceptance.

## ACK, refresh and rejection reconciliation

- MODULE: project pull, native allocation reads, explicit stock conflict recovery.
- FILE: `backend/src/routes/sync.js`,
  `desktop/src-tauri/src/inventory_reservations.rs`, `inventory_sync_state.rs`,
  `local_projects.rs`.
- CURRENT WRITE PATH: authorized project pull stores server reservation snapshots;
  native reads overlay authored issues not yet represented by fulfillment IDs.
- WHY IT BYPASSES OFFLINE-FIRST: project pulls formerly omitted reservations.
  Clearing deductions on ACK alone would expose stale remaining quantities before
  the corresponding project pull arrived.
- RISK: duplicate deduction when pull precedes ACK; resurrected allocation when
  ACK precedes pull; treating explicit rejection retirement as accepted stock work.
- RECOMMENDED CHANGE: keep authored overlays independent of ACK; subtract only
  issues absent from the server snapshot's fulfillment identities. Archive before
  explicit retirement, and block stock edits until authoritative reconciliation.
- ACTUAL CHANGE MADE: one PostgreSQL statement obtains reservation quantities and
  fulfillment movement IDs from the same statement snapshot, limited to readable
  project IDs. Local overlays survive ACK/restart and do not modify the cached
  server base. Included IDs prevent double deduction. Older snapshots without ID
  proof fail closed for issue. Underflow is surfaced as a reconciliation error.
  Conflict resolution archives/removes only affected pending overlays within its
  existing transaction; original outbox payloads remain. Archive failure rolls back
  retirement. Returns do not reopen allocations or credit project expenses.
- VERIFICATION: disk reopen, compact change IDs, normalization, stale snapshot
  after ACK, pull before ACK, atomic injected failures, denied scope/permission,
  released/closed allocation, returns, underflow and rejected-work recovery.
  Real PostgreSQL handler batch: 14 PASS, including coherent pull contents.
- STATUS: bounded source behavior verified; concurrent-client/real transport and
  integrated desktop acceptance remain open. Overlays are retained, not garbage
  collected; retention must not remove evidence needed to reject stale snapshots.

## Cached reads and presentation

- MODULE: project reservations API adapter and list.
- FILE: `desktop/src/api/projects.ts`,
  `desktop/src/components/ProjectReservations.tsx`,
  `desktop/src/api/project-reservation-boundaries.test.mjs`.
- CURRENT WRITE PATH: unchanged online-only reservation request/review/direct
  consumption controls. This subcheck changes reads, not those mutation contracts.
- WHY IT BYPASSES OFFLINE-FIRST: desktop reservation reads previously always used
  HTTP even with a usable local project snapshot.
- RISK: offline list unavailable; absent snapshot confused with empty allocation;
  late account response displayed under another login.
- RECOMMENDED CHANGE: native projected reads, explicit unknown state and account
  guards, with separate implementation of remaining mutation workflows.
- ACTUAL CHANGE MADE: desktop reads use the native project projection without
  HTTP fallback; web retains its HTTP read. Missing cache, denied IPC and session
  changes fail closed. Confirmed empty arrays remain distinguishable. Reservation
  query keys include account/session generation; list errors suppress cached rows.
  Local issue deductions and reconciliation errors are labeled in the list.
- VERIFICATION: five adapter tests plus TypeScript. No new visual acceptance claim.
- STATUS: source implementation, awaiting UI acceptance. The project checkout
  dialog is NOT wired yet. Request/review/consumption controls remain online-only;
  their read-after-write cache integration is still part of that unfinished work.

## Verification and service state

- Existing PostgreSQL: **14 PASS / 0 FAIL**, current source loaded in memory.
  Real route handlers via request/response adapters, nested savepoints inside a
  rollback-only transaction. Fixture rows and constraint rollback verified. This
  does not exercise HTTP/auth middleware or independent concurrent connections.
- Docker API explicitly stopped; database left running. Native inventory batch:
  **30 PASS / 0 FAIL / 1 IGNORED**. The ignored opt-in two-client API integration
  probe was not run and is not counted as verified.
- Native project tests: **4 PASS**; local DB regression tests: **4 PASS**, also
  with API stopped. New reservation tests use actual temporary on-disk SQLite
  databases and production transaction code, not PostgreSQL substitutes.
- Adapter tests: **48 PASS** (43 inventory + 5 reservation reads).
- TypeScript, backend syntax and tracked diff whitespace checks passed. Git emitted
  line-ending notices, not whitespace errors.
- API restored after offline tests. No app restart, deployment, permanent
  migration, database reset, reseed, user outbox deletion or storage deletion.
  Test fixtures are rollback-only or uniquely owned temporary SQLite files.

## Remaining bounded work / handoff

1. Wire reservation-backed checkout UI with recipient, quantity, optional serial
   and canonical project/work references through the native writer.
2. Convert reservation request/review/direct-consumption intents and reconcile
   their local read-after-write state; preserve original IDs and audit history.
3. Complete lifecycle release/settlement and broader project demand integration.
4. Deploy compatible API/native source together only at the coordinated boundary,
   then real desktop outage/reconnect/cold-start and competing-allocation checks.
5. Retain all other fixed Phase 2 obligations. This slice does not close B1/B3.

IDs changed: B1/B3, supporting A1/A5. Full implementation-ready: **0/18**;
closed: **0/18** under the existing remaining-work checklist. No owner decision
blocker was introduced. Integrated acceptance depends on compatible deployment
and the unfinished UI/intents above, not permission to delete existing work.
