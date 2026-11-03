# Consolidated project checkpoint — primary agent

This is a bounded acceptance checkpoint, not full Phase 2 or desktop sign-off.

## HTTP + PostgreSQL

`backend/src/project-pull-http-live-probe.mjs` uses the production
`authenticateToken` middleware and sync router on an ephemeral loopback listener
inside a disposable development container. Pool reads are directed to one real
PostgreSQL transaction so fixtures can be completely rolled back. Responses are
not mocked. Tokens are test-generated with the configured signing key; no token,
key, password or returned project content is printed.

Nine cases PASS: missing, invalid and expired tokens; explicit projects.view
denial; database role taking precedence over JWT role; restricted grant and
revocation; credential-version revocation; disabled account. Successful cases
exercise the full project-pull response assembly, not only its SQL predicate.

Temporary user, two projects, permission overrides and grants confirmed absent
after rollback. No existing accounts or project records changed. The harness
emitted a pg warning about queued concurrent queries on a single client (the
route uses Promise.all); this is test-harness serialization, not proof of
concurrent-transaction behavior or a demonstrated production failure.

## Consolidated source checks

- Backend project and visibility suite: 40 PASS, 0 FAIL, 1 SKIP. The skipped case
  is a separately gated PostgreSQL date test; it is not counted as passed.
- HTTP harness syntax: PASS.
- Desktop TypeScript (`tsc --noEmit`): PASS.
- Repository `git diff --check`: PASS.
- Native project regression run with API/database stopped: all 16 PASS, 0 FAIL.

## Environment and boundaries

The previous launch was blocked by approval-review usage exhaustion. On resuming,
Docker was unavailable. Started installed Docker Desktop; it automatically started
pgadmin4, which was left alone. Temporarily started only existing `labos-db-1` for
the HTTP probe and restored it to stopped afterward. V1 and both API containers
remained stopped. No desktop restart, installation, migration or production API
deployment occurred.

Remaining: login/password flow, deployed listener/config, concurrent transactions,
server write receipts/replay, native IPC/actual desktop interaction, and complete
offline restart/reconnect acceptance. This harness must not be used against V1.

Reproduce with the development DB running:

```powershell
docker compose -p labos -f deploy/docker-compose.yml run --rm --no-deps -T -e LABOS_DEV_PROJECT_HTTP_PROBE=rollback-only -v 'C:/Users/balik/Iven/lab-inventory-app/backend/src:/app/src:ro' --entrypoint node labos-api src/project-pull-http-live-probe.mjs
```
