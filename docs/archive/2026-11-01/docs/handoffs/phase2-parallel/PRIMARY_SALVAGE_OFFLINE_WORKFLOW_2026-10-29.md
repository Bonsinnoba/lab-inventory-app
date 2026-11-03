# Primary — salvage offline workflow and inventory entry point

MODULE: B2 salvage, inspection and controlled stock release; shared A1/A3 synchronization boundaries.

FILE: `desktop/src-tauri/src/local_salvage.rs`, `desktop/src/api/items.ts`,
`desktop/src/api/sync.ts`, `desktop/src/components/SalvageRecoveryPanel.tsx`,
`desktop/src/pages/InventoryPage.tsx`, native command/conflict registration,
`backend/src/salvage-intents.js`, `backend/src/salvage-snapshot.js`,
`backend/src/routes/sync.js`, `backend/src/routes/items.js`,
`backend/src/migrations/20261029_salvage_source_movement.sql`.

CURRENT WRITE PATH: desktop -> native account/lease/permission checks -> SQLite
immutable outbox -> generic authenticated server push -> transaction containing
recovery/stock changes and idempotency receipt -> acknowledgement -> authorized
complete salvage pull. Browser retains the existing HTTP routes.

WHY IT BYPASSES OFFLINE-FIRST: previous desktop salvage adapters wrote directly
to HTTP and list reads required the server. There was no inventory recovery UI.
Native failure could not safely be treated as permission to attempt a second
server write.

RISK: repeated recovery credit, disappearing pending work, false offline approval,
restricted project disclosure, approval/release against stale inspection and
unrecoverable server-only workflows.

RECOMMENDED CHANGE: use one account-scoped native snapshot and immutable authored
intent journal; keep pending intent distinct from confirmed inspection/stock.
Recheck current permissions, project scope and expected recovery version on push.
Use existing generic transactional receipts rather than another retry transport.

ACTUAL CHANGE MADE:

- Account-scoped complete SQLite salvage snapshot survives reopening. Unknown
  initial data differs from a confirmed empty snapshot. Reads filter through
  current cached project visibility; partial/duplicate/noncanonical pulls reject.
- Create/inspect/release commands enforce current account, lease and domain
  capability. Project mutations require cached edit access. Inspection/release
  bind to the cached server version and actual cached project, not caller scope.
- Stable change/recovery IDs survive uncertain native acknowledgement retry.
  Atomic outbox insertion is the local persisted intent; a failed insert leaves
  no proposed record. Reusing an ID with a different payload rejects.
- Pending creates remain quarantined. Inspection/release requests do not pretend
  to be confirmed approval or stock. Acknowledged creates remain visible until
  a refreshed authoritative snapshot arrives. No native-error -> HTTP fallback.
- Server generic push dispatch rechecks active account, domain/project authority,
  source provenance and recovery version. Mutation and generic receipt share the
  transaction. Replays return acknowledgement, not historical private snapshots.
- Expected-version conflicts preserve authored work and require review rather
  than unrestricted keep-local retry. One outstanding action per recovery is
  deliberately enforced; inspection must synchronize before release is queued.
- Authorized snapshot endpoint shares the list's project visibility policy.
  Project-less ordinary laboratory records follow the repository's existing
  lab-wide read contract.
- Inventory now exposes a collapsible recovery section with centered native
  HTML dialogs for recording provenance, inspecting/valuing and confirming a
  release request. Permission-gated controls, account-fenced dialogs and pending
  statuses keep requests separate from accepted effects. No automatic cash credit.
- Source migration adds optional consumption reference and recovery version
  trigger without deleting existing rows or inventing historical provenance.

VERIFICATION:

- Seven frontend adapter checks PASS: native reads/filters, missing snapshot,
  SQLite error, stale account, browser read compatibility, stable uncertain-ACK
  identity, cached expected version, pending-before-initial-pull and no write fallback.
- Native real disk SQLite test PASS before final validation extension: complete
  versus unknown snapshot, scope filtering, failed outbox insert rollback,
  unchanged/change-ID replay behavior, reopening, acknowledgement-before-pull
  preservation and pending inspection without false approval. Development API
  stopped for native tests. Extended validation rerun tracked below.
- Actual development PostgreSQL/authenticated HTTP probe PASS: authorized pull,
  restricted project hiding before grant/after revocation, view versus edit,
  disabled account, source/quantity/custody safeguards, quarantine, valuation,
  one-credit retry, immutable payload mismatch, stale version, receipt failure
  rollback and retry. Outer rollback cleanup explicitly verifies fixture users,
  projects, recovery/items/movements and device receipts absent. Route savepoints
  are sequential; this is not independent committed-transaction concurrency proof.
- TypeScript PASS after query typing correction. Existing authorization suite
  initially 43 PASS / 1 stale source-location assertion failure. Replaced that
  assertion with direct receipt-privacy behavior; affected suite + receipt suite
  eight PASS. This was a test-location issue, not a relaxed privacy contract.

STATUS: substantial B2 implementation; integrated desktop acceptance still open.
Development-only API/Preview coordinated builds in progress at this checkpoint.
V1 app/containers/data are excluded. No Phase 2 parent is closed by this report.

Remaining B2 boundaries: independent concurrent release acceptance; shared-source
multi-output batch semantics; richer consumption-movement selection instead of
manual movement reference; custody-linked return reconciliation rather than
bypassing unsettled issues; full offline/reconnect GUI acceptance. Legacy source
attestation cannot provide a machine-verified consumption ceiling. Browser HTTP
creation still needs its own stable retry contract if browser parity is included.

Owner: primary agent. This is not a helper's completion report.

## Final validation and deployment checkpoint

- Extended native test PASS with development API stopped: invalid approval,
  negative valuation, stale cached version and release before confirmed approval
  reject without queueing. Reopen/pending/failure-rollback matrix still PASS.
- Preview TypeScript + Vite production build PASS, 2,268 modules. Native Preview
  binary compilation is still running; no finished binary or GUI acceptance is
  claimed at this checkpoint.
- Development API image built successfully:
  `sha256:3712f9abc4a4ff29e83d956d8df004797811d9a9932bb1490aac57f1d0cb8ba8`.
  Only development API recreated. Startup applied the additive
  `20261029_salvage_source_movement` migration and started on port4000. API then
  stopped for native validation and is being restored afterward. Existing
  development PostgreSQL/storage volumes retained. No V1 mutation performed.
- Observed V1 API/database are stopped at the latest Docker inventory; this
  work issued no stop/recreate/reset command against them. Do not report their
  earlier healthy state as current or restart them as part of development work.

The first full Preview build completed at17:38:43 UTC (25,566,208 bytes).
Packaging review found the frontend development environment uses
`http://127.0.0.1:4000/api` while the native default spells loopback as localhost.
A native-only rebuild explicitly sets `LABOS_NATIVE_API_BASE` to the exact frontend
origin, reusing the verified frontend assets and the same Preview identity.
No origin equivalence exception or authorization bypass was introduced.
Restored development API health reports API/database/storage OK and container
healthy. API migration/deployment is complete; GUI acceptance remains open.

Final native-only Preview rebuild PASS (37.88s), with explicit matching
`LABOS_NATIVE_API_BASE` / `VITE_API_BASE_URL` development origin. Only the existing
unused `resolve_conflict` warning remains. The Preview package is built; it was
not launched or visually accepted during this batch. Development API remains
healthy after native offline verification. Final source whitespace check PASS.
