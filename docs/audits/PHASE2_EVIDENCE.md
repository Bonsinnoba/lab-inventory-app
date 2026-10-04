# Phase 2 implementation evidence

Status: **in progress, not Phase 2 sign-off**. Existing application and seeded
PostgreSQL are preserved. Tests create scoped fixtures; no database reset.

## Completed implementation slices (2026-10-04)

### DOCX execution boundary (audit finding 33)

- Replaced `html-to-docx` 1.8.0 (including its bundled vulnerable image parser)
  with pinned `@turbodocx/html-to-docx` 1.23.1. The installed runtime and lockfile
  no longer contain the `image-size` dependency. Docker `npm ci --omit=dev`
  reports zero vulnerabilities at this checkpoint.
- Conversion runs in a separate Node process with a 128 MiB V8 heap limit,
  15-second wall-clock deadline, at most two active conversions, 4 MiB HTML
  input and 16 MiB output. This is not a claim of an OS-level memory sandbox.
- Reconstructed allowlisted HTML only: embedded PNG/JPEG/GIF images, bounded
  image count/bytes, forbidden SVG/executable/external-resource elements,
  constrained styles. Remote image URLs are explicitly rejected, not silently
  downloaded or dropped. No timeout/limit comes from the request.
- Five executed tests pass on Windows independently and in the actual Linux
  API image: heading/text/table/link/image fidelity; malformed/unsupported
  image input; network-spy rejection of remote and entity-encoded URLs; size
  limits; stuck-worker termination, overload and recovery.
- A full *parallel Windows* run timed out on one valid conversion under host
  contention (54/55 passed). Serial rerun is recorded below when complete;
  the timeout is not disabled. Image fidelity in desktop GUI remains Phase 3.

### Maintenance local-first vertical slice

- Additive PostgreSQL migration keeps existing IDs, adds `updated_at`, integer
  `sync_version`, nullable historical `created_by`, update-version and delete
  tombstone triggers (including item-cascade deletion).
- Desktop CRUD is one immediate SQLite transaction for read/permission checks,
  local state and account-stamped immutable outbox event. UUIDs normalize at
  entry. No direct HTTP write on local failure or null response.
- Stable versions plus predecessor change IDs protect multiple queued edits.
  Sync queue ties now use insertion order. Server checks dependencies, parent,
  version and current permissions; authenticated identity supplies authorship.
  Effects, required maintenance audit and sync idempotency commit together.
- Complete pull reconciles deletions without a bounded tombstone tail,
  preserves pending intents and pending deletes, and refuses incomplete
  snapshots/account switches. Maintenance is included in the local operations
  overview rather than always displaying an empty maintenance queue.
- Browser maintenance uses the same server apply function, an explicit UUID
  `Idempotency-Key`, stable record ID and expected version. The browser retains
  uncertain request identity until it decodes a response. API callers must
  now provide these fields; old unversioned writes are deliberately rejected.
- Concurrent conflicts do not auto-overwrite. Accept-server explicitly discards
  the pending chain for that maintenance record; UI explains this. Permission
  retries retain the original intent. Rejected payloads remain in the outbox.
- Three Rust unit tests pass: atomic rollback, ownership/dependencies,
  snapshots/pending deletion, permission/account checks, dates and UUIDs.
- Three executed TypeScript API tests pass: rejected/null IPC for all mutations
  issues zero HTTP writes; lost browser response reuses identity and key.
- Actual PostgreSQL probe passes: parallel identical requests, payload mismatch,
  authored sequential edits, stale edit/dependency rejection, immutable parent,
  date checks, revoked edit rights, HTTP replay/version checks, delete replay,
  no deleted-ID resurrection, item-cascade tombstone and disabled-user rejection.
- Actual two-client test passes using production Rust mutation/merge code and
  **two disk-backed SQLite clients** talking to the running PostgreSQL API:
  offline create/update, close/reopen, identical replay, second-client repeated
  pull, simultaneous edits/conflict preservation and delete/replay/reconciliation.
  Exact temporary client directories and test maintenance are removed; normal
  audit/idempotency/tombstones remain for the disk-client probe.
- Migration rerun on the actual PostgreSQL service skipped already-applied
  migrations cleanly. No seed rows were replaced.

## Commands for reproduction

```powershell
# backend
node --test --test-concurrency=1 src/middleware/*.test.js src/routes/*.test.js src/context-evidence.test.js src/docx-converter.test.js
# desktop
node --test src/api/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
# desktop/src-tauri
cargo test --no-default-features
# explicit opt-in, set local API URL and test account credentials first
cargo test --no-default-features postgres_two_client_maintenance -- --ignored --nocapture
# repository root, deployed image containing this probe
docker exec -e LABOS_PHASE2_MAINTENANCE_PROBE=1 labos-labos-api-1 node src/phase2-maintenance-live-probe.mjs
```

## Still open within Phase 2

Hybrid per-account notifications/device music preferences; supplier/storage and
remaining inventory/project/finance/import/purchase paths; binary resource
staging, editor copies and media-job reconciliation; comments and notification
read state; online-authoritative operation retries; legacy export/recovery and
remaining account/file isolation and revoked-pending-work recovery. Finish each
audited operation and its failure/two-client verification before phase sign-off.

Phase 3 UI/installer/restore/CI/owner acceptance remains separate. A green slice
must not be presented as completion of either whole phase.
