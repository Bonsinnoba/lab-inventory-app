# V1 controlled lab pilot — approved October 24, 2026

## October 26 superseding handoff

This document preserves the original pilot gates and evidence; its October24
same-identity/no-fresh-install instructions are historical. The owner subsequently
approved a **separate clean personal V1**, now installed with an independent app
identity, PostgreSQL, SQLite and storage. Existing development data was retained.
Current setup and remaining acceptance: [V1_CLEAN_PERSONAL_SETUP.md](V1_CLEAN_PERSONAL_SETUP.md).
Installation is not full release-gate or Phase2 sign-off. The owner has returned
development to [PHASE2_DELIVERY_CHECKLIST.md](PHASE2_DELIVERY_CHECKLIST.md).

Owner: lab owner. Delivery/review: LABOS-P2-PRIMARY.
Target: Sunday, October 25, 2026, Africa/Accra. Target is conditional on safety
gates, not permission to ship a known data-loss or authorization defect.
Audience: owner's own lab, not public distribution.

## Scope decision

The owner approved a narrower V1 pilot rather than full Phase 2 completion.
Core inventory, projects, notes, resources/downloads, offline persistence and
reconnect must be usable. Existing financial effects must remain correct.
Preserve the current PostgreSQL, desktop SQLite/outbox, storage and authored work.
No reset, fresh install over existing data, or automatic legacy-data reassignment.
This supersedes the older V1 architecture document's fresh-install assumption.

V1 is a delivery milestone, not a request to change repository version 2.2.1 to
1.0.0. Do not renumber, tag, push or publish merely because pilot scope is approved.
Keep current application identities; do not point Preview at live SQLite.

Phase 2's A1–C6 IDs remain the complete backlog. Pilot acceptance is not closure
of all 18 items. Deferred commitments are retained, not deleted or relabelled done.

## Release gates

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Data protection (A2) | Consistent PostgreSQL + server storage + desktop SQLite/pending events + desktop authored files backup; required key/config inventory without secret disclosure; hashes and restore into an isolated target; documented rollback | Captured dataset/hash/SQLite/isolated PostgreSQL restore PASS October 24; full app recovery, key portability and off-device copy remain open |
| Core correctness (B1/B3/B4/B5/B6) | Inventory quantities, issue/return/consumption, project/task/experiment links, notes and financial effects pass on candidate; no duplicate or double deduction | PARTIAL evidence; candidate acceptance NOT RUN |
| Offline/reconnect (A1/A3/A5) | Actual API stopped; normal reads/writes/deletes, cold restart, persistent authored work, reconnect/replay and conflict handling | Focused passes exist; whole candidate workflow NOT RUN |
| Resources/downloads (A4/A5/A6) | Local upload/play/read, saved link scheduling, server completion -> resource metadata -> verified PC file, retained thumbnails, retry/delete/cancel behavior | Earlier fixes exist; candidate end-to-end verification NOT RUN |
| Access/security (A1/C6) | Lease/account boundaries, current permissions, switched/revoked accounts, preserved rejected drafts; unfinished features cannot bypass these rules | Focused passes exist; candidate sweep NOT RUN |
| Candidate/build/recovery | Coordinated compatible API/migrations/native/frontend; launch/login, hashes, exact source state, startup instructions and known limitations; rollback preserves data | October 24 candidate built; restore migration rehearsal/repeat PASS; API deployed healthy and matching debug desktop launched. Login/UI/full recovery acceptance remains open. See PRIMARY_V1_CANDIDATE_2026-10-24.md |

Release-blocking failures: data loss, lost pending work, unauthorized access,
duplicate effects, incorrect inventory/finance, broken launch, or unverified
recovery. Do not waive these because the deadline is near. Prefer disabling an
optional unsafe feature; if a required core workflow fails, do not call V1 ready.

## Deferred if unfinished

- Assistant project/task/experiment proposal generation and graph acceptance
  (C1/C2), voice input (C4), advanced media/TTS coordination (C3).
- Advanced salvage/disassembly/recovery valuation (B2).
- Broader cosmetic redesign, animations and experience polishing (Phase 3).
- Advanced imports/exports, automation and nonessential editors only if safely
  gated and the affected feature is explicitly listed as unavailable in V1.

These are conditional exclusions, NOT confirmation that controls are disabled.
Inspect existing helper/source integrations before exposing the candidate. A UI
label alone is insufficient for an unsafe mutation path: disable the operation
at the applicable native/server boundary too. Preserve existing user data.

Recovery/encryption development is not silently marked complete or waived. For
the controlled pilot, verify usable backup/restore and document remaining at-rest
protection limits. Do not claim encrypted/recoverable storage without evidence;
surface any unresolved security risk before recommending use with sensitive data.

## Execution order / timebox

1. Freeze new enhancements; reconcile candidate source and feature exposure.
2. Complete backup/restore readiness before updating the existing installation.
   No closing the app without current saved-edit confirmation.
3. Finish only essential correctness gaps in core paths and group the compatible
   API/native/frontend changes into one candidate deployment.
4. Run one complete pilot acceptance matrix with real PostgreSQL and actual API
   outages. Collect independent failures; mark dependent cases blocked. Group
   fixes and rerun affected paths plus core regressions. Safety failures stop the
   affected path immediately.
5. Record build identity/checksums, backup location, restore procedure, exact
   limitations and final go/no-go. Owner decides whether to begin lab use.

October 24 is preparation/candidate work; October 25 is the target acceptance and
pilot handoff window. These are priorities, not an unsupported hours-to-finish
guarantee. If a blocker cannot be verified in that window, report it and move the
handoff rather than silently expanding risk or resetting data.

## Initial inspection evidence

- deploy/scripts/backup-postgres.sh produces a PostgreSQL custom-format dump and
  checksum, but does not include desktop SQLite/outbox or either storage tree.
- deploy/backup-windows.bat similarly dumps PostgreSQL and tells the operator to
  back up backend storage separately. It does not create a complete recovery set.
- deploy/scripts/restore-postgres.sh uses --clean against its configured database.
  Do NOT use it for acceptance against the live database. Restore drills need an
  explicitly separate target and verified path/database identity.
- RELEASE.md describes public tagged GitHub releases. Pilot approval does not
  authorize publishing one; existing reproducibility/data-isolation rules remain.
- Latest review work has focused real PostgreSQL, API-stopped adapter/native and
  SQLite reopen evidence, but is source-only and not a live candidate sign-off.

## Reporting

For each gate record PASS / FAIL / BLOCKED / NOT RUN, exact build and evidence.
For every fix retain MODULE, FILE, CURRENT WRITE PATH, WHY IT BYPASSES
OFFLINE-FIRST, RISK, RECOMMENDED CHANGE, ACTUAL CHANGE MADE, VERIFICATION, STATUS
in its existing A1–C6 handoff report. Attribute helper work separately from primary
inspection. Do not substitute test counts for release acceptance.

Current decision: NOT READY TO RELEASE. Scope approved; gates remain open.

October 25: original six-event queue verified empty after IPC and resource-default
fixes. Final-state inspection found a release-blocking delayed create resurrecting
an already-acknowledged deleted zero-byte resource. Fresh backup/hash/SQLite and
isolated PostgreSQL restore passed; offline desktop cold-start/dashboard/downloads
and resource reads observed; 52 real-PostgreSQL lifecycle/custody/project checks
passed with rollback. This is not whole-candidate acceptance. See
`../handoffs/phase2-parallel/PRIMARY_V1_ACCEPTANCE_2026-10-25.md`.

October 25 evening: resource ordering prevention fix deployed after real
PostgreSQL batch/replay verification. API healthy and queue empty. Existing
resurrected zero-byte record has not been removed pending owner confirmation;
desktop acceptance and remaining recovery checks are still open. See
`../handoffs/phase2-parallel/PRIMARY_RESOURCE_ORDERING_2026-10-25.md`.

October 24 candidate acceptance checkpoint: 255 focused regression checks passed,
plus actual PostgreSQL download-control scenarios. All 3 completed server media
jobs have existing files of the recorded sizes. Real desktop offline cache
acceptance is blocked by no authorized active local session; PC media replicas
and full UI reconnect remain unverified. See
`../handoffs/phase2-parallel/PRIMARY_V1_ACCEPTANCE_2026-10-24.md`.

Backup preparation checkpoint: actual desktop path and Docker mounts verified;
`deploy/scripts/backup-lab-pilot.ps1` syntax and read-only planning passed.
See [backup runbook](V1_BACKUP_RESTORE_RUNBOOK.md). Capture and isolated database
restore subsequently passed. Evidence:
`../handoffs/phase2-parallel/PRIMARY_V1_BACKUP_2026-10-24.md`.
Remaining recovery boundaries there still prevent complete A2 sign-off.
