# Permission HTTP acceptance — bounded development probe

Identity: LABOS-P2-PRIMARY. Primary verification and input-validation correction.

MODULE: A1/B3/B4 permission replacement and current-authority enforcement.

FILE: backend/src/routes/auth.js;
backend/src/permission-replacement-http-live-probe.mjs.

CURRENT WRITE PATH: real loopback HTTP -> production JWT authentication ->
permission middleware -> production router -> transactional authority and audit.

WHY IT BYPASSES OFFLINE-FIRST: no new bypass. This tests an existing online
administrative endpoint; no desktop outbox changes.

RISK: actor authority can change after middleware. Also, the old input fallback
silently treated missing/null/non-array overrides as an instruction to clear all.

RECOMMENDED CHANGE: validate the complete authenticated HTTP path with current
authority rechecks and rollback; require explicit array for replacement/clearing.

ACTUAL CHANGE MADE: malformed overrides now return HTTP400
INVALID_PERMISSION_OVERRIDES. Explicit [] remains valid to intentionally clear.
Added real HTTP probe with disposable users, production JWT middleware/router,
and actual PostgreSQL. Pool injection maps route transactions to savepoints inside
an outer transaction so no fixture writes commit. A deterministic connect hook
changes authority after middleware, before transactional recheck.

VERIFICATION: eight scenario groups PASS: authenticated replacement plus audit;
unauthenticated denial; actor disabled after middleware; actor demoted after
middleware; delegated grant revoked after middleware; unheld deny removal blocked;
mandatory audit failure rolls back; malformed bodies preserve existing overrides
while explicit [] clears. Each denied/failing case verifies unchanged target
overrides/audit. All fixtures rolled back. Source mounted read-only into disposable
runner. Development API stayed stopped; database restored stopped. Diff check PASS.
V1 containers, files, databases and installed application unchanged.

STATUS: BOUNDED HTTP CHECK PASS — source not deployed.

Limit: requests/auth/router/SQL are real, but transaction commits are intercepted
as savepoints and the authority race is deterministically injected, not an
independent concurrently committed HTTP request. Earlier two-connection probes
cover database lock exclusion. Reciprocal management requests, other account
writers, coordinated deployment and desktop reconnect remain separate gates.
