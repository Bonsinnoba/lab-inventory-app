# Phase 1 checkpoint and handoff — 2026-10-03

## Outcome

The implemented Phase 1 fixes and the fresh checks below are finished. The
audit has operation-level source coverage and recorded dispositions, and the
shared synchronization contract is documented. This is **not unconditional
Phase 1/security sign-off**: finding 33, the DOCX/image parser dependency, is
still high severity in npm audit. Do not label the application release-ready
or hide that failure behind otherwise passing tests.

The app is running (Lab Inventory process observed); the frontend returned
HTTP 200 at `http://localhost:1420`. Docker API/DB were healthy. Final API image:
`sha256:00606e1b16a6d16b5ef147e326a4b1ffba9540ebef8487b70fdcaf4743e116dd`.
No PR, commit, remote CI run or GUI acceptance is claimed by this checkpoint.

## Fresh verification

| Check | Result | What this proves / does not prove |
| --- | --- | --- |
| Backend: `node --test src/middleware/*.test.js src/routes/*.test.js src/context-evidence.test.js` | 50 passed | Permission, visibility, context and scope regression suite; includes source assertions, not 50 end-to-end cases. |
| Desktop: `node --test src/api/*.test.mjs` | 19 passed | Eight executed IPC fault scenarios plus four source guards and seven operation-calculation tests. |
| Rust: `cargo test --no-default-features` | 16 passed; 1 opt-in test ignored in ordinary run | Account ownership, scoped cache, leases, UUID merge, snapshot cleanup, conflict identity/permissions and existing local regressions. |
| Rust opt-in: `cargo test --no-default-features postgres_two_client -- --ignored --nocapture` | 1 passed, explicitly run against local API | Two disk-backed SQLite clients using production Notes save/merge, actual PostgreSQL, offline restart, author attribution, lost-ack identical replay, atomic rollback, repeated pull and replayed delete. Not two GUI clients or all-domain conflict certification. |
| Desktop TypeScript: `node node_modules/typescript/bin/tsc --noEmit` | Passed | Type checking. |
| Desktop production bundle: `node node_modules/vite/bin/vite.js build` | Passed; 2,085 modules | Sandbox config resolution failed on first attempt; approved rerun succeeded. Does not prove modal/thumbnail visual acceptance. |
| Docker API rebuild with `npm ci --omit=dev` | Passed | Final persistent image includes current code and security-updated lockfile. |
| `npm audit` / non-forced `npm audit fix --ignore-scripts` | Five affected packages reduced to one high; audit remains nonzero | Express/Multer/qs updates applied; image-size via html-to-docx remains OPEN. |

### Actual PostgreSQL probes

All seven passed on the final Docker image. Each requires an explicit opt-in
environment variable and creates UUID-namespaced rows. They remove their exact
fixtures, not arbitrary seeded/user data.

| Script | Opt-in variable | Coverage |
| --- | --- | --- |
| `backend/src/phase1-surface-live-probe.mjs` | `LABOS_PHASE1_SURFACE_PROBE=1` | Restricted records, parent-restricted lab note list/detail/pull, grants/revocation, search/context/evidence, assistant tools, reports, finance list/aggregate/pull, notifications, download queue, Operations stored-row checks, PDF copy scope, safe admin export, disabled account. |
| `backend/src/phase1-role-live-probe.mjs` | `LABOS_PHASE1_ROLE_PROBE=1` | Researcher membership, view/edit grants, stored project authority, relationship endpoints, disabled account. |
| `backend/src/finance-role-live-probe.mjs` | `LABOS_FINANCE_ROLE_PROBE=1` | Income-only permissions, expense denial, same-change replay, authenticated author and movement-ID collision. |
| `backend/src/direct-delete-live-probe.mjs` | `LABOS_DIRECT_DELETE_PROBE=1` | Transaction/budget/funding/location tombstones and finance create collision. |
| `backend/src/inventory-routes-live-probe.mjs` | `LABOS_INVENTORY_ROUTE_PROBE=1` | Single/bulk inventory routes, tombstones and resource create collision. |
| `backend/src/engineering-live-probe.mjs` | `LABOS_LIVE_ENGINEERING_PROBE=1` | Restricted scope, grant/revoke, sync create/replay/collision/delete. |
| `backend/src/knowledge-live-probe.mjs` | `LABOS_LIVE_KNOWLEDGE_PROBE=1` | Restricted list/search/pull/overview/tags and grant/revoke. |

Example: `docker exec -e LABOS_PHASE1_SURFACE_PROBE=1 labos-labos-api-1 node src/phase1-surface-live-probe.mjs`.
For the Rust opt-in test, set `LABOS_LIVE_API_URL=http://127.0.0.1:4000/api`,
`LABOS_LIVE_USERNAME` and `LABOS_LIVE_PASSWORD` to the local test account.
Credentials are intentionally not embedded in the test or this document.

Final fixture verification: **2 users, 48 items, 6 projects, 18 notes, 9 resources**.
The two-client test deletes its note via the API; its namespaced audit,
idempotency and deletion evidence is intentionally retained. Temporary client
SQLite directories and PDF-copy test directories are removed.

## Changes delivered

- Shared stored-row and parent-project visibility across primary and secondary reads, including finance aggregates and synchronization responses.
- Correct requirement mutation authority at the mounted Operations router; income-create permissions and server-author attribution aligned with the local model.
- 24-hour privileged offline leases; refreshing permissions can narrow but never renew the authentication lease.
- Conflict payload redaction/domain permissions, owner-only recovery, immutable retries, fresh identity for explicit overwrites.
- Complete-snapshot Finance/Location reconciliation beyond bounded tombstones, preserving pending authored intents.
- Resource-copy SQL/scope fixes; admin JSON export includes experiments, excludes credential hashes and fails visibly on table-query errors.
- Executed local-failure tests and actual PostgreSQL probes; disk-backed two-client Notes reference test.
- Source index, nine-field findings, shared sync/recovery/binary/maintenance contracts, and approved hybrid preference/legacy reset decisions.

## Remaining work, still exactly three phases

**Phase 1 closure exception:** resolve finding 33 before unconditional security
sign-off. The installed html-to-docx bundle contains parser code, so merely
overriding its transitive image-size package is not sufficient evidence of a fix.
Replacement/rebuild plus bounded conversion and document/image regression tests
is the first security item to address with Phase 2's resource work.

**Phase 2 implementation:** maintenance, suppliers, storage, collaboration/read
state, hybrid preferences, binary staging/editor/download reconciliation,
imports/purchases and remaining project workflow conversion; explicit online
authority UX; transaction/audit atomicity; all-domain replay/version/concurrency
tests; recovery-only isolation of revoked pending work; account/media cache
completion. Findings 1–27 retain domain-specific dispositions rather than being
marked resolved merely because the Notes reference passes.

**Phase 3 acceptance:** compact Users/permissions and centered modal visual QA,
thumbnail and white-screen regression checks, provenance/performance, two actual
GUI clients, installer/upgrade/restore, current CI and independent review,
approved calculator integration and owner acceptance.

No existing user-owned uncommitted edits were reverted. No additional database
reset was performed during this verification pass.
