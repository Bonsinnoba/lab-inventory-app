# Phase 2 B2 — shared-source disassembly batches

Identity / role: primary agent implementing and reviewing the batch contract.
This is not a helper completion report. B2 remains PARTIAL.

MODULE: Inventory salvage / disassembly.

FILE: `backend/src/salvage-intents.js`, `salvage-release.js`, additive migration
`20261029_salvage_source_output_batches.sql`; desktop `local_salvage.rs`,
`local_db.rs`, `api/items.ts`, `SalvageRecoveryPanel.tsx` and focused probes.

CURRENT WRITE PATH: one account-owned native SQLite outbox event with operation
`create_batch` contains stable identities for 2–25 outputs and one common source.
Generic sync applies all outputs, a batch row and its receipt in one PostgreSQL
transaction. Authoritative pull replaces pending projections. Each output then
uses the existing inspect/release intentions and version checks.

WHY IT BYPASSES OFFLINE-FIRST: the previous implementation had no batch contract;
independent output proposals each claimed source quantity, so dismantling one
assembly into different components could exhaust the source incorrectly. This
implementation adds no desktop API fallback or direct stock mutation.

RISK: double-counting a dismantled source, partial batch saves, retry duplicates,
or crediting uninspected outputs. Historical attestation cannot establish a
machine-verifiable ceiling. Concurrent releases must serialize on the original
consumption movement. Source quantities and recovered quantities can have
different units; output units do not redefine the source units.

RECOMMENDED CHANGE: one immutable common source claim per batch, atomic creation,
separate output inspection/valuation/release, ledger-backed stock and stable
idempotency. Never refund original consumption or create cash transactions.

ACTUAL CHANGE MADE:

- Added the batch table and recovery batch link without rewriting existing rows.
- First successful output release claims the batch source quantity once. Later
  output releases reuse that claim. Standalone and batch claims share the same
  aggregate consumption ceiling and row lock. Released output retries still
  return without adding stock.
- Source identity, project and quantity must match the immutable batch record.
  Outputs cannot override their common provenance. Scrap has no usable stock
  credit. Inspection/release still require current authority and expected version.
- Native batch creation writes one event atomically. Its pending projection shows
  every output as quarantined, with no fabricated approval or usable stock.
  Unknown ACK retries retain event/output identities and payload. Account, lease,
  cached project access and explicit domain permissions remain enforced.
- Added the desktop multi-output form with per-output name, quantity, unit and
  material/scrap disposition. All outputs remain individually reviewable.
- Browser batch authoring is explicitly unavailable for now; existing browser
  single-recovery paths remain. No browser-only direct-write workaround added.

VERIFICATION:

- Eleven adapter tests PASS, including uncertain ACK identity preservation and no
  HTTP fallback on batch failure. TypeScript check PASS.
- Real disk-backed SQLite scenario PASS for multi-output projection, retry,
  duplicate/mutated identities, provenance override rejection and reopen. An
  additional outbox-trigger failure assertion is included in the final build run.
  Development API was stopped during native verification.
- Actual development PostgreSQL + authenticated sync HTTP PASS: invalid late
  output rolls back all earlier outputs; receipt-insert failure rolls back batch
  and outputs; stable event retry and payload-mismatch rejection; individual
  inspection/release; scrap has no stock; standalone excess source claim denied.
- First HTTP probe failed on its assertion expecting `failed` for an invalid
  quantity. The API correctly returned `rejected` / `INVALID_QUANTITY`; corrected
  the expectation and reran the full matrix successfully.
- Real independent committed PostgreSQL transactions PASS: concurrent releases
  of two outputs each credit stock once while sharing one source claim; later
  excess claim denied. Existing single-recovery, shared-source, shared-item,
  stale-version, disabled-account and rollback concurrency cases also PASS.
  All owned fixture rows removed; rollback-only fixtures absent.
- Applied only the new additive migration to development PostgreSQL. The migration
  runner skipped all previously recorded versions. V1 DB/storage untouched.

STATUS: batch implementation and service/local verification complete; combined
API/Preview build results follow below. Native GUI/reconnect acceptance and
custody-linked return reconciliation remain. This does not close B2 or Phase 2.

## Build/deployment checkpoint

Development API image build PASS:
`sha256:d6faeb4e1e547ba312edbdbfdadd9b23b225bab60e5d231c8236a8e7d83a9be9`.
Authenticated HTTP and independent PostgreSQL concurrency probes also PASS from
the packaged image without a source mount; fixtures removed. Only development
`labos-labos-api-1` was recreated. Its image matches and health returns HTTP200,
API/database/storage OK. No V1 installation or restart performed.

Final disk-backed native run PASS including injected batch outbox failure: no
partial output projection survives the aborted save. Combined Preview build PASS:
TypeScript, Vite (1m02s), native (2m39s). Only the existing unused
`resolve_conflict` warning remains. Explicit matching frontend/native origin:
`http://127.0.0.1:4000/api`. The Preview was built, not launched or visually
accepted. Existing V1 remains unchanged.
