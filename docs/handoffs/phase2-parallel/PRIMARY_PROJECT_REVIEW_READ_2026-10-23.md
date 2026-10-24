# Project review offline read

Identity / role: LABOS-P2-PRIMARY, primary implementation; not helper work.

MODULE: B3/B4 project planning review reads.
FILE: backend/src/project-review-snapshot.js; backend/src/routes/sync.js;
desktop/src/api/projects.ts; desktop/src/components/ProjectPlanningReview.tsx;
desktop/src/api/project-reservation-boundaries.test.mjs.
CURRENT WRITE PATH: No new writes. Existing project snapshot persistence carries
review_snapshot. Review decisions remain direct server writes and are NOT fixed
or certified offline-first by this batch.
WHY IT BYPASSES OFFLINE-FIRST: Review reads previously always used HTTP.
RISK: Offline review history unavailable; optimistic local status could be
mistaken for confirmed approval if reused as review state.
RECOMMENDED CHANGE: Dedicated confirmed review snapshot in authorized project
pull, native-only desktop reads, and separately implemented queued decisions.
ACTUAL CHANGE MADE: Project status and ordered review events are read in a single
PostgreSQL statement. Scope uses authorized project IDs. Snapshot is included
outside the financial-field filter so ordinary authorized readers receive it.
Desktop validates project identity, review state and events array and checks
session continuity. Missing/malformed data rejects without HTTP fallback.
UI labels the last synchronized state, preserves retained data on read error,
offers retry, and states that decisions still require connection. No migrations,
outbox changes, data resets or native-command additions.
VERIFICATION: Read-only actual PostgreSQL check over six projects/two events
PASS, including empty scope. 33 focused tests PASS with Docker API confirmed
stopped, then restored healthy; four new review adapter tests cover cached data,
missing/malformed/foreign snapshots, account changes and browser compatibility.
TypeScript, server syntax and diff whitespace PASS. Tests mock IPC; the complete
deployed pull/native persistence/UI route is not yet accepted. Final explicit
placement outside financial projection was syntax-checked, not live deployed.
STATUS: Source-only. API/frontend deployment, SQLite reopen and live non-finance
account acceptance remain open. Parent B3/B4 not closed.

## Next: approval mutation contract (not implemented here)

- Native transaction persists authored intent and outbox atomically, without
  claiming central approval or activating a project locally.
- Server checks active actor, project edit access, lead/admin rules and expected
  review/lifecycle revision within its transaction.
- Decision, review event and required audit record commit together. Existing
  HTTP endpoint currently audits after commit and must share the corrected path.
- Sync idempotency must prevent duplicate events on retry; stale decisions remain
  recoverable conflicts. User notes and immutable pending intentions preserved.
- UI shows pending/rejected decisions separately from confirmed review state;
  refresh must not silently turn rejection into success or discard pending work.
- Verify against real PostgreSQL and offline native persistence before enabling.
