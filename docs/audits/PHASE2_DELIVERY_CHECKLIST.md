# Phase 2 fixed delivery checklist

Owner-approved execution reset, October 13, 2026. This is the single remaining
delivery/status checklist. It consolidates existing commitments; it does not add
a fourth phase, erase evidence, authorize data loss, or move functionality into
Phase 3. Detailed requirements remain in the linked source plans below.

## Baseline and rules

Exactly 18 remaining delivery items, in three implementation batches. These are
closure units of unequal size, not a percentage or an estimate of days. Existing
working code stays in place. A build, restart or additional unit test is evidence,
not a delivery item completed.

Baseline from the dated evidence ledger: 12 items have PARTIAL implementation;
6 are PLANNED. None of these remaining items is certified closed. This does NOT
mean earlier Phase 2 work is zero percent complete. Delivered foundations include
inventory versions/imports, maintenance, catalogs, hybrid preferences, comments,
notifications, local reports/activity/download paths, native authentication,
resource uploads/replication and Markdown/PDF/DOCX editor paths. Reuse them.

States: PLANNED -> PARTIAL -> IMPLEMENTED -> CLOSED. IMPLEMENTED means every
listed behavior exists and critical checks pass; CLOSED additionally requires
fresh applicable phase-end acceptance evidence. Record a blocker alongside the
state, with its exact prerequisite. Initial statuses are reconciled from existing
evidence, not a new claim of exhaustive source or live-app verification.

Within each fixed item, track bounded subchecks as **CODE REMAINING**,
**DEPENDENCY (named below)**, **IMPLEMENTED — AWAITING VERIFICATION**, or
**VERIFIED CLOSED**. Approval removes a decision blocker; it never substitutes
for implementation. A parent remains PARTIAL until all its required code exists.

- Freeze the IDs and scope below. New defects attach to the responsible item;
  maintain a bounded subcheck/defect list there instead of creating more projects.
  A genuinely new requirement needs explicit owner approval and an impact note.
  Never omit an existing commitment merely because it was missed in this index.
- Implement coherent batches with quick builds and critical auth/stock/sync checks.
  Do not restart/redeploy after each small edit. Coordinate deployment at useful
  batch boundaries; obtain saved-edit confirmation before closing the desktop.
- Run the complete acceptance sweep after implementation. Collect independent
  failures, mark dependent cases BLOCKED, apply grouped fixes, then rerun the full
  matrix. Stop affected work immediately for data-loss/corruption/security risks.
- Preserve databases, authored files, outboxes and unrelated working-tree changes.
  No reset, broad reseed, destructive recovery or automatic ownership reassignment.
- Each update names IDs changed, remaining counts, acceptance status and blockers.
  No completion percentage inferred from item counts. No whole-phase sign-off
  while implementation, required decisions or acceptance remain unresolved.

## Batch A — offline, security and resources

October 18 primary A1/B6 subcheck: H1-4 account-bound inventory history/custody/
assignee response guards and failed-query display masking are implemented in
source (53 contract/component checks PASS), awaiting integrated desktop verification.
Online read-refresh decoupling and the other B6 behaviors remain open. No parent
state changed. Evidence: `docs/handoffs/phase2-parallel/PRIMARY_INVENTORY_READ_GUARDS_2026-10-18.md`.

| ID | State | Required closure behavior / remaining boundary |
| --- | --- | --- |
| A1 | PARTIAL | Finish native account/lease/project/record permission coverage, cached resource edit grants (including notes/folders/restricted records), legacy cache trust and stale-response isolation. Preserve existing native-verified auth/revocation/backoff; add draft-preserving mid-session reauthentication. Review CSP, direct transports and token-bearing media paths. No permission or lease bypass. |
| A2 | PARTIAL | Protect credentials and implement owner-approved recoverable key/storage lifecycle for SQLite, WAL/temp, files, thumbnails and backups. Finish authorized recovery/export of legacy, revoked/deleted-resource and rejected pending work; preserve authorship. Explicit retention/quota/reclamation rules must protect authored/unacknowledged versions and shared references. Recovery choice is a prerequisite, not permission to use a lossy device-only key. |
| A3 | PARTIAL | Finish durable initial-download completeness, last successful sync and pending status for Dashboard, Operations, Lab Intelligence, Reports and Collaboration. Connect local audit/report/context/history projections; preserve partial authorized sections and distinguish unknown from empty. Existing local reports/activity implementations are not to be rewritten. |
| A4 | PARTIAL | Complete file/thumbnail availability across Resources, canvas attachments, item pictures and datasheets; finish local large-file export, media seek/range compatibility and PDF structural/security handling. Replication must resume, verify bytes, report storage failures and remain account-scoped. Metadata alone is not a PC copy. |
| A5 | PARTIAL | Finish resource operation dependencies: DOCX copies of unsynced sources, pending attachment/metadata chains, folder/nested moves, and editor-copy/content retry/recovery. Preserve originals, stable IDs, revisions and immutable events. No local-error -> HTTP fallback; existing upload/Markdown/PDF/DOCX paths remain the foundation. |
| A6 | PARTIAL | Tool-status cache and browser enqueue receipt parity are implemented, awaiting integrated verification. Finish worker/queue/file-readiness reconciliation; ensure cancel/completion races, deletion/tombstones and revocation cleanup preserve correct local/server state. Existing local controls/settings/queues remain. Pending cancel is not server-confirmed cancel; stale pulls cannot resurrect an authorized deletion. |

Batch exit: all six implementation boundaries addressed, evidence and defects
linked by ID, coordinated app/API build available. Acceptance remains separate.

## Batch B — inventory, projects and finance

October 20 reservation intent server checkpoint (primary, B3/B4): request and
confirm/reject/release sync handlers implemented with immutable identity, current
authority, stock allocation guards and atomic audit/receipt. Real PostgreSQL
handler regression batch 20 PASS, rollback verified. Native request/review
intentions, projections and UI wiring remain CODE REMAINING; no offline approval
authority is enabled. No parent/count changes. Next: native intentions and
ACK/pull/rejection reconciliation, then stopped-API/reconnect acceptance.
Evidence: `docs/handoffs/phase2-parallel/PRIMARY_RESERVATION_INTENTS_SERVER_2026-10-20.md`.

October 20 checkout UI follow-up (primary): confirmed allocations now expose
Issue to recipient, with centered recipient/quantity/serial/note dialog and
submission-time permission/session/allocation checks through the existing native
movement adapter. Source implementation; 52 adapter and 30 native checks passed
with API stopped (one integration case ignored). Actual desktop interaction and
reconnect acceptance remain pending; task/experiment selection, reservation
request/review/consumption intents and lifecycle work remain open. No parent
status/count changes. See latest PHASE2_EVIDENCE.md entry.

October 20 later primary B1/B3/A1/A5 checkpoint: native reservation-backed issue
and durable allocation overlays implemented with atomic SQLite/outbox, cached
authority and canonical work checks. Server reservation snapshots carry fulfillment
identities; ACK/pull ordering and explicit rejection recovery preserve allocations
and authored work. Desktop projected reservation reads have no HTTP fallback.
PostgreSQL batch 14 PASS; stopped-API native inventory 30 PASS / 1 IGNORED,
project/local DB regressions 8 PASS; adapter batch 48 PASS. Source only, awaiting
integrated desktop acceptance. Checkout UI, other reservation intents and their
read-after-write integration remain CODE REMAINING. Full implementation-ready
0/18; closed 0/18; all existing parent boundaries remain open. Next: checkout UI
and reservation intent integration, then coordinated deployment/acceptance.
Evidence: `docs/handoffs/phase2-parallel/PRIMARY_RESERVED_CUSTODY_NATIVE_2026-10-20.md`.

October 20 primary B1/B3 subcheck: reservation-backed custody server operation
implemented with transactional allocation/history, authority and quantity guards;
real PostgreSQL handler batch 13 PASS with full rollback. Source request/schema
compatibility and lock-order fixes included; migration NOT deployed. Native offline
reservation projection, pull/rejection reconciliation and checkout UI remain CODE
REMAINING; direct-route/concurrency acceptance remains unverified. No parent status
or implementation-ready/closed count changed.
Evidence: `docs/handoffs/phase2-parallel/PRIMARY_RESERVED_CUSTODY_SERVER_2026-10-20.md`.

October 19 primary B3/B4/A1 subcheck: same-project requirement/work/canvas
relationship guards and stored-owner sync authorization implemented in source.
Foreign link deletion is rejected; valid connector updates no longer reference a
missing timestamp column. Native project batch 4 PASS with API/DB stopped; expanded
real PostgreSQL handler batch 8 PASS, rollback verified. Not deployed/integrated
acceptance. Reservation-backed issue, local reservation intents/projection,
browser parity, demand aggregation and lifecycle settlement remain CODE REMAINING.
Project post-commit audit atomicity remains open. No parent status/count changes.
Evidence: `docs/handoffs/phase2-parallel/PRIMARY_PROJECT_RELATIONSHIP_GUARDS_2026-10-19.md`.

October 19 primary B1 subcheck: dedicated native custody intent/quantity writer
implemented; movement-before-custody FK ordering and settlement numeric SQL repaired
and checked against real PostgreSQL (8 PASS, complete rollback). Renderer offline
batch 55 PASS; native arithmetic 4 PASS. Follow-up native inventory batch: 21 PASS,
0 FAIL, 1 IGNORED, including eight on-disk custody cases with API stopped. Fixed
wrong-item/duplicate custody cache acceptance. Native atomicity and connection-reopen
subcheck verified; not deployed. Integrated server replay, reservation/project
coupling and remaining B1 behaviors are still open. B1's stale PLANNED label is
reconciled to PARTIAL, not acceptance closure. See
`docs/handoffs/phase2-parallel/PRIMARY_CUSTODY_REPAIR_2026-10-19.md`.

Further October 19 primary B1/A2 subcheck: real PostgreSQL push-handler replay and
receipt-failure batch 5 PASS (rollback-only; no HTTP/auth middleware or parallel
acceptance). Explicit rejection resolution now preserves account-owned recovery
snapshots and outbox payloads, invalidates rejected custody and blocks new writes
until authorized server reconciliation. Native inventory 24 PASS/1 IGNORED;
local DB/import regressions 7 PASS; receipt processing 3 PASS, with server stopped.
Recovery UI/export/retention and deployed/multi-client integration remain open.
No parent closure. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_CUSTODY_SYNC_RECOVERY_2026-10-19.md`.

| ID | State | Required closure behavior / remaining boundary |
| --- | --- | --- |
| B1 | PARTIAL | Quantity-aware custody: separate responsible person from physical issue; split issues, recipients/transfers, partial return/consumption/damage/loss and outstanding balances. Consuming issued stock cannot deduct storeroom stock twice. Preserve provenance, units, permissions and provisional offline allocation. Existing assigned_to is not evidence of a physical issue. |
| B2 | PLANNED | Traceable salvage/returns/disassembly/scrap linked to source project and issue/consumption. Human confirmation/inspection before usable stock, no over-recovery or duplicate credit, preserve historical consumption. Separate recovery value, carrying/replacement value and actual repair expense; no invented purchase/cash refund. Reviewed recovery valuation is owner-approved below; implementation remains. |
| B3 | PARTIAL | Audit and complete canonical links among projects, BOM revisions, requirements, reservations, tasks, experiments, canvas, notes/resources and financial evidence. Shared demand must not be double-counted; visual references must not duplicate/delete underlying records. Finish remaining local mutation/repeat/revision paths and remove missing-record server fallbacks. |
| B4 | PARTIAL | Finish project review/reservation/history/context projections and queued submissions/decisions. Define and implement revision, cancellation, reservation release, archive/delete and closure propagation while preserving custody/results/audit/finance history. Task completion must not silently consume stock or fabricate results; global acceptance remains distinct from local intent. |
| B5 | PARTIAL | Finish finance/purchase local templates, export, preview and transactional workbook imports; remaining purchase/finance mutations use stable retry identity, atomic local/outbox writes and server reconciliation. Enforce financial permissions, concurrency and all-or-nothing effects. Retain existing inventory-import implementation. |
| B6 | PARTIAL | Close remaining inventory/storage relationships, field/assignment history and authorized assignee directory; local inventory templates/export, workbook parser hardening and legacy-event recovery. Preserve existing versioned CRUD/bulk/movements/import/history fixes and explicit snapshot completeness. Apply the common sync contract across remaining uncovered domain operations. |

Batch exit: functional connected workflows, not isolated forms; explicit stock,
custody and finance effects with no double accounting. Resolve business-rule
choices before dependent migrations; continue independent items meanwhile.

## Batch C — assistant, audio and queued actions

| ID | State | Required closure behavior / remaining boundary |
| --- | --- | --- |
| C1 | PLANNED | Authorized, schema-validated project/task/experiment proposals with stable IDs, versions, context provenance and persistent editable drafts. Saved drafts work offline; generation remains provider/server-dependent. Keep conversation/message/request retry separate from deliberate regeneration. |
| C2 | PLANNED | Human-reviewed proposal acceptance through ordinary native repositories/outbox and idempotent server graph apply. Recheck permissions/scope, attribute to the approver, prevent double acceptance and partial bundles masquerading as complete. No assistant stock movements, spending, grants, destructive deletes or fabricated physical results. Depends on A1 and B3/B4. |
| C3 | PLANNED | One device audio-focus coordinator for music, lab media, TTS and microphone: owner tokens, cancellable transitions, preserved position/volume, manual-pause intent and safe release on errors/navigation/account change. Stale callbacks cannot resume audio under another owner. |
| C4 | PLANNED | Establish and implement the voice capability/privacy boundary needed by Phase 3 controls: supported provider/runtime choice, explicit recording/stop/cancel, transcript review before send, no silent upload/submission and text fallback. Integrate microphone with C3; do not claim offline recognition without evidence. Polished composer controls remain Phase 3. |
| C5 | PARTIAL | Local automation due-item projection and durable run intentions, stable run IDs, uncertain-result reconciliation and server-side permission/idempotency checks. Pending intentions survive restart but are not displayed as executed effects. |
| C6 | PARTIAL | Authorized cached users/permission/settings views and approved ordinary profile/preference intentions; complete remaining online-authoritative retry/cache contracts. Administrative intentions cannot grant effective offline authority; password/reset actions remain server-confirmed and never queue plaintext passwords. Preserve implemented hybrid preferences. |

Batch exit: permissioned functional flows and clear online-only boundaries.
Composer visual polish and release certification remain Phase 3, not correctness.

## Approved decisions — October 14 implementation contract

The owner explicitly selected all five recommendations. These policy blockers
are resolved; the dependent code and acceptance are not thereby complete.

- **A2 — owner-held recovery.** Windows-protected everyday access plus a separately
  stored encrypted recovery package and recovery secret. Do not give every admin
  automatic decryption access. Recovery requires backed-up database/files as well
  as keys. Losing every backup remains unrecoverable. Migration must preserve and
  verify originals, pending outbox events and authored versions before any switch;
  no destructive cleanup or lossy device-only key policy is authorized.
- **B1 — quantity-first custody, optional serials.** Assignment is responsibility,
  not physical issue. Support split issues, recipients/transfers, outstanding
  balances and partial returns. Only explicitly authorized stock handlers post
  movements. Unserialized units cannot be individually traced. Consumption from
  custody must not subtract storeroom stock a second time.
- **B3/B4 — canonical demand and explicit settlement.** Tasks/experiments reference
  the same project requirement; extra demand is explicit, not inferred twice.
  Cancellation releases unused reservations only. Issued stock stays outstanding
  until recorded return, consumption or loss. An unsettled project may be archived
  but must not be labeled fully settled. Preserve results and financial history.
- **B2 — reviewed salvage value.** Preserve original cost/consumption and provenance;
  recovered parts enter quarantine pending human inspection. Record a separately
  reviewed recovery value, with unknown remaining unknown. No automatic project
  expense credit, cash refund or invented purchase transaction.
- **C4 — consented server transcription first.** Use a configured provider with
  disclosed processing/retention. Recording is user-initiated and cancellable;
  the transcript is reviewed/edited before sending, never automatically submitted.
  Connectivity is required; this does not promise offline speech recognition.
  Provider/runtime integration and C3 microphone focus remain implementation work.

No further answer is required for those five choices. New material tradeoffs must
still be surfaced with pros/cons; do not reopen these approvals merely because
implementation has not begun. Retention defaults must protect authored and
unacknowledged work; approval of encryption is not approval to delete originals.

## Bounded implementation register — October 14

This register splits progress inside the same 18 items, not into new phases.
Historical evidence remains linked below. None of these source-only changes is
a deployed-build or integrated-acceptance claim.

| Parent | Bounded subcheck | Status | Remaining implementation / dependency |
| --- | --- | --- | --- |
| A1/A5 | Native-fetched resource/ancestor/destination grants, native-authored file proof and verified file confirmation | IMPLEMENTED — AWAITING VERIFICATION | Broader A1 writer/security audit and A5 mixed/partial-ACK chains remain separate code obligations. |
| A1/A5 | Uninterrupted direct move/metadata chains and strict metadata patches | IMPLEMENTED — AWAITING VERIFICATION | Not content-after-move, mixed creation/content chains, legacy intents or nested moves. |
| A1/A5 | Native-verified mutation receipts and direct move/metadata partial-ACK continuation | IMPLEMENTED — AWAITING VERIFICATION | October 15: exact intent/result digest binding, atomic native receipt/authority/ACK, confirmed-prefix reconstruction without rewriting saved intents. Mixed file-prefix chains and legacy ACKs without native receipts remain separate code obligations. Compile and real outage/authority-race acceptance tracked in evidence. |
| A6 | Account-scoped last checked server-tool status, bounded probes and explicit unknown/stale display | IMPLEMENTED — AWAITING VERIFICATION | Integrated snapshot persistence, stopped-API cold restart and access-revocation cases. |
| A6 | Browser enqueue request identity and transactional server receipt parity | IMPLEMENTED — AWAITING VERIFICATION | Real PostgreSQL concurrent/lost-ACK/revocation cases; browser build and API must deploy together. |
| A6 | Attempt-owned worker lifecycle, cancellation/completion guards and current requester authorization | IMPLEMENTED — AWAITING VERIFICATION | October 15: dedicated job leases, run-ID fences, preserved attempt files and bounded process/thumbnail handling. Actual PostgreSQL/process-race acceptance remains. |
| A6 | Cross-device download-history removal markers | IMPLEMENTED — AWAITING VERIFICATION | October 15: transactional server markers and native monotonic merge prevent old receipts/pulls from reviving removed history; resource/file deletion is separate. |
| A6 | Downloads-page PC-copy status and local preview routing | IMPLEMENTED — AWAITING VERIFICATION | October 15: native-only metadata/copy observations; server completion is separate from current-resource PC availability; no desktop HTTP thumbnail fallback; stale revision/origin copies are not current. Real stopped-API/cold-restart/account-switch verification remains. |
| A6 | October 16 queue-reader defect and automatic saved-link intake | DEPLOYED — AWAITING INTEGRATED VERIFICATION | Native view `rowid` fix deployed. Replacement automatically lists saved media links in Downloads as Awaiting schedule; scheduling there uses existing outbox/identity. 28 focused frontend checks, TypeScript and 9 native tests pass, including actual SQLite read/scheduled-retry rollback with API stopped. Rebuilt app running; Resources buttons confirmed removed. Downloads UI inspection blocked by computer-use helper's invalid window bounds. Worker/reconnect acceptance remains open. |
| A6 | Remaining consumers, legacy removal reconciliation and revocation cleanup | CODE REMAINING | Complete remaining consumers and retained-byte policy; no new owner decision required. Historical deletions without receipts are not guessed. |
| A2 | Recoverable encryption, non-destructive migration/restore and retention | CODE REMAINING | Owner-held recovery is approved. Implement key/data backup verification and recovery; approval alone is not a migration. |
| A3/A4 | Remaining composite snapshot completeness and file/thumbnail consumer coverage | CODE REMAINING | Continue existing projections/replication; no unresolved policy choice. |
| A5 | Mixed and partially acknowledged chains, unsynced destinations, nested moves and legacy recovery | CODE REMAINING | Use existing grant/provenance/receipt foundations; preserve unsupported authored work. |
| B1 | Quantity custody ledger and optional serials | CODE REMAINING | Main business rules approved; no longer blocked on owner selection. |
| B2 | Quarantined salvage, inspection and reviewed recovery valuation | DEPENDENCY | B1 custody/provenance quantities; independent schema/UI planning can proceed. Valuation policy approved. |
| B3 | Connected requirements/BOM/tasks/experiments/canvas and remaining local mutations | CODE REMAINING | Canonical demand approved; integrate B1 quantities where stock effects apply. |
| B4 | Cancellation/closure propagation and settlement | DEPENDENCY | B1 outstanding custody and B3 canonical demand; settlement policy approved. Independent history/review projections can proceed. |
| B5/B6 | Remaining finance/import and inventory relationship/history/recovery paths | CODE REMAINING | Existing ordinary permission/version/outbox contract; custody-specific consumers depend on B1. |
| C1 | Validated, persisted editable assistant proposals | CODE REMAINING | No stock execution or automatic acceptance; use existing permissions/context boundaries. |
| C2 | Human acceptance of connected proposal graphs | DEPENDENCY | A1 enforcement plus B3/B4 graph/lifecycle contracts. |
| C3 | Device audio-focus coordinator | CODE REMAINING | No unresolved policy choice. |
| C4 | Consented provider transcription and microphone lifecycle | DEPENDENCY | Server-first boundary approved; C3 microphone focus plus provider/runtime implementation. |
| C5/C6 | Remaining durable automation intentions and authorized cached settings/users | CODE REMAINING | Administrative actions remain server-authoritative; no plaintext password outbox. |

Awaiting verification means code for the named subcheck exists, not that its
whole parent is ready. Keep full acceptance at phase end; use only quick builds
and focused critical invariant checks while finishing implementation.

## Phase-end acceptance register

Attach test cases and results to A1–C6. Retain existing historical passes as
evidence, but not as automatic passes on the final integrated build. For each
applicable gate record PASS, FAIL, BLOCKED (prerequisite) or NOT RUN; a nonapplicable
gate needs a reason. All gates start NOT RUN for this new integrated closure sweep.

1. Functional/safety: every closure behavior, permission denial and invariant;
   protocol/UUID normalization, atomic writes, no fallback after local failure.
2. Real offline desktop: stop only the actual LabOS API, retain DB/volumes, test
   navigation/refresh/files/writes/deletes, logout/login where relevant, cold
   restart and persistence. Pause/hung API additionally where timeout-sensitive.
3. Reconnect: existing actual PostgreSQL, push/pull, file integrity, lost ACK,
   retry/idempotency, delete propagation and pending-intent reconciliation.
4. Two clients/accounts: conflicts, concurrent stock/demand effects, visibility,
   expired/revoked access, stale replies and preserved rejected authored work.
5. Failure/recovery: crashes, interruption, malformed files/imports, disk-full,
   dependency failure and tested key/data recovery without replacing user data.
6. Full rerun/evidence: fix grouped root causes after independent tests finish;
   rerun earlier passes too, restore service state, record artifact/diff, exact
   fixtures and sanitized results. No unit/browser-only substitute for desktop.

## Status and next execution

October 17 primary review checkpoint: the A6/A4 downloaded-link pull omission has
a bounded source fix and 18 passing unit/contract checks; deployment and actual
PostgreSQL/Tauri outage/reconnect verification remain open. Both helper deliveries
have CHANGES REQUESTED in `docs/handoffs/phase2-parallel/PRIMARY_REVIEW_2026-10-17.md`.
Custody/salvage correctness, audio ownership and combined build failures prevent
promoting any B/C parent. The owner and primary now take over review/polish; a
helper report labelled complete is not accepted phase status. No closure count
is reduced by this checkpoint.

Baseline: 18 open closure items (12 PARTIAL, 6 PLANNED); none yet IMPLEMENTED in
full or CLOSED under this remaining-work checklist. Phase-wide sweep: NOT RUN.
These counts describe remaining obligations only, not all work already delivered.

October 13 implementation checkpoint — A5, with A1 permission boundaries retained:

- PDF/DOCX copies now record an explicit predecessor for an unsynced source
  creation, copy or content edit; server validation resolves its immutable receipt
  under the same author/device/source identity and rechecks current source access.
- Account-scoped conflict blocking/discard follows derived copies and later
  mutations; failed file transfers withhold dependent copies in the same pass.
  Retiring an intent does not delete any authored file or version record.
- Native edit access follows unconfirmed-copy ancestry with bounded cycle
  detection. An unconfirmed local creation is not treated as revoked merely
  because it is not in a server snapshot; confirmed-source denial still wins.
- This is source implementation, not a deployed build or acceptance pass. A5
  remains PARTIAL: metadata/attachment/folder chains, complete recovery workflows
  and integration/replay verification remain. A1 record-specific grants are not
  expanded by this change. Native rejection does not fall back to HTTP.

October 14 implementation checkpoint — A1 record edit authority foundation:

- Added bounded server edit-authority projections and native-only fetching from
  the compiled trusted origin. Cached decisions bind account, origin, resource,
  attachment/visibility, observed revision and the exact current login lease.
  No IPC-supplied positive grant or lease extension is accepted.
- Direct/shared/restricted resource editor checks for non-admins now consume that
  native cache rather than infer edit access from a renderer-fed project row.
  Note/folder inheritance stays blocked pending verified ancestor bindings;
  administrator behavior and other native writers still require the wider A1 audit.
- Owner delegated the content-only lease choice to the recommended approach.
  After safety review rejected a blanket revision relaxation, implementation kept
  exact-revision checks plus a narrow native-published content-chain proof for
  repeated saves. Scope changes, arbitrary versions, foreign accounts/devices,
  expired/replaced leases and retired unconfirmed versions cannot use that proof.
- New native revisions are recorded additively; old authored bytes/events are
  not deleted or rewritten. Legacy versions without proof remain fail-closed.
  Source implementation only: deployment and phase-end acceptance are still open.

October 14 follow-on checkpoint — A1 inherited source authority:

- Protocol 2 binds a complete leaf-to-root resource chain and attached-note
  visibility/project scope. Native code compares those bindings against the
  current account's SQLite records before allowing a non-admin source edit.
  Exact revisions/content-only proof and the existing login lease still apply.
- Server traversal detects cycles, missing notes/parents, non-folder ancestors
  and conflicting/multiple parents. Chains above 32 records fail closed rather
  than using a truncated authority context. This boundary needs real-data review
  during acceptance; no tree or authored work is deleted.
- Source grants do not authorize attachment destinations. Note/folder creation
  destinations and pending metadata/attachment chains remain open. Old caches
  need one verified refresh; deploy the compatible API before the new native
  binary. No restart or deployment occurred at this checkpoint.
- Critical pure checks passed (24 backend, seven native, six desktop adapters),
  with native test compilation and TypeScript checking. Actual PostgreSQL SQL,
  stopped-API desktop/restart and reconnect acceptance remain NOT RUN.

October 14 follow-on checkpoint — A1 destination grants and A5 edit-before-move:

- Project/note attachment destinations now have their own native-fetched,
  account/origin/scope/login-lease-bound decision cache. Non-admin project file
  writers no longer trust renderer-fed project edit flags; existing global
  project permission checks remain. Folder destinations check the folder's own
  verified resource grant, not the source file's grant. Administrator policy is
  not expanded. Verified project-note destinations can retain project visibility.
- Authority refresh now runs after resource/project/note pulls so a newly pulled
  note can receive a destination grant in the same pass. Denials replace cached
  positives; outages cannot extend leases. Deploy the API before the new binary.
- A direct attachment move can depend on its own pending native file creation,
  copy or content edit. Protocol 2 resolves the same author/device/resource
  receipt on the server and still checks current permissions and revisions.
  Conflicted/unsupported predecessors remain blocked; no authored bytes removed.
- Source implementation only, not deployed. Repeated attachment moves, generic
  metadata chains, new local-source grants for non-admins, new unsynced destination
  grants and folder/tree moves still remain. Full acceptance remains NOT RUN.

October 14 follow-on checkpoint — A1/A5 native-authored pending files:

- Fresh native file creations/copies now prove their own authorship using a ready
  upload record plus the same-account/device unsynced native outbox creation.
  No server grant is invented. Current resources view/edit/create permissions,
  login lease, verified destination scope and copy-source ancestry remain required.
- Further saves must retain scope/type/source identity and either the original
  native revision/size or a proven native content-edit chain. Conflicts, metadata
  changes, moved scope, retired creates and unsupported predecessors fail closed.
- This closes the blanket non-admin pre-first-sync editing restriction in source,
  not the whole new-record lifecycle. ACK-to-authority-refresh interruption,
  new unsynced destinations and repeated moves remain acceptance/implementation
  work. Source remains undeployed and all 18 closure units remain open.

October 14 follow-on checkpoint — A1/A5 verified confirmation handoff:

- File creation/copy/content confirmations now come directly from the trusted API
  into native code. Native selects up to 100 pending file events for the same
  resource/account/device, checks exact identity/operation/size and atomically
  stores verified receipts, authority decisions and acknowledgements. Changed
  pending work/session/lease causes a retry without rewriting the original events.
- Confirmation no longer requires current local edit permission: already-applied
  owned work can be acknowledged after access changes while the current authority
  remains denied. This fixes the source-level receipt guard that could stall an
  edit confirmation after a queued attachment move.
- Unchanged final local versions can adopt the matching verified server revision
  in that transaction. Newer local work is preserved; pending edits can trace
  through a native-confirmed creation receipt. Renderer-supplied file bindings and
  generic unverified file ACKs are blocked. Older binaries leave events pending
  with an upgrade message; deploy API then coordinated desktop build.
- Source implementation, not acceptance: real interruption/replay/database/UI
  cases remain NOT RUN. General metadata/repeated-move/folder chains and the
  post-move content-revision handoff still remain. All 18 closure units stay open.

October 14 follow-on checkpoint — A1/A5 native move and metadata chains:

- Direct repeated attachment moves and category/description/tag edits now share
  native-only before/after provenance and immutable predecessor IDs. Their local
  record, provenance and outbox event commit together. The source grant and every
  intervening move destination are rechecked; no old-scope grant is extended to
  content editing or copying. Metadata cannot alter visibility or attachments.
- New metadata writes use an explicit patch, preserve unspecified fields, capture
  account/native session, and reject old native binaries without an HTTP fallback.
  New `edit_metadata` intents are server revision-checked; protocol-3 moves can
  follow owned move/metadata receipts. Audit and metadata apply are transactional.
- Failed/discarded move and metadata intents propagate to dependent work. Saved
  provenance and file versions remain; conflicts do not auto-overwrite revisions.
- Scope remains PARTIAL: uninterrupted native move/metadata chains are covered;
  mixed content/create chains, partial-ACK continuation, legacy intents, unsynced
  destinations, folder/nested moves and content-after-move still need completion.
  Existing queued events are neither rewritten nor deleted. Not deployed.
- 24 backend pure/receipt-double, 28 native pure and 23 desktop adapter/dependency
  checks passed (75 total); TypeScript/native compilation passed. Actual database,
  stopped-API desktop and reconnect acceptance remain NOT RUN for this change.
  All 18 delivery items remain open; A1/A5 are not yet implementation-complete.

October 14 follow-on checkpoint — A6 independent download subchecks:

- Server diagnostics now use bounded parallel probes and a shared short-lived
  observation. The account-scoped native download snapshot retains a validated
  last-known check if an optional report is missing/invalid/older. Desktop tool
  reads use SQLite only; labels identify the observation time, not live worker
  health or file presence. First-check absence is unknown, not an empty success.
- Browser enqueue now persists an account/server/payload-bound request identity
  before HTTP and retains it on errors/reloads. The server serializes by receipt
  ID, checks current permission and exact receipt ownership, and commits the job,
  creation audit and receipt together. Existing active jobs are reused without
  another creation audit. Desktop enqueue remains native/outbox-only.
- Source implementation only. Both bounded subchecks are IMPLEMENTED — AWAITING
  VERIFICATION; A6 remains PARTIAL for worker/file reconciliation. Database and
  stopped-API desktop acceptance remain NOT RUN. No deployment/restart/reset.

October 15 follow-on checkpoint — A6 worker ownership and removal propagation:

- A dedicated PostgreSQL session lease now covers each complete download attempt.
  Recovery skips live leases, revokes the abandoned run ID before retry, and
  respects pending pause/cancel and retry ceilings. Claiming rechecks scheduler
  limits under a shared transaction lock. Progress/publication require the current
  attempt; previous callbacks cannot stop a newer attempt's process.
- Current requester active/role/permission/resource access is checked at claim,
  during execution and before publication. Changed source URL/type, missing
  resource or already-published media prevent stale publication. A real authority
  lookup failure stops monitored processes but is not fabricated as a revocation.
- Attempts use distinct filenames and no failure cleanup deletes previous bytes.
  Thumbnail preparation is optional, attempt-local and time-bounded; promotion
  does not overwrite an existing thumbnail. Captured process output and pending
  progress callbacks are bounded. Worker timestamps advance monotonically so a
  late progress snapshot cannot replace a newer terminal state at the same version.
- Download-history removal writes a scoped server tombstone transactionally.
  Existing committed removal receipts can backfill missing markers without hiding
  live jobs. Authorized snapshots supply markers; native merge retains them across
  later pulls and receipts. Reusing a retired job UUID is rejected. No resource,
  authored file, pending intent or previous attempt file is deleted by this work.
- Additive migration `20261014_download_worker_attempt.sql` is not applied yet.
  Stop all old-version API workers for coordinated deployment, apply migration,
  then start updated API and desktop builds; old workers do not honor new leases.
  Full database/outage/process acceptance remains NOT RUN. A6 remains PARTIAL.

October 15 follow-on checkpoint — A6 download PC-copy presentation:

- Queue/history thumbnails use native cached resource posters in desktop, never
  server or external thumbnail fallback. Missing/broken artwork has a placeholder.
- History reports current resource PC-copy availability separately from server job
  completion. Unknown local status does not erase the queue or claim absent bytes;
  local resource access is still required. Account/generation-bound reads reject
  switched sessions. Poster URLs are hidden immediately when their identity changes.
- Native copy observations distinguish stale revision/origin from the current copy;
  stale byte counts are not reported as progress on current content. Existing file
  presence/size and authorization checks remain required for ready presentation.
- 15 focused TypeScript adapter/presentation checks and two native pure checks
  passed; TypeScript and native compilation passed. No actual database, UI, outage,
  restart or deployment acceptance was run. A6 remains PARTIAL, not closed.

October 15 follow-on checkpoint — A1/A5 direct-mutation confirmation:

- Attach/metadata ACKs now require a native request to the trusted API, not a
  renderer-supplied success. Owned historical receipts carry bounded digests of
  the immutable intent and resulting scope/metadata. Current authority remains a
  separate verified snapshot; confirming historical work does not restore access.
- Native receipt, current authority and ACK commit atomically. Generic ACK cannot
  retire these mutations without native proof. Failed/old-binary confirmation
  preserves the intent and stable change ID for retry.
- A wholly native direct move/metadata chain can reconstruct an acknowledged
  prefix using origin/account/device/payload-bound receipts. Later work uses the
  latest confirmed result/revision for its authority check, validates the complete
  immutable chain and rechecks pending destinations. Missing proof, altered chains,
  current denials and mixed file-prefix chains remain blocked without data loss.
- This is source implementation, not deployed or phase sign-off. No database reset,
  migration, app restart or pending-work deletion. See the dated evidence for
  verification results and remaining integrated acceptance.
- Verification checkpoint: 45 focused pure/adapter checks passed, plus native
  test build/cargo check, TypeScript, backend syntax and diff checks. Actual
  PostgreSQL and stopped-API desktop acceptance remain NOT RUN.

Next: finish independent Batch A code, including remaining A6 consumer
and legacy/revocation reconciliation and A5 mixed/partial-ACK chains. A2 now has an approved recovery
policy; implementation must preserve all existing data. All five decision
blockers above are resolved; named code dependencies are not owner blockers.

October 16 checkpoint — A1/A5 file-confirmation prerequisite:

- New pending-file confirmations require negotiated protocol 2 and an exact
  committed-payload digest, not merely a matching resource/size. Native commit
  rechecks trusted origin as well as session/lease and unchanged saved work.
- 34 focused pure/adapter checks passed; native test compilation, backend syntax
  and scoped whitespace checks passed. Compatible API/native deployment and real
  PostgreSQL/outage acceptance remain pending. Legacy receipt provenance and mixed
  chains are still open; no parent item or phase is closed by this checkpoint.
- Phase 3 visual-agent spot review is recorded separately with CHANGES REQUESTED;
  its contributions and reported builds are not primary Phase 2 completion evidence.

Update format: `IDs changed | implementation-ready count / 18 | closed count / 18
| remaining IDs | exact blockers | next batch action`. Do not append unrelated
enhancements or treat a build/restart as an item closed.

## Source requirements and evidence

- [Three-phase scope](THREE_PHASE_REMAINING_WORK_PLAN.md)
- [Offline/security and real outage acceptance](PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md)
- [Salvage, project/custody, assistant and audio additions](PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md)
- [Dated implementation and verification evidence](PHASE2_EVIDENCE.md)
- [Operation-level audit findings](OFFLINE_FIRST_WRITE_PATH_AUDIT.md)

This checklist governs remaining work/status and cadence. Source requirements
and audit details remain binding; dated later evidence supersedes earlier status
paragraphs. This documentation change does not itself implement or certify code.
