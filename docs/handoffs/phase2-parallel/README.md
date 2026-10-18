# Phase 2: three-owner delivery contract

Prepared by LABOS-P2-PRIMARY on 2026-10-16 at the owner's request. This is an
assignment and coordination contract, NOT evidence of completed implementation.
There are exactly three assignments, not three additional phases.

| Assignment | Identity | Exclusive delivery IDs | Brief and working report |
| --- | --- | --- | --- |
| 1 | LABOS-P2-PRIMARY | A6 and A4 downloaded-link reconciliation subset; integration/review | [Primary](PRIMARY_OFFLINE_SECURITY_RESOURCES.md) |
| 2 | LABOS-P2-HELPER-DOMAIN | B1, B2, B3, B4, B5, B6 | [Domain helper](HELPER_1_DOMAIN_WORKFLOWS.md) |
| 3 | LABOS-P2-HELPER-CAPABILITIES | A1, A2, A3, A5, remainder of A4; C1–C6 | [Capabilities helper](HELPER_2_ASSISTANT_AUDIO_ACTIONS.md) |

## Owner-directed reassignment — 2026-10-17 (supersedes earlier ownership)

Latest owner follow-up: helpers are considered finished; primary and owner now
take over review/polish. No further helper dispatch is active in this task. The
allocation below remains the attribution map for delivered work, not a claim that
all transferred A/C implementation has been completed. Primary's independent
review is recorded in [review checkpoint](PRIMARY_REVIEW_2026-10-17.md).

The owner asked primary to fix Downloads, hand the rest of its implementation to
Helper 2, then review/polish both helpers' work. Exactly three assignments remain.
Primary retains A6 and only the A4 subset needed for completed-link metadata,
downloaded-file replication/availability and the Resources/Downloads mismatch.
Helper 2 now owns implementation of A1/A2/A3/A5 and all other A4 work as well as C.
Primary keeps integration/deployment and final review authority, not duplicate
implementation ownership of those transferred items. The detailed A plan in the
primary brief remains required reading for Helper 2, not cancelled scope.

Active primary file reservation: `backend/src/routes/sync.js` resource pull route,
download worker/route and resource/download adapters/native replication/presentation
paths named in its brief. Helper 2 must request a handoff for overlapping resource,
auth/sync initialization or shared registration changes. Independent implementation
is released in its own report below; no migration/deployment/data reset is implied.
Older statements in this README/briefs assigning all A work to primary are historical
and are overridden here. All other safety, reporting and testing rules still apply.

These are coherent ownership boundaries, not equal estimates of effort. The
primary also owns integration, deployment and independent acceptance review.
Helpers implement functional work within their contracts; they are NOT the
existing LABOS-VISUAL-AGENT, whose Phase 3 visual-only restrictions remain intact.

## Source of truth and required reading

All contributors must read applicable AGENTS.md, this file, their entire brief,
and these documents before changing implementation:

- `docs/audits/PHASE2_DELIVERY_CHECKLIST.md`: controlling scope/status, including
  its approved decisions and newer bounded implementation checkpoints.
- `docs/audits/PHASE2_EVIDENCE.md`: inspect relevant existing evidence; do not
  claim earlier work as your own or interpret historical passes as current passes.
- `docs/audits/PHASE2_OFFLINE_SECURITY_AND_ACCEPTANCE.md`.
- `docs/audits/PHASE2_3_SCOPE_ADDITIONS_2026-10-09.md` and relevant sections of
  `docs/audits/THREE_PHASE_REMAINING_WORK_PLAN.md`.
- `docs/audits/OFFLINE_FIRST_WRITE_PATH_AUDIT.md` for the affected write paths.

The controlling checklist currently retains 18 open closure items, with baseline
12 PARTIAL and 6 PLANNED; this allocation does not close or reset any of them.
Existing foundations must be reused. No promise moves to Phase 3 merely because
it is difficult. Only primary updates authoritative status/evidence after review.

## Baseline, ownership and collision protocol

Initial observed checkout: `C:/Users/balik/Iven/lab-inventory-app`, branch `main`,
HEAD `0a5deb471069dbd5ab0174f4dc0795f28b954cff`. Initially dirty:
`desktop/src/api/mediaDownloads.ts`, `desktop/src/pages/DownloadsPage.tsx`,
`docs/audits/OFFLINE_FIRST_WRITE_PATH_AUDIT.md`,
`docs/audits/PHASE2_DELIVERY_CHECKLIST.md`, `docs/audits/PHASE2_EVIDENCE.md`.
This is a snapshot, not ownership permission: record fresh status before work.

1. Record unique UTC run ID, identity, checkout, branch/HEAD, initial dirty paths,
   and exact intended file list in your own report. Preserve pre-existing hunks.
2. Allowed feature paths are listed in each brief. A path not explicitly allowed
   is READ-ONLY until primary grants a named, bounded exception in your report.
3. Central files are integration-owned even when your feature needs them:
   `desktop/src-tauri/src/{main.rs,local_db.rs,local_auth.rs,native_authorization.rs}`,
   `desktop/src/api/{sync.ts,sync-receipts.ts,auth.ts,http.ts,local-backend.ts,permissions.ts}`,
   `backend/src/routes/{sync.js,auth.js}`, shared auth/permission middleware,
   shared receipt/UUID/protocol utilities, application bootstrap/router, global
   styles, dependency manifests/lockfiles, Tauri capabilities/CSP/build configuration,
   migration runners, Docker/deployment files, and authoritative audit ledgers.
4. Helpers may propose new domain modules and additive migration SQL in their
   report, but ask for exact new paths/migration IDs before creating them. Do not
   edit historical migrations or apply schema changes to shared databases.
5. For a shared hook/command/route/migration registration, supply an integration
   request with exact symbols, DTOs, permissions, version rules, transaction
   boundaries, error cases and proposed patch. Primary reviews and applies it.
   Do not create fake local shims, alternate sync engines or permissive stubs.
6. Do not edit another contributor's brief/report. Do not commit, stash, reset,
   clean, checkout over edits or reformat unrelated files. Do not branch from an
   incomplete HEAD and assume uncommitted prerequisites came with it.
7. Phase 3 visual work may overlap feature files. Preserve it; if concurrent work
   is active, get a file handoff first. Functional permission here does not permit
   a wholesale redesign or undoing the owner's compact/centered-modal direction.

## Dependency handshake (not extra assignments)

- Domain helper publishes canonical B1 custody/source quantities and B3/B4
  requirement/lifecycle contracts. B2 depends on B1; B4 depends on B1/B3.
- Capabilities helper publishes C1 proposal schemas and required acceptance
  operations. C2 is blocked on primary-reviewed A1 and B3/B4 contracts: no
  assistant-only SQL/write bypass to unblock it. Independent C1/C3/C5 work proceeds.
- C4 microphone/transcription integrates with C3 audio ownership, not a second
  competing coordinator. C6 consumes A1 authorization, never rewrites it.
- Domain history/projections are owned by helper 1, users/settings views by helper
  2, overview freshness and shared authorization by primary. Shared integration
  requests must name which side produces and consumes the contract.
- A4 resource/video lifecycle hooks needed by C3 are applied by primary after
  helper 2 supplies the focus API. No helper edits the active Resources/Downloads
  correction. Primary owns all cross-domain acceptance and conflict resolution.

## Non-negotiable behavior and data safety

- Desktop domain writes: authorized native operation -> atomic SQLite state plus
  immutable outbox event -> idempotent server apply -> reconciled local receipt.
  Binary data belongs in managed local storage with durable metadata/transfer
  intentions, not giant SQLite blobs. Native failure must not trigger HTTP writes.
- Retain stable entity/event IDs, UUID normalization, author/device identity,
  expected versions, dependency ordering and server permission rechecks.
- Reads use authorized local data with honest completeness/freshness. Metadata
  is not verified file bytes; queued intent is not accepted global execution.
- Preserve data, authored files, pending events and failed-work recovery. No
  database reset/reseed, broad deletion, cache wipe or silent reattribution.
- No new credentials/secrets in reports; no weakening leases, visibility, CSP or
  authorization for convenience. No live paid AI/transcription calls or audio
  recording without the needed explicit user consent/configuration.
- Helpers do not restart the desktop, stop Docker, migrate shared databases,
  deploy APIs or mutate user records. Primary coordinates those windows and
  obtains saved-edit confirmation before closing the desktop.

## Testing cadence and truthful reporting

Implement coherent batches, retaining quick compile/type checks and critical
auth/stock/idempotency/rollback tests. Build the full acceptance cases as you work.
At phase end, collect independent failures before grouped fixes and full rerun;
mark dependent tests BLOCKED rather than pretending to execute them. Stop affected
work immediately for data-loss, corruption or unauthorized-access risks.

Database acceptance uses the existing actual PostgreSQL in a primary-coordinated
window with uniquely named fixtures and narrowly scoped cleanup. Helpers may use
unit doubles to test logic but must label them; they are not database acceptance.
Offline acceptance must use actual Tauri, stop the real LabOS API (not PostgreSQL
or volumes), exercise refresh/cold restart, then reconnect. Include hung transport,
two clients/accounts, lost ACK/replay, permissions/revocation and preserved rejected
work where applicable. Primary owns service restoration and combined deployment.

Each helper appends reports ONLY in its assigned Markdown file. For each finding:

```text
REPORTER / RUN ID / UTC DATE:
DELIVERY ID / BOUNDED SUBCHECK:
MODULE:
FILE (exact path and symbols):
CURRENT WRITE PATH (or READ PATH for read-only findings):
WHY IT BYPASSES OFFLINE-FIRST (or N/A with reason):
RISK:
RECOMMENDED CHANGE:
ACTUAL CHANGE MADE (NONE if audit only; distinguish inherited changes):
VERIFICATION (command, environment, build/commit, exit code, result, limitations):
STATUS (CODE REMAINING / DEPENDENCY / IMPLEMENTED - AWAITING VERIFICATION):
FILES CHANGED / MIGRATION EFFECTS / FIXTURE CLEANUP:
INTEGRATION REQUESTS / REMAINING WORK:
```

Use PASS / FAIL / BLOCKED / NOT RUN for individual checks. Preserve dated history;
append superseding corrections rather than erase an earlier failure. A code diff,
green build, test plan or approval is not deployed/native/PostgreSQL verification.
Helpers can say READY FOR PRIMARY REVIEW, never VERIFIED CLOSED or Phase 2 done.

Primary reviews exact diffs, business/permission invariants, dependency effects,
tests and deployed behavior. Only primary fills each report's PRIMARY REVIEW
section and promotes accepted evidence into the authoritative checklist/ledger.
Unresolved authority/policy questions require a precise request with pros/cons;
do not reopen the owner's already approved choices just to defer implementation.
