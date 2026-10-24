# Review decision transaction foundation

Identity / role: LABOS-P2-PRIMARY; primary implementation, not helper work.

MODULE: B3/B4 planning review decision transaction.
FILE: backend/src/project-review-decision.js; backend/src/routes/projects.js;
backend/src/project-review-decision.test.js; backend/src/project-review-live-probe.mjs.
CURRENT WRITE PATH: Existing authorized HTTP route locks project, calls shared
decision helper, then commits. No desktop queue enabled in this batch.
WHY IT BYPASSES OFFLINE-FIRST: Desktop review decisions still call HTTP directly.
This prerequisite fixes atomicity before adding replay; it does not close that
bypass. Previously review committed before a non-required audit write.
RISK: Successful review without its required audit record. Contrary to an earlier
investigation note, the default audit helper swallows errors rather than failing
the HTTP request; this missing-audit risk is the verified defect.
RECOMMENDED CHANGE: Shared transaction-owned decision/event/mandatory audit write,
then authorized idempotent outbox application with expected-state checks.
ACTUAL CHANGE MADE: Shared helper validates decision/note/state and writes project,
event and required audit through the same client. HTTP route retains existing
authorization and project lock, commits only after audit succeeds, and returns
structured validation/conflict errors. No local state or outbox rewriting.
VERIFICATION: Actual PostgreSQL rollback-only probe PASS: submit, approve,
lifecycle increment, invalid reason and repeated-state rejection; forced audit
failure followed by rollback leaves neither decision nor event/audit. All fixture
writes rolled back. First probe attempt failed on module URL resolution before
database execution; corrected attempt passed. Eight helper tests plus 24 adapter
checks PASS with actual API stopped. API restarted; initial health request raced
startup, subsequent health OK. Syntax and diff whitespace PASS.
STATUS: Source-only; not deployed. Probe directly exercises the helper, not HTTP
authorization or concurrent requests. Native outbox intentions, transactional
authorization recheck, stale-snapshot/ABA protection, replay idempotency and UI
pending/conflict reconciliation remain open. Duplicate-state rejection is NOT
proof of idempotent replay. No Phase 2 parent item closed.
