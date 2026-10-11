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

## Supplier and storage-container checkpoint (October 8)

- Shared allowlisted catalog apply for supplier and storage-container CRUD;
  immediate local transaction contains state + authored immutable outbox.
  Browser HTTP uses stable identity/key and captured version; no IPC-failure
  fallback. Complete snapshots preserve pending work/deletes and evict missing
  synchronized records. Integer versions, predecessor checks, tombstones and
  required audit commit with idempotency on PostgreSQL.
- Supplier deletion retains the existing admin-only rule. Linked containers
  cannot be deleted. Supplier unlinking advances affected inventory timestamps
  so cursor-based clients see the relationship removal. Server reauthorizes
  catalog replays, checks entity identity as well as user/device/payload, and
  rejects deleted-ID recreation. UI captures the displayed version on edits
  and deletes and explains full-chain conflict discard.
- Desktop storage label edits now use inventory/outbox; storage lists and item
  pagination use local state. Storage-container IDs are included in inventory
  sync's field allowlist. Broader inventory/browser mutation hardening remains
  an open Phase 2 item, not implied complete by this catalog slice.
- Two native atomicity/validation tests and four TypeScript boundary tests
  pass. Actual PostgreSQL probe passes parallel replay, payload/entity mismatch,
  authored changes, dependencies, conflicts, permission denial, HTTP replay,
  linked-container deletion, tombstones and no resurrection.
- Explicit native live test passes for BOTH catalogs using two disk SQLite
  clients and actual PostgreSQL: offline create/update, close/reopen, lost ACK,
  repeated pull, same-record edits, preserved conflict, explicit recovery and
  delete/replay. Exact temporary records/directories are cleaned; normal audit
  and sync receipts for the existing-account disk-client test are retained.
- Initial test failures were corrected: invalid colon in local scoped-state
  key, incompatible TypeScript promise union, UUID array type in probe cleanup,
  and authorship assertion incorrectly inspecting the deliberately minimal
  sync receipt instead of PostgreSQL. Two leftover probe accounts from the
  failed cleanup were removed by exact ID/username, including their test audit
  and tombstone rows; no normal user rows were removed.
- Phase 2 still has binary/media, remaining domain mutations, online-authority
  retries, isolation/recovery and full closure work. The next checkpoint below
  records comments and notification reads separately.

## Comments and notification read-state checkpoint (October 8)

- Both notification API aliases and project comment mutations now use native
  account-scoped repositories on desktop: business state and immutable outbox
  event commit together. Null/rejected IPC does not cause an HTTP write.
- Comments are immutable create/delete records with canonical UUIDs, server-
  authenticated authorship and author-or-admin delete authority. Current project
  edit access is rechecked even for replay. PostgreSQL comment, audit, receipt
  and member-notification effects commit in one transaction. Repeated creates
  produce one comment and one notification per eligible recipient. Deleted IDs
  cannot resurrect; parent deletion also creates comment tombstones.
- Comment pull is a complete authorized-project snapshot. Pending deletes stay
  deleted; repeated pulls deduplicate. Revoked comment bodies leave the cache,
  while authored unsent payloads remain in the outbox for recovery. A scoped
  access marker blocks reads/retries through stale project cache permissions.
  Accept-server discards the dependent comment chain with explicit confirmation.
- Notification reads are monotonic acknowledgements of frozen explicit IDs,
  not a server-side wildcard. Retries cannot mark later arrivals read; timestamps
  do not change on replay. Ownership/current reference visibility are checked.
  Revoked notification content is evicted even when an ID-only read intent is
  still queued. Deleted notifications are harmless on replay.
- Actual PostgreSQL comment and notification probes pass parallel/repeated
  replay, ownership, parent/author checks, browser parity, revoked visibility,
  disabled users (notification probe), deletion and exactly-once effects.
- Explicitly opted-in native tests use two temporary disk SQLite clients and
  production mutation/pull code against PostgreSQL. Comments pass offline
  create/restart/lost-ACK/repeated-pull and cross-client deletion; notifications
  pass concurrent reads/restart/lost-ACK/later-arrival protection/browser parity.
  These are disk clients, not two visually exercised application windows.
- Latest host backend serial rerun: **55/55 passed**. The preceding serial run
  during native compilation failed one valid DOCX conversion at its 15-second
  deadline (54/55); quiet rerun and Linux container DOCX **5/5** passed. The
  timeout remains unchanged, and host-contention sensitivity is not erased.
- Latest desktop API suite: **39/39 passed**, including local inventory summary
  parity and storage-edit failure boundaries. Full native suite: **26 passed,
  6 live tests ignored by default**; comments and notification live tests were
  separately opted in and passed. Other live checks retain their dated evidence.
- TypeScript `--noEmit` and production Vite build passed. Actual PostgreSQL
  catalog, notification, preference and maintenance probes all passed again
  after the shared broker/comment changes. API/database/storage health and
  the local Vite HTTP endpoint respond successfully; no GUI sign-off inferred.
- Local inventory intelligence includes explicit low-stock status as well as
  quantity threshold, matching the server rule. UI visual acceptance is pending.
- Isolated fixture accounts, comments, projects and temporary databases were
  removed after tests; seed/user data and Docker database volumes were retained.

## Inventory snapshot and replay checkpoint (October 8, later run)

- Started the requested desktop app; confirmed the development executable's
  `Lab Inventory Management` window and healthy API/database/storage services.
- Found three independent cache defects: stale whole-snapshot replacement,
  pending movements/bulk targets excluded from pull protection, and incorrect
  `snapshot_json`/`movements_json` top-level IPC names whose errors were hidden.
  Installed Tauri macro source confirms camelCase command argument defaults.
- Item CRUD/bulk and movement writes now include their captured account and
  exact base snapshot. Native immediate transactions compare both before
  changing state or queuing an event. A race rejects explicitly rather than
  overwriting another edit. No automatic HTTP fallback or silent cache failure.
- Pending-item collection includes bulk target arrays and stock movements.
  Both full cache replacement and incremental pull preserve optimistic work
  and pending deletes. Malformed IDs/snapshots do not advance the cursor.
  Compact UUID inputs canonicalize; duplicate identities fail closed.
- An inventory ACK now invalidates the inventory cursor in the same transaction.
  This handles a committed server row skipped while its ACK was lost: the next
  pull reconciles its actual server quantity. This deliberately rereads the
  inventory feed after ACK; targeted refresh/large-dataset optimization is not
  claimed. It does not change server conflict/merge policy.
- Movement cache replacement preserves pending movement records; after ACK,
  a subsequent history refresh may replace optimistic quantities with server
  values. Automatic movement-history refresh scheduling still needs work.
- Initial filtered inventory reads fetch/cache the full authorized list, then
  filter locally, preventing an incomplete cache from being treated as complete.
- Four new native tests passed; full Rust suite **30 passed, 7 ignored live
  tests**. The ignored inventory live test was separately enabled and passed
  using two disk-backed clients and the actual PostgreSQL API/cursor feed:
  restart with pending work, concurrent consume/receive, refreshed local 8 vs
  committed server 13, lost ACK/replay/reconciliation, bulk status and delete.
- Desktop API suite **46/46 passed**, including seven inventory boundary tests.
  An initial new test lacked URLSearchParams in its VM harness; the harness was
  corrected and the full suite rerun. No production timeout/guard was relaxed.
- TypeScript `--noEmit` and production Vite build passed after these changes.
  No backend runtime code changed in this inventory slice; the prior backend
  regression count is dated evidence, not a newly rerun suite here.
- Cleanup query confirms zero `LABOS-P2-INVENTORY-CLIENT-*` users/items.
  Only temporary fixture records and UUID-named test directories were removed.
- Still open: successive offline metadata edits use optimistic client timestamps
  and can self-conflict. Implement server-backed integer versions/predecessors,
  stale bulk/delete checks and shared browser idempotency next. Imports and
  automatic recovery/new-offline initialization require their own verification.

## Inventory versions and cursor checkpoint (October 9)

- New desktop item CRUD, bulk and movement events use protocol 2: canonical
  target IDs, integer base versions and immutable predecessor change IDs.
  PostgreSQL resolves predecessors only for the same account/device, using
  their committed versions rather than the client's predicted versions.
- Every item SQL update advances its server version. Metadata, bulk status,
  delete, absolute stock adjustment and transfer reject stale versions.
  Additive stock deltas still combine. Required audit, effects and receipt
  commit atomically; deletes emit tombstones and deleted IDs cannot be reused.
- Versionless local caches must refresh before editing. Versioned conflicts
  cannot use automatic overwrite. Confirmed discard includes connected
  pending intents/shared batches but leaves unrelated targets queued.
- Preserved PostgreSQL microseconds in inventory cursor encoding/decoding.
  A real API pull across 600 temporary rows with one shared microsecond
  timestamp terminated without skipping or repeating those rows.
- Actual PostgreSQL probe passed parallel/replayed create, create-only grant,
  chained edits, cross-device predecessor rejection, intervening-write
  conflict, atomic stale bulk/delete rollback, additive deltas, stale absolute
  adjustment, predecessor result versions, direct SQL version advancement,
  deletion/replay/no resurrection, audit uniqueness and repeat migration.
- Native inventory tests: seven unit tests plus one explicitly enabled live
  test passed. The live test uses two disk-backed clients against PostgreSQL,
  including restart, two queued metadata edits, lost ACK/replay, concurrent
  stock deltas and bulk status/delete. Full native suite: **33 passed,
  7 opt-in live tests ignored by default**; only inventory live rerun here.
- Desktop API suite **46 passed**; TypeScript and production Vite build passed.
  Backend quiet serial suite **55 passed**. An earlier concurrent run was
  **54/55**, hitting the existing valid-DOCX 15-second conversion timeout;
  the quiet rerun passed without relaxing limits. Contention sensitivity is
  still a reliability observation, not silently considered fixed.
- Actual PostgreSQL catalog and maintenance regression probes and the existing
  browser inventory-route probe passed. These do not prove browser write
  versioning/idempotency, which remains open.
- Deployed API image: `sha256:32258a48b14108ac0b862127e38f759a685a5d183a465680102ede622cfc7a30`.
  Cleanup found zero temporary inventory probe users/items. Only fixture data
  was removed; seeded/user data and Docker database volumes were retained.
- Compatibility boundary: legacy immutable outbox events/imports retain their
  previous semantics; direct browser routes are not yet version-checked or
  idempotent. Automatic movement-history refresh, import coordination and
  first-use offline initialization remain open. No GUI or phase sign-off.

## Browser inventory convergence checkpoint (October 9, later run)

- Extracted the existing inventory SQL apply functions into `inventory-apply.js`.
  Desktop sync and browser item create/update/delete, bulk status/delete,
  movements and storage PATCH now use the same versioned transaction wrapper.
  Required audit/history, effects, receipts and delete tombstones are atomic.
  Single-item audit before-images retain object shape for assignment history.
- Browser writes require stable UUID keys/IDs and displayed record versions.
  Item edit forms capture the version when editing begins; storage-label edits
  preserve the selected container. Old unversioned HTTP callers fail closed.
  Stock quantity edits require the movement endpoint/adjust-stock permission.
- Browser unresolved intent key/body persists in per-account tab session
  storage before HTTP. Transport, server and truncated-response failures keep
  it; retries after refresh still use the original base/ID even if the displayed
  server version advanced. Successful/definitively rejected intents clear.
  This is not an offline browser queue and does not survive closing/clearing
  its session storage. Desktop continues to use its durable SQLite outbox.
- **54 desktop API tests passed**, including eight new browser tests: all
  mutation versions, create replay across reload, stock replay after a newer
  refreshed version, missing-base no-write, uncertain versus definitive errors,
  account switching and persistence/desktop-runtime fail-closed boundaries.
- All three actual PostgreSQL inventory probes passed on the final image:
  browser HTTP, existing route regression, and protocol-2 sync/version probe.
  Coverage includes parallel replay, key mismatch, revoked replay permission,
  exactly-once history/audit, stale atomic bulk/delete, additive stock versus
  absolute adjustment, storage version conflict/replay, tombstones, no identity
  resurrection, repeat migration and 600-row microsecond pagination.
- Explicit native inventory rerun passed **8/8** (seven units and the two-disk
  client PostgreSQL test) after shared apply extraction. No native implementation
  changed in this browser slice; other ignored domain tests were not rerun.
- Latest full backend run: **54/55**, with the existing valid-DOCX conversion
  timeout failing again. Other backend checks passed. This supersedes the prior
  quiet 55/55 result for current regression status; timeout reliability remains
  open and no limit was weakened.
- TypeScript passed. Vite production build passed with **2,227 modules** after
  rerunning with permission for esbuild parent-directory resolution; restricted
  attempts failed with filesystem access denied, not a source/build error.
- Final deployed image:
  `sha256:9a31d49eb06a4812b0166575410d61b73553672547280a8ed63a4e0bb934e548`.
  API/database/storage health are OK; Vite returned HTTP 200; the debug desktop
  `Lab Inventory Management` window was confirmed open. No GUI interaction or
  visual acceptance is inferred from those runtime checks.
- Cleanup query returned zero temporary inventory users/items, including the
  earlier route probe fixtures. Only generated test data was removed. Existing
  seed/user data and Docker volumes were retained; no reset or reseed performed.

## October 9 — atomic inventory imports and history/empty-cache boundaries

Implementation:

- Preview freezes account, explicit create/update classification, canonical row
  UUIDs, versions and a batch ID. This fixes generated IDs accidentally making
  new workbook rows look like updates. At most 500 rows / 10 MiB per workbook.
- Desktop commit saves the merged inventory snapshot plus one immutable import
  event atomically. It preserves fields absent from the workbook; invalid
  quantity, stale base, account switch, denied stock permission or failed outbox
  insert leaves no partial import. Identical native retry does not apply twice.
- Shared PostgreSQL apply orders all target locks, enforces import and row-level
  create/edit/stock authority, and commits all rows, required audit/history and
  one receipt together. A subsequent item edit can depend on this batch receipt.
- Browser imports now send the reviewed JSON plan with versions and a retry key.
  An uncertain re-preview uses its persisted original body/IDs. Legacy multipart
  mutation callers fail closed and must migrate; preview/export are unchanged.
- Pending batches participate in pull protection and connected-chain discard.
  Old queued payloads remain immutable and are not silently upgraded.
- Online history reads refresh rather than using the cache indefinitely. Native
  merge preserves pending movements; transport/5xx failure can use the same
  account's cached history, but 401/403 cannot. Native read and persistence errors
  propagate. Missing history is not fabricated as an empty list; confirmed-empty
  history has an account-scoped marker written with the cache transaction.
- Empty initial inventory is initialized only on an explicitly complete server
  response. Empty incremental pages do not replace the inventory. This does not
  support first-ever offline editing before an initial download.

Verification:

- Desktop API suite **65/65**, TypeScript and Vite production build passed
  (**2,228 modules**). Tests include null/failing IPC, no HTTP fallback, immutable
  import plans, canonical duplicate UUIDs, re-preview recovery, pending-safe
  history, offline fallback, account changes, denied reads, disk failures,
  explicit empty snapshot and cursor non-progress rejection.
- Native suite **37 passed, 7 opt-in live tests ignored by default**. Three import
  tests cover mixed batch/retry, stale/account/permission/quantity/outbox rollback
  and create-only permission plus canonical duplicates. Eight inventory unit
  tests cover pending work, version/predecessor semantics, history and cache.
  Initial new-history tests caught an invalid scoped-key separator; fixed and
  rerun green, not waived.
- Explicit inventory suite **9/9**, including two disk clients against the
  existing PostgreSQL: mixed create/update import, queued successor, SQLite
  close/reopen, lost ACK/replay and final convergence. This supplements, not
  replaces, the real-server tests with isolated native unit fixtures.
- Actual PostgreSQL import probe passed: failure after an earlier row's create
  rolls everything back; stock/import permission denial; parallel browser replay;
  changed-payload/key rejection; one sync receipt; dependent item edit. Existing
  browser and version probes also passed, including 600-row cursor pagination.
- The existing shared database was **not cleared** to test an empty installation.
  Empty-response initialization is verified at API/native boundaries, not claimed
  as an end-to-end run on an emptied PostgreSQL instance.
- Backend regression **55/55** after correcting DOCX's ignored `preProcessing`
  option to the installed runtime's `preprocessing`. Focused converter tests
  **5/5**; text/table/link/image case took about 1.7 seconds focused and 3.5 seconds
  in the full rerun. The earlier timeout is retained in the previous checkpoint;
  one green rerun is not proof of performance under all host-load conditions.
  The 15-second timeout, 128 MiB V8 heap and two-job cap are unchanged.
- API rebuilt/restarted without resetting volumes. Final image:
  `sha256:15d2ec388234dc168216734841f333042628e23e699738739432fa1bcc43a374`.
  Debug desktop window confirmed open; frontend HTTP 200 and API/database/storage
  healthy. This is runtime availability, not visual/GUI acceptance.
- Final deployed image also passed all five DOCX tests and the inventory import
  PostgreSQL probe. Cleanup verification returned zero `LABOS-P2-INVENTORY-*`
  fixture users/items. Existing seed/user data, media and Docker volumes were
  preserved. Native watcher rebuilt/relaunched the app; window PID 15992 was
  confirmed as `Lab Inventory Management` after the latest native edits.

Limitations: broader inventory relationships, old-event recovery, workbook parser
hardening, finance/purchase imports, remaining project/media/online-effect paths
and account/recovery matrix remain open. This checkpoint does not close Phase 2.

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
docker exec -e LABOS_PHASE2_CATALOG_PROBE=1 labos-labos-api-1 node src/phase2-catalog-live-probe.mjs
docker exec -e LABOS_PHASE2_NOTIFICATIONS_PROBE=1 labos-labos-api-1 node src/phase2-notifications-live-probe.mjs
docker exec -e LABOS_PHASE2_COMMENTS_PROBE=1 labos-labos-api-1 node src/phase2-comments-live-probe.mjs
docker exec -e LABOS_PHASE2_INVENTORY_PROBE=1 labos-labos-api-1 node src/phase2-inventory-versions-probe.mjs
docker exec -e LABOS_PHASE2_INVENTORY_PROBE=1 labos-labos-api-1 node src/phase2-inventory-http-probe.mjs
docker exec -e LABOS_PHASE2_INVENTORY_PROBE=1 labos-labos-api-1 node src/phase2-inventory-import-probe.mjs
docker exec -e LABOS_INVENTORY_ROUTE_PROBE=1 labos-labos-api-1 node src/inventory-routes-live-probe.mjs
# desktop/src-tauri; independent opt-ins for temporary fixture accounts
$env:LABOS_PHASE2_NOTIFICATIONS_PROBE='1'
cargo test --no-default-features postgres_two_client_notification -- --ignored --nocapture
$env:LABOS_PHASE2_COMMENTS_PROBE='1'
cargo test --no-default-features postgres_two_client_comments -- --ignored --nocapture
# After building the API image with the new inventory fixture helper (or copy it):
docker cp backend/src/phase2-inventory-client-fixture.mjs labos-labos-api-1:/app/src/phase2-inventory-client-fixture.mjs
# desktop/src-tauri
$env:LABOS_PHASE2_INVENTORY_PROBE='1'
cargo test --no-default-features inventory_sync_state -- --include-ignored --nocapture
# desktop/src-tauri; creates only namespaced fixture accounts, cleans them up
$env:LABOS_PHASE2_PREFERENCES_PROBE='1'
# Optional and intentionally disruptive for a few seconds: restart API during replay
$env:LABOS_LIVE_RESTART_API='1'
cargo test --no-default-features postgres_two_client_preferences -- --ignored --nocapture
```

## October 9 — owner additions and offline-read characterization (no fixes)

Owner added salvage, smooth TTS/media focus, permissioned assistant drafting and
composer/context/retry/navigation/voice improvements. Allocated these within the
existing Phases 2 and 3; see PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md. Finance valuation
and transcription provider choices remain explicit implementation decisions.

Ran `node --test scripts/offline-read-diagnostic.test.mjs` from desktop: **13
characterization checks passed**. Several assert known failures, so this is
evidence of current limitations, not evidence of fixes or release readiness.
The harness uses current adapters, mocked native repository inputs and failing
HTTP transport. It does not touch PostgreSQL/user SQLite, stop the server or
reproduce the full installed desktop's session. Healthy local aggregate inputs
work; missing inputs and direct-server readers reproduce the documented gaps.
The exact installation-specific operations/intelligence/resource failure remains
open. No application behaviour or user data was changed in this checkpoint.

Finding 34 records the read-path gaps. Discuss available-section/stale-completeness
semantics with the owner before designing their detailed remedy. Preserve the
24-hour privileged offline lease and distinguish unknown values from zero.

## October 9 — approved partial offline-read implementation

The owner approved retaining authorized available sections rather than blocking
an entire overview. Operations, Dashboard and Lab Intelligence now settle local
sources independently with a five-second read deadline and an account-session
check. A failed or stalled source becomes unavailable, not an empty success;
available sources remain usable. Failed project workspace reads no longer invent
zero tasks or 100% health. Unknown numeric totals render as an em dash.

The shared notice explicitly calls this a local snapshot, potentially including
unsynced changes. Its timestamp is the local read time, not a fabricated sync
time. Initial-download completeness and genuine per-domain last-successful-sync
metadata are NOT implemented by this slice. Empty legacy caches can still need
that distinction; partial local aggregates are not certified consolidated reports.

Desktop resource metadata no longer waits for server queue enrichment or falls
back to HTTP after native read failure. Existing server-media routing information
is derived from local metadata; this does not copy file bytes to the device.
Native Notes/Resources/Projects read entry points now check their domain view
permission in addition to the existing account/lease boundary. Internal sync
reconciliation remains separate from these user-facing read checks.

Verification in this checkpoint:

- `node --test src/api/*.test.mjs src/pages/overview-availability.test.mjs scripts/offline-read-diagnostic.test.mjs`:
  **86 passed** (70 API, 3 static React rendering, 13 mixed regression/characterization).
  Four characterization cases deliberately continue to reproduce open gaps:
  Reports HTTP, Collaboration activity HTTP, download queue HTTP, server-held media.
- Native `cargo test --no-default-features`: **37 passed, 7 ignored**.
- Explicit actual-PostgreSQL `postgres_two_client_comments` integration test:
  **1 passed**, using isolated fixtures and the real running service.
- TypeScript check and production frontend build passed; diff whitespace check passed.

Deadline, account-switch, denied-source, partial-source and static page assertions
are automated evidence, not physical WebView acceptance. This checkpoint did not
stop/pause Docker or perform the complete desktop warm-cache/cold-restart outage
matrix. No database reset, user-data reseed or backend deployment was required.
The read deadline bounds UI waiting; it does not cancel an already-started IPC.

Remaining read work: durable authorized Reports/activity/download projections,
per-domain initialization and freshness metadata, media device-copy semantics,
the inventory/catalog all-or-nothing detail read, and full installed-desktop
outage verification. Salvage, audio-focus and assistant additions remain planned.
This is a partial implementation of finding 34, not Phase 2 sign-off.

## October 9 — offline session identity and real stopped-API desktop check

Implemented the first P2-A identity/session repair, not the entire security plan:

- Native auth responses now expose central account identity; the SQLite
  credential-row ID remains internal. Frontend also normalizes older local user
  shapes. Validated native auth status restores its existing local session token.
- Offline login no longer throws away that token. Startup and login establish
  identity before loading permissions. Server-only HTTP refuses local credentials
  before transport, so an optional remote feature cannot log out a valid local
  session by sending an invalid server bearer token.
- Session generations invalidate captured work across sign-out/re-entry; startup
  callbacks ignore intervening session changes. A late 401 cannot erase a
  different server token, and network restoration rejects a different native
  account. Login/current-user/permission auth requests have five-second deadlines.
- Native lease and permission checks remain unchanged; no lease extension,
  permission bypass, DB reset or reseeding was used to make the test pass.

Automated: combined frontend suite **96 passed**, including ten new real-adapter
auth/HTTP tests; four existing known-gap characterization checks remain. Native
suite **38 passed, 7 ignored**; TypeScript and production frontend build passed.

Actual desktop outage evidence (not a browser mock):

1. Inspected Compose state and PostgreSQL download job counts (no job rows).
   Stopped only `labos-api` using the documented Compose command; confirmed the
   health endpoint refused connection. The PostgreSQL service/data were retained.
2. Computer-use authentication entry is prohibited by the selected skill, so the
   owner entered credentials manually and confirmed “logged in” while API was
   stopped. Automation did not enter or print credentials.
3. Observed Resources in the actual Tauri WebView. After Ctrl+R, it displayed
   **12 resources** instead of the previous failed-read screen. A file thumbnail
   remained broken, correctly retained as the separate unresolved file-copy gap.
4. Navigated to Dashboard with the API stopped: **3 active projects, 12 overdue
   tasks, 5 due in seven days, 5 low-stock items**, with project rows/local notice.
5. Closed the native desktop process, restarted its dev frontend (closing the
   Tauri dev runner also stopped Vite), and relaunched the native executable while
   Docker API remained exited. Dashboard restored the local session and the same
   counts. This was a process cold restart, not just React navigation.
6. Restored the API to running; health confirmed API/database/storage OK at
   **2026-10-09T18:03:29Z**. Owner subsequently confirmed online sign-in ("done").
   Final GUI sync-state inspection was blocked by the tool approval review's usage
   limit; GUI reconnection/replay is not claimed verified. The real-PostgreSQL two-client
   comments regression passed: two disk SQLite clients, offline create/restart,
   authored lost-ACK replay, repeated pull, pending delete and cross-client delete
   reconciliation. This fixture test is not a GUI mutation acceptance claim.

Tool recovery: initial UIA clicking reported missing geometry; refreshed returned
window state and used the actual full-window screenshot (the first image was a
12px transient). No guessed window handles or alternate UI automation were used.

Boundaries: no edit/delete outbox lifecycle, paused-API auth deadline, two-account
GUI revocation, encryption or file-byte offline access acceptance is claimed in
this checkpoint. Reports/activity/download projections remain open. Reconnecting
after an explicit local login still requires an online sign-in to obtain a server
JWT; simply bringing the API back cannot mint server authority from a local token.

## October 9 — server credential revocation (P2-A partial)

Implemented audit finding 36 under the design in
../architecture/credential-revocation.md. This is a server-authoritative security
slice, not a new offline capability or end-to-end offline security sign-off.

- Added `users.credential_version` with an additive version-zero migration.
  PostgreSQL advances it on password-hash changes or active-to-disabled changes;
  repeated migration, profile edits and re-enabling cannot undo revocation.
- Login and temporary resource-download JWTs carry the authenticated version;
  middleware checks it against the current user row. Existing signed tokens with
  no version work only at version zero. Older tokens return `SESSION_REVOKED`.
- Password changes/reset and version advancement retain the existing required
  transactional audit. Self-password change rechecks its version under row lock.
  Responses request reauthentication, without silently minting a replacement JWT.
- A PostgreSQL authentication failure returns 503 `AUTH_UNAVAILABLE`, rather than
  falsely declaring credentials invalid. Invalid signatures remain 401.

Verification on the current dirty workspace (no commit or unrelated edits reset):

1. `node --test src/credential-version.test.js`: **3 passed**. Exact/legacy/malformed
   version claims, current/revoked tokens, restricted media-query token behavior,
   invalid signatures and simulated database unavailability. These are unit tests,
   not real outage acceptance.
2. Expanded security baseline: **46 passed**. All backend `*.test.js` except the
   opt-in isolated-database integration file: **64 passed**, including DOCX tests.
   These counts overlap; do not add them. Changed JavaScript syntax checks passed.
3. `phase2-credential-revocation-probe.mjs`, explicitly opted in with
   `LABOS_CREDENTIAL_PROBE=1`: **33 assertions passed against the existing actual
   PostgreSQL `lab_inventory` database**, twice (workspace source mounted read-only,
   then the rebuilt image). Real Express auth/resource handlers listen on an
   ephemeral loopback port in this probe; it does not pretend to be a GUI test.
   Covers admin reset, self change, old-password rejection, legacy/server/media
   JWT rejection, disable/re-enable, denied member/current-password mutations,
   required audit rows, rollback, direct-SQL hash invalidation, nondecreasing
   version, migration repeatability and other-account isolation.
4. Applied and tracked `20261009_credential_versions` in the existing PostgreSQL
   schema. Only two random-UUID fixture accounts and one fixture resource per run
   were created; exact probe-owned rows/audits/tombstones were cleaned. No existing
   passwords, user records, business data or volumes were reset. Migration remains.
5. Built `labos-labos-api`, image
   `sha256:0f03c0e86ada8c60fe92ba562e06b3e8c881ebe2680dab36d4c03cb6f668ced5`.
   Recreated only its container, retaining volumes. Packaged startup health at
   **2026-10-09T23:27:49.948Z**: API/database/storage all OK. The packaged probe also
   passed. Both original services were stopped at the start of this continuation;
   final `finally` cleanup restored both to **Exited (0)**.

Runtime note: the first restoration observed the otherwise untouched API entering
a restart loop after PostgreSQL was stopped. Its restart count was nine on the
follow-up read. It was explicitly stopped before image replacement; final
packaged verification/restoration confirmed both stopped. Cause of that unexpected
startup was not established. This is not evidence of successful desktop sync.

Reproduction from the configured Compose environment (project name is essential):

```powershell
docker compose -p labos -f deploy/docker-compose.yml build labos-api
docker compose -p labos -f deploy/docker-compose.yml start db labos-api
docker compose -p labos -f deploy/docker-compose.yml exec -T -e LABOS_CREDENTIAL_PROBE=1 labos-api node src/phase2-credential-revocation-probe.mjs
# Restore services to the state observed before testing, including on failure.
```

Source SHA-256 for the tested security changes:

```text
backend/src/middleware/auth.js C70575A082B593A4AE6DD9AF4AE5A6BBC7460A3F50AC34D709C92C5CA647138F
backend/src/routes/auth.js 08FC03194FDA527D9B22B0F3C3D85B2BF7049B06FFADBFE758A829A2F1B2C01E
backend/src/routes/resources.js 45DE8DF8356151135016F3317A492CD8452D15E0EA1977085FCCAC88C8DDA760
backend/src/credential-version.js 3C450F08DC8CE1D84819BA91CE4427DBCCE1E4AB08AC352B1BD667D3ADCDC598
backend/src/migrations/20261009_credential_versions.sql 1B6952D2F8505A4B6F57ABCDB9F8766270823B0E6BC81099CBDBCA61C2ACBE23
```

Open boundaries: no native cache changes, SQLite lease changes, pending-work
deletion or automatic local password replacement were made. A disconnected PC
still cannot observe remote revocation. Native-verified authority and observed
revocation handling must be implemented before claiming end-to-end security.
Desktop password-change UI does not yet immediately consume the new
`reauthentication_required` response; later protected requests reject its old JWT.
Requests already past middleware are not retroactively cancelled. The final
prior-turn desktop sync display, two-account revocation/outage checks and full
file replication remain unverified/open. The stopped-API GUI gate still applies
to the forthcoming offline-cache/security changes; it was not replaced by this
server-only probe. Phase 2 remains open.

## October 10: observed revocation and native cached-session locking

This checkpoint supersedes the preceding server-only entry's statements that no
native cache changes or immediate password-change reauthentication were implemented.
It does not supersede that entry's end-to-end acceptance limitations.

Implemented audit finding 37:

- Shared auth/HTTP adapters capture frontend generation, account and native session
  guard. Explicit `SESSION_REVOKED` / `ACCOUNT_DISABLED` responses lock only that
  captured native session. Successful self-password change uses the same path.
- Native SQLite locking transaction removes effective permissions, offline lease
  and matching session, without deleting authored business rows or outbox events.
  A stale response cannot lock a newer login. Failed lock writes roll back.
- Permission refresh cannot reactivate locked access or update another session.
  Online credential/session publication is atomic; offline password verification
  and session creation now also share an immediate transaction.
- App handles authentication-expiry events and guards late permission loads.
  Ordinary token expiry is distinguished from revocation; network/503 errors do
  not declare cached credentials revoked. Login bootstrap no longer briefly pairs
  a new token with the previous account.

Verification (overlapping counts, not additive):

1. Frontend API/page/diagnostic suites: **104 passed**, including 18 auth tests and
   four retained known-gap characterization tests. Those four do not prove the
   characterized missing features have been fixed.
2. TypeScript check and frontend Vite production build passed. Sandbox initially
   prevented esbuild access; the explicitly escalated build passed.
3. Final `cargo test --no-default-features`: **41 passed, 8 ignored**. Ignored tests
   require explicit live-database opt-in; they are not successes in this run.
4. With `LABOS_AUTH_DESKTOP_PROBE=1`, `cargo test --no-default-features
   local_auth::tests -- --include-ignored --nocapture`: **7 passed**, including the
   actual PostgreSQL/API bridge after the final atomic offline-login change.
   The fixture is disabled in PostgreSQL, its authenticated API request is rejected,
   and the production native lock is applied to a temporary disk SQLite cache.
   Reopening that cache denies the old login, retains pending work/author identity,
   and leaves another cached account usable. Exact test fixture rows are cleaned.
   This is integration evidence, not an interactive desktop test.

Actual desktop evidence and limits:

- Earlier in this continuation, Docker API and PostgreSQL were stopped, the owner
  confirmed offline login, and the actual desktop showed the populated dashboard
  (3 active projects, 12 overdue tasks, 5 due within seven days, 5 low-stock items).
- The owner later confirmed online login to the disposable manual-test account.
  The app/dev runner was subsequently closed or minimized during a long pause;
  further GUI input conflicted with owner activity. GUI control was stopped.
- Consequently, interactive revocation followed by server outage, offline-password
  denial and cold restart remains **UNVERIFIED**. The separate live integration
  fixture cannot substitute for this owner-required acceptance gate.
- The last observed desktop executable was built October 9 at 23:44:53, SHA-256
  `476BBA6462DC5E0F3C2AFECF1B716FBD398383A30CC62E8A82D189C9CB3FF791`.
  It includes earlier changes, not the final offline-login transaction. Current
  Rust source compiled in tests; a final native app rebuild/relaunch is pending.
  Restarted Vite served HTTP 200, but the reopened native window was not verified
  after refresh. This is not a claim that the current desktop UI is ready.

Cleanup: removed only manual server fixture
`2b9b8e16-41f6-409b-8aad-323a5a62e271` and its audit rows; exact PostgreSQL lookup
returned zero rows. Its native cached account, if present, was not manually erased.
No existing account, password, business data, outbox or volume was reset. Both
Docker services were originally stopped and are restored to that state after tests.

Remaining security boundary: positive authorization still trusts renderer-provided
cache inputs. Native server verification, direct-transport coverage, secure storage,
throttling, clock hardening and complete interactive outage acceptance remain open.
Phase 2 is not complete.

## October 10: native authorization exchange, backoff and clock guard

Design: ../architecture/native-authorization.md. Audit finding 38. Work remained
inside the existing dirty checkout; no unrelated changes or databases were reset.

Implemented:

- Native login now owns the password/permission HTTP exchange. The renderer passes
  only username/password, not identity, role, grants or an API origin. Native
  permission refresh independently verifies the bearer token/account with the server.
  Its origin is fixed at build time (default loopback), redirects/proxies disabled,
  requests bounded to five seconds and response parsing bounded to 64 KiB.
- Only initial transport/5xx unavailability permits cached-password fallback.
  Explicit rejection, malformed responses and failures after password success do
  not restore stale cached authority. Login generations reject completion after
  logout, a newer login or revocation. Permission refresh cannot renew a lease.
- Native refresh can itself observe revocation and lock the captured cache. A
  regression verifies that an earlier successful `/me` response cannot restore the
  authenticated UI after that lock.
- Persistent per-account failed-password backoff begins at the fifth failure
  (15 seconds, exponential to 15 minutes). Restart does not clear it. Successful
  verified online or permitted offline login clears only that account's counter.
- UTC high-water tracking expires cached leases on backward movement beyond five
  minutes. Moving forward again does not resurrect access. Online password
  verification recovers access; authored work is retained. This is not a trusted,
  tamper-proof clock or encrypted storage.

Verification:

1. Frontend API/page/diagnostic suite: **105 passed**, including 19 auth tests.
   Four retained known-gap tests still characterize incomplete offline Reports,
   activity, Downloads and server media URLs; those features are not fixed here.
2. Final native ordinary suite: **48 passed / 9 ignored**. Opt-in live tests are
   reported separately below, not counted as passing in the ordinary run.
3. Targeted auth suite with real PostgreSQL enabled: **10 passed**. The live test
   now uses the actual native password/permission HTTP client, publishes to a
   temporary disk SQLite database, verifies a member cannot gain user-management
   authority, then disables only its random server fixture. Server rejection,
   native cache lock, reopened-cache denial, unchanged pending author/work and
   another account's access pass. Fixtures are cleaned by exact ID.
4. Real outage: stopped only `labos-api`, leaving PostgreSQL running. The actual
   health endpoint was unreachable. With `LABOS_AUTH_STOPPED_PROBE=1`, the native
   `stopped_api_native_fallback_preserves_lease_and_author` test **passed**: actual
   connection failure reaches the same production native fallback function,
   authorized cached-password login works, disk reopen preserves authority and
   authorship, lease is unchanged, and an expired cache is rejected.
5. The PowerShell `finally` path restarted the API. Health at
   **2026-10-10T11:03:32Z** reported API/database/storage OK; both services healthy.
   PostgreSQL query found **zero** remaining `p2-auth-` fixture accounts. No
   download jobs existed before interruption. Both services were already running
   at the beginning of this slice and are left running.
6. TypeScript, frontend production build and native debug build passed during the
   slice. First native build SHA-256:
   `4ACA37051BF67B24B02836B5AD78E82E7E99827AE23BA4B640B801AC99125506`.
   After the old desktop was closed, copied that build to the usual
   `desktop/src-tauri/target/debug/Lab Inventory.exe` and launched it.

Actual desktop limit: the rebuilt window displayed the sign-in form, not a blank
screen. Computer-use rules prohibit automating that authentication form. No session
was injected to bypass it. Therefore interactive password login, restored-session
outage/reconnect, and interactive throttling/revocation acceptance remain
**UNVERIFIED**. The real stopped-server native regression is explicitly NOT a
replacement for the owner-required GUI gate. The opened build preceded the final
behavior-preserving native helper extraction; record the final artifact separately.

An initial clock-boundary unit test failed because its baseline preceded expensive
password hashing. The test now sets an explicit baseline before exercising the
299/301-second boundaries; the rerun passed. An initial offline Cargo resolution
could not find rustls dependencies; the implementation uses the already installed
reqwest/native-TLS stack instead. Neither initial failure is counted as a pass.

Still open before security sign-off: protected token/key storage and encrypted
SQLite/files (including recovery choice and migration), legacy cache trust,
CSP/direct-transport coverage, remaining native repository authorization review,
and complete interactive acceptance. The owner has been asked to choose recovery:
Windows-protected device key plus explicit encrypted recovery backup (recommended),
device-only loss risk, or administrator-held recovery. No encryption migration or
custodian choice was silently applied. Reports/resources/activity/downloads remain
Phase 2 work and were not changed by this security slice.

Final artifact checkpoint: TypeScript and the 105-test frontend suite passed after
the late native-revocation UI fix; the final Vite build passed (2,230 modules).
Final native debug build passed; `desktop/src-tauri/target/debug/lab-inventory.exe`
SHA-256 is `90F2EC83D980F66780E58EED3744DE4D8E73D14CA3168EC2BE38B591AA5C329F`.
The already opened `Lab Inventory.exe` copy is the earlier build noted above;
it was not replaced underneath the running sign-in window. The final native
change extracted the tested fallback helper without altering its behavior.
Scoped Git whitespace checks passed. No commit was created.

## October 10 — batch cadence and local Reports implementation

The owner approved implementation batches followed by a full phase-end test
sweep. Keep quick build and critical safety checks; collect independent failures,
then apply grouped fixes and rerun the whole matrix. The earlier per-fix desktop
outage gate is superseded in timing only. Real PostgreSQL and actual stopped-API
desktop/restart/reconnect coverage remain mandatory before phase acceptance.

Reports now builds desktop overview data from existing authorized local sources,
using the native inventory snapshot directly (no missing-snapshot HTTP fallback).
Native report permissions are checked before and after aggregation; account
continuity is checked through the read. Independent failures preserve readable
sections, missing workspaces mark task/experiment totals incomplete, quantities
are grouped by unit, and stable record IDs are counted once. Resource chart labels
use kind instead of an absent status. CSV includes inventory and marks unavailable
versus confirmed-empty sections, local provenance and generation time; formula-like
strings are escaped. Audit aggregation is explicitly unavailable until its local
ledger exists. Global snapshot completeness/sync timestamps remain open.

Quick safety checks: two focused report permission/account-switch checks PASS.
TypeScript compilation PASS before the final direct-inventory-read refinement;
the final compilation result is recorded below. Full new report/export/render
regressions and the updated offline diagnostic are prepared, NOT RUN in this batch.
Actual desktop outage/cold restart/reconnect and actual PostgreSQL comparison are
NOT RUN, deferred to the phase-end sweep. No Docker stop, database mutations,
reset or native executable replacement was performed.

Acceptance ledger for this batch (do not infer passes from source or compilation):

| Check | Status | Dependencies / notes |
| --- | --- | --- |
| Report permission denial, mid-read revocation/account switch | PASS (focused mocked safety checks only) | Not native/desktop acceptance |
| All report aggregation, mixed-unit, partial/empty, CSV and render regressions | NOT RUN | Tests authored for phase sweep |
| Actual PostgreSQL versus authorized local counts | NOT RUN | Successful seeded source synchronization |
| Desktop API stopped: navigation, refresh, export, cold restart | NOT RUN | Online baseline and authorized local snapshots |
| Reconnect plus pending local changes and another account | NOT RUN | Outage workflow; include permission changes |
| Full phase regression after batched repairs | NOT RUN | Complete independent sweep and grouped repairs |

Status: IMPLEMENTED / AWAITING VERIFICATION; not Phase 2 completion. See audit
finding 39. Reports does not solve resource binary replication, activity persistence
or Downloads; those remain separate pending batches.

## October 10 — local Collaboration activity batch

Implemented, awaiting phase-end verification: an admin/audit-protected complete
server activity snapshot now has an account-scoped SQLite read model. Native
commands enforce current account, lease, admin role and audit permission. Snapshot
publication/eviction additionally binds the captured native login token. A complete
validated snapshot replaces its predecessor atomically; incomplete, invalid or
older responses preserve the previous snapshot. UUID normalization and duplicate
rejection prevent repeated logical events. Confirmed permission denial evicts only
the derived cache, without authoring a deletion or losing any pending work.

The sync coordinator now downloads this projection; Collaboration reads it locally
without HTTP fallback. The UI distinguishes restricted, not-downloaded, available
empty and failed reads, keeps notification errors from becoming zero unread, and
shows the persisted snapshot timestamp instead of local read time. The snapshot
is the full authorized ledger; the visible feed remains its latest 60 events.

Quick checks: frontend TypeScript PASS (including the new activity UI), native
`cargo check --no-default-features --offline` PASS, backend route syntax PASS.
The final Reports direct-snapshot refinement also passed TypeScript. No server
or desktop process was rebuilt/replaced/restarted for these checks. New native
commands and the server endpoint are source changes awaiting coordinated deployment;
the currently running binaries must not be mistaken for these changes.

Focused safety checks PASS: two frontend activity boundary tests (account change
and captured-session permission-denial eviction), plus the native
`activity_account_session_role_and_lease_guards` test (one passed, 58 filtered
out). The native check uses isolated in-memory SQLite; it is a local guard check,
not real PostgreSQL or desktop acceptance. No broad test sweep was run.
The complete authored activity snapshot/replay/UI regressions remain NOT RUN in
this batch. Actual PostgreSQL endpoint/authorization comparisons, disk restart,
stopped/paused API desktop acceptance, revoked-account transitions, full-phase
regression and large-ledger transfer performance are all NOT RUN. Collect independent
failures in the phase-end sweep before grouped fixes and full retesting. No real
data was modified, deleted or reseeded. Existing audit/notification writes and
their outboxes are unchanged; Reports audit aggregation remains a separate item.

## October 10 — Downloads local preparation batch

Status: IMPLEMENTED / AWAITING VERIFICATION, not Downloads completion.

- Queue/history and shared settings have account-scoped native SQLite snapshots.
  Pending creation/settings intents derive from durable outbox rows, not React
  memory. Local read failure does not trigger a server read/write fallback.
- Immediate and scheduled desktop enqueue use one native transaction boundary.
  Native local deduplication and shared HTTP/sync PostgreSQL resource-row locking
  prevent concurrent active enqueue paths from creating separate jobs in the new
  paths. Server schedule validation preserves scheduled requests.
- Global settings are versioned via a preserving migration/trigger. Native edits
  carry expected versions and immutable dependency IDs; server updates recheck
  permissions/version/receipt ownership. HTTP settings use the same apply logic
  and idempotency receipts. Conflicts preserve pending work for explicit review.
- Download result publication and local ACK share a native transaction, avoiding
  a gap where an accepted job disappears if the subsequent snapshot pull fails.
  Account/login guards reject stale-session results. Pending settings overlays do
  not overwrite the last confirmed settings snapshot.
- UI no longer blocks the entire queue on missing settings. It labels pending
  sync, settings conflicts, last snapshot time and completion on the server versus
  actual PC availability. Controls for pending/conflicted IDs are disabled.

Quick checks: TypeScript PASS; `cargo check --no-default-features --offline` PASS;
backend new modules/routes syntax PASS. Two focused frontend boundary checks PASS
(local failure never falls back to HTTP; signed-out/account-switched reads reject).
The full diagnostic and regression suites were updated/authored but NOT RUN. No
Docker interruption, migration application, real PostgreSQL test, service restart
or desktop deployment was performed in this implementation batch.

Prepared actual PostgreSQL probe: `backend/src/phase2-downloads-live-probe.mjs`,
opt-in `LABOS_PHASE2_DOWNLOADS_PROBE=1`, after migration. It uses exact namespaced
identity/resource fixtures and rolls back all settings/job mutations to avoid
changing the live worker configuration. It has NOT BEEN RUN and does not replace
HTTP replay, two-client concurrency, worker races, disk restart or actual desktop
API-stopped/reconnect acceptance. Those remain phase-end sweep cases.

Deployment prerequisite: migration `20261010_download_settings_version.sql` and
coordinated API/native-desktop rebuild. Old settings clients without an expected
version/idempotency key will be rejected by the upgraded route, not silently
allowed to overwrite newer settings. Running binaries remain unchanged.

Still OPEN within Downloads: durable existing-job quality/priority/schedule edits,
pause/resume/start/cancel/remove intentions and completion races; tool-status
cache; PC file/thumbnails transfer and readiness; scoped non-admin edit grants;
browser enqueue receipt parity; load/performance and full per-account acceptance.
Existing-job controls remain explicitly server-connected, not offline success.
See audit finding 41 for the nine-field write-path record.

## October 11 checkpoint — durable download controls (source implementation)

Supersedes the October 10 statement that existing-job controls are server-only.
Status: **IMPLEMENTED / AWAITING VERIFICATION**, not Downloads or Phase 2 sign-off.

- Desktop quality/priority/schedule edits, start/resume, pause, cancel and history
  removal now append immutable account-owned SQLite outbox events. A failed local
  write never issues an HTTP write. The current confirmed job is retained with a
  separate pending action/patch; offline cancellation is not displayed as confirmed.
- One outstanding intention per canonical job is supported. A new job must first
  receive its server acknowledgement. Pending/conflicted actions must synchronize
  or be explicitly resolved before another action on that job; authored evidence
  is retained. Restricted non-admin edit authority still fails closed locally.
- Shared server apply code checks resource permission, expected control revision,
  current worker state and resource/job row locks. HTTP controls require a stable
  idempotency key; sync uses its existing transactional receipt. Replay checks
  current resource authority before returning a prior download receipt.
- Worker claims no longer clear concurrent control requests. Completion publishes
  the resource file metadata and completed job atomically under the same lock
  order as controls. Late cancel/pause after completion returns the completed
  state, not a fabricated cancellation. A committed stop request is observed even
  without progress output (including the worker's thumbnail subprocess).
- Worker cleanup is scoped to a job-specific filename. Uncertain completion
  commits do not trigger file cleanup. Removing history does not delete resources
  or completed media. Running jobs cannot be removed until the stop has settled.
- Local removal hides the row while pending and keeps an explicit pending count;
  rejected removals become visible as conflicts. Confirmed removal IDs survive
  stale snapshot refresh. Receipt merging guards control revision and timestamp;
  generic sync acknowledgement follows atomic native receipt publication.

Checks: TypeScript and native cargo check passed; backend syntax passed. Two
focused adapter safety tests passed (local failure/no HTTP fallback and account
boundary; expected-version/missing-version handling). The PostgreSQL rollback
probe now covers job edit/start/pause/cancel/remove, stale versions and late
completion semantics, but was **NOT RUN**. No mocked database was substituted.

Still NOT RUN: actual PostgreSQL migration/probe, HTTP lost-response replay,
permission revocation between enqueue/apply, native disk restart and receipt
ordering/removal replay, real worker subprocess/completion races, actual desktop
API-stopped and reconnect acceptance. Extend the sweep to multi-process worker
startup/recovery and crash/retry orphan-media handling; current deployment still
assumes one worker process. Full-snapshot/receipt interleavings need stress tests,
not just revision guards. Filesystem and database commit are not one transaction.

Deployment requires **both** `20261010_download_settings_version.sql` and
`20261010_download_job_control_version.sql`, then coordinated API/native rebuild.
Old control clients without revisions/idempotency keys intentionally fail closed.
Neither migration was applied here; running services/binaries and databases were
not reset, reseeded or replaced.

Remaining Downloads implementation: PC media/thumbnail replication/readiness,
tool-status cache, scoped non-admin native edit grants, browser enqueue receipt
parity and the above recovery/concurrency acceptance. See audit finding 42.

## October 11 checkpoint — uploaded-video posters and offline preview cache

Owner reported that PC-uploaded videos stay blank until playback. Source cause:
upload did not extract a poster, and Resources/embedded panels/canvas relied on a
metadata-only video element to paint a frame. This is not reliable poster creation.

Implemented, awaiting phase acceptance:

- Server extracts a JPEG poster from uploaded or server-downloaded video using
  FFmpeg, with a short-video fallback, timeout, bounded concurrency, bounded JPEG
  size, no shell, local-container/protocol allowlist, unique temporary output and
  atomic publication. Source path/size/mtime fingerprint invalidates replaced
  files. Errors never fail or roll back an already successful upload.
- Single/folder video uploads request background preparation. A protected preview
  endpoint supports existing videos too and rechecks resource access before
  delivery. It derives a preview without creating a resource or outbox mutation.
- Resources, embedded resource panels, project canvas and viewer use the shared
  poster component/hook; no hidden metadata-only video is used as the card poster.
  The viewer has a poster before playback; unsupported/missing extraction has an
  explicit placeholder. Extension classification covers generic-MIME video files.
- Desktop metadata sync/upload-cache updates trigger derived JPEG replication.
  SQLite stores bounded poster bytes per account/resource/revision. Reads are
  local-only; HTTP failure is not a local-read fallback. Native writes check the
  captured native session, active account, local lease/permission and resource
  revision. Known visibility revocation evicts derived bytes and blocks an
  in-flight stale response, even if pending authored resource work is retained.
  Resource removal prunes derived posters without deleting authored outbox work.
- UI object URLs are disposed; account changes and metadata pulls refresh/clear
  displayed previews. Tokens are never appended to resource-provided external URLs.

Checks: TypeScript, native compilation and backend syntax passed; two focused
adapter safety tests passed (no network fallback, missing cache, switched/signed-out
account, fixed-origin URL construction). No database or full GUI test was run.
The final phase sweep still needs actual FFmpeg fixtures (short/black intro,
rotation, corrupted/unsupported input), upload/folder upload, old-video repair,
replacement, concurrency/timeouts, native restart, revocation/late response and
Docker-API-stopped display. Native/API binaries were NOT rebuilt or deployed.

This batch is **video posters**, not full binary mirroring: original uploaded
files, playable video/audio/PDF copies, remote link/image thumbnails, resumable
transfer, editor copies and overall disk/retention policy remain OPEN. Cache
encryption/recovery remains part of the unfinished storage security work. Current
resource updated_at is a conservative poster-cache revision: metadata-only edits
can temporarily invalidate a poster until another successful sync. A dedicated
binary revision is needed alongside full resource-copy replication. Source-based
server preview files need bounded retention/orphan cleanup in that same work.
Status: **IMPLEMENTED / AWAITING VERIFICATION**, not a claim that Resources now
works fully offline. See audit finding 43.

## October 11 continuation — runtime startup and binary transfer foundation

The previous startup checkpoint rebuilt the Docker API and applied the additive
download job-control and settings-version migrations against existing PostgreSQL;
health returned 200 at that point. The native debug build also completed. This
supersedes the earlier poster/control entries' NOT DEPLOYED statements for those
changes, but is not runtime acceptance of their features.

At the resumed check, the Lab Inventory executable (PID 30432) has a responding
window titled Lab Inventory Management. The missing Vite frontend was restarted
and returned HTTP 200 on 127.0.0.1:1420. Docker Desktop was started, but both Docker
engine named pipes remain unavailable and API port 4000 refuses connections.
Docker's backend logs report waiting for its engine and missing VM forwarding
pipe. A read-only WSL listing also stalled. No WSL reset/shutdown, database reset,
volume deletion or reseed was performed. Do not call the server currently healthy
based on the earlier startup result. GUI content/login was not visually verified.

Implemented this continuation:

- Protected resource binary manifest and bounded conditional chunk endpoints,
  for uploaded files and server-downloaded link media. SHA-256 content revision
  is independent of metadata edits. Chunk retry is read-only/idempotent.
- Strict single ranges (4 MiB maximum), mandatory If-Match, whole-file/chunk
  digests, source replacement checks, root/realpath containment, bounded IO and
  digest cache. External resource URLs are not transfer sources.
- Current credentials, global permission and resource/ancestor access are checked
  before IO and before response. Changed sources and revoked access fail closed.
  Internal paths are omitted; closed HTTP responses are not written again.
- Contract and remaining native replication/recovery/playback steps recorded in
  ../architecture/resource-binary-replication.md; audit finding 44.

Checks: 9 focused file/handler tests passed using isolated temporary filesystem
fixtures (not mock or live database tests); source syntax and diff whitespace
checks passed. Coverage includes exact reconstruction, repeated ranges, replaced
files, empty/missing files, range/precondition validation, path traversal/junction
escape and authorization loss/source change during preparation. Fixtures alone
were cleaned up. No authored data was changed.

New binary endpoints are **IMPLEMENTED / AWAITING VERIFICATION**, not deployed in
the currently unavailable Docker engine. Actual PostgreSQL permission matrix,
load/races, native durable copies and desktop Docker-offline/reconnect acceptance
remain open. This batch does not make original resources playable offline yet.

## October 11 continuation — desktop-authored file staging

Single-file desktop uploads now use native managed files followed by atomic
SQLite metadata/outbox publication. Sync transfers resumable 1 MiB chunks using
stable IDs, verifies SHA-256 and uses the existing transactional receipt. File-create
audit entries share that transaction. Added guarded local file capabilities and a
saved-on-PC/pending-sync badge. No HTTP fallback after native-save failure.

Native build and TypeScript passed. Seven upload-adapter checks passed (including
Windows URL encoding, failure/session guards and resume), plus two staging-input
checks and nine prior binary filesystem/handler checks. These are NOT PostgreSQL
or actual WebView/offline acceptance tests. The updated desktop was launched with
owner approval; its window/process was confirmed responsive.

Docker engine remains unavailable (latest probe returned HTTP 500). The new server
migration is NOT APPLIED and API deployment is pending. Real PostgreSQL, desktop
server-stopped upload/playback and reconnect/replay/delete acceptance remain for
the phase-end sweep. Finding 45 and the binary architecture document record scoped
attachment, large-file, recovery and replication limitations. No reset/reseed or
deletion of existing storage/authored work occurred.

## October 11 recovery/deployment checkpoint — after Windows restart

Owner reported Docker recovered after restarting Windows. Confirmed PostgreSQL
and API containers healthy, then rebuilt/recreated only labos-api using the existing
Compose volumes. Migration 20261011_resource_upload_staging is now recorded in the
actual PostgreSQL schema_migrations table. API health returned HTTP 200 with API,
database and storage all ok. Frontend returned HTTP 200; updated desktop window
was started and its process confirmed responsive. No database reset or volume
deletion. This supersedes the earlier Docker-blocked deployment status, not the
outstanding real offline/reconnect functional acceptance.

Image build reported three moderate npm advisories. No forced dependency upgrades
were applied; dependency-level assessment remains in the security review queue.

## October 11 continuation — local folder uploads and manifests

Desktop uploadFolderFiles now delegates to the native file staging path instead
of multipart HTTP. Up to 200 selected files are copied before one guarded SQLite
transaction publishes all child metadata and their individual stable-ID outbox
events. Failure rolls back that metadata transaction and preserves staged bytes.
The already-created folder itself is a separate operation and may remain empty
after a failed selection; recovery/cleanup UI is still open. Server publication
remains per-file/retryable, not a whole-folder distributed transaction.

Added relative-path validation before staging and at native/server boundaries,
case-insensitive duplicate selection/existing-local-path rejection, and serialized
duplicate-path checks between sync-created server children. This does not certify
the legacy browser multipart endpoint's cross-writer overwrite behavior. Child
bytes remain stored by UUID, never by submitted relative filesystem paths.

Folder manifests now read account-scoped SQLite rows. Corrected folder creation's
snake-case/camel-case IPC parent mapping and applied the native parent authority
guard. Non-admin note/folder writes still fail closed until scoped native edit
grants are available; this batch does not relax that security boundary.

TypeScript and cargo check passed. Thirteen frontend adapter checks and three
server input-validation checks passed. These are not database tests. Actual
PostgreSQL rollback/replay, interrupted staging, multiple-client duplicate paths,
restart, offline folder viewing and reconnect acceptance remain at phase end.
No authored-file or database cleanup performed.

Deployment checkpoint: cargo build passed; updated API image deployed with existing
volumes and API/database/storage health returned HTTP 200. With explicit owner
approval, LabOS was closed and reopened on the new binary; its window was responsive
and Vite returned HTTP 200. This is startup verification only, not folder workflow
or outage acceptance.

## Remaining Phase 2 work (current)

October 9 owner-directed planning update: authentication/security findings and
remaining local projections/files/queued effects are consolidated in
PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md and the main three-phase plan. Each
offline-related change must be covered by actual desktop testing with the real
Docker API stopped, followed by reconnect verification and service-state
restoration in the October 10 owner-approved phase-end sweep.
This documentation update performed no outage test and makes no new code/security
or offline acceptance claim. Earlier mocked/static checks remain limited evidence.

- Complete the approved offline-read contract and the new scope additions in
  PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md; see the implementation boundaries above.

- Inventory relationships, legacy-event recovery and workbook parser hardening.
  New imports, history refresh and confirmed-empty initialization are implemented
  as described above; first-ever offline editing without a snapshot is not enabled.
- Remaining project/task/experiment/BOM/canvas/requirement workflows and tests.
- Finance, purchase and workbook-import transactional/retry paths.
- Binary resource staging, editor copies, downloads/thumbnails and media-job
  reconciliation.
- Online-authoritative user/auth/grant, assistant and automation retry/cache
  contracts; remaining account/media isolation, legacy export/recovery and
  revoked-pending-work recovery.
- DOCX conversion load/reliability follow-up, per-finding evidence closure and the
  remaining failure/replay/two-client verification matrix.

Finish each audited operation and its failure/two-client verification before
phase sign-off. Browser inventory/storage mutation parity is no longer on this
remaining list; it is covered by the dated checkpoint above.

Phase 3 UI/installer/restore/CI/owner acceptance remains separate. A green slice
must not be presented as completion of either whole phase.
