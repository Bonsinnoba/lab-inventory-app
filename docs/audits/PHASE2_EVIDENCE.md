# Phase 2 implementation evidence

Status: **in progress, not Phase 2 sign-off**. Existing application and seeded
PostgreSQL are preserved. Tests create scoped fixtures; no database reset.

## Completed implementation slices (2026-10-04)

### DOCX execution boundary (audit finding 33)

- Replaced `html-to-docx` 1.8.0 (including its bundled vulnerable image parser)
  with pinned `@turbodocx/html-to-docx` 1.23.1. The installed runtime and lockfile
  no longer contain the `image-size` dependency. Docker `npm ci --omit=dev`
  reported zero vulnerabilities on October 4; October 8 advisories and current
  remediation are recorded below. The old audit result is not current sign-off.
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
  contention (54/55 passed). The serial rerun passed 55/55, repeated on October
  8 after the dependency patch. The timeout is not disabled. Image fidelity in
  desktop GUI remains Phase 3.

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

### Hybrid daily-use preferences (October 4 implementation; October 8 verification)

- Notifications are account-scoped: immediate SQLite local write + immutable
  outbox transaction, server version/predecessor checks, authenticated ownership,
  atomic required audit + idempotency, and pending-aware pull. Conflicting stale
  edits cannot automatically overwrite newer server values.
- Music volume and auto-pause are installation/account-local. No outbox or
  server fallback for device-only changes. Existing SQLite values survive;
  legacy PostgreSQL music fields remain available for export and explicit
  browser import without overwriting current device values.
- New notifications honor the account setting through a database insertion
  gate, including automation. Existing notifications are retained. Inactive
  accounts cannot access preferences or receive new notifications.
- The first actual PostgreSQL run failed browser PATCH with `42P08` (parameter
  `$2` inferred as both text and UUID). An explicit UUID cast fixes the
  idempotency insertion. The probe then passed; this was a real error missed
  by mocked browser tests, not a cosmetic test change.
- Actual PostgreSQL probe: read-only defaults, parallel identical replay,
  stale conflict, same-value convergence, dependent intents, cross-account
  denial, real delivery suppression, HTTP replay, strict accepted fields,
  preserved legacy music and disabled-account rejection.
- **Two temporary disk-backed SQLite clients** execute production Rust
  preference mutation and pull functions against that PostgreSQL API:
  populated-state upgrade and fresh defaults; offline edits and close/reopen;
  a server-committed write whose ACK is deliberately not recorded; repeated
  identical replay; queued predecessor edits; stale conflict/pending retention;
  browser-style HTTP PATCH/replay; distinct device media; account switch;
  disabled account. ACK bookkeeping in this test is SQL, not the UI sync runner.
- Explicitly executed with `LABOS_LIVE_RESTART_API=1`: the API container restarts
  **between the committed write and lost-ACK replay**. Replay and subsequent
  reads pass, demonstrating persisted server idempotency across restart.
- Fixtures use UUID-named users and temporary directories, guard cleanup by
  exact user ID + fixture username, and remove only their own rows. No seed
  preferences, normal users or database volumes are reset.
- Browser adapter tests execute production TypeScript with stubbed IPC/HTTP;
  the native live test separately exercises the real browser HTTP endpoint.
  This is not a claim that two GUI windows or browser controls were exercised.

## October 8 regression and runtime checkpoint

- Docker PostgreSQL and API started; health endpoint responds successfully.
  Tauri development application started with the `Lab Inventory Management`
  window title and Vite at `http://localhost:1420`. Process startup is not a
  claim of visual verification of every page.
- Backend serial suite: **55/55 passed**.
- Linux container DOCX suite: **5/5 passed** (included in backend count on host).
- Desktop API suite: **27/27 passed**; TypeScript `--noEmit` passed.
- Rust suite: **21 passed, 3 explicitly ignored live tests**. The preference
  live test was separately opted in and passed, including API restart. Notes
  and maintenance disk-client tests were not rerun in this checkpoint; their
  prior evidence remains dated above/in Phase 1.
- Maintenance actual-PostgreSQL regression probe passed again.

### New dependency advisories (not hidden by the earlier green audit)

- October 8 rebuild reported one critical and three moderate affected packages.
  Only the compatible `proxy-addr` resolution changed, **2.0.7 -> 2.0.8**.
  [Upstream advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h)
  describes overly broad IPv4-mapped IPv6 trust subnets. LabOS currently uses
  false or one trusted hop, not subnet configuration, but the patched package
  is deployed regardless. No Express major upgrade or forced dependency fix.
- Current image installation reports **three moderate affected packages**:
  `mammoth -> argparse -> sprintf-js`, one underlying
  [unbounded-precision formatting advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
  Source inspection finds argparse in Mammoth's CLI executable, not its library
  conversion implementation used by LabOS. This is a reachability assessment,
  not an unconditional safety assertion. No patched sprintf-js version was
  offered by the audited dependency graph; npm's proposed fix downgrades
  Mammoth to 0.3.29 and was deliberately not applied. Track an upstream fix or
  a tested converter replacement before unconditional dependency sign-off.

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
docker exec -e LABOS_PHASE2_PREFERENCES_PROBE=1 labos-labos-api-1 node src/phase2-preferences-live-probe.mjs
# desktop/src-tauri; creates only namespaced fixture accounts, cleans them up
$env:LABOS_PHASE2_PREFERENCES_PROBE='1'
# Optional and intentionally disruptive for a few seconds: restart API during replay
$env:LABOS_LIVE_RESTART_API='1'
cargo test --no-default-features postgres_two_client_preferences -- --ignored --nocapture
```

## Still open within Phase 2

Supplier/storage and remaining inventory/project/finance/import/purchase paths; binary resource
staging, editor copies and media-job reconciliation; comments and notification
read state; online-authoritative operation retries; legacy export/recovery and
remaining account/file isolation and revoked-pending-work recovery. Finish each
audited operation and its failure/two-client verification before phase sign-off.

Phase 3 UI/installer/restore/CI/owner acceptance remains separate. A green slice
must not be presented as completion of either whole phase.
