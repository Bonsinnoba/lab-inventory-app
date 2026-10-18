# Primary review checkpoint — 2026-10-17

Reviewer: **LABOS-P2-PRIMARY**. This is independent review, not a helper completion
report. Owner asked primary to retain Downloads, transfer other implementation,
then stated helpers were finished and primary/owner should take over. No more
helper dispatch is active here. Preserve all delivered work; do not reset databases.

## Disposition

- Downloads A6/A4: concrete sync projection defect corrected in source; 18 focused
  checks pass. NOT DEPLOYED / real PostgreSQL and Tauri acceptance NOT RUN.
- Helper 1 B work: **CHANGES REQUESTED**. Useful scaffolding exists but the
  reported B1–B6 completion is not supported by the reviewed implementation.
- Helper 2 C3 work: **CHANGES REQUESTED**. Two new primary regression tests fail,
  and combined TypeScript checking fails. No whole C or inherited A item accepted.
- Review is a first pass, not exhaustive acceptance. Continue independent checks,
  collect failures, then make grouped corrections and rerun the full matrix.
- Shared tree changed during review: additional Reports, resource presentation and
  `desktop/src-tauri/tauri.conf.json` edits appeared. Primary did not author those
  changes in this checkpoint. Preserve them; verify attribution and freeze the
  integrated diff before deployment. Do not overwrite concurrent work.

## Download correction (A6/A4)

MODULE: canonical downloaded resource pull.

FILE: `backend/src/routes/sync.js`, `GET /resources/pull`, around line 565;
`backend/src/routes/sync-resource-media.test.js` (new primary tests).

CURRENT WRITE PATH: worker commits `resources.local_media_*` and completed job
together; desktop pulls canonical resource metadata and starts native replication
only for files or links containing `local_media_filename`.

WHY IT BYPASSES OFFLINE-FIRST: incomplete read projection omitted all five media
fields. Completion could reach Downloads while neither Resources nor its PC
replication selector learned that a link now had server media.

RISK: stale LINK ONLY cards and no PC replication of completed media.

RECOMMENDED CHANGE: propagate canonical completion through authorized resource
sync, preserving pending local writes and native byte verification.

ACTUAL CHANGE MADE: added `local_media_path`, `local_media_filename`,
`local_media_mime_type`, `local_media_size_bytes`, `local_media_downloaded_at` to
the existing SELECT. Visibility/permission filtering and worker writes are unchanged.
No job-history inference, resource duplication, new queue button or cache reset.
Existing pull merges matching UUIDs unless local resource work is pending; then
the ordinary pending-write protection still applies. A future successful pull
can repair omitted fields without re-downloading from the external video provider.
Actual PC replication still requires connectivity, authorization and valid bytes.

VERIFICATION:

- `node --test src/routes/sync-resource-media.test.js src/routes/sync-visibility.test.js`
  from backend: 6 PASS, exit 0. New route tests model explicit SELECT projection;
  they are not real PostgreSQL tests. Completed/uncompleted rows, denied resource
  permission, invalid inheritance and no false PC-ready fields covered.
- `node --check src/routes/sync.js`: PASS, exit 0.
- `node --test src/api/resource-replication.test.mjs src/api/download-device-state.test.mjs`
  from desktop: 12 PASS, exit 0. Native command doubles, not desktop acceptance.
- Scoped diff whitespace check for the primary download/test changes: PASS.
- Elevated `docker ps`: API and PostgreSQL observed healthy. Subsequent read-only
  PostgreSQL query was NOT EXECUTED: automatic approval review hit its usage limit.
  Do not bypass this by another privileged transport. API deployment/real records,
  stopped-API desktop, cold restart, reconnect and final PC playback remain NOT RUN.

STATUS: IMPLEMENTED — AWAITING DEPLOYMENT AND VERIFICATION (bounded defect only).

## H1-1 — custody information is dropped on the desktop write path [P1]

MODULE: B1 local issue/settlement.

FILE: `desktop/src/api/items.ts` `MovementOptions`/`createItemMovement`;
`desktop/src/api/local-inventory.ts` `createLocalItemMovement` (line 15).

CURRENT WRITE PATH: UI supplies custody/recipient fields -> local adapter builds
an older movement DTO -> native SQLite/outbox. That DTO omits recipient, custody,
settlement, transfer recipient, serial and canonical-demand references.

WHY IT BYPASSES OFFLINE-FIRST: the outbox exists but does not carry the new domain
intent. The old adapter subtracts consume/damage/loss quantities again and requires
a storage destination for transfers, even for recipient custody transfers.

RISK: desktop issue does not establish intended custody; settlement can double
debit stock or be rejected. Backend changes alone cannot fix this desktop path.

RECOMMENDED CHANGE: implement a native-validated custody transaction with full
stable DTO/source IDs and local ledger+outbox atomicity. Keep ordinary storeroom
movement semantics separate; test issue and settlement end-to-end.

ACTUAL CHANGE MADE: none; review only.

VERIFICATION: source tracing confirms explicit DTO field loss and old arithmetic.
Real PostgreSQL and native acceptance NOT RUN; existing broad green suites did not
exercise this new path.

STATUS: CODE REMAINING; do not accept B1.

## H1-2 — custody rows reference movements before they exist [P1]

MODULE: B1 server stock transaction.

FILE: `backend/src/inventory-apply.js` `applyMovement` around lines 48–112;
`backend/src/migrations/20261017_item_custody_and_canonical_demand.sql` lines 18/50.

CURRENT WRITE PATH: checkout/transfer inserts custody with `source_movement_id`,
or settlement inserts `movement_id`, before inserting that item movement.

WHY IT BYPASSES OFFLINE-FIRST: N/A — server transaction ordering defect.

RISK: declared non-deferred foreign keys reject new custody/settlement operations
before their movement insert. Correct rollback does not make the workflow usable.

RECOMMENDED CHANGE: validate all effects first, insert the movement before its
dependent custody/settlement records, commit atomically with the idempotent receipt.
Do not weaken/drop foreign keys. Test the declared schema against actual PostgreSQL.

ACTUAL CHANGE MADE: none; review only.

VERIFICATION: source/schema ordering inspection; actual database failure NOT RUN
because the approved read-only database check could not execute.

STATUS: CODE REMAINING; live reproduction required before claiming verified repair.

## H1-3 — salvage introduces direct server mutations and incomplete provenance [P1]

MODULE: B2 create/inspect/release recovery.

FILE: `desktop/src/api/items.ts` lines 235–266;
`backend/src/routes/items.js` salvage routes around lines 35–190.

CURRENT WRITE PATH: desktop directly POSTs create/inspect/release; server inserts
new recovery rows and credits stock without an authored local outbox flow.

WHY IT BYPASSES OFFLINE-FIRST: no native salvage transaction or durable local
intent; new recovery create has no supplied stable request identity/receipt.

RISK: offline failure and duplicate recovery on uncertain create/retry. Source
checks establish only item existence, not an original issue/consumption balance
or cumulative recovery limit. Separate recovery rows can credit the same source.
Inspection reads then updates without a row lock/status predicate, while release
locks the row: a delayed inspection can overwrite a released status.
The list selects `s.*` under inventory.view without separate project/valuation
projection. Recovery value is copied into replacement_cost and unit_cost is set
to zero, conflating the approved value boundaries.

RECOMMENDED CHANGE: ordinary local/outbox salvage operations with stable IDs,
source-ledger limits and scoped permissions; lock/validate transitions and source
quantities together. Preserve unknown cost and separate reviewed recovery value.
Filter financial/project fields independently; never fabricate a cash transaction.

ACTUAL CHANGE MADE: none; review only. No existing recovery records altered.

VERIFICATION: source inspection, not live race/security acceptance.

STATUS: CODE REMAINING; no B2 acceptance or deployment approval from this review.

## H1-4 — cached history/directory replies can outlive the session [P1]

MODULE: B6 account-scoped reads.

FILE: `desktop/src/api/items.ts` history, custody and directory getters.

CURRENT WRITE PATH: local read followed by HTTP refresh; session-current check
guards cache writes but does not guard returning fetched data. Failed/denied HTTP
can fall back to already-read local data without another current-session check.

WHY IT BYPASSES OFFLINE-FIRST: account-bound cached reads must remain bound through
every asynchronous boundary; a renderer result is not safe merely because it was
not persisted. Also server refusal must not be treated as generic offline fallback.

RISK: stale-account data may render after a session switch; cached data may mask
revocation/permission denial. Exact user-visible race needs a targeted test.

RECOMMENDED CHANGE: shared account-captured read guard before every return, distinct
permission/lease failure handling, and local-first rendering independent of HTTP.

ACTUAL CHANGE MADE: none; review only.

VERIFICATION: inspected cache/return branches; live switch/denial NOT RUN.

STATUS: CODE REMAINING.

## H1-5 — completion report overstates B3/B4/B5 coverage [P2]

MODULE: project lifecycle and transactional finance/import closure.

FILE: helper 1 checkpoint 2; `backend/src/routes/sync.js` project field additions;
`desktop/src-tauri/src/local_projects.rs` repeat command; authoritative checklist.

CURRENT WRITE PATH: some linkage fields and experiment repeat were added, but
these are not the complete demand aggregation/cancellation/settlement/import flows.

WHY IT BYPASSES OFFLINE-FIRST: N/A for the report; acceptance cannot be inferred
from a migration, a repeat command and pre-existing passing tests.

RISK: treating B1–B6 as complete hides remaining finance/purchase import and
connected lifecycle requirements. The reported B5/B6 deliverable is chiefly
directory/history caching, not proof of B5 transactional workbook behavior.

RECOMMENDED CHANGE: map each required behavior to exact code and fresh tests;
retain PARTIAL/CODE REMAINING where evidence is absent.

ACTUAL CHANGE MADE: review disposition only; no helper history erased.

VERIFICATION: diff/report/checklist comparison; exhaustive domain acceptance open.

STATUS: CHANGES REQUESTED; no B parent promoted.

## H2-1 — audio preemption calls the incoming owner's callback [P1]

MODULE: C3 coordinator.

FILE: `desktop/src/lib/audioFocus.ts` `acquire`.

CURRENT WRITE PATH: device-local ownership mutation. The coordinator invokes
`onPreempt` supplied by the new acquisition, rather than retaining/notifying the
displaced owner's callback.

WHY IT BYPASSES OFFLINE-FIRST: N/A — device playback ownership defect.

RISK: displaced audio is not reliably stopped; the incoming owner receives the
wrong lifecycle notification. Logical priority alone does not silence audio.

RECOMMENDED CHANGE: bind callbacks to owner tokens; notify displaced owners with
the incoming owner, handle reentrancy/cancellation and gate playback on ownership.

ACTUAL CHANGE MADE: added primary regression test, not a fix.

VERIFICATION: `node --test scripts/phase2-helper-audio-review.test.mjs` from desktop:
this case FAILS (music callback count 0 rather than 1).

STATUS: CODE REMAINING / reproduced unit failure.

## H2-2 — account reset reuses audio generations [P1]

MODULE: C3 session isolation.

FILE: `desktop/src/lib/audioFocus.ts` `reset`/`release`.

CURRENT WRITE PATH: reset clears state AND resets generation counter to zero.

WHY IT BYPASSES OFFLINE-FIRST: N/A — stale token isolation defect.

RISK: old `music-dock` generation 1 can release the next session's same-named
generation 1 owner. Account switch does not establish a distinct token epoch.

RECOMMENDED CHANGE: monotonically unique generation/epoch across resets; invalidate
old callbacks without token reuse. Wire actual account-switch lifecycle too.

ACTUAL CHANGE MADE: added primary regression test, not a fix.

VERIFICATION: same primary regression command: this case FAILS (new owner lost).
Overall probe: 0 PASS / 2 FAIL, exit 1. These failures are not acceptance passes.

STATUS: CODE REMAINING / reproduced unit failure.

## H2-3 — hooks/player integration and compilation remain incomplete [P1]

MODULE: C3 integration, combined source build.

FILE: `desktop/src/hooks/useAudioFocus.ts`, audio components, AssistantChat,
NotebookPage, `desktop/src/lib/__tests__/audioFocus.test.ts`;
newer `desktop/src/api/reports.ts` line 91.

CURRENT WRITE PATH: media/TTS acquire tokens but some callers play/speak without
checking ownership. Video hook's mediaRef is unused and has no preemption pause
subscription. Legacy resume listeners can still play outside the coordinator.
TTS callbacks read the mutable current token ref rather than their own utterance's
captured token. Manual suspension arguments are accepted but ignored by coordinator.

WHY IT BYPASSES OFFLINE-FIRST: N/A — runtime ownership/build blockers.

RISK: audible overlap and stale callbacks releasing replacement speech. Tests use
unconfigured Jest globals inside the application TypeScript include tree, so the
new combined desktop does not type-check.

RECOMMENDED CHANGE: finish token-bound callback and granted-playback integration,
one resume authority, actual mic/media cancellation and runnable tests using the
existing Node test tooling rather than adding a dependency solely for scaffolding.

ACTUAL CHANGE MADE: no helper implementation overwritten.

VERIFICATION: `node node_modules/typescript/bin/tsc --noEmit` from desktop FAILS,
exit 1: hook unused mediaRef, unsupported audio type, missing describe/it/expect/jest
globals, and Reports lastSyncedAt null-versus-undefined mismatch. Earlier helper
compile claims are not valid for this combined tree. `npx` itself was unavailable;
the direct local compiler command above is the actual checked command.

STATUS: CODE REMAINING / BUILD BLOCKED. Real audio hardware acceptance NOT RUN.

Follow-on independent test collection: `node --test src/api/reports.test.mjs
src/api/inventory-boundaries.test.mjs src/api/inventory-http.test.mjs` produced
19 PASS / 1 FAIL (exit 1). Reports tests fail to parse at line 14 with
`SyntaxError: Unexpected string`; they did not exercise the new freshness logic.
Existing inventory boundary/HTTP tests pass, but do not cover the new custody and
salvage gaps identified above. Include the Reports harness repair in the grouped
build/test fixes; do not claim its new cases passed.

## Next grouped work

### Primary repair checkpoint — 2026-10-17, after app launch

Attribution: PRIMARY, not helper delivery. The existing executable was launched
directly (PID 12592, returned window "Lab Inventory Management"). No development
watcher was started, and no newly edited source was deployed. The window was
subsequently minimized; no UI interaction or login was forced. Existing data,
storage, PostgreSQL, SQLite and outboxes were preserved.

MODULE: native startup/build assets.

FILE: `desktop/src-tauri/build.rs`, new `build_support.rs`.

CURRENT WRITE PATH: build script decoded the embedded icon and rewrote icon.ico
on every build, even when the bytes were identical.

WHY IT BYPASSES OFFLINE-FIRST: N/A — build/watch behavior, not application data.

RISK: an unnecessary watched-file timestamp change can retrigger compilation.

RECOMMENDED CHANGE: materialize only missing/changed assets; preserve read errors.

ACTUAL CHANGE MADE: primary added and used write_if_changed; unchanged icon bytes
do not write. No replacement icon or Tauri configuration workaround was added.

VERIFICATION: standalone Rust tests PASS 3/3 (create/change, unchanged timestamp,
invalid target). Actual dev-watcher loop reproduction NOT RUN; existing desktop
was launched without compiling. Test fixtures remove only their own one file and
empty directory; no user files removed.

STATUS: SOURCE FIXED / watcher acceptance pending.

MODULE: A3 Reports / C3 audio helper review repairs.

FILE: Reports API/export/page/test; audioFocus.ts; useAudioFocus.ts;
`desktop/scripts/phase2-helper-audio-review.test.mjs`.

CURRENT WRITE PATH: local report projections and device-local audio arbitration.

WHY IT BYPASSES OFFLINE-FIRST: Reports' global device sync time was incorrectly
being treated as report freshness, without account/domain completeness evidence.
Audio findings do not mutate business data or the outbox.

RISK: misleading freshness; overlapping players; stale callbacks from a previous
session releasing new ownership; application compiler failures from Jest globals.

ACTUAL CHANGE MADE: repaired Reports fixture syntax and removed the misleading
global timestamp from report output/UI/export. CSV again states freshness and
completeness are unverified. Durable per-account/domain watermarks remain open.
Audio preemption now calls the displaced owner's registered callback, generations
remain monotonic across reset, reacquisition replaces old waiting tokens, and
returned snapshots cannot mutate ownership. Resource media hook pauses when denied
or preempted. Replaced the unconfigured Jest source test with equivalent Node-runner
cases plus primary regressions (including corrected preemption/resume expectations).
No Jest dependency or compiler exclusion was used to hide the tests.

VERIFICATION: Node batch PASS 39/39: 10 audio coordinator, 10 Reports, 19 existing
inventory boundary/HTTP cases. These are deterministic unit/contract checks, not
real PostgreSQL/Tauri/offline acceptance. Combined compiler result recorded below
when it completes.

Final compiler result for this checkpoint: `node node_modules/typescript/bin/tsc
--noEmit` in desktop PASS (exit 0). Scoped tracked-file diff whitespace check PASS.
The whole dirty-tree whitespace check still reports unrelated helper whitespace
in items.js/local-inventory.ts; no global formatting rewrite performed. No native
desktop rebuild, API image deployment, database test or phase-end outage test was
performed in this checkpoint. Total focused checks: 42 PASS including 3 standalone
Rust build-asset tests. The compile result does not close runtime integration.

STATUS: H2-1/H2-2 coordinator regressions now pass. H2-3 remains PARTIAL: TTS and
microphone callbacks still need token-bound completion guards, music effect/legacy
resume ownership integration needs repair, and account-switch cancellation plus
real audio hardware acceptance remain open. A3 and C3 are NOT closed. Domain
custody/salvage findings H1 remain open; prior download metadata fix still awaits
deployment and live PostgreSQL/desktop outage/reconnect verification.

1. Keep the source download fix; deploy only through an available approved window,
   with no unrelated unreviewed backend changes inadvertently bundled. Correlate
   real job/resource IDs, sync and verified PC copies, then outage/reconnect.
2. Finish the independent review of helper changes and freeze the combined diff.
   Resolve custody integrity/local propagation and salvage authorization/outbox
   before enabling those new workflows. Repair build and audio ownership together.
3. Retain all existing data and authored work; migration application claimed by a
   helper is unverified here. Do not apply/reverse migrations to make tests pass.
4. Rerun all independent checks after grouped repairs, then the full real
   PostgreSQL/Tauri acceptance matrix. No whole-phase completion claimed.
