# Offline experiment audit-history source integration — October 28

Identity / role: primary agent, A3/B3/B4 follow-up. Supersedes the earlier inspection-only note; not deployment evidence.

- MODULE: Experiment audit history, distinct from experiment revisions.
- FILE: backend/src/project-experiment-history.js and its test; backend/src/routes/sync.js; desktop/src/api/projects.ts; desktop/src/pages/ProjectDetailPage.tsx; shared project-plan-refresh and adapter tests.
- CURRENT WRITE PATH: No mutation changed. Desktop history adapter previously read HTTP directly. Existing experiment revisions are a separate collection.
- WHY IT BYPASSES OFFLINE-FIRST: Audit-history reads depended on an available API, even when project data was synchronized.
- RISK: Offline unavailability, or misleading results if revision records/bounded general activity were substituted for experiment audit events.
- RECOMMENDED CHANGE: Include a separate authorized history collection in project pulls; consume it through existing account-fenced native experiment reads; distinguish unavailable legacy snapshots from confirmed empty history.
- ACTUAL CHANGE MADE: Server helper joins project_experiment audit_log events to current experiments in the already-authorized project ID set, selecting the same audit fields as the existing history endpoint plus experiment_id for grouping. Stable descending time/ID ordering; no silent row limit. Failed history reads fail the pull instead of publishing empty history. Each pulled experiment gets an explicit history array. Desktop history uses the existing local collection reader with no HTTP fallback; absent/malformed history fails explicitly, while [] is confirmed empty. Browser HTTP route unchanged. Experiment cards show up to five downloaded audit events separately from revisions and label them as synchronized records, not pending local edits. Connected refresh includes the history query family.
- VERIFICATION: 38 frontend adapter checks passed (including four history-specific desktop/browser/account/availability cases); 3 server query-contract/source tests passed; 13 editor/connected-refresh checks passed. Backend sync syntax check passed. Server tests use a query stub and do not validate SQL against PostgreSQL.
- STATUS: Implemented in source; actual development PostgreSQL query/authorization, native snapshot persistence/merge, desktop cold-offline/reconnect and coordinated deployment remain pending. No parent closed.

## Boundaries and acceptance obligations

### Actual PostgreSQL checkpoint — October 28

After the owner started Docker, both development services were healthy. The
read-only probe reached PostgreSQL but found no experiment audit fixtures.
After inspecting audit_log column metadata, an explicit rollback-only fixture
mode was added. Final run used the actual existing development PostgreSQL through
a disposable labos compose runner with source mounted read-only.

PASS: two project scopes, four synthetic experiment audit events, endpoint-result
parity including old/new JSON values, deterministic time/ID order, scope isolation
and empty scope. Two same-ID/non-experiment audit fixtures were excluded. All six
temporary fixtures were rolled back and a subsequent query confirmed their IDs
absent. Existing projects/experiments were not modified. V1 was not touched.
Development services remain running as found. This supersedes the earlier
Docker-blocked database-test status below.

Authenticated visibility-route, native persistence/merge, desktop offline/reconnect
and deployed-build acceptance remain pending. No parent is closed.

October28 verification attempt: Docker engine pipe dockerDesktopLinuxEngine was
absent; no database connection or live test occurred. Prepared
backend/src/project-experiment-history-live-probe.mjs for explicit development-only
execution. It runs in a repeatable-read READ ONLY transaction, compares the real
helper against per-experiment endpoint-equivalent queries, checks project scope
and empty scope, and refuses to claim nonempty coverage without audit fixtures.
Opt-in LABOS_DEV_HISTORY_PROBE=1 is required; the operator must target the existing
labos development compose environment, never labos-v1. No automatic Docker start
was attempted because it could restart daily-use containers.

Final TypeScript no-emit and scoped diff whitespace checks passed after UI integration.

- Uses the existing project-history endpoint's project-access visibility contract, not the global audit-log permission policy. No extra authority is granted.
- Historical deleted experiments are not synthesized into current project snapshots. Recovery history remains separate.
- Pending local project/experiment edits can preserve an older snapshot under the existing merge policy. Display is last downloaded history, not an assertion of current server freshness.
- No cap is imposed on synchronized history. Verify large-history payload/performance before acceptance; do not silently truncate and call the result complete.
- Confirm pull failure preserves prior local history and that account switches/revocation do not leak stale rows in actual desktop acceptance.
- No V1 update, service start/stop, database write or live data access occurred in this batch.
