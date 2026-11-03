# Primary inventory read-security repair — October 18, 2026

Identity: LABOS-P2-PRIMARY. Independent correction of H1-4 from the October 17
helper review, not a helper completion report. Delivery IDs A1/B6; B1/B2 write
workflow findings are unchanged. Existing data, native code and outboxes retained.

## Account-bound history, custody and directory reads

MODULE: inventory movements, field history, assignment history, custody, assignees.

FILE: `desktop/src/api/items.ts`; regression cases in
`desktop/src/api/inventory-boundaries.test.mjs`.

CURRENT WRITE PATH: reads load an account-scoped SQLite snapshot, optionally GET
the server, then persist the result through account-checked native cache commands.
These cache writes are server projections, not authored business mutations.

WHY IT BYPASSES OFFLINE-FIRST: previous helper paths could return old-account
rows after asynchronous reads, treat HTTP refusal as an offline fallback, swallow
cache failures, and return raw remote rows without checking the session again.
The older movement path also returned captured cache rows on transport failure
without rechecking native lease/permission after the network wait.

RISK: stale-account data exposure; denial disguised as successful cached access;
expired native authorization overlooked while a request was pending.

RECOMMENDED CHANGE: capture a session before reads, check every asynchronous
success boundary, distinguish HTTP refusal from connectivity failure, and reread
the native snapshot on fallback so native authorization is enforced again.

ACTUAL CHANGE MADE: five getters share an account-bound read helper. Unsigned
reads fail before IPC. Local-only/offline sessions return their authorized snapshot
without HTTP; a missing snapshot errors instead of claiming an empty list. HTTP
4xx errors, malformed responses and cache-write failures propagate. Transport/5xx
fallback rereads SQLite and rechecks the session. Successful refreshes validate an
array, cache with the captured account, then reread local state; this preserves
the existing movement cache's pending-safe merge. No retry IDs, outbox events,
business mutations, native permission checks or server routes were changed.

VERIFICATION: five-reader contract matrix covers native-read/request/JSON/cache/
post-cache session switches, same-account generation changes, network/5xx fallback,
lease expiry, 400/401/403/404/409/429, malformed JSON/data, missing versus empty
snapshots, disk failure, unsigned reads and captured cache account. Existing
inventory write-boundary and HTTP-idempotency tests remain in the batch.

STATUS: implemented source guard repair; native integrated verification pending.
Online calls still await their optional HTTP refresh. Decoupling those refreshes
from first local rendering, wider history projection and B6 coverage remain open;
this does not certify the whole offline-first inventory architecture.

## Retained query data and false empty states

MODULE: inventory history and movement panels.

FILE: `desktop/src/components/ItemHistoryPanel.tsx`,
`desktop/src/components/InventoryMovementPanel.tsx`,
`desktop/src/components/inventory-read-availability.test.mjs`.

CURRENT WRITE PATH: React Query reads; existing stock action handlers unchanged.

WHY IT BYPASSES OFFLINE-FIRST: retained data can remain in a failed query, while
missing snapshots were displayed as empty history or usable movement context.

RISK: stale records rendered after refusal; movement actions based on unavailable
custody/directory information; misleading no-history messages.

RECOMMENDED CHANGE: partition query keys by account/login generation, mask denied
query data, distinguish unavailable from confirmed empty, and retain retry paths.

ACTUAL CHANGE MADE: account and generation appended to query keys (no bearer token
in keys; existing invalidation prefixes preserved). Field/assignment history mask
the failed section while retaining the successful section. Movement panel hides
retained rows and action controls when any required read fails or initially loads.
Valid offline snapshots continue through the normal UI. No stock form values are
reset by this error presentation; existing component state remains mounted.

VERIFICATION: four server-rendered component tests cover failed retained rows,
partial history, missing/empty/loading distinction, action suppression and key
partitioning. This is real component rendering with query doubles, not native UI.

STATUS: implemented, awaiting integrated desktop acceptance.

## Collected checks and remaining boundaries

- Final Node batch: **53 PASS, 0 FAIL**:
  `node --test src/api/inventory-boundaries.test.mjs src/api/inventory-http.test.mjs src/components/inventory-read-availability.test.mjs`
  from `desktop`. First 43-case checkpoint preceded movement-helper unification
  and panel tests; final 53-case run includes all changes.
- Scoped tracked-file `git diff --check`: PASS (line-ending notices only).
- Combined desktop `node node_modules/typescript/bin/tsc --noEmit`: PASS, exit 0.
- Docker engine unavailable: elevated `docker inspect` failed because
  `dockerDesktopLinuxEngine` pipe did not exist. No running API could be stopped.
  These are offline contract tests with native/HTTP doubles, not a real PostgreSQL
  or Tauri outage test. No substitute database created or database test claimed.
- No desktop rebuild/restart or API deployment. The running desktop retains its
  previously deployed silent-refresh build. No migration or data reset.
- H1-1 native custody DTO/arithmetic, H1-2 FK transaction ordering, H1-3 salvage
  outbox/provenance, H1-5 lifecycle coverage, and C3 runtime integration remain open.
- No parent A1/B1/B2/B6 or Phase 2 closure implied by these checks.
