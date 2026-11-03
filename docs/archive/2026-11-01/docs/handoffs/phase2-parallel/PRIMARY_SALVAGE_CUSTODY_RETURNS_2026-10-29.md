# Phase 2 B1/B2 — inspected custody returns

Identity / role: primary agent. Primary implementation and evidence, not helper
completion. No Phase 2 parent is closed by this checkpoint.

MODULE: Salvage returns / quantity-aware inventory custody.

FILE: `backend/src/salvage-custody-return.js`, `salvage-intents.js`,
`salvage-release.js`, `routes/items.js`, additive
`20261029_salvage_source_return_custody.sql`; desktop `local_salvage.rs`, shared
custody reader in `local_inventory.rs`, command registration, `api/items.ts`,
`SalvageRecoveryPanel.tsx`; existing salvage HTTP/concurrency/adapter probes.

CURRENT WRITE PATH: desktop saves a custody-linked quarantined recovery as one
immutable SQLite outbox intention. Generic server sync derives its original
item/project/unit from custody and creates the record transactionally. Inspection
and release retain their existing versioned intentions. Confirmed release reuses
the canonical inventory mutation/return writer to create the stock movement,
custody settlement and audit in the same transaction as the recovery state and
outer sync receipt. Authorized snapshots return the confirmed result.

WHY IT BYPASSES OFFLINE-FIRST: previous salvage return proposals had no custody
link and were blocked when issued units remained outstanding. Crediting stock
separately would leave the holder owing the same quantity and allow a later
ordinary return to credit it again. This change adds no desktop server fallback.

RISK: double return, settling the wrong holder, source quantity/unit changes,
partial rollback, serialized fractions and deadlocks with existing return writers.

RECOMMENDED CHANGE: preserve the issued identity and provenance; quarantine until
inspection; settle only the selected holder/quantity at release; reuse canonical
return accounting and lock ordering; preserve unsuccessful authored work.

ACTUAL CHANGE MADE:

- Added optional recovery source-custody and confirmed-settlement foreign keys.
  Existing records are preserved. Only development received this migration.
- Added an account/lease/permission/project-filtered native custody source reader.
  Missing cache remains unknown; there is no HTTP fallback. Local requests cannot
  combine custody with consumption or a disassembly batch, change original units
  or project, exceed cached outstanding quantity, or split a serialized unit.
- The form selects cached outstanding custody for equipment/unused-stock returns.
  Quantity and unit stay tied to the selected issue. A pending request leaves
  storeroom stock and the holder's outstanding quantity unchanged.
- Server creation derives and checks the actual source. Release rechecks live
  authority, identity, condition and remaining custody. It follows the canonical
  inventory advisory lock -> item -> custody order and uses the recovery UUID as
  the stable return-movement/settlement UUID.
- Usable return goes to the original active usable item; stock credits exactly
  once while custody becomes partially settled or settled. An explicit settlement
  link and canonical inventory audit preserve traceability. Receipt/ledger/audit
  failure rolls back the entire operation.
- Unlinked salvage cannot bypass outstanding custody. Historical consumption,
  reviewed salvage valuation, project expenses and cash remain unchanged.
- Browser authoring of this new link is explicitly unsupported; the old direct
  browser route rejects the new field rather than silently dropping provenance.

VERIFICATION:

- 13 focused adapter checks PASS, including cached source reads, linked payload,
  account switching and no fallback. TypeScript check PASS.
- Real disk-backed SQLite scenario PASS with development API stopped: hidden
  project custody filtered, excess/mixed claims denied, stable retry, quarantined
  projection and original outstanding balance unchanged. Existing batch/source/
  reopen/rollback checks still PASS.
- Actual development PostgreSQL + authenticated sync HTTP PASS: quarantine and
  inspection have no balance effect; release restores original stock and settles
  the holder once; repeat receipt adds no movement; receipt-insert failure rolls
  back movement, custody, stock, settlement and recovery. Canonical audit present.
- Partial returns preserve outstanding balances and transition through
  `partially_settled` to `settled`; exhausted custody and fractional serialized
  returns reject. Damaged material cannot credit usable stock. All rollback
  fixtures absent after the probe.
- Independent real PostgreSQL race PASS: inspected return vs ordinary canonical
  return serializes without deadlock, one stock credit and one settlement. Existing
  disassembly/source/stock/version/revocation/rollback races still PASS. All owned
  committed fixtures and their audit rows removed through scoped cleanup.
- Migration runner skipped existing recorded migrations and applied only the new
  custody-return links. Development API remained stopped during native tests.

STATUS: usable custody-return reconciliation implemented and service/local checks
PASS. Combined build/deployment results are tracked below. B1/B2 remain PARTIAL.

## Explicit boundaries

- Damaged/repairable issued units cannot become usable stock through this return.
  Their saved recovery remains for review; explicit damage/repair handling is
  required. This does not implement a separate repair-location/quarantine custody
  lifecycle or silently convert a serialized asset into a new stock identity.
- Cached history completeness, browser authoring/retry parity and native GUI
  outage/reconnect acceptance remain separate delivery boundaries.
- No V1 app, database or storage was updated or reset.

## Build / deployment

Development API image build PASS:
`sha256:778c4b1821a7efe4fd3e74fa91d6fd6a08bdaaf4f9b7f5882b20cb44e92ccaba`.
The HTTP and concurrency matrices PASS again from that packaged image without
source mounts. Only development API was recreated; health returns HTTP200 with
API/database/storage OK and its image matches. Existing data and V1 untouched.

Preview's first frontend build passed before the final form polish. Bundle
inspection caught the earlier unit expression, so a final rebuild was completed.
Final TypeScript/Vite PASS (Vite 1m06s), native Preview PASS (1m09s); only the
existing unused `resolve_conflict` warning remains. Compiled bundle confirms
selected-custody unit is preserved with `unit??null`; unrelated consumption
queries/warnings are suppressed when custody is selected. Matching frontend and
native origin explicitly set to `http://127.0.0.1:4000/api`.

The separate Preview was built, not installed over V1 or visually accepted.
Native GUI/restart/outage/reconnect acceptance remains open. The earlier report's
combined-build prerequisite is now satisfied, without changing parent closure.
