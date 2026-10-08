# LabOS remaining work: three execution phases

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

**October 8 checkpoint:** DOCX isolation/replacement, the maintenance local-first
slice and hybrid preference data paths are implemented with automated evidence.
The preference two-disk-client test passed against existing PostgreSQL, including
an API restart between commit and lost-ACK replay. Finding 33's original parser
dependency was removed; newly reported dependency advisories are separately
tracked in PHASE2_EVIDENCE.md. Supplier/storage and the other paths below remain
open. Phase 2 is **not complete**; GUI acceptance is not inferred from API tests.

**Scope**

- First resolve the open high-severity DOCX/image parser finding 33 with a
  compatible maintained/rebuilt converter and bounded execution tests. Do not
  treat a transitive override as proof that bundled parser code is repaired.

- Finish local-first inventory edge cases, maintenance CRUD (currently only
  server-backed), suppliers, and any uncovered project/task/experiment/BOM/
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
  notification read state, and other collaboration records; explicitly mark
  assistant generation, automation execution, users/auth/role/grant changes,
  and any other server-authoritative effects as online-only with stable
  idempotency and cache refresh where relevant.
- Finish account isolation for local tables and media files outside
  `sync_state`; implement a backup/export and owner-approved recovery path for
  unattributed legacy cache, movement and outbox entries. Preserve revocation
  cleanup as local removal, never as an outbound delete. Add visibility/grant
  controls to resource/project creation only after backend enforcement and
  sync revocation are verified.
- Add failure-injection tests for zero HTTP writes after local failure;
  retry/replay/delete/duplicate tests; and per-domain offline, restart,
  reconnect, and second-client tests against the actual PostgreSQL service.

**Exit criteria:** every offline-capable desktop mutation has an atomic local
write/outbox path and reconciles correctly; intentional online-only paths are
explicit and do not masquerade as offline success; two-account and two-client
tests find no lost, duplicated, or unauthorized changes. The audit's actual
change, verification, and status fields are updated for every finding.

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

**Exit criteria:** no known critical UI/data/security regressions; all current
automated and real-environment checks pass (or are explicitly accepted as
release blockers); restore and desktop upgrade are demonstrated; the owner
accepts the running application and final evidence record.
