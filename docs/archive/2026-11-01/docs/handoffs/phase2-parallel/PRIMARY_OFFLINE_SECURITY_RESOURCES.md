# Assignment 1 — primary: offline, security, resources and integration

## Current assignment override — owner directive, 2026-10-17

Primary now retains Downloads (A6) and the downloaded-link metadata/PC-copy
reconciliation subset of A4, followed by independent review/polish of helper work.
The remaining A1/A2/A3/A5 and other A4 implementation is transferred to Helper 2.
The full A plan below is retained as its requirements reference, not parallel
ownership. Shared integration/deployment/acceptance still belong to primary.

Identity: **LABOS-P2-PRIMARY**. Author of this brief: primary, 2026-10-16.
Owner: primary agent in the original LabOS task. Delivery IDs: **A1–A6**.
Role: implement this partition, review both helpers personally, integrate shared
contracts, coordinate deployments and certify evidence. This is not either helper's
implementation report. Read [coordination contract](README.md) first.

## Plan and acceptance boundaries

| ID | Remaining work to audit and finish | Required proof |
| --- | --- | --- |
| A1 | Complete native account/lease/project/record enforcement, verified source/destination grants, legacy trust, stale-response isolation and draft-preserving mid-session reauthentication. Audit CSP, direct transport and token-bearing media. | Expired/revoked/account-switched sessions cannot read/write unauthorized records; authored pending work survives; reconnect cannot adopt a stale response. |
| A2 | Owner-held recovery, Windows-protected everyday credentials/keys, encrypted SQLite/WAL/temp/files/thumbnails/backups lifecycle, non-destructive migration/restore and safe retention. Authorized export/recovery for legacy/rejected/revoked work without ownership reassignment. | Independently recoverable key AND data backups tested before cutover; no loss of unacknowledged versions or shared bytes; failures are recoverable and visible. |
| A3 | Durable completeness, true successful-sync timestamps and pending status for Dashboard, Operations, Lab Intelligence, Reports and Collaboration; local audit/context/history consumers. | Available authorized sections survive actual server outage/restart; unknown differs from zero; local read time is not mislabelled last sync. |
| A4 | Complete resource/file/thumbnail consumers, canvas attachments, item pictures/datasheets, large-file local export, seek/ranges, PDF security and resumable verified replication. | Metadata and actual PC bytes agree without false availability; interrupted transfers/storage failures preserve originals; account isolation and offline opening verified. |
| A5 | Mixed and partially acknowledged resource edit/copy/move/metadata dependencies, unsynced destinations, folders/nested moves and legacy recovery. | Stable immutable identities, no duplicate copies, lost-ACK/restart safety, correct source/destination permissions, no local-failure HTTP fallback. |
| A6 | Download worker/queue/resource/PC-copy reconciliation, completion/cancel races, tombstones and revocation cleanup. Preserve automatic Downloads intake and local scheduling/settings. | Saved links appear automatically; server completion updates the canonical resource; PC readiness requires verified bytes; retries/deletes never duplicate or resurrect data. |

The existing resource/auth/upload/editor/replication implementations remain the
foundation. Reconcile newer checklist checkpoints before calling any old subtask
missing. Approval of recovery policy is not evidence encryption is implemented.

## Immediate defect: server-completed jobs still shown as link-only resources

Owner evidence dated 2026-10-16: Downloads shows two completed server jobs
(Facebook reel and YouTube), both with unverified PC copies, while the matching
Resources cards still say LINK ONLY. Attach to A6/A4, not a new delivery ID.
Screenshots establish inconsistent presentation, not its root cause.

Investigation sequence:

1. Correlate resource UUID, job UUID, account/project scope and revision across
   actual PostgreSQL, worker results, download snapshot, local resource row and
   file replication manifest. Inspect read-only first; do not log auth secrets.
2. Trace completion's transaction: which canonical resource fields, revision,
   thumbnail and binary identity are committed, and what makes them pull-visible?
3. Trace the sync/pull merge: revision/cursor handling, pending-write protection,
   resource type/filename/local-path fields and job-resource identity normalization.
4. Trace both page selectors and local binary validation. Distinguish an old job
   whose file no longer matches the current resource from a current completion.
5. Fix the evidenced source of divergence using the existing architecture. Do
   not merely replace LINK ONLY with Downloaded based on any historical job.
6. Cover automatic intake -> scheduling -> server completion -> resource update
   -> PC replication -> verified playback, plus retry/restart, stale jobs, pending
   edits, cancel/delete races and real outage. Preserve thumbnail continuity.

Correct states must distinguish server copy, PC transfer pending/failed and verified
PC copy. Do not introduce a Resources queue-download button, auto-schedule links
on list reads, duplicate resources, wipe SQLite, or force re-download to hide this.

## Owned paths and shared integration duties

Primary owns resource/download API/native/backend modules, their components/pages,
overview completeness adapters and the integration-only paths in README. In
particular inspect `backend/src/media-downloads.js`,
`backend/src/routes/{media-downloads.js,resources.js,sync.js}`,
`desktop/src-tauri/src/{local_downloads.rs,local_resources.rs,local_resource_replication.rs}`,
`desktop/src/api/{mediaDownloads.ts,download-device-state.ts,resources.ts,sync.ts}`,
and `desktop/src/pages/{DownloadsPage.tsx,ResourcesPage.tsx}`.
These are discovery targets, not a claim every one requires changes.

- Do not edit helper-owned feature paths while they are claimed. Request a handoff
  or return review findings. Integrate supplied shared hooks yourself after review.
- Review helper 1's quantity, demand, lifecycle and migration contracts before
  wiring central sync/permissions; review helper 2's proposals/audio/action contracts.
- Require C2 to call the approved B3/B4 native/server domain entry points; no
  second assistant-specific business authority.
- Apply A4 media focus hooks only after helper 2's C3 API is reviewed. Preserve
  ongoing Phase 3 visual-agent changes and attribution.
- Only primary applies reviewed migrations to existing PostgreSQL, coordinates
  actual database fixtures, stops/restores API, rebuilds/restarts Tauri, and updates
  `PHASE2_DELIVERY_CHECKLIST.md`, `PHASE2_EVIDENCE.md` and the write-path audit.
- Do not certify a helper's report without independent diff and invariant review.
  New interfaces and screenshots are not equivalent to integrated acceptance.

## Execution order

1. Publish the three briefs and separate report ownership; reconcile baseline.
2. Investigate/fix the current A6/A4 mismatch while helpers audit independent B/C
   surfaces; no overlapping Resources/Downloads work assigned to them.
3. Finish independent A boundaries, integrate small reviewed shared contracts,
   retain quick critical checks; do not repeatedly redeploy every small edit.
4. Consolidate implementation-ready items and complete the six acceptance gates
   in the controlling checklist. Collect independent failures, group fixes and
   rerun every applicable case, including previous passes.
5. Report exact accepted IDs/subchecks, unresolved blockers and unverified work.
   No percentage inferred from 18 unequal items; no false phase-complete claim.

## Primary work log (append only)

### 2026-10-16 — assignment baseline

- ACTUAL CHANGE MADE: three-owner coordination and handoff documents only.
- Current mismatch: owner-reported; root cause and runtime reconciliation NOT YET
  VERIFIED by this assignment. No data repair/reset authorized by this report.
- All A1–A6 remain PARTIAL under the controlling checklist.
- Helper results must retain their identities and be reviewed before promotion.

## Integration and helper review register (primary only)

### 2026-10-17 — initial source finding, not a deployed fix

- REPORTER: LABOS-P2-PRIMARY; DELIVERY ID: A6/A4.
- MODULE: resource download completion -> desktop resource snapshot.
- FILE: `backend/src/media-downloads.js` (`finishDownloadJob`),
  `backend/src/routes/sync.js` (`GET /resources/pull`),
  `desktop/src/pages/ResourcesPage.tsx` (link badge),
  `desktop/src-tauri/src/local_resources.rs` (`merge_server_resource`).
- CURRENT WRITE PATH: worker commits canonical resource `local_media_*` fields
  and completed job together. Desktop resource pull uses an explicit column list
  which omits those five media fields. Resources' badge reads the missing
  `local_media_downloaded_at`; Downloads obtains job completion separately.
- WHY IT BYPASSES OFFLINE-FIRST: the issue observed in source is incomplete
  server-to-local projection, not proof of a desktop write fallback. SQLite cannot
  learn completion metadata omitted by its pull response.
- RISK: completed server media can continue to appear link-only and remain absent
  from consumers that use canonical resource metadata for replication/playback.
- RECOMMENDED CHANGE: include the canonical media fields in the authorized pull;
  verify merge/null semantics, pending-work protection and actual replication.
  Do not infer verified PC bytes from a completed historical job.
- ACTUAL CHANGE MADE: documentation only; implementation NOT changed.
- VERIFICATION: source inspection confirms omitted columns and badge dependency.
  Live Docker read-only check was denied by sandbox permissions; no live database
  or native acceptance performed. This is not confirmation of the complete runtime
  root cause. A scoped elevated read-only check remains possible next session.
- STATUS: CODE REMAINING / live correlation NOT RUN.
- The two dispatches in this task returned usage-limit errors. A subsequent fresh
  filesystem check found separately attributed helper reports and implementation
  changes already present, including custody/salvage migrations and audio-focus
  modules. Their reported completion is NOT independently reviewed or accepted
  here. Preserve these changes and inspect their actual provenance/diffs before
  further implementation, particularly shared sync/main.rs edits.
- Assignment coverage check passed: exactly three owners cover all 18 IDs once.
  Repository-wide diff check reported whitespace issues in newly changed domain
  files; that check is not a clean code verification or acceptance pass.

| Request/report | Owner | Decision | Applied files/build | Verification | Remaining |
| --- | --- | --- | --- | --- | --- |
| Initial assignments | Primary | Issued for bounded discovery first | Documentation only | Scope coverage to be checked | Implementation/acceptance remain open |
