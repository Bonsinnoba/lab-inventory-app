# LabOS remaining work: three execution phases

## October 13 delivery reset — controlling remaining-work checklist

The owner approved frozen scope, three substantial Phase 2 implementation batches
and one phase-end acceptance sweep. Track remaining delivery exclusively in
[PHASE2_DELIVERY_CHECKLIST.md](PHASE2_DELIVERY_CHECKLIST.md): 18 stable closure IDs
mapped to the existing requirements. This document retains scope/history; do not
grow another parallel remaining-work list. No promised feature is moved to Phase 3.
Earlier per-change outage wording below is superseded by the October 10 cadence:
outage coverage remains mandatory, but occurs in the full phase-end sweep.

This replaces the *remaining-work schedule* in the older five-phase ledger;
it does not erase its implementation history or change the offline-first
architecture. Each phase is one end-to-end work package, not a code-only
milestone. A phase includes implementation, automated tests, checks against
the existing seeded PostgreSQL service, desktop checks, and an evidence update.
Use namespaced test records and preserve all existing user data. Do not reset
PostgreSQL or assign/delete unattributed legacy SQLite rows automatically.
Exception already executed: the owner explicitly requested a full LabOS reset
and fresh seed on 2026-10-03. This is not continuing authority for future resets.

The existing Notes/Resources duplicate fixes, visibility slices for Notes,
Resources and Projects, account-scoped cache/outbox foundation, inventory and
canvas fail-closed guards, project-requirement guard, and maintenance HTTP
route repair are starting points, not work to redo. Maintenance was online-only
at the start of this plan; its Phase 2 local-first implementation is now verified
as recorded in PHASE2_EVIDENCE.md. Source audit coverage is not runtime sign-off.

## October 10 execution policy — implementation batches, then phase acceptance

Owner-approved update: implement coherent batches before the phase-wide test
sweep. Keep lightweight compilation/type checks and focused critical safety
checks for stock, authentication, migrations and synchronization during development.
Defer comprehensive desktop/Docker-outage/PostgreSQL acceptance to the end of the
phase. This supersedes earlier per-offline-change outage gates in these plans;
it changes timing, not required coverage or acceptance criteria.

During the sweep, collect failures and continue independent tests without an
immediate fix/retest loop. Mark dependent tests BLOCKED with their prerequisite,
not passed or independently failed. Stop affected work for potential corruption,
data loss or security exposure. Then group fixes by root cause and rerun the whole
phase matrix, including previous passes. A shared foundational defect may need
repair before dependent tests can run. Until acceptance, label code IMPLEMENTED /
AWAITING VERIFICATION. Preserve authored work and current databases throughout.

## October 9 scope additions — planning, not implementation

The owner added project salvage, smooth TTS/media priority, permissioned assistant
planning, and composer/context/navigation/retry/voice improvements. The diagnosis,
phase allocation, safeguards, acceptance tests and unresolved choices are in
[PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md](PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md).
This keeps exactly three phases and does not mark the new work implemented.

The reported offline page failures are not all intentional online-only design.
Read-path characterization confirms incomplete offline coverage and aggregate
failure coupling; the exact failures of the owner's desktop still need native
session/cache and full GUI outage checks. The owner approved the partial/stale
section contract. Its first slice now preserves available local overview sections,
marks unknown totals and removes resource metadata's desktop HTTP fallback.
Persistent completeness/last-sync metadata and remaining remote read projections
are still open; see the latest PHASE2_EVIDENCE.md checkpoint.

## Phase 1 — Complete the audit, security boundaries, and sync contracts

**Current state (2026-10-03): implementation/verification checkpoint delivered;
not unconditional security sign-off.** See PHASE1_EVIDENCE.md for current results:
50 backend tests, 19 desktop tests, 16 Rust tests, the explicitly run actual
PostgreSQL two-client Notes test, seven live PostgreSQL probes and production
frontend build passed. Operation-level coverage is indexed in
PHASE1_MUTATION_SOURCE_INDEX.md; the common contract is in
../architecture/offline-sync-contract.md. Parent/child visibility, secondary
read projections, authored replay, conflict identity, privileged leases,
finance/location snapshot eviction and resource-copy/export defects were fixed.
One high-severity DOCX/image-parser dependency remains open (audit finding 33).
It must be resolved before unconditional security sign-off; it is first in the
Phase 2 resource/security work, not silently counted as fixed.

**Scope**

- Finish the repository-wide mutation inventory: every desktop API/UI write,
  local-to-server and server-to-local fallback, SQLite write without outbox,
  server write without local reconciliation, retry, idempotency, deletion,
  UUID normalization, and direct mutation outside the data layer. Retain the
  requested `MODULE / FILE / CURRENT WRITE PATH / WHY IT BYPASSES OFFLINE-FIRST /
  RISK / RECOMMENDED CHANGE / ACTUAL CHANGE MADE / VERIFICATION / STATUS`
  record for each finding. Classify each operation as offline-capable or
  deliberately server-authoritative; no blanket rewrite.
- Close authorization and visibility gaps across inventory/operations,
  engineering, knowledge, search, assistant, reports, exports, resource
  download/editor/thumbnail, and all sync pull/push/replay projections.
  Finish the remaining financial side-channel and import/export audit. Preserve
  the separate finance, audit, user, and system permission gates.
- Define one shared contract for stable entity UUIDs and change IDs, account
  ownership, atomic business-write-plus-outbox, conflict/version checks,
  idempotent replay, delete tombstones, access-revocation cleanup, and local
  cache invalidation. Specify the maintenance `updated_at` migration and
  binary-resource staging contract before converting those modules.
- The owner chose a hybrid daily-use preference contract: notifications are
  per-account; media pause and volume are per-device. Its migration and test
  rules are in `docs/architecture/daily-use-preferences.md` for Phase 2.
  Resolve the remaining product decision before implementation: which legacy
  unattributed SQLite data may be exported/recovered. Recovery may not infer
  an owner or delete rows without explicit approval.
- Repair any discovered broken route or permission boundary as part of this
  phase. Build a real PostgreSQL role/visibility matrix for admin, ordinary
  member, project editor, grant holder, revoked user, and disabled account.

**Exit criteria:** every mutation is classified and has a recorded disposition;
the server route/visibility/finance matrix passes; migrations and contracts
are documented and tested on PostgreSQL and existing SQLite state; no known
unauthorized response or direct fallback is left unclassified. Record current
CI results and unresolved failures rather than treating old green runs as
current evidence.

## Phase 2 — Convert the remaining data flows to their approved architecture

**Owner consolidation and mandatory test gate (October 9):**
[PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md](PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md)
is part of this phase. It consolidates offline session/identity repair, cached
authorization hardening, credential revocation, local data/file protection,
remaining page projections, device file replication and queued server intentions.
It is the controlling acceptance procedure for offline-capability changes:
**stop the real Docker LabOS API and test the actual desktop, then verify
reconnection against actual PostgreSQL.** Restore the prior service state after
testing. Mocks and passing online tests do not satisfy this gate. Do not defer
these per-fix outage checks to Phase 3 or erase earlier unverified checkpoints.

**October 8 checkpoint:** DOCX isolation/replacement, the maintenance local-first
slice and hybrid preference data paths are implemented with automated evidence.
The preference two-disk-client test passed against existing PostgreSQL, including
an API restart between commit and lost-ACK replay. Finding 33's original parser
dependency was removed; newly reported dependency advisories are separately
tracked in PHASE2_EVIDENCE.md. Supplier/storage-container CRUD, notification read
state and immutable project comments now also have local-first implementations,
real PostgreSQL probes and two disk-client evidence. Broader inventory/storage
relationships, remaining domain and media paths, online effects and recovery
still remain open. Phase 2 is **not complete**; GUI acceptance is not inferred
from API tests.

**October 9 offline identity checkpoint:** the local-token/central-account-ID
mismatch is repaired. The owner confirmed manual offline login with Docker API
stopped; actual desktop Resources reload retained 12 records, Dashboard loaded,
and process cold restart restored the local session. API was restored healthy.
Frontend 96/native 38 checks and production build passed. This first P2-A slice
does not close file replication, the broader security plan or offline write and
revocation acceptance; see PHASE2_EVIDENCE.md for precise limits/reconnect results.

**October 9 server credential-revocation checkpoint:** password changes/resets
and account disabling now advance a PostgreSQL credential version; middleware
rejects older session and resource-download JWTs. Re-enabling cannot revive old
tokens. The version/audit changes are transactional and database outages are 503,
not false invalid-token 401s. Backend 64 tests and 33 real-PostgreSQL assertions
passed. This is server-side only: native-verified authorization, cached offline
revocation and desktop reauthentication UX remain open. Design and boundaries:
../architecture/credential-revocation.md; audit finding 36; PHASE2_EVIDENCE.md.

**October 10 observed-revocation checkpoint:** shared desktop auth/HTTP now locks
the captured native cached session after explicit server revocation or successful
self-password change, preserving authored outbox work. Permission refresh cannot
reactivate that cache or affect a newer native login; App exits on auth expiry.
Frontend 104 and native 41 checks passed (eight opt-in native tests ignored).
All seven targeted auth tests passed with the actual PostgreSQL regression enabled;
TypeScript and the frontend production build passed. Final native runtime rebuild
and interactive acceptance remain pending; compiled tests are not runtime sign-off.
Real stopped-server login/dashboard was observed, but the complete interactive
revocation/offline-denial loop remains unverified. See audit finding 37 and the
latest PHASE2_EVIDENCE.md entry. Positive authorization still trusts renderer inputs;
native server verification was the next boundary at that checkpoint.

**Later October 10 native-authority checkpoint:** login/permission cache writes now
use a native server exchange rather than renderer-supplied grants. Login generation
guards, persistent per-account password backoff and a five-minute clock-rollback
guard are implemented. Native 48, frontend 105 and targeted auth 10 checks passed;
the targeted set includes actual PostgreSQL login/permission/revocation. See audit
finding 38 and the latest evidence for outage/runtime scope. This does not complete
security: protected storage/encryption and its recovery choice, CSP/transport audit,
legacy-authority transition and interactive auth acceptance remain open.

**Later October 8 inventory checkpoint:** local snapshot/account race guards,
pending bulk/movement preservation, cache IPC repair and lost-ACK cursor
reconciliation now pass actual PostgreSQL/two-disk-client tests.

**October 9 inventory checkpoint:** new desktop item/bulk/movement events now
use integer versions and same-author/device predecessor receipts. Stale edits,
bulk actions and deletes fail atomically; additive movements combine safely;
required audit and receipts commit together. Actual PostgreSQL tests cover
replay, two disk clients, migration repeatability and 600-record microsecond
cursor pagination. Browser item CRUD/bulk/storage/movement routes now share
this apply transaction, with stable retry keys, captured versions and tab-reload
retry recovery. Legacy/import conversion, broader inventory relationships,
automatic history refresh and new-offline initialization remain open. The
latest full backend run still hits the known DOCX timeout (54/55); desktop API
tests pass 54/54. Do not count the entire inventory domain or Phase 2 complete.

**Later October 9 import/history checkpoint:** inventory workbook commits now
freeze explicit create/update rows and persist one atomic protocol-2 batch.
Native retries, browser re-preview/lost-ACK recovery, per-row permissions,
all-or-nothing PostgreSQL effects and subsequent dependent edits are verified.
Movement history now refreshes through a pending-safe cache merge, enforces
local read permissions and distinguishes missing from downloaded-empty history.
Initial empty inventory requires an explicit server completeness flag. A fresh
offline-only installation still requires an initial download; no empty shared
database is invented. Latest checks: desktop API 65/65, native 37 passing with
7 opt-in live tests excluded, explicit inventory suite 9/9 including real
PostgreSQL/two-client restart, backend 55/55, TypeScript and production build.
DOCX's ignored minification option was corrected without relaxing safety limits;
current tests pass, but prior intermittent timeout evidence is retained.

**Scope**

- First resolve the open high-severity DOCX/image parser finding 33 with a
  compatible maintained/rebuilt converter and bounded execution tests. Do not
  treat a transitive override as proof that bundled parser code is repaired.

- Finish local-first inventory edge cases, maintenance CRUD (now implemented
  and verified), suppliers (now implemented and verified), and uncovered project/task/experiment/BOM/
  canvas/requirements, finance, purchase, and Excel import mutations. Each
  offline-capable mutation must commit local state and its outbox event in one
  SQLite transaction, use stable IDs, and have an idempotent PostgreSQL apply
  and pull/reconciliation path.
- Do the resource/media vertical slice: local file staging, uploads and editor
  copies, attachment and metadata changes, download queue/scheduling, job
  completion, thumbnails, deletes, and retries. Distinguish local intent from
  server-side media execution. Make completed downloads and thumbnails agree
  across Resources, Download Manager, and SQLite without duplicate records.
- Implement the chosen preference contract. Convert offline-capable comments,
  notification read state, and other collaboration records. Separate local
  preparation/queued intentions from server-confirmed effects: download queue
  edits/settings, automation run requests and approved administrative intentions
  need not disappear offline. Assistant generation, actual server job execution
  and security-sensitive authority remain server-dependent. Never claim a queued
  cancellation, reservation or permission grant has already taken effect globally.
  Use stable idempotency, version/conflict checks and local reconciliation.
- Implement the offline authentication/security work in the consolidated addendum:
  canonical account/session identity independent of server JWTs, native-verified
  authorization cache, credential/session revocation, secure credential/data/file
  storage design, login throttling, clock rollback handling and native permission
  coverage. Preserve lease policy and pending authorship; resolve key recovery and
  other material security/usability choices with the owner before implementation.
- Complete local report/activity/history/context/directory projections, local
  spreadsheet processing and full authorized file/thumbnail replication. Files
  held only on the server are not an offline PC copy. Show durable per-domain
  completeness, freshness and pending state rather than false zero/healthy values.
- Finish account isolation for local tables and media files outside
  `sync_state`; implement a backup/export and owner-approved recovery path for
  unattributed legacy cache, movement and outbox entries. Preserve revocation
  cleanup as local removal, never as an outbound delete. Add visibility/grant
  controls to resource/project creation only after backend enforcement and
  sync revocation are verified.
- Add failure-injection tests for zero HTTP writes after local failure;
  retry/replay/delete/duplicate tests; and per-domain offline, restart,
  reconnect, and second-client tests against the actual PostgreSQL service.
  For every offline-related fix, additionally execute the stopped-Docker-API
  desktop procedure in the addendum; include paused/hung API testing when relevant.

**Exit criteria:** every offline-capable desktop mutation has an atomic local
write/outbox path and reconciles correctly; intentional online-only paths are
explicit and do not masquerade as offline success; two-account and two-client
tests find no lost, duplicated, or unauthorized changes. The audit's actual
change, verification, and status fields are updated for every finding. Offline
features require recorded real desktop/API-stopped and reconnect acceptance,
including actual local file availability and cold restart where applicable.
Unperformed outage/security checks remain explicit blockers, not implied passes.

**Added Phase 2 work:** offline read completeness and source-specific availability
(contract approved; first availability slice implemented); traceable salvage/return/inspection/consumption and
financial projections; device audio-focus ownership and safe transitions;
schema-validated assistant proposals with human acceptance, ordinary permissions,
atomic outbox graph creation, stable retry identities and voice privacy/capability
contract. These are correctness/data-flow work, not cosmetic Phase 3 tasks.
The owner's 2026-10-10 additions also include quantity-aware inventory custody
(separate from record responsibility, with no double deduction on consumption)
and an end-to-end project relationship audit covering BOM, reservations, tasks,
experiments, canvas and their stock/financial evidence. See sections 4–5 of
[the scope supplement](PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md) for the investigation,
implementation and real offline acceptance requirements. These additions are
planned, not implemented or verified; they do not authorize discarding data.

## Phase 3 — Integrate the experience and certify the whole system

**Scope**

- Finish the Users/permissions redesign (compact directory with the assistant
  sidebar open; centered, accessible add/edit/granular-permission modals),
  visibility/grant administration UI, and consistent loading, empty, error,
  pending-sync, conflict, offline, and recovery states across all modules.
  Resolve the white-screen, clipping, scrolling, responsive-layout, and
  resource-thumbnail regressions with running-app visual checks.
- Complete search/assistant/context provenance and permission behavior,
  report/export consistency, and approved calculator integration. Preserve
  the current calculator until the collaborator-approved source/design is
  available; compare source fidelity, then test formula correctness, BOM/
  notebook/project insertion, permissions, accessibility, docking/resizing,
  and offline/online parity. If that handoff is unavailable, record the
  calculator portion as an explicit release blocker, not a passed check.
- Run the full matrix on the seeded *actual* PostgreSQL service and two
  distinct desktop clients: role and visibility combinations; same-record
  offline edits; interrupted requests; identical replay; deletion;
  revocation; account switching; server downtime; restart and recovery.
  Also run clean and upgrade migrations, repeat migrations, constraints,
  rollback/concurrency, packaging/installer upgrade, and backup/restore in
  isolated restore targets without replacing production data.
- Run fresh verification and security CI on the final commit, capture URLs,
  SHA, logs, build artifacts, supported-OS manual results, owner acceptance,
  unresolved defects, and independent review. Update the release/handoff
  ledger; do not claim completion from source inspection or a prior build.

**Added Phase 3 work:** salvage/consumption/finance workflow presentation; audible
TTS/music/lab-media tuning; assistant draft review and composer redesign with the
bottom-left context badge, retry/regenerate, internal-scroll jump menu and voice
controls; polished per-section offline states and real desktop stop/pause/restart
acceptance; quantity-custody presentation and integrated project navigation,
statuses and traceability. See the scope supplement for precise boundaries and
tests. Functional project links and stock accounting remain Phase 2 work.

**Exit criteria:** no known critical UI/data/security regressions; all current
automated and real-environment checks pass (or are explicitly accepted as
release blockers); restore and desktop upgrade are demonstrated; the owner
accepts the running application and final evidence record.
