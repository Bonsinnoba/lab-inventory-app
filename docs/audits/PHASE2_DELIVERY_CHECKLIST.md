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

| ID | State | Required closure behavior / remaining boundary |
| --- | --- | --- |
| A1 | PARTIAL | Finish native account/lease/project/record permission coverage, cached resource edit grants (including notes/folders/restricted records), legacy cache trust and stale-response isolation. Preserve existing native-verified auth/revocation/backoff; add draft-preserving mid-session reauthentication. Review CSP, direct transports and token-bearing media paths. No permission or lease bypass. |
| A2 | PARTIAL | Protect credentials and implement owner-approved recoverable key/storage lifecycle for SQLite, WAL/temp, files, thumbnails and backups. Finish authorized recovery/export of legacy, revoked/deleted-resource and rejected pending work; preserve authorship. Explicit retention/quota/reclamation rules must protect authored/unacknowledged versions and shared references. Recovery choice is a prerequisite, not permission to use a lossy device-only key. |
| A3 | PARTIAL | Finish durable initial-download completeness, last successful sync and pending status for Dashboard, Operations, Lab Intelligence, Reports and Collaboration. Connect local audit/report/context/history projections; preserve partial authorized sections and distinguish unknown from empty. Existing local reports/activity implementations are not to be rewritten. |
| A4 | PARTIAL | Complete file/thumbnail availability across Resources, canvas attachments, item pictures and datasheets; finish local large-file export, media seek/range compatibility and PDF structural/security handling. Replication must resume, verify bytes, report storage failures and remain account-scoped. Metadata alone is not a PC copy. |
| A5 | PARTIAL | Finish resource operation dependencies: DOCX copies of unsynced sources, pending attachment/metadata chains, folder/nested moves, and editor-copy/content retry/recovery. Preserve originals, stable IDs, revisions and immutable events. No local-error -> HTTP fallback; existing upload/Markdown/PDF/DOCX paths remain the foundation. |
| A6 | PARTIAL | Finish download tool-status cache, browser enqueue receipt parity and worker/queue/file-readiness reconciliation; ensure cancel/completion races, deletion/tombstones and revocation cleanup preserve correct local/server state. Existing local controls/settings/queues remain. Pending cancel is not server-confirmed cancel; stale pulls cannot resurrect an authorized deletion. |

Batch exit: all six implementation boundaries addressed, evidence and defects
linked by ID, coordinated app/API build available. Acceptance remains separate.

## Batch B — inventory, projects and finance

| ID | State | Required closure behavior / remaining boundary |
| --- | --- | --- |
| B1 | PLANNED | Quantity-aware custody: separate responsible person from physical issue; split issues, recipients/transfers, partial return/consumption/damage/loss and outstanding balances. Consuming issued stock cannot deduct storeroom stock twice. Preserve provenance, units, permissions and provisional offline allocation. Existing assigned_to is not evidence of a physical issue. |
| B2 | PLANNED | Traceable salvage/returns/disassembly/scrap linked to source project and issue/consumption. Human confirmation/inspection before usable stock, no over-recovery or duplicate credit, preserve historical consumption. Separate recovery value, carrying/replacement value and actual repair expense; no invented purchase/cash refund. Valuation requires owner approval. |
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

## Decisions — resolve only the affected dependency

No new choice is silently approved by agreeing to this execution reset. Present
concrete pros/cons with source evidence before the dependent implementation:

- A2: recoverable encryption/key custodian and migration/restore policy. Loss of
  authored work is unacceptable; do not offer device-only loss as the default.
- B1/B3/B4: custody permission rules, pooled versus serialized representation,
  shared versus work-item demand and cancellation/settlement behavior.
- B2: reviewed recovery valuation and financial attribution; no automatic journal
  credit until approved.
- C4: local versus server transcription after Windows/runtime/privacy inspection.

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

Next: continue Batch A with remaining metadata/attachment dependencies and local
creation authority. Investigate A2 recovery options alongside it;
a pending key-policy choice must not stall unrelated work.

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
