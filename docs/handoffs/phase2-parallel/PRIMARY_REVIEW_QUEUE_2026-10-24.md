# Queued project review — source implementation

Identity / role: LABOS-P2-PRIMARY. Primary implementation, not helper work.

MODULE: B3/B4 project planning review intentions and synchronization.
FILE: desktop/src-tauri/src/local_project_review.rs; local_db.rs; local_projects.rs;
main.rs; desktop/src/api/projects.ts; ProjectPlanningReview.tsx;
backend/src/project-review-sync.js; project-review-snapshot.js; routes/sync.js;
project-review-sync-live-probe.mjs; adapter/native tests.
CURRENT WRITE PATH: Desktop review -> native authorization/SQLite transaction ->
account-stamped immutable outbox project_review/decision -> ordinary sync push ->
server permission/state check -> transactional decision/event/audit -> existing
sync idempotency receipt. Browser retains HTTP. No desktop HTTP fallback.
WHY IT BYPASSES OFFLINE-FIRST: The prior desktop decision called HTTP directly.
RISK: Unavailable offline reviews, premature local activation, duplicate decisions,
stale approvals and account-crossing pending work.
RECOMMENDED CHANGE: Preserve authored intentions independently from confirmed
project state, validate at both ends, reject stale state and replay exact IDs.
ACTUAL CHANGE MADE: New native command validates active account, cached editor and
lead/admin authority, decision/reason, confirmed review snapshot and project state.
It refuses duplicate pending reviews and pending local project work, then saves
only the outbox row. No optimistic activation or review-status rewrite. Existing
native project read overlays pending/rejected/awaiting-snapshot states, excludes
explicitly dismissed/accepted conflicts without deleting their payloads, and hides
acknowledged pending indicators after the snapshot version changes. UI separates
confirmed status and pending decisions. Conflict retry checks project authority;
stale-version conflicts cannot blindly overwrite. Server uses current active
actor, permissions, lead/admin rules, project lock and expected version; required
audit and decision share the existing sync transaction. Generic post-commit audit
is skipped for this already-audited entity. Receipts expose acknowledgement only.

VERIFICATION: TypeScript and native test compilation PASS. With actual Docker API
confirmed stopped: 37 JavaScript tests and 16 native tests PASS (4 new review queue,
12 existing database regressions). Native review fixtures use isolated in-memory
SQLite, not the user's live cache. Actual PostgreSQL rollback-only handler probe
PASS: missing actor rejected, mismatched token rejected, valid submit/approve and
two audit/event rows. First probe incorrectly expected transaction-local xmin/now
to advance; corrected to an explicit mismatched-token fixture. All fixtures
rolled back. API restored healthy. Syntax and diff whitespace PASS.

STATUS: Source only; NOT ready to declare full acceptance or deploy alone. New
native command requires coordinated desktop/API upgrade. Running application and
API have not been upgraded. No existing database/storage/pending changes removed.

## Remaining acceptance and code gates

- Plan-version source guard and actual push-handler replay checks now passed;
  see PRIMARY_REVIEW_PLAN_VERSION_2026-10-24.md. Concurrent connections and durable
  commit/lost-response/reconnect acceptance remain; savepoints do not prove these.
- Restart/reopen persistence and full desktop pending/rejection/ack/pull UI checks.
- HTTP/sync transactional authority now unified in source; see
  PRIMARY_REVIEW_AUTHORITY_2026-10-24.md for evidence and remaining race boundaries.
- Check native project-work dirty detection across all parent/nested payloads.
- Acknowledgement versus refreshed snapshot handling is unit-tested; full delayed
  pull/rejection recovery and authorization changes still need integration checks.
- B3/B4 remain open. Source implementation is progress, not Phase 2 completion.
