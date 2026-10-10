# Additions and offline-read diagnosis — 2026-10-09

The initial checkpoint was planning/diagnosis only. The owner's subsequent “go”
approved the available-section contract below. Its first implementation is now
recorded in PHASE2_EVIDENCE.md; the other additions remain planned, not delivered.
Keep the existing three phases; expand Phases 2 and 3 rather than introduce another.

## Initial offline diagnosis (before the first implementation)

Command in `desktop`: `node --test scripts/offline-read-diagnostic.test.mjs`.
All 13 characterization checks passed. Several explicitly assert known defects:
passing means the defect was reproduced, **not** fixed. The harness executes
current TypeScript adapters using controlled local-repository fixtures and failed
HTTP transport. It does not invoke the installed desktop's SQLite, stop Docker,
validate current offline leases or certify rendering. These are not database
tests; subsequent integration tests must use actual PostgreSQL and scoped fixtures.

| Area | Evidence | Conclusion |
| --- | --- | --- |
| Reports | `api/reports.ts` calls `/reports/overview` directly; transport failure rejects. | Local reporting projection is missing. |
| Collaboration | Activity reads `/collaboration/activity`; notifications/comments have separate local repositories. | Offline coverage is partial. Live refresh needs the server; last-synced authorized activity need not disappear. |
| Downloads | Queue/settings/tools are remote reads; unscheduled desktop enqueue has local IPC. | Queue display is not offline-first, despite a local enqueue path. Server job execution itself legitimately needs the server. |
| Resources | Local metadata survives failed queue enrichment. Native read errors are swallowed and followed by `/resources`. Enrichment awaits the remote queue. | Partial support; remote enrichment can delay local data and fallback can hide the original error. Healthy local-list disappearance was not reproduced. |
| Media bytes | `getLocalMediaUrl` and thumbnail helpers return server HTTP URLs. | Downloaded on the server is not stored on the desktop. Server-only bytes cannot play during server downtime. |
| Operations | Healthy local inventory/project/requirements/maintenance/BOM fixtures need zero HTTP; one failed dependency rejects the aggregate. | Local path exists; dependency, cache, permission or lease errors can hide the overview. Exact installation failure remains unverified. |
| Lab Intelligence | Healthy local inventory/maintenance inputs work without HTTP; dependency failure rejects and the page gates on error. | Not inherently online-only; current failure needs native/session evidence. |
| Dashboard | Local inputs work; one failing source rejects. A workspace error is replaced with empty tasks/experiments, producing 100% health in the diagnostic. | Availability and correctness gaps: missing information must not mean zero tasks or healthy status. |

Source locations: `desktop/src/api/{operations,phase4,experience,reports,
collaboration,resources,mediaDownloads}.ts` and their corresponding pages.

Additional boundaries:

- `navigator.onLine` is not API reachability. Stopping an API may refuse a
  connection; pausing it may hang until timeout. Test both, not just Wi-Fi status.
  `api/http.ts` retries GETs twice, with a default 15-second attempt timeout.
- Runtime detection differs: `local-backend.ts` requires Tauri IPC, whereas
  `lib/runtime.ts` also identifies development port 1420 as local. A browser tab
  on that port is not equivalent to the installed desktop.
- Cached records require a valid offline session/lease and appropriate access.
  Preserve the approved 24-hour privileged lease. Never bypass permission errors
  to display unrestricted stale data; pending authorship/outbox remains separate.
- Nothing in these checks indicates PostgreSQL records were deleted by downtime.
  Failed loading is not proof of data loss.

### Approved offline-read contract and implementation boundary

Recommended: show available authorized sections with last-sync time and
stale/pending/incomplete status. Explain unavailable sections. Never substitute
zero for unknown totals or present a partial report as complete. Distinguish local
projections containing pending work from authoritative consolidated reports.

- Pros: usable disconnected work; one optional failure does not hide everything;
  completeness remains honest.
- Cons: requires per-section completeness/provenance and careful mixed-age
  aggregate semantics; cached totals cannot promise current global truth.
- Alternative: block the whole overview until every dependency is available.
  Simpler and avoids mixed-age totals, but hides useful local data and repeats
  the owner's usability problem.

Approved by the owner's subsequent “go”. The first implementation preserves
successful authorized local overview sections, bounds stalled reads, marks missing
metrics unknown and removes desktop resource metadata's HTTP fallback/enrichment
dependency. The notice reports local read time, NOT last successful sync time.
Per-domain initial-download completeness, genuine last-sync timestamps and
pending counts remain open; current local snapshots do not establish lab-wide truth.
Read correctness belongs in Phase 2; polished presentation/full GUI outage
acceptance belongs in Phase 3. Do not postpone data-path fixes to UI work.

## 1. Salvage from old projects

Existing foundation: `20260924_inventory_acquisition.sql` and Add Item allow
`acquisition_method='salvaged'`, source and notes. Incoming `return` movements
exist. These do not provide a complete traceable project recovery workflow.

### Phase 2: data, permissions and financial effects

- Distinguish unused issued-stock returns, reusable equipment returns, recovery
  of consumed/installed parts, disassembly into different components and scrap.
- Link recovery to source project/item/lot and original issue/consumption where
  known. Capture actor, quantity/unit, condition, inspection, destination, reason
  and stable recovery/change IDs. Unknown legacy provenance requires human
  attestation, not fabricated history.
- Preserve original consumption events. Append recovery/return events; expose
  gross issued/consumed, returned/recovered, outstanding and scrapped quantities.
  New or different outputs need new item/lot IDs and explicit unit/conversion
  rules. Never automatically resurrect a deleted inventory identity.
- Proposed recovery is not immediately usable stock. Human confirmation and
  required inspection release it from quarantine. Atomic SQLite/outbox intent;
  server locks source/destination and validates quantity/version/permission,
  committing movements, required audit and receipt together. Reject replay,
  over-recovery and concurrent double-credit. Offline actions needing global
  source arbitration stay provisional; preserve physical-work evidence on conflict.
- Recovery is not a new purchase, cash receipt or automatic refund of historical
  project spending. Record actual repair/disassembly expense separately. Separate
  stock carrying value, replacement value, historical expense and recovery credit
  projections to avoid double-counting.
- Proposed valuation policy, pending owner/finance approval: retain original cost
  provenance where known and a separately reviewed recovery value. Do not assume
  full original/replacement price; unknown value stays unknown, not invented zero.
  No automatic journal policy until the lab's cost-attribution rules are approved.
- Gate proposing, confirming, inspection and financial-value access separately
  where needed; enforce native and server permissions plus project visibility.

Valuation tradeoff: automatic credit is quicker but can misstate benefit or
double-count value; reviewed value requires more work but preserves provenance.
Recommend reviewed value. Neither policy should invent a cash transaction.

Tests: partial/full returns, quarantine release, scrap, multiple outputs, unit
conversion, unknown provenance, archived/deleted sources, denied financial access,
rollback, two-client over-recovery, offline restart, lost ACK and unchanged
historical expenditure, against actual PostgreSQL with isolated fixtures.

### Phase 3: workflow

Project “Recover / salvage” flow, source/condition/quantity/destination review,
clear confirmation of stock and financial effects, provenance and consumption
views, and finance displays that separate recovery value from cash. Pending and
conflicted recoveries must remain visible without claiming stock is available.

## 2. TTS and media priority

Source evidence: AssistantChat emits global pause/resume events; MusicPlayer and
MusicDock use a single resume flag, not focus ownership/priority or gain ramps.
Notebook has its own speech lifecycle. Overlapping/stale completion can request
resume while another source needs focus. This is not yet a real-device audio test.

### Phase 2: audio-focus correctness

- One device-local coordinator for music, lab video/audio, TTS and microphone.
  Acquire/release focus by owner token; stale callbacks cannot release a new owner.
- Prioritized lab media suppresses music using cancellable gain ramps and
  pause/duck policy. TTS and intelligible lab audio must not talk over each other:
  explicit user action chooses pause/preemption or waiting.
- Preserve track position/user volume. Distinguish automatic suspension from
  manual pause/stop. Resume only after higher-priority owners release and only if
  the user has not paused, changed track, closed the player or switched accounts.
- Release safely on cancellation, navigation, playback rejection or device error.
  Microphone capture suppresses TTS/competing audio to avoid transcription echo.
  Keep takeover/volume preferences device-local under the hybrid contract.
- Test overlapping sources, rapid replacement, stale callbacks, manual pause,
  mute, failed playback, microphone denial and cancellation with fake media clocks.

### Phase 3: experience

Tune audible transition duration and continuity; compact takeover indicators,
TTS controls, keyboard/focus and preference UI. Honour visual reduced-motion
settings. Verify on actual Windows audio hardware with music, lab video, TTS and
dictation; event-dispatch tests alone are not audible acceptance.

## 3. Assistant as a permissioned planning partner

Current backend explicitly declares no write tools and returns `mode:'read-only'`
and `can_modify_data:false`. This is intentional current behaviour. New drafting
requires a real capability boundary, not merely changing a badge or system prompt.

### Phase 2: drafting, approval, persistence and retry

- Allowlist project drafts, task plans, experiment protocols, dependencies,
  milestones and proposed materials. Expand other entity families only after
  explicit design/review; do not interpret “whatsoever” as unrestricted writes.
- Generate schema-validated proposals from authorized selected context. Context
  scope is not write authority. Persist editable drafts with IDs, versions and
  provenance; human review selects/accepts proposed records.
- Acceptance uses manual workflows' atomic local repositories/outbox and
  idempotent server graph apply, with native/server permission and project-scope
  rechecks. No privileged SQL or alternate assistant-only business write path.
- A reviewed bundle is atomic, or clearly divided into independently accepted
  sub-bundles. Attribute changes to the human approver with AI-assisted provenance.
- Hard exclusions: consume/receive/salvage/adjust stock, fulfill reservations,
  spending/orders, grant/user changes, destructive deletes, fabricated results,
  or marking physical work completed. Proposed BOM quantities are requirements,
  not committed reservations or actual consumption. Humans perform laboratory work.
- AI generation needs the current server/provider; saved drafts remain readable
  and editable offline. Approved planning changes can queue under valid cached
  permissions and reconcile normally. Retrieved documents cannot expand tools or
  authorize actions via prompt injection.
- Stable conversation/message/request/proposal/acceptance IDs. Separate transport
  retry from “generate another version.” Reconcile an uncertain run before
  regeneration; avoid duplicate messages and accepted entities after reload or
  double-click. Do not promise exactly-once provider billing/execution.
- Voice contract: user-initiated microphone only, visible recording, stop/cancel,
  editable transcript before send, privacy/retention disclosure and text fallback.
  No silent upload or automatic command submission. Choose local versus server
  transcription after checking Windows WebView support, privacy and latency;
  do not promise browser speech recognition works offline.

Tests: roles/project visibility, context-off, revoked permissions, malicious
retrieved content, invalid proposals, replay/partial failure, double acceptance,
account switch, offline restart and zero inventory/finance/fulfillment effects.
Actual PostgreSQL verifies accepted planning records and audit attribution;
deterministic acceptance tests do not need live model calls.

### Phase 3: panel and composer

- Context badge inside the composer at **bottom-left**, opening the selector.
  Remove redundant “Read-only · scoped context” footer and duplicate selector.
  Keep mode/permission wording accurate without treating context as authorization.
- Retry failed prompts and regenerate completed answers as distinct actions;
  preserve versions and use the Phase 2 identity rules. Never auto-accept a draft.
- Remove left-edge jump markers. Dedicated composer navigation button opens a
  compact internally scrollable prompt/response menu. Support click/focus and
  optional hover, pointer travel into the menu, keyboard/touch, Escape and focus
  return. Elegant short opacity/position transitions; no layout jumps/clipping
  with the right sidebar open; reduced-motion alternative.
- Microphone button, live transcript, recording/stop/cancel and denied/unavailable
  states. Integrate with audio focus so TTS cannot dictate itself into the input.
- Proposal review/edit/accept cards, exact effect summaries and pending/conflict
  states. Physical lab work remains clearly human-controlled.

## 4. Quantity-aware assignment and custody (owner addition, 2026-10-10)

Status: approved scope; investigation and implementation remain pending. This
section records the requested behavior, not a claim that it already works.

### Phase 2: responsibility, custody and stock accounting

- Keep the inventory record's responsible person distinct from physical custody.
  Responsibility alone must not change stock, expenses, reservations or access.
- Support quantity-aware issues to named recipients, including split issues,
  partial returns and outstanding balances. Record recipient separately from the
  actor who performs the transaction, with item, unit, source movement and any
  project/reservation/task/experiment references. Inspect pooled versus serialized
  inventory support before selecting the schema; do not invent serial identities
  for pooled stock or silently change units.
- Define available, reserved, issued, consumed, returned, damaged/lost and recovered
  quantities explicitly. Confirm how existing `current_quantity` is used before
  migrating anything. Consuming an already-issued component settles its custody
  balance; it must not subtract that quantity from storeroom stock a second time.
  Direct consumption from the storeroom is a different source path.
- Trace transfers between recipients and partial return/consumption/damage/loss to
  the original issue. Reject over-settlement and duplicate settlement. Corrections
  preserve audit evidence instead of deleting movements. Recovery follows the
  salvage/source-validation contract above, without fabricating purchases or cash.
- Audit the current admin-only assignment UI versus general inventory-edit write
  permissions. Agree the custody/assignment permission policy and enforce it in
  both native and server paths. Cache authorized assignee choices and history so
  an offline workflow does not depend on a remote directory request.
- Use atomic local state plus outbox, stable movement identities, idempotent server
  apply and stock/source concurrency checks. Offline allocations are provisional
  where server arbitration is needed; conflicts retain authored work for review.
- Preserve existing data. A whole-record `assigned_to` value is not evidence that
  its entire quantity was physically issued; never auto-convert it into custody.

### Phase 3: custody experience

Present responsible person, issued-to quantities and outstanding returns clearly.
Show a readable custody history and source links to projects/work items. Keep
functional issue/return flows and their acceptance tests in Phase 2; Phase 3 adds
integrated presentation, accessibility and complete cross-workflow usability tests.

## 5. Interconnected project lifecycle (owner addition, 2026-10-10)

Status: end-to-end investigation required before changing project behavior. Treat
BOM, reservations, tasks, experiments, canvas, notes, resources and financial
projections as connected parts of the same project, not independent feature fixes.

### Phase 2: relationship and behavior audit, then implementation

- Map canonical IDs, ownership, read/write paths and sources of truth for every
  relationship. Record each finding using the existing audit fields: MODULE,
  FILE, CURRENT WRITE PATH, WHY IT BYPASSES OFFLINE-FIRST, RISK, RECOMMENDED CHANGE,
  ACTUAL CHANGE MADE, VERIFICATION and STATUS. Separate observed behavior from
  proposed changes; preserve unrelated work and do not rewrite everything at once.
- Trace BOM requirements/revisions through reservations, quantity issues, task or
  experiment use, actual consumption, returns/salvage and financial projections.
  Keep planned, reserved, issued and actually consumed quantities distinct. A BOM
  requirement linked to both a task and an experiment must not be counted twice.
- Link tasks and experiments to relevant requirements and shared evidence. Canvas
  nodes should reference canonical records where they represent real entities;
  distinguish free-form planning nodes from accepted records. Editing or deleting
  a visual reference must not silently duplicate or destroy the underlying record.
- Define propagation and impact previews for BOM revisions, quantity changes,
  task/experiment cancellation, reservation release and project archive/delete.
  Outstanding custody and historical evidence must remain accounted for. Do not
  cascade away audit/results/financial evidence or automatically return physical
  components just because a project or task was closed.
- Task or experiment completion must not fabricate results or silently consume
  stock. Physical movements require explicit authorized human actions; project
  summaries derive from those recorded actions and expose unresolved work.
- Apply permissions and project visibility consistently across linked records,
  canvas, search and summaries. Use atomic local transactions for dependent writes
  and explicit dependency handling for server reconciliation; never present a
  partially applied bundle as fully synchronized. Retain rejected authored work.
- Before implementation, bring material business-rule choices back to the owner
  with concrete pros/cons (for example shared versus task-specific BOM demand,
  serialized custody and cancellation settlement). This scope does not silently
  decide those policies.

Acceptance: use actual PostgreSQL and two clients to exercise a project with a
BOM shared by a task and experiment, partial reservations, split custody, partial
consumption and return, BOM revision/cancellation, source conflicts and replay.
Assert no double demand, double stock debit, over-return, duplicate rows, orphaned
links or unauthorized access. Verify stock/custody/finance projections against
source events. Every offline-related fix also requires the actual desktop with
Docker API stopped, refresh/cold restart and reconnect checks; record missing
checks as unverified, not passed. Existing authored work must survive throughout.

### Phase 3: integrated project experience

Connect project overview, BOM, reservations, tasks, experiments and canvas with
consistent navigation, statuses, quantity summaries and source/evidence links.
Make pending synchronization and conflicts visible at the affected relationship.
Test a complete user journey, including return/salvage and project closure, with
the assistant sidebar open. Data correctness and functional links remain Phase 2
requirements, not deferred cosmetic work.

## Sequencing and acceptance

October 10 cadence override: the owner approved implementation batches followed
by a full phase-end test sweep, failure collection, grouped fixes and full retest.
Quick build/critical safety checks remain during development. All references in
this supplement to per-fix stopped-API testing now mean required coverage in that
phase-end sweep, not an interruption after each fix. No coverage is waived.

Subsequent owner directive: offline authentication/security, full PC copies,
queued server intentions and **mandatory actual desktop tests with Docker API
stopped for every offline-related fix** are consolidated in
[PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md](PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md).
That Phase 2 per-fix gate supersedes any implication below that real outage tests
can wait until Phase 3. Phase 3 retains the broader release/experience matrix.

Phase 2: implement the approved offline completeness contract. Read foundations
and existing domain conversions precede dependent features; consumption/source
ledger precedes salvage, project/task/experiment transaction hardening precedes
assistant acceptance, audio focus precedes dictation. Resolve valuation and voice
provider decisions before their respective implementation.

Phase 3: integrate new workflows with existing Users/modals work and run warm-cache
and cold-restart desktop tests with API stopped and paused, then restored; test
expired/revoked access, another account, device copies versus server-only files,
and queued-work recovery. Browser fixtures and past green tests are not GUI sign-off.
