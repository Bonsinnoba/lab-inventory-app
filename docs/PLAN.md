# LabOS plan and current status

Updated: 2026-11-02. Owner: primary agent and lab owner.

This is the controlling work tracker. V1 2.2.4 is installed for the owner's
personal lab; V2 Phase 2 remains in progress. No phase completion or acceptance
claim is created by this documentation consolidation.

Use exactly these three active documents:
- [Plan and current status](PLAN.md): scope, closure IDs, blockers and next work.
- [Dated work log](WORK_LOG.md): implementation reports, verification and attribution.
- [Architecture and operations](REFERENCE.md): contracts, decisions, audits and runbooks.

The fixed A1–A6, B1–B6 and C1–C6 checklist below controls Phase 2. Its dated
updates qualify the original status table; historical tables are not a fresh
acceptance result. Earlier five-phase and V1 launch plans are retained later in
this document as history and do not replace the approved three-phase schedule.

Current execution checkpoint (2026-11-02, PRIMARY): B3/B4 browser canvas,
connectors, requirements, BOM/items and attachments use the reviewed transactional
adapter (31 work handlers). Native counterparts retain authored drafts and validate
reviewed cached bases, account/resource scope and relationship integrity. Root
project deletion now retains scope-bound tombstones through a shared HTTP/outbox
effect. Actual PostgreSQL former-reader/outsider, child/resource deletion, surviving
note grants, replay and SQL audit/receipt rollback checks PASS.

C3 resource media, music, notebook/assistant speech and consented C4 recording
now share scoped focus ownership. Automatic resource suspension preserves position;
manual pause, close, account reset and stale callbacks cannot resurrect playback.
Explicit equal-priority playback switches surfaces. Notebook voice insertion is
fenced to the exact reviewed draft; the old direct browser dictation path is
retired. Source tests PASS; audible Tauri transitions,
embedded-provider playback and broader microphone/runtime acceptance remain open.

C6 administrative HTTP replies are now account/session fenced, local-only
credentials cannot issue administrative requests, and own desktop permissions
read the authorized local cache without an error-triggered server fallback.
35 selected admin/auth/automation client checks and TypeScript PASS. Managed-user/
target-profile caches, administrative CAS/idempotency and deployed acceptance
remain open. Follow-up server work closes middleware-to-transaction authority
races for account create, role/status, password reset and granular replacement:
current actor/permissions/credentials are locked and rechecked, with real PostgreSQL
mid-request revocation and required-audit failure rollback PASS.

C5 automation now has local due-work projection with incomplete-section disclosure,
durable account-authored SQLite run intentions, stable retry IDs and atomic native
confirmation/ACK. Server HTTP/outbox execution shares transactional current authority,
reminder deduplication and required audit/receipt. Recipient visibility is checked
before private task reminders; legacy reminder keys remain recognized. Pending
means not confirmed executed. V1 is unchanged; new native commands need a coordinated
Preview/API deployment before desktop acceptance.

Latest source checks: 163 selected client regressions PASS (including 34 voice/
audio checks), native automation persistence/permission/session/ACK rollback test PASS
with the API stopped, TypeScript PASS. Earlier native projects 24 PASS and backend
final serial backend suite 226 PASS / 3 SKIP. A concurrent run hit a DOCX worker
timeout; standalone DOCX 3 PASS and the serial suite passed without changing the
product timeout. Isolated PostgreSQL six-group
project/salvage/schema suite PASS plus automation production HTTP/outbox probe PASS;
integrated seven-group rerun, current bounded backend suite and frontend build PASS.
Actual overlapping-transaction PostgreSQL automation probe also PASS: two distinct
run IDs contend on the reminder lock, create one reminder per recipient/key and
commit two receipts/audits. Its committed namespaced fixtures/tagged effects were
explicitly cleaned from the acceptance copy; ordinary route probes rolled back.
Acceptance DB: labos_phase2_acceptance_20261102_work31. Additive migrations applied
there only; original development/V1 databases and storage preserved. Parents remain
partial, pending coordinated deployment, stopped-API running desktop/reconnect,
remaining domain/desktop concurrency and their other listed obligations.

C4 source now includes explicit per-recording disclosure/consent, local in-memory
recording/preview, cancellable authenticated upload, editable transcript review and
explicit insertion into assistant prompts or notebook drafts. Nothing auto-sends or
persists audio to SQLite/storage/outbox. Inline Gemini adapter is disabled until
explicit enablement, an audio-capable configured model, key and provider processing/
retention disclosure are present. The real PostgreSQL production upload/auth probe
PASS with a deliberately stubbed provider; no live audio left the test container.
34 focused voice/audio client checks and 2 backend config/privacy tests PASS;
whole-source client regressions, TypeScript and production frontend build PASS. Hardware, actual provider
quality/configuration and deployed privacy behavior are NOT verified.

C1/C2 now implement persisted editable planning drafts and explicit human approval
of complete project/task/experiment/link bundles. Desktop saves/approval projections
use account-authored SQLite transactions plus immutable outbox events; no local-error
HTTP fallback. Server acceptance reuses canonical project handlers, rechecks current
access/lifecycle and commits every node, audit and receipt atomically. New projects
remain Planning; no stock, reservation, spending or physical result is generated.
Shared JS/TS/Rust contracts, disk/restart/rollback/receipt checks and an actual
PostgreSQL production-auth/router rollback probe PASS (provider stubbed). Browser
lost-receipt and incomplete-graph checks PASS; production frontend build PASS.
These parents remain PARTIAL: coordinated migration/native deployment, real stopped-API
desktop/reconnect, independent-client acceptance, live provider validation and full
conflict-chain recovery/discard/export UX remain. The validated JSON editor is the
functional foundation; structured form polish belongs to the later visual pass.
Personal V1 installation, databases and files were preserved.

Latest grouped regression checkpoint for this source batch: client 498 PASS;
backend 237 PASS / 3 SKIP; native 172 PASS / 12 ignored live integration cases.
Opt-in real PostgreSQL schema/lock and proposal production-router rollback probes
PASS on the isolated acceptance database. TypeScript/frontend build PASS.
These source checks do not replace coordinated running-desktop outage/reconnect
or configured-provider acceptance. Full evidence and initial failures/reruns are
recorded in the current dated work-log entry.

Current substantial resource batch (2026-11-02, PRIMARY, A4/A5/A2): resource viewer
exports now use a native Save dialog, bounded streaming and SHA-256 verification
against the upload/edit or replication proof. Destination replacement occurs only
after complete verification; expiry, account/revision changes and disk/write errors
leave the chosen existing file intact. Missing desktop file grants no longer fall
through to server download/access URLs. Text previews fence account replies and
reject missing URLs instead of fetching the app document. Local media range handling
supports suffix requests, bounded reads, proper HEAD semantics and 416 responses.
Folder children and copies now inherit pending-creation dependency edges, without
rewriting payloads. Connected recovery identities archive atomically before retirement;
original outbox/provenance/bytes remain. Initial focused checks PASS; final frontend
rerun and running-desktop acceptance are tracked in the work log. Broader mixed
content/move authoring, unsynced non-resource destinations, full recovery UI/export,
encryption/retention and remaining file consumers remain separate open obligations.

B4 grant/membership and ordinary work now have real PostgreSQL production-route
coverage for current authority, receipt replay, audit rollback and scoped deletion.
Native project reconciliation preserves authored pending work while team/access
fields refresh. Remaining deployment, independent-client races and desktop outage/
reconnect checks are separate acceptance obligations, not missing copies of that code.

B2 browser single/batch recovery, custody-linked returns and damaged repair lifecycle
have passed the isolated PostgreSQL route/rollback/replay probe. The additive repair
migration is applied to the acceptance copy only. Native salvage regression 2 PASS, including repair-review outbox preservation
and on-disk reopen/account/partial-pull fencing. Coordinated deployed GUI outage/
reconnect and remaining source reconciliation cases stay tracked separately;
B2 stays PARTIAL. No existing salvage/consumption/cost history was reset or rewritten.
Aspect-ratio switching is a recorded viewer defect for a later pass; V1 2.2.4
does not fix it. V1 viewer/folder/music fixes remain incorporated in V2; the dated
parity baseline is in the work log, followed by the newer V2-only changes above.

Future updates edit this document's relevant closure item and append a dated
entry in WORK_LOG.md. Do not create another dated report or parallel checklist.
Each log entry identifies PRIMARY or the helper identity, affected IDs/files,
actual changes, verification run/not run, blockers and status. Helper reports
remain unreviewed until the primary agent explicitly records a review.
Keep the existing audit fields: MODULE, FILE, CURRENT WRITE PATH, WHY IT BYPASSES
OFFLINE-FIRST, RISK, RECOMMENDED CHANGE, ACTUAL CHANGE MADE, VERIFICATION, STATUS.

Original source files are preserved under archive/2026-11-01 with a SHA-256
manifest. They are historical evidence; new work updates the three documents here.

## Source index
Current B2 subcheck (2026-11-01, PRIMARY): browser single-recovery create/inspect/
release, multi-output batches and custody-linked return authoring are IMPLEMENTED — AWAITING
POSTGRESQL VERIFICATION. Source
uses immutable tab-session retry keys and current record versions, with domain
effects, required audit and receipt in one PostgreSQL transaction. TypeScript
and changed JavaScript syntax checks pass; 27 inventory/salvage transport and
native-boundary regressions pass, including regenerated batch IDs after a lost
ACK, frozen displayed review versions, custody account isolation and no desktop
HTTP fallbacks. Real PostgreSQL probes are prepared
for damaged intake and repaired-stock release as well. The repair follow-up has
28 passing transport regressions, TypeScript/syntax checks and both focused
native disk-SQLite tests (2 passed, 0 failed). The Tauri manifest now matches its
existing save-dialog/file-write allowlist, so direct Cargo tests build correctly.
PostgreSQL rollback/replay and desktop runtime acceptance remain unverified.
PostgreSQL probes have not run: Docker's Linux-engine pipe is unavailable, including outside the
sandbox. Next: grouped rollback/replay/revocation probe, then coordinated Preview
deployment and desktop outage/reconnect acceptance. B2 parent remains PARTIAL.

- [undated — Phase 2 fixed delivery checklist](#source-docsauditsphase2_delivery_checklist)
- [undated — LabOS remaining work: three execution phases](#source-docsauditsthree_phase_remaining_work_plan)
- [undated — LabOS V1 — Master Plan and Decisions](#source-labos-v1-plan)
- [undated — LabOS — Architecture, V1 Release Plan, Decisions & Continuation Notes](#source-labos_v1_architecture_and_release_plan)
- [undated — LabOS — five-phase completion ledger](#source-docslabos_five_phase_completion)
- [undated — LabOS Self-Hosted Backend & Remote Mobile Access](#source-docslabos_self_hosted_backend_remote_mobile_access_plan)
- [2026-10-09 — Additions and offline-read diagnosis — 2026-10-09](#source-docsauditsphase2_3_scope_additions_2026-10-09)
- [undated — Phase 2: offline completeness, authentication and mandatory outage testing](#source-docsauditsphase2_offline_security_and_acceptance)
- [undated — LabOS visibility-scope implementation plan](#source-docsauditsvisibility_scope_implementation_plan)

---

<a id="source-docsauditsphase2_delivery_checklist"></a>
## Phase 2 fixed delivery checklist

Original source: `docs/audits/PHASE2_DELIVERY_CHECKLIST.md`. Retained historical scope/status.

<a id="source-docsauditsphase2_delivery_checklist--phase-2-fixed-delivery-checklist"></a>
### Phase 2 fixed delivery checklist

November 1 V1 2.2.4 owner update: installed and reopened after a full V1 profile
and WebView backup (1,411 files, 2,498,673,127 bytes; all SHA-256 checks pass).
Installed executable reports 2.2.4; live V1 SQLite integrity is OK and the
dashboard displays local data. The viewer's folder browsing, native Save action,
zoom/pan, minimized/expanded states, and the sidebar change were carried in the
same source files used by V2. The shared viewer, folder browser, zoom component,
resources page, sidebar, and music components matched the isolated V1 2.2.4
snapshot byte for byte on this date. V2's App.tsx separately contains the same
lease-expiry polling and login-routing behavior, with other V2 work layered on top.

Open viewer issue for V1 and V2: the media aspect-ratio selector often produces
nearly identical output. ResourceViewerModal.tsx applies `aspectRatio` to an
image/video that also uses `objectFit: 'contain'`; the original media remains
fully contained, so changing the element box mainly changes letterboxing. Define
the control's intended modes (for example Original, Fit, Fill/crop, and explicit
ratio framing), constrain a distinct preview frame in each pane, and apply the
chosen fit/crop behavior to that frame. Keep the underlying file unchanged and
check portrait/landscape images and video in both normal and split views. This is
recorded for the next viewer pass; no aspect-ratio behavior change is claimed in
2.2.4.

October30 primary B1/B2/B4 condition guard: new checkout/consumption and direct
reservation fulfillment now reject damaged/repair/replacement/retired stock.
Native checks use stored status, not a forged next snapshot. Already-issued
custody can still record damage/loss/consumption without another stock debit.
28 native checks PASS, two opt-in live checks ignored; actual PostgreSQL HTTP
and independent condition-change race PASS, including packaged API verification.
Development API and native Preview builds PASS; unchanged frontend assets reused.
No parent closure or V1 update; GUI and separate repair lifecycle remain open.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_stock_condition_guards_2026-10-30).

October29 primary desktop acceptance: separate Preview restored its cached session,
and cold-started with development API confirmed stopped; cached dashboard/project/
stock summaries were present in its accessibility state. SQLite baseline had no
pending changes and a downloaded empty salvage snapshot; backup retained. Recovery
form/reconnect mutation acceptance remains NOT RUN because both native inspectors
returned mismatched screenshots/invalid input geometry. No authored records or
stock changes were made; V1 untouched. API restoration tracked in evidence.
[Acceptance evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_salvage_desktop_acceptance_2026-10-29).

October29 primary B1/B2 inspected custody returns: quarantined return intentions
now link the issued holder/quantity and reuse canonical return accounting at
release. Stock, custody settlement, audit and outer receipt commit or roll back
together. Real PostgreSQL HTTP/ordinary-return race, disk SQLite and 13 adapter
checks PASS. Damaged stock cannot enter usable inventory through this path.
Combined Preview/API builds and development deployment PASS; packaged probes PASS
and API/database/storage health OK. GUI acceptance and separate repair handling
remain; V1 untouched. No parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_salvage_custody_returns_2026-10-29).

October29 primary B2 disassembly batches: one native outbox intention now saves
2–25 outputs atomically with one shared source claim. Outputs retain independent
inspection/valuation/release; scrap never credits usable stock. Eleven adapter
checks, TypeScript, real SQLite and actual PostgreSQL HTTP/concurrency matrices
PASS. Combined Preview/API builds PASS; packaged PostgreSQL probes PASS and
development API health is OK. New additive migration applied only to development.
GUI/reconnect acceptance and custody-linked returns remain; no parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_salvage_output_batches_2026-10-29).

October29 primary B2 follow-on: real PostgreSQL independent concurrent releases
PASS same-recovery idempotency, shared-source ceiling, shared-item ledger balances,
stale-version denial, disabled-actor denial and failure rollback. Consumption-source
selection now uses guarded cached history on desktop and project-filtered browser
reads. Nine adapter checks, disk-backed native test, TypeScript/Vite and combined
Preview native build PASS. GUI acceptance remains separate; Docker is currently
unavailable, so new API deployment is not claimed.
Shared-source multi-output batches and custody-linked returns still need code.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_salvage_concurrency_and_source_picker_2026-10-29).

October29 V1 music hotfix: shared transport replaces render-dependent focus
ownership and delayed play/source races in both full players. Mini controls use
the same guarded transport.23 transport/coordinator checks and real React/browser
audio pause/resume/navigation/mini/focus checks PASS. Shared V2 source retains
the exact same implementation; broader C3/Phase3 audio integration is still open.
V1 2.2.3 installed and relaunched; SQLite and524 music/settings storage files
hash-verified unchanged across installation. Actual owner-file WebView2 playback
smoke check remains; desktop inspector recovery timed out. Evidence is separate.
[Music evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_v1_music_transport_2026-10-29).

October29 owner-requested V1 resource/viewer hotfix delivered separately as2.2.2:
batch/folder selection, Windows frontend drops, folder browsing, movable minimized
viewer,99% expansion, file-header toggle, media display ratios and reachable
image/PDF zoom/pan. Installed and reopened; existing database verified unchanged
by installer, V1 API/database/storage healthy.20 focused checks and isolated viewer
interactions PASS. No Phase2 parent closure or V2 backend shipment to V1.
[V1 evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_v1_resource_viewer_update_2026-10-29).

October29 primary salvage offline workflow: native account-scoped snapshots and
create/inspect/release intentions now use SQLite -> immutable outbox -> generic
server transactional receipts -> authorized pull. Inventory recovery section and
centered dialogs distinguish pending requests from confirmed stock. Seven adapter
checks, disk-backed SQLite and actual PostgreSQL/authenticated HTTP matrices PASS;
final native/build/deployment/GUI acceptance tracked in the evidence. No V1 changes
and no parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_salvage_offline_workflow_2026-10-29).

October29 primary salvage authority: shared project visibility now filters
salvage reads. Inspection/release recheck current active user, domain permission
and project edit scope in their transaction. Real PostgreSQL/authenticated HTTP
grant/view/edit/revocation/disabled-account cases PASS, including filtered read
and released-record retry denial; fixtures absent. Source only; native cache/
outbox integration and deployment remain. No parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_salvage_access_2026-10-29).

October29 primary salvage source contract: additive consumption-movement link,
serialized released-source quantity ceiling, source/project matching, explicit
legacy attestation and outstanding-custody return guard implemented. Real
PostgreSQL service and authenticated HTTP matrix PASS; fixtures/migration rolled
back. Source only; native intents, full visibility and multi-output/race tests
remain. No parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_salvage_source_claims_2026-10-29).

October29 primary salvage correctness: server release now uses valid item types,
real stock movement balances, repeated-release protection and separate reviewed
valuation; inspection cannot overwrite released state. Real development
PostgreSQL rollback probe PASS, fixtures absent. Source only; native salvage
outbox/provenance/over-recovery and integrated concurrency acceptance remain.
This is partial B2 work, not phase closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_salvage_release_correctness_2026-10-29).

October29 coordinated deployment: development API image rebuilt/deployed,
health API/database/storage OK; runtime reconciliation source hashes match.
Packaged rollback-only HTTP/PostgreSQL probes PASS from the new container with
all fixtures absent. Preview combined frontend/native build PASS; launch and
desktop acceptance pending failed computer-use recovery. V1 healthy/unchanged.
Dependency audit triage remains; no parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_coordinated_preview_build_2026-10-29).

October29 primary project edit permissions: unchanged full-record fields no
longer become unintended server updates; ordinary edits do not require finance
authority merely for carrying an unchanged budget. Native actual budget changes
require finance.edit. Conflicting authored fields enter explicit preserved-work
review. Real PostgreSQL HTTP/replay/denial/conflict cases PASS; 17 native tests
PASS with API stopped; eight conflict UI tests and TypeScript PASS. Legacy
without-before behavior and full desktop deployment remain separate boundaries.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_edit_permissions_2026-10-29).

October29 primary project save/date checkpoint: timestamp-backed calendar fields
now initialize correctly. Production native update/outbox failure rollback and
disk reopen PASS; 17 native project tests PASS with development API stopped.
50 frontend checks and TypeScript PASS. Real PostgreSQL authenticated review
route confirms overlap/consumable allocation rules and unchanged physical stock;
all rollback fixtures absent. Coordinated Preview deployment, GUI restart and
concurrent/reconnect acceptance remain open. No parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_save_dates_and_queue_parity_2026-10-29).

October29 primary local review queue: desktop central reservation review now
derives from existing authorized SQLite project/inventory readers without HTTP
fallback. Missing data stays unknown; local scope and queued decisions are
explicit. Boundary/projection checks 47 PASS; final projection checks 7 PASS.
Header project Save repair rebuilt successfully. Integrated queue deployment,
desktop save/restart and real server reconciliation remain open; GUI input
reported invalid 12x12 window bounds after recovery. No parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_local_reservation_review_2026-10-29).

October29 task write checkpoint: real authenticated sync-push HTTP + development
PostgreSQL PASS create/update/delete replay, payload/device mismatch rejection,
single tombstone, receipt-insert fault rollback and unchanged-event retry. Four
unique successful receipts; all fixtures absent after rollback. Savepoints isolate
route transactions, so concurrent/independent commit and actual desktop reconnect
remain unverified. V1 stayed running and unchanged; no parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_task_write_http_2026-10-29).

October29 consolidated project checkpoint: production JWT middleware + actual
project-pull router PASS nine HTTP cases on real development PostgreSQL in an
isolated rollback harness; all fixtures confirmed absent. Backend project/
visibility suite 40 PASS / 1 SKIP, native project suite 16 PASS with API/DB stopped,
TypeScript and whitespace checks PASS. Actual desktop, deployed configuration,
write receipts and reconnect remain open; no parent closure or deployment.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_consolidated_acceptance_2026-10-29).

October28 project visibility checkpoint: eight production SQL policy cases PASS
on development PostgreSQL, including restricted grants and membership/grant
revocation; rollback absence verified. Ten focused visibility/source-contract
tests PASS. This is not JWT/HTTP or native cache acceptance; those remain open.
No production permission change, deployment or parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_visibility_postgres_2026-10-28).

October28 nonempty PostgreSQL collection checkpoint: all six project collections
now pass snapshot shape/identity/uniqueness and per-project/empty-scope checks.
Rollback-only fixtures closed the four earlier nonempty-data gaps; all twelve
temporary rows were confirmed absent through ten cleanup queries. No permanent
seed, V1 change or parent closure. Authenticated endpoints, mutation receipts and
desktop reconnect remain separate acceptance gates.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_collection_server_shape_2026-10-28).

October28 live collection checkpoint supersedes Docker-blocked status below:
actual development PostgreSQL query-shape/empty-scope checks PASS for six
collections; nonempty checks cover 3 blocks and 18 requirements. Four empty
collections still need nonempty fixtures. Native task nested experiment links
now derive from canonical links; all 16 project tests pass. Existing development
DB was temporarily started then restored to stopped; V1 unchanged. Full desktop
acceptance remains open. [Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_collection_server_shape_2026-10-28).

October28 server collection-shape follow-up: source inspection confirms native
project-item composite identity matches API projection. Read-only PostgreSQL
shape/identity probe prepared for six collections. Live execution is blocked by
the unavailable Docker Linux engine; no real-database PASS claimed.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_collection_server_shape_2026-10-28).

October28 project collection matrix: BOM, canvas blocks/connectors, requirements
and composite project-item links now have production-pull regression coverage for
pending create/edit/delete, authoritative absence, repeated pull, disk reopen and
test-only acknowledgment convergence. All 15 native project tests pass; 26 pending
fixture events survive reopen before simulated ACKs. Real server receipts and
desktop acceptance remain open. No new production change or parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_collection_matrix_2026-10-28).

October28 experiment child reconciliation: measurements/observation records now
merge independently after pending parent fields, retaining pending child values
and removals while refreshing confirmed rows. All 15 native project tests pass,
including repeated production pulls/reopen with eleven pending events preserved.
Desktop/outage/reconnect acceptance remains open; no deployment or parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_experiment_child_pull_2026-10-28).

October28 pending child deletion guard: shared project pull retention now respects
local absence while a child event is pending. Task/experiment deletion regression
passes through repeated production pulls and disk reopen; seven pending events
remain intact. All 15 native project tests pass. Other child collections and
desktop/API convergence remain acceptance gates, not parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_pending_deletions_2026-10-28).

October28 task–experiment link convergence: fixed loss of pending links when the
server returns the same identity before acknowledgment. Shared relation merge
preserves local pending rows/removals and honors link tombstones. All 15 native
project tests pass, including actual repeated pulls and disk reopen with five
pending events preserved. Desktop/reconnect acceptance remains open; no parent
closure or deployment. [Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_task_experiment_pull_2026-10-28).

October28 attachment pull convergence: server nested attachments now populate the
canonical local collection; pending additions/removals survive pulls and nested
views derive from the same collection. All 15 native project tests pass, including
production pull/reopen coverage; desktop acceptance remains open. No parent closure or
deployment. [Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_attachment_pull_convergence_2026-10-28).

October28 history acceptance refinement: disk regression now runs the actual
project-pull implementation twice, checks foreign-account rejection, preserved
pending fields/event and restart persistence. All 14 native project tests pass.
The Tauri wrapper delegates to the same tested body; no protocol change. Running
desktop UI/IPC/outage/reconnect remains unverified, no parent closure.
[Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_experiment_history_persistence_2026-10-28).

October28 experiment-history native follow-up: matching pending experiment rows
retain authored fields while refreshing the confirmed history array. Fourteen
native project tests passed, including production save/load through a temporary
on-disk SQLite database, close/reopen and immutable pending-outbox assertions.
No personal database touched. Full native pull/desktop reconnect and coordinated
deployment remain open. [Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_experiment_history_persistence_2026-10-28).

October28 experiment history database checkpoint: actual development PostgreSQL
probe PASS for two project scopes, history/endpoint parity, ordering and filtering.
Six rollback-only audit fixtures were verified absent afterward. No V1 changes.
Authenticated route, native persistence and desktop outage/reconnect acceptance
remain open; no parent promoted. [Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_experiment_audit_history_2026-10-28).

October28 A3/B3/B4 experiment audit-history source integration: authorized project
pull now carries a separate history collection; desktop reads it locally and shows
downloaded audit events separately from saved revisions. Missing legacy history
is unavailable, not empty. 38 adapter + 3 query-contract + 13 editor/refresh checks
passed. Actual PostgreSQL, persistence, desktop outage/reconnect and deployment
remain pending; no parent promotion. [Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_experiment_audit_history_2026-10-28).

October28 A1/B3 native attachment validation: shared write path now validates
one task/experiment target in the project and canonical resource UUID/current
local presence with resources.view permission. Existing links are preserved.
Source implementation only; native-command/integrated acceptance pending.
Separate experiment audit-history offline support remains open (not equivalent
to saved revisions). [Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_attachment_write_validation_2026-10-28).

October28 A3/B3/B5 project finance: unknown local inventory/workspace/cost data no
longer becomes zero valuation. Known ledger totals remain available; unknown
valuation is explicit in rows and combined total. Composite reads are session
guarded. 34 focused adapter checks passed; source only, desktop acceptance and
durable completeness still pending. [Evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_finance_availability_2026-10-28).

October27 A1/B3 shared project-adapter boundary: require an active captured account
before native IPC and suppress results from a changed account/session. Reject
missing non-delete results without HTTP fallback; persisted work is not discarded.
44 focused frontend checks passed; real desktop account-switch acceptance remains.
Source only, no parent promotion. [Primary evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_adapter_session_2026-10-27).

October27 B3/B4 attachment follow-up: native nested attachment reads now join
current resource labels with a resources.view gate and work-item validation.
Unlink/detach/measurement-delete/observation-delete failures now show explicit
feedback. Source implemented; desktop acceptance pending, no parent promoted.
See [primary evidence](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_attachment_feedback_2026-10-27).

October27 B3/B4 nested-project checkpoint: local task/experiment relationships now
join current labels; nested mutation callbacks refresh connected project views.
Task and experiment editors await successful persistence and retain failed drafts.
Three native projection tests and eight frontend handler/refresh checks passed.
Source implemented, not deployed or accepted in the desktop. No parent status or
implementation-ready count is promoted by these bounded fixes. Evidence and open
checks: [primary report](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_nested_editing_2026-10-27).

<a id="source-docsauditsphase2_delivery_checklist--current-execution-october-26-return-from-personal-v1-packaging"></a>
#### Current execution — October 26: return from personal V1 packaging

The owner requested return to this original A1–C6 checklist. Personal V1 packaging
is a separate handoff, not Phase 2 completion. See
[V1_CLEAN_PERSONAL_SETUP.md](REFERENCE.md#source-docsauditsv1_clean_personal_setup) for its installed artifact,
isolated data and unperformed acceptance checks. Do not update, stop, seed or test
against the daily-use `labos-v1`/port4010 environment as part of ordinary V2 work.
Development uses the existing `labos`/port4000 environment; preserve both datasets.

V1 interruption is now a separate follow-up: the optional-date/server approval
hotfix was deployed, and the owner reports the desktop updated. Original pending
event replay has not been independently verified. See
[report](WORK_LOG.md#source-docshandoffsphase2-parallelprimary_project_blank_date_2026-10-26).
The later external-PowerPoint-viewing installer built successfully and was launched;
installation/opening acceptance remains unconfirmed. Neither V1 follow-up closes
an A1–C6 parent or authorizes ordinary V2 changes to the V1 environment.

Current resumed work: B3/B4 connected-project review/lifecycle and
remaining integration boundaries, then the independent remaining A/B/C code in
the bounded register. Reconcile helper-delivered code before implementing it
again. Retain all 18 parent closure units; no new parent is closed by packaging.
Historical dated checkpoints below retain their evidence-time status, not current
blanket deployment claims. Use dated deployment reports for superseding evidence.

October 26 resumed B3/B4 check: added native pending-child review regression matrix
for tasks, experiments, BOM, canvas, requirements, attachments, task/experiment
links, item links and measurement/observation events; verifies both project-ID
payload shapes, account/project isolation and refreshed displayed-token handling.
All 10 native review tests passed with the development API confirmed stopped,
including 66 nested-event combinations. Production code unchanged. Results and remaining
gates: `docs/handoffs/phase2-parallel/PRIMARY_REVIEW_NESTED_WORK_2026-10-26.md`.

Deferred Phase3 packaging polish: owner reports generic/missing V1 shortcut icon;
explicitly leave it unchanged for now. This is not a sync or database defect.

October27 owner-approved Phase3 navigation consolidation: use one right-dock
Tools & settings entry that opens in the main workspace, not a narrow dock panel.
Workspace tabs: Media, Daily use, System. Retain search shortcuts, existing
permissions and device/account/lab setting boundaries. Downloads remains a separate
page. Advanced settings may use centered modals; the assistant can remain open.
Inspect and reuse existing controls; this decision does not authorize a backend
rewrite. Missing underlying functionality/offline behavior remains Phase2 work.

<a id="source-docsauditsphase2_delivery_checklist--historical-october-24-approved-v1-pilot-priority"></a>
#### Historical October 24 approved V1 pilot priority

Owner approved a controlled own-lab pilot targeting October 25, rather than full
Phase 2 completion. [V1_LAB_PILOT_RELEASE.md](REFERENCE.md#source-docsauditsv1_lab_pilot_release) governs pilot
gates and conditional deferrals. A1–C6 below remain the complete backlog; no parent
is closed by the scope change. Preserve all current data. Backup/isolated restore,
core correctness, permissions and offline/reconnect remain release gates.

Owner-approved execution reset, October 13, 2026. This is the single remaining
delivery/status checklist. It consolidates existing commitments; it does not add
a fourth phase, erase evidence, authorize data loss, or move functionality into
Phase 3. Detailed requirements remain in the linked source plans below.

<a id="source-docsauditsphase2_delivery_checklist--baseline-and-rules"></a>
#### Baseline and rules

October27 A3/B3/B4 local context: desktop project context now composes existing
authorized local readers with section availability and account lifetime guards,
without HTTP fallback; reservation/review/checkout saves refresh connected views.
35 focused regressions passed. Source only, integrated desktop acceptance pending,
V1 unchanged. Report: `docs/handoffs/phase2-parallel/PRIMARY_LOCAL_PROJECT_CONTEXT_2026-10-27.md`.

October27 B3/B4 plan-view consistency: shared post-save query refresh for BOM,
workspace child and canvas mutations; corrected BOM form rejection of two absent
optional inventory choices. Three focused tests pass; interactive acceptance
pending, V1 untouched. Report: `docs/handoffs/phase2-parallel/PRIMARY_PROJECT_PLAN_REFRESH_2026-10-27.md`.

October27 A3/B3/B4 project activity: connected the existing authorized local audit
snapshot to the desktop workspace, filtering before the 100-row display limit.
Explicit missing/restricted/unavailable/freshness states replace false empty
history. Three native tests passed; integrated desktop acceptance pending; V1
unchanged. Evidence: `docs/handoffs/phase2-parallel/PRIMARY_PROJECT_ACTIVITY_2026-10-27.md`.

October27 B3/B4 Knowledge integration: replaced desktop resource and note empty
placeholders with permission-checked account-local reads, corrected attachment
labels/native link arguments and refreshed affected query families. Source only;
no V1 update. Desktop acceptance remains open. Reports:
`docs/handoffs/phase2-parallel/PRIMARY_RESOURCE_ATTACHMENT_DISPLAY_2026-10-27.md`
and `docs/handoffs/phase2-parallel/PRIMARY_PROJECT_KNOWLEDGE_2026-10-27.md`.

October27 permission HTTP follow-up: eight real authenticated loopback HTTP scenario
groups passed against rollback-only development PostgreSQL fixtures, including
mid-request actor revocation, audit rollback and malformed-body protection. Explicit
[] still clears overrides. Source only; deterministic race injection/savepoint
transaction limits recorded; no V1 changes. Report:
`docs/handoffs/phase2-parallel/PRIMARY_PERMISSION_HTTP_2026-10-27.md`.

October27 A1/B3/B4: permission replacement now rechecks current actor authority under
ordered actor+target account locks and authorizes implicit override removals. 16
focused tests and rollback-only real PostgreSQL lock/authority checks PASS. Source
only, no V1 update; full HTTP/concurrent request acceptance remains. Report:
`docs/handoffs/phase2-parallel/PRIMARY_PERMISSION_WRITER_AUTHORITY_2026-10-27.md`.

October 27 resumed B3/B4: real development PostgreSQL two-connection tests passed
for task/experiment/canvas updates and rollback-only BOM insertion. Both parent/
child lock orders, revision advancement and stale-token rejection verified. No
committed changes; development DB restored stopped, API stayed stopped, V1 untouched.
This is not full HTTP/desktop reconnect acceptance. Report:
`docs/handoffs/phase2-parallel/PRIMARY_REVIEW_CHILD_CONCURRENCY_2026-10-27.md`.

October 24 native review follow-up: displayed token is required at the native
save boundary. Durable file-backed queue/reopen/duplicate-ACK/delayed-snapshot
test PASS; 44 focused tests passed with API stopped. Source only. Live desktop
reconnect acceptance still open. Report:
`docs/handoffs/phase2-parallel/PRIMARY_REVIEW_NATIVE_PERSISTENCE_2026-10-24.md`.

October 24 browser/version follow-up: browser approvals now require the displayed
plan token; permission replacement locks the account before overrides. Nine real
PostgreSQL scenarios, two-connection lock checks, 57 API-stopped regressions and
TypeScript PASS. Source only; remaining native/reconnect/concurrency acceptance
is explicit in `docs/handoffs/phase2-parallel/PRIMARY_REVIEW_BROWSER_VERSION_2026-10-24.md`.

October 24 authority follow-up: HTTP and sync share transactional current review
authority in source. Eight PostgreSQL handler scenario groups, two-connection
project/account row-lock checks and 30 API-stopped regressions PASS. Not deployed;
predicate/permission-writer races and full workflow acceptance remain. Report:
`docs/handoffs/phase2-parallel/PRIMARY_REVIEW_AUTHORITY_2026-10-24.md`.

October 24 follow-up B3/B4: plan revision guard implemented in source; seven
actual PostgreSQL push-handler/migration scenario groups PASS, plus 12 focused
tests with the API stopped. Not deployed. Concurrency, durable reconnect and
HTTP authority/integrated desktop gates remain. Report:
`docs/handoffs/phase2-parallel/PRIMARY_REVIEW_PLAN_VERSION_2026-10-24.md`.

October 24 B3/B4: review native outbox/server path connected in source; focused
offline and PostgreSQL handler checks pass. Do not close or deploy: whole-plan
version guard and actual sync replay/integration gates remain. Report:
`docs/handoffs/phase2-parallel/PRIMARY_REVIEW_QUEUE_2026-10-24.md`.

October 23 B3/B4 review atomicity foundation: decision/event/audit now share the
HTTP transaction in source, verified against PostgreSQL with rolled-back fixtures.
Native review queue and idempotent replay remain open; not deployed. Report:
`docs/handoffs/phase2-parallel/PRIMARY_REVIEW_ATOMICITY_2026-10-23.md`.

October 23 B3/B4 project review: cached confirmed review reads implemented in
source and focused checks passed. Queued decisions/atomic audit are still open,
not claimed completed by this read change. Deployment/integration pending. See
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_REVIEW_READ_2026-10-23.md`.

October 23 B3/B4 revision-history update: authorized experiment revisions added
to project sync snapshots; desktop reader uses native snapshot without HTTP
fallback. Source-only, integration/deployment still pending. See
`docs/handoffs/phase2-parallel/PRIMARY_EXPERIMENT_REVISIONS_2026-10-23.md`.

October 23 B3/B4 update: observation prose/record collision fixed in source,
focused offline and read-only PostgreSQL checks pass. Coordinated deployment,
desktop acceptance and ambiguous legacy-event recovery remain open. See
`docs/handoffs/phase2-parallel/PRIMARY_EXPERIMENT_OBSERVATIONS_2026-10-23.md`.

October 23 primary B3/B4: measurement/observation collection reads no longer
fall through to HTTP on desktop local misses or accept missing/non-array fields
as valid collections. TypeScript and 15 boundary tests PASS with API stopped,
restored healthy. Source-only. Project history/review projections, observations
prose/collection field collision and UI availability remain open. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_EXPERIMENT_READ_BOUNDARIES_2026-10-23.md`.

October 23 coordinated sync-safety deployment: runtime account isolation,
fail-closed preflight and dedicated native queue-status reader now deployed
together after saved-edit approval. TypeScript/Vite/native builds PASS; 28 frontend
+ 12 native checks PASS with actual API stopped; restored healthy. Original
database/storage preserved. Earlier source-only notes are historical. Integrated
desktop acceptance remains open; no parent closure. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_SYNC_SAFETY_DEPLOYMENT_2026-10-23.md`.

October 23 primary A1: dedicated native account/lease-bound queue-count command
implemented; renderer preflight/panel now use it without diagnostic-command or
HTTP fallback. TypeScript/native test build PASS; 28 frontend + 12 native checks
PASS with API stopped, restored healthy. Source-only; deploy with runtime
isolation/preflight fixes. No parent closure. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_NATIVE_QUEUE_STATUS_2026-10-23.md`.

October 23 primary A1/A2: unreadable/malformed local queue preflight now stops
sync instead of treating ownership counts as zero. Explicit retry repeats the
check; automatic retry respects account-scoped backoff. TypeScript and 28 focused
tests PASS with API stopped; restored healthy. Source-only, awaiting deployment
with runtime isolation and integrated acceptance. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_SYNC_PREFLIGHT_2026-10-23.md`.

October 23 primary A1: account-scoped sync runtime status/backoff and login-bound
late-update guards implemented in source. Generation checks now cover sync
preflight and prevent a new login joining the old run. TypeScript and 25 focused
tests PASS with actual API stopped; restored healthy. Awaiting coordinated build
and integrated account-switch acceptance; no parent closure. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_SYNC_RUNTIME_ISOLATION_2026-10-23.md`.

October 23 primary deployment: recovery index and full/compact conflict view
lifetime guards deployed in rebuilt desktop after saved-edit approval. Queue
status read errors now remain unknown, not zero/no conflicts. TypeScript, Vite
and native build PASS; 18 focused checks PASS with API confirmed stopped; existing
PostgreSQL/API restarted healthy with original volumes. Integrated desktop
acceptance and recovery-content export remain open. No parent closure. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_SYNC_PANEL_READS_2026-10-23.md`.

October 22 primary A1/B4: conflict/recovery renderer request lifetime guarded;
superseded reads cannot overwrite newer state, authentication events clear the
view and resolution continuations reject account switches. 15 focused checks
PASS with API stopped, restored healthy. Source-only; integrated desktop
acceptance remains open. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_CONFLICT_VIEW_LIFETIME_2026-10-22.md`.

October 22 primary A2/B4: read-only owned project-deletion recovery index added in
source, metadata only with no historical project content/authority exposed.
TypeScript/native build PASS; 12 adapter/render + 10 native checks PASS with API
stopped; restored healthy. Awaiting coordinated native/UI deployment and desktop
acceptance. Payload inspection/export remains open. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_RECOVERY_INDEX_2026-10-22.md`.

October 22 coordinated deployment: history guard, native recovery, conflict UI and
account fence now deployed together after saved-edit approval. Frontend/native
builds PASS; deployed PostgreSQL 23 focused + 29 handler PASS (rollback verified),
11 adapter/render PASS. Existing data/volumes retained; updated desktop launched.
Earlier source-only notes below are historical. Integrated desktop/recovery export
and parent acceptance remain open. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_CONFLICT_DEPLOYMENT_2026-10-22.md`.

October 22 primary A1/B4: conflict account/session fence implemented in source;
11 adapter/render and 9 native checks PASS with API stopped, API restored healthy.
UI/native must deploy together; two-login desktop acceptance still open. Existing
desktop launched, latest source not deployed. No parent closure. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_CONFLICT_ACCOUNT_FENCE_2026-10-22.md`.

October 22 primary B4 conflict UI: both sync views share explicit Cancel deletion /
Use server status guidance, disable protected/stale retries and retain native
authority. Seven presentation/render checks PASS with API stopped; TypeScript
PASS and API restored healthy. Awaiting deployment/desktop interaction acceptance;
no recovery export or parent closure. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_CONFLICT_GUIDANCE_2026-10-22.md`.

October 22 primary B4/A2 recovery subcheck: native conflict resolution now blocks
blind history-protected deletion/lifecycle retries and atomically preserves an
account-scoped deletion recovery record before explicit retirement. 8 native
local_db tests PASS with actual API stopped, including disk reopen and failure
rollback; API restored. Awaiting deployment/integrated verification; recovery UI
and broader project reconciliation remain open. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_DELETE_RECOVERY_2026-10-22.md`.

October 22 primary B4: shared project deletion guard now protects financial,
purchase, salvage and scientific evidence/provenance in source. Real PostgreSQL:
23 focused and 29 handler checks PASS, rollback verified. Awaiting deployment and
integrated acceptance; no parent closure. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_RECORDED_HISTORY_2026-10-22.md`.

October 21 deployment correction: the lifecycle API migration and coordinated
desktop/UI build described below were deployed successfully after owner approval.
API/database/storage health passed; existing volumes and app data preserved.
Deployed-code probes: 12 focused and 27 handler checks PASS, rollback verified.
Integrated desktop/concurrent-client acceptance remains open. See deployment
checkpoint in `PRIMARY_PROJECT_LIFECYCLE_2026-10-21.md`; earlier pending-deployment
statements below are historical, not the current deployment state.

October 21 primary B4 lifecycle batch: core revision-fenced cancellation/archive,
unused reservation release, inventory settlement projection and native pending
state implemented in source. PostgreSQL 12 focused / 27 handler checks PASS;
stopped-API native project/inventory 43 PASS. Awaiting coordinated deployment and
integrated acceptance; broader B4 revision/review/recovery/history work remains.
Evidence: `docs/handoffs/phase2-parallel/PRIMARY_PROJECT_LIFECYCLE_2026-10-21.md`.

October 21 primary B4 safeguard: project deletion now rejects inventory history
in sync and browser routes in source. PostgreSQL: 6 focused checks and 25 handler
regressions PASS, rollback verified. Awaiting deployment/end-to-end verification;
cancellation, archive and settlement remain open. Parent B4 unchanged. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_PROJECT_HISTORY_GUARD_2026-10-21.md`.

October 21 primary follow-up: native/HTTP reservation request-review and rejected
approval retry subcase is **VERIFIED CLOSED in tested source**. A discovered
conflict-domain omission was fixed with access/role guards. Full live test passed;
38 native inventory checks passed with API stopped. Fix awaits next desktop build.
No parent state changed; GUI and multi-client acceptance remain open. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_RESERVATION_REVIEW_ACCEPTANCE_2026-10-21.md`.

October 21 primary bounded acceptance: reserved consumption through native disk
SQLite, actual API outage, deployed HTTP/PostgreSQL sync, lost-ACK replay and
repeated pull convergence is **VERIFIED CLOSED** (one opt-in integration test,
pass; guarded fixture cleanup verified). This does not close B1/B3/B4, GUI
interaction, login, request/review conflict lifecycle or multi-client contention.
Evidence: `docs/handoffs/phase2-parallel/PRIMARY_RESERVATION_HTTP_ACCEPTANCE_2026-10-21.md`.

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

<a id="source-docsauditsphase2_delivery_checklist--batch-a-offline-security-and-resources"></a>
#### Batch A — offline, security and resources

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
| A4 | PARTIAL | Native bounded/digest-verified large-file export, strict desktop file URLs and suffix/HEAD/range handling are source-implemented and native-tested. Finish remaining file/thumbnail consumers, PDF structural/security review and coordinated desktop export/seek/outage/reconnect acceptance. Replication must resume, verify bytes and report storage failures; metadata is not a PC copy. |
| A5 | PARTIAL | Folder/copy creation dependency blocking and atomic connected recovery identity archival are implemented/tested. Finish mixed content/attachment/metadata chains, non-resource unsynced destinations, folder/nested moves and legacy/editor-copy recovery. Preserve originals, stable IDs/revisions and immutable events; no local-error HTTP fallback. |
| A6 | PARTIAL | Tool-status cache and browser enqueue receipt parity are implemented, awaiting integrated verification. Finish worker/queue/file-readiness reconciliation; ensure cancel/completion races, deletion/tombstones and revocation cleanup preserve correct local/server state. Existing local controls/settings/queues remain. Pending cancel is not server-confirmed cancel; stale pulls cannot resurrect an authorized deletion. |

Batch exit: all six implementation boundaries addressed, evidence and defects
linked by ID, coordinated app/API build available. Acceptance remains separate.

<a id="source-docsauditsphase2_delivery_checklist--batch-b-inventory-projects-and-finance"></a>
#### Batch B — inventory, projects and finance

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
| B2 | PARTIAL | Quarantine/source claims, inspected release, native outbox/source pickers, shared-source output batches and usable custody-linked returns implemented. PostgreSQL HTTP/concurrency, SQLite, coordinated Preview/API builds and development deployment PASS. Complete GUI outage/reconnect acceptance. November1 browser authoring/retry parity and damaged custody repair lifecycle are implemented in source, awaiting native/PostgreSQL/GUI acceptance and coordinated deployment. Preserve original consumption, reviewed valuation and no invented cash refund. See October29 primary evidence. |
| B3 | PARTIAL | Audit and complete canonical links among projects, BOM revisions, requirements, reservations, tasks, experiments, canvas, notes/resources and financial evidence. Shared demand must not be double-counted; visual references must not duplicate/delete underlying records. Finish remaining local mutation/repeat/revision paths and remove missing-record server fallbacks. |
| B4 | PARTIAL | Finish project review/reservation/history/context projections and queued submissions/decisions. Define and implement revision, cancellation, reservation release, archive/delete and closure propagation while preserving custody/results/audit/finance history. Task completion must not silently consume stock or fabricate results; global acceptance remains distinct from local intent. |
| B5 | PARTIAL | Finish finance/purchase local templates, export, preview and transactional workbook imports; remaining purchase/finance mutations use stable retry identity, atomic local/outbox writes and server reconciliation. Enforce financial permissions, concurrency and all-or-nothing effects. Retain existing inventory-import implementation. |
| B6 | PARTIAL | Close remaining inventory/storage relationships, field/assignment history and authorized assignee directory; local inventory templates/export, workbook parser hardening and legacy-event recovery. Preserve existing versioned CRUD/bulk/movements/import/history fixes and explicit snapshot completeness. Apply the common sync contract across remaining uncovered domain operations. |

November 1 primary B2 bounded subcheck — salvage sync audit atomicity: salvage
outbox application now writes its required audit row on the same PostgreSQL
transaction as the mutation and idempotency receipt. Audit failure aborts the
whole operation; idempotent replay does not add another audit row. Code-path
review only; real PostgreSQL fault-injection and normal/replay audit-cardinality
checks remain for the phase-end sweep. Legacy direct browser salvage routes have
separate audit gaps and remain open. B2 remains PARTIAL; no parent or closure
count changed. Evidence:
`docs/handoffs/phase2-parallel/PRIMARY_SALVAGE_SYNC_AUDIT_ATOMICITY_2026-11-01.md`.

Batch exit: functional connected workflows, not isolated forms; explicit stock,
custody and finance effects with no double accounting. Resolve business-rule
choices before dependent migrations; continue independent items meanwhile.

<a id="source-docsauditsphase2_delivery_checklist--batch-c-assistant-audio-and-queued-actions"></a>
#### Batch C — assistant, audio and queued actions

| ID | State | Required closure behavior / remaining boundary |
| --- | --- | --- |
| C1 | PARTIAL | Persistent editable SQLite drafts, bounded shared schema, canonical UUID/digest, reviewed base, generated provenance and stable retries implemented. Source/rollback probes pass; live provider, deployed outage/reconnect, complete recovery UX and structured form polish remain. |
| C2 | PARTIAL | Explicit approval creates one atomic provisional graph/outbox intention; current authority/lifecycle, canonical child handlers, mandatory audits and exact graph receipt prevent partial/double acceptance. Real PostgreSQL failure injection passes. Deployment, independent-client races and end-to-end recovery remain; no assistant stock, spending, grants or scientific results. |
| C3 | PARTIAL | One device audio-focus coordinator for music, lab media, TTS and microphone: owner tokens, cancellable transitions, preserved position/volume, manual-pause intent and safe release on errors/navigation/account change. Stale callbacks cannot resume audio under another owner. |
| C4 | PARTIAL | Establish and implement the voice capability/privacy boundary needed by Phase 3 controls: supported provider/runtime choice, explicit recording/stop/cancel, transcript review before send, no silent upload/submission and text fallback. Integrate microphone with C3; do not claim offline recognition without evidence. Polished composer controls remain Phase 3. |
| C5 | PARTIAL | Local automation due-item projection and durable run intentions, stable run IDs, uncertain-result reconciliation and server-side permission/idempotency checks. Pending intentions survive restart but are not displayed as executed effects. |
| C6 | PARTIAL | Authorized cached users/permission/settings views and approved ordinary profile/preference intentions; complete remaining online-authoritative retry/cache contracts. Administrative intentions cannot grant effective offline authority; password/reset actions remain server-confirmed and never queue plaintext passwords. Preserve implemented hybrid preferences. |

Batch exit: permissioned functional flows and clear online-only boundaries.
Composer visual polish and release certification remain Phase 3, not correctness.

<a id="source-docsauditsphase2_delivery_checklist--approved-decisions-october-14-implementation-contract"></a>
#### Approved decisions — October 14 implementation contract

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

<a id="source-docsauditsphase2_delivery_checklist--bounded-implementation-register-october-14"></a>
#### Bounded implementation register — October 14

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
| B2 | Quarantined salvage, inspection and reviewed recovery valuation | PARTIAL — batches and usable custody returns implemented; acceptance and repair boundaries remain | October29: native outbox/source pickers, generic receipts, atomic shared-source batches and canonical custody return reconciliation. PostgreSQL HTTP/races, SQLite and adapters PASS. Current build/deployment and GUI/reconnect acceptance tracked in primary evidence. November1 browser parity and damaged repair handling are source-implemented; fresh database/native/GUI acceptance remains. |
| B3 | Connected requirements/BOM/tasks/experiments/canvas and remaining local mutations | CODE REMAINING | Canonical demand approved; integrate B1 quantities where stock effects apply. |
| B4 | Cancellation/closure propagation and settlement | PARTIAL — core awaiting deployment/verification | October 21: revision-fenced cancellation/completion/archive, unused reservation release and inventory settlement implemented. Coordinated migration/native build, in-flight pull/concurrency and end-to-end acceptance remain; broader review/recovery/history work remains separate. |
| B5/B6 | Remaining finance/import and inventory relationship/history/recovery paths | CODE REMAINING | Existing ordinary permission/version/outbox contract; custody-specific consumers depend on B1. |
| C1 | Validated, persisted editable assistant proposals | SOURCE IMPLEMENTED; ACCEPTANCE OPEN | Draft/generation identity/provenance paths tested; live provider, deployed outage/reconnect and full recovery UX remain. |
| C2 | Human acceptance of connected proposal graphs | SOURCE IMPLEMENTED; ACCEPTANCE OPEN | Atomic canonical graph/receipt and authority tested with real PostgreSQL rollback; deployment, independent-client races and complete recovery remain. |
| C3 | Device audio-focus coordinator | PARTIAL — SOURCE CHECKS PASS | Scoped resource/music/TTS/microphone ownership implemented; audible Tauri/embed transitions, device acceptance and remaining integration remain. |
| C4 | Consented provider transcription and microphone lifecycle | PARTIAL — SOURCE CHECKS PASS | Consented capture/review and disabled-by-default inline provider adapter implemented. Live configured model, document/WebView microphone policy and hardware acceptance remain. |
| C5/C6 | Remaining durable automation intentions and authorized cached settings/users | PARTIAL | C5 durable intentions/current authority/deduplication and C6 request/current-actor fences implemented. Managed-user/profile caches, administrative CAS/idempotency and deployed acceptance remain. Passwords never enter the outbox. |

Awaiting verification means code for the named subcheck exists, not that its
whole parent is ready. Keep full acceptance at phase end; use only quick builds
and focused critical invariant checks while finishing implementation.

<a id="source-docsauditsphase2_delivery_checklist--phase-end-acceptance-register"></a>
#### Phase-end acceptance register

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

<a id="source-docsauditsphase2_delivery_checklist--status-and-next-execution"></a>
#### Status and next execution

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

<a id="source-docsauditsphase2_delivery_checklist--source-requirements-and-evidence"></a>
#### Source requirements and evidence

- [Three-phase scope](PLAN.md#source-docsauditsthree_phase_remaining_work_plan)
- [Offline/security and real outage acceptance](PLAN.md#source-docsauditsphase2_offline_security_and_acceptance)
- [Salvage, project/custody, assistant and audio additions](PLAN.md#source-docsauditsphase2_3_scope_additions_2026-10-09)
- [Dated implementation and verification evidence](WORK_LOG.md#source-docsauditsphase2_evidence)
- [Operation-level audit findings](REFERENCE.md#source-docsauditsoffline_first_write_path_audit)

This checklist governs remaining work/status and cadence. Source requirements
and audit details remain binding; dated later evidence supersedes earlier status
paragraphs. This documentation change does not itself implement or certify code.

---

<a id="source-docsauditsthree_phase_remaining_work_plan"></a>
## LabOS remaining work: three execution phases

Original source: `docs/audits/THREE_PHASE_REMAINING_WORK_PLAN.md`. Retained historical scope/status.

<a id="source-docsauditsthree_phase_remaining_work_plan--labos-remaining-work-three-execution-phases"></a>
### LabOS remaining work: three execution phases

<a id="source-docsauditsthree_phase_remaining_work_plan--october-13-delivery-reset-controlling-remaining-work-checklist"></a>
#### October 13 delivery reset — controlling remaining-work checklist

The owner approved frozen scope, three substantial Phase 2 implementation batches
and one phase-end acceptance sweep. Track remaining delivery exclusively in
[PHASE2_DELIVERY_CHECKLIST.md](PLAN.md#source-docsauditsphase2_delivery_checklist): 18 stable closure IDs
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

<a id="source-docsauditsthree_phase_remaining_work_plan--october-10-execution-policy-implementation-batches-then-phase-acceptance"></a>
#### October 10 execution policy — implementation batches, then phase acceptance

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

<a id="source-docsauditsthree_phase_remaining_work_plan--october-9-scope-additions-planning-not-implementation"></a>
#### October 9 scope additions — planning, not implementation

The owner added project salvage, smooth TTS/media priority, permissioned assistant
planning, and composer/context/navigation/retry/voice improvements. The diagnosis,
phase allocation, safeguards, acceptance tests and unresolved choices are in
[PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md](PLAN.md#source-docsauditsphase2_3_scope_additions_2026-10-09).
This keeps exactly three phases and does not mark the new work implemented.

The reported offline page failures are not all intentional online-only design.
Read-path characterization confirms incomplete offline coverage and aggregate
failure coupling; the exact failures of the owner's desktop still need native
session/cache and full GUI outage checks. The owner approved the partial/stale
section contract. Its first slice now preserves available local overview sections,
marks unknown totals and removes resource metadata's desktop HTTP fallback.
Persistent completeness/last-sync metadata and remaining remote read projections
are still open; see the latest PHASE2_EVIDENCE.md checkpoint.

<a id="source-docsauditsthree_phase_remaining_work_plan--phase-1-complete-the-audit-security-boundaries-and-sync-contracts"></a>
#### Phase 1 — Complete the audit, security boundaries, and sync contracts

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

<a id="source-docsauditsthree_phase_remaining_work_plan--phase-2-convert-the-remaining-data-flows-to-their-approved-architecture"></a>
#### Phase 2 — Convert the remaining data flows to their approved architecture

**Owner consolidation and mandatory test gate (October 9):**
[PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md](PLAN.md#source-docsauditsphase2_offline_security_and_acceptance)
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
[the scope supplement](PLAN.md#source-docsauditsphase2_3_scope_additions_2026-10-09) for the investigation,
implementation and real offline acceptance requirements. These additions are
planned, not implemented or verified; they do not authorize discarding data.

<a id="source-docsauditsthree_phase_remaining_work_plan--phase-3-integrate-the-experience-and-certify-the-whole-system"></a>
#### Phase 3 — Integrate the experience and certify the whole system

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

---

<a id="source-labos-v1-plan"></a>
## LabOS V1 — Master Plan and Decisions

Original source: `LABOS-V1-PLAN.md`. Retained historical scope/status.

<a id="source-labos-v1-plan--labos-v1-master-plan-and-decisions"></a>
### LabOS V1 — Master Plan and Decisions

> Consolidated from the project discussion beginning with the clarification that LabOS needs a local backend + SQLite on every workstation and a separate central backend + PostgreSQL system.

<a id="source-labos-v1-plan--1-core-architectural-decision"></a>
#### 1. Core architectural decision

LabOS has **two distinct runtime/backend layers**.

<a id="source-labos-v1-plan--per-workstation-local-system"></a>
##### Per-workstation local system

```
LabOS Desktop / Tauri
        ↓
Local LabOS Backend
        ↓
Local SQLite
```

Every LabOS desktop installation has its own local database and local backend/runtime.

The local backend is bound to that workstation/app installation and is responsible for local data access and local operations. The desktop application must not need the central PostgreSQL system for normal local work.

<a id="source-labos-v1-plan--central-labos-system"></a>
##### Central LabOS system

```
Local backend(s)
       ↓
Central LabOS Backend
       ↓
PostgreSQL
       ↓
Central services
```

The central system is responsible for synchronization and services that inherently belong centrally, including server-side/shared state and media processing.

<a id="source-labos-v1-plan--non-negotiable-boundary"></a>
##### Non-negotiable boundary

**Desktop must not connect directly to PostgreSQL.**

**PostgreSQL must not replace the local SQLite database.**

The intended production architecture is:

- Desktop/Tauri talks to the local LabOS backend.
- Local backend talks to local SQLite.
- Local backend synchronizes with the central LabOS backend when connectivity exists.
- Central backend talks to PostgreSQL.
- Central services handle centralized jobs such as media downloading/processing.

---

<a id="source-labos-v1-plan--2-v1-product-model"></a>
#### 2. V1 product model

V1 is a **fresh installation**, not a continuation of the current development/test databases.

On first launch of a fresh V1 installation:

1. Create a new local SQLite database.
2. Initialize the local schema.
3. Create the workstation/device identity.
4. Create the local administrator identity.
5. Seed only required baseline/system data.
6. Start with no development/test inventory or other test records.
7. Allow the application to operate locally without the central server.

Existing development/test databases must be preserved as regression/test data until they have been identified and intentionally retired.

<a id="source-labos-v1-plan--production-vs-preview"></a>
##### Production vs Preview

Production and Preview must have separate application identities and separate local data directories/databases.

This prevents Preview from sharing or corrupting Production data.

---

<a id="source-labos-v1-plan--3-single-user-v1-decision"></a>
#### 3. Single-user V1 decision

The project is currently treated as a **single-user workstation application**.

The user explicitly decided that V1 does not need full multi-user/account-management functionality.

Therefore V1 needs:

- one local administrator identity;
- local login/session/authentication;
- offline login;
- ability for the local administrator to change their own password/profile where supported;
- local authorization based on the administrator identity.

V1 does **not** need:

- full local user provisioning;
- account/member administration;
- multi-user collaboration;
- central user management as a V1 dependency.

Central user/account management can remain future work.

The central system may support user provisioning in a later phase, but it must not be required to operate the single-user local application.

---

<a id="source-labos-v1-plan--4-what-must-work-offlinelocal-first"></a>
#### 4. What must work offline/local-first

The guiding rule is:

> If an operation concerns the workstation's own data and does not inherently require coordination with other workstations, it should work through the local backend and SQLite.

<a id="source-labos-v1-plan--inventory"></a>
##### Inventory

Local/offline operations include:

- view inventory;
- search/filter inventory;
- add/register items;
- edit items;
- receive stock;
- checkout;
- return;
- consume;
- adjust stock;
- transfer;
- damage;
- loss;
- repair out;
- repair in;
- inventory history/movements;
- local validation;
- local mutation persistence;
- queueing changes for synchronization.

The inventory system already has substantial local SQLite and outbox foundations.

<a id="source-labos-v1-plan--projects"></a>
##### Projects

Local/offline operations include:

- view projects;
- create projects;
- edit project metadata;
- delete projects;
- project workspace;
- tasks CRUD;
- experiments CRUD;
- project BOM;
- project-item links;
- locally available project information.

Central-only project functionality must not accidentally become a V1 dependency.

<a id="source-labos-v1-plan--knowledge-notes"></a>
##### Knowledge / Notes

Local/offline operations include:

- view notes;
- create notes;
- edit notes;
- delete notes;
- search locally available notes;
- tags;
- revisions;
- restore revisions;
- knowledge findings/results/relationships;
- local knowledge search;
- knowledge overview/counts based on local data.

<a id="source-labos-v1-plan--resources"></a>
##### Resources

Resource metadata and local records should be available locally.

Local/offline resource operations include:

- list resources;
- view resource metadata;
- create local link resources;
- create folders;
- edit metadata;
- tags/categories;
- delete resources where permitted;
- browse locally available resources;
- view files already downloaded to the workstation.

However, **actual media acquisition/processing remains central**.

<a id="source-labos-v1-plan--users-identity"></a>
##### Users / identity

Local:

- login;
- session;
- current local identity;
- password change;
- profile/preferences where applicable.

<a id="source-labos-v1-plan--settings"></a>
##### Settings

Workstation/user settings that do not require central coordination should remain local.

<a id="source-labos-v1-plan--sync"></a>
##### Sync

The local system must maintain:

- sync outbox;
- pending changes;
- retries;
- sync status;
- sync cursor/state;
- conflicts;
- conflict resolution;
- recovery after restart;
- offline accumulation of changes.

---

<a id="source-labos-v1-plan--5-what-belongs-to-the-central-system"></a>
#### 5. What belongs to the central system

The central backend/PostgreSQL system handles functionality that inherently requires centralized coordination.

<a id="source-labos-v1-plan--synchronization"></a>
##### Synchronization

- receive local outbox changes;
- idempotency;
- server-side validation;
- stale-data/conflict detection;
- central reconciliation;
- distribute central changes back to workstations;
- tombstones/deletions;
- cross-device consistency.

<a id="source-labos-v1-plan--central-data"></a>
##### Central data

PostgreSQL is the central authoritative/shared datastore for synchronized/global information.

<a id="source-labos-v1-plan--media"></a>
##### Media

The central backend owns:

- media download jobs;
- yt-dlp;
- FFmpeg;
- centralized media processing;
- central media storage;
- download queue;
- media conversion/preparation;
- server-side media status.

Downloaded videos must not depend on their original external links for playback.

The desktop should use locally available downloaded media when media has been prepared and synchronized/available.

<a id="source-labos-v1-plan--cross-workstation-services"></a>
##### Cross-workstation services

Central-only functionality includes:

- synchronization between multiple workstations;
- central aggregation;
- globally authoritative state;
- cross-workstation reporting;
- centralized automation;
- central jobs/services;
- future multi-user/account management.

---

<a id="source-labos-v1-plan--6-existing-synchronization-foundation"></a>
#### 6. Existing synchronization foundation

The project already contains an inventory sync/outbox foundation.

<a id="source-labos-v1-plan--local-side"></a>
##### Local side

The local SQLite layer contains:

- `local_schema_migrations`;
- `device_identity`;
- `sync_state`;
- `sync_outbox`;
- `sync_conflicts`;
- local inventory snapshot/state;
- inventory movement cache;
- inventory sync cursor.

The inventory item snapshot in `sync_state.inventory_snapshot` is the single local source of truth for workstation inventory item state. The older duplicate `local_inventory_items`/`local_inventory_movements` tables are no longer created or used by the runtime; movement history retained locally is a separate cache in `local_inventory_movement_records`.

Local changes are queued in the outbox.

<a id="source-labos-v1-plan--central-side"></a>
##### Central side

The central backend has:

- `/api/sync/push`;
- `/api/sync/pull`;
- idempotency handling;
- stale item conflict checks;
- conflict-resolution override;
- tombstone reconciliation.

The server pull cursor uses a composite event cursor based on:

- event time;
- event type;
- event ID.

Legacy timestamp cursors are accepted.

<a id="source-labos-v1-plan--reliability"></a>
##### Reliability

The desktop sync layer already has:

- automatic sync;
- reconnect recovery;
- retry/backoff;
- manual retry;
- persisted sync error state;
- sync status UI;
- pending-change counts;
- conflict counts;
- actionable conflict resolution.

The remaining architectural work is to make the **local backend** the normal execution boundary instead of having the desktop rely directly on the central API for local operations.

---

<a id="source-labos-v1-plan--7-local-backend-requirement"></a>
#### 7. Local backend requirement

A major decision from the discussion is that the SQLite layer should not merely be treated as an internal desktop implementation detail.

The intended model is a real **Local LabOS Backend** bound to the installed application/workstation.

Its responsibilities should include:

- local API/runtime boundary;
- SQLite access;
- local authentication/session;
- local inventory;
- local projects;
- local notes/knowledge;
- local resources metadata;
- local settings;
- local validation;
- local outbox;
- local sync state;
- local conflict state;
- local-first reads/writes.

The Tauri application should communicate with this local runtime rather than directly reaching into PostgreSQL.

The existing Tauri Rust local runtime is an implementation foundation for this direction. The final V1 architecture should make the local-backend boundary explicit and maintainable.

---

<a id="source-labos-v1-plan--8-current-local-first-implementation-progress"></a>
#### 8. Current local-first implementation progress

The following local-first runtime work has already been added on `main`.

<a id="source-labos-v1-plan--inventory-1"></a>
##### Inventory

Existing foundation:

- local inventory tables;
- local-first reads;
- local mutations;
- atomic movement updates;
- sync outbox;
- movement validation.

Supported movement types:

- receive;
- checkout;
- return;
- consume;
- adjust;
- transfer;
- damage;
- loss;
- repair_out;
- repair_in.

Adjustment requires a reason.

<a id="source-labos-v1-plan--projects-1"></a>
##### Projects

Added local Projects runtime:

`desktop/src-tauri/src/local_projects.rs`

It currently covers:

- project list/get/create/update/delete;
- project workspace;
- task CRUD;
- experiment CRUD;
- BOM CRUD;
- project-item link/unlink;
- local sync-outbox queueing.

Project API calls were changed to prefer the local Tauri runtime.

Current implementation uses a JSON state blob in `sync_state` as a pragmatic first pass. This should be reviewed before final V1 if normalized local tables are preferable.

<a id="source-labos-v1-plan--notes"></a>
##### Notes

Added:

`desktop/src-tauri/src/local_notes.rs`

It covers:

- list/search/filter;
- get/create/update/delete;
- revisions;
- restore revision;
- local outbox queueing.

Notes API calls now prefer the local runtime.

<a id="source-labos-v1-plan--knowledge"></a>
##### Knowledge

Added:

`desktop/src-tauri/src/local_knowledge.rs`

It covers local:

- findings;
- knowledge results;
- relationships;
- search;
- overview counts;
- recent local notes/resources;
- tag aggregation;
- sync-outbox queueing.

Knowledge API calls now prefer the local runtime.

The Knowledge API file should receive a careful review/build verification because its local-first transformation was performed through automated edits.

<a id="source-labos-v1-plan--locations"></a>
##### Locations

Added:

`desktop/src-tauri/src/local_locations.rs`

It covers:

- list/get/create/update/delete;
- parent IDs;
- local location state;
- sync-outbox queueing.

Locations API calls now prefer the local runtime.

A known follow-up issue remains: local `item_count` is initialized locally and may not yet accurately reflect local inventory assignments. This must be corrected before V1.

<a id="source-labos-v1-plan--resources-1"></a>
##### Resources

A first local resource metadata/runtime pass has been added:

`desktop/src-tauri/src/local_resources.rs`

It covers local:

- resource listing;
- resource lookup;
- cached resource records;
- link resources;
- folders;
- metadata updates;
- deletion;
- tags;
- YouTube resource type/thumbnail metadata.

Resource API calls have been changed to prefer the local runtime for metadata/record operations.

The current design deliberately keeps actual media download/processing central.

<a id="source-labos-v1-plan--media-1"></a>
##### Media

The media download API remains central.

Current central media runtime uses:

- yt-dlp;
- FFmpeg;
- download queue;
- media jobs;
- thumbnail/media endpoints;
- central processing.

The rule remains:

> Media acquisition and processing are central services, not local SQLite responsibilities.

---

<a id="source-labos-v1-plan--9-resourcemedia-distinction"></a>
#### 9. Resource/media distinction

This distinction is important.

<a id="source-labos-v1-plan--resource-record"></a>
##### Resource record

A resource's local metadata can exist in SQLite:

- ID;
- name;
- kind;
- file type;
- URL;
- thumbnail metadata;
- category;
- description;
- tags;
- parent relationships;
- local associations.

<a id="source-labos-v1-plan--media-processing"></a>
##### Media processing

The following remain central:

- downloading external video;
- yt-dlp;
- FFmpeg;
- media conversion;
- centralized storage;
- download queue/job execution.

The desktop must never require the original YouTube/Facebook/etc. URL to play a successfully downloaded local video.

For YouTube resources, the local resource metadata can retain a thumbnail URL, while downloaded thumbnail/media handling remains governed by the central media service where appropriate.

---

<a id="source-labos-v1-plan--10-current-backend-route-inventory-to-classify"></a>
#### 10. Current backend route inventory to classify

The central backend currently exposes/imports routes including:

- items;
- sync;
- transactions;
- projects;
- project workspace;
- resources;
- resource editor;
- media downloads;
- notes;
- search;
- auth;
- funding sources;
- budget periods;
- assistant;
- project blocks;
- project connectors;
- blocks;
- connectors;
- locations;
- audit;
- collaboration;
- knowledge;
- reports;
- automation;
- engineering;
- operations;
- system;
- experience;
- phase4;
- Excel;
- Excel purchases;
- Excel finance.

These routes must be explicitly classified into:

1. local-first/local backend;
2. central-only;
3. hybrid/sync-mediated.

No route should remain central merely because it historically existed in the central backend.

---

<a id="source-labos-v1-plan--11-important-existing-application-decisions"></a>
#### 11. Important existing application decisions

<a id="source-labos-v1-plan--sidebarnavigation"></a>
##### Sidebar/navigation

The intended navigation structure is:

- Knowledge — standalone;
- Resources — standalone;
- Inventory — standalone;
- Laboratory group containing:
  - Operations;
  - Intelligence.

Scan Item was removed from the sidebar and moved into the TopBar action area.

<a id="source-labos-v1-plan--scan-item"></a>
##### Scan Item

Scan Item is a TopBar action rather than a permanent sidebar destination.

<a id="source-labos-v1-plan--assistant"></a>
##### Assistant

The assistant architecture already has context/tooling work.

Important decisions:

- the assistant can use a selected project/custom aspects;
- do not collapse the global assistant into merely the current route's project;
- preserve assistant tools/context across turns.

<a id="source-labos-v1-plan--ui"></a>
##### UI

The site has already received multiple UI polish changes.

Current instruction is to avoid broad destructive layout changes.

In particular:

- do not move the right activity rail/sidebar to the left;
- preserve the existing layout unless a focused fix requires otherwise;
- fix concrete UX issues without rewriting unrelated areas.

---

<a id="source-labos-v1-plan--12-existing-mediaresource-ui-decisions"></a>
#### 12. Existing media/resource UI decisions

The Resources page has:

- resource viewer;
- local resource viewer wrapper;
- local media URL handling;
- thumbnail handling;
- downloaded-video playback behavior.

The user explicitly tested thumbnails and confirmed that failed image requests were an actual request/data problem, not simply hidden images.

A previous issue involved old YouTube resources lacking a local thumbnail endpoint/thumbnail data.

Current design should preserve resource thumbnails and distinguish:

- metadata thumbnail;
- locally downloaded media;
- central download processing;
- original external URL.

A random YouTube link used during testing must not be treated as a special production data case.

---

<a id="source-labos-v1-plan--13-release-strategy"></a>
#### 13. Release strategy

The earlier 2.2.1 build is treated as a **development/test build**, not the final V1 release.

Do not release/tag V1 until the local backend architecture is complete and verified.

<a id="source-labos-v1-plan--fresh-v1-installation"></a>
##### Fresh V1 installation

The final V1 installer must:

- install the desktop application;
- create fresh local SQLite data on first launch;
- seed baseline/system data;
- create the local administrator;
- not inherit development/test records;
- maintain Production/Preview data isolation.

<a id="source-labos-v1-plan--existing-installers"></a>
##### Existing installers

Previously built 2.2.1 Production and Preview installers are not the final release.

They should be removed/uninstalled during cleanup once the corresponding databases and regression data have been identified.

Do not blindly delete AppData/SQLite databases before identifying which databases are:

- Production;
- Preview;
- development/test;
- regression fixtures.

<a id="source-labos-v1-plan--release-metadata"></a>
##### Release metadata

The release process already uses versioning across:

- `desktop/package.json`;
- `backend/package.json`;
- `desktop/src-tauri/tauri.conf.json`;
- `desktop/src-tauri/Cargo.toml`.

Release tags follow:

`vMAJOR.MINOR.PATCH`

The existing release workflow builds Windows installers and produces SHA-256 checksums.

No final V1 release should be created until architecture/bootstrap verification is complete.

---

<a id="source-labos-v1-plan--14-verification-requirements-before-v1"></a>
#### 14. Verification requirements before V1

Every local-first area must be tested in the actual Tauri runtime.

<a id="source-labos-v1-plan--localoffline-tests"></a>
##### Local/offline tests

For each local-first feature:

1. Launch the desktop app.
2. Disconnect/disable central connectivity.
3. Confirm reads still work.
4. Create/update/delete locally as appropriate.
5. Confirm changes persist in local SQLite.
6. Confirm changes are queued in the sync outbox.
7. Restart the application.
8. Confirm local state remains.
9. Restore connectivity.
10. Confirm queued changes synchronize.
11. Confirm sync status and conflict handling work.

<a id="source-labos-v1-plan--central-service-tests"></a>
##### Central-service tests

For central-only features:

- verify they fail clearly when the central service is unavailable;
- verify they do not silently corrupt local state;
- verify they become available when central connectivity returns.

<a id="source-labos-v1-plan--sync-tests"></a>
##### Sync tests

Verify:

- offline accumulation;
- retry/backoff;
- reconnect;
- idempotency;
- stale update conflict;
- conflict record creation;
- keep-local resolution;
- accept-server resolution;
- dismiss;
- tombstone handling;
- cursor progression;
- restart recovery.

<a id="source-labos-v1-plan--build-verification"></a>
##### Build verification

Before V1:

- TypeScript compile;
- Vite production build;
- Rust/Tauri build;
- local backend/runtime checks;
- central backend syntax/startup checks;
- relevant automated/static tests;
- actual offline/online smoke tests.

No feature should be considered complete merely because its source files were written.

---

<a id="source-labos-v1-plan--15-revised-completion-strategy"></a>
#### 15. Revised completion strategy

The remaining V1 work is grouped into three broad passes, followed by a surgical refinement pass. The project should no longer optimize around throwaway testing builds.

<a id="source-labos-v1-plan--phase-1-heavy-build-core-product-completion"></a>
##### Phase 1 — Heavy Build: Core Product Completion

Finish the substantial engineering work required for a complete LabOS workstation product: local-first workstation-owned domains; explicit local runtime boundary; SQLite persistence and bootstrap/auth/session; inventory, projects, notes, knowledge, locations, resources and finance local behavior; local search; sync outbox, push/pull, retries, conflicts, tombstones and recovery; central media acquisition/processing and other central-only services; central/local/hybrid route classification and boundary cleanup; and production configuration/data isolation.

Small visual issues found during this pass are recorded rather than allowed to derail the heavy implementation.

<a id="source-labos-v1-plan--phase-2-heavy-build-integration-product-completion"></a>
##### Phase 2 — Heavy Build: Integration & Product Completion

Make the completed domains operate as one coherent system: cross-domain workflows; dashboard/activity consistency; project ↔ inventory ↔ resources ↔ notes ↔ knowledge relationships; offline accumulation and reconnect synchronization; central-to-workstation and workstation-to-central reconciliation; clear central-only service behavior when disconnected; pagination/loading/empty/error-state consistency; permissions and authorization boundaries; restart/recovery behavior; Preview/Production isolation; and release/build readiness.

<a id="source-labos-v1-plan--phase-3-full-system-audit-verification"></a>
##### Phase 3 — Full-System Audit & Verification

Stop adding broad functionality and inspect the entire product systematically: every major page/workflow, offline operation, online/reconnect behavior, cross-workstation synchronization, fresh-install/bootstrap, data integrity, central-service dependencies, TypeScript/Vite/Rust/backend/static tests/builds, and UI/UX consistency. Defects that block correctness are fixed immediately; smaller findings are captured for Phase 4.

<a id="source-labos-v1-plan--phase-4-surgical-fixes-refinement"></a>
##### Phase 4 — Surgical Fixes & Refinement

Address the accumulated minor and edge-case findings carefully: UX polish, confusing/redundant navigation, pagination and interaction defects, validation/error messages, visual consistency, accessibility, synchronization edge cases, performance/cleanup, and final regression verification. Only after this pass is V1 release packaging final.

<a id="source-labos-v1-plan--working-model"></a>
##### Working model

The central server is not a special testing dependency. It is a service that can be started periodically for synchronization and central-only functionality. A workstation must remain useful without it for operations classified as local-first.

Work is performed directly on `main` unless explicitly changed by the user. Browser verification is used for fast iteration; the installed Tauri application receives targeted verification after the broad implementation is stable.

---

<a id="source-labos-v1-plan--15a-local-backend-architecture-reset"></a>
#### 15A. Local Backend Architecture Reset

The workstation runtime is now treated as a **Local LabOS Backend**, not as a collection of unrelated desktop-only APIs.

The target topology is:

`Desktop UI → Local LabOS Backend → SQLite`

and:

`Local LabOS Backend ⇄ Sync Engine ⇄ Central LabOS Backend → PostgreSQL`

The local backend must mirror the central backend's domain/API contracts and business rules wherever the domain is workstation-owned. Its storage implementation is SQLite; the central implementation is PostgreSQL. This is an implementation boundary, not a second product.

<a id="source-labos-v1-plan--local-backend-responsibilities"></a>
##### Local backend responsibilities

- expose the workstation API to the desktop;
- own local SQLite reads/writes and transactions;
- enforce the same domain validation/business invariants as the central backend where applicable;
- maintain the local session/authentication boundary;
- maintain the sync outbox, cursor, retry, conflict and tombstone state;
- remain usable when the central server is unavailable;
- queue mutations rather than silently sending workstation-owned writes to PostgreSQL.

<a id="source-labos-v1-plan--central-only-responsibilities"></a>
##### Central-only responsibilities

The local backend must not implement central infrastructure that has no offline purpose, including media acquisition and processing (yt-dlp/FFmpeg), central file/media storage, cross-workstation aggregation, central jobs, and other explicitly central services.

<a id="source-labos-v1-plan--migration-rule"></a>
##### Migration rule

Existing `local_*` Rust modules are retained as implementation assets during migration. New work must not create another isolated per-page local API. Instead, local functionality is consolidated behind the Local LabOS Backend boundary and progressively aligned with the central route/domain contracts.

<a id="source-labos-v1-plan--required-parity-audit"></a>
##### Required parity audit

Before declaring the architecture complete, every central route is classified as **local-first**, **central-only**, or **hybrid/sync-mediated**. Every local-first route must have a deliberate SQLite implementation and sync representation. A central fallback is not considered an offline implementation.

<a id="source-labos-v1-plan--immediate-implementation-sequence"></a>
##### Immediate implementation sequence

1. define the shared route/domain contract and capability classification;
2. make the existing Rust SQLite runtime the explicit Local LabOS Backend boundary;
3. align local operations with central domain contracts instead of page-specific command shapes;
4. migrate remaining workstation-owned central routes into the local backend;
5. connect the common sync engine to the complete local route set;
6. retain central-only services behind an explicit central capability boundary;
7. verify the complete application offline and online before V1.

<a id="source-labos-v1-plan--engineering-local-first-implementation-status"></a>
##### Engineering local-first implementation status
Engineering is split by responsibility: formula definitions and the four built-in formula calculations execute locally; engineering calculation records and engineering test records persist in the workstation SQLite runtime and queue sync changes; the central backend provides cross-workstation reconciliation and pull/tombstone propagation. Desktop Engineering APIs use the Local LabOS Backend boundary in the Tauri runtime.

<a id="source-labos-v1-plan--16-detailed-implementation-checklist-legacy-sequence-retained-for-traceability"></a>
#### 16. Detailed implementation checklist (legacy sequence retained for traceability)


<a id="source-labos-v1-plan--phase-a-finish-the-local-runtime-boundary"></a>
##### Phase A — Finish the local runtime boundary

Make the Local LabOS Backend explicit and ensure desktop local operations flow through it.

Priority:

1. local runtime/bootstrap;
2. local authentication;
3. local settings/session;
4. local API boundary;
5. local SQLite ownership.

<a id="source-labos-v1-plan--phase-b-complete-local-first-core-domains"></a>
##### Phase B — Complete local-first core domains

Finish and verify:

1. Inventory;
2. Projects;
3. Notes;
4. Knowledge;
5. Locations;
6. Resources.

Resolve known gaps such as location/item counts.

<a id="source-labos-v1-plan--phase-c-search"></a>
##### Phase C — Search

Move local search to the local backend/SQLite path for workstation-owned data.

Central search should remain available for central/global information where needed.

<a id="source-labos-v1-plan--phase-d-authbootstrap"></a>
##### Phase D — Auth/bootstrap

Implement the single-user local administrator model.

Fresh install must bootstrap cleanly without depending on PostgreSQL.

The exact initial-admin credential/first-run password scheme must be finalized as an implementation decision; do not use an insecure universal hard-coded production password.

<a id="source-labos-v1-plan--phase-e-central-boundary-audit"></a>
##### Phase E — Central boundary audit

Audit every central route and classify it:

- Local;
- Central;
- Hybrid.

Move or duplicate only the required logic so the local backend is self-contained.

<a id="source-labos-v1-plan--phase-f-sync-protocol-completion"></a>
##### Phase F — Sync protocol completion

Ensure local changes map cleanly into the central sync protocol.

Projects, notes, knowledge, locations, resources and other local-first domains must have deliberate sync representations rather than accidental/unrecognized outbox entity types.

<a id="source-labos-v1-plan--phase-g-mediacentral-services"></a>
##### Phase G — Media/central services

Keep:

- yt-dlp;
- FFmpeg;
- media downloads;
- processing;
- central storage

strictly central.

Verify that the desktop consumes prepared local media correctly.

<a id="source-labos-v1-plan--phase-h-full-offlineonline-verification"></a>
##### Phase H — Full offline/online verification

Test the complete application with the central service unavailable and then restored.

<a id="source-labos-v1-plan--phase-i-fresh-v1-bootstrap"></a>
##### Phase I — Fresh V1 bootstrap

Create and test a truly clean V1 database initialization path.

<a id="source-labos-v1-plan--phase-j-release-cleanup"></a>
##### Phase J — Release cleanup

Identify and preserve regression/test databases, uninstall old dev/test builds, clean old installers, and confirm Production/Preview isolation.

<a id="source-labos-v1-plan--phase-k-v1-build-and-release"></a>
##### Phase K — V1 build and release

Only after all previous phases pass:

- finalize version;
- build Production;
- build Preview;
- verify installers;
- generate checksums;
- tag V1;
- publish release.

---

<a id="source-labos-v1-plan--17-known-caveats-to-resolve"></a>
#### 17. Known caveats to resolve

The following items are known and should not be forgotten:

- Local backend boundary is still being formalized.
- Some local-first implementations currently use JSON blobs in `sync_state`; review before V1.
- Local project owner identity is not yet backed by a finalized local admin identity.
- Local project workspace currently returns simplified/empty data for some central-only fields.
- Project experiment task links and task/experiment resource attachments are now represented in local project state and the sync protocol; actual runtime/offline verification is still pending.
- Local resource upload/file storage is not yet equivalent to central resource storage; central file/media handling remains distinct.
- Resource sync mappings are now implemented for offline link/folder creation, metadata updates, deletion, server pull, tombstones, and pending-local protection; actual file upload/media acquisition remains central.
- Desktop global search now has a local-first path for inventory, projects, tasks, experiments, notes, and resources; central search remains the hybrid source for users and other explicitly central information.
- Local authentication/bootstrap is implemented and requires fresh-install/offline runtime verification.
- Location `item_count` needs reconciliation with local inventory.
- Some desktop APIs still call the central API directly and need classification/migration.
- The Knowledge API local-first transformation needs build/runtime verification.
- No final V1 tag/release should be assumed to exist.
- The earlier 2.2.1 installers are development/test artifacts, not the final V1.

---

<a id="source-labos-v1-plan--18-working-rules-for-future-implementation"></a>
#### 18. Working rules for future implementation

1. Work directly on `main` when implementing requested changes.
2. Do not create a new branch unless explicitly requested.
3. Do not replace PostgreSQL with SQLite.
4. Do not connect the desktop directly to PostgreSQL.
5. Do not make the central API a hidden dependency for local/offline operations.
6. Keep central-only services central.
7. Preserve existing regression/test data until identified.
8. Treat V1 as a fresh install.
9. Maintain separate Production and Preview local data.
10. Verify actual Tauri/offline behavior, not only source-level intent.
11. Avoid unrelated UI/layout rewrites while doing architecture work.
12. Do not claim a phase is complete until it has been implemented **and verified**.
13. When a domain is local-first, its local reads/writes must not silently fall through to PostgreSQL merely because the desktop is online.
14. When a domain is central-only, provide a clear central-service dependency instead of pretending it is offline-capable.
15. Sync must be explicit and idempotent.

---

<a id="source-labos-v1-plan--19-current-status-snapshot"></a>
#### 19. Current status snapshot

The project has already established substantial foundations for:

- local SQLite;
- inventory;
- outbox/sync;
- conflict handling;
- local projects;
- local notes;
- local knowledge;
- local locations;
- first-pass local resource metadata.

The next major work is **not a release tag**.

For execution, the detailed phases above are consolidated into five working phases:

1. **Local LabOS Runtime** — formalize Desktop → Local Backend → SQLite, including local bootstrap/auth/session/settings.
2. **Local-First Application** — complete and verify workstation-owned domains, local search, and classify remaining desktop APIs.
3. **Sync + Central Services** — complete sync mappings/conflicts/recovery and keep media acquisition/processing central.
4. **V1 Verification + Fresh Install** — full offline/online verification, build checks, fresh SQLite bootstrap, administrator creation, and Production/Preview isolation.
5. **V1 Re-Release** — final UI/UX polish, regression pass, production/preview builds, checksums, tag, and GitHub release.

The current implementation work is in **Phase 2 — Local-First Application**.

The next work is to finish the architectural boundary:

> **Desktop → Local LabOS Backend → SQLite**

and:

> **Local LabOS Backend → Central LabOS Backend → PostgreSQL**

with synchronization and centralized media services between/around those layers as appropriate.

Only after that boundary is complete, the remaining local-first domains and central-only services are classified, and the complete system is verified offline/online should the project proceed to the fresh V1 bootstrap and final release.


<a id="source-labos-v1-plan--financials-implementation-progress"></a>
##### Financials — implementation progress

Local-first finance runtime is now implemented on main for transactions, budget periods, and funding sources. Desktop finance CRUD prefers local SQLite-backed state and queues mutations to the sync outbox. Central synchronization now accepts and pulls these records, including tombstone propagation. Finance summaries and Excel operations remain central-derived services until their local equivalents are explicitly implemented and verified.


<a id="source-labos-v1-plan--local-authentication-bootstrap-implementation-progress"></a>
##### Local Authentication / Bootstrap — implementation progress

The local Tauri runtime now owns the V1 workstation authentication boundary: first-run administrator bootstrap, local login/session, current-user lookup, logout, password change, and profile update. Passwords are stored using Argon2id-compatible password hashes rather than a hard-coded credential. The desktop authentication API prefers this local runtime under Tauri and falls back to the central API only for non-Tauri/browser contexts. Actual fresh-install/offline runtime verification is still required.

<a id="source-labos-v1-plan--project-experiment-work-implementation-progress"></a>
##### Project Experiment Work — implementation progress

Project experiment measurements and observations are local-first and sync-aware. Task↔experiment links now have a stable server sync identity and local Tauri CRUD. Project task/experiment resource attachments are local-first for metadata/linking while the underlying resource/media boundary remains unchanged. Experiment revision history remains a server-derived history until a local revision model is explicitly implemented and verified.

<a id="source-labos-v1-plan--project-canvas-implementation-progress"></a>
##### Project Canvas — implementation progress

Project canvas metadata is now local-first on main. Desktop canvas reads and block/connector mutations use the local SQLite project runtime when running under Tauri and queue explicit project_block/project_connector outbox changes. Central sync accepts these entities, enforces project edit access, pulls current canvas state with project workspace data, and propagates canvas tombstones back to workstations. Canvas media/file storage remains subject to the existing central resource/media boundary.

<a id="source-labos-v1-plan--local-workstation-settings-implementation-progress"></a>
##### Local workstation settings — implementation progress

Daily-use preferences are now explicitly workstation-local. Under Tauri, the desktop reads and writes notification/music preferences through the local SQLite runtime rather than treating the central `/system/daily-preferences` endpoint as the normal path. Values are validated and persisted in local `sync_state`; they are intentionally not sync-outbox entities because these are per-workstation preferences. System health and administrator export remain central services.


---

<a id="source-labos_v1_architecture_and_release_plan"></a>
## LabOS — Architecture, V1 Release Plan, Decisions & Continuation Notes

Original source: `LABOS_V1_ARCHITECTURE_AND_RELEASE_PLAN.md`. Retained historical scope/status.

<a id="source-labos_v1_architecture_and_release_plan--labos-architecture-v1-release-plan-decisions-continuation-notes"></a>
### LabOS — Architecture, V1 Release Plan, Decisions & Continuation Notes

<a id="source-labos_v1_architecture_and_release_plan--purpose"></a>
#### Purpose

This document captures the plan, requirements, architectural correction, decisions, implementation work, release decisions, and next steps agreed during the LabOS development conversation beginning with the clarification:

> “Since the app is not connected to our central whatever, shouldn't there be a backend where the SQLite lives which is bound to the app and the central system also exists with Postgres where syncing, downloads etc. happens when fully developed?”

It is intended to be the handoff document for continuing the work in a new chat.

---

<a id="source-labos_v1_architecture_and_release_plan--1-core-architecture-decision"></a>
### 1. Core Architecture Decision

The most important decision is that LabOS has **two distinct backend/runtime layers**.

<a id="source-labos_v1_architecture_and_release_plan--11-per-workstation-local-labos"></a>
#### 1.1 Per-workstation local LabOS

Each LabOS desktop installation has its own local runtime:

```
LabOS Desktop / Tauri
        ↓
Local LabOS Backend
        ↓
Local SQLite
```

The local backend is bound to that workstation/app installation.

It is responsible for:

- local application operations
- local authentication/session state
- local inventory state
- local projects
- local notes
- local knowledge
- local resources metadata
- local locations
- local settings/preferences where applicable
- local-first reads and mutations
- local transaction/movement processing
- local sync outbox
- local sync/conflict state
- operating when the central server is unavailable

**Critical rule:** PostgreSQL must not be required for ordinary workstation-local operations.

<a id="source-labos_v1_architecture_and_release_plan--12-central-labos-system"></a>
#### 1.2 Central LabOS system

The central system is separate:

```
Local backend(s)
       ↓
Central LabOS Backend
       ↓
PostgreSQL
       ↓
Central services
```

The central system is responsible for:

- synchronization between workstations
- PostgreSQL persistence
- cross-workstation/shared state
- server-side conflict handling
- central automation
- media downloads
- yt-dlp
- FFmpeg
- central media storage
- server-side processing
- aggregation/reporting across workstations
- future multi-user/account management
- other globally authoritative services

**Critical rule:** the central server is optional to the workstation's basic local operation.

---

<a id="source-labos_v1_architecture_and_release_plan--2-local-first-principle"></a>
### 2. Local-First Principle

The governing principle for V1 is:

> If an operation only concerns the workstation's own data, PostgreSQL should not be in its execution path.

The desktop should therefore use the local backend/SQLite first.

The central backend is used when:

- synchronizing local changes
- obtaining shared/central information
- performing central-only operations
- processing/download operations that intentionally belong to the central system

The desktop must not simply use PostgreSQL as its offline database.

---

<a id="source-labos_v1_architecture_and_release_plan--3-v1-installation-decision"></a>
### 3. V1 Installation Decision

V1 is a **fresh installation**.

It is not a continuation of the development/test database.

On first launch of a V1 installation:

1. Create a fresh local SQLite database.
2. Apply the local schema.
3. Seed baseline/system data.
4. Seed one local administrator identity.
5. Allow the application to operate locally without the central server.

The V1 database must **not** contain development/test:

- inventory
- projects
- notes
- resources
- conflicts
- outbox entries
- experimental data
- test users
- other development artifacts

Existing development/test databases must be preserved until they are explicitly identified and classified. They should not be blindly deleted during cleanup.

---

<a id="source-labos_v1_architecture_and_release_plan--4-single-user-v1-decision"></a>
### 4. Single-User V1 Decision

The project is intentionally simplified for V1 because there is currently only one user.

V1 does **not** need full user/account management.

V1 needs:

- one local administrator identity
- local login
- local session/authentication
- offline login
- ability to change the local administrator's password
- local identity/session persistence

Full account provisioning and multi-user management can remain a future central/server responsibility.

This also means:

- collaboration/member management is not a V1 dependency
- local project permissions can behave as administrator permissions
- local workspaces do not need real multi-user membership
- future central user management can be added later

Do not invent a universal hard-coded production admin password. The initial admin credential/first-run setup should be implemented securely and explicitly.

---

<a id="source-labos_v1_architecture_and_release_plan--5-what-must-work-offline-locally"></a>
### 5. What Must Work Offline / Locally

The following categories are intended to work through the local runtime without PostgreSQL.

<a id="source-labos_v1_architecture_and_release_plan--inventory"></a>
#### Inventory

Local:

- view inventory
- add/register item
- edit item
- receive
- checkout
- return
- consume
- adjust
- transfer
- damage
- loss
- repair out
- repair in
- movement history
- inventory-related local relationships
- local inventory reads
- local inventory mutations
- queueing changes for synchronization

<a id="source-labos_v1_architecture_and_release_plan--projects"></a>
#### Projects

Local:

- view projects
- create projects
- edit projects
- project metadata
- project workspace
- tasks
- experiments
- BOM
- project-item relationships
- local project reads/mutations

Central-only/project-future items may include:

- multi-user membership
- centrally shared project state
- central collaboration
- central attachments/services where appropriate

<a id="source-labos_v1_architecture_and_release_plan--notes"></a>
#### Notes

Local:

- view notes
- create notes
- edit notes
- delete notes
- search/filter
- tags
- revisions
- restore revisions
- local note relationships

<a id="source-labos_v1_architecture_and_release_plan--knowledge"></a>
#### Knowledge

Local:

- findings
- knowledge results
- relationships
- knowledge search
- local note search integration
- tags
- overview/recent local knowledge information

<a id="source-labos_v1_architecture_and_release_plan--resources"></a>
#### Resources

Local metadata:

- list resources
- view resource metadata
- create links
- create folders
- edit resource metadata
- delete resources
- categories
- descriptions
- tags
- local relationships to items/projects/notes
- locally cached resource metadata

Central-only resource/media processing:

- downloading external media
- yt-dlp
- FFmpeg
- central media processing
- central media storage
- other server-side media preparation

Important requirement:

> Downloaded videos must never be played from their original external links. Playback should use the downloaded/local/processed media.

<a id="source-labos_v1_architecture_and_release_plan--locations"></a>
#### Locations

Local:

- list locations
- get location
- create location
- update location
- delete location
- parent location relationships

Before V1, local location/item relationships and item counts must be made accurate so deletion safety does not rely on an inaccurate offline `item_count`.

<a id="source-labos_v1_architecture_and_release_plan--authentication-identity"></a>
#### Authentication / identity

Local:

- login
- current session
- current user
- password change
- profile/local identity where appropriate

The central server is not allowed to be a prerequisite for offline login.

<a id="source-labos_v1_architecture_and_release_plan--settings"></a>
#### Settings

Local workstation/user preferences should remain local unless they explicitly require central coordination.

<a id="source-labos_v1_architecture_and_release_plan--sync"></a>
#### Sync

Local:

- outbox
- retry state
- sync status
- conflict state
- conflict resolution state
- retrying after reconnect

Central:

- receive/persist sync changes
- idempotency
- server-side conflict detection
- server-side authoritative/shared state
- synchronization with other workstations

---

<a id="source-labos_v1_architecture_and_release_plan--6-central-only-responsibilities"></a>
### 6. Central-Only Responsibilities

The following remain central:

<a id="source-labos_v1_architecture_and_release_plan--synchronization"></a>
##### Synchronization

- push local outbox changes
- pull server changes
- central conflict handling
- tombstones
- cross-workstation reconciliation

<a id="source-labos_v1_architecture_and_release_plan--database"></a>
##### Database

- central PostgreSQL
- central migrations
- globally authoritative data

<a id="source-labos_v1_architecture_and_release_plan--media"></a>
##### Media

- yt-dlp
- FFmpeg
- media downloads
- media conversion/processing
- central media storage
- server-side media workers

<a id="source-labos_v1_architecture_and_release_plan--sharedglobal-services"></a>
##### Shared/Global Services

- cross-workstation aggregation
- central reports
- central automation
- future multi-user account provisioning
- centrally coordinated services

---

<a id="source-labos_v1_architecture_and_release_plan--7-existing-sync-architecture"></a>
### 7. Existing Sync Architecture

The local sync system already contains substantial groundwork.

Desktop sync:

- local pending changes are stored in SQLite
- changes have `change_id`, `device_id`, `entity_type`, `entity_id`, `operation`, payload and retry information
- automatic synchronization runs after authentication and periodically
- reconnect recovery exists
- retry backoff exists
- manual retry exists
- sync state survives restart
- conflicts can be stored locally

Central sync:

- `/api/sync/push`
- `/api/sync/pull`
- idempotency
- stale item conflict detection
- tombstone handling
- composite pull cursor
- conflict resolution retry/override support

The central pull cursor is based on:

```
{ at, type, id }
```

and is encoded as a base64url cursor.

---

<a id="source-labos_v1_architecture_and_release_plan--8-existing-local-sqlite-foundation"></a>
### 8. Existing Local SQLite Foundation

The local database currently contains infrastructure for:

- `local_schema_migrations`
- `device_identity`
- `sync_state`
- `sync_outbox`
- `sync_conflicts`

Local inventory state is already present.

The database path is based on Tauri's application data directory.

Production and Preview use different application identifiers, which isolates their local databases/data directories.

Current database file name:

```
labos-local.db
```

The local schema version currently contains the earlier sync-conflict foundation and additional local runtime migrations.

---

<a id="source-labos_v1_architecture_and_release_plan--9-existing-local-runtime-implementations"></a>
### 9. Existing Local Runtime Implementations

The following local-first runtime work has already been implemented on `main`.

<a id="source-labos_v1_architecture_and_release_plan--inventory-1"></a>
#### Inventory

Already implemented earlier:

- local inventory schema
- local inventory reads
- local inventory mutations
- atomic movement updates
- movement validation
- sync outbox
- local conflict support

Movement types include:

- receive
- checkout
- return
- consume
- adjust
- transfer
- damage
- loss
- repair_out
- repair_in

Adjustments require a reason.

<a id="source-labos_v1_architecture_and_release_plan--projects-1"></a>
#### Projects

Implemented:

- `desktop/src-tauri/src/local_projects.rs`
- local project list/get/create/update/delete
- workspace
- tasks CRUD
- experiments CRUD
- BOM CRUD
- project-item link/unlink
- local outbox queuing

Migration:

```
004_local_projects
```

API layer was changed so core project workflows prefer the local Tauri runtime.

Important caveats still to resolve:

- local project state currently uses a JSON blob in `sync_state`
- some project functions remain central
- local workspace currently returns empty members/notes/resources/activity in areas not implemented locally
- local project owner identity is not yet wired to a proper local single-user identity
- local IDs should be reviewed
- local project outbox mapping to central sync protocol still needs dedicated work

Relevant commits:

- `da722453416ef4e0609dbab345ae2033eca87adc`
- `de3c83628e8be5a21ee375cb7fa11759380ec60c`
- `a332424190e3798b86195cb7cdf738a7b3051908`
- `15bcd3fd222166bb4eb5eed24e3b11637d0f7682`
- `1d25e8a62ee0dd76886b8ad0987747a93637d825`
- `3e791cadd4bd89957d3abd1772ea9c70f7f98ba9`

<a id="source-labos_v1_architecture_and_release_plan--notes-1"></a>
#### Notes

Implemented:

- `desktop/src-tauri/src/local_notes.rs`
- local note list/search/filter
- get/create/update/delete
- tags
- revisions
- restore
- sync outbox

Migration:

```
005_local_notes
```

Relevant commits:

- `c71f44d5`
- `c9b38515`
- `3cb6bb4d`

<a id="source-labos_v1_architecture_and_release_plan--knowledge-1"></a>
#### Knowledge

Implemented:

- `desktop/src-tauri/src/local_knowledge.rs`
- findings CRUD
- knowledge results CRUD
- relationships CRUD
- search
- note-search integration
- overview
- tags
- sync outbox

Migration:

```
006_local_knowledge
```

Relevant commits:

- `21c9474851535fe9313c89c82beb7de5a1934b0a`
- `6f18cbebb522c6b291012d308e69b848380258c9`
- `e2727ab784217c9eb8d8c49189fb50417e207bef`

Important review item:

`desktop/src/api/knowledge.ts` was modified with automated replacements and should be inspected carefully before treating it as final.

<a id="source-labos_v1_architecture_and_release_plan--locations-1"></a>
#### Locations

Implemented:

- `desktop/src-tauri/src/local_locations.rs`
- list/get/create/update/delete
- parent_id support
- local sync outbox

Migration:

```
007_local_locations
```

Relevant commits:

- `46168db7340462e28e97a2d8203b2f29445a7307`
- `df9aed58641a57884de4dffa737a94efcd68d8a3`
- `e9d7e8731b9d215a9deebdce6d1aee364fef6c4`

Important review item:

Local `item_count` is currently initialized to zero and is not obviously synchronized with actual local inventory location assignments. This must be corrected before V1.

<a id="source-labos_v1_architecture_and_release_plan--resources-1"></a>
#### Resources

A first local resource metadata runtime has just been implemented.

Added:

```
desktop/src-tauri/src/local_resources.rs
```

It currently provides:

- local resource list
- get resource
- cache central resource metadata locally
- create link
- create folder
- update metadata
- delete
- tags
- local parent validation
- YouTube link recognition/thumbnail URL derivation

Migration:

```
008_local_resources
```

The desktop resource API was modified to prefer local runtime for metadata operations.

Recent commits:

- `90fcaaee11f6abaf0d9ea26b7cb2107826d46265`
- `85a1190ca757002e3e5bf4dc2f6353f673f255dc`
- `0139f8a1441ffe86058930e722e89cb38d205f92`
- `9f59db8bd65fd0182151dcaea1486d55e0457150`
- `a2d49ce44df401106a1fd78a619ac9d71d5f43b3`
- `429693bd623ab01d52a1895838ee00fe30134fce`
- `dcb518bb156bdaf51a276c32ff690afce83db9ba`

Resource/media boundary:

- resource metadata can be local
- actual media downloading remains central
- yt-dlp/FFmpeg remain central
- downloaded media must be used for playback rather than original URLs

Important review item:

The resource runtime is a pragmatic first pass using JSON state in `sync_state`. It needs build/testing and a proper sync mapping before V1.

---

<a id="source-labos_v1_architecture_and_release_plan--10-media-architecture-decision"></a>
### 10. Media Architecture Decision

Media processing remains central.

Existing central backend:

```
backend/src/media-downloads.js
```

It manages:

- yt-dlp
- FFmpeg
- download queue
- download worker
- media processing
- downloaded media
- thumbnails

Configured tools include:

- backend-relative yt-dlp
- backend FFmpeg
- environment overrides

The central media worker must remain a central-service responsibility.

The desktop should not duplicate yt-dlp/FFmpeg as part of the local SQLite runtime.

---

<a id="source-labos_v1_architecture_and_release_plan--11-browser-vs-tauri"></a>
### 11. Browser vs Tauri

Important runtime distinction:

- Browser does not have the Tauri IPC bridge.
- Full local SQLite functionality therefore requires the Tauri desktop runtime.
- Browser/API fallback can remain for central/web functionality.

Local APIs use a runtime check before invoking Tauri commands.

---

<a id="source-labos_v1_architecture_and_release_plan--12-current-desktop-api-direction"></a>
### 12. Current Desktop API Direction

The intended pattern is:

```
Desktop API function
       ↓
Is Tauri/local runtime available?
       ↓
YES → local Tauri backend/runtime → SQLite
       ↓
central sync when online

NO → central HTTP API fallback
```

The central fallback is retained primarily for browser/development compatibility and central operations.

The goal is not to leave two competing implementations indefinitely. Before V1, local ownership should be explicit for every operation.

---

<a id="source-labos_v1_architecture_and_release_plan--13-authentication-still-needs-rework"></a>
### 13. Authentication Still Needs Rework

Current desktop authentication historically uses the central API:

- login → `/auth/login`
- register → `/auth/register`
- me → `/auth/me`
- password → `/auth/me/password`
- profile → `/auth/me/profile`

Current App startup also historically validates the stored token against the central server.

This violates the new architecture.

Required V1 change:

- create local single-user authentication/bootstrap
- local login must work without central API
- local session must survive offline operation
- central authentication should no longer be a prerequisite for local app use
- central account management can remain future/non-V1

This is one of the next major implementation tracks.

---

<a id="source-labos_v1_architecture_and_release_plan--14-search-still-needs-local-first-work"></a>
### 14. Search Still Needs Local-First Work

Search is another major local-first category.

Required:

- local search over locally available inventory
- projects
- notes
- knowledge
- resources
- other locally available entities

Central search can remain available for:

- central/global data
- cross-workstation aggregation
- server-only services

Next implementation track after resource metadata should be local search.

---

<a id="source-labos_v1_architecture_and_release_plan--15-central-boundary-audit-still-required"></a>
### 15. Central Boundary Audit Still Required

The backend route inventory includes:

- items
- sync
- transactions
- projects
- project-workspace
- resources
- resource-editor
- media-downloads
- notes
- search
- auth
- funding sources
- budget periods
- assistant
- project blocks
- project connectors
- blocks
- connectors
- locations
- audit
- collaboration
- knowledge
- reports
- automation
- engineering
- operations
- system
- experience
- phase4
- excel
- excel-purchases
- excel-finance

These must be explicitly classified as:

1. local-first
2. central-only
3. hybrid/local cache + central sync
4. future/non-V1

Do not assume that every existing PostgreSQL route should become local.

The objective is to define ownership clearly.

---

<a id="source-labos_v1_architecture_and_release_plan--16-assistant-decision"></a>
### 16. Assistant Decision

The assistant architecture has already been improved.

Relevant commits:

- `d1a66b5248c39100a1df3d535059a2a8f4a8405f`
- `a081cc85e7713a80a934befc7d6a7a4535a10219`
- `cceed44ba62a269473b7b5334d9b92eb1c4d25ab`

The assistant has context/tool-calling support.

Important project decision:

The user explicitly chose a project and custom aspects previously. Do not assume the solution is simply to wire the currently selected project route into the assistant. The global assistant with selected project/custom context is intentional.

Assistant integration should be classified according to the local/central boundary rather than being casually moved to SQLite.

---

<a id="source-labos_v1_architecture_and_release_plan--17-uiux-decisions"></a>
### 17. UI/UX Decisions

The project has had broad UI work, but the current priority is architecture/reliability rather than broad redesign.

Current intended navigation:

- Knowledge — standalone
- Resources — standalone
- Inventory — standalone
- Laboratory group:
  - Operations
  - Intelligence

Scan Item was removed from the sidebar and moved into the TopBar.

Relevant commits:

- `6f145b267127dafee0f1beef8e11529423f5ad6c`
- `e98d5ea481a8705749320fc8d6b29a78ed1557e2`
- `1bc19c91d143692400d0bf72dd0c15f9b478ab1`

The user does not want broad accidental layout changes.

A previous icon change broke the page because `TreasureChest` was not exported; it was corrected by using `Library`.

Do not move the right activity rail/sidebar to the left or otherwise restructure the main layout unless specifically requested.

Project descriptions were previously given truncation/ellipsis treatment.

---

<a id="source-labos_v1_architecture_and_release_plan--18-resource-viewer-media-ui-decisions"></a>
### 18. Resource Viewer / Media UI Decisions

Resource viewer work exists in:

- `desktop/src/pages/ResourcesPage.tsx`
- `desktop/src/pages/ResourceViewerModal.tsx`
- `desktop/src/pages/ResourceViewerModalLocal.tsx`

The local viewer wrapper is intended to route downloaded video playback through local media endpoints rather than the original external URL.

A split-view resizer was previously fixed using pointer events.

Recent resizer commit:

```
2907adc47b61a0eb829311eb1067857ad5df820e
```

Do not claim this is fully verified until tested.

The user also previously wanted a small collapsed-style editing tool sidebar inside the editor; this remains a possible UI task, but is not a blocker for the current architecture work.

---

<a id="source-labos_v1_architecture_and_release_plan--19-release-history-current-release-status"></a>
### 19. Release History / Current Release Status

The existing version:

```
2.2.1
```

was a development/test build and should **not** now be treated as the final V1 architecture.

Existing version locations:

- `desktop/package.json`
- `backend/package.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/Cargo.toml`

Production and Preview identifiers are separated.

Production:

```
com.lab-inventory.app
```

Preview:

```
com.lab-inventory.app.preview
```

Preview product name:

```
LabOS Preview
```

Production product name remains the production LabOS application identity.

---

<a id="source-labos_v1_architecture_and_release_plan--20-existing-release-workflow"></a>
### 20. Existing Release Workflow

Release workflow:

```
.github/workflows/release.yml
```

Relevant commit:

```
2c05370
```

It is intended to:

- trigger on `v*.*.*` tags
- validate versions
- install desktop dependencies
- build Tauri
- collect MSI/EXE installers
- generate SHA-256 checksums
- create/update GitHub Release

No final V1 tag/release should be created yet.

---

<a id="source-labos_v1_architecture_and_release_plan--21-existing-installer-state"></a>
### 21. Existing Installer State

Production and Preview 2.2.1 installers were previously built successfully.

Production:

```
Lab Inventory_2.2.1_x64_en-US.msi
Lab Inventory_2.2.1_x64-setup.exe
```

Preview:

```
LabOS Preview_2.2.1_x64_en-US.msi
LabOS Preview_2.2.1_x64-setup.exe
```

The user was previously given a PowerShell script to move the NSIS installers into Downloads.

The release cleanup plan was:

1. uninstall old Production/Preview installations
2. stop local backend processes
3. remove old installers from Downloads
4. do not immediately delete AppData/SQLite
5. identify which databases are:
   - real-use Production
   - Preview
   - old regression/test
6. preserve regression/test data
7. only then prepare the fresh V1 installer

This cleanup was not confirmed complete at the point of this handoff.

---

<a id="source-labos_v1_architecture_and_release_plan--22-v1-release-gate"></a>
### 22. V1 Release Gate

Do not release V1 until all of these are true.

<a id="source-labos_v1_architecture_and_release_plan--architecture"></a>
#### Architecture

- local backend/runtime exists
- local SQLite is authoritative for local V1 operations
- central backend/PostgreSQL is separate
- central API is not required for ordinary offline operation
- central-only media processing remains central
- sync boundary is explicit

<a id="source-labos_v1_architecture_and_release_plan--local-runtime"></a>
#### Local Runtime

- inventory verified
- projects verified
- notes verified
- knowledge verified
- resources verified
- locations verified
- search verified
- local auth/bootstrap verified

<a id="source-labos_v1_architecture_and_release_plan--sync-1"></a>
#### Sync

- local outbox verified
- push verified
- pull verified
- retries verified
- reconnect verified
- conflict storage verified
- conflict resolution verified
- idempotency verified
- tombstones verified

<a id="source-labos_v1_architecture_and_release_plan--fresh-database"></a>
#### Fresh Database

- first launch creates fresh DB
- migrations run correctly
- baseline/system seed works
- one admin is seeded securely
- no development/test data appears

<a id="source-labos_v1_architecture_and_release_plan--productionpreview"></a>
#### Production/Preview

- distinct application identities
- distinct local data directories
- Production cannot accidentally use Preview data
- Preview cannot accidentally use Production data

<a id="source-labos_v1_architecture_and_release_plan--media-1"></a>
#### Media

- central yt-dlp works
- central FFmpeg works
- downloads are stored/processed centrally
- downloaded video playback never falls back to the original external URL

<a id="source-labos_v1_architecture_and_release_plan--build"></a>
#### Build

At minimum:

- TypeScript build
- Vite build
- Rust/Tauri build
- backend syntax/runtime checks
- local runtime smoke tests
- sync smoke tests
- fresh database smoke test
- Production installer build
- Preview installer build

Only after this should a V1 release tag be created.

---

<a id="source-labos_v1_architecture_and_release_plan--23-known-technical-risks-cleanup-items"></a>
### 23. Known Technical Risks / Cleanup Items

Before V1, explicitly review:

1. Local project JSON state vs normalized SQLite tables.
2. Local project outbox payload compatibility with central sync.
3. Local project identity/owner ID.
4. Local knowledge API transformations.
5. Local location `item_count` accuracy.
6. Resource JSON state vs normalized tables.
7. Resource sync mapping.
8. Local resource file storage strategy.
9. Authentication/bootstrap.
10. Search local implementation.
11. Central/local classification of every backend route.
12. Excel import ownership.
13. Finance/funding ownership.
14. Reports ownership.
15. Automation ownership.
16. Engineering/operations/system route ownership.
17. Assistant data/tool ownership.
18. Collaboration being clearly non-V1.
19. Media/download ownership.
20. Local and central API failure behavior.
21. Offline session behavior.
22. Fresh database seed behavior.
23. Production/Preview data isolation.
24. Full build/test verification.

---

<a id="source-labos_v1_architecture_and_release_plan--24-previous-reliability-work"></a>
### 24. Previous Reliability Work

Important existing reliability commits include:

- `daeb15923a6d226219e3e13fb50677a1dc14fa7a` — local movement validation
- `7ef64c91b0167c1f53fbf1b782ee751ac82da378` — expose inventory adjustment
- `9edb5bb68dd2223982d01e8387eb1b07e3dd3` — server-side stale offline item updates
- `0705cdfb2d585f1b6b70382f953ddfef1763bc75` — server pull/tombstone reconciliation
- `a338b0a00cdfd60e8a2f36b7eb24cb2a50a92ccb` — conflict/reconciliation UX
- `ba068a35c54d221dc2e11e2d665b33229b3b9096` — explicit local conflict resolution retry
- `bceef46b0a31e1ca79f020caf64768945d13e7da` — local actionable conflict resolution
- `deb177194fc03f5460c9aaec337fa6d9a6a36ed0` — TopBar SyncStatus
- `bea005d1e65e2d8b919e40c16675ba34a6b743d7` — restore sync error state
- `76ddeca` — automatic sync retry backoff
- `d1ead5e` — manual retry override
- `6c64e2d` — reconnect recovery
- `95eeec56250043999ba77fbf00ffcc910605d1f4` — sync reliability checks
- `657ca50ceb74d97d9c7d3b92d2d044e3b1588a21` — static sync reliability coverage

Admin permission fix:

```
63360519a737e71984aa4c14de0dd98cb8cb5ec49
```

This ensures the admin role receives its complete baseline permissions and per-user deny overrides cannot strip the admin baseline.

---

<a id="source-labos_v1_architecture_and_release_plan--25-current-implementation-sequence"></a>
### 25. Current Implementation Sequence

The recommended sequence from this point is:

<a id="source-labos_v1_architecture_and_release_plan--phase-a-finish-local-core-ownership"></a>
#### Phase A — Finish local core ownership

1. Review/fix Resources local implementation.
2. Fix local resource sync representation.
3. Decide normalized vs JSON local resource storage.
4. Fix Locations/item-count relationship.
5. Implement local Search.
6. Audit Projects/Notes/Knowledge API transformations.
7. Identify every remaining central-only function.

<a id="source-labos_v1_architecture_and_release_plan--phase-b-local-identitybootstrap"></a>
#### Phase B — Local identity/bootstrap

8. Implement local single-user authentication.
9. Implement fresh DB bootstrap.
10. Seed baseline/system data.
11. Seed secure initial administrator.
12. Make startup/session validation local.
13. Ensure offline login.

<a id="source-labos_v1_architecture_and_release_plan--phase-c-central-boundary"></a>
#### Phase C — Central boundary

14. Audit every backend route.
15. Mark local / central / hybrid / future.
16. Remove accidental PostgreSQL dependencies from local workflows.
17. Keep media/download processing central.
18. Keep cross-workstation/global functionality central.

<a id="source-labos_v1_architecture_and_release_plan--phase-d-sync-completion"></a>
#### Phase D — Sync completion

19. Define sync entity types.
20. Map local project/note/knowledge/resource/location changes to the central sync protocol.
21. Verify outbox payload compatibility.
22. Verify server application.
23. Verify pull reconciliation.
24. Verify conflicts.
25. Verify tombstones.
26. Verify retries/idempotency.

<a id="source-labos_v1_architecture_and_release_plan--phase-e-testing"></a>
#### Phase E — Testing

27. Build Rust/Tauri.
28. Build TypeScript/Vite.
29. Check backend.
30. Test fresh local DB.
31. Test offline local workflows.
32. Test reconnect.
33. Test sync.
34. Test conflicts.
35. Test media boundary.
36. Test Production/Preview isolation.

<a id="source-labos_v1_architecture_and_release_plan--phase-f-release"></a>
#### Phase F — Release

37. Clean up old installations.
38. Preserve regression DBs.
39. Update version.
40. Build Production.
41. Build Preview.
42. Run final smoke tests.
43. Tag V1.
44. Let release workflow publish installers/checksums.
45. Verify installation on a clean machine/profile.

---

<a id="source-labos_v1_architecture_and_release_plan--26-what-not-to-do"></a>
### 26. What Not To Do

Do not:

- replace PostgreSQL with SQLite
- connect the desktop directly to PostgreSQL
- make PostgreSQL required for offline/local operations
- duplicate central media processing unnecessarily
- delete development/test databases blindly
- release 2.2.1 as if it were the final V1
- tag a final V1 before local backend/bootstrap verification
- assume all existing backend routes should become local
- perform broad UI rewrites while architecture work is underway
- move existing UI rails/sidebar positions accidentally
- claim builds/tests passed without actually running them

---

<a id="source-labos_v1_architecture_and_release_plan--27-working-rules-for-the-next-chat"></a>
### 27. Working Rules For The Next Chat

The user has explicitly authorized GitHub work on:

```
Bonsinnoba/lab-inventory-app
```

Work directly on:

```
main
```

Do not create or switch to another branch unless the user explicitly asks.

The user generally prefers direct implementation and often uses:

> “go”

When they say “go”, proceed with the next agreed implementation step rather than returning a long plan.

For significant architectural changes:

- inspect the existing implementation first
- make focused changes
- commit to `main`
- report the commit
- test/build when appropriate
- never claim verification that was not performed

---

<a id="source-labos_v1_architecture_and_release_plan--28-immediate-next-step"></a>
### 28. Immediate Next Step

The next recommended work after this handoff is:

**Finish and verify the local-first Resources implementation, then implement local Search, followed by local single-user authentication/bootstrap.**

Before continuing too far, build/test the current local runtime because several local modules have been added without a full Rust/TypeScript build verification.

The highest-priority architectural blocker for final V1 remains:

```
Desktop
   ↓
Local Backend
   ↓
SQLite
```

must be a real, verified runtime boundary rather than merely a collection of Tauri command wrappers.

The central system remains:

```
Local Backend
   ↓
Central Backend
   ↓
PostgreSQL
   ↓
Sync + media + global services
```

That separation is the foundation of the final LabOS V1 release.

---

<a id="source-docslabos_five_phase_completion"></a>
## LabOS — five-phase completion ledger

Original source: `docs/LABOS_FIVE_PHASE_COMPLETION.md`. Retained historical scope/status.

<a id="source-docslabos_five_phase_completion--labos-five-phase-completion-ledger"></a>
### LabOS — five-phase completion ledger

The historical work and evidence below remain valid. The remaining work is
now regrouped into exactly three execution phases in
`docs/audits/THREE_PHASE_REMAINING_WORK_PLAN.md`; use that document for the
forward schedule and this ledger for prior implementation history.

Status as of 2026-09-27. The calculator redesign is owned by the user's collaborator; do not replace it or implement a competing UI. When delivered, integrate the approved redesign into existing LabOS calculation, persistence, permission, and desktop workflows during Phase 4 (or earlier only if required by a dependency).

<a id="source-docslabos_five_phase_completion--working-rules"></a>
#### Working rules
- Execute in phase order. A phase is complete only after implementation, automated tests, real-environment evidence where required, documented decisions, and independent Codex review.
- Commit on main as authorized; preserve desktop SQLite → authenticated sync/outbox → backend API → PostgreSQL. No desktop-to-PostgreSQL connection.
- Report exact CI run URLs, test commands and outcomes. Never treat an earlier green run as verification of later commits. Record unresolved failures, including the owner's report that most, not all, checks passed.
- Ordinary lab-wide read access applies to active members across projects; financial, audit, and administrative data remain separately gated. Project writes still require existing edit/membership checks.

<a id="source-docslabos_five_phase_completion--phase-1-security-permissions-and-financial-integrity"></a>
#### Phase 1 — Security, permissions, and financial integrity
Scope: enumerate every financial API, import/export, report, assistant tool, cost-bearing inventory projection, sync response, and mutation echo. Fix permission bypasses, inference through filters, unknown-column leaks, and project-write authorization. Test disabled users, lab-wide ordinary reads, and standard/sensitive finance combinations.
Acceptance: route-level and assistant regression tests for each exposed surface; no known financial leak; independent review. Status: IN PROGRESS. Existing projection and summary fixes landed, but remaining surfaces and current CI failures are unverified.

<a id="source-docslabos_five_phase_completion--phase-2-postgresql-integration-and-data-integrity"></a>
#### Phase 2 — PostgreSQL integration and data integrity
Scope: clean migrations, seeded role matrix, real HTTP integration, transactional rollback, constraints, concurrency, and schema-to-query compatibility. Acceptance: repeatable passing real PostgreSQL test suite with recorded CI evidence. Status: NOT STARTED.

<a id="source-docslabos_five_phase_completion--phase-3-offline-first-desktop-and-synchronization"></a>
#### Phase 3 — Offline-first desktop and synchronization
Scope: SQLite/outbox durability, duplicate replay, interruptions, offline restart, two-client conflicts, permission changes and reconciliation. Acceptance: repeatable multi-client offline-to-online test suite with no unauthorized sync or lost/duplicated writes. Status: FOUNDATION EXISTS; FULL VERIFICATION PENDING.

<a id="source-docslabos_five_phase_completion--phase-4-context-intelligence-and-laboratory-tools"></a>
#### Phase 4 — Context Intelligence and laboratory tools
Scope: evidence-linked retrieval, cross-project context, assistant permissions, provenance, context limits, injection defenses, and integration of the collaborator-approved calculator redesign. Do not redesign the calculator without the approved files and integration contract. Acceptance: end-to-end assistant and calculator workflow tests. Status: CONTEXT FOUNDATION EXISTS; CALCULATOR INTEGRATION AWAITS APPROVED REDESIGN.

<a id="source-docslabos_five_phase_completion--phase-5-uiux-and-release-hardening"></a>
#### Phase 5 — UI/UX and release hardening
Scope: full UI audit, empty/loading/error states, offline indicators, finance field omission, desktop packaging, backup/restore, deployment, documentation and final Codex review. Acceptance: full CI and documented user acceptance on supported desktop environments. Status: NOT STARTED.

<a id="source-docslabos_five_phase_completion--immediate-phase-1-verification-queue"></a>
#### Immediate Phase 1 verification queue
1. Retrieve the failing job logs from the owner's latest CI run and reproduce; avoid declaring all checks passed.
2. Verify actual PostgreSQL transactions schema against explicit standard SELECT fields, including updated_at.
3. Add HTTP role-matrix tests for transaction list/summary, budget-period filters, mutation echoes, assistant financial summary, reports overview and disabled accounts.
4. Audit remaining import/export endpoints and financial side channels; record every route examined and decisions made.
5. Ask Codex to independently reproduce tests and document all findings before closing Phase 1.

<a id="source-docslabos_five_phase_completion--phase-1-execution-record-2026-09-27"></a>
##### Phase 1 execution record — 2026-09-27
- Inspected backend/src/schema.sql: base transactions table defines created_at but does not define updated_at. Removed the unverified t.updated_at reference from standard transaction SELECT in commit 011fc09. Full migration inventory still needs confirmation; the query now works without that optional column.
- Finance GET list and summary now reuse req.permissions from hasPermission middleware rather than performing an independent override read after the middleware active-account check (commit 50929f0). Both grants are still required for sensitive finance.
- Neither change is verified by fresh CI or real PostgreSQL integration at time of writing. Obtain actual failed-job logs and run security baseline, backend syntax check and PostgreSQL route tests. Do not close Phase 1 prematurely.

<a id="source-docslabos_five_phase_completion--consolidated-phase-1-audit-pass-2026-09-27"></a>
##### Consolidated Phase 1 audit pass — 2026-09-27
Implemented on main:
- d31a202: global search removes project budget from ordinary search results, expands ordinary cross-project search, and limits standard financial search to expenses.
- 98ff54a: corrects contiguous SQL parameters for sensitive financial search.
- 0b60ea3: full transaction Excel export now requires both financial read grants.
- 3674a50: detailed bulk-purchase Excel export now requires both financial read grants.
- d624972 and e29019f: funding-source and budget-period GET routes now require both financial read grants.
- 3111086: finance sync pull applies transaction projection and suppresses sensitive deletion tombstones for standard viewers; project sync pull includes all ordinary projects and applies financial projection.
- 9b50a05: project sync budget mutations require finance.edit, unauthorized owner assignment is rejected, and income sync changes require both financial read grants.
- 6b929cb: sync mutation responses (including replayed idempotency responses) project finance-sensitive data by caller permissions.
- 36ec32e and 1cc9578: additional projection and source-invariant regression tests.

Evidence and remaining acceptance gaps:
- Source inspection confirmed authenticateToken checks current database is_active and role on every request; this is not a substitute for HTTP role-matrix tests.
- Source-level checks added, but no fresh GitHub Actions run results, local npm installation, or real PostgreSQL integration results were accessible from this session. CI status must remain UNVERIFIED. No independent Codex execution was available; Codex must review this commit set.
- Review all remaining inventory, operations, context, reports and engineering endpoints for financial side channels, and review offline sync desktop compatibility with newly projected fields. Verify legacy idempotency replay behavior and financial Excel import transactional audit logging.
- The full five-phase plan remains sequential. Phase 1 is NOT COMPLETE until the above acceptance gaps are closed with evidence.

<a id="source-docslabos_five_phase_completion--phase-2-postgresql-integration-kickoff-2026-09-27"></a>
##### Phase 2 PostgreSQL integration kickoff (2026-09-27)
Owner confirms previous checks passed. Added opt-in real database integration test (dd14fc4), PostgreSQL 16 CI migration and idempotent replay job (afae8f5), and rollback/concurrent-session checks (6830467). Fresh CI evidence and independent Codex review remain pending. Next: seeded authenticated HTTP role matrix, legacy migration upgrades, and multi-client conflict tests. Phase 2 remains in progress.

<a id="source-docslabos_five_phase_completion--consolidated-implementation-deferred-owner-acceptance-2026-09-27"></a>
##### Consolidated implementation / deferred owner acceptance (2026-09-27)
Owner requests implementation across all five phases before one final manual acceptance round. Continue adding automated tests and CI checks during implementation; do not pause for owner-run tests after each phase. This changes the testing schedule, not the evidence standard: unrun tests and independent reviews must remain explicitly pending.
- Phase 2: 688cc80 adds real PostgreSQL CHECK/FK constraint and savepoint recovery probes.
- Phase 3: c8c3d90 binds idempotency replays to user, device, entity type and operation, including unique-violation race recovery, and projects replay responses by current permissions.
- Phase 4: calculator redesign integration is BLOCKED on collaborator-approved code/design handoff; preserve existing calculator in the meantime. Context intelligence can progress independently.
- Phase 5: prepare release verification and final owner acceptance checklist once implementation is ready. No phase may be represented as tested or released solely because code was committed.

<a id="source-docslabos_five_phase_completion--additional-cross-phase-implementation-2026-09-27"></a>
##### Additional cross-phase implementation (2026-09-27)
- a37ba3a: security regression suite runs in primary CI workflow as well as dedicated security workflow.
- 746c6a9 and 47a65ce: project context now includes per-section stable source references and regression coverage; remains a bounded non-atomic snapshot, not a complete knowledge graph.
- ae2bd91: consolidated final release/restore/manual acceptance checklist and calculator integration contract.
- Owner will supply collaborator-approved calculator files after the surrounding work; approved redesign integration and its end-to-end tests remain pending until supplied.
- No claim of full five-phase completion: fresh CI run results, comprehensive multi-client testing, final UI audit, restore/installer exercise, calculator integration and independent Codex review have not been evidenced in this session.

<a id="source-docslabos_five_phase_completion--labcalc-implementation-on-main-2026-09-27"></a>
##### LabCalc implementation on main (2026-09-27)
- 22cab44: expanded electronics panel with ten calculation modes, client-side calculations and input guards.
- 827a265: Engineering Tools now uses LabCalc panel; project-note, notebook, BOM and clipboard actions use existing desktop API paths (and their local-first fallbacks where implemented).
- 2c56f95 and 1ab7046: draggable minimized bar shows latest result; remove unused callback.
- IMPORTANT: This is a functional integration inspired by the approved bundle, **not yet a verbatim installation of all six collaborator source files**. Full fidelity to the collaborator's MiniResultBar, InsertActions, E-series, inventory suggestions and source math needs a follow-up source import. Do not label approved-design integration complete until that import and visual review are evidenced.
- Fresh desktop TypeScript/Vite CI and manual acceptance are pending; no passing result has been observed for these commits.

<a id="source-docslabos_five_phase_completion--labcalc-follow-up-on-main-2026-09-27"></a>
##### LabCalc follow-up on main (2026-09-27)
- 4c3ff3d, e83f067: E-series helper and offline stock-aware resistor matching.
- 23f9e88, d8468be: LabCalc-style mini result bar and structured insertion controls.
- 4a16e1d: wire mini bar, insert controls and local-first inventory E24 suggestions to Engineering Tools.
- Scope: these files reproduce the supplied bundle's intended UI and behaviors but are not byte-identical imports of all supplied original files; the current electronics panel remains the earlier integrated implementation. Full source-fidelity comparison and desktop build remain pending. GitHub combined commit status returned no status checks for 4a16e1d at time of query; this is not a passing CI result.

<a id="source-docslabos_five_phase_completion--labcalc-visual-refinement-against-collaborator-design-specification-v10-2026-09-27"></a>
##### LabCalc visual refinement against collaborator design specification v1.0 (2026-09-27)
- 3d9ddff: searchable category-based electronics toolbox, active-tool cards, expandable formula/assumption panel, reset, refined responsive spacing and controls.
- Remaining: actual dual-size interactive mini calculator (current mini remains result-only), docking/resizing/persistence, expanded near-fullscreen shell, live calculation, unit selectors, accessibility/focus testing, 4/5/6-band visualizer, advanced tool breadth, high-fidelity mockups and consolidated desktop build. Do not claim full spec acceptance.

<a id="source-docslabos_five_phase_completion--labcalc-follow-up-for-owner-test-2026-09-27"></a>
##### LabCalc follow-up for owner test (2026-09-27)
- 5e549c1: floating calculator now renders actual active tool and quick tool switcher, rather than a result-only bar.
- 2a92259: expanded workspace defaults to ~92% width/88% height; floating position persists in localStorage.
- 5077bce and fbeeae2: selected electronics mode persists; inputs reset when switching modes to avoid cross-mode stale data.
- Owner test still needed: TypeScript/Vite build, desktop launch, drag/restore and calculator input, notebook/project/BOM permissions, offline/restart behavior. Unimplemented specification details include mini resizing/docking, spring transition, full live calculation/unit selectors and advanced tool breadth. Do not claim full v1 design-spec completion without implementing and testing those.

<a id="source-docslabos_five_phase_completion--floating-labcalc-screenshot-remediation-2026-09-27"></a>
##### Floating LabCalc screenshot remediation (2026-09-27)
- Screenshot showed the floating scientific calculator clipped at ~400px height and the keypad/footer scrolled below the visible widget.
- 1fae787 and 5982df8: floating calculator defaults to 90% of viewport height, has independent scrollable content and a bottom-right pointer resize handle (320px minimum width, 240px minimum height), and persists resized dimensions in localStorage. Initial position is clamped against tall viewport size rather than prior 400px size.
- Desktop build and owner visual/interaction tests are pending; edge docking, keyboard-operated resizing and automatic compact-mode layout remain outside this change.

<a id="source-docslabos_five_phase_completion--labcalc-floating-viewport-and-restore-fix-2026-09-27"></a>
##### LabCalc floating viewport and restore fix (2026-09-27)
- d28d858: fixed root cause of expand button not restoring: App previously passed an onMinimize callback that ignored the requested boolean and always set minimized=true; now passes the state setter.
- f5ad8ee: floating panel defaults to 98vh within 8px viewport margins; drag starts from the header only, leaving interactive content scrollable and editable.
- 59ff6d3: versioned floating size storage v2 so old 400px saved height does not suppress the new default; users can resize and persist their new preferred size.
- Await owner TypeScript/Vite build and desktop drag/resize/minimize/restore checks; do not mark verified until results arrive.

<a id="source-docslabos_five_phase_completion--app-wide-horizontal-overflow-and-engineering-tools-layering-2026-09-27"></a>
##### App-wide horizontal overflow and Engineering Tools layering (2026-09-27)
- Owner screenshots show horizontal movement exposing overlapping left navigation and Engineering Tools panel.
- 5b185a5: constrain app shell to viewport width and clip horizontal overflow in main page scroller while retaining vertical scroll.
- 6710000: elevate both expanded and floating Engineering Tools above sidebar/navigation stacking layers.
- Verify on desktop: horizontal trackpad/shift-wheel on dashboard, sidebar and Engineering Tools; ensure sidebar never overlays calculator, page scroll remains usable and no page content is unintentionally clipped. No verified build/visual acceptance yet.

<a id="source-docslabos_five_phase_completion--global-vertical-and-horizontal-shell-scroll-remediation-2026-09-27"></a>
##### Global vertical and horizontal shell scroll remediation (2026-09-27)
- Screenshot demonstrates entire app shell moving vertically: topbar partially outside viewport and empty area at bottom. Earlier overflow-x clipping was insufficient.
- 1b64c1c: lock html/body/#root and app-shell to viewport in both axes, enforce min-height:0 on flex scroll containers, and isolate sidebar/page overscroll.
- 22df9af: app shell uses bounded h-full/overflow-hidden; main content uses min-h-0 with internal vertical scroll.
- Verify scrolling over dashboard, sidebar, assistant, and horizontal trackpad input; topbar/sidebar must remain anchored and content must not be clipped. Build and visual acceptance remain unverified.

<a id="source-docslabos_five_phase_completion--scientific-calculator-equation-solver-2026-09-27"></a>
##### Scientific calculator equation solver (2026-09-27)
- Added pure offline 2x2 and 3x3 simultaneous linear equation solver with partial pivoting and classification of unique, inconsistent and dependent systems; added quadratic solver with real/repeated/complex roots, linear-degenerate handling and vertex.
- Added compact Equation Solver tab inside scientific calculator with coefficient entry, solution display and integration with existing 20-entry Questions & Answers pin panel.
- Scoped global scientific keyboard shortcuts to keypad mode and non-editable targets to prevent interference with equation coefficient inputs.
- Owner verification pending: TypeScript/Vite build, 2x2/3x3 unique solutions, dependent/inconsistent cases, quadratic positive/zero/negative discriminants, mobile-sized layout and pinning solutions. Do not mark verified until run.

---

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan"></a>
## LabOS Self-Hosted Backend & Remote Mobile Access

Original source: `docs/LABOS_SELF_HOSTED_BACKEND_REMOTE_MOBILE_ACCESS_PLAN.md`. Retained historical scope/status.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--labos-self-hosted-backend-remote-mobile-access"></a>
### LabOS Self-Hosted Backend & Remote Mobile Access
<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--independent-architecture-assessment-and-implementation-planning-mandate"></a>
#### Independent Architecture Assessment and Implementation Planning Mandate

**Repository:** `Bonsinnoba/lab-inventory-app`
**Branch:** `main`
**Phase:** Research, architecture assessment, and implementation planning
**Implementation authorization:** Not yet granted for this task

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--1-objective"></a>
#### 1. Objective

Independently investigate how to evolve LabOS to support a self-hosted central backend inside the laboratory while allowing authorized users to access LabOS remotely through mobile phones over the internet.

The objective is to make LabOS operationally independent of the internet for normal laboratory workstation operations, while providing secure internet-based remote access when connectivity is available.

Do not assume that the current architecture already satisfies these requirements. Inspect the actual codebase, deployment configuration, database migrations, authentication system, and synchronization implementation before making recommendations.

Your responsibility at this stage is to produce a technically sound, evidence-based implementation plan tailored to the existing application.

**Do not begin implementation until the assessment and proposed plan have been documented.**

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--2-required-operating-model"></a>
#### 2. Required Operating Model

The proposed architecture must address the following requirements.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--a-self-hosted-central-backend"></a>
##### A. Self-hosted central backend

The laboratory must be able to host its central backend on equipment under its own control.

The assessment must consider:

- PostgreSQL running on a laboratory-owned server.
- The LabOS backend API running on that server.
- Access from laboratory workstations through the local network.
- Reliable startup and recovery after a server restart.
- Persistent database storage.
- Database backups and restoration.
- Appropriate security and administrative controls.

Determine the practical server and operating-system requirements from the application's actual needs. Do not prescribe hardware specifications without a supporting rationale.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--b-internet-independent-laboratory-operations"></a>
##### B. Internet-independent laboratory operations

When the laboratory loses its internet connection but its local network and server remain operational:

- Laboratory workstations must still be able to reach the central LabOS API.
- Workstations must be able to access shared central data through the normal application backend.
- Authorized users must continue using supported laboratory functions.
- Central database operations must not depend on an external cloud database being reachable.
- Local SQLite and the synchronization outbox must continue supporting their intended offline capabilities.

Identify all current dependencies that could prevent these outcomes.

Do not assume that every feature works offline merely because PostgreSQL is hosted locally.

For example, investigate dependencies on external authentication providers, AI services, file storage, external APIs, remote resource providers, and other cloud services.

Document which functions can operate without internet access and which require additional work.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--c-remote-mobile-access"></a>
##### C. Remote mobile access

Authorized users must be able to access LabOS from outside the laboratory using their mobile phones and an internet connection.

The intended experience should support a mobile-friendly interface, preferably through the existing web application or an appropriately designed Progressive Web App if the assessment establishes that this is suitable.

The investigation must cover:

- Secure access through a stable web address or another justified access mechanism.
- Authentication for remote users.
- Server-side authorization and permission enforcement.
- HTTPS and secure session management.
- Revocation of access for disabled users and lost devices.
- Mobile usability.
- Protection against unauthorized access to laboratory and financial information.

Remote access is expected to work when the laboratory's internet connection is available.

**Remote access during a complete laboratory internet outage is not a requirement for this phase.**

Do not introduce a separate cloud database simply to address an outage scenario that is outside the agreed scope.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--d-one-authoritative-central-database"></a>
##### D. One authoritative central database

The intended starting point is one authoritative PostgreSQL database hosted inside the laboratory.

The plan must preserve the existing architecture:

**Desktop application → local SQLite and synchronization outbox → LabOS API → PostgreSQL.**

The desktop application must not connect directly to PostgreSQL.

The assessment must establish how local workstation access and remote mobile access can use the same backend safely.

Do not propose two independently writable central databases unless you can demonstrate a concrete requirement that makes them necessary and present the resulting consistency, conflict-resolution, security, and operational implications.

Optional off-site backups or disaster-recovery capabilities may be considered separately from the authoritative database.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--3-independently-investigate-the-existing-codebase"></a>
#### 3. Independently Investigate the Existing Codebase

Inspect the repository thoroughly before proposing changes.

At minimum, investigate the following areas.

| Area | Questions to answer |
|---|---|
| PostgreSQL | How is the database connection configured? Are credentials and connection settings environment-driven? |
| Backend API | Which host and port does the server bind to? Can it serve local-network clients securely? |
| Desktop application | How does it determine the API endpoint? Is the current configuration tied to a remote environment? |
| SQLite | Which data and operations are available locally? Which still require the backend? |
| Synchronization | How are queued changes delivered, retried, deduplicated, and reconciled? |
| Authentication | Does login require an external provider? Can users authenticate when the laboratory has no internet? |
| Authorization | Are permissions enforced on the server for every protected operation? |
| Finance and sensitive data | Are existing finance-specific permission boundaries preserved for mobile access? |
| File storage | Where are uploaded documents, thumbnails, and other resources stored? |
| AI and integrations | Which functions depend on external services? |
| Deployment | How is the backend currently hosted, started, upgraded, and configured? |
| Backups | What backup mechanisms exist, and has restoration been tested? |
| Mobile interface | Which existing pages and workflows are usable on mobile, and what needs improvement? |
| Networking | What local-network and remote-access configuration would be required? |

These are investigation requirements, not assumptions that the features are missing.

For each finding, identify the relevant files, configuration, migrations, functions, or other repository evidence.

Distinguish clearly between:

1. Existing and verified capabilities.
2. Existing capabilities that have not been adequately tested.
3. Identified deficiencies.
4. Proposed future work.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--4-independently-research-the-infrastructure-options"></a>
#### 4. Independently Research the Infrastructure Options

Research the available deployment and networking options rather than automatically adopting the first suggested technology.

Evaluate appropriate options for:

- Self-hosting PostgreSQL and the LabOS API.
- Providing secure remote access to the API.
- Local-network access and address management.
- Authentication and remote-access protection.
- Backup storage and disaster recovery.
- Service monitoring and restart behavior.
- Secure application updates and database migrations.

A secure tunnel, VPN, or another suitable approach may be considered where relevant.

Compare the options against the actual LabOS requirements, operational complexity, security, cost, reliability, and maintenance burden.

Use current primary documentation where possible.

Do not select a technology solely because it is popular or easy to deploy. Explain why the recommended approach fits the existing system and identify its limitations.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--5-security-requirements"></a>
#### 5. Security Requirements

The plan must address security across both local and remote access.

In particular:

- PostgreSQL must not be exposed directly to the public internet.
- Remote users must authenticate through an appropriate mechanism.
- Protected operations must enforce authorization on the server.
- Existing role and permission boundaries must remain intact.
- Financially sensitive information must retain its existing access restrictions.
- Disabled users must not retain access.
- Secrets must not be embedded in frontend code or committed to the repository.
- Remote connections must use appropriate transport security.
- Database and API administrative interfaces must not be unintentionally exposed.
- Important actions should be auditable.
- Backups must be protected from unauthorized access.
- Recovery procedures must be documented and tested.

Consider the consequences of a compromised mobile device or a compromised user account.

Do not weaken existing security controls to make local or remote connectivity easier.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--6-reliability-and-data-integrity"></a>
#### 6. Reliability and Data Integrity

The plan must establish how the system behaves when:

- The laboratory loses internet connectivity.
- A workstation temporarily disconnects from the local network.
- The backend service restarts.
- PostgreSQL becomes temporarily unavailable.
- A workstation submits a change more than once.
- Synchronization is interrupted midway.
- Two workstations modify related records concurrently.
- A user loses permission while a workstation is offline.
- A database migration fails.
- A backup must be restored after server failure.

Pay particular attention to idempotency, transactional integrity, synchronization retries, conflict handling, and the possibility of data loss.

Do not claim that an operation is safe merely because it has an outbox or retry mechanism.

Identify the evidence needed to demonstrate that queued changes are applied correctly and that repeated requests do not create duplicate records or transactions.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--7-deployment-and-operational-requirements"></a>
#### 7. Deployment and Operational Requirements

Produce a deployment plan that an administrator can follow.

It should address:

- Server prerequisites.
- Installation and configuration.
- Database initialization or migration.
- Environment variables and secrets.
- Local-network access.
- Remote-access configuration.
- DNS or address management, where applicable.
- Firewall rules.
- Authentication configuration.
- Automated backups.
- Restoration testing.
- Monitoring and service recovery.
- Upgrade and rollback procedures.
- Workstation configuration.
- Troubleshooting and maintenance documentation.

Clearly separate what must be configured once on the server from what must be configured on each workstation or mobile device.

Identify any hardware, domain, connectivity, subscription, or third-party service requirements.

Do not assume the laboratory has a static public IP address or that its internet provider permits inbound connections. Evaluate the implications of those conditions.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--8-testing-and-acceptance-criteria"></a>
#### 8. Testing and Acceptance Criteria

Create a concrete acceptance-test matrix.

At minimum, include these scenarios:

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--local-network-operation"></a>
##### Local-network operation
- Two or more workstations can access the same central data.
- A change made on one workstation becomes visible to another through the central backend.
- Normal central operations continue when the internet connection is disconnected but the local network remains operational.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--remote-access"></a>
##### Remote access
- An authorized user can sign in from a phone using an external internet connection.
- The mobile interface works at common phone screen sizes.
- Unauthorized users cannot access protected data.
- Financial permissions remain enforced.
- Disabling a user or revoking their session prevents further access as designed.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--offline-operation-and-synchronization"></a>
##### Offline operation and synchronization
- A workstation can perform supported offline operations.
- Queued changes synchronize after connectivity returns.
- Repeated synchronization does not duplicate records or transactions.
- Interrupted synchronization recovers safely.
- Conflicts are handled according to documented rules.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--server-recovery"></a>
##### Server recovery
- The backend starts correctly after a server restart.
- PostgreSQL data survives the restart.
- A backup can be restored and the service brought back online.
- Failed upgrades have a documented recovery path.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--security"></a>
##### Security
- PostgreSQL is not publicly reachable.
- Only intended services are exposed.
- Secrets are not leaked to the client or repository.
- Authentication and authorization checks are exercised through actual API requests.

For each test, define:

- Preconditions.
- Test procedure.
- Expected outcome.
- Evidence to collect.
- Whether the test can be automated.
- Whether the result has actually been verified.

Do not mark a test as passed merely because the implementation looks correct.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--9-required-deliverables"></a>
#### 9. Required Deliverables

Before any implementation, produce the following documentation.

**Deliverable 1 — Existing Architecture Audit**

Document the current state, evidence, dependencies, gaps, and risks.

**Deliverable 2 — Architecture Proposal**

Describe the proposed deployment and request flows, including local desktop access and remote mobile access.

Include a clear explanation of the authoritative database and the role of SQLite and synchronization.

**Deliverable 3 — Technology Evaluation**

Compare the practical options for self-hosting, remote access, authentication, backups, and monitoring. Document the recommendation and the reasons behind it.

**Deliverable 4 — Implementation Roadmap**

Break the work into logical stages, identify dependencies, list the affected components, and define the completion criteria for each stage.

**Deliverable 5 — Security and Data-Integrity Assessment**

Document the relevant risks, mitigations, existing protections, and unresolved questions.

**Deliverable 6 — Acceptance-Test Plan**

Provide reproducible tests and expected results for local operation, remote access, synchronization, recovery, and security.

**Deliverable 7 — Operational Runbook Outline**

Explain how the eventual system should be installed, maintained, backed up, restored, updated, and troubleshot.

**Deliverable 8 — Decision Register**

Record important architectural decisions, the evidence supporting each recommendation, alternatives considered, trade-offs, and any assumptions that still require confirmation.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--10-working-rules-and-authorization"></a>
#### 10. Working Rules and Authorization

You have permission to investigate the repository and conduct the necessary technical research.

However, this assignment is currently **planning-only**.

- Do not implement the proposed infrastructure.
- Do not modify application behavior.
- Do not change the database architecture.
- Do not introduce new dependencies merely to explore an option.
- Do not change authentication or authorization behavior.
- Do not deploy services or expose the application to the internet.
- Do not make destructive changes to the database or repository.
- Do not claim that functionality has been tested when it has only been inspected.
- Do not silently resolve major architectural trade-offs without documenting them.

Work on `main` only if repository access is necessary for the audit, and avoid committing implementation changes during this planning phase.

Document all significant findings and decisions so that the plan can be independently reviewed before implementation is authorized.

If an essential operational requirement cannot be determined from the repository, state the uncertainty and explain what information is needed. Do not invent infrastructure details.

<a id="source-docslabos_self_hosted_backend_remote_mobile_access_plan--final-instruction"></a>
#### Final instruction

Approach this as an independent architecture and engineering assignment, not as a request to implement a predetermined design.

**Inspect first. Research independently. Document the evidence. Compare alternatives. Recommend a coherent architecture. Produce the complete implementation plan and acceptance criteria. Then stop and await authorization.**

The eventual outcome should be a LabOS deployment that supports reliable, shared laboratory operations without internet access, secure remote mobile access when internet connectivity is available, and recoverable, permission-controlled data management.

---

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09"></a>
## Additions and offline-read diagnosis — 2026-10-09

Original source: `docs/audits/PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md`. Retained historical scope/status.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--additions-and-offline-read-diagnosis-2026-10-09"></a>
### Additions and offline-read diagnosis — 2026-10-09

The initial checkpoint was planning/diagnosis only. The owner's subsequent “go”
approved the available-section contract below. Its first implementation is now
recorded in PHASE2_EVIDENCE.md; the other additions remain planned, not delivered.
Keep the existing three phases; expand Phases 2 and 3 rather than introduce another.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--initial-offline-diagnosis-before-the-first-implementation"></a>
#### Initial offline diagnosis (before the first implementation)

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

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--approved-offline-read-contract-and-implementation-boundary"></a>
##### Approved offline-read contract and implementation boundary

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

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--1-salvage-from-old-projects"></a>
#### 1. Salvage from old projects

Existing foundation: `20260924_inventory_acquisition.sql` and Add Item allow
`acquisition_method='salvaged'`, source and notes. Incoming `return` movements
exist. These do not provide a complete traceable project recovery workflow.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--phase-2-data-permissions-and-financial-effects"></a>
##### Phase 2: data, permissions and financial effects

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

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--phase-3-workflow"></a>
##### Phase 3: workflow

Project “Recover / salvage” flow, source/condition/quantity/destination review,
clear confirmation of stock and financial effects, provenance and consumption
views, and finance displays that separate recovery value from cash. Pending and
conflicted recoveries must remain visible without claiming stock is available.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--2-tts-and-media-priority"></a>
#### 2. TTS and media priority

Source evidence: AssistantChat emits global pause/resume events; MusicPlayer and
MusicDock use a single resume flag, not focus ownership/priority or gain ramps.
Notebook has its own speech lifecycle. Overlapping/stale completion can request
resume while another source needs focus. This is not yet a real-device audio test.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--phase-2-audio-focus-correctness"></a>
##### Phase 2: audio-focus correctness

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

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--phase-3-experience"></a>
##### Phase 3: experience

Tune audible transition duration and continuity; compact takeover indicators,
TTS controls, keyboard/focus and preference UI. Honour visual reduced-motion
settings. Verify on actual Windows audio hardware with music, lab video, TTS and
dictation; event-dispatch tests alone are not audible acceptance.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--3-assistant-as-a-permissioned-planning-partner"></a>
#### 3. Assistant as a permissioned planning partner

Current backend explicitly declares no write tools and returns `mode:'read-only'`
and `can_modify_data:false`. This is intentional current behaviour. New drafting
requires a real capability boundary, not merely changing a badge or system prompt.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--phase-2-drafting-approval-persistence-and-retry"></a>
##### Phase 2: drafting, approval, persistence and retry

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

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--phase-3-panel-and-composer"></a>
##### Phase 3: panel and composer

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

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--4-quantity-aware-assignment-and-custody-owner-addition-2026-10-10"></a>
#### 4. Quantity-aware assignment and custody (owner addition, 2026-10-10)

Status: approved scope; investigation and implementation remain pending. This
section records the requested behavior, not a claim that it already works.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--phase-2-responsibility-custody-and-stock-accounting"></a>
##### Phase 2: responsibility, custody and stock accounting

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

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--phase-3-custody-experience"></a>
##### Phase 3: custody experience

Present responsible person, issued-to quantities and outstanding returns clearly.
Show a readable custody history and source links to projects/work items. Keep
functional issue/return flows and their acceptance tests in Phase 2; Phase 3 adds
integrated presentation, accessibility and complete cross-workflow usability tests.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--5-interconnected-project-lifecycle-owner-addition-2026-10-10"></a>
#### 5. Interconnected project lifecycle (owner addition, 2026-10-10)

Status: end-to-end investigation required before changing project behavior. Treat
BOM, reservations, tasks, experiments, canvas, notes, resources and financial
projections as connected parts of the same project, not independent feature fixes.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--phase-2-relationship-and-behavior-audit-then-implementation"></a>
##### Phase 2: relationship and behavior audit, then implementation

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

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--phase-3-integrated-project-experience"></a>
##### Phase 3: integrated project experience

Connect project overview, BOM, reservations, tasks, experiments and canvas with
consistent navigation, statuses, quantity summaries and source/evidence links.
Make pending synchronization and conflicts visible at the affected relationship.
Test a complete user journey, including return/salvage and project closure, with
the assistant sidebar open. Data correctness and functional links remain Phase 2
requirements, not deferred cosmetic work.

<a id="source-docsauditsphase2_3_scope_additions_2026-10-09--sequencing-and-acceptance"></a>
#### Sequencing and acceptance

October 13 delivery reset: track these existing Phase 2 commitments under the
stable IDs in [PHASE2_DELIVERY_CHECKLIST.md](PLAN.md#source-docsauditsphase2_delivery_checklist), not a
separate growing backlog. Later October 10 phase-end cadence controls all older
per-fix references below; no required outage coverage is waived or moved to Phase 3.

October 10 cadence override: the owner approved implementation batches followed
by a full phase-end test sweep, failure collection, grouped fixes and full retest.
Quick build/critical safety checks remain during development. All references in
this supplement to per-fix stopped-API testing now mean required coverage in that
phase-end sweep, not an interruption after each fix. No coverage is waived.

Subsequent owner directive: offline authentication/security, full PC copies,
queued server intentions and **mandatory actual desktop tests with Docker API
stopped for every offline-related fix** are consolidated in
[PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md](PLAN.md#source-docsauditsphase2_offline_security_and_acceptance).
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

---

<a id="source-docsauditsphase2_offline_security_and_acceptance"></a>
## Phase 2: offline completeness, authentication and mandatory outage testing

Original source: `docs/audits/PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md`. Retained historical scope/status.

<a id="source-docsauditsphase2_offline_security_and_acceptance--phase-2-offline-completeness-authentication-and-mandatory-outage-testing"></a>
### Phase 2: offline completeness, authentication and mandatory outage testing

Remaining delivery/status is tracked in
[PHASE2_DELIVERY_CHECKLIST.md](PLAN.md#source-docsauditsphase2_delivery_checklist), approved October 13.
This document remains the detailed offline/security contract and acceptance
procedure, not a second expanding backlog. Follow the phase-end cadence below.

Owner directive: consolidate the October 9 offline/security discussion into
Phase 2. October 10 supersedes the original per-change testing cadence: batch
implementation, retaining quick build and critical safety checks, then run the
complete acceptance sweep at phase end. Collect independent failures before
batched repair and full regression; block only dependent tests unless a data-loss,
corruption or security risk requires stopping affected work. Real stopped-Docker
API desktop coverage remains required for all offline changes before sign-off.
This document is part of Phase 2, not a fourth phase. It supersedes earlier
wording that deferred all real desktop outage checks to Phase 3.

Status: planned/open unless supported by a dated PHASE2_EVIDENCE.md checkpoint.
Writing this plan does not implement or verify any of the changes below.

<a id="source-docsauditsphase2_offline_security_and_acceptance--required-behavior"></a>
#### Required behavior

- Every server record and server-held attached file that the account is authorized
  to access must have a synchronized PC copy, not metadata-only availability.
  Separate SQLite metadata from device file storage; replication includes
  thumbnails, attachment content and editor copies. External links alone are not
  downloaded content. Explicitly report incomplete transfers or storage failures.
- Read and work from local authorized data without requiring a server token.
  Local writes and outbox intents commit atomically with stable IDs and authorship.
- Authorized offline deletion hides/removes the local record immediately and
  persists a deletion intent for server replay; stale pulls must not resurrect it.
  File cleanup must respect other references, pending uploads and crash recovery.
- Permission-revocation eviction is local cleanup, NOT a server deletion request.
- Server execution may wait for reconnection without blocking local preparation.
  Distinguish pending intent, server acceptance and completed effect. Current
  server permissions and conflict checks still govern acceptance.
- Preserve the agreed 24-hour privileged and current 7-day ordinary offline
  leases. Missing data is unknown, not zero; local read time is not sync time.

<a id="source-docsauditsphase2_offline_security_and_acceptance--p2-a-repair-and-harden-offline-identitysecurity-first"></a>
#### P2-A — Repair and harden offline identity/security first

1. Unify desktop session identity around the central account ID. Keep the local
   credential-row ID internal. Repair offline login/restoration returning a local
   ID where callers expect a central ID, and the token-removal versus
   captureAccountSession token requirement. A valid native session must authorize
   local access independently of a server JWT. Track session generation/account
   changes to discard stale asynchronous reads, writes and acknowledgements.
2. Audit every native read/mutation and secondary projection for permission,
   account ownership, project/record visibility and lease checks. Preserve author
   ownership when switching users; another account cannot submit pending work.
   Test maintenance, catalogs, comments, notifications, preferences, inventory,
   resources and composite pages, not just the first failing screen.
3. Replace renderer-asserted authority in cache_server_user/cache_server_permissions
   with native-verified server authorization (authenticated native exchange or a
   signed, account/device-bound authorization package). Bind permissions, expiry,
   credential/security version and audience; reject alteration, wrong account,
   old-version replay and unauthorized lease renewal. Do not trust a role string
   or editable localStorage as authority. Document the chosen trust design before
   implementation; signing alone does not encrypt cached data.
4. Add credential/session versioning or equivalent server revocation. The October 9
   server-only versioning slice is implemented (audit finding 36 and
   ../architecture/credential-revocation.md); the October 10 local observation
   bridge is implemented, while end-to-end desktop acceptance remains open. Password
   changes/resets must invalidate affected existing server sessions; observed
   disable/revoke decisions must update local authorization appropriately. Preserve
   pending authored work without silently approving it under a different user.
   Permission refresh, app restart and offline login must not extend a lease.
5. Harden storage: move server credentials to OS-protected storage and design
   encryption/key lifecycle for SQLite and device files, including WAL/temp,
   thumbnails, exports and backups. Document shared-Windows-user and unlocked-PC
   limitations; do not promise protection against a fully compromised OS. Decide
   key recovery, logout locking and restore behavior before migrating real data;
   present material recovery/usability tradeoffs to the owner before committing.
6. Add persistent offline login throttling/backoff and clear expired/locked/session
   states. Detect suspicious backward-clock changes without silently renewing
   access; define reauthentication recovery and clock-skew tolerance. Do not claim
   a local clock is tamper-proof. Preserve native session checks, not cosmetic UI
   gates. Review renderer content isolation/CSP and token-bearing media URLs as
   part of the same desktop credential threat model.
7. Verify cold restart, explicit logout, failed logout, offline password login,
   online-to-offline transition, expired lease, ordinary/privileged/delegated roles,
   malformed authorization, account switch during requests, changed password,
   disabled account and revoked scope. Rejected local pending work remains
   recoverable but not visible to an unauthorized account.

Current source anchors: desktop/src/api/auth.ts; desktop/src/App.tsx;
desktop/src/api/http.ts; desktop/src/api/sync.ts;
desktop/src-tauri/src/local_auth.rs; desktop/src-tauri/src/local_db.rs;
backend/src/middleware/auth.js; backend/src/routes/auth.js.

<a id="source-docsauditsphase2_offline_security_and_acceptance--p2-b-complete-local-reads-processing-and-queued-intentions"></a>
#### P2-B — Complete local reads, processing and queued intentions

Use the existing common SQLite/outbox architecture and server idempotent apply;
do not add alternate direct-server fallbacks after local failure.

| Area | Remaining delivery |
| --- | --- |
| Dashboard / Operations / Lab Intelligence | Fix session guards; persist per-domain initial-download completeness, last successful sync and pending status; keep partial authorized sections usable. |
| Reports | Local reporting projection and local generation over authorized snapshots; distinguish pending/local totals from consolidated server totals. |
| Collaboration | Persist authorized activity feed; finish native-session/revocation coverage for local comments and notifications. |
| Downloads | Persist queue/history and settings; offline enqueue, quality/priority/schedule/settings edits, cancellation/removal intents; reconcile with server jobs. |
| Projects | Local review/reservation/history/context projections; queue submissions, requests and decisions where authorized, without claiming global approval or stock reservation before server acceptance; local experiment repeat/revisions; remove missing-record HTTP fallbacks. |
| Inventory | Local field/assignment history and authorized assignee directory; local inventory Excel template/export; finish missing-snapshot and movement-history session behavior. |
| Finance / purchases | Local templates, export, preview and transactional workbook imports; synchronize resulting records rather than requiring server workbook processing. |
| Resources / canvas / item pictures / search datasheets | Full file replication, local file access/manifest/editor operations, staged uploads/copies, attachment moves, deletion and resumable transfers. |
| Automation | Local due-item projection and durable run intentions; server execution remains explicit and idempotent. |
| Users / permissions / settings | Authorized cached directory and permission views; local ordinary preferences/profile intents where approved. Administrative intentions may queue, but cannot grant new effective authority offline. Password changes/resets and other sensitive credential actions remain server-confirmed; never queue plaintext passwords. |

Relevant server-only adapters are catalogued in the October 9 conversation and
finding 34. Expand the audit records with exact operation-level file/function
references, actual changes and verification as each conversion is implemented.

Download contract:

- Local queue changes survive desktop restart while the API is stopped.
- Display distinct states: pending sync, accepted/queued on server, running on
  server, completed on server, copying to PC, available on this PC, failed/conflict.
- Offline pause/cancel is a pending request, not evidence that a server job stopped.
- A cancel racing completion must reconcile without falsely claiming no output.
- Shared settings use versions/conflict handling. Replay must not duplicate jobs;
  repeated run/import requests use stable IDs and receipts.
- Completed server files/thumbnails automatically replicate to authorized PCs;
  verify content integrity, interrupted-copy resume, storage exhaustion, account
  isolation, revocation and pending deletion before marking device availability.

<a id="source-docsauditsphase2_offline_security_and_acceptance--p2-c-mandatory-real-outage-acceptance-in-the-phase-end-sweep"></a>
#### P2-C — Mandatory real outage acceptance in the phase-end sweep

This is a phase-end gate covering all offline-related implementation batches.
Unit tests, mocked fetch failures, browser fixtures and native tests alone are
insufficient. Phase 3 still performs the release matrix, but does not replace
Phase 2 acceptance. Record each test as PASS, FAIL, BLOCKED (with prerequisite) or
NOT RUN; an implementation/build pass is not an acceptance pass.

1. Record the exact tested revision/dirty diff, desktop executable, active fixture
   account, affected features and current Compose service state. Use the existing
   actual PostgreSQL service with isolated, clearly named fixtures. Never reset,
   replace or broadly reseed the user's databases. Establish online baseline,
   completed snapshot/file transfer and pending count.
2. Announce the brief interruption. Inspect current jobs; do not interrupt an
   unrelated active import/download/backup without coordinating a safe window.
   Stop ONLY the LabOS API service. Leave PostgreSQL, volumes, Docker Desktop and
   the frontend dev server intact. Confirm the API is unreachable: changing
   navigator.onLine or mocking HTTP is not the required outage.
3. Exercise affected workflows in the actual Tauri desktop: existing open view,
   navigation and refresh, then close/reopen the desktop while API remains down.
   Test cached-session restore and explicit offline login for auth-related changes.
   Read synchronized records and actual device files; perform scoped permitted
   create/edit/delete/queue/settings actions and verify local persistence/outbox.
   Check denied actions and another account as applicable. No false empty success,
   hangs, duplicate rows, data leakage or dependence on React's in-memory cache.
4. For timeout/retry/cancellation or reachability changes, additionally test Docker
   API pause (hung connections), with bounded calls and guaranteed unpause. A stop
   test is still mandatory; pause is supplementary. Verify deadlines do not turn
   a late completion into a cross-account update.
5. Restore the prior service state in a finally/cleanup path even on test failure.
   Unpause if this test paused it; start it if it was running before this test.
   If already stopped before testing, preserve that state unless the owner asks
   to start it; obtain a reconnect window to finish acceptance. Verify health,
   then reconnection/push/pull and actual PostgreSQL results, file integrity,
   exact-once logical effects, delete propagation and second-client convergence
   where relevant. Pending deletions must not resurrect on refresh/restart.
6. Record commands, outage confirmation, tested actions, before/after counts,
   assertion results, relevant sanitized logs/screenshots and restoration health
   in PHASE2_EVIDENCE.md and the corresponding audit finding. Clean only exact
   test-owned fixtures safely. If desktop interaction, Docker or reconnect testing
   is unavailable, mark acceptance BLOCKED/UNVERIFIED rather than claiming a pass.

Verified Compose service names (deploy/docker-compose.yml): project labos,
API service labos-api, database service db. Example commands from repository root:

```powershell
docker compose -p labos -f deploy/docker-compose.yml ps
docker compose -p labos -f deploy/docker-compose.yml stop labos-api
# Verify API unreachable; exercise actual desktop while stopped.
# In guaranteed cleanup, if API was initially running:
docker compose -p labos -f deploy/docker-compose.yml start labos-api
Invoke-RestMethod -TimeoutSec 5 http://localhost:4000/api/health
```

Do not use `down -v`, volume removal, database deletion or an unrelated Docker
project. A documentation-only update does not require stopping the server.

<a id="source-docsauditsphase2_offline_security_and_acceptance--sequence-and-closure"></a>
#### Sequence and closure

Repair session identity first; harden authorization/revocation alongside local
projection work; establish binary replication and the shared job-intent model;
then finish domain conversions and their outage/reconnect tests. Existing salvage,
audio-focus and permissioned assistant-planning additions remain in Phase 2 as
defined in PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md. Assistant generation remains
online-dependent; history/draft persistence must not be confused with generation.

Retain exactly three phases. Phase 2 cannot close with any offline operation
declared complete solely from mocked or online tests. Record unresolved security
design choices and failures explicitly; do not silently weaken permissions to
make offline demonstrations pass.

---

<a id="source-docsauditsvisibility_scope_implementation_plan"></a>
## LabOS visibility-scope implementation plan

Original source: `docs/audits/VISIBILITY_SCOPE_IMPLEMENTATION_PLAN.md`. Retained historical scope/status.

<a id="source-docsauditsvisibility_scope_implementation_plan--labos-visibility-scope-implementation-plan"></a>
### LabOS visibility-scope implementation plan

**Status:** the Notes, Resources, and Projects visibility slices and the
account-scoped desktop sync foundation are implemented in code. The backend
migration and a restricted-Note grant/revocation flow have now passed against
a disposable PostgreSQL database. The running desktop, other record domains,
and cross-surface leakage tests remain unverified.

> The base schema intentionally covers initial tables. `backend/src/run-migration.js`
> then applies the complete active history from `backend/src/migrations/`.
> The obsolete top-level `backend/migrations/` directory is not read by the
> runner and must not receive new migrations.

<a id="source-docsauditsvisibility_scope_implementation_plan--disposable-postgresql-verification-2026-10-03"></a>
##### Disposable PostgreSQL verification — 2026-10-03

- Used a separate `postgres:16-alpine` container without a persistent volume;
  the existing LabOS database was not changed.
- A fresh migration run initially stopped at
  `20260926_fulfillment_idempotency.sql`, which alphabetically preceded the
  migration creating `project_reservation_fulfillments`. The runner now orders
  those existing filenames by their dependencies without changing migration
  version names. A second database migrated from empty through
  `20261002_visibility_scope.sql` successfully.
- The PostgreSQL schema integration test and all 33 backend
  permission/visibility tests passed.
- An authenticated two-account HTTP check passed for a restricted Note:
  hidden from the other user's detail and list responses, readable after an
  administrator's view grant, and hidden again after revocation.
- This is backend verification only. It does **not** establish that the
  desktop cache, outbox, restart/offline behavior, Resources/Projects HTTP
  routes, exports, search, or assistant are end-to-end safe yet.

<a id="source-docsauditsvisibility_scope_implementation_plan--route-inspection-findings-resolved"></a>
##### Route-inspection findings resolved

| Surface | Current path | Risk | Recommended change | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| Project financial summary | `backend/src/routes/projects.js` `/financial-summary` previously checked project membership but not record visibility | A member with finance permission could receive a restricted project's financial summary after their record grant was removed | Filter projects through the shared visibility predicate in addition to financial permission | Actual PostgreSQL HTTP test: hidden, granted, revoked; backend regression test | Fixed |
| Resource metadata facets | `backend/src/routes/resources.js` `/meta/tags` and `/meta/categories` previously aggregated all Resources | Tags and categories could reveal restricted content or counts | Aggregate only resources readable by the requesting user, including ancestor and attached-Note rules | Actual PostgreSQL HTTP test: hidden, granted, revoked; backend regression test | Fixed; batch-query performance remains to improve |

<a id="source-docsauditsvisibility_scope_implementation_plan--existing-labos-postgresql-verification-2026-10-03"></a>
##### Existing LabOS PostgreSQL verification — 2026-10-03

- Created an ignored logical backup at
  `_backups/labos-pre-visibility-20261003.dump` before changing the running
  database. The existing database container and volume were not recreated.
- Rebuilt and restarted only the API service. Its startup migration applied
  the previously pending `20260924_inventory_acquisition.sql`, the six
  `20260926_*` reservation/project migrations, and
  `20261002_visibility_scope.sql` to the existing database. API health returned
  HTTP 200 afterward.
- With a namespaced temporary member and real database rows, authenticated
  HTTP checks confirmed restricted project financial summaries and Resource
  tags/category counts are hidden before a grant, visible after a view grant,
  and hidden again after revocation.
- The test Resource and Project were deleted by their API endpoints. The
  namespaced test member remains disabled for audit history; all pre-existing
  users, Notes, and Resources were left untouched. The post-test database has
  zero Projects, one Note, and one Resource, as before the test.
- All 34 backend permission/visibility tests pass. Desktop two-account cache,
  offline/restart sync, and other visibility surfaces still need runtime tests.

<a id="source-docsauditsvisibility_scope_implementation_plan--approved-policy"></a>
#### Approved policy

LabOS uses three visibility levels for ordinary laboratory records:

| Level | Read access | Write access |
| --- | --- | --- |
| `lab` | Active users with the domain read permission | The relevant domain mutation permission; project-owned work also requires project edit access |
| `project` | Project members and administrators with the domain read permission | Project editors and administrators with the relevant mutation permission |
| `restricted` | Explicit record grants and administrators with the domain read permission | Explicit edit grants and administrators with the relevant mutation permission |

Sensitive finance, audit, user, and system data are not made visible by this
model. They continue to require their dedicated permissions.

<a id="source-docsauditsvisibility_scope_implementation_plan--restricted-record-ownership-decision"></a>
##### Restricted-record ownership decision

The approved grant-management model is **Option C**:

- a creator may create a restricted record and receives an automatic `edit`
  grant for that record;
- an administrator or the owning project's lead may add, change, or remove
  other users' grants;
- for an unattached restricted record, only an administrator may manage other
  users' grants;
- every visibility or grant change is audited.

<a id="source-docsauditsvisibility_scope_implementation_plan--current-implementation-evidence"></a>
#### Current implementation evidence

<a id="source-docsauditsvisibility_scope_implementation_plan--already-aligned-in-part"></a>
##### Already aligned in part

- `backend/src/middleware/project-access.js` grants active users `view` access
  to ordinary projects, while preserving membership/role checks for edits.
- `backend/src/middleware/resource-access.js` treats unattached and item-only
  resources as shared, and protects shared-resource mutation to the uploader
  or an administrator.
- `backend/src/routes/audit.js` uses `audit.view` rather than `reports.view`.
- Sensitive finance checks are already represented by `finance.view_sensitive`
  in finance routes, exports, assistant projections, and sync projections.

<a id="source-docsauditsvisibility_scope_implementation_plan--gaps-found-before-implementation"></a>
##### Gaps found before implementation

| Surface | Evidence | Gap against approved policy |
| --- | --- | --- |
| Database schema | `backend/src/schema.sql` defines no `visibility` column or record-grant table | No durable `lab`/`project`/`restricted` data model exists. |
| Notes and resources | `notes` and `resources` contain project linkage but no visibility field | A record cannot be explicitly restricted or project-only independently of its parent relationship. |
| Knowledge routes | `backend/src/routes/knowledge.js` uses membership-only `projectVisibility` and `projectFilter` SQL | Lab-wide ordinary reads are inconsistent with project middleware. |
| Knowledge sync | `GET /knowledge/sync/pull` filters project-linked records by membership | Ordinary lab records can disappear from a workstation cache even though normal project read policy permits them. |
| Global search | `backend/src/routes/search.js` has no visibility predicate for notes, resources, tasks, experiments, or blocks | It cannot enforce future `project` or `restricted` records. |
| Assistant tools | `backend/src/routes/assistant.js` uses project-row filtering for notes/resources and direct queries for context | It needs the same centralized entity-read predicate as REST/search/sync. |
| Reports | `backend/src/routes/reports.js` intentionally treats ordinary reports as lab-wide | It must gain visibility predicates before restricted records are introduced. |
| Desktop cache | Local pull/merge commands currently receive no visibility metadata or grants | A restricted record could remain cached after access is revoked unless pull reconciliation includes access-removal tombstones. |

<a id="source-docsauditsvisibility_scope_implementation_plan--implementation-sequence"></a>
#### Implementation sequence

<a id="source-docsauditsvisibility_scope_implementation_plan--1-create-the-access-control-data-model-in-progress"></a>
##### 1. Create the access-control data model — in progress

Add a new migration; do not edit previous migrations. The target model is:

```sql
CREATE TYPE record_visibility AS ENUM ('lab', 'project', 'restricted');

CREATE TABLE record_access_grants (
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL CHECK (access_level IN ('view', 'edit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (entity_type, entity_id, user_id)
);
```

Initial columns belong on records that can be independently confidential:

- `projects`
- `notes`
- `resources`
- `lab_findings`
- `lab_results`
- `engineering_calculations`
- `engineering_tests`

Project workspace children (tasks, experiments, measurements, observations,
BOM, blocks, connectors, attachments, requirements) inherit their project's
visibility unless a later product decision explicitly requires exceptions.

Existing records must migrate as `lab`. No historical record will be hidden by
the initial migration.

<a id="source-docsauditsvisibility_scope_implementation_plan--2-centralize-visibility-decisions-in-backend-middleware"></a>
##### 2. Centralize visibility decisions in backend middleware

Create a single policy helper that receives the entity context, domain
permission, request user, and requested operation. Routes must not invent
their own membership-only predicates.

```js
await requireEntityReadAccess({
  user: req.user,
  permissions: req.permissions,
  entityType: 'note',
  entity: note,
});
```

The helper must first require an active authenticated user and the appropriate
domain permission, then apply `lab`, `project`, or `restricted` access. A
mutation always adds the existing project-editor/domain-mutation requirements.

<a id="source-docsauditsvisibility_scope_implementation_plan--3-convert-data-surfaces-in-risk-order"></a>
##### 3. Convert data surfaces in risk order

1. Individual entity routes: projects, notes, resources, engineering,
   knowledge findings/results/relationships.
2. Search, resource download, thumbnails, resource editor, and canvas
   attachment routes.
3. Sync pull/push, tombstones, replay response projection, and desktop merges.
4. Assistant context/evidence/search tools and reports/exports.
5. Visibility/grant administration UI, audit logging, and desktop state.

<a id="source-docsauditsvisibility_scope_implementation_plan--notes-vertical-slice-implemented-runtime-verification-pending"></a>
##### Notes vertical slice — implemented; runtime verification pending

`backend/src/routes/notes.js` now accepts and returns note visibility, applies
the shared read predicate to list/detail/tag routes, and protects restricted
note revisions and mutations with explicit edit grants. A restricted note
creation atomically creates the author’s edit grant. Server-only note grant
routes exist for the approved Option C managers; a UI is intentionally deferred
until sync, resource inheritance, and access-revocation behavior are covered.

The Note sync path now carries `visibility` in offline changes, validates it
locally and on the server, and applies the same backend predicate during pull.
`GET /sync/notes/pull` returns `visible_note_ids`, an authoritative list of
Notes available to the current user. The desktop reconciler removes any
non-pending cached Note absent from that list, so a completed authenticated
pull removes records after a grant is revoked without revealing hidden IDs.

Verification completed on 2026-10-02: backend syntax checks and 28 permission/
visibility regression tests passed; the desktop TypeScript typecheck and
`cargo check` passed. PostgreSQL migration and HTTP integration tests remain
pending against a disposable database because Docker was unavailable locally.

<a id="source-docsauditsvisibility_scope_implementation_plan--resources-vertical-slice-implemented-creation-controls-staged"></a>
##### Resources vertical slice — implemented; creation controls staged

Resource access now evaluates every resource ancestor and every attached Note.
That means a public-looking child, thumbnail, download, editor, or sync pull
cannot weaken a restricted parent folder or Note. Resources have dedicated
visibility and grant endpoints, following Option C: admins and project leads
manage other users’ grants. Resource sync now carries scope and returns an
authoritative `visible_resource_ids` set; the desktop removes non-pending,
no-longer-authorized cached Resources after a successful pull.

Existing upload, folder, and link creation continue to default to `lab` scope
for compatibility. The typed desktop API now exposes the scope/grant endpoints;
the resource creation UI must be updated in the next UI slice to choose a scope
before any new restricted-resource workflow is offered.

<a id="source-docsauditsvisibility_scope_implementation_plan--projects-vertical-slice-implemented-runtime-verification-pending"></a>
##### Projects vertical slice — implemented; runtime verification pending

Projects are the root visibility boundary for much of LabOS. The shared project
access helper now evaluates project scope before granting ordinary membership
access, so descendant routes that already use it inherit the same boundary.
Project list and direct read routes use the shared predicate; restricted
projects have server-side scope and audited Option C grant endpoints for
admins and project leads.

Project sync now carries `visibility` and returns an authoritative
`visible_project_ids` snapshot. The desktop removes a cached project missing
from that snapshot unless it has pending project outbox work. This protects
access revocation without converting the cleanup into an outbound delete.
Project creation continues to default to `lab` through the existing UI; a
scope picker and grant-management UI remain a dedicated product/UI slice.

<a id="source-docsauditsvisibility_scope_implementation_plan--project-effective-access-cache-implemented-runtime-verification-pending"></a>
##### Project effective-access cache — implemented; runtime verification pending

The project pull now sends the project team and the authenticated user's
effective `admin`/`edit`/`view` access, including restricted-record grant
level. The desktop workspace and canvas use that cached access. Local project
mutations require both the cached project editor decision and the existing
domain permission before writing an outbox event. Cached access is tied to
the central user ID; older cache entries default to read-only until refreshed.

Project workspace Notes and Resources are filtered by their own visibility
rules, resource-backed canvas blocks and attachments are filtered through
resource access, and audit activity is returned only to administrators.
Membership management now uses the same project editor decision as other
project mutations. The server remains authoritative on sync push, including
for edits queued before a grant is revoked.

Verification: backend permission/visibility tests, desktop TypeScript check,
and Rust `cargo check` pass. PostgreSQL migration and authenticated HTTP
integration still require a disposable database; Docker access was denied
by the local environment on 2026-10-02.

<a id="source-docsauditsvisibility_scope_implementation_plan--outbox-account-isolation-implemented-runtime-verification-pending"></a>
##### Outbox account isolation — implemented; runtime verification pending

SQLite schema 003 adds `sync_outbox.account_id`. New rows are stamped with the
active, unexpired central account by database triggers, so every module's
existing outbox insertion path is covered. Queue reads, acknowledgements,
failure updates, and conflicts are account-bound. Pull reconciliation inspects
only the active account's pending rows. The desktop sync loop checks that the
user and token have not changed before push and before applying each pull.
Finance state updates and outbox insertion now share a SQLite transaction, so
an ownership-trigger failure rolls back both rather than leaving an unqueued
local finance edit.

Pre-migration rows have no provable owner. They remain in SQLite with a null
`account_id`, are excluded from upload and conflict controls, and pause sync
until they can be reviewed and attributed by an explicit recovery workflow.
The sync panel reports their count. Do not automatically assign them to the
currently signed-in user, delete them, or clear the warning. A recovery UI and
backup/export procedure need a separate design and user approval.

Verification: the account-switch/migration SQLite regression test, all Rust
unit tests, `cargo check`, and desktop TypeScript check pass. A running-app
two-account test remains to be done.

<a id="source-docsauditsvisibility_scope_implementation_plan--account-scoped-local-cache-and-pull-apply-implemented-runtime-verification-pending"></a>
##### Account-scoped local cache and pull apply — implemented; runtime verification pending

Schema 004 uses `account:<central-user-id>:<state-key>` for every `sync_state`
reader and writer, including inventory, project, note, resource, finance,
knowledge, engineering, location, search, preferences, and the inventory pull
cursor. The old unscoped rows remain untouched but are hidden; their nonempty
count appears in the sync panel. No account is inferred for them. An account's
server pull builds its own cache. The inventory movement cache similarly adds
`account_id`; old rows remain unattributed and new movement keys include the
account to avoid cross-account ID collisions.

Every main sync-pull apply command receives the initiating central account ID.
Its Rust commit path checks that ID against the active local session under an
immediate SQLite transaction, preventing a late response from being written
to another account's cache. Separate inventory, movement, and resource
server-cache writes now require the expected account too; their desktop callers
capture user and token before the request. Finance's three-cache pull is one
transaction. The account-switch state/cursor test, all Rust tests, and desktop
TypeScript check pass.

Remaining: a real two-account running-app exercise and recovery/export UI for
unattributed legacy cache and movement rows. Other local tables and media files
outside `sync_state` and the movement cache require a separate isolation audit.
Direct API write fallbacks still require the planned offline-first cleanup.
Knowledge, engineering, search, assistant, and report surfaces also still need
the same record visibility review.

<a id="source-docsauditsvisibility_scope_implementation_plan--4-extend-offline-synchronization-safely"></a>
##### 4. Extend offline synchronization safely

Visibility must be in synchronized payloads. A pull response must also tell a
desktop to remove records it can no longer access; ordinary deletion tombstones
are not sufficient for that case.

For Notes, the authoritative `visible_note_ids` snapshot is the revocation
contract. Other domains may use either that pattern or a user-specific
revocation feed, provided neither leaks restricted record identifiers.

The desktop removes the record, dependent cache entries, and any local search
index projection in one SQLite transaction. It must not create an outbox
deletion for an access-revocation cleanup.

<a id="source-docsauditsvisibility_scope_implementation_plan--5-verify-via-a-route-and-sync-matrix"></a>
##### 5. Verify via a route and sync matrix

For each domain, test lab/project/restricted records against viewer, ordinary
member, project editor, explicitly granted user, revoked user, and admin.
Cover REST, search, assistant, exports, sync pull, sync push, restart, and
local-cache revocation.

<a id="source-docsauditsvisibility_scope_implementation_plan--non-negotiable-implementation-rules"></a>
#### Non-negotiable implementation rules

- No client-side visibility check is a security boundary.
- Do not make direct server fallbacks from failed local writes.
- Do not send a restricted record, its content, or a revealing tombstone to an
  unauthorized desktop.
- Do not change existing records from `lab` visibility without an explicit
  migration/administrator action.
- Every visibility or grant change must be audited.
- Every migration must be tested against a disposable PostgreSQL database and
  existing local desktop state.
