# Transactional review authority

Identity / role: LABOS-P2-PRIMARY. Primary implementation, not helper work.

MODULE: B3/B4 review authorization and sync safety.

FILE: backend/src/project-review-authority.js; middleware/permissions.js;
project-review-sync.js; routes/projects.js; project-review-authority.test.js;
project-review-push-live-probe.mjs; project-review-lock-live-probe.mjs.

CURRENT WRITE PATH: HTTP and outbox sync both lock the project, validate current
authority on the same transaction connection, then write decision/event/audit.
Sync retains its version and receipt checks. HTTP remains an online browser path.

WHY IT BYPASSES OFFLINE-FIRST: No new desktop bypass. HTTP previously checked
authorization before starting its transaction. Sync checked the account inside
the transaction but fetched permission overrides through the shared pool.

RISK: Stale role/permissions between middleware and the decision; authorization
reads outside the transaction; response projection using cached permissions.

RECOMMENDED CHANGE: Share current transactional authority between HTTP and sync.

ACTUAL CHANGE MADE: Shared helper checks active account, current role, overrides,
lead/owner membership and restricted-project edit grant. Existing rows are read
FOR SHARE. getUserPermissions now accepts an optional transaction client and
locked-read option; existing callers keep their original behavior. HTTP performs
the authority check after its project lock and uses freshly checked permissions
for response projection. No permission baseline changed. Added unit cases and
extended the actual route-handler PostgreSQL probe to test stale HTTP context.

VERIFICATION:

- Eight PostgreSQL rollback-only push/HTTP scenario groups PASS. HTTP terminal
  handler rejects disabled and demoted accounts even with cached admin context.
  The harness intentionally bypasses middleware; full HTTP auth transport is not
  claimed tested. All temporary migration effects and fixtures rolled back.
- Separate real PostgreSQL connections: competing project and account no-op
  updates hit lock timeout while review holds its locks, then succeed after
  rollback. Every attempted update rolled back. No fixtures were committed.
- Actual Docker API stopped: 30 authority, decision and permissions tests PASS.
  API restarted and health confirmed. Syntax and diff whitespace checks PASS.
- Expected HTTP rejections initially printed large data-URL stack traces from
  the in-memory harness; probe logging now summarizes the error code instead.

STATUS: Source only, not deployed. Existing data/storage/outbox preserved.

## Remaining boundaries

Follow-up: browser tokens and target-account permission-writer locking are now
implemented in source. See PRIMARY_REVIEW_BROWSER_VERSION_2026-10-24.md for current
evidence and remaining integration limits; the bullets below record this batch's
original boundaries, not a claim that the follow-up was deployed.

- FOR SHARE protects existing rows, not insertion of a previously absent deny
  override or other predicate changes. Review authorization versus permission
  writers still needs a coordinated serialization-contract check.
- Two-connection test proves project/account row-lock exclusion, not full
  concurrent plan-child editing/approval with the new migration. Lock ordering,
  durable commit/reconnect, delayed pull and native UI acceptance remain open.
- Browser HTTP reviews do not yet send an expected plan snapshot token. Current
  authorization is now rechecked, but stale browser-screen approval is not solved
  by this change. Do not equate authority alignment with whole-workflow closure.
- Native dirty-work detection and coordinated desktop/API deployment remain.
