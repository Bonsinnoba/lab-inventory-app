# Phase 2 B2 — concurrency and consumption-source selection

Identity: primary agent. This is primary implementation/evidence, not a helper report.

## Implementation

- Added `salvage-concurrency-live-probe.mjs`, an explicitly gated development-only
  probe against the actual PostgreSQL database. Independent connections commit
  isolated UUID fixtures and use real blocking observation. Cleanup is constrained
  to those fixture identities; it does not reset the database.
- Replaced manual consumption-movement UUID entry with a guarded source picker.
  Selecting a consumption record links its project and bounds the entered source
  quantity by the original movement. The server still checks the aggregate released
  claims: original quantity is not a promise of remaining recoverable quantity.
- Desktop source reads use account/lease/permission-checked SQLite history and
  current cached project access. Missing history remains unknown, with explicit
  historical attestation available. There is no native-read HTTP fallback.
- Browser reads use a narrow authorized source-history endpoint, reloading the
  active principal and filtering linked-project visibility. No new direct desktop
  writes or stock credits were introduced.

## Verification

Actual development PostgreSQL probe PASS before Docker became unavailable:

1. Two releases of the same recovery credit stock once.
2. Competing recoveries cannot exceed the same consumed source quantity.
3. Independent recoveries to one inventory item preserve ledger balances.
4. A stale expected version is rejected after waiting for a concurrent release.
5. Disabling the actor while its release waits denies the eventual mutation.
6. An injected ledger failure rolls back the first writer; the waiting writer
   then credits stock once.
7. All committed probe fixtures are absent after scoped cleanup.

These tests exercise independent committed domain transactions. They do not prove
concurrent HTTP receipt processing or desktop reconnect acceptance.

Authenticated HTTP/PostgreSQL rollback probe PASS, including source-history
visibility before a project grant, after a view grant and after revocation. The
existing stock/source/authority/receipt matrices also passed and fixtures were
absent after rollback. An earlier invocation exited without diagnostic output;
the recorded diagnostic rerun passed (`.tmp/salvage-source-probe-20261029.log`).

Nine focused frontend adapter tests PASS, including absent/broken history and
account-switch rejection without server fallback. TypeScript check passed during
implementation; focused source whitespace check passed. Native disk-backed tests
and the combined Preview build are tracked below as results become available.

## Remaining boundaries

- Initial historical movement download still uses the existing history mechanism;
  this picker does not certify a complete lab-wide history mirror.
- Shared-source multi-output recovery batches and custody-linked return
  reconciliation still need implementation.
- Browser create retry parity, native GUI outage/reconnect and final coordinated
  deployment remain open. B2 is PARTIAL; no Phase 2 parent is closed.
- The installed V1 app, database and storage were not changed in this batch.
  Shared resource/viewer/folder/music fixes remain in V2 source.
- Docker is currently unreachable. Do not treat the development API rebuild or
  deployment as complete, or substitute source-mounted probes for deployment.

## Build checkpoint

Disk-backed native salvage test PASS (one scenario covering snapshot, outbox,
rollback, permission/account fencing, restricted-source grant/revocation and
close/reopen persistence). Development API was unavailable during this test.
The test profile compiled successfully in 2m42s; no native test failure occurred.
Combined Preview TypeScript and Vite production build PASS (Vite 1m33s). Native
Preview build PASS (1m04s; only existing unused `resolve_conflict` warning).
`desktop/src-tauri/target/debug/LabOS Preview.exe` is 25,580,544 bytes, written
22:27:44 UTC October29. Matching frontend/native development origin was explicitly
set to `http://127.0.0.1:4000/api`. This separate Preview includes the shared V1
resource/viewer/folder/music fixes. It was not installed over V1 or visually
accepted. No new migration is required for this source-picker change.
