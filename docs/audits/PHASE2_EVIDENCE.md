# Phase 2 implementation evidence

## October 24 — project review outbox path

Native account-owned decision queue and pending-state UI connected to server sync
handler in source. No optimistic activation. 37 JavaScript and 16 native tests
PASS with actual API stopped; PostgreSQL rollback-only handler probe PASS; API
restored healthy. TypeScript/native test compile PASS. Not deployed. Whole-plan
versioning, actual sync replay and integrated persistence/UI remain acceptance
gates. Report: `docs/handoffs/phase2-parallel/PRIMARY_REVIEW_QUEUE_2026-10-24.md`.

## October 23 — review decision atomic audit foundation

Shared decision helper keeps project mutation, review event and required audit
inside the HTTP transaction. Actual PostgreSQL rollback-only success/failure
probe PASS; forced audit failure preserves original state after rollback. 32
focused tests PASS with API stopped. Source-only; native queue, stale-state
checks and idempotent replay remain open. See
`docs/handoffs/phase2-parallel/PRIMARY_REVIEW_ATOMICITY_2026-10-23.md`.

## October 23 — offline project review read

Authorized, single-statement review snapshot added to project pull, outside
financial filtering. Desktop read is local/session-bound with no HTTP fallback;
confirmed snapshot is separate from optimistic local state. 33 focused checks
PASS with actual API stopped; API restored healthy. Read-only PostgreSQL check
six projects/two events PASS. TypeScript/syntax/whitespace PASS. Source-only;
queued approvals and atomic audit fixes remain unimplemented. See
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_REVIEW_READ_2026-10-23.md`.

## October 23 — offline experiment revision snapshot

Authorized project pull now includes revision records; desktop reads them through
the account-checked local experiment reader, never HTTP fallback. Old/malformed
snapshots remain unavailable, not false empty history. Read-only PostgreSQL check
over six projects/one revision PASS; empty scope verified. API-stopped focused
suite 29/29 PASS, API restored healthy. TypeScript/syntax/whitespace PASS.
Vite production build PASS (2,262 modules).
Source-only; deployment and integrated durable-cache acceptance remain open.
Report: `docs/handoffs/phase2-parallel/PRIMARY_EXPERIMENT_REVISIONS_2026-10-23.md`.

## October 23 — experiment observation field collision

Follow-up presentation: four experiment sections distinguish unavailable/loading
from confirmed empty, preserve retained rows during refresh, and offer retry.
Unknown prose is labeled and full-record editing disabled until synchronization.
Four rendered component tests plus 16 adapters PASS with API stopped; TypeScript
PASS. Revision/history offline transport still open; no desktop deployment yet.

Primary source changes separate prose and structured records without rewriting
pending events. TypeScript/native compilation, 19 JavaScript and 19 native tests
with actual API stopped PASS. Read-only actual PostgreSQL projection check over
12 experiments PASS; API restored healthy. Not deployed or desktop-accepted.
Detailed limitations and remaining recovery work:
`docs/handoffs/phase2-parallel/PRIMARY_EXPERIMENT_OBSERVATIONS_2026-10-23.md`.

## October 23 — experiment read boundaries

Shared desktop-only collection reader rejects local misses/malformed fields and
late account results instead of using HTTP or reporting false empty arrays.
TypeScript and 15 project-boundary tests PASS with API stopped, restored healthy.
Source-only; broader projection/observation schema/UI work remains. Report:
`docs/handoffs/phase2-parallel/PRIMARY_EXPERIMENT_READ_BOUNDARIES_2026-10-23.md`.

## October 23 — coordinated sync-safety deployment

Runtime isolation, strict preflight and account-bound native queue reader deployed
together. TypeScript/Vite/native builds PASS; 28 frontend + 12 native tests PASS
with actual API stopped and restored healthy. Existing data/volumes preserved;
new executable launched. Integrated desktop acceptance remains open. Report:
`docs/handoffs/phase2-parallel/PRIMARY_SYNC_SAFETY_DEPLOYMENT_2026-10-23.md`.

## October 23 — native queue-status account boundary

Added counts-only expected-account/lease-checked native command; preflight and
panel use it with no fallback. TypeScript/native test build PASS. With actual API
stopped: 28 frontend + 12 native local_db tests PASS, then API restored healthy.
Source-only; no full desktop/two-login or A1 closure. Report:
`docs/handoffs/phase2-parallel/PRIMARY_NATIVE_QUEUE_STATUS_2026-10-23.md`.

## October 23 — fail-closed local queue preflight

Removed false-zero fallback from count helpers. Failed preflight stops before
pending reads/transfers/server work and schedules retry; positive unattributed
counts remain protected. TypeScript and 28 focused tests PASS with API stopped,
then restored healthy. Source-only; integrated acceptance remains open. Report:
`docs/handoffs/phase2-parallel/PRIMARY_SYNC_PREFLIGHT_2026-10-23.md`.

## October 23 — account-scoped sync status/backoff

Primary replaced shared operational status/retry reads with account-keyed state
and login-generation-checked updates, fenced awaited sync preflight and blocked
cross-login sharing of an active run. TypeScript and 25 focused tests PASS with
actual API stopped, restored healthy. Source-only; no integrated desktop or A1
closure claimed. Report:
`docs/handoffs/phase2-parallel/PRIMARY_SYNC_RUNTIME_ISOLATION_2026-10-23.md`.

## October 23 — compact sync read accuracy and coordinated deployment

Strict status count reads and request/session guards added to compact panel.
Recovery index and full-page guards deployed together after saved-edit approval.
TypeScript/Vite/native build PASS (existing unused helper warning). 18 focused
adapter/gate/render tests PASS with API confirmed stopped. Existing PostgreSQL/API
restarted healthy, original volumes preserved. No real two-login GUI acceptance
or parent closure claimed. Report:
`docs/handoffs/phase2-parallel/PRIMARY_SYNC_PANEL_READS_2026-10-23.md`.

## October 22 — conflict/recovery view lifetime

Primary added latest-request/account-session guards, authentication-event clearing
and guarded resolution continuations. TypeScript PASS; **15 focused tests PASS**
with the actual API stopped, then restored healthy. Mocked adapter/render tests
are not full desktop two-login acceptance. Source-only, no parent closure. Report:
`docs/handoffs/phase2-parallel/PRIMARY_CONFLICT_VIEW_LIFETIME_2026-10-22.md`.

## October 22 — metadata-only recovery index

Primary added account/lease-bound native recovery receipt index and a read-only
conflicts-page section. No names, payloads or old grants exposed; no automatic
restoration/export. TypeScript/native build PASS; actual API stopped for **12
adapter/render + 10 native tests PASS**, then restored healthy. Source-only;
desktop acceptance and payload inspection/export remain open. Report:
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_RECOVERY_INDEX_2026-10-22.md`.

## October 22 — project-history/conflict coordinated deployment

Owner-approved API and native/UI deployment completed; existing storage/database
and local data preserved. TypeScript/Vite/native build PASS. Deployed PostgreSQL
23 focused + 29 handler checks PASS, rollback verified; 11 adapter/render PASS.
Rebuilt desktop launched, API healthy. This supersedes source-only deployment
notes below, not outstanding integrated GUI/recovery/concurrency acceptance.
Report: `docs/handoffs/phase2-parallel/PRIMARY_CONFLICT_DEPLOYMENT_2026-10-22.md`.

## October 22 — conflict account/session fence

Primary bound conflict reads/resolutions to expected account and rejected late
renderer-session results; native mutation rechecks inside SQLite transaction.
TypeScript/native compile PASS; with real API stopped **11 adapter/render + 9
native checks PASS**. API restored healthy. Existing October 21 desktop launched
on request, not replaced with source changes. Coordinated UI/native deployment and
two-login desktop acceptance remain open. Report:
`docs/handoffs/phase2-parallel/PRIMARY_CONFLICT_ACCOUNT_FENCE_2026-10-22.md`.

## October 22 — project conflict action guidance

Both sync views now use shared project-specific retry guards, explicit cancellation
or status-resolution labels and preservation/authorized-sync explanations. Native
authority unchanged. TypeScript PASS; **7 pure/render tests PASS** with actual API
stopped, restored healthy afterward. Not deployed or visually accepted. Recovery
listing/export and integrated reconciliation remain open. Report:
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_CONFLICT_GUIDANCE_2026-10-22.md`.

## October 22 — native project deletion conflict recovery

Primary added protected-deletion/lifecycle retry guards and account-scoped recovery
evidence saved atomically with explicit deletion retirement. Original payload and
other pending work remain intact; cached permissions are not restored. Native
test build and **8 local_db tests PASS** with actual Docker API stopped, including
disk reopen and storage-failure rollback. API restarted and healthy. Source only;
full GUI/reconnect/recovery export and parent B4/A2 acceptance remain open. Report:
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_DELETE_RECOVERY_2026-10-22.md`.

## October 22 — project financial and scientific history protection

Primary extended the shared transactional project-delete guard to preserve
transactions, purchases, salvage and scientific evidence, including indirect
experiment links and cleared-current-result revision history. Real PostgreSQL
rollback-only checks: **23 focused PASS**, **29 handler PASS**, no failures.
No deployment or outage claim; integrated/native recovery and concurrent-client
acceptance remain open. B4 remains PARTIAL. Report:
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_RECORDED_HISTORY_2026-10-22.md`.

## October 21 — coordinated lifecycle deployment completed

Owner approved saved-edit API update and desktop launch. Lifecycle migration
applied, frontend/native builds passed, API/DB/storage healthy and existing volumes
retained. Rebuilt desktop process launched/responding (not visual acceptance).
Deployed helper **12 PASS** and handler **27 PASS**, rollback verified. Three
moderate dependency advisories reported by image build remain for triage. Earlier
source-only lifecycle/deployment notes below are superseded by this checkpoint;
full B4 and phase acceptance remain open. Details in
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_LIFECYCLE_2026-10-21.md`.

## October 21 — connected project lifecycle batch

Primary implemented revision-fenced cancellation/completion/archive propagation,
inventory-only settlement projection and native pending UI state. Unused allocations
release server-side; issued custody, fulfillment and work/history are not fabricated
or erased. Existing PostgreSQL: **12 focused checks PASS**, **27 sync/browser
handler checks PASS**, rollback verified. With API stopped: **5 project + 38
inventory tests PASS** (2 opt-in ignored); **7 adapter checks PASS**, TypeScript,
native test compile and syntax checks pass. API restored. Source only: additive
migration and native/UI deployment pending. B4 remains PARTIAL; see limits in
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_LIFECYCLE_2026-10-21.md`.

## October 21 — project inventory-history deletion safeguard

Primary added a shared transactional guard to sync and browser project deletion:
projects with custody (including settled custody), stock movements or reservation
fulfillment cannot be deleted. Existing PostgreSQL rollback-only checks: **6
focused PASS**, **25 full sync-handler PASS**, no failures. Rejected sync deletion
preserves history and creates neither tombstone nor success receipt. Not deployed;
browser/desktop end-to-end acceptance and remaining cancellation/archive/settlement
work remain open. B4 stays PARTIAL. Report:
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_HISTORY_GUARD_2026-10-21.md`.

## October 21 — reservation review retry defect and deployed acceptance

Primary's extended native/HTTP test exposed an unsupported conflict domain for
reservation retries. Fixed with project access and request/review role checks;
original intent identity/payload retained. Full live rerun: **1 PASS**, including
offline request/approval, allocation rejection, release, unchanged retry, replay
and no approval authority from ACK alone. Native inventory regression with API
stopped: **38 PASS, 2 opt-in tests ignored**. Fixture cleanup independently verified
and API healthy. Source fix awaits next production desktop build; no GUI or parent
B1/B3/B4 closure claimed. Report:
`docs/handoffs/phase2-parallel/PRIMARY_RESERVATION_REVIEW_ACCEPTANCE_2026-10-21.md`.

## October 21 — deployed native/HTTP consumption reconnect acceptance

Primary completed the combined isolated disk-SQLite -> deployed HTTP -> existing
PostgreSQL -> native reconciliation test: **1 PASS, 0 FAIL**. API stopped during
local consumption; disk reopened after restart. Lost ACK replay and repeated
project/inventory pulls converge at stock 8 and reservation 4, without a second
debit. Disposable fixture cleanup succeeded; independent query found zero probe
users/items/projects. API healthy afterward; desktop process remains responding.
This bounded subcase is VERIFIED CLOSED, not GUI/login acceptance or parent
B1/B3/B4 closure. Report:
`docs/handoffs/phase2-parallel/PRIMARY_RESERVATION_HTTP_ACCEPTANCE_2026-10-21.md`.

## October 21 — reservation reconciliation boundaries and API deployment

Primary added disk-SQLite checks for both ACK/pull orderings after reopen and
repeated project/inventory snapshots: **37 native tests passed**, one live-server
test ignored, with API stopped. Real PostgreSQL source handler batch **24 passed**,
rollback verified, including exact consumed movement IDs and request receipts in
project pull. These separate boundary tests do not constitute a combined GUI
round-trip. User approved saved-edit restart and coordinated data-preserving
deployment. Updated API image deployed; API healthy, existing volumes retained,
three pending October 17/20 migrations completed. TypeScript and Vite production
assets built successfully. Locked offline native dev build passed; rebuilt
development executable launched using existing app data. Installer was not
replaced; complete GUI/reconnect acceptance remains open.
Report: `docs/handoffs/phase2-parallel/PRIMARY_RESERVATION_RECONCILIATION_2026-10-21.md`.

## October 21 — native reserved consumption (B1/B3/B4)

Primary removed desktop fulfillment's direct HTTP path in source. Explicit
consumption now uses the native atomic stock/allocation-overlay/movement/outbox
transaction, without creating custody. Submission identity survives retries;
duplicate saved movement IDs cannot debit twice. Pending review and returnable
equipment guards remain native. With API confirmed stopped: **36 native inventory
tests passed, 1 live-server test ignored; 54 adapter tests passed**. TypeScript and
diff checks passed. API restored and healthy. No deployment, reset or parent
closure. Combined native-to-server reconnect and GUI acceptance remain open.
Report: `docs/handoffs/phase2-parallel/PRIMARY_RESERVED_CONSUMPTION_NATIVE_2026-10-21.md`.

## October 21 — reserved consumable sync contract (B1/B3/B4)

Primary extended the existing inventory sync handler to consume a matching
non-returnable reservation without creating custody, retaining allocation floors,
project authority, exact quantity arithmetic and atomic receipt/history writes.
Real existing PostgreSQL handler batch: **23 PASS, 0 FAIL**, rollback verified.
An initial fixture-version assertion was corrected and the entire batch rerun.
Desktop fulfillment still uses HTTP: native transaction/adapter integration and
stopped-API acceptance remain open. No deployment, data replacement or parent
checklist closure. See
`docs/handoffs/phase2-parallel/PRIMARY_RESERVED_CONSUMPTION_SERVER_2026-10-21.md`.

## October 21 — native reservation intentions and recovery safeguards (B1/B3/B4)

Primary verified SQLite/outbox request and review intentions, pending-action UI
guards, ACK-before-pull retention, and rejected-review recovery without restoring
stale stock authority. Fixed an undeclared date dependency exposed by compilation.
With the Docker API confirmed stopped: **34 native inventory tests passed, 1
live-server test ignored**, **4 project tests passed**, **53 adapter tests passed**,
and TypeScript passed. API restored afterward; existing PostgreSQL sync-handler
probe **20 passed, 0 failed**, outer rollback verified. This probe does not exercise
HTTP/authentication middleware or simultaneous independent clients. Native GUI
acceptance and full intention-to-pull lifecycle remain open; no deployment or
desktop restart performed. Parent checklist counts unchanged.

Report: `docs/handoffs/phase2-parallel/PRIMARY_RESERVATION_INTENTS_NATIVE_2026-10-21.md`.

## October 20 — reservation request/review sync contract (B3/B4)

Primary added `project_reservation` request/decision handling through the existing
sync broker. Stable IDs, immutable receipts, active database authority, allocation
locking/quantity checks and mandatory audit share one transaction. Releasing a
reservation does not create a physical return. Full existing PostgreSQL handler
batch **20 PASS**, rollback verified; syntax/diff checks pass. An initial audit
context defect was fixed and the entire batch rerun. No deployed source or data
replacement. Native intention persistence/projections and UI wiring remain open;
queued confirmations must not grant effective offline authority. No new native
outage acceptance or concurrent-client claim. Parent counts unchanged.
Report: `docs/handoffs/phase2-parallel/PRIMARY_RESERVATION_INTENTS_SERVER_2026-10-20.md`.

## October 20 — reserved-stock checkout UI (B1/B3)

Primary agent connected the confirmed reservation list to a centered native HTML
dialog (body portal) for recipient, partial quantity, optional single-unit serial
and handover note. Submission rechecks current permissions, reservation, inventory,
recipient directory and session, then calls the existing movement adapter/native
SQLite+outbox transaction. No direct reservation checkout HTTP fallback was added.
Synchronous submission guard prevents double clicks; success prevents resubmission
and invalidates allocation/stock/custody/history queries. Physical issue is not
labeled consumption. Native/server authority checks remain the final enforcement.

API stopped for verification: **52 adapter tests PASS**, native inventory
**30 PASS / 1 IGNORED**. TypeScript passed. The ignored two-client integration case
and actual modal interaction/deployed reconnect acceptance remain unverified.
No DB tests substituted a server mock for PostgreSQL; this batch changed renderer
code and reused the previously verified native/server contracts. API restored;
no database reset, deployment or desktop restart. Remaining request/review/direct
consumption intents, cache integration, lifecycle/settlement and broader B1/B3
obligations remain open. Optional task/experiment selection is not in this dialog
yet; project/reservation provenance is recorded. Parent counts unchanged.

## October 20 — primary native reserved-custody projection (B1/B3, A1/A5)

Native reservation-backed issues now validate cached project authority, allocation,
quantity and work/requirement provenance, then commit stock/custody/movement/outbox
and an allocation overlay atomically. Project pulls include reservation quantities
and fulfillment IDs from one PostgreSQL statement. Overlays survive ACK/restart;
included movement IDs prevent double deduction. Explicit conflict retirement
archives overlays atomically and retains authored payloads. Returns do not reopen
allocations. Desktop reservation reads now use native projected snapshots with
account/session guards and no HTTP fallback; missing is not empty.

Real PostgreSQL handler batch **14 PASS**, rollback verified. Docker API stopped
for native checks: inventory **30 PASS / 1 IGNORED**, projects **4 PASS**, local DB
**4 PASS**. Adapter batch **48 PASS**; TypeScript, backend syntax and diff checks
passed. Ignored two-client integration is NOT verified. API restored; no deployed
migration, desktop restart, reset or user-data deletion. Checkout UI, remaining
reservation mutation intents/read-after-write integration and coordinated desktop
outage/reconnect/concurrency acceptance remain open. No whole-parent closure.

Detailed primary report:
`docs/handoffs/phase2-parallel/PRIMARY_RESERVED_CUSTODY_NATIVE_2026-10-20.md`.

## October 20 — primary reserved-custody server foundation (B1/B3)

Server checkout now validates a matching confirmed reservation, current project
editor authority and canonical work references, then atomically records physical
issue, custody, remaining allocation and fulfillment history through the existing
inventory broker. Returns preserve custody project provenance without re-opening
reservations. Other allocations remain protected; receipt retry is unchanged.

Fixed source request INSERT missing original_quantity; added a data-preserving
zero-remaining-only-when-fulfilled migration and aligned HTTP item/reservation
lock order. Presentation says fulfilled rather than assuming consumption.
Final real PostgreSQL handler batch **13 PASS / 0 FAIL**, including earlier eight
checks; fixture and constraint rollback verified. No HTTP/concurrency or native
offline reservation acceptance claimed. Migration/source NOT deployed; existing
running API/DB left running, data preserved. Native reservation projection,
pending/rejected reconciliation and checkout UI remain CODE REMAINING.

Evidence: `docs/handoffs/phase2-parallel/PRIMARY_RESERVED_CUSTODY_SERVER_2026-10-20.md`.
No parent status or phase closure changes.

## October 19 — primary project relationship guards (B3/B4/A1)

Native task/experiment/BOM requirement references and work/canvas endpoints now
validate within the owning project before nested writes. Server sync independently
checks requirement ownership, uses stored project ownership for edit/delete, and
binds task/experiment link deletion to its project/endpoints. UUID normalization
leaves original retry payloads unchanged. Fixed connector updates referencing a
nonexistent timestamp column, discovered by a legitimate-update PostgreSQL check.

Native project checks **4 PASS** with LabOS API/DB stopped. Final expanded real
PostgreSQL push-handler batch **8 PASS**, rollback verified; full batch rerun after
the connector failure. Not HTTP/auth-middleware, concurrent-client or deployed UI
acceptance. Project post-commit audit atomicity remains open; the probe isolates
its real audit implementation within the rollback transaction. No data reset,
deployed-source replacement or desktop restart. Containers returned to stopped.

Reservation-backed issue/local allocation, direct API parity, demand aggregation
and lifecycle settlement remain CODE REMAINING. No parent or phase closure.
Report: `docs/handoffs/phase2-parallel/PRIMARY_PROJECT_RELATIONSHIP_GUARDS_2026-10-19.md`.

## October 19 — primary custody sync replay and rejection preservation (B1/A2)

Current push handler + inventory apply/version/audit/receipt code exercised on the
existing PostgreSQL inside a rollback-only transaction: **5 PASS, 0 FAIL**. Verified
issue/return/transfer replay, identity/payload ownership, rejected dependencies and
excess settlement, and rollback/retry at receipt-write failure. Real SQL and handler
logic; transport/auth middleware are not exercised and concurrency is not claimed.
Fixture/schema rollback verified; deployed API untouched.

Fixed local explicit-resolution gap: connected rejected inventory projections are
archived under the owning account; original outbox payloads remain retained; active
custody is invalidated and affected stock writes wait for an authorized server pull.
Archive failure rolls back resolution. Native inventory **24 PASS, 1 IGNORED**;
related local DB **4 PASS**, workbook import **3 PASS**, receipt processing **3 PASS**.
Native checks ran with both real Docker containers stopped. Containers were initially
stopped, temporarily started for PostgreSQL checks, then restored to stopped.
Not deployed. Recovery UI/export/retention, multi-client/native-network acceptance
and project/reservation coupling remain open. No parent closure.
Evidence: `docs/handoffs/phase2-parallel/PRIMARY_CUSTODY_SYNC_RECOVERY_2026-10-19.md`.

## October 19 — primary native custody persistence follow-up (B1)

Native inventory regression batch: **21 PASS, 0 FAIL, 1 IGNORED**, with actual API
stopped then restored; PostgreSQL left running. Eight new on-disk SQLite tests
exercise the production transaction core, reopen durability, rollback at each
write boundary, pending cache preservation, author/version dependencies,
authorization failures, duplicate IDs, stale competing writers and transfer
rollback. Fixed wrong-item custody-cache acceptance; also reject duplicate and
cross-item custody identities. Initial failures/harness corrections are recorded.
No deployment or data reset. Native persistence subcheck verified; integrated
server replay/conflict reconciliation and wider B1/B3 remain open. B1's stale
PLANNED label is reconciled to PARTIAL, not closed.
Evidence: `docs/handoffs/phase2-parallel/PRIMARY_CUSTODY_REPAIR_2026-10-19.md`.

## October 19 — primary custody quantity/transaction repair (B1)

Dedicated account-bound native custody writer now persists item/movement/custody
and outbox together; newer UI cannot silently call an older generic writer.
Partial return/consumption/transfer arithmetic and pending custody cache protection
implemented. Server inserts movements before dependent custody rows; real PostgreSQL
testing also caught and resolved a numeric SQL parameter defect. Final rollback-only
PostgreSQL batch: 8 PASS, schema/fixtures rolled back. Native calculation tests:
4 PASS. Renderer batch: 55 PASS with API actually stopped, then restored healthy;
PostgreSQL left running. TypeScript and cargo check PASS. Not deployed; new native
SQLite persistence was pending at this checkpoint (follow-up above); integrated
server replay, concurrency and broader B1/B3 integration remain open.
No parent closure. Primary evidence:
`docs/handoffs/phase2-parallel/PRIMARY_CUSTODY_REPAIR_2026-10-19.md`.

## October 18 — primary inventory account/read guard repair (A1/B6)

Primary repaired H1-4 helper-review read guards across movements, field history,
assignment history, custody and assignees. Session checks cover asynchronous
returns; transport/5xx fallback rereads native authorization; HTTP refusal,
malformed data and cache failures no longer return captured rows. Missing offline
snapshots remain distinct from empty snapshots. History/movement panels mask
retained failed-query data and partition keys by account/login generation.
53 Node contract/component checks PASS; TypeScript and scoped whitespace check PASS. Docker
engine unavailable, so no live PostgreSQL/native outage acceptance claimed.
Not deployed; custody/salvage write repair and broader B6 local-read refresh
decoupling remain open. Full primary evidence:
`docs/handoffs/phase2-parallel/PRIMARY_INVENTORY_READ_GUARDS_2026-10-18.md`.

## October 18 — silent refresh presentation repair

Primary repaired atomic local-file capability refresh, identical-poster URL reuse
and race/session cleanup. Ten page refresh indicators now respond to explicit
user refreshes rather than automatic query reads; report/finance chart animation
is disabled and the local read timestamp is available in a tooltip without
changing visible notice text every poll. Initial loading, errors, actual data
changes and authorization checks remain intact. No outbox/backend/schema changes.
34 focused checks passed, including a repeat with the actual Docker API stopped;
API restored and healthy. These are contract checks, not native visual acceptance.
Expanded final regression batch: 45 PASS. TypeScript, scoped diff checks and
isolated frontend bundle (2,254 modules) passed. Subsequently deployed a narrowly
selected candidate from committed native baseline plus reviewed presentation/build
changes, excluding unfinished helper domain/audio integration. Candidate checks:
55 PASS, TypeScript/Vite PASS, native compile PASS. Restarted the actual desktop;
Dashboard loaded local data and showed the new static snapshot notice. Full
no-blink visual acceptance remains open. Docker was unavailable after the pause;
no API/database changes were made by this restart. Full evidence:
`docs/handoffs/phase2-parallel/PRIMARY_SILENT_REFRESH_2026-10-18.md`.

## October 18 — download metadata correction deployed narrowly

Primary verified the newly reported completed video on the real PostgreSQL/server:
3,361,603 actual bytes; existing two videos also exist with matching recorded sizes.
The deployed resource SELECT still omitted media fields, and read-only desktop
SQLite had null media metadata and no PC copy entries. Confirmed the October 17
source fix was not running. Built/deployed a one-file correction on the existing
API image, excluding unreviewed custody/salvage changes. API/DB healthy, existing
storage/database volumes unchanged. Running image:
`sha256:c98e503aafc4d0eaf62e0d924e5fb57066fff352920fcae18e31e7fcc84307b3`.
Actual deployed SELECT against PostgreSQL now returns canonical download metadata.
Backend regression batch: 6 PASS. Following owner sign-in, natural sync populated
all three existing resources and produced ready PC copies. Actual PC/server byte
counts and independently calculated SHA-256 match for all three (3,361,603;
8,147,966; 93,958,024 bytes). Resources shows Local and Downloaded. With the actual
Docker API stopped, the newest video opened and loaded a frame through the native
local-file handler. Advancing playback was NOT established: desktop-control bounds
failed during Play interaction and user activity subsequently closed the viewer.
API restored and confirmed running/healthy. Cold restart and reconnect/replay
duplicate acceptance remain open. No whole item closed; no data reset or manual
SQLite repair, and no provider redownload.
Full evidence and rollback identity:
`docs/handoffs/phase2-parallel/PRIMARY_DOWNLOAD_DEPLOYMENT_2026-10-18.md`.

## October 17 — primary startup and grouped build/audio/report repairs

Later checkpoint superseding the compile/audio failures recorded below, not the
remaining integration findings. Primary launched the existing desktop directly
(PID 12592); no dev watcher, API deployment, database reset or native rebuild.
Build icon materialization now skips identical bytes (3 standalone Rust tests
PASS). Reports fixture syntax is repaired and global device sync time is no longer
misrepresented as report freshness; account/domain watermarks remain open.
Audio displaced-owner callbacks, reset token uniqueness and ownership snapshots
are repaired. Resource media hook now pauses on denied/preempted focus. Broken
Jest scaffold was replaced by Node tests rather than excluded from type-checking.

Focused desktop batch: 39 PASS (10 audio, 10 Reports, 19 existing inventory cases).
Combined TypeScript `--noEmit`: PASS. Scoped diff check: PASS. Total with Rust: 42.
These are unit/contract/build checks, not real PostgreSQL, Tauri audio or Docker-
stopped acceptance. Current executable does not contain this source repair batch.
H1 custody/salvage gaps, H2-3 TTS/microphone/music integration, durable freshness,
and download fix deployment/live verification remain open. No parent item closed.
Detailed attribution and boundaries: `docs/handoffs/phase2-parallel/PRIMARY_REVIEW_2026-10-17.md`.

## October 17 — primary download projection repair and helper review

Primary changed only the canonical resource pull SELECT in `backend/src/routes/sync.js`
to include the five downloaded-media fields written by the server worker. Previously
Downloads could show completion while resource metadata omitted the filename/date
needed for Resources state and PC replication. Permission/visibility filters remain;
server completion does not establish verified PC bytes. No data was reset or repaired
directly, and no deployment occurred in this checkpoint.

New route-contract tests plus visibility regressions: 6 PASS. Existing desktop
replication/device-state tests: 12 PASS. Backend syntax and scoped diff check PASS.
These are unit/contract checks, not real PostgreSQL/Tauri acceptance. Docker API/DB
were observed healthy, but the subsequent elevated read-only database inspection
was not executed because automatic approval review hit its usage limit. Deployment,
real records, API-stopped/cold-restart and reconnect/playback verification remain open.

Independent helper review is recorded in
`docs/handoffs/phase2-parallel/PRIMARY_REVIEW_2026-10-17.md`. Both deliveries require
changes: custody local intent/server ordering and salvage offline/provenance gaps,
plus audio ownership/build blockers. Two new primary audio contract regressions
FAIL; combined TypeScript checking FAILS. Helper completion claims do not promote
B/C or transferred A items. All delivered changes are preserved for grouped repair.
Follow-on collection: 19 existing inventory boundary/HTTP checks PASS, but the
newly edited Reports test file fails parsing before any Reports tests execute.


Status: **in progress, not Phase 2 sign-off**. Existing application and seeded
PostgreSQL are preserved. Tests create scoped fixtures; no database reset.

## October 16 — coordinated desktop frontend/API deployment

### Follow-up: A6 queue-reader failure and existing-resource recovery

- Runtime root cause reproduced against the actual desktop SQLite database:
  `active_sync_outbox` is a view and does not expose implicit `rowid`.
  `pending()` ordered by `o.rowid`, so every native download projection failed,
  including settings/tools/history and the pre-enqueue read. A valid, complete
  server snapshot existed with zero jobs; the active account had no download
  intentions. Saved resource metadata was not proof of a queued request.
- Native fix joins the account-filtered view to its base outbox table solely to
  obtain insertion order. Account/lease filtering, immutable events and atomic
  enqueue remain; no schema migration, reset or HTTP-write fallback.
- The initial Queue download / View queue resource-card workaround was deployed,
  then rejected by the owner. It is superseded by automatic Downloads intake
  below. Download queries remain account-generation keyed; native string failures
  become readable errors, not claims that no snapshot was ever synchronized.
- Checks: 26 focused frontend adapter/presentation/component checks passed;
  TypeScript passed; Vite built 2,250 modules. Scoped diff whitespace check passed
  (unrelated pre-existing visual-agent whitespace remains outside these files).
- Native 9 Downloads tests passed, including two opt-in tests against the real
  desktop database: read-only full snapshot/other-account rejection and a real
  enqueue/read/retry transaction that was explicitly rolled back. Same-resource
  uppercase-UUID retry returned the same job ID and one pending event; rollback
  verification found no test job left behind. The API was stopped for this run
  and restored in a finally block; PostgreSQL/storage stayed intact. SQLite is
  required to reproduce this native query defect, not a PostgreSQL substitute.
  An earlier sandboxed read probe failed accessing WAL files; the approved
  read-only rerun passed. These are not full PostgreSQL worker acceptance tests.
- Initial corrected executable SHA-256:
  `27EFE62025C2A00A9A96B2B1D436B517D5056A560086841F98BDBB4AD16DCE95`.
  Native cold start with the API stopped showed the complete saved queue (zero
  jobs), saved schedule/settings and saved tool checks. Resources queue buttons
  were visible on saved links; no user resource was enqueued by this check.
  API was restored. A fresh container media-tool inspection at 16:22 UTC passed
  yt-dlp, FFmpeg and Node; the earlier cached warning did not reproduce.
  Full A6 remains PARTIAL, not worker/reconnect acceptance.

### Owner correction — automatic Downloads intake, no Resources enqueue step

- Contract: adding a supported media link makes it visible in Downloads as
  **Awaiting schedule**. Listing a link is not permission to start a worker.
  Quality and timing are selected in Downloads; no resource-card queue button
  or optional Add Resource & Queue checkbox remains.
- Native Downloads reads now include every authorized local link, including
  project/note/folder links, in the same SQLite read transaction as jobs and
  pending events. The resource row is the durable intake record: there is no
  second persistence write to lose, no read-triggered enqueue and no HTTP fallback.
- Existing undownloaded supported links are included automatically. Canonical
  UUID matching excludes resources already represented by any job, including
  cancelled/failed/conflicted history; refresh cannot resurrect cancelled work.
  Removing a resource from local state removes its intake row. Clearing history
  can make an undownloaded resource eligible again, but never starts it.
- Scheduling calls the existing local download command/outbox for the same
  resource ID. Native/server permissions and retry deduplication remain in force.
  A deduplicated job with a different schedule is reported honestly, not treated
  as proof that the new requested time was applied. Browser intake uses existing
  authorized resource/folder reads and the browser enqueue path.
- Focused checks: 28 frontend tests passed (intake projection 7, intake component
  5, local adapter 8, image thumbnail 4, download preview 4); TypeScript passed.
  Vite built 2,252 modules. Frontend index SHA-256:
  `57ABC039843317F4F5E2CE5352E066F2338B433F6CB4D371469F811C9BFB7C28`.
- A4 companion change: native image cards use an authorized PC file URL or an
  explicit unavailable/error state, never an HTTP fallback. Attached Resources
  panels now prefer the local video poster for downloaded links and display file
  availability. Broader preview/export acceptance remains open.
- Native stopped-API regression: all 9 Downloads tests passed, including actual
  read-only desktop SQLite inspection of all saved links and a rollback-only
  scheduled enqueue/uppercase-UUID retry. The request retained its selected time,
  was visible as scheduled/pending sync, and retry returned one job/event. Explicit
  rollback left no test request behind. API restored in finally; PostgreSQL and
  storage were not stopped/reset. Owner confirmed saved edits and restart.
- Deployment briefly hit an approval-service usage-limit error (nothing executed).
  Following the owner's continue, the approved restart/build retry was accepted;
  native build completed in 2m29s and the updated executable launched as PID 14528.
  Executable SHA-256:
  `474218E6CD4EF35DF572B81E539ED34F6AD90023B1C48F3F493030C344AA5290`.
  The API-stopped cold launch reached sign-in; the user was entering credentials,
  so no authentication UI was automated. API was restored and `/api/health` at
  21:32:51 UTC reported API/database/storage healthy. Native Downloads visual
  acceptance awaits completion of user sign-in; this is not an offline UI pass.
- User completed sign-in. Native Resources inspection confirmed six resources,
  no Queue download buttons, preserved YouTube/Facebook links, and uploaded video
  poster/image cards. Downloads navigation could not be verified: the computer-use
  helper reported `point (41, 254) is outside window bounds ... width: 12, height: 12`
  despite a normal app screenshot. One fresh-window rebind/retry returned the same
  error, so UI inputs stopped. API remains restored/healthy; app remains running.
  Downloads visual acceptance and a fresh stopped-server UI run remain open;
  automated stopped-server native checks passed as documented above.

- Root cause of the browser/Tauri assistant mismatch: Cargo enables
  `custom-protocol` by default. Tauri codegen therefore embeds `distDir`, even in
  the debug executable, instead of loading `devPath`. The October 13 executable
  retained old frontend assets. Native-window inspection before rebuild confirmed
  the boxed options button, header context text and old scoped-context footer.
  A current Vite page did not establish desktop freshness.
- Added `desktop/package.json` command `build:desktop:debug` to serialize
  TypeScript/Vite build before native compilation; documented the distinction in
  `docs/DESKTOP_FRONTEND_BUILD.md`. No change to the embedded/offline deployment mode.
- TypeScript passed. The first sandboxed Vite attempt failed reading its config;
  the escalated build passed (2,248 modules). An early native compile overlapped
  frontend generation; a second native compile was explicitly started after the
  assets completed. Only that final executable is eligible for launch verification.
- Owner confirmed saved edits/restart and matching API deployment while preserving
  all data. Old API workers were stopped before replacement. Existing PostgreSQL
  and storage volumes were retained. API image:
  `d3f18cda2f32457b6c92ebd092ba42f03ccb471cd927e5518ef0d519f2f1874a`.
  Its 29 focused confirmation/queue/worker/process/tool tests passed in a disposable
  no-network container without data volumes. These are not DB acceptance tests.
- Predeployment PostgreSQL custom-format backup:
  `deploy/backups/20261016-ui-sync/postgres.dump` (git-ignored), SHA-256
  `0A4C9CE1BE02BD084ADAF3F9B55A547FEC30FAB1A8F315B7648D175E23FBBC40`.
  Archive listing succeeded (497 TOC entries); this is not a restore test. This
  backup contains database records, not a new backup of stored file bytes.
- Migration `20261014_download_worker_attempt` applied successfully. Read-only
  actual PostgreSQL checks confirmed its ledger entry, UUID `worker_run_id` column
  and `download_job_tombstones` table. API/database/storage health returned 200/ok;
  existing download job count was zero before deployment. No reset or reseed.
- Built frontend entry: `index-H0zixElD.js`, SHA-256
  `74DF7EE55C1A8661E881A53E6F525FF8DC4C011F6E58EA603200DF232D08305A`.
  Styles: `index-GIIW4lsi.css`, SHA-256
  `12CFCA2C3990126A324CAF164AE1EB57B4A46EEA19B45AAAC93B5FF3F585D0BC`.
- Final native build passed; executable SHA-256:
  `527B486648C47184B0F5876E73765901FC6327D7248FACC9F90DD769D594E1CD`.
  Launch verification resumed October 16 after the earlier interrupted/blocked
  attempts. Native PID 29520 opened successfully. Screenshot and accessibility
  inspection of `https://tauri.localhost/#/downloads` confirmed the new bottom-left
  context selector, separate read-only badge and compact header options; the old
  scoped-context footer is absent. This verifies the embedded visual update, not
  all visual-agent changes or context-selector interactions.
- At 06:54:46 UTC, API health reported API/database/storage ok and both existing
  containers were healthy. The desktop sync indicator changed to "Synced just
  now", but Downloads still reported unavailable settings, queue, history and
  tool status. This remains an observed A6 defect, not an empty queue or a passed
  acceptance check. No database or file reset was performed.
- Phase 2 offline/reconnect, historical receipt and
  dashboard parity acceptance remain separate and open. Visual-agent scope and
  semantic corrections are still tracked in its PRIMARY_REVIEW, not approved here.

## October 16 — exact file-intent confirmation (A1/A5 prerequisite)

- File confirmation now negotiates protocol 2 explicitly. The server returns a
  digest of the committed payload only when its upload protocol, resource identity,
  content hash and size are valid and consistent with the historical result.
  Protocol-1 clients retain the existing response shape; mutation receipts are
  unchanged. Raw payloads and storage paths are not disclosed.
- The updated native verifier requires protocol 2 and compares that digest with
  the exact saved outbox payload, including content hash and predecessor intent.
  Matching resource ID/size alone is insufficient. Protocol downgrade, missing
  proof and altered intent leave work pending; there is no generic-ACK fallback.
  The trusted API origin is rechecked after the network request before commit,
  alongside the existing native session/lease and pending-work checks.
- Verification: backend confirmation tests **10 passed**; native
  `local_resource_authority::tests` **19 passed** (native test build passed);
  frontend confirmation adapter tests **5 passed**. Backend syntax and scoped
  diff whitespace checks passed. These are 34 focused pure/adapter checks, not
  database or full desktop acceptance tests.
- No receipt-history migration or legacy ACK reconciliation was added. This
  hardens new pending-file confirmations; it does not upgrade old stored receipts
  or finish mixed content/attachment chains. A1/A5 remain PARTIAL. Actual PostgreSQL,
  stopped-API cold restart and lost-response/reconnect acceptance remain NOT RUN.
- Existing desktop executable and frontend were started at the owner's request;
  API and PostgreSQL containers reported healthy. No new native executable/API
  deployment, database reset or pending-work cleanup. The opened desktop is not
  evidence that this source change is deployed. Updated native code needs the
  compatible API before protocol-2 confirmation can succeed.
- Separate visual contributor review: see
  `../visual-agent-reports/phase3/20261015T204138Z-visual-01/PRIMARY_REVIEW.md`.
  It requests scope/semantic/reporting corrections and grants only bounded UI
  follow-up permissions. That work is not credited as primary Phase 2 completion.

## October 15 — native mutation receipts and direct-chain partial ACKs (A1/A5)

- Server confirmation now supports owned attach/edit-metadata receipts, returning
  digests of the original payload and projected result rather than raw historical
  descriptions/tags. Shared canonical JSON/Unicode fixtures cover native/server
  digest parity; maximum metadata keeps receipts below 1 KiB before authority.
- A new native confirmation command reads its own immutable mutation provenance,
  fetches receipt/current authority from the trusted API, checks exact identity,
  intent/result, device, session/lease and unchanged native work, then atomically
  stores an origin-bound receipt, ACK and authority. Current denial may accompany
  confirmation of a legitimate historical write; it is not an edit grant.
- Generic ACK is blocked without native mutation proof. Renderer passes only
  change identity and session, never a positive receipt or grant. Old native/API
  versions and transport failures retain the original outbox intent for retry.
- Direct move/metadata chains reconstruct verified acknowledged predecessors,
  validate the complete immutable chain, and use the latest confirmed scope and
  revision as the current-authority anchor. Pending destinations are rechecked.
  Saved payloads, timestamps and bytes are not rebased or deleted. File-creation/
  content prefixes, unproven legacy acknowledgements and nested moves remain open.
- Focused checks: server confirmation **8 passed**, sync adapter **5 passed**.
  `cargo test --manifest-path desktop/src-tauri/Cargo.toml -j 1 local_resource_
  -- --nocapture`: **32 pure checks passed**, including receipt/chain/digest cases
  (45 focused checks total for this slice). Early builds were interrupted after
  Windows tool stalls; the completed native test build, `cargo check` and desktop
  `tsc --noEmit` passed. Backend syntax and `git diff --check` also passed.
- No database tests were substituted with doubles: these are pure/adapter checks.
  Actual PostgreSQL, cold-restart stopped-API, partial-ACK/lost-response and
  authorization races remain NOT RUN. No deployment, restart or data cleanup.
- Status: bounded A1/A5 subcheck IMPLEMENTED — AWAITING VERIFICATION; parent items
  remain PARTIAL. Native/API/frontend must be updated together before acceptance.

## October 15 — download PC-copy presentation and cached previews (A6)

- Downloads reads resource metadata and copy observations through native commands,
  separately from its saved server queue. Completed job filenames never establish
  PC readiness. Labels describe the current resource, not a historical job artifact.
- A native status failure produces unknown status, preserving independently
  authorized metadata; metadata failure never falls back to HTTP. Session switches
  reject in-flight results, and query identity includes account/generation.
- Desktop queue/history previews use cached native posters only. Missing/broken
  previews render a placeholder without server/external fallback. The shared poster
  hook no longer returns the preceding resource/account URL before effect cleanup.
- Native copy status checks revision and server origin for copying as well as ready
  states. Stale copies report zero current verified bytes and unknown current size;
  no files or pending work are deleted. Existing ready checks validate authorization,
  origin/revision and file presence/size; this is not a new per-render full-file hash.
- Verification: `node --test src/api/download-device-state.test.mjs
  src/api/media-download-tools.test.mjs src/components/download-resource-preview.test.mjs`
  from desktop: **15 passed**. These are adapter/presentation doubles, not database
  or mounted UI tests. `cargo test --manifest-path desktop/src-tauri/Cargo.toml
  local_resource_replication::tests -- --nocapture`: **2 pure checks passed** and
  native compilation passed. Desktop `tsc --noEmit` passed.
- Status: bounded A6 subcheck IMPLEMENTED — AWAITING VERIFICATION. Actual PostgreSQL,
  stopped-API desktop cold restart, file removal/revision/revocation races and visual
  acceptance remain NOT RUN. No deployment, migration, app restart or data cleanup.

## October 15 — attempt-owned downloads and cross-device history removal (A6)

Source changes, not a deployed build or phase acceptance pass:

- Added nullable `worker_run_id` and scoped `download_job_tombstones` in an additive
  migration. Historical markers are derived only from committed matching deletion
  receipts and only for absent job rows; no inferred deletion or row reset.
- Each execution holds a dedicated PostgreSQL advisory session lock until its
  process/publication finishes. Recovery obtains that same lock nonblocking before
  resetting an abandoned attempt, never a live upgraded worker's job. A separate
  claim transaction lock serializes concurrency-limit checks. Release destroys the
  dedicated session, including uncertain-transaction cases, rather than returning
  an advisory-locked client to the pool.
- Run IDs bind progress, stop callbacks and publication. Worker `updated_at` uses
  a strictly advancing clock-based timestamp to avoid transaction-start timestamps
  making newer terminal state appear older than prior progress. Requester active
  state/current role, global edit permission and scoped resource edit access are
  rechecked; changed/deleted source and already-published media cannot be overwritten.
- Attempt-specific media/artwork filenames preserve previous attempts after
  interruption or uncertain COMMIT. No automatic partial-file deletion remains in
  this worker. Optional thumbnail extraction is capped at 15 seconds; artwork is
  promoted without overwrite only during guarded publication. Existing metadata
  is retained if artwork fails. This is not a claim that every thumbnail consumer
  or locally uploaded video poster issue is resolved.
- The process adapter bounds captured output to 65,536 UTF-16 code units per
  stream and partial lines to 8,192, serializes/coalesces progress callbacks, and clears only its own
  tracked child. Stop handling targets the attempt and process group/tree, with
  forced escalation. Authority/database observer failures stop network processes;
  they are not stored as a proven permission revocation.
- Server history deletion now stores a resource-scoped marker in the same
  transaction as deletion/audit/receipt. Retired job UUIDs cannot be reused.
  Authorized snapshots expose markers; native UUID-normalized union keeps them
  across late pulls/acknowledgements. This removes history only, not resource bytes.

Focused checks: 19 Node pure/process-double tests passed, plus seven native pure
download validator/merge checks; native compilation, backend syntax and diff
checks passed. No database double was used as PostgreSQL evidence. The additive
migration, actual SQL/advisory-lock behavior, two-worker concurrency, process-tree
termination on Windows/Linux, outage/cold restart, late receipt/removal races and
revocation cases remain NOT RUN for final integrated acceptance. No database was
changed and no API/app restart was performed.

Deployment must stop all old-version workers first, apply the migration, then
start compatible API/desktop builds. Old workers do not acquire the new leases.
Pending resource mixed/partial-ACK chains are unchanged in this checkpoint. These
two A6 subchecks await verification; A6 and Phase 2 remain open. Retained attempt
file reclamation belongs to the approved non-destructive A2 retention work.

## October 14 — approved policies and independent A6 implementation

The owner approved owner-held encrypted recovery, quantity-first custody with
optional serials, canonical project demand/explicit settlement, quarantined
salvage with reviewed recovery value, and consented server transcription first.
The delivery checklist records the complete contracts and separates implementation
subchecks from whole-item acceptance. Approval alone does not mark code complete.

A6 tool-status cache: diagnostic binaries run through bounded parallel `execFile`
probes (2.5-second timeout, bounded output), coalesced and cached for 60 seconds.
The snapshot includes an optional completion-timestamped report. Native validation
keeps only known bounded fields and canonical calendar-valid UTC timestamps;
missing, invalid or older optional diagnostics preserve the previous same-account
report. Existing permission-denial snapshot eviction applies to tools as well.
Desktop reads have no HTTP fallback and label saved observations explicitly.

A6 browser enqueue: browser storage saves an origin/account/normalized-payload
request ID before sending. Reload, network errors, server errors, malformed JSON
and stale-account responses preserve that identity. A successful current-account
receipt clears it. Storage failure/corruption blocks sending rather than silently
creating another request. This browser journal is not the native desktop outbox.
The API requires an idempotency UUID, uses the existing advisory lock/receipt table,
rechecks current access, binds owner/device namespace/entity/operation/payload,
and commits a new job, required creation audit and receipt in one transaction.
An already active job is returned without a fictitious second creation audit;
retry after completion/removal returns the recorded result instead of recreating.

Focused checks: 24 Node pure/adapter checks and five native pure validator/merge
checks passed (29 total); native compilation, combined TypeScript checking,
backend syntax and diff whitespace checks passed. No test database, API outage,
app restart or deployment occurred.
Actual PostgreSQL SQL/concurrency, cold-start offline persistence, revocation and
reconnect acceptance remain NOT RUN. API and browser must deploy together because
enqueue now requires an idempotency key. The new native tool cache also needs the
coordinated desktop build. These are two ready subchecks, not whole A6 closure.

## October 14 — guarded native metadata and repeated attachment moves (A1/A5)

Added `local_resource_mutations`, an additive native-only provenance table:
before/after snapshots, immutable payload, account/device/resource/operation and
change ID. New direct moves and metadata patches commit this record alongside the
local resource projection and outbox event in the same IMMEDIATE transaction.
No IPC command accepts provenance from a renderer, and pulls do not populate it.

An uninterrupted pending move/metadata chain is validated against the current
local record and original cached authority. UUIDs, device, operation, exact saved
payload, every predecessor and permitted field projection must agree. Current
ancestor/note bindings and every intervening destination remain checked. Only the
native-proven leaf is projected to its original scope for that comparison. This
does not relax content-edit/copy authority. Conflicted, unproven, partial-ACK,
mixed-content or excessively long chains remain blocked with work preserved.

Metadata writes previously used a broad generic `update` with only the generic
local permission check and no revision dependency; omitted metadata arguments
also reset existing values. The new `edit_metadata` path captures account/session,
checks record edit authority, validates category/description/tags, preserves
unspecified fields and retains its observed revision until server reconciliation.
Visibility, attachment, identity and file-byte fields cannot enter this patch.
The UI checks the native mutation capability, with no old-binary/HTTP fallback.

Server `edit_metadata` requires the current editor permission and observed or
owned predecessor revision, applies only whitelisted fields and a monotonic
millisecond revision, and writes the required audit inside the sync transaction.
Protocol-3 attachment moves can follow move/metadata receipts from the same
author/device/resource. Older servers reject the new operation/protocol. Existing
immutable generic `update` events are retained, not silently upgraded; their
legacy reconciliation remains open. Browser metadata writes are unchanged.

Native and desktop dependency graphs now recognize metadata predecessors.
Explicit discard retires dependent intents for moves/metadata as well as file
operations, preserving provenance/bytes. Revision-conflict handling never silently
rewrites the expected revision. Independent work remains eligible to sync.

Checks: 24 backend pure/receipt-double tests, 26 local-resource native pure tests,
two native dependency-graph tests and 23 desktop adapter/dependency tests passed
(75 total). Native test-target compilation, TypeScript and diff checks passed.
No database fixture/test, Docker mutation, deployment, restart or authored-file
cleanup occurred. The native SQL transaction, real PostgreSQL permission/apply,
interrupted ACK, stopped-server/cold-restart and reconnect gates remain NOT RUN.

Next boundaries: partial-ACK continuation; mixed content/create/move chains;
content editing after a move; legacy intent recovery; unsynced destinations and
nested-folder moves. A1/A5 and the phase remain PARTIAL, not signed off.

## October 14 — native-verified file confirmation and authority handoff (A1/A5)

Investigation found that the old edit receipt binder reran the current local
editor guard before recording a historical server success. A queued attachment
change could therefore make confirmation fail repeatedly. Upload receipt binding
also set the confirmed revision separately from the outbox ACK and authority
refresh, creating an interruption window for a fresh authored file.

Added read-only `/sync/resources/confirm`: bounded change IDs plus one resource
and device; server receipt lookup checks author/device/resource/type/operation and
returns only historical identity/revision/size. Missing, foreign or unsupported
receipts return no historical metadata. The response includes the normal current
protocol-2 resource authority projection, including explicit denials. Confirmation
is not an edit grant and does not replay or mutate domain work on the server.

Native code selects the pending file versions itself (oldest 100 per resource),
uses the compiled origin/bounded no-redirect client, and validates exact batch,
account, operations and native file sizes. It rechecks the same pending versions,
session and login lease under an IMMEDIATE transaction, then commits verified
receipt records, version bindings, outbox ACKs and the current authority cache
together. Confirmation and ordinary authority refresh share serialization.
Verified historical successes also resolve their existing sync-conflict entries
in that transaction. Late failure/conflict callbacks cannot reopen an already
ACKed file event with matching native confirmation proof; unrelated and
unconfirmed changes retain the existing failure handling. This transaction/race
behavior still needs the phase-end runtime acceptance test.
Unconfirmed versions retain their original IDs; subsequent bounded batches drain
larger histories. No original event payload or authored file is overwritten.

If no later intent remains and the current local version/scope exactly matches a
confirmed version and current server authority, its revision advances atomically.
Otherwise local work is preserved. Pending native content can trace through a
native-verified creation receipt when creation is ACKed before a later edit.
Current access denial can still acknowledge historical owned work, but never
becomes a positive grant. Independent receipt handling remains intact.

The renderer now supplies only change identity and current session credentials;
old file bind commands fail with a migration message and generic file ACKs require
native confirmation proof. Old binaries cannot use a weaker fallback: they leave
events pending and require the coordinated build. API-first deployment is needed.

Targeted results: 37 backend validator checks, 19 native pure checks and 14 desktop
adapter/receipt/dependency checks passed (70 total). TypeScript/native compilation
passed separately. No database fixtures, actual PostgreSQL queries, Docker
mutations, app restarts or deployment performed. Actual stopped-API/cold-restart,
lost-response/transaction interruption and reconnect acceptance remain NOT RUN.
General metadata/repeated-move/folder chains and post-move content revision
handoff remain open; no Phase 2 or A1/A5 sign-off is claimed.

## October 14 — native-authored pending file editor authority (A1/A5; earlier checkpoint)

The native editor path now recognizes fresh files from a same-account/device,
ready native upload joined to its unsynced create/create_copy outbox entry, with
no confirmed server revision. It requires the existing active lease and current
resource view/edit/create permissions. A renderer-created resource row or generic
outbox event alone is insufficient. The immutable creation payload must match
the native upload record, scope/type/source identity must match current state,
and destination authority is checked again. Copies still walk the full source
ancestry with bounded cycle/revocation checks.

Repeated content saves can trace back to that creation revision through native
content versions. Only the exact proven creation is exempted from the generic
non-content pending-operation prohibition. Conflicts/foreign devices, retired
creations, unsupported metadata/move intents and unproven changed versions remain
denied; no existing bytes/events are removed. Attachment moves use this same
source guard before applying the previously added predecessor contract.

Once creation is acknowledged, this unconfirmed-creation path no longer applies;
verified server authority is required. The ACK-to-authority-refresh interruption
case remains an explicit phase-end verification/recovery boundary, not a claimed
pass. Unsynced destination grants and repeated metadata/move chains also remain.
No deployment, application restart, database mutation or Docker state change.

Verification: all 15 targeted native tests passed, including the three new pure
creation-proof tests; native test-target compilation passed. The preceding 33
backend and eight desktop checks and TypeScript check also passed (56 targeted
checks total across this work). No database fixtures or desktop offline acceptance
is represented by these pure checks.

## October 14 — destination grants and attachment predecessors (A1/A5)

Added read-only destination authority for note/project IDs, projected through the
existing server parent validator. Requests are bounded, typed and canonical;
changed scope/missing records/denials return no positive scope. Native code selects
IDs from scoped local notes/projects plus previously cached IDs, uses the compiled
origin and bounded authenticated client, checks account/session/exact lease, and
atomically replaces each batch including denials. No positive decision comes from
the renderer. Resource and destination refresh share one serialization guard.

Non-admin file writers now use verified destination decisions instead of cached
project edit flags or a blanket note restriction. Folder targets require their
own complete resource authority. Existing global project permission restrictions
remain, and the administrator exception is not expanded. Note destinations must
match their verified note visibility/project binding; missing/duplicate/changed
scope or expired/replaced leases fail closed. New unconfirmed note/project/folder
destinations still need a separate local-creation contract. Refresh moved after
all project/resource/note pulls; its result contributes to overall sync status.

Direct resource moves now capture the last supported native create/copy/content
predecessor in the same SQLite/outbox transaction. Protocol-2 moves resolve the
immutable server receipt only for the same account/device/file resource, then
run existing source/destination permission, revision and project-reference checks.
Missing receipts retry; foreign/unsupported receipts conflict. Protocol-1 moves
retain their original behavior; old servers reject protocol 2 instead of ignoring
the dependency. Queue withholding and conflict dependency parsing include moves.
No payload rewrites, file deletion, database replacement or permission extension.

Limits still open: repeated moves, metadata dependency chains, content editing
after a pending move, non-admin fresh-local-source grants and folder/tree moves.
This is not A1/A5 closure. API-first deployment is needed; no app restart or Docker
mutation occurred. Tests are validators/receipt-resolution doubles, not DB tests:
33 backend and 12 native checks pass, plus eight desktop adapter/dependency/source-
order checks. Native test compilation and TypeScript pass. Actual PostgreSQL and
stopped-API desktop/restart/reconnect acceptance stay NOT RUN for this checkpoint.

## October 14 — inherited resource authority (A1; earlier source checkpoint)

The authority endpoint now negotiates protocol 2 for native callers: at most four
resources per request, each with a complete bounded leaf-to-root resource scope
and attached-note project/visibility binding. Protocol 1 responses retain their
old shape for older binaries. Normal server editor authorization is checked twice
and changed bindings or direct revisions produce metadata-free denials.

The shared server context query now bounds recursion and rejects cycles, missing
parents/notes, non-folder ancestors and ambiguous parent/project contexts. The
maximum is 32 resource records including the leaf; an over-depth hierarchy is
unavailable rather than silently authorized from a partial walk. Actual SQL and
existing-data compatibility still require the phase-end PostgreSQL sweep.

Native code alone fetches the bindings, retains the 64 KiB response cap and exact
account/session/login-lease checks, and atomically caches or removes bindings
alongside each decision. Bindings additionally carry their grant revision/lease,
so an old-format grant refresh cannot silently reuse a different context record.
Non-admin source editing now checks all scoped local ancestors and attached
notes, rejects missing/duplicate/changed scope records, and retains the existing
exact-revision or native content-only continuation proof. Note body and ancestor
content edits do not themselves change scope; no new authority is inferred from
those local edits. Global permissions and existing administrator policy remain.

Destination authorization is intentionally separate and still unfinished. This
does not unlock creation in notes/folders, arbitrary moves, fresh unsynced-source
grants or metadata/attachment dependencies. Older native caches require an online
protocol-2 refresh; deploy the compatible API first. No data reset, native restart,
Docker state change or application deployment was performed.

Critical checks: 24 backend validator tests, seven native pure authority tests and
six desktop adapter/dependency tests pass. Native test-target compilation and
TypeScript checking pass. These checks use no database fixtures and do not claim
actual PostgreSQL, stopped-API desktop, cold-restart or reconnect acceptance.
All 18 closure units remain open; A1/A5 stay PARTIAL.

## October 14 — native resource edit-authority cache (A1; earlier checkpoint)

Added read-only `POST /sync/resources/authority` (up to 100 canonical unique IDs).
It uses the existing server resource-editor rules, checks the resource revision
and direct scope around the decision, and returns no scope metadata for denied
IDs. This is a permission projection, not a domain write or new grant endpoint.

Native refresh selects resource IDs from SQLite plus previously cached IDs, uses
the compiled trusted origin, refuses redirects/proxies through the existing
native HTTP client, and validates bounded responses against the exact requested
batch/account. Each 25-ID batch commits after checking the captured session and
unchanged login lease. Refreshes are serialized to prevent an older response from
overwriting a later denial. Confirmed disabled/revoked authentication invalidates
the matching native session; ordinary outages preserve grants only within their
original lease. New login leases cannot reuse the old grant cache.

Non-admin editor access to direct/shared/restricted resources consumes this native
cache instead of trusting a renderer-fed project edit flag. Global native view/edit
permissions remain necessary. Note/folder inheritance stays blocked: direct-parent
IDs alone do not prove a complete ancestor permission snapshot. Administrator
behavior and destination checks are not claimed as fully audited by this change.

The owner asked for the recommendation fitting LabOS after review blocked a
blanket revision relaxation. Chosen contract: repeated content-only offline saves
may retain the verified grant within the existing lease. Implementation keeps the
exact-revision path and adds proof through native-published content versions,
same account/device/resource, unchanged direct scope, matching local version/size,
and a chain back to the verified revision or its own confirmed receipt. Arbitrary
or cyclic chains, pending non-content mutations and retired unconfirmed versions
do not qualify. Traversal is bounded to the newest 1,024 proof rows; older or legacy
versions without proof fail closed without deleting authored data. The additive
`local_revision` column is populated only by new native content publication.

The sync adapter checks native protocol support so an older running binary is
not sent an unknown command. It supplies only the captured account/session/token,
never a renderer-selected origin or positive grant. The new native binary requires
an online refresh before its non-admin cache-dependent operations are available.

Verification: 20 backend projection/copy/content validator tests, six desktop
authority/dependency adapter tests and four native pure authority/chain tests
passed (30 total). TypeScript passed; native test target compiled. These are not
PostgreSQL or desktop outage acceptance tests. No Docker/database mutations,
fixtures, data resets, deployment or app restart were performed. A1 remains PARTIAL;
ancestor/destination grants, fresh locally authored resource authority, broader
native writer coverage and the phase-end real outage/reconnect matrix remain open.

## October 13 — fixed delivery checklist and dependent resource copies (A5)

The owner-approved scope freeze and three implementation batches are recorded in
`PHASE2_DELIVERY_CHECKLIST.md`; no new phase or silent scope deferral was created.

PDF and DOCX copy writers now permit a pending source upload/copy/content edit
with an explicit `copy.previous_change_id`. SQLite selects that predecessor inside
the writer's IMMEDIATE transaction; unsupported metadata/attachment intents and
known conflicts still fail closed. Immutable file publication, scoped resource
projection and the copy outbox intent retain the existing atomic boundary.
DOCX's stable request mapping remains unchanged.

Server copy authorization resolves the predecessor's recorded revision only after
same-author/device/resource/file-operation checks, then checks current authority,
source revision, format, attachment and visibility. Missing receipts retry rather
than bypassing checks; newer source revisions conflict. Original payloads are not
rewritten. Native copy ancestry checks retain source revocation and ordinary
permission restrictions, with a bounded exception only for owned unconfirmed
creations that are not yet in the server's visible-ID snapshot.

The native pending queue excludes conflicted resource chains and their descendants
before applying its batch limit. Queue order uses insertion order, avoiding wall
clock changes putting a copy ahead of its predecessor. Explicit discard retires
the dependent chain without deleting authored bytes or version records. During
upload failure, the renderer also withholds transitive copies and their mutations
while unrelated work can proceed.

Focused checks (not database or outage acceptance): 16 backend copy/content
validator tests, 18 desktop dependency/upload adapter tests and two native pure
dependency-graph tests passed (36 total). TypeScript and `cargo check --offline`
passed. The Rust filter ran only `resource_dependencies::tests`, not the SQLite
fixture tests. No Docker mutations, database writes, fixtures, reseeding or app restart
were performed for this checkpoint. The existing running native/API artifacts
have not been updated with this code.

Remaining within A5: pending metadata/attachment/folder chains, broader cached
record grants (A1 dependency), recovery UX and actual stopped-API/reconnect/lost-ACK/
two-client tests against the existing PostgreSQL service. This checkpoint is not
A5 completion or Phase 2 sign-off.

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

## 2026-10-12 — stuck-sync repair (findings 47–48)

- Corrected server acknowledgement projections without returning full historical
  record snapshots. Upload ID/revision and authorized download control/settings
  receipt fields now match native consumers.
- Desktop confirms each submitted change independently; a failed confirmation
  cannot skip unrelated successes or rejected-change reporting. Unknown replies
  cannot ACK local work; missing/duplicate replies retry the original identity.
- Seven new focused receipt tests, nineteen related tests, and TypeScript check
  passed. These are not substitutes for native or PostgreSQL integration tests.
- Actual PostgreSQL/API replay verified the original upload receipt, and the
  desktop SQLite row shows it acknowledged at 2026-10-11 18:01:55.
- Live retry exposed a second defect: resource deletion's SET NULL action broke
  the canvas content constraint. Migration 20261012_canvas_resource_removal
  preserves the node as text, including its identity/layout/annotations and
  connectors. The real PostgreSQL rollback-only regression passed both direct
  and folder-cascade deletion. No fixtures remain from that probe.
- Original blocked deletion successfully committed and replayed with one receipt;
  the referenced canvas block remains at (80,80) as Resource removed. The other
  queued deletes were also accepted through their existing IDs. Only already
  authored deletion intents were replayed; local ACK state was never edited.
- Eight deletions still awaited desktop acknowledgement at the final read-only
  check. Computer-use app approval timed out. Desktop retry/queue drain and the
  full stopped-API/reconnect matrix remain unverified; Phase 2 is not signed off.

## 2026-10-12 — initial native resource replication batch

- Added a background server-to-PC copy coordinator after authorized resource
  pulls, independently of outbox processing. It rotates through uploaded files
  and completed downloaded links; it never fetches arbitrary external URLs.
- Native code verifies the token's server identity against the active account,
  uses only the trusted configured API origin with redirects disabled, and
  transfers one bounded 4 MiB chunk per call. Manifest/range/ETag/length/chunk
  digest and final whole-file digest validation are enforced.
- SQLite persists verified offsets and errors; fsync precedes offset commit.
  Completed bytes are atomically renamed. Interrupted publication can recover
  by re-verifying the final file. Partial files are never reader-visible.
- The existing capability reader now also serves verified derived copies under
  account/session/lease/permission/revision/known-revocation checks. Pending
  authored changes defer replication. Authored files and their outbox are not
  removed or overwritten. Cards show available-on-PC, copying and error states.
- Focused verification: TypeScript check, cargo check/build and current native
  manifest unit test passed. Eighteen frontend replication/upload/folder checks,
  nine server binary checks and five poster/receipt checks passed. One stale
  frontend test fixture lacked the newly used localFileUrl stub; it was updated
  and the full targeted group rerun successfully. No database test was replaced
  with a mock; this batch did not execute PostgreSQL acceptance.
- Owner approved restart. Closed only the verified old LabOS process, built the
  native executable successfully and reopened it at 2026-10-12 03:03:07 (PID 9724).
  Process reported responsive and Vite served successfully. Read-only inspection
  showed the new copy tables initialized, with zero copied rows yet.
- At startup verification, API connection was refused. Both labos-api and db
  containers had exited cleanly approximately four minutes earlier, outside this
  batch's service actions. Left them stopped as found. This is startup evidence,
  not a controlled outage/playback acceptance pass. Native full-copy, interrupted
  transfer, cold restart, revocation, disk-full and reconnect tests remain NOT RUN.
- Read-only SQLite inspection now shows ZERO pending outbox changes. This closes
  the previous eight-pending-ACK observation for findings 47–48; no queue rows
  were manually acknowledged or deleted.
- Still open: physical derived-file reclamation, retention/quota and encryption
  recovery, editor copies, scoped note/folder write authority, reader seek/large
  file compatibility and the phase-end actual PostgreSQL/desktop outage matrix.

## 2026-10-12 — attachment moves: local/outbox implementation

- Desktop Attach/Move now calls a guarded native command, never a direct HTTP
  mutation or a server fallback after local failure. Attachment metadata and an
  account-attributed stable-ID `resource/attach` intent commit together in SQLite.
- The new server handler locks the resource, checks its confirmed revision,
  current source/destination edit authority, project visibility and existing
  canvas/task/experiment attachment project references. It does not change file
  bytes, visibility, grants, or create a second resource. Existing sync receipts
  provide retry idempotency. Older servers reject the distinct operation instead
  of treating it as a successful empty metadata update.
- Native availability is deliberately bounded: admins or cached direct-project
  editors only; missing record grants fail closed. Folder trees/nested rows and
  additional moves while another resource change is pending are not implemented.
  Project-visible moves into notes await cached note-project authority. Ordinary
  attachment-only pending work does not hide an already verified derived file.
- Focused evidence: backend pure validation 3/3; frontend folder/attachment
  boundary tests 6/6; native destination test 1/1; TypeScript, cargo check/build
  passed. These tests do not exercise an actual database or prove offline UI
  acceptance. Actual PostgreSQL/desktop tests remain in the phase-end sweep.
- Required acceptance: API stopped → save attachment → refresh/cold restart;
  reconnect → same resource ID and one receipt; replay original change ID;
  another-device edit → conflict without overwrite; revoked permission/account
  switch; pending upload guard; project-reference mismatch; partial bulk failure;
  verified-file access while move is pending. Never delete authored work to pass.
- Editor text/DOCX/PDF writes remain server-backed and OPEN. This batch does not
  claim editor copies, physical cache reclamation, or all Phase 2 work complete.
- Final focused regression run: fourteen frontend attachment/folder/replication/
  receipt checks and three backend validation checks passed. Final TypeScript
  check and native build passed; diff whitespace check passed. Native destination
  test had passed before the operation-name-only compatibility adjustment.
- With owner approval, reopened desktop PID 6768 at 2026-10-12 06:50:19;
  executable build timestamp 06:48:20, process responsive, Vite HTTP 200.
  This is process/startup evidence, not visual/offline mutation acceptance.
  Built API image 0849f5706b399eda70b86dbdfc10e7ae45ed49ab6843f36d941dc96d4393a2fa
  and recreated only the already-stopped API container with --no-start --no-deps.
  API remains Created (not running); PostgreSQL remains stopped as found.
  Existing volumes/data were preserved. The new sync handler is staged for the
  next server start, not live-verified against PostgreSQL in this batch.

## 2026-10-12 — Docker restored; PDF-copy/Markdown-read batch

- At owner request, started the existing Docker Compose services without builds,
  resets or volume removal. Initial health at 07:07:18 UTC: API, database and
  storage OK; both PostgreSQL and API containers healthy.
- Native PDF editor copies now preserve originals, source attachment/visibility
  and derived provenance. New bytes are fsynced/hashed in managed account storage;
  upload metadata, resource and stable-ID outbox intent publish atomically. The
  distinct create_copy operation reuses resumable transfer and idempotent sync,
  with current source permission/revision checks before server publication.
- Source must be a synchronized PDF with verified bytes on this PC. Copy limit
  is 500 MiB. Cached authority is conservative: admins or direct-project editors;
  unavailable shared/restricted/note/folder grants remain fail-closed. A known
  source revocation blocks reading a pending derived copy while preserving bytes.
- Markdown reads use the native guarded file reader with a 4 MiB bound and strict
  UTF-8 decoding. No server read fallback. Saving Markdown is still server-backed;
  the editor states this explicitly. DOCX and PDF replacement are also still OPEN.
- Focused checks: backend validation 6/6; frontend folder/editor/upload boundary
  tests 19/19; TypeScript and cargo check passed. These do not exercise actual
  database mutations, real native file creation, or the phase-end outage matrix.
- Actual acceptance still required: API stopped → PDF copy → reopen/restart/read
  → reconnect → one derived PostgreSQL row/receipt; original bytes and visibility
  unchanged; interrupted transfer/replay; source revision/deletion/revocation;
  missing bytes, file-size/disk-full errors; non-admin scope and account switching;
  Markdown Unicode/invalid UTF-8/size boundaries. Preserve all authored data.
- Deployment/startup checkpoint: API image
  fa4ac0350e8022ec520ab2115836e7c6c75e1fbacd85117298a622c9a6660e94
  deployed by recreating only the API. PostgreSQL stayed running. Health at
  07:18:33 UTC reported API/database/storage OK and both containers healthy.
  Final frontend checks 19/19 and TypeScript passed; native build passed.
  After explicit confirmation that edits were saved, closed desktop PID 6768
  and reopened the new build as PID 8668 at 07:18:59. Executable build timestamp
  07:17:20, size 22,139,392 bytes; Vite returned HTTP 200 before launch. This
  records deployment/startup, not PDF-copy UI or database acceptance.

## October 12 follow-up — same-resource offline Markdown saves

- Supersedes the previous checkpoint's server-only Markdown-save boundary.
  Desktop Markdown saves now use guarded immutable managed files, atomic SQLite
  projection/version/outbox publication and resource/edit_content sync. The
  resource ID does not change, so repeated saves do not create new resources.
- Pending saves reference predecessor change IDs; the server requires a receipt
  belonging to the same account/device/document/operation and uses its confirmed
  revision. Current edit permission and source format are rechecked. A stale
  server revision produces RESOURCE_EDIT_CONFLICT, not a blind replacement.
- UI uses the revision captured when the editor opened. Stale local saves fail
  without closing the editor or discarding the typed text. Earlier saved versions
  stay on disk. Accept-server/dismiss retires the pending edit chain, not its files;
  explicit export/reapply recovery UI remains open.
- Limits: 4 MiB valid UTF-8 Markdown; verified local source; conservative cached
  editor authority. An initial upload or other resource mutation must finish sync
  before content editing. This does not claim offline DOCX or PDF replacement.
- Focused verification: cargo check, TypeScript; backend pure validator/receipt
  tests 12/12; frontend routing and transfer tests 22/22. No PostgreSQL fixture,
  database reset, actual native editor write, outage or two-client test was run
  for this checkpoint. These are compilation/boundary checks only.
- Phase-end real acceptance: stop Docker API, open and save Markdown repeatedly,
  reopen and restart offline, reconnect, confirm one resource and ordered owned
  receipts with exact latest bytes; repeat with dropped ACK, two-device conflict,
  revocation, disabled account, delete, account switch, missing/invalid/empty/large
  source, full disk and conflict resolution. Verify every saved version survives.
- Deployment/startup: native build passed (executable 22,222,336 bytes, built
  12:16:11 UTC). After explicit saved-edit confirmation, closed verified PID 8668
  and reopened the desktop as PID 5264 at 12:17:55; responding on inspection.
  API image dc14fe97ac824566f85036207fac8660406f49d77282730072b88d418d33c2d5
  deployed by recreating only labos-api. Both Docker services healthy; health at
  12:18:09 UTC reported API/database/storage OK. PostgreSQL/storage volumes and
  authored files were not reset or removed. Startup health is not editor/outage
  acceptance.

## October 12 — PDF replacement, offline edit chains and Markdown recovery

- Replaces the previous checkpoint's server-only PDF-replacement boundary.
  Derived PDF copies can receive an externally edited file via native 1 MiB
  staging chunks, capped at 500 MiB. Finalization validates complete bytes and
  PDF signature before atomically publishing the local version/resource/outbox.
  Server publication preserves the old file and commits its new file pointer,
  required audit and idempotency receipt together. Resource ID/filename stay fixed.
- Markdown/PDF edit chains can now follow an owned native upload/create_copy
  before that creation has synced. Each uses its predecessor's server receipt,
  with same account/device/resource checks. Initial create payloads stay unchanged.
  Non-content pending metadata/attachment operations remain an explicit boundary.
  Discarding a creation or edit conflict also retires dependent edit intents,
  while every managed version file remains physically preserved.
- Native Markdown history now supplies the latest 100 local versions, including
  retired intent versions. Review/export/use require current resource editor
  authority and account/session checks, with SHA-256/length/UTF-8 verification.
  Reapply is an explicit new editor save with ordinary conflict checks, never a
  forced overwrite. Deleted/revoked-resource and PDF history recovery remain open.
- Dirty editor closure now prompts, save-in-progress closure is blocked, and
  viewers reload on changed revisions rather than only changed resource IDs.
- Quick evidence: backend pure validation/projection group 16/16; frontend
  routing/staging group 27/27; TypeScript and native compile checks passed.
  These are not database, actual native file publication or desktop acceptance.
- Phase-end coverage additions: offline new upload/copy → repeated MD/PDF edits
  → cold restart → ordered reconnect, dropped acknowledgements, parent rejection,
  dependent discard, cross-device edits, known source revocation, member scopes,
  malicious/short PDF signature, incomplete chunks, full disk, saved Markdown
  preview/export/reapply, dirty-modal closure, and changed-content viewer refresh.
  Use the existing PostgreSQL and actual desktop with API stopped; preserve data.
- Still open: offline DOCX conversion/save, full PDF structural/security checks,
  large-file viewer compatibility, broader recovery and protected storage,
  scoped permission caching, cleanup/retention and phase-wide acceptance.
- Native build passed: 22,313,984-byte executable, built 19:50:15 UTC. On the
  saved-edit restart check no existing LabOS process was reported; no process
  termination is claimed. Launched PID 29076 at 19:52:19, responsive on inspection.
  TypeScript and diff whitespace checks passed.
- Built API image 845dd64e86372883bf6a98c076efcfa9144d1e5bfde59edd67fcd48ba07a4ad7
  and recreated only the API container. Startup is NOT healthy: inspection found
  the existing PostgreSQL container had exited cleanly about seven hours earlier.
  API logs show database DNS/connection timeouts, not a verified migration or
  editor mutation failure. Asked the owner whether to restore the existing DB/API
  or retain an offline-test state. No volumes, databases or authored files removed.

## October 13 — service restoration and bounded offline PDF preview

- Owner approved starting the existing PostgreSQL/API with all data preserved.
  Fresh inspection shows both existing containers healthy. At 10:09:15 UTC,
  `/api/health` reported API, database and storage `ok`. No reset, reseed, volume
  removal or authored-data deletion was performed. This resolves the previous
  startup failure, not the outstanding offline acceptance matrix.
- Found a concrete preview mismatch: native GETs without Range reject files over
  32 MiB while the viewer handed PDF.js a URL that begins with that GET. Desktop
  PDF preview now uses a custom local-only PDF.js range transport: 1 MiB reads,
  serial request processing, 16 MiB maximum assembled request, 64 queued requests,
  and a 500 MiB document limit. Browser viewing retains its existing URL path.
- Native responses expose an opaque immutable-path/size revision, never a raw
  filesystem path. Subsequent requests pin that revision via a query parameter;
  native account/lease/capability/resource checks still run before/after reading.
  HEAD can inspect large files without allocating the body. Whole GET limits
  remain unchanged; general large-file Download/export is not fixed by this.
- Reader validates status, exact range/length, total size and revision, rechecks
  the captured session after reads, cancels on unmount, and reports failures
  without a server fallback. Missing PC copies are explicit, not silently fetched
  from the API. Streaming/autofetch are disabled for this local PDF path.
- Checks: 9 new pure transport boundary tests; combined desktop resource group
  36/36 passed, TypeScript and native `cargo check` passed. These tests use stubbed
  fetch/PDF.js transport boundaries, not real file, SQLite, PostgreSQL or WebView
  acceptance. Actual PDF.js range scheduling/rendering still needs live coverage.
- Add to phase-end actual-desktop/API-stopped matrix: small/over-32-MiB PDF,
  cold restart, seek/pages and split view, close during loading, account switch,
  revoked access, same-ID replacement while open, corrupt/oversized documents,
  missing local copy and reconnect. Preserve current files and PostgreSQL data.
- DOCX offline conversion/save, suffix-range media compatibility, broader export/
  recovery, protected storage and the remaining phase-wide work stay open.
- Final checks: backend validator/receipt group 16/16 and desktop resource group
  36/36 (52 focused checks total); native build passed. Executable is 22,326,272
  bytes, built 10:14:09 UTC. Owner confirmed all edits saved and authorized the
  restart. Local Vite returned HTTP 200; rebuilt desktop launched at 10:16:27 UTC
  as PID 4232 and reported Responding=true. API/database/storage remained `ok`
  at 10:16:40 UTC. This proves startup/process health, not visual PDF acceptance.

## October 13 — all-pages unavailable after expired native lease

- Owner reported Projects, Inventory and other pages unavailable after startup.
  API health at 10:18:26 UTC was `ok` for API/database/storage. Read-only inspection
  of the actual SQLite session showed active `balika` administrator, last server
  password authentication 2026-10-12 07:15:39 UTC and offline expiry 2026-10-13
  07:15:39 UTC (`lease_valid=0`). No credentials/tokens were printed or changed.
- Root cause: successful server `/auth/me` restoration could ignore a failed
  permission refresh and mount the workspace without verifying the native lease.
  SQLite then correctly rejected each domain read. This is a restoration UX/auth
  boundary defect, not evidence that local rows disappeared or the server failed.
- Fixed online desktop restoration to also require a valid, same-account native
  session. It checks request generation after the native await, retains valid
  cached access during transient permission-refresh outages, and never renews
  the password-authenticated lease from an existing JWT. Expired/missing access
  leads to a clear online sign-in notice, not a false usable workspace.
- Checks: auth adapter regression group 23/23 and TypeScript passed. Added expired
  native lease + successful server response, valid native lease + refresh outage,
  cross-account native identity, and stale response after new login cases. These
  are frontend boundary tests; no new DB fixtures or lease edits. Native re-login
  and restored page loads remain user/runtime confirmation, not claimed verified.
- No native rebuild/restart, database reset, lease extension, revocation or pending
  work deletion. A fresh online password login is the legitimate recovery path.
  Mid-session expiry presentation and unsaved-draft-preserving reauthentication
  still need phase-wide acceptance; this fix targets startup restoration.

## October 13 — bundled DOCX decision and conversion boundary

- Owner confirmed the all-pages availability issue is fixed after reauthentication.
  This is user confirmation of recovery, not completion of the security matrix.
- Owner selected a bundled isolated converter, retaining supported formatting,
  rather than a reduced native text-only editor. Contract and remaining native
  integration are in `docs/architecture/offline-docx-runtime.md`.
- Moved server DOCX preview into the same bounded worker service as generation:
  shared two-worker admission, 15-second deadline, 128 MiB V8 heap, 16 MiB binary/
  4 MiB HTML limits. Native allocations are not an OS-enforced RSS bound. Bounded
  file reads reject growth/replacement observed through size/timestamps. Preview
  HTML is sanitized, external file access disabled, messages bounded, and resource
  edit authority rechecked before returning. Child env excludes backend secrets.
- Focused real converter/file tests passed 11/11 on Windows. Includes formatting,
  tables/images, active hyperlink removal, external HTTP/file image references,
  invalid/oversized input, shared read/write concurrency, timeout recovery and
  disk reader limits. Initial external-image fixtures needed both relationships
  rewritten and r:link instead of r:embed; corrected before the full rerun.
  These are worker/file tests, not database/offline desktop acceptance.
- Development bundler copies only runtime/converter dependency closure into a
  unique ignored runtime directory, rejects dependency symlinks, checks versions
  against package-lock and emits hashes. Existing bundles are preserved. Generated
  `docx-6f634850-b1f2-4df0-b59f-d87670e23863`: 110 packages, 4,082 files,
  125,751,105 bytes (before manifest). Uses bundled Node v24.19.0.
- Relocation verification checked all manifest file hashes/package versions,
  copied the bundle to a temporary directory outside the repo, emptied PATH and
  round-tripped formatted HTML → DOCX → sanitized HTML with the bundled executable.
  Passed; the generated temporary probe copy was removed, original bundle retained.
  This does not certify release runtime provenance/signing/license completeness.
- API image `d8de76be062a069794545a3ff9da18e680cc5b928366d40b7d1955d1a4a5a06f`
  built and deployed by recreating only labos-api. Existing PostgreSQL/storage
  untouched; health reported API/database/storage `ok` at 10:35:08 UTC.
- The same 11 converter checks also passed inside the rebuilt Docker API (Node
  22 image), using only temporary fixtures. No PostgreSQL queries or mutations.
- Still OPEN: native guarded worker bridge/process-tree handling, packaged runtime
  selection, installer/signing/notices, native DOCX local read/copy publication,
  server DOCX derived-copy acceptance and real outage/reconnect tests. Current
  desktop DOCX UI remains server-backed; the bundle is not wired into the app.

## October 13 — native offline DOCX implementation

- Shared transforms now serve API IPC and a single-process native framed worker.
  Native bridge verifies the pinned runtime manifest and every packaged file,
  limits input/output/concurrency/time and on Windows applies a kill-on-close
  one-process job with a 384 MiB process-memory limit. This is not a filesystem
  sandbox or complete hostile-document certification.
- Desktop preview and Save as Copy now use native authorization and managed PC
  files. Copy publication atomically records SQLite projection, upload descriptor,
  outbox event and source/revision/HTML-bound request mapping. The original remains
  unchanged. Server create_copy accepts explicit DOCX format and checks source
  authority/revision/scope; existing PDF intents remain compatible.
- Source pending writes currently block copy creation until synchronization.
  Broader cached record edit grants and unsaved-editor crash recovery remain open.
- Boundary checks: 19 backend converter/protocol/copy validation tests and 14
  desktop adapter tests passed; TypeScript and cargo check passed. No database
  tests or new user rows were involved.
- Runtime bundle `docx-03483d22-1e81-4f95-839a-e451bf922112` contains 110 packages,
  4,084 manifest files and 125,752,384 bytes before manifest. Manifest SHA-256:
  `be41fdc4aa634e3a7b305c5ecd9e509b0f7d735e1cc3a894c084f29d8176295d`.
- First relocated framed-worker probe hit its 20-second conversion timeout while
  API/native builds were also active. Recorded as a failed cold-start check;
  cause and final rerun must not be inferred from passing adapter tests.
- API image built and activated, preserving existing DB/storage:
  `84c80c66cb1a91ef8de2fcea1b8b094336d9676befdbd668a1e67720d17df22e`.
- Actual desktop stopped-API/offline-save/restart/reconnect, existing PostgreSQL
  publication/replay and two-client acceptance remain in the phase-end sweep.
- Native process integration: `cargo test --offline
  local_docx::tests::bundled_native_process_round_trip -- --nocapture` passed.
  This uses the actual bundled executable, framed pipes and Windows process job
  to round-trip markup and reject malformed DOCX, without any database fixture.
- Final TypeScript and debug native build passed. After explicit saved-edits
  confirmation the old LabOS process was closed and the new build started
  (PID 25968, responding). Frontend returned HTTP 200; API/database/storage health
  all reported ok at 15:46:53 UTC. Existing databases and authored files untouched.
- Relocation timed out again without concurrent builds, including with asynchronous
  pipes; the first failure cannot simply be attributed to build load. A diagnostic
  outside the command sandbox also timed out. Timeout limits were not raised.
- A diagnostic dynamic-import bootstrap round-tripped successfully outside the
  repo. Final verification restored the exact native worker file entry point and
  explicitly destroyed the Node test's stdin handle after its frame was written,
  matching the Rust parent's closed input handle. This direct-entry rerun PASSED:
  4,084 file hashes, 110 package versions, empty PATH, bundled Node v24.19.0,
  21,191-byte generated DOCX and supported-formatting round trip. Each probe's
  temporary copy was removed; source bundles and authored data were retained.
  These results close this probe failure, not installer signing/provenance or
  actual desktop/database offline acceptance.

## Remaining Phase 2 work (current)

October 13 execution reset: the following broad categories are historical context.
The single current delivery/status register is
[PHASE2_DELIVERY_CHECKLIST.md](PHASE2_DELIVERY_CHECKLIST.md). It freezes 18 remaining
closure items in three batches, preserves prior implementation evidence and
requires the agreed phase-end sweep. Creating it is not a code or acceptance pass.

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
