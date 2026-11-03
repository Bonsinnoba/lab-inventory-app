# Project visibility checkpoint — primary agent

Scope: A1/B3 project pull visibility. Verification only; no production permission change.

Added `backend/src/project-visibility-live-probe.mjs`, explicitly gated by
`LABOS_DEV_VISIBILITY_PROBE=rollback-only`. It exercises the same
`visibilityReadSql` predicate used by `/projects/pull` on actual development
PostgreSQL with three temporary projects and two existing user IDs. It does not
change existing users, credentials, projects or grants.

Eight cases PASS: owner and member project access; unrelated principal sees only
lab scope; admin sees all three; a restricted view grant allows the named user
only; grant revocation removes restricted access; membership revocation removes
project-scoped access. Owner status alone does not bypass restricted grants.
These are SQL principal parameters, not authenticated HTTP sessions.

All fixture project, membership and grant rows were confirmed absent after
ROLLBACK. Existing development DB was temporarily started then restored to its
original stopped state; V1/API containers were unchanged.

Added a source contract for domain permission before project query, authenticated
identity parameter binding and child IDs derived from visible projects. Focused
visibility suite: 10 tests PASS. Source inspection is not runtime middleware proof.

Run from repository root with development DB available:

```powershell
docker compose -p labos -f deploy/docker-compose.yml run --rm --no-deps -T -e LABOS_DEV_VISIBILITY_PROBE=rollback-only -v 'C:/Users/balik/Iven/lab-inventory-app/backend/src:/app/src:ro' --entrypoint node labos-api src/project-visibility-live-probe.mjs
```

Remaining: actual JWT/domain-permission HTTP acceptance, endpoint response
assembly, native cache revocation and offline/reconnect. No parent closure or
deployment. No security fix was necessary in the tested SQL policy.
