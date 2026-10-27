# Browser review version and permission-writer serialization

Identity / role: LABOS-P2-PRIMARY. Primary implementation, not helper work.

MODULE: B3/B4 project review; permission override replacement.

FILE: backend/src/routes/projects.js; routes/auth.js;
project-review-push-live-probe.mjs; project-review-lock-live-probe.mjs;
project-review-authority.test.js; desktop/src/api/projects.ts;
desktop/src/api/project-reservation-boundaries.test.mjs;
desktop/src/components/ProjectPlanningReview.tsx.

CURRENT WRITE PATH: Browser review read returns a coherent versioned snapshot;
decision submits that version to the HTTP transaction. Native desktop retains
its existing local outbox path. Permission replacement locks the target account
before deleting or inserting overrides.

WHY IT BYPASSES OFFLINE-FIRST: No new native bypass. The browser HTTP route lacked
an expected version; an approval could act on a newer plan than the screen shown.
The existing permissions writer did not coordinate with review's account lock,
allowing insertion of a previously absent deny during a review transaction.

RISK: Stale browser approvals and concurrent override changes escaping row locks
on existing overrides.

RECOMMENDED CHANGE: Carry the displayed snapshot token; require it under the
project lock. Coordinate permission replacement through the target account lock.

ACTUAL CHANGE MADE: HTTP GET uses the single-statement review snapshot reader.
HTTP POST rejects missing/mismatched expected_token with REVIEW_VERSION_CONFLICT
after current authorization. Browser adapter refuses unversioned decisions and
submits the UI's loaded token unchanged. Errors leave the component note intact.
Permission replacement takes users FOR UPDATE before touching overrides and
rechecks target existence/admin protection after acquiring the lock. It therefore
conflicts with review's users FOR SHARE even when the override row is absent.

VERIFICATION: Nine real PostgreSQL handler scenario groups PASS, including missing
and stale browser tokens rejected with unchanged review/event/audit state and a
fresh-token success. Source-in-memory probe fixtures/migration rolled back. Two
real connections verify account FOR UPDATE (the permission writer's first lock)
blocks during review, along with project/account updates; all writes rolled back.
The actual permission HTTP route's lock-before-override order also has a source
regression assertion; the full permission HTTP request was not exercised here.
With actual Docker API stopped, 57 focused JavaScript tests PASS, including native
adapter no-HTTP-fallback behavior. API restored healthy. TypeScript, JavaScript
syntax and diff whitespace checks PASS.

STATUS: Source only, not deployed. Existing data/storage/pending work preserved.
Older browser clients without a token will fail closed after deployment and need
the coordinated frontend update. No migration committed by these tests.

## Remaining acceptance

- Full concurrent plan-child edit/approval and permission-request integration,
  including actor-side permission-management authorization changes and lock order.
- Native displayed-snapshot versus latest cached-token behavior, nested dirty
  work detection, durable restart/reconnect, delayed pull and UI acceptance.
- Coordinated API/native/frontend deployment. Phase 2 is not declared complete.
