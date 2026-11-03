# B3/B4 child editing versus review — PostgreSQL verification

Identity: LABOS-P2-PRIMARY. Primary verification, not helper implementation.

MODULE: Project review / connected plan mutations.

FILE: backend/src/project-review-child-lock-live-probe.mjs; existing
project-review-sync.js and 20261024_project_plan_revision.sql exercised unchanged.

CURRENT WRITE PATH: child SQL mutation -> parent plan-revision trigger/row lock;
review intent -> same parent lock -> current authority -> displayed-token check
-> atomic decision and audit.

WHY IT BYPASSES OFFLINE-FIRST: none demonstrated. This closes a bounded server
concurrency coverage gap rather than introducing another mutation path.

RISK: approval could otherwise race a child edit and accept an obsolete plan.

RECOMMENDED CHANGE: exercise actual PostgreSQL locks in both acquisition orders,
and call the production review helper with a stale token after a child mutation.

ACTUAL CHANGE MADE: added opt-in, two-connection rollback-only probe with bounded
lock/statement timeouts. No production logic changes or committed migrations.

VERIFICATION: October27, existing development PostgreSQL only. Actual API remained
stopped. Disposable compose runner mounted source read-only. All four cases PASS:
task update, experiment update, BOM insert, canvas-block update. Parent-first
locks blocked child SQL (55P03); child-first locks blocked the production review
helper (55P03). Each child mutation advanced the parent revision by one. A stale
token was rejected with REVIEW_VERSION_CONFLICT in a transaction observing the
child mutation. All transactions rolled back and original revisions were checked.
No existing BOM fixture was present: a generated BOM row was inserted only inside
test transactions, and its absence after rollback was asserted. Initial run had
three passes and one skip; final run covered all four without skips.

STATUS: BOUNDED CONCURRENCY CHECK PASS. B3/B4 remain open.

Limits: this is not a concurrent full HTTP request or committed transport replay
test. Deletes, cross-project reparenting, other child tables, permission-management
request races and live desktop restart/reconnect remain separate acceptance gates.
V1 containers, installed executable and personal data were not changed. Development
database restored stopped after testing, matching its initial state.
