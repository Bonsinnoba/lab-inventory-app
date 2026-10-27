# Project review plan version and push replay

Identity / role: LABOS-P2-PRIMARY. Primary implementation and verification, not helper work.

MODULE: B3/B4 project planning review synchronization.

FILE: backend/src/migrations/20261024_project_plan_revision.sql;
project-review-snapshot.js; project-review-sync.js;
project-review-sync-live-probe.mjs; project-review-push-live-probe.mjs.

CURRENT WRITE PATH: Account-owned native outbox -> existing sync push transaction
-> current authority and expected plan revision -> decision/event/audit/receipt.

WHY IT BYPASSES OFFLINE-FIRST: No new bypass. The preceding project-row token did
not detect independent child edits, so an offline approval could reference stale
plan contents even when the parent project row had not changed.

RISK: Approval of changed demand or work; duplicate review events after retry;
partial approval if receipt persistence fails.

RECOMMENDED CHANGE: A monotonic plan revision advanced transactionally by relevant
parent/child changes, plus replay checks through the actual push handler.

ACTUAL CHANGE MADE: Additive plan_revision and triggers on project rows and eleven
plan child tables. Child writes touch the parent revision; moves touch both
parents. Timestamp-only child updates do not invalidate the revision. Experiment
and task child records resolve their project through their parent. Snapshot and
review validation now use plan-v1:<revision>. Old pending tokens are not rewritten:
they will require a fresh review on mismatch. Added an opt-in source-in-memory
push-handler probe using real PostgreSQL, with route transactions represented by
savepoints inside one rollback-only transaction. No deployed code changed.

VERIFICATION: Seven PostgreSQL scenario groups PASS:

1. Migration executes twice; child insert/update/move/delete advances revisions,
   while a no-op/timestamp-only update does not.
2. Nested experiment observations and measurements advance the revision; deleting
   their experiment also advances it.
3. Disabled actor rejected despite a stale admin role in the request context.
4. Actual push submit/replay creates one review event, audit and receipt.
5. Changed payload, device and user cannot reuse an accepted receipt.
6. BOM change rejects stale approval without creating event/audit/receipt.
7. Injected receipt failure rolls back approval; retry succeeds once; another
   new-ID approval is rejected by state validation.

All PostgreSQL fixtures and migration effects rolled back. With the actual Docker
API confirmed stopped, 8 JavaScript decision tests and 4 existing native review
queue tests PASS. Native tests used isolated in-memory SQLite. API restarted in
finally; the first immediate health request raced startup, subsequent health
request succeeded. JavaScript syntax and tracked diff whitespace checks PASS.

STATUS: Source implemented with focused verification; NOT deployed or full
workflow acceptance. PostgreSQL data, storage and pending changes preserved.

## Still open before workflow closure

- Concurrent database connections/lock ordering, not simulated savepoints.
- Durable commit, transport response loss, desktop restart and delayed pull.
- HTTP transactional authority source follow-up is now implemented; see
  PRIMARY_REVIEW_AUTHORITY_2026-10-24.md. Remaining concurrency boundaries there
  still prevent declaring full workflow acceptance.
- Nested native dirty-work detection and integrated pending/conflict UI checks.
- Review coverage of additional plan-relevant relationships as part of B3/B4;
  eleven registered child tables are not a claim that every project-linked
  record or external resource-content change invalidates approval.
- Coordinated API migration/native build and desktop acceptance. None performed
  in this batch. Phase 2 remains open.
