# Project collection server shape — primary agent

Scope: A5/B3 snapshot compatibility; primary verification preparation.

Source inspection of `backend/src/routes/sync.js` confirms that project-item pull
rows expose `item_id` without a separate `id`, matching the native composite event
identity. BOM, blocks, connectors, requirements and task–experiment links expose
their own IDs. No production change was needed for this mapping.

Added `backend/src/project-collection-shape-live-probe.mjs`: explicit opt-in,
repeatable-read READ ONLY transaction, bounded query timeouts, no row contents
printed. Checks snapshot query columns, canonical UUIDs, per-project unique
identities, requested scope and empty scope. Empty collections are explicitly
reported as lacking nonempty-fixture coverage rather than counted as proof.

Live PostgreSQL run blocked: `docker ps` failed because the Docker Linux engine
named pipe was absent. No services started, stopped or deployed. V1 and personal
data unchanged. Native fixture tests from the preceding batch remain distinct
from this pending real-PostgreSQL check.

## Subsequent live checkpoint

After the user started Docker, all LabOS containers were still stopped. The first
probe failed with `ENOTFOUND db`. Started only the existing `labos-db-1`, ran the
read-only probe successfully, then stopped that container to restore its original
state. V1 and both API containers remained stopped and unchanged.

All six query column/empty-scope checks PASS. Nonempty identity/scope checks PASS
for 3 blocks and 18 requirements. BOM, connectors, items and task–experiment links
contained zero rows: nonempty coverage for those four remains pending. No rows
were written or seeded; no authenticated endpoint or receipt acceptance claimed.

Native follow-up: nested `task.experiments` views now derive from an available
canonical `task_experiments` array on load and after pull. Explicit empty canonical
arrays clear stale nested links; missing legacy canonical data is not treated as
an authoritative empty list. Added scope/idempotence/legacy-shape tests and a
production-pull assertion. All 16 focused native project tests PASS with
`cargo test local_projects:: --locked --offline -j 1`; scoped whitespace checks
PASS. Desktop IPC/offline restart/reconnect acceptance remains pending.

When development Docker is available, run from the repository root:

```powershell
docker compose -p labos -f deploy/docker-compose.yml run --rm --no-deps -T -e LABOS_DEV_COLLECTION_PROBE=1 -v 'C:/Users/balik/Iven/lab-inventory-app/backend/src:/app/src:ro' --entrypoint node labos-api src/project-collection-shape-live-probe.mjs
```

This targets development compose only; never substitute the V1 compose file.
The probe does not test authenticated endpoint visibility, mutation receipts,
desktop IPC, offline restart or reconnect. No parent closure claimed.

## Nonempty fixture checkpoint

Added explicitly opted-in `LABOS_DEV_COLLECTION_FIXTURES=rollback-only` mode.
The default stays read-only. Fixture mode uses a single transaction, two existing
development projects and existing unlinked work/items; it adds two BOM rows,
four text blocks, two connectors, two zero-quantity project-item associations and
two task–experiment links. It does not post stock movements or expenses.

Actual development PostgreSQL run PASS: BOM 2, blocks 7, connectors 2,
requirements 18, items 2 and task–experiment links 2. All six collections passed
column, canonical identity, uniqueness, empty-scope and per-project scope/count
checks. These counts include temporary fixtures, not permanent seed data.

ROLLBACK completed; ten post-rollback queries confirmed absence of all twelve
fixture rows. The previous four nonempty-coverage gaps are closed for snapshot
shape checks only. Start/stop restored the existing development database to its
original stopped state. V1 and API containers were unchanged.

Reproduce with the earlier command plus:
`-e LABOS_DEV_COLLECTION_FIXTURES=rollback-only` before the service name.
This remains query-level verification, not authenticated endpoint access,
mutation-handler/receipt, concurrency, native IPC or reconnect acceptance.
