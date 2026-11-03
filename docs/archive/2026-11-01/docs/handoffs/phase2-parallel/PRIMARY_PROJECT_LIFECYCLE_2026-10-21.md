# Project cancellation, archive and inventory settlement batch

Identity / role: primary agent; not helper work.

MODULE: B4 lifecycle propagation, B1 custody, B3 connected reservation authority.

FILE: `backend/src/project-lifecycle.js`, migration `20261021_project_lifecycle.sql`,
project/sync routes, inventory apply, permission projection; desktop native project
and reservation writers, project API types and project overview/register pages;
PostgreSQL lifecycle and custody-sync probes.

CURRENT WRITE PATH: Native project patch -> SQLite project snapshot plus immutable
outbox -> transactional server lifecycle apply -> authoritative project pull.
Browser update uses the same lifecycle helper in its existing API transaction.

WHY IT BYPASSES OFFLINE-FIRST: No new bypass. Previously project status changed
without reservation propagation, archive status or a separate settlement summary.

RISK: Old offline lifecycle decisions can overwrite newer decisions; closing a
project must not fabricate stock returns or erase outstanding custody, tasks,
results, consumption or financial history. Receipt/audit failure must not leave a
partially released project. Reservation/project lock inversions must not wait forever.

RECOMMENDED CHANGE: Fence lifecycle changes with revisions, release unused
allocations only, retain physical history, and distinguish last server inventory
settlement from project status and from unconfirmed local intentions.

ACTUAL CHANGE MADE:
- Additive lifecycle revision column and status-constraint extension for archived.
  Trigger advances lifecycle revision on status changes, including other existing
  server writers. No data reset or automatic archive.
- Cancel/completed/archive transitions release confirmed unused reservations and
  reject still-pending requests; quantities/fulfillment and custody remain intact.
  Reopening does not resurrect reservations. Tasks/experiments are not auto-finished.
- Expected revision required for server status transitions; native revision is
  advanced provisionally, with pending marker and unknown settlement. Native save
  transaction rechecks the stored lifecycle base before replacing the project.
  Cached rows without revision must synchronize before a status change.
- Server helper uses NOWAIT reservation locks under the project lock; contention
  rejects for retry rather than waiting on an inverted reservation/project lock.
- Sync lifecycle audit and receipt are transactional. Browser project update and
  reservation request audits now participate in their write transactions.
- Browser request/confirmation/fulfillment check project state under transaction
  locks; new unreserved checkout/consumption also checks open project state.
  Existing custody settlements remain possible after closure.
- Authorized project detail/pull includes inventory-only settlement counts. A
  project with outstanding custody is unsettled even when archived. No cross-unit
  quantity total or financial-settlement claim is made.
- Overview exposes Archived, a pending lifecycle message, last-server inventory
  settlement and explicit physical-work boundaries. Register recognizes Archived.
  Form retains expected revision while editing; native patch fields are allowlisted.

VERIFICATION:
- Existing PostgreSQL focused helper batch: 12 PASS, rollback verified, including
  stale revision, rollback, cancellation, outstanding archived custody, reopening
  without allocation restoration and unchanged physical quantities.
- Full source-in-memory PostgreSQL sync/browser handler batch: 27 PASS, 0 FAIL,
  rollback verified. Includes receipt failure, duplicate replay, revision conflict
  and browser archive/settlement parity. HTTP/auth middleware not exercised.
- With Docker API stopped: 5 native project and 38 inventory tests PASS; two
  opt-in live cases ignored. Native test build succeeded. The transaction-level
  lifecycle-base check additionally compiles; dedicated competing-writer acceptance
  is still required.
- 7 reservation adapter checks PASS. TypeScript initially identified missing
  archived register labels/colors; fixed and TypeScript rerun passed. JavaScript
  syntax and diff checks passed. Existing harness emits a pg concurrency deprecation
  warning, not a failed check.
- API restored healthy. Migration and fixture data were applied only inside
  rollback-only tests, not permanently deployed. No working records replaced.

STATUS: Core cancellation/archive/inventory-settlement implementation exists in
source; awaiting coordinated API migration/native/UI deployment and integrated
acceptance. Do not mark parent B4 CLOSED. Full financial/results deletion protection,
other revision paths, queued project-plan review, detailed recovery presentation,
stale/in-flight snapshot ordering and concurrent-client lifecycle races remain
separate B4 obligations. This does not certify whole-project financial settlement.

DEPLOYMENT: Update API with the additive migration and rebuild desktop/UI together.
Preserve PostgreSQL/storage/SQLite/outboxes. Refresh project snapshots before
testing lifecycle edits on older cached rows. No restart or deployment performed
in this batch; request saved-edit confirmation before closing the desktop.

## Deployment checkpoint — October 21, 2026, 18:46 UTC

Identity: primary agent. This checkpoint supersedes the source-only deployment
status above; it does not close parent B4 or Phase 2.

- Owner confirmed all edits saved and approved API update/desktop restart.
- TypeScript and Vite production build passed. Locked, offline native debug build
  passed; executable built at 18:44 UTC with the new frontend embedded.
- API image `sha256:667d730bceaeeba5dbd85a1218ac7c929d73a570b2dc3b807fb642e84e7eea7c`
  deployed using compose `up -d --no-deps labos-api`. Startup applied
  `20261021_project_lifecycle.sql` and completed all migrations.
- Existing `labos_postgres` and `labos_storage` mounts retained. Database and API
  containers healthy; `/api/health` reports API, database and storage OK.
  No reset, reseed, SQLite clearing or pending-change deletion performed.
- No existing LabOS process was running at launch check. Rebuilt executable
  launched as PID 24032 and reports Responding. This is process verification,
  not visual or signed-in desktop workflow acceptance.
- Deployed lifecycle helper: 12 PASS, rollback verified. Deployed source
  sync/browser-handler harness: 27 PASS, 0 FAIL, rollback verified against the
  existing PostgreSQL. HTTP/auth middleware and concurrent desktop clients are
  not exercised by this harness. Its pg query-concurrency deprecation remains.
- API image dependency installation reported three moderate vulnerabilities.
  No forced dependency upgrades applied; advisory triage remains open.

STATUS: Coordinated deployment complete; integrated desktop lifecycle acceptance,
concurrent-client checks and the broader B4 obligations above remain open.
