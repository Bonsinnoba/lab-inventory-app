# LabOS remediation evidence log

Date: 2026-09-20
Repository: Bonsinnoba/lab-inventory-app
Target branch: main

## Baseline observed

The repository had already accumulated several duplicate-related fixes, including duplicate resource-link prevention and local reuse of duplicate resource links. The remaining evidence gap was that the server-side logical duplicate check was a check-then-insert sequence without serialization, so two concurrent creators could still race.

## Changes made in this remediation pass

1. `backend/src/routes/resources.js`
   - Added a deterministic resource-link lock key.
   - Added PostgreSQL transaction advisory locking with `pg_advisory_xact_lock`.
   - Moved the direct link duplicate lookup and insert into the same transaction.
   - Included item, project, note, and folder-parent scope in duplicate identity.
   - Normalized the stored URL by trimming whitespace and trailing slashes.
   - Preserved the existing behavior of returning the already-existing logical link instead of creating another row.

2. `backend/src/routes/sync.js`
   - Added the same logical-link lock-key scheme to offline resource creation.
   - Serialized sync-side duplicate detection before insert.
   - Included the complete resource-parent scope in the duplicate identity.
   - Reused an existing logical link when a concurrent/offline create resolves to an already-present row.

3. `backend/src/test-resource-dedup-static.js`
   - Added evidence-first static checks covering both server creation paths and the existing local-first implementation.

4. `backend/src/test-resource-dedup-disposable.js`
   - Added a disposable PostgreSQL concurrency test.
   - Uses a random URL, commits one winner, verifies the second transaction observes that row after waiting on the same advisory lock, and removes the disposable row in cleanup.
   - This test requires a configured `DATABASE_URL`; it is deliberately not allowed to silently pass without a database.

5. `backend/package.json`
   - Added runnable scripts for the static and disposable duplicate-resource tests.

## Verification status

- Repository inspection: completed through GitHub on 2026-09-20.
- Static test execution in this assistant environment: NOT EXECUTED because the repository cannot be cloned here and no project runtime/database is available.
- Disposable PostgreSQL test execution: NOT EXECUTED for the same reason.
- The tests are committed so the project workstation can execute them against the actual dependency/runtime/database environment.
- No claim of runtime PASS is made until those commands produce their own evidence.

## Required execution evidence

From `backend/` on the project workstation:

```powershell
npm run check
npm run test:resource-dedup-static
npm run test:resource-dedup-disposable
```

Then run the broader critical regression suite already defined by the repository, including:

```powershell
npm run test:sync-reliability-static
npm run test:core-static
```

Record the exact command, timestamp, result, and any failure/remediation in this file before declaring the remediation verified.

## Decision rule

A code fix is not considered runtime-verified merely because the source looks correct. The evidence standard is:

- static checks PASS;
- disposable concurrency check PASS against the real PostgreSQL instance;
- existing critical regression checks PASS;
- no uncommitted remediation changes remain;
- the resulting commit is identifiable from main.

## Follow-up review: migration 043 corrected before production use

During evidence-first review of migration 043 on 2026-09-20, a database-level uniqueness gap was found before production application:

- A PostgreSQL UNIQUE index normally treats NULL values as distinct.
- The resource schema requires exactly one parent field, so the other three parent columns are NULL for every resource.
- Therefore the original five-column unique index would not reliably prevent duplicate links in the same parent scope, despite the application-level advisory lock doing so for API-created rows.

### Decision DECISION-004 — NULL-safe database identity

Use PostgreSQL 15+ NULLS NOT DISTINCT on idx_resources_link_unique. The test environment is PostgreSQL 16, and the production database must be PostgreSQL 15+ before migration 043 is applied.

Reason: the database constraint must encode the same logical identity as the application: normalized URL + the one populated parent scope, with NULL in non-applicable parent columns treated as equal.

### Changes CHANGE-004 / CHANGE-005

- backend/src/migrations/043_resource_link_duplicate_constraint.sql
  - Added explicit PostgreSQL 15+ requirement comment.
  - Changed the unique index to NULLS NOT DISTINCT.
  - Kept duplicate cleanup partitioning across the complete parent scope.
- backend/src/test-resource-dedup-disposable.js
  - Added a direct database-constraint test that attempts a duplicate with NULL parent columns and requires SQLSTATE 23505.
  - Retained the concurrent advisory-lock verification.
- backend/src/test-resource-dedup-static.js
  - Added static assertions for the migration's NULL-safe uniqueness semantics and disposable constraint test.

### Production decision

Migration 043 remains deferred. Do not apply it to production until the revised migration has been executed successfully against the disposable/test PostgreSQL 16 environment and the production PostgreSQL major version is confirmed compatible.

This review supersedes the earlier statement that migration 043 was already safe to apply solely on the basis of its original unique index.

## Follow-up: converting Tauri-only claims into executable evidence

The next verification pass did not accept “requires Tauri GUI” as an automatic reason to leave workflows untested.

### CHANGE-006 — local resource unit coverage

desktop/src-tauri/src/local_resources.rs now has Rust unit tests covering:

- URL normalization (whitespace and trailing slashes);
- rejection of multiple direct parent contexts;
- rejection of non-folder nested parents;
- acceptance of a valid folder parent;
- tag normalization and 30-tag limit.

These are deterministic tests and do not require the Tauri GUI.

### CHANGE-007 — resource sync static contract checks

Added backend/src/test-resource-sync-static.js and the npm script:

npm run test:resource-sync-static

The checks cover:

- local resource state + outbox transactional persistence;
- transactional server-pull merge;
- protection of pending local resource mutations from server overwrite;
- protection of pending local resources from server tombstone deletion;
- download-job outbox creation;
- server handling of download-job sync;
- active-download-job deduplication;
- resource deletion tombstones;
- resource deletion propagation;
- direct-link transaction rollback/commit structure;
- local folder-parent identity.

These are source-level contract checks, not runtime proof. They reduce the untested surface but do not replace the required workstation execution.

### Remaining runtime evidence required

The project workstation should now execute, from backend/:

npm run check
npm run test:resource-dedup-static
npm run test:resource-sync-static
npm run test:resource-dedup-disposable
npm run test:sync-reliability-static
npm run test:core-static

And from desktop/src-tauri/:

cargo test

The actual output must be recorded before marking these tests PASS.


## Evidence update — 2026-09-20

- Local workstation reached main commit `18c2e16` before rerunning the verification suite.
- Verification exposed two defects in the newly added disposable/resource-link test path: an invalid JavaScript regex escape in `test-resource-dedup-disposable.js`, and the same malformed trailing-slash regex in the direct resource-link implementation. Both were corrected on `main`.
- Static assertions were also stale relative to the current implementation in the resource dedup, sync reliability, and core Phase 1 test scripts. Assertions were aligned to the actual documented contracts; no production behavior was changed for the retry/tombstone/auth cases solely to satisfy those brittle assertions.
- Required next evidence run after pulling the new main commit: `npm run check`, resource dedup static/disposable tests, resource sync static test, sync reliability static test, core static test, then `cargo test` from `desktop/src-tauri`.
- Production migration `043_resource_link_duplicate_constraint.sql` remains deferred until disposable PostgreSQL evidence passes and production PostgreSQL major-version compatibility is confirmed.

- Follow-up verification on 2026-09-20 found three additional static-test defects: the disposable dedup test still contained an over-escaped regex, the core project-update assertion omitted the literal PostgreSQL parameter marker emitted by the template, and the offline-session assertion searched the wrong source for the `local:` token prefix. These were corrected without changing application behavior.


## Evidence update — 2026-09-20 (post-7fa092b syntax audit)

The workstation run at commit `7fa092b` exposed one real source syntax defect in `backend/src/routes/resources.js`, plus one stale core static assertion that was still not corrected by the prior remediation commit.

- `resources.js`: the direct `POST /link` route contained over-escaped quote characters inside the SQL string (`kind=\\'link\\'` in source), which made Node report `SyntaxError: missing ) after argument list`. The YouTube host regex was also normalized to the intended JavaScript regex literal.
- `test-core-phase1-static.js`: the project-update assertion still searched for `id=${values.length}` instead of the actual template source `id=$${values.length}`. This is a test defect, not a production route defect.
- No production behavior is being changed to make the core assertion pass; the assertion is being aligned to the actual parameterized SQL contract.
- The disposable resource dedup test did not run because `DATABASE_URL` was not configured. This remains an evidence gap, not a PASS.


## Evidence update — 2026-09-20 (actual remediation commits after workstation output)

The workstation run at `7fa092b` exposed two issues that required direct correction:

1. **Confirmed production source syntax defect — `backend/src/routes/resources.js`**
   - The direct `POST /link` SQL query contained over-escaped single quotes around `link`, producing Node's `SyntaxError: missing ) after argument list`.
   - Corrected in commit `16b5b2717e53b3153e56e919bc1dd05773348bb8`.
   - The resulting source now contains the valid SQL string form `kind=\'link\'`.
   - This is a real application-source defect, not a test-only issue.

2. **Confirmed stale static-test assertion — `backend/src/test-core-phase1-static.js`**
   - The assertion searched for `WHERE id=${values.length}`, while the actual route intentionally emits `WHERE id=$${values.length}` in its JavaScript template literal.
   - Corrected using a function replacement so JavaScript replacement-string dollar semantics could not strip the literal PostgreSQL parameter marker.
   - Corrected in commit `1a1203bb49fd07e4502f7c488598a3e39923bef3`.
   - No production project-update behavior was changed.

The earlier evidence entry stated these corrections had been made, but the workstation output demonstrated that the first attempted edits had not actually changed the affected file contents. This entry records the **actual effective commits** and supersedes that part of the earlier note.

Current database evidence status is unchanged: `npm run test:resource-dedup-disposable` did not execute because `DATABASE_URL` was not configured. It must not be treated as PASS.

## Evidence update — 2026-09-20 (sync.js syntax audit)

The workstation verification after commit `52c0d04` exposed one additional confirmed production-source syntax defect in `backend/src/routes/sync.js`.

- The sync resource-link duplicate query contained an over-escaped trailing-slash regex: `replace(/\\\\/+$/,'')` in source. Node therefore failed `npm run check` with `SyntaxError: Unexpected token ','` at the query argument list.
- The corresponding helper `resourceLinkLockKey()` already contained the intended regex, so this was a duplicated implementation-site defect rather than a design change.
- Corrected directly on `main` in commit `55168abbffc7a25b928d06e4550c7ffd22d3059c` to use the same intended URL normalization expression as the lock-key path.
- No synchronization behavior or deduplication policy was changed; the fix restores valid JavaScript and consistent trailing-slash normalization.
- The user's current run provides strong evidence that the static suites and Rust unit tests pass, but `npm run check` remains a required gate after this correction.
- `npm run test:resource-dedup-disposable` remains **NOT RUN**, because `DATABASE_URL` was not configured. This is still a runtime evidence gap and must not be treated as PASS.

## Evidence update — 2026-09-20 (post-55168abb verification)

The project workstation reran the full required verification set after pulling main at commit `abb6fe895050431270a3af88685c3d671530419b`.

### Results

- `npm run check`: **PASS** — all backend JavaScript files passed Node syntax checking.
- `npm run test:resource-dedup-static`: **PASS 9/9**.
- `npm run test:resource-sync-static`: **PASS 11/11**.
- `npm run test:resource-dedup-disposable`: **NOT RUN** — `DATABASE_URL` is not configured. This remains the principal runtime database evidence gap and is not a PASS.
- `npm run test:sync-reliability-static`: **PASS 125/125**.
- `npm run test:core-static`: **PASS** — all core Phase 1 assertions passed.
- `cargo test`: **PASS 5/5** Rust unit tests. Cargo emitted 13 non-fatal compiler warnings; none caused a test failure.

### Evidence classification

This run establishes workstation execution evidence for JavaScript syntax, all current static regression suites, and the deterministic Rust unit tests. It does **not** establish PostgreSQL runtime/concurrency/constraint evidence because the disposable database test was skipped due to missing `DATABASE_URL`.

Migration 043 remains deferred until the disposable PostgreSQL test passes and the production PostgreSQL major version is confirmed to support PostgreSQL 15+ `NULLS NOT DISTINCT`.

No additional production code changes were required from this verification run.


## Evidence update — 2026-09-20 (disposable PostgreSQL harness configuration)

The rebuilt production-like API container was successfully started from the current `main` image, and PostgreSQL 16 remained healthy. The first execution of `npm run test:resource-dedup-disposable` then stopped before connecting because the test required `DATABASE_URL`, while the deployment intentionally supplies standard PostgreSQL environment variables (`PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`).

This was classified as a **test harness integration gap**, not an application/database failure.

### CHANGE-008 — disposable test accepts production PostgreSQL configuration

- `backend/src/test-resource-dedup-disposable.js` now accepts either:
  - `DATABASE_URL`, or
  - the standard PostgreSQL environment variables already used by the deployment.
- No production deployment configuration was changed.
- No database migration or reset was added to the test.
- The test continues to fail closed when neither configuration form is available.
- The test still requires `idx_resources_link_unique` to already exist; it does not silently apply migration 043.

Commit: `6aaa4c92cac046efa775269be89fe50d02b3e165`.

### Next required runtime evidence

Rebuild/restart the API from `deploy/`, confirm it becomes healthy, then execute:

```powershell
docker compose exec labos-api npm run test:resource-dedup-disposable
```

Do not classify the database evidence as PASS until the command itself reports both the NULL-safe uniqueness and concurrent deduplication PASS results.


## Evidence update — 2026-09-20 (disposable test false-negative diagnosis)

The live PostgreSQL inspection established:

- PostgreSQL version: **16.4**.
- `idx_resources_link_unique` exists and is defined with `lower(btrim(url)), item_id, project_id, note_id, parent_resource_id) NULLS NOT DISTINCT` and the expected `kind='link' AND url IS NOT NULL` predicate.

The first disposable runtime attempt failed its NULL-safe uniqueness assertion. This was **not evidence that the database index was wrong**. The test inserted the first row using a URL with a trailing slash and attempted the duplicate using the normalized URL without that slash. The live index expression is `lower(btrim(url))`; it does not itself remove trailing slashes. The application canonicalizes trailing slashes before insertion, so the disposable test was incorrectly mixing a raw URL with the application's canonical stored URL.

### CHANGE-009 — correct disposable test to use canonical stored URL

- The disposable constraint test now inserts `normalizedUrl` for both duplicate attempts.
- The concurrent advisory-lock phase also inserts the canonical `normalizedUrl`.
- Cleanup targets the canonical URL.
- No production database definition or application behavior was changed.
- This correction tests the intended database contract: once the application has canonicalized the URL, PostgreSQL must treat NULL parent columns as equal and reject the logical duplicate.
- The live database index definition was inspected before making this test correction; migration 043 was **not** manually applied or modified as part of this diagnosis.

The previous runtime failure therefore remains recorded as a **test defect/false negative**, while the actual PostgreSQL constraint definition is independently confirmed to contain `NULLS NOT DISTINCT`.

### Next required runtime evidence

Pull/rebuild the updated main, then rerun:

```powershell
docker compose build labos-api
docker compose up -d labos-api
docker compose exec labos-api npm run test:resource-dedup-disposable
```

A PASS still requires both database uniqueness and concurrent advisory-lock checks to report PASS. Migration 043 remains deferred until that runtime test passes and the production PostgreSQL major version is confirmed compatible.

## Evidence update — 2026-09-20 (successful disposable PostgreSQL runtime verification)

The corrected disposable resource-link test was executed against the live disposable PostgreSQL deployment after rebuilding the API container from `main`.

### Runtime environment

- PostgreSQL: **16.4**.
- `idx_resources_link_unique` was independently inspected before the test and confirmed to use `NULLS NOT DISTINCT` across the normalized URL and complete parent scope, with the expected link/non-null URL predicate.
- The test did not apply migration 043 or otherwise modify the database schema.

### Runtime results

The workstation executed:

```powershell
docker compose build labos-api
docker compose up -d labos-api
docker compose exec labos-api npm run test:resource-dedup-disposable
```

The disposable test reported:

```text
PASS: database NULL-safe uniqueness constraint
PASS: disposable concurrent resource-link deduplication
```

This establishes runtime evidence that the live PostgreSQL constraint rejects a logical duplicate with NULL parent columns after application URL canonicalization, and that the transaction advisory-lock sequence prevents the tested check-then-insert race from producing a second logical link.

### Evidence classification

The resource-link deduplication remediation now has both static and real PostgreSQL runtime evidence. The earlier failed runtime attempt is retained as a documented test false-negative caused by the test mixing the raw trailing-slash URL with the canonical URL; it was not evidence of an incorrect database index.

Migration 043 remains subject to the separate production compatibility/deployment decision. The disposable PostgreSQL 16.4 environment is compatible with the `NULLS NOT DISTINCT` feature, but this runtime test alone does not establish the production database major version.

### Next verification target

Proceed to the remaining resource/sync runtime evidence, beginning with the resource sync contract and then the broader sync reliability/core regression suite. Do not treat static checks as substitutes for runtime evidence where a real database-backed workflow can be exercised.


## Evidence update — 2026-09-20 (resource/sync workstation verification)

The workstation reran the requested verification sequence from current `main`.

### Results

- `git pull origin main`: **Already up to date**.
- `npm run check`: **PASS** — backend JavaScript syntax checks completed without errors.
- `npm run test:resource-sync-static`: **PASS 11/11**.
- `npm run test:sync-reliability-static`: **PASS 125/125**.
- `npm run test:core-static`: **PASS** — all Phase 1 regression assertions passed.
- `cargo test`: **PASS 5/5** Rust unit tests.
- Rust compilation emitted **13 non-fatal warnings** (unused imports/variables, unnecessary `mut`, dead code, and non-snake-case parameter names). These warnings did not cause test failures and were not changed during this verification run.

### Evidence classification

This establishes fresh workstation execution evidence for backend syntax, resource-sync static contracts, the broader sync-reliability static suite, core regression checks, and Rust unit tests.

It does **not** establish runtime PostgreSQL evidence for the broader sync workflows. The previously completed disposable PostgreSQL test establishes runtime evidence specifically for resource-link deduplication, but resource pull/push, tombstone convergence, offline outbox processing, conflict handling, and retry behavior still require a real runtime exercise where practical.

No production code changes were required by this verification run.

### Next verification target

Proceed with a disposable PostgreSQL-backed sync runtime test rather than treating the 11/11 and 125/125 static results as runtime proof. The test should exercise at minimum a resource sync push/pull lifecycle, idempotency/convergence, deletion tombstone propagation, and the relevant transaction boundaries, while leaving the disposable database safe to destroy afterward.


## Evidence update — 2026-09-20 (disposable sync runtime harness added)

A new disposable PostgreSQL-backed runtime test was added to close the remaining sync evidence gap.

### CHANGE-010 — disposable sync push/pull runtime verification

Added:
- `backend/src/test-sync-runtime-disposable.js`
- npm script: `test:sync-runtime-disposable`

The test uses the deployment's existing PostgreSQL environment configuration and the running API. It selects an active disposable admin account, signs a short-lived test JWT with the existing `JWT_SECRET`, and exercises the real `/api/sync/push` and `/api/sync/resources/pull` endpoints.

The runtime scenario covers:
1. resource create through sync push;
2. canonical URL persistence;
3. idempotent replay using the same `change_id`;
4. duplicate prevention after replay;
5. rejection of a changed payload reusing the same `change_id`;
6. resource pull visibility;
7. rejected invalid resource mutation and rollback verification;
8. resource deletion through sync push;
9. PostgreSQL resource tombstone creation;
10. resource pull of the deletion tombstone.

The test generates disposable UUIDs and an `example.invalid` URL, then removes its resource, tombstone, and idempotency rows in a `finally` cleanup block.

No production synchronization implementation or database schema was changed by this addition.

Commits:
- `90757fbd8aa3ac945c2cc0898aa75cd3894d2f68` — runtime test
- `10b801e8c2a1636985e271cec3165ffaa52f8ca8` — npm script

### Required workstation runtime evidence

After pulling and rebuilding the API image from `main`, run:

```powershell
cd C:\Users\balik\Iven\lab-inventory-app\deploy
git pull origin main
docker compose build labos-api
docker compose up -d labos-api
docker compose exec labos-api npm run test:sync-runtime-disposable
```

This test must report all seven PASS lines before broader sync runtime evidence is classified as PASS. A failure must be diagnosed before any conclusion about the production sync implementation is made.


## Evidence update — 2026-09-21 (sync runtime test found production URL-canonicalization defect)

The first real PostgreSQL-backed sync runtime execution failed at the canonical URL persistence assertion:

`resource create push did not persist the canonical URL`

Diagnosis from the live production path:
- `applyResourceEntity()` correctly normalized URLs for advisory locking and duplicate lookup.
- The subsequent INSERT loop copied `record.url` directly into `resources.url`.
- Therefore a sync-created URL ending in `/` could be stored with the trailing slash even though the deduplication identity used the normalized form.
- This was a production implementation defect, not a test-harness defect.

Fix:
- `backend/src/routes/sync.js` now canonicalizes the `url` field during resource sync INSERT using trim + trailing-slash removal, matching the existing direct `POST /api/resources/link` behavior and deduplication identity.

Commit:
- `06e7f22b4c9f4f1a333af82081fe94b66cc84479`

Runtime evidence status:
- The disposable sync runtime test is **NOT PASS yet**.
- The failure was useful evidence and identified a real production defect.
- The test must be rerun after rebuilding/restarting `labos-api`.
- No PASS claim is made for the full sync runtime scenario until the rerun completes.


## Evidence update — 2026-09-21 (sync runtime rerun exposed over-escaped production regex)

The workstation rebuilt and restarted `labos-api`, but the disposable sync runtime test could not execute because the API container entered a restart loop. The container logs provided the exact production-source failure:

- `backend/src/routes/sync.js:231` contained `replace(/\\\\/+$/,'')` in the URL canonicalization expression.
- Node 22 reported `SyntaxError: Unexpected token ','` while loading `sync.js`.
- The migration runner completed successfully before the API process failed, and the PostgreSQL container remained healthy. Therefore this was a JavaScript source syntax defect, not a migration/database failure and not a sync-runtime test result.
- The same class of over-escaped trailing-slash regex had previously been found at another sync implementation site. The evidence from the container proves that the effective committed source still contained the bad escaping after the previous remediation attempt.

### Remediation

- Corrected the sync resource INSERT URL canonicalization expression to the valid JavaScript regex `/\\/+$/`, matching the already-correct normalization used by the sync lock/duplicate lookup path.
- No database schema, migration, synchronization policy, or test expectation was changed.
- Corrected directly on `main` in commit `b561f1a7f1a218a26c21ff4c82c55f1b859d0789`.
- Updated file blob SHA: `560478218a135e54eeb51e1f6008a535d188aa89`.

### Runtime evidence status

- The disposable sync runtime test remains **NOT PASS** because the attempted rerun was blocked by the API syntax error before the test could start.
- The next required evidence is to pull/rebuild/restart the API from this corrected `main`, confirm the container stays healthy, then rerun `npm run test:sync-runtime-disposable`.
- Do not treat the restart-loop failure as a database or sync-runtime failure, and do not claim the full sync runtime scenario PASS until the test itself reports its required PASS results.


## Evidence update — 2026-09-21 (sync runtime found shared-resource delete authorization defect)

The corrected API container started successfully and the disposable PostgreSQL-backed sync runtime test executed. The scenario progressed through resource creation, canonical URL persistence, idempotent replay, duplicate protection, changed-payload rejection, resource pull visibility, and invalid-resource rollback. It then failed specifically at resource deletion: HTTP 200 contained a rejected change with `RESOURCE_ACCESS_DENIED`.

Diagnosis from the production code:

- The sync resource create path creates an unattached resource with `uploaded_by = user.userId` and no project/item/note context.
- `getResourceAccess()` correctly classifies such a resource as `shared`.
- `requireResourceEditor()` correctly permits an administrator or the original uploader to edit/delete a shared resource.
- The sync update/delete path was instead calling `getResourceAccess()` directly and only accepting `edit` or `admin`, which incorrectly rejected the valid `shared` access state even for the administrator/original uploader.
- Therefore this was a real production authorization defect exposed by the runtime test, not a test-harness problem.

### Remediation

- Changed the sync resource update/delete authorization to use the existing `requireResourceEditor()` policy helper, preserving the established shared-resource rule instead of duplicating a narrower check.
- No permission definitions, test expectations, database schema, or resource ownership model were changed.
- Production fix committed directly to `main`: `f9a35cc8015d0a3b44cc3f265b29dc2b51e9ddcd`.
- Updated `sync.js` blob SHA: `6d83ce09fff29f8a562f288e2fef22d22236a1c6`.

### Runtime evidence status

- The disposable sync runtime test is **NOT PASS yet** because it correctly stopped at the authorization defect before verifying deletion/tombstone behavior.
- Required next evidence: pull/rebuild/restart the API from the remediation commit, then rerun `npm run test:sync-runtime-disposable`. A PASS requires the complete scenario to reach its final success output.


## Evidence update — 2026-09-21 (shared-resource authorization remediation verified)

The project workstation pulled production fix commit `063f243665f3afc8116cfbd49c5eabb41ae1049f`, rebuilt and restarted `labos-api`, and reran the disposable PostgreSQL-backed sync runtime test.

### Workstation execution

The workstation executed:

```powershell
cd C:\Users\balik\Iven\lab-inventory-app\deploy
git pull origin main
docker compose build labos-api
docker compose up -d labos-api
docker compose ps
docker compose exec labos-api npm run test:sync-runtime-disposable
```

The API image built successfully and the API container started. PostgreSQL remained healthy.

### Runtime results

The disposable sync runtime test reported all required scenario checks as PASS:

```text
PASS: disposable sync push creates and persists a resource
PASS: sync idempotency replay returns the original result without duplication
PASS: sync rejects idempotency payload mismatch
PASS: resource pull returns the pushed resource
PASS: rejected resource mutation rolls back without creating a row
PASS: resource deletion creates a PostgreSQL tombstone
PASS: resource pull returns the deletion tombstone
```

This is real PostgreSQL-backed runtime evidence for the exercised sync push/pull lifecycle, idempotency protection, invalid-mutation rollback, resource deletion, tombstone creation, and tombstone propagation.

### Evidence classification

The previously failing shared-resource deletion authorization path is now verified in the complete runtime scenario after replacing the narrower `getResourceAccess()` check with the established `requireResourceEditor()` policy.

The disposable sync runtime scenario is now **PASS**.

This does not by itself establish every possible sync/retry/conflict workflow as runtime-verified. The existing static suites and Rust unit tests remain separate evidence categories, and broader runtime coverage should continue where practical.

The Docker Compose warnings about unset host-shell `PGDATABASE`, `PGUSER`, and `PGPASSWORD` did not prevent the deployment from starting or the runtime test from passing; the deployment's configured environment remained functional. They are therefore recorded as non-blocking environment warnings, not test failures.

### Next verification target

Proceed to the next runtime evidence gap in the broader sync reliability/outbox/convergence surface. Keep the same evidence standard: exercise the real API/database path where practical, document every defect and remediation, and do not convert static PASS results into runtime claims.


## Evidence update — 2026-09-21 (production Compose environment cleanup before fresh deployment)

The disposable PostgreSQL/API deployment is now being retired in favor of a fresh production-style deployment using the repository's current migration chain.

### CHANGE-011 — remove host-shell PostgreSQL interpolation warnings

deploy/docker-compose.yml was changed so the PostgreSQL service receives its database settings from the same .env.production file already used by labos-api.

The previous Compose configuration interpolated PGDATABASE, PGUSER, and PGPASSWORD from the host shell before container startup. On the workstation these variables were not exported in the shell, so Compose emitted non-blocking warnings even though the API container received the correct deployment environment.

The corrected configuration:
- adds env_file: .env.production to the PostgreSQL service;
- removes the duplicated host-shell interpolation for POSTGRES_DB, POSTGRES_USER, and POSTGRES_PASSWORD;
- changes the database healthcheck to use the container's POSTGRES_USER and POSTGRES_DB at runtime via escaped Compose variables;
- leaves the API service and PostgreSQL 16 image unchanged.

Commit: d0f72f0b35406ed37fe20a988e6ecf75ec525e05.

This change is configuration cleanup only. It does not change database schema or application behavior.

### Production reset/test plan

The next runtime phase is intentionally destructive to the disposable database volume and must only be performed because the current disposable data has been backed up elsewhere.

The fresh production-style database must be created from the repository's migration chain, including migration 043. PostgreSQL 16 is explicitly compatible with NULLS NOT DISTINCT.

Required evidence from the workstation:
1. retire the current disposable containers and database volume;
2. recreate the PostgreSQL 16/API deployment from current main;
3. capture the migration output and confirm migration 043 applies successfully;
4. confirm the API health endpoint/container remains healthy;
5. verify the resulting idx_resources_link_unique definition in the fresh database;
6. execute the real PostgreSQL-backed resource dedup and sync runtime tests against the fresh deployment;
7. run the workstation static/Rust regression suite again if the deployment commit changes during this phase;
8. record all output before treating the fresh deployment as production-runtime verified.

No runtime PASS is claimed by this documentation change alone.


## Evidence update — 2026-09-21 (fresh production PostgreSQL environment mapping remediation)

The first fresh production-style PostgreSQL startup exposed a deployment configuration defect.

### CHANGE-012 — map LabOS PG variables to PostgreSQL image variables

The PostgreSQL 16 container requires the official image variables `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`. LabOS application configuration intentionally uses `PGDATABASE`, `PGUSER`, and `PGPASSWORD` for the Node/PostgreSQL client.

Runtime evidence showed:
- `PGDATABASE=lab_inventory`
- `PGUSER=labos`
- `PGPASSWORD` was set
- `POSTGRES_DB` and `POSTGRES_USER` were empty
- PostgreSQL repeatedly aborted initialization with: `Database is uninitialized and superuser password is not specified.`

The password itself was subsequently rotated by the workstation operator after it appeared in diagnostic output. No secret value is recorded here.

The deployment correction:
- keeps `.env.production` as the source for both services;
- adds explicit `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` mappings to the `db` service;
- documents the required PostgreSQL image variables in `deploy/.env.production.example`;
- retains the existing API `PG*` variables unchanged;
- does not alter application code or database schema.

Commits:
- Compose remediation: `c44c241240faac15ca64a86f4d61220980468262`
- Example environment documentation: `8764f175d5cf489e6f2d66ae963cc68380eb2bfc`

### Evidence classification

This remediation is **not yet runtime-verified**. The current database container was still unhealthy before the fix, so no migration or application runtime PASS is claimed.

### Next workstation action

Pull current `main`, then recreate the disposable production-style deployment. Capture:
1. `docker compose config` without secrets;
2. PostgreSQL initialization logs;
3. API migration logs;
4. container health;
5. fresh `idx_resources_link_unique` definition;
6. resource-dedup and sync runtime tests.

Only those fresh-deployment results can establish production-runtime verification.


## Evidence update — 2026-09-21 (corrected PostgreSQL environment mapping approach)

The workstation reran the PostgreSQL environment diagnostic after CHANGE-012 and still received empty `POSTGRES_DB` and `POSTGRES_USER`, with Compose warnings that those interpolation variables were unset.

This exposed a second deployment-configuration issue in the first CHANGE-012 remediation:

- `env_file: .env.production` supplies variables to the container environment, but its values are **not** available for Docker Compose's `${...}` interpolation.
- Therefore adding `environment: POSTGRES_DB: ${POSTGRES_DB}`, etc. did not map the values from `.env.production`; Compose substituted blank host-shell values before the container started.
- The repeated diagnostic result is evidence that the first mapping approach was ineffective. It is not a PostgreSQL or application failure.

### Corrective change

`deploy/docker-compose.yml` was corrected again on `main`:

- removed the erroneous `environment:` interpolation block from the PostgreSQL service;
- kept `env_file: .env.production` as the direct container environment source;
- retained the escaped runtime healthcheck using `POSTGRES_USER` and `POSTGRES_DB`;
- the PostgreSQL image will therefore receive the official `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` variables directly from the local `.env.production` file.

Commit: `5795c1bdd6cf59d3429a3081bcf52425d602578e`.

### Required local configuration

The workstation's untracked `deploy/.env.production` must contain both naming conventions, using the same current database credentials:

```env
PGDATABASE=lab_inventory
PGUSER=labos
PGPASSWORD=<current-secret>

POSTGRES_DB=lab_inventory
POSTGRES_USER=labos
POSTGRES_PASSWORD=<same-current-secret>
```

No secret value is recorded in this evidence log.

### Runtime status

This correction is **NOT runtime-verified yet**. The next diagnostic must show:

```text
POSTGRES_DB=lab_inventory
POSTGRES_USER=labos
POSTGRES_PASSWORD=SET
```

with no Compose interpolation warnings for these variables.

Only after that should the fresh database volume be created and the migration/API/runtime verification continue.

## Evidence update — 2026-09-21 (ultra-clean physical-test reset preparation)

The physical-test environment exposed a state-isolation problem: resetting the Docker PostgreSQL volume did not reset the desktop's persistent Tauri SQLite database or cached WebView authentication state. The desktop therefore remained capable of presenting data from an older local/server session even after a fresh PostgreSQL volume was created.

### CHANGE-013 — deterministic deployment/test reset

The deployment baseline was cleaned up without changing the LabOS database architecture:

- `deploy/docker-compose.yml` now has an explicit Compose project name `labos`.
- PostgreSQL and storage use explicit volume names `labos_postgres` and `labos_storage`.
- The API is exposed consistently on host port 4000 for local physical testing.
- PostgreSQL remains unpublished to the host.
- Both services receive their runtime environment directly from `.env.production`.
- Added `deploy/scripts/reset-clean-test.ps1`, which removes only the LabOS Compose project, its containers, and the two named LabOS volumes.
- Rewrote `deploy/README.md` to distinguish server reset from desktop-local reset and to explicitly prohibit running a second backend on port 4000 during physical testing.

Commits:
- `1e6fe053580e7bc1dea5e501178ad3f3d6346e80` — deterministic Compose baseline
- `3444b4d8c7159a126d19593bb7f4df4cb0d9f379` — clean-test reset script
- `2d04bacf6292f3bcbed616da1f8734e8cf0cbf03` — deployment/reset documentation

### Evidence classification

These are configuration/documentation changes and are **NOT runtime-verified yet**.

The user-reported symptom strongly indicates that the physical-test workstation also contains persistent desktop state or another API process. The clean reset must therefore cover both sides:

1. stop all LabOS/Tauri/Vite/backend processes;
2. remove the LabOS Docker containers and named volumes;
3. recreate PostgreSQL/API from current `main`;
4. verify exactly one API is listening on host port 4000;
5. remove the desktop's old `labos-local.db` and cached application/WebView state;
6. start the Tauri desktop from the same repository checkout;
7. create the first central administrator through the actual application flow;
8. verify login against the freshly recreated PostgreSQL database before creating any projects.

No claim is made that the user's current desktop session is clean until those steps are physically executed.


## CHANGE-014 — Repository cleanup for Codex handoff

**Date:** 2026-09-21

### Scope
Removed obsolete one-time development/test harnesses and generated backup artifacts from the tracked repository. The production application code, migrations, deployment compose configuration, backup/restore scripts, and architecture/evidence documentation remain.

### Removed
- Legacy phase/track/static test scripts under `backend/src/test-*.js`.
- Disposable runtime test harnesses for resource deduplication and sync.
- One-time schema/data helper scripts under `backend/src/fix-canvas-schema.js` and `backend/src/verify-total-contributed.js`.
- One-time backend data tools under `backend/tools/`.
- Tracked historical JSON reset/resource backups under `backend/labos-reset-backups/`.
- Test-only deployment compose configuration `deploy/docker-compose.test.yml`.
- Destructive one-time reset helper `deploy/scripts/reset-clean-test.ps1`.

### Package cleanup
`backend/package.json` now exposes only normal development/start/migration/syntax-check commands. Obsolete test and destructive data-management npm scripts were removed so the repository cannot advertise deleted one-time tooling.

### Deployment cleanup
`deploy/README.md` was rewritten as the stable deployment/operations guide. Destructive local resets are documented as explicit operator commands rather than a tracked reset script.

### Ignore rules
Added generated local reset backups and deployment backup output to `.gitignore` so future operator artifacts are not accidentally committed.

### Verification status
**STATIC ONLY / NOT RUNTIME-VERIFIED IN THIS ENVIRONMENT.** GitHub repository content was inspected before the cleanup. Runtime verification must be performed by Codex/local workstation after the cleanup commit is pulled.

### Handoff rule
Future automated tests should be maintained as intentional, named test infrastructure rather than accumulating one-time scripts in production source directories. Any new test harness must document its purpose, execution scope, cleanup behavior, and whether it is safe against disposable or persistent data.

## Evidence update — 2026-09-21 (fresh server and desktop-local physical-test reset)

### Observed cause

The reported "old data without login" condition was reproduced after resetting the Docker side alone. The PostgreSQL service was fresh, but the desktop was still reading its pre-existing local operational state:

- `%APPDATA%\\com.lab-inventory.app\\labos-local.db` contained the prior local SQLite state, including cached offline authorization;
- `%LOCALAPPDATA%\\com.lab-inventory.app\\EBWebView` contained the WebView local storage, including the browser-side remembered session.

This is consistent with LabOS's offline-first design: a previously authorized workstation may continue to operate from SQLite while disconnected. It does not mean the new PostgreSQL database contains the old projects/resources.

### Physical reset performed

1. Removed the obsolete `deploy` LabOS containers and their `deploy_labos_postgres`, `deploy_labos_storage`, `deploy_labos_test_postgres`, and `deploy_labos_test_storage` volumes. The obsolete API owned host port 4000.
2. Recreated the named `labos_postgres` and `labos_storage` volumes through the `labos` Compose project and started the Docker API/DB stack.
3. Closed the LabOS desktop processes and removed only the confirmed LabOS application-data directories listed above.
4. Relaunched the Tauri client against `http://127.0.0.1:4000/api`.

### Runtime verification — PASS

- Docker PostgreSQL is healthy and the Docker API health endpoint returned HTTP 200.
- The API initialized the base schema and applied 46 migrations.
- The fresh central PostgreSQL `users` table contains `0` rows.
- The newly created `labos-local.db` contains `0` `local_users` rows and `0` `local_session` rows.
- Its initialized synchronization state is only `inventory_snapshot = []`; no prior project/resource tables or pending local operations were present.

The expected next UI state is the unauthenticated first-run/login flow. Create the first central account through that flow before testing new data or synchronization.


## CHANGE-015 — Audit read access restriction (2026-09-24)

- Current main was inspected after Codex's recent commits; the audit GET route still required `reports.view`, which the viewer baseline includes.
- Added `audit.view` to the permission registry (admin baseline receives it automatically); changed `backend/src/routes/audit.js` to require it.
- Added a defense-in-depth admin-role check in `hasPermission('audit.view')` so even a mistakenly granted non-admin override cannot expose sensitive audit records.
- No finance-scope policy was assumed and no local databases were reset.
- Verification: STATIC ONLY — source fetched and edits committed on main; API runtime authorization tests NOT RUN in this environment. Required regression: authenticate as viewer/researcher and confirm audit GET returns 403; admin returns 200; non-admin with explicit `audit.view` override still returns 403; ensure audit UI and exports do not leak records.


## CHANGE-016 — Finance desktop mutation write-path correction (2026-09-24)

- Confirmed silent `catch {}` fallback to direct REST mutations in `desktop/src/api/transactions.ts`, `funding-sources.ts`, and `budget-periods.ts`.
- Removed the Tauri mutation fallbacks for create/update/delete in all three modules. Desktop now propagates local SQLite command failure; browser-only behavior retains REST writes. Existing read fallbacks were left unchanged pending separate review.
- No schema, migration, sync engine, finance visibility policy, or Codex UUID/resource changes were modified.
- Verification: STATIC ONLY — inspected fetched source and committed targeted replacements. Frontend TypeScript check, desktop runtime offline/reconnect test, outbox atomicity inspection, and API integration tests NOT RUN here. Check local Rust commands write entity+outbox atomically before declaring full offline-first compliance.
- Regression scenarios: force a local SQLite failure while online and verify zero direct POST/PUT/DELETE requests; create/update/delete offline and confirm one queued event per mutation, retry idempotency, and one server record after reconnect.


## CHANGE-017 — Transactional permission-change audit (2026-09-24)

- `backend/src/middleware/audit.js`: `writeAuditLog` accepts optional `client` (defaults to pool) and `required` (defaults to false). Required audit errors are logged and rethrown so callers can roll back; existing noncritical audit callers retain best-effort behavior.
- `backend/src/routes/auth.js`: user-permission override replacement and required audit INSERT now share the same PostgreSQL transaction, with COMMIT after both succeed. Existing catch rolls back on failure.
- Scope: permission override updates only. Account creation, role/status changes, password changes, and deletion events remain separate follow-up work; do not infer they are transactional.
- Verification: STATIC ONLY. GitHub source edits committed; no backend Node syntax execution or live PostgreSQL failure-injection tests run here. Required tests: successful override produces audit row; forced audit INSERT failure rolls back overrides; confirm no partial change; existing noncritical audit behavior remains best-effort.


## CHANGE-018 — Critical account audit atomicity (2026-09-24)

- `backend/src/routes/auth.js`: first-account registration now inserts the administrator and required audit event in the same PostgreSQL transaction; JWT is issued after COMMIT. Existing registration advisory lock retained.
- Administrator/delegated account creation now inserts the account and required audit event in the same transaction; an audit failure rolls back account creation.
- Role/account-status updates now acquire a transaction-scoped advisory lock (981235), lock the target row with `FOR UPDATE`, check last-active-admin under the lock, update the account, insert the required audit event, then COMMIT. All early-return paths after BEGIN explicitly ROLLBACK before releasing the connection.
- Existing role and permission checks are retained. No changes to finance scope or desktop synchronization.
- Verification: STATIC SOURCE INSPECTION ONLY. Live PostgreSQL integration and concurrent requests NOT RUN. Required failure injection: make audit INSERT fail and verify registration, user creation and role/status changes leave no committed account changes. Concurrently attempt to disable/demote two active admins; verify at least one active admin remains. Confirm existing permission override audit transaction and first-account registration behavior.
- Remaining critical scope: self-service and administrator password changes are still best-effort audited; address in a separate targeted pass. Do not claim full audit transactionality yet.


## CHANGE-019 — Transactional password security events (2026-09-24)

- `backend/src/routes/auth.js`: self-service password change and administrator-initiated password reset now use one PostgreSQL transaction per operation. Target account is locked with `FOR UPDATE`, password hash is updated, required `user_password` audit row is inserted through the same client, then COMMIT. Failed credential check, missing target, and forbidden admin target explicitly ROLLBACK before returning.
- The audit event does not contain password material or password hashes. Existing password-length validation and target authorization retained.
- Verification: STATIC ONLY; source committed on main. Required live tests: correct old password updates successfully with audit row; wrong old password leaves hash unchanged; unauthorized admin-target reset denied; forced audit insert failure leaves hash unchanged for both paths; concurrent self-service changes revalidate under row lock. Run `npm run check` and backend integration suite before runtime PASS.


## CHANGE-020 — Project-linked finance mutation authorization (2026-09-24)

- Inspected `transactions.js`, `project-transaction-boundary.js`, `funding-sources.js`, `budget-periods.js`, `sync.js`, and finance permission baselines.
- Found REST transaction DELETE only checked `finance.delete` and did not verify edit access to the transaction's project. Added `requireExistingTransactionProjectDelete` and attached it to DELETE.
- Found transaction PUT checked the destination project (`req.body.project_id`) instead of checking both the existing project and destination when moving transactions. It now verifies edit access for each distinct non-null project ID.
- IMPORTANT unresolved product decision: `finance.view` currently exposes lab-wide transactions, budget periods, funding sources and `/sync/finance/pull` to multiple default roles. Do not claim project-scoped confidentiality until policy is selected and enforced consistently in REST, summaries, sync pull, tombstones, and local SQLite cache. Project-less transactions and shared budgets/funding sources need explicit policy; do not treat null project as automatically public.
- Verification: STATIC ONLY. Test unauthorized project transaction DELETE and cross-project PUT (including setting `project_id` to null); permitted project mutations; browser API and offline sync parity. Additional TO DO: inspect `applyFinanceEntity` sync push for the same existing/destination access invariants and protect funding-source detail transaction histories under the chosen finance visibility policy.


## CHANGE-021 — Initial transparent-expenditure / restricted-funding server enforcement (2026-09-24)

Policy agreed: all active authorized staff may see laboratory expenditure; income amounts, funding-source identities and contacts, actual available balances and detailed budgets are restricted to administrators and explicitly granted users. Do not expose balances indirectly through summaries or reports.

- Added `finance.view_sensitive` to the permission registry; admin baseline inherits it; other roles do not receive it by default. Explicit per-user grant supported by existing override system.
- `GET /transactions` limits non-sensitive viewers to `direction='expense'` and masks joined funding-source names and budget-period labels. `GET /transactions/summary` computes expenditure-only totals and categories for non-sensitive viewers and omits detailed budget balances. The restricted summary's income total is zero as an output-shape placeholder, not a representation of actual income; frontend must not label it actual income.
- Funding-source list/detail and budget-period read endpoints now require `finance.view_sensitive`.
- `/sync/finance/pull` limits non-sensitive viewers to expense transactions, no funding-source or budget-period rows, and no funding/budget tombstones.
- **NOT COMPLETE / SECURITY FOLLOW-UP REQUIRED:** Existing desktop SQLite caches may retain previously downloaded income/funding/budget data after permissions change. Add permission-aware purge/reconciliation on reconnect, local read authorization and UI gating. Review all reports/exports/other API routes and sync push for indirect disclosure and authorization. Expense `t.*` and sync payloads may contain `funding_source_id`, `budget_period_id`, `notes`, vendor or other sensitive text; establish redaction policy and apply consistently. Transaction tombstones can reveal identifiers; assess. Test permission revocation and re-grant, direct URL access, sync pull, and offline cache on disposable DB. Static review only; no runtime tests executed.


## CHANGE-022 — Reports audit access and desktop finance read fail-closed behavior (2026-09-24)

- `backend/src/routes/reports.js`: reports overview previously returned aggregate `audit_log` action counts to any `reports.view` user despite admin-only `audit.view` policy. Now only administrators with `audit.view` receive activity rows; other authorized report viewers receive an empty activity array.
- Desktop `transactions.ts`, `funding-sources.ts`, `budget-periods.ts`: local finance read failures no longer silently fall back to REST. This avoids bypassing local access errors and inconsistent offline/online data behavior; browser-only reads continue to use REST.
- Verification STATIC ONLY; test reports overview as viewer, researcher, admin, and non-admin explicitly granted `audit.view`; desktop disconnected reads, local DB failures, and browser REST.
- SECURITY BLOCKER STILL OPEN: desktop local SQLite finance read commands and summary may expose previously cached income, funding and balances to non-sensitive users. Implement permission-aware local access, cache reconciliation/purge after revocation, and sync regrant. Review all finance exports and reports, expense field redaction, and sync push. Do not claim complete finance confidentiality until these are addressed and tested.


## CHANGE-023 — Local finance read authorization and API field redaction (2026-09-24)

- `desktop/src-tauri/src/local_finance.rs`: all local finance reads now require valid `finance.view` authorization; funding-source and budget-period reads additionally require `finance.view_sensitive`; transaction reads for non-sensitive users filter out income and remove funding/budget IDs and joined labels. This protects Tauri command access as well as UI display, including previously cached rows when accessed via these commands.
- `backend/src/routes/transactions.js`: expense listing removes funding/budget identifiers and labels for non-sensitive users; summary income and net are `null` instead of misleading zero. `backend/src/routes/sync.js`: finance pull removes funding/budget identifiers from ordinary users' expense records.
- **Not fully complete:** historical sensitive data remains physically stored in local SQLite; implement authenticated server-permission reconciliation and safe purge after pending outbox processing, considering shared-PC accounts. Audit all raw local DB and backup access, sync push authorization, and UI handling of null totals. Sensitive expense notes/vendor fields require a defined redaction policy. Test Rust compilation, JS route syntax, role/revocation matrix, and SQLite offline behavior. All GitHub edits are static; no runtime tests executed.


## CHANGE-024 — Finance sync push authorization and SQLite permission reconciliation (2026-09-24)

- Sync push `applyFinanceEntity`: validates income/expense create permissions by direction, requires sensitive access for income edits/deletions and funding/budget mutations, and checks project edit rights on both old and destination project for transaction mutations. Project access return shape verified against `project-transaction-boundary.js`.
- Finance pull includes `sensitive_access` computed server-side from effective permissions. Desktop passes it to `apply_server_finance_pull`; Tauri independently requires local `finance.view` and `finance.view_sensitive` where applicable.
- Non-sensitive desktop pull performs a SQLite transaction replacing cached transactions with redacted server expense rows and clearing cached funding sources and budget periods. If unsent finance outbox changes exist, it refuses destructive reconciliation and reports an error. Restricted local finance read commands already enforce current local permissions.
- Offline income create now requires `finance.create_income` and sensitive access; income edit/delete require sensitive access; local funding/budget mutations require sensitive access.
- **STATIC ONLY — NOT RELEASE VERIFIED:** GitHub connector changes not compiled or runtime-tested. Must verify Node syntax, Rust compilation, sync push project authorization, user permission refresh/revocation, desktop sync retry, cache purge, pending outbox conflict resolution, shared-device cross-user caching, filesystem/backup exposure, and UI null income/net handling. Existing SQLite backups and previously exported files cannot be remotely purged. Review project budget fields, expense free text and other indirect disclosure paths. Local finance mutation write/outbox atomicity remains a separate known concern.


## CHANGE-025 — Conflict resolution page foundation (2026-09-24)

- Fixed sync_conflicts INSERT missing operation parameter, which prevented rejected changes from being recorded.
- Added desktop/src/pages/SyncConflictsPage.tsx, /sync/conflicts route, and sidebar navigation. Displays unresolved conflicts and error details; offers retry-local and accept-server actions with confirmation.
- Removed silent failure-to-empty fallback in listSyncConflicts, allowing actual loading errors to appear.
- STATIC ONLY, NOT RELEASE VERIFIED: compile and runtime testing required. Remaining: per-user conflict visibility (especially finance payloads), server-side comparison and movement reconciliation, verify retry/refresh per entity, implement datasheet/specs and quick-use search actions. Finance verification blockers from CHANGE-024 remain.


## CHANGE-026 — Search item actions and finance conflict guard (2026-09-24)

- Created desktop/src/components/SearchItemActionModal.tsx. Datasheet & Specs mode loads item metadata and associated Resources records, filters relevant document types/tags and supports a document access URL and embedded PDF when supported. Quick Use mode preloads item details, quantity 1 and active project options, and submits existing local-first inventory movement API using consume for components and checkout for tools/equipment inferred from item type. No parallel stock mutation pathway was introduced.
- Updated desktop/src/pages/SearchPage.tsx item result cards to expose both actions without navigating to item detail. Existing card navigation remains.
- Updated desktop/src-tauri/src/local_db.rs conflict listing and resolution to require authenticated local inventory.view and sensitive finance permission for transaction/funding/budget conflict payloads. This is a coarse safeguard; review role-specific visibility and non-finance entities before release.
- STATIC ONLY: no TypeScript/Rust build or runtime tests executed. Validate resource URL behavior offline, project access and item classification for checkout vs consumption, quantity race/stock limits, movement history, shared SearchDock parity, accessibility, and finance-conflict payload exposure. Finish finance verification items from CHANGE-024 and conflict behavior from CHANGE-025. User-facing implementation is not release verified.


## CHANGE-027 — Compact Search Dock action parity and stock permission (2026-09-24)

- Added Datasheet & Specs and Use item buttons to Search Dock item results, reusing the same modal as full Global Search; retained item detail navigation.
- Quick Use modal now checks effective inventory.adjust_stock permission before presenting movement submission. Server/local inventory movement authorization must remain authoritative.
- Checked combined GitHub commit status for Search Dock commit b67d4f1: no reported status checks; this is not evidence of passing CI. Static connector-only edits; no frontend build, Rust compilation, or runtime tests executed.
- Outstanding: test both search surfaces, modal document access and offline cache, quick checkout/consumption and project permissions, conflict handling and finance security items from prior changes. Resolve user-specific project eligibility and reusable item classification against authoritative item schema before release.


## CHANGE-028 — Inventory acquisition provenance (2026-09-24)

- Added PostgreSQL migration backend/src/migrations/20260924_inventory_acquisition.sql with acquisition_method (unspecified/purchased/salvaged/donated/transferred/fabricated/other), acquisition_source and acquisition_notes. Existing inventory defaults to unspecified; no invented purchase history or zero-cost valuation.
- Backend inventory create and update routes persist provenance; offline inventory sync ITEM_FIELDS includes all three fields. Desktop Item type and Add Item form now capture method, source and optional notes, with contextual donor/salvaged-from prompts. Unit purchase cost remains optional and replacement cost separate.
- All edits directly committed to main. STATIC ONLY: migrations, backend checks, TypeScript build and online/offline roundtrip tests not executed. Before deployment run npm run migrate against staging, verify migration on existing data, item create/update, offline create/push/pull, reports and exports; review whether donation details need access controls. Existing finance and search-action verification blockers remain.


## CHANGE-029 — Finance Budgets screen investigation (2026-09-25)

Screenshot showed 'Unable to load lab budgets', 'Unable to load funding sources' and 'No projects yet'. Source inspection: desktop budget/funding API invokes get_local_budget_periods/get_local_funding_sources; Rust local_finance::all requires finance.view_sensitive for both, so users with only finance.view get an authorization error that BudgetsView formerly rendered as generic load failure. Projects query has a separate source and an empty result is not proof of a backend error. Updated BudgetsView to fetch effective permissions, skip sensitive queries without permission, and show access-specific explanations rather than misleading retry errors. Sensitive create actions hidden unless finance.edit and finance.view_sensitive; delete buttons disabled without those permissions. This does not grant permissions or change backend checks.

STATIC ONLY: no desktop runtime logs or account permission snapshot available, so cannot conclude screenshot user's actual permission state; network, local cache and schema errors remain possible for authorized users. No TypeScript build or runtime test executed. Investigate empty project list against local cache and server and audit finance summary null/zero and project budget visibility. Finance security issues from CHANGE-024 remain open.


## CHANGE-030 — Correct false finance access-denied state for admin (2026-09-25)

User confirmed finance records are empty and current account is admin. Investigation identified desktop/src/api/auth.ts getCurrentPermissions silently swallowed both local and server lookup errors and returned [], which CHANGE-029 BudgetsView interpreted as actual absence of finance.view_sensitive. Server role baseline explicitly includes all permissions for admins; therefore permission-fetch failures must never be represented as confirmed access denial. Updated getCurrentPermissions to surface failures and, when a non-local token is available, refresh from server and update cached permissions. Updated BudgetsView to show a retryable verification error rather than a misleading restriction notice when permission lookup fails. No role-based client-side bypass of backend/local authorization introduced. STATIC ONLY: no local desktop runtime or TypeScript build tests executed; still investigate initial cache bootstrap, admin session sync, and empty finance lists after actual runtime verification.


## CHANGE-031 — Persistent false admin finance restriction (2026-09-25)

- New screenshot after CHANGE-030 still shows access-restricted copy on both Lab Budget and Funding Sources. This means a permissions lookup may be returning a non-error but incomplete permission list, rather than throwing. Actual device runtime state remains unverified.
- Updated desktop/src/api/auth.ts getCurrentPermissions: when the stored user is admin and the local permission set omits finance.view_sensitive, do not treat the stale cache as authoritative; with an online token fetch the server's effective permissions and refresh the local cache. Without an online session show an actionable stale-cache error, never silently grant finance access.
- Updated BudgetsView to distinguish an admin permission-cache mismatch from an actual nonadmin restricted state. Existing server and local finance authorization remains authoritative.
- STATIC ONLY: no local device logs or build/tests executed. Confirm desktop was rebuilt with latest main, sign in online and test admin local_current_permissions, get_local_budget_periods and get_local_funding_sources returning [] for an empty dataset; if these still fail inspect local auth session and SQLite sync_state. Never bypass local finance authorization merely because UI claims admin.


## CHANGE-032 — Unresolved administrator Finance access display; handoff to Codex (2026-09-25)

**Status: OPEN — NOT FIXED. Assigned to Codex for investigation and remediation.** User explicitly confirms that the Finance > Budgets screen still shows sensitive-finance access restriction messages for Lab Budget and Funding Sources while signed in with an administrator account and with no finance records. Previous CHANGE-029 through CHANGE-031 changes did not resolve the observed behavior. Do not mark the issue complete based on those commits or infer that empty data means unauthorized access.

Codex handoff: reproduce in the actual desktop app with the affected admin session; confirm that the running build contains the latest main commits; trace stored user, local session, local_current_permissions, server /auth/me/permissions, cache_server_permissions, finance.view_sensitive and finance.edit, and both get_local_budget_periods and get_local_funding_sources. Determine whether the fault is stale/mismatched account permissions, cache refresh, local authorization, UI state, or another runtime error. Ensure authorized admins with empty datasets see 'No lab budgets yet' and 'No funding sources yet' with permitted creation actions, while real permission denials and load errors remain distinct. Do not bypass local/server permission enforcement or silently grant access based solely on a frontend role label. Test online login, offline cached admin session, permission expiry, user switching, and nonadmin access; record actual logs, commands, test results, root cause, commits, and residual risks in this log.

**Verification:** User screenshot and explicit report confirm unresolved behavior; no successful end-to-end desktop verification has been performed. Pause further speculative fixes here; Codex owns follow-up.


## CHANGE-033 — Datasheet attachment beside item image (2026-09-25)

- Updated desktop/src/components/ItemPicture.tsx (used on Item Detail) to use a compact two-column responsive layout: existing item picture on the left and a datasheet attachment panel immediately beside it on the right. Supports PDF/DOC/DOCX/TXT upload, lists associated datasheets, opens them using existing authorized Resources access URL, and supports confirmed removal. Reuses existing Resources item_id linkage, category=datasheet and datasheet tag; invalidates item-linked Resources cache after upload/removal, so Search Datasheet modal can discover the attachments.
- File upload uses the existing central backend uploadFile API and therefore requires connectivity; no claim of offline file upload support. No new document storage system or schema added.
- STATIC ONLY: no desktop build or runtime verification. Verify item detail layout at desktop and narrow widths, upload permissions, backend availability, file viewing and removal, resource cache, and Search Datasheet modal visibility. Existing admin finance issue CHANGE-032 remains assigned to Codex and unresolved.


## CHANGE-034 — Compact persistent top actions in long modals (2026-09-25)

- Updated AddItemModal and ManageBudgetPeriodsModal and ManageFundingSourcesModal to use a non-scrolling, compact header with action buttons and an independently scrolling body. Form submissions retain existing handlers and pending-state disablement; finance form top Save/Add uses the form attribute to submit its scrollable form. Close remains available at the top.
- Accessibility: added dialog roles/aria-modal to these forms and an accessible close label in finance management modals. Remaining: focus trap, focus return, unsaved-change warnings, keyboard Escape policy and systematic audit of all other modals. No finance permissions or data logic changed; unresolved admin finance issue CHANGE-032 stays assigned to Codex.
- STATIC ONLY: no TypeScript build or desktop runtime checks executed. Verify top action buttons, validation focus and scrolling, keyboard operation, small screens and all affected forms before release. Extend this pattern to remaining long modals after verification.


## CHANGE-035 — Persistent actions in transaction and Excel finance modals (2026-09-25)

- Updated LogTransactionModal: compact fixed top Save/Cancel bar, separately scrollable form body, explicit dialog name/role and alert semantics for submission errors. The existing submit handler, validation and pending-state lock remain in place; top Save uses HTML form association.
- Updated ExcelFinanceModal: compact fixed top Close/Validate/Import actions with independently scrollable workbook content. Retained preview-before-import gating and disabled actions while busy. Removed bottom-only action bar.
- All changes committed directly to main. STATIC ONLY: no TypeScript compilation or desktop runtime testing was executed. Validate responsive layout, keyboard tab/focus, form submission, inline error visibility, long workbook previews and finance permission behavior before release. Continue auditing other long modals, add focus trapping and return focus, and confirm unsaved-change protection. CHANGE-032 unresolved admin finance access remains assigned to Codex.


## CHANGE-036 — Shorter generated inventory SKU (2026-09-25)

- Updated both desktop/src/api/item-sku.ts and backend/src/routes/items.js SKU generators to use LAB-<name>-<type initial>-<existing six-character random hex suffix>. Single-word names contribute their first four alphanumeric characters; names with two or more words contribute the first two characters of each of the first two words; type contributes its first alphanumeric initial. Examples: Arduino/component -> LAB-ARDU-C-XXXXXX; Power Supply/equipment -> LAB-POSU-E-XXXXXX. The existing six-character UUID-derived suffix remains unchanged. Manual SKUs and previously saved SKUs are untouched; no database migration.
- STATIC ONLY: no build or runtime tests executed. Verify desktop/backend format parity, offline creation and sync, collisions/unique constraint behavior, punctuation, short names and existing SKU preservation. CHANGE-032 unresolved admin Finance issue remains assigned to Codex.


## CHANGE-037 — Confirm resource deletion and bulk selection (2026-09-25)

- Added confirmation before each Resources card delete. Item Detail already had a delete confirmation; a repository-wide audit of other destructive actions is still outstanding.
- Added keyboard-accessible checkbox selection on Resources cards, Select all, Clear, selection count and Delete selected. Bulk delete requires one explicit confirmation with count, executes the existing deleteResource API sequentially, retains failed selections and reports partial failure rather than claiming all succeeded. No new backend bulk endpoint or implicit bypass of existing per-resource authorization. Selected IDs are pruned when the resource query changes.
- STATIC ONLY: no frontend compilation or runtime tests executed. Verify nested card keyboard interactions, permissions, offline deletion, concurrent changes, partial failures, bulk selection of many records and accessibility. Expand bulk actions to metadata editing/association only after defining safe per-record permissions and validation. Review remaining deletion flows for consistent confirmation. CHANGE-032 finance issue remains open for Codex.


## CHANGE-038 — Destructive-action confirmation audit (2026-09-25)

- Continued CHANGE-037: added explicit confirmation before deleting a budget period or funding source in management modals; added accessible names and pending-state disablement to their delete buttons.
- Item Picture removal now asks for confirmation. Replacing an existing picture still uses the existing upload-and-replace flow; verify replacement cleanup separately.
- Project Detail now confirms deletion of tasks, experiments, measurements, observations and comments, and confirms removing project members. Added accessible names to compact measurement, observation and member removal buttons. Existing Inventory bulk delete and Item Detail delete already require confirmation.
- No server API or permission changes; existing per-action authorization remains authoritative. Changes committed directly to main.
- STATIC ONLY: no TypeScript build, unit tests or desktop runtime tests executed. Audit remaining deletion/unlink/detach actions, verify confirmation wording and keyboard operation, and consider an accessible reusable confirmation dialog rather than native window.confirm for consistent focus handling. CHANGE-032 unresolved admin finance issue remains assigned to Codex.


## CHANGE-039 — Attach resources after creation and bulk attach (2026-09-25)

- Added PUT /resources/:id/attachment: moves an existing top-level resource to an item, project or note (or detaches it) without reuploading. Enforces source resource editor permission, destination parent authorization, and the existing single-parent invariant; refuses nested resources. Audits before/after values. A move replaces the previous direct attachment; this is NOT many-to-many sharing.
- Added desktop API attachExistingResource. This operation is server-backed, requires connectivity, and updates local resource cache after a successful response; offline attachment queue and resource sync update support are NOT implemented.
- Resources page now has Attach / Move on individual cards and Attach selected in bulk toolbar. Both open a compact destination selector for projects, items and notes. Bulk action uses per-resource authorization via sequential existing API calls; preserves failed selections and reports partial failures. Warns before moving previously attached resources. No new backend bulk endpoint.
- STATIC ONLY: no TypeScript build, backend tests or runtime verification. Test server access controls, resource ownership, cross-project moves, cache refresh after online reassignment, failure/retry behavior, selection keyboard access, and folder/nested resource handling. Current schema permits one direct parent only; supporting one resource in multiple projects simultaneously requires a separate junction table and access/sync model. Codex admin finance issue CHANGE-032 remains unresolved.


## CHANGE-040 — Contextual resource selection controls (2026-09-25)

- Resource card checkboxes are visually hidden until card hover or keyboard focus, matching the existing contextual delete button. A checked box stays visible even after pointer hover ends so selection remains obvious. Keyboard focus reveals the checkbox through group-focus-within; native input retains its accessible label.
- The resource bulk-action bar now appears only when at least one resource is selected; it disappears when selection is cleared or all selected resources are deleted. Existing Select all, Clear, Attach selected and Delete selected actions remain unchanged.
- STATIC ONLY: no desktop runtime or frontend build verification. Test keyboard-only focus, touch-device selection discoverability, selected-state contrast, and bulk toolbar appearance/disappearance. CHANGE-032 finance issue remains open for Codex.


## CHANGE-041 — Resource permission visibility and attachment authorization (2026-09-25)

- Audited Resources UI and found newly added Attach/Move, bulk actions and delete controls had no permission-aware visibility; corrected using effective resources.create/edit/delete permissions from getCurrentPermissions. Resource selection checkbox is hidden when neither edit nor delete is allowed. Create controls are disabled without resources.create; bulk attach and per-card attach hidden without resources.edit; delete controls hidden without resources.delete. Permission lookup fails closed.
- Added explicit server resources.edit permission enforcement to PUT /resources/:id/attachment, in addition to existing source-resource editor and destination authorization checks.
- LIMITATION: per-resource/project-specific editor access is enforced by server but not yet represented in individual card visibility; a globally authorized user with read-only access to a specific project may still see its action and receive 403. Existing resource DELETE and metadata endpoints use requireResourceEditor; a separate comprehensive server permission audit for all legacy routes is still required. Resource modal edit entry points and offline authorization also need dedicated review.
- STATIC ONLY: no build, unit or runtime permission-matrix testing performed. Test viewer/member/technician/researcher/admin, custom overrides, project read-only, shared uploader, permission refresh and offline behavior. CHANGE-032 finance issue remains Codex-owned.


## CHANGE-042 — Destructive action safety follow-up (2026-09-25)

- Reported accidental deletion involved test data; prevention is the priority. Resources individual and bulk delete now stage an in-app confirmation dialog instead of relying on native window.confirm (commits 119d935, 69f98cd). Inventory bulk delete also now requires an in-app confirmation (commit b89bc07).
- Both dialogs default focus to Cancel, show an explicit Delete permanently action and allow Escape to dismiss. No deletion is triggered by merely opening the dialog.
- UNVERIFIED: no running Tauri desktop session or build/test result available from GitHub file editing. Keyboard focus trap and focus restoration, cross-page native confirmation audit, and soft-delete/restore remain outstanding. Do not label platform-wide deletion safety complete.


## CHANGE-043 — Finance management deletion dialogs (2026-09-25)

- Replaced native window.confirm in ManageBudgetPeriodsModal and ManageFundingSourcesModal with in-app alertdialogs. Both stage the selected ID and name, default focus to Cancel, support Escape, and call the delete mutation only after the explicit Delete permanently action. Mutations remain disabled while pending.
- Commits: 86d6a368c9c35ab590154a5c2bfdb24d9b79fe33 and 3d8a21fa21e79d1a53ebce5f33d4e9147addf3e2.
- STATIC ONLY: GitHub file edits; no local frontend build, Tauri runtime or automated accessibility test performed. Verify nested dialog focus trap and focus return, mutation success/error, Escape behavior, permissions and actual desktop rendering. Existing Finance admin loading defect (CHANGE-032) remains assigned to Codex. Continue auditing remaining native confirms before claiming platform-wide completion.


## CHANGE-044 — Item image and datasheet removal confirmation (2026-09-25)

- Replaced native window.confirm for ItemPicture's explicit Remove picture and Remove datasheet buttons with a staged in-app alertdialog. Dialog names the target, initially focuses Cancel, supports Escape, and invokes the existing mutation/API only after Remove permanently. Commit e17688b64872ceeaad01e10198685348c480d6c7.
- LIMITATION: picture replacement still deletes the prior resource automatically after successful upload/update, which is an intended replacement workflow and requires separate retention/recovery design. No soft-delete exists.
- STATIC ONLY: no TypeScript build, desktop runtime or keyboard/screen-reader test performed. Focus trapping/return and permission-specific visibility remain to verify. ProjectDetailPage still has native confirmations and is next in the audit. Do not claim deletion-safety completion.


## CHANGE-045 — Project workspace destructive-action confirmation (2026-09-25)

- Replaced all six window.confirm calls in desktop/src/pages/ProjectDetailPage.tsx with a shared context-driven in-app alertdialog. Affected actions: task deletion, experiment deletion, measurement deletion, observation deletion, project member removal and comment deletion. The dialog stages a callback; only explicit Confirm permanently invokes the mutation. Cancel and Escape dismiss; Cancel has initial focus. Commit 46f9985f3725a45633202505a2ac879f94897770.
- STATIC ONLY: no TypeScript build or Tauri runtime verification. Test each of six operations, role restrictions, nested modal focus trapping and focus restoration, double-click prevention, screen reader labels and error behavior. Project attachment unlink/detach flows and other pages still require separate audit. No recycle bin/soft-delete implemented.


## CHANGE-046 — Laboratory Operations overview load failure (2026-09-25)

- User supplied a desktop screenshot showing 'Unable to load laboratory operations'. Static trace found desktop/src/api/operations.ts called get_local_inventory_items, which is absent from the Tauri command registration in desktop/src-tauri/src/main.rs. This throws before the Operations overview renders.
- Updated localOverview to use the existing getItems() inventory API, preserving its local snapshot path; corrected category counts to use the canonical item.type values (including spare_part). Commit a01f613d11318054879aafa6cc6ac35fc52297d1.
- STATIC ONLY: no Tauri runtime, build or user data verification performed. After pulling/rebuilding, check online and offline overview, inventory totals, low-stock logic, empty cache behavior, requirements and supplier endpoints. The existing getItems() implementation can attempt remote loading when local snapshot is absent; do not claim fully offline first-run coverage.


## CHANGE-047 — Requirements and BOM aggregation; Codex revisit requested (2026-09-25)

Decision: Keep project resource Requirements and project BOM as distinct records. Requirements describe broader project resource needs and status; BOM lists component quantities and preferred/alternative inventory matches. Laboratory Operations should aggregate both without silently creating duplicate records or consuming stock.

Changes on main:
- 094030b7116bc6a0d135688240f9f1cea40e0d2e: desktop local Operations overview aggregates project BOM shortages, outstanding requirements, inventory names/quantities, low stock, calibration dates and equipment from local-first APIs. Previously local BOM was always an empty array. Project/BOM read errors now propagate rather than masquerading as zero shortages.
- 2fbb513d7cd1da0fb1df84c0b4b11596561d7191: project BOM panel resolves current preferred/alternative inventory names and quantities from inventory rather than depending exclusively on server-enriched BOM fields.

IMPORTANT LIMITATIONS: This is a quantity-only availability comparison, not a reservation/allocation engine. A component can appear available to multiple projects simultaneously. Local maintenance_due is still empty. Stock valuation is not permission-redacted in local overview; inspect access control before release. No build, tests, desktop runtime, or synchronization verification has been performed. A local project BOM reader may return differently shaped records than the remote API; verify with realistic data.

### NOTE FOR CODEX — Revisit Laboratory > Operations > Overview > Project readiness and Requirements

Please independently review these exact screens and their upstream sources after the above changes. Verify desktop offline and online operation, first-run empty cache, sync/outbox correctness, permission handling, and consistency of local vs PostgreSQL aggregation. Check that BOM shortages use actual stock and alternatives correctly, and that Requirements reflects current status and preferred item quantity. Investigate linking Requirements to BOM without creating duplicate demand, project navigation, shortage drill-down, cross-project contention, unit conversion, and eventual reservation/procurement workflow. Check calibration and maintenance coverage and avoid claiming completeness where local data is absent. Review BOM delete confirmation (still direct) and supplier delete confirmation (still direct). Provide reproducible tests, screenshots or logs, documented decisions, exact commits, and remaining risks. Do not silently redesign or merge the two data models; request approval for structural changes. Finance admin loading issue (CHANGE-032) remains separately Codex-owned.


## CHANGE-048 — BOM and supplier deletion safeguards (2026-09-25)

- ProjectBomPanel: staged removal with an in-app alertdialog identifying the BOM component, initial Cancel focus, Escape dismissal, keyboard Tab cycling and explicit Remove permanently. Commit e7a23b9d0cba90135c7c65142b5d72735ae3d12e.
- OperationsPage Suppliers: replaced direct delete mutation with an in-app alertdialog identifying the supplier, initial Cancel focus, Escape dismissal, keyboard Tab cycling and explicit Delete permanently. Commit 1fddc240495c11662c0f6b660560beebb538d5a0.
- STATIC ONLY: GitHub edits, no build, runtime or automated accessibility tests. Dialog focus return, data retention, pending mutation error and offline supplier behavior need verification. The previous CHANGE-047 Codex note to revisit Laboratory Operations Overview/Requirements and BOM aggregation remains open. No soft delete or restore mechanism exists yet.


## CHANGE-049 — Operations regression verification handoff (2026-09-25)

Commit 28fa26a7e1c36a5102159619b24f2fb3c3d45882: Operations failure state now displays the underlying query error instead of only 'The operational summary could not be retrieved'. The original 'Try again' remains. Treat error text as potentially sensitive; review production logging and user-visible sanitization before release.

VERIFICATION STATUS: NOT EXECUTED. GitHub connector allowed source inspection and file edits but no full repository checkout, desktop runtime, backend, database or CI test runner. Desktop package.json has `npm run build` (tsc and Vite), but no dedicated test script for Operations/BOM/Requirements. Do not mark any of the following as passing until evidenced.

### Required execution checklist for Codex / desktop tester

1. Pull main and record commit SHA. In desktop run `npm ci` and `npm run build`; in desktop/src-tauri run `cargo check`. Record commands, versions, logs, exit codes and failures. Test installed Tauri app separately from web preview.
2. With populated local SQLite, disconnect backend/network. Open Laboratory > Operations > Overview and Requirements; verify actual inventory totals, stock value, low-stock and calibration, no false 'no shortages', and supplier failure does not crash the overview. Repeat with empty local snapshot and record the explicit behavior.
3. Create two projects with overlapping preferred BOM stock and a third BOM line with an alternative. Verify per-line quantities and names in Project BOM, cross-project shortage counts in Operations, pagination, and that no stock is silently consumed. Document the known limitation: each line is checked independently; competing projects do not reserve stock.
4. Create/edit/delete a project resource requirement offline, sync to PostgreSQL and pull to a second workstation. Verify quantity, status, preferred item, project name and absence of duplicates. Test conflict resolution and revoked permissions.
5. Test deletion confirmations for BOM lines and suppliers: open/cancel/Escape/Tab/confirm, mutation failure, keyboard focus return, double-click and read-only user. Ensure no API call occurs before confirmation. Verify supplier delete with backend unavailable shows an actionable error rather than success.
6. Repeat Operations with backend online, compare local and server BOM shortage results using identical fixtures, verify project visibility permissions, units, partial stock and missing preferred/alternative IDs. Inspect API errors in the new diagnostic panel and remove sensitive details before production release.
7. Add automated regression coverage for pure BOM shortage calculation, requirements filtering and modal confirmation; preserve test fixtures and link CI runs/screenshots here.

### Codex reminder

Independently revisit Laboratory > Operations > Overview > Project readiness and Requirements, plus Project > Bill of materials. Cross-check CHANGE-047 aggregation and CHANGE-048 safeguards against actual SQLite/PostgreSQL records and UI behavior. Report defects with exact reproduction steps and commit IDs. Keep Requirements and BOM distinct until a reviewed design explicitly connects them. CHANGE-032 Finance loading issue remains separately assigned.


## CHANGE-050 — First GitHub Actions verification and remediation (2026-09-25)

Workflow run https://github.com/Bonsinnoba/lab-inventory-app/actions/runs/36194475363 on ef847f34fc22bdc954c22453eb1f6485f3d55fe7: backend syntax PASS; desktop TypeScript/Vite FAIL at ResourcesPage.tsx:25 (TS2339 mixed Item|Project|Note name/title); Tauri Rust FAIL because generate_context! requires ../dist, absent in isolated Rust job. Full job logs retrieved from GitHub Actions, not inferred from screenshot.

- 75720c242802ea8e88b43c11bed9c28e835bd3f1: normalize Resources attachment destination list into common optional name/title fields before lookup; intended to fix TS2339.
- 8f5fbdbb75ee5e179310b7ff4afe63689b7b8444: add frontend npm ci/build step to isolated Rust job before cargo check --locked so ../dist exists.

Follow-up: inspect fresh workflow run for 8f5fbdb; if desktop or Rust still fails, fetch job logs and remediate the next concrete error. The prior Rust log also reports seven warnings, which are not the failure cause. The checks do not exercise SQLite/offline behavior, PostgreSQL synchronization or UI interactions; CHANGE-049 regression matrix remains open. Codex should revisit Laboratory Operations Overview/Requirements and Project BOM as specified in CHANGE-047/049.


## CHANGE-051 — Tauri icon failure exposed by CI (2026-09-25)

Run https://github.com/Bonsinnoba/lab-inventory-app/actions/runs/36197918635: desktop TypeScript/Vite PASS, backend syntax PASS, Tauri Rust FAIL (`tauri::generate_context!` could not read `desktop/src-tauri/icons/icon.png`; exit 101). The prior missing `../dist` error was resolved by building the frontend first. `build.rs` materializes `icon.ico` from `icons/icon.ico.b64`, but does not materialize `icon.png`; the Tauri macro requires PNG even though tauri.conf.json lists ICO. Commit 4e2f12bc58acb7f09f6360e36e393d58b6703fa3 adds a CI step to derive PNG from the existing embedded ICO with Pillow before `cargo check --locked`. This is a CI fixture, not a validated installer/package fix. Verify subsequent workflow result and separately audit real desktop build packaging/icon generation. Node 20 deprecation and Ubuntu runner notices are nonblocking warnings.


## CHANGE-052 — First automated BOM and Requirements regression tests (2026-09-26)

- 2f7348e3fac02c644b8b9489f219bc70da419f1b: extracted pure `findMissingBom` and `enrichOutstandingRequirements` into `desktop/src/api/operations-calculations.ts`. Invalid/negative BOM quantities are treated as missing rather than silently covered; saved requirement name/quantity retained when the linked local item is absent.
- c8e6b92afa5f961549c97e08122fd0f3ddd164a0: local Operations overview now uses these shared pure functions.
- 157be6422e0f3622071960a262bff733d5094778: seven Node built-in tests in `desktop/src/api/operations-calculations.test.mjs` for preferred stock, insufficient stock, alternatives, invalid/absent/partial stock, competing projects, requirement status and fallback enrichment.
- b3a89302053ef9a7e83fb7f702506e2d949b75e7: desktop GitHub Actions job runs `node --experimental-strip-types --test src/api/operations-calculations.test.mjs` before `npm run build` on Node 22.

STATUS: tests committed but not yet observed passing in CI; check the workflow run on this commit. Tests explicitly document existing *independent line* semantics: overlapping projects can each appear covered by the same stock. No reservation/allocation, SQLite/REST sync, UI deletion, permission or end-to-end desktop test is claimed. Codex must revisit Laboratory > Operations > Overview/Requirements and Project BOM, verify offline fixtures and cross-project demand, and report defects with logs and commits as previously requested in CHANGE-047/049.


## CHANGE-053 — Functional test CI integration syntax repair (2026-09-26)

Run https://github.com/Bonsinnoba/lab-inventory-app/actions/runs/36203211893: seven BOM/Requirements Node regression tests passed (0 failures); backend syntax passed; desktop build and Tauri frontend prerequisite failed with TS1128 at operations.ts:33 and :46. Root cause: CHANGE-052 extraction accidentally left an orphaned three-line `return {...row}` mapping after `enrichOutstandingRequirements(...)`. Commit c6c68b5771c533f166a3b2f210452293d936e540 removed those lines. Follow-up workflow run https://github.com/Bonsinnoba/lab-inventory-app/actions/runs/36237613761 was in progress when this note was written. No runtime SQLite/sync/UI behavior has been tested. Codex must still revisit Operations Overview/Requirements and project BOM with real offline fixtures.


## CHANGE-054 — Planning project status foundation (2026-09-26)

User-approved design: project leads and admins plan scope, BOM, Requirements, budgets and timelines before activation; project-lead reservation requests should be priority/date-aware, with admin review of conflicts. This change implements the status foundation ONLY, not reservation approvals or automatic stock locks.

- Desktop Project type, project register labels, create-project modal (Planning default) and detail status editor support `planning`.
- Tauri local project creation defaults to `planning` while existing project statuses remain unchanged.
- Express project creation defaults to `planning`; update validation and offline sync project validation accept it.
- PostgreSQL base schema defaults to Planning; tracked migration `backend/src/migrations/20260926_project_planning_status.sql` updates the existing CHECK constraint and default without rewriting existing rows. Run backend migrations before using Planning against an existing central database. A mistakenly created migration in `backend/migrations` was removed and installed in the actual `backend/src/migrations` runner directory.

Verification pending GitHub Actions for latest commit. CI does not run PostgreSQL migrations against a real database, execute offline desktop integration, or prove that approval/reservation workflow exists. Next: model planning review state separately from status; enforce admin-only activation server-side and on sync, plus offline approval semantics; add proposed versus confirmed reservations with central conflict resolution and tests before enabling any inventory lock. Do not treat a Planning status dropdown as approval enforcement.


## CHANGE-055 — Initial project activation authorization (2026-09-26)

The Planning foundation passed GitHub Actions run 36238838560. Implemented first activation guard on main:
- Express create validates status; non-admin users must create in Planning. Express update rejects non-admin attempts to set Active.
- Offline sync rejects non-admin project creation outside Planning and non-admin transitions into Active, with explicit error codes.
- Tauri local creation starts in Planning and local transition into Active is blocked pending online admin authorization; desktop creation modal only offers Planning.
- Existing project statuses are not rewritten. No reservation stock is locked by these changes.

LIMITATIONS: This is an initial authorization guard, NOT a complete project review workflow. Admin activation is possible through existing online project editing without a recorded readiness checklist or review decision. Desktop Tauri local-first project updates do not yet expose an online admin activation route; a separate online admin review/activation action is needed. Existing offline project sync conflict resolution and project-state refresh after online approval require integration tests. Proposed/confirmed reservations, priority and date arbitration, inventory locking and admin reallocation remain unimplemented. CI for these authorization commits must be checked; GitHub Actions compilation is not a database-backed authorization integration test.


## CHANGE-056 — Online Planning review and admin activation (2026-09-26)

- New tracked PostgreSQL migration `backend/src/migrations/20260926_project_review.sql` adds `projects.review_status` (draft/submitted/changes_requested/approved) and an append-only `project_review_events` table. Existing project lifecycle statuses are preserved.
- `GET /projects/:id/review` returns visible project's central review state and actor-attributed decision history; `POST /projects/:id/review` lets project leads/admins submit draft or returned plans and admins request changes (with required reason) or approve submitted plans. Approval atomically changes review_status to approved and lifecycle status to active using a row lock and transaction. Each decision is stored in the event table and also attempts the existing application audit log.
- Generic REST updates and offline sync now reject direct Planning-to-Active transitions; desktop local mutations reject offline activation. Project detail includes an online-only Planning review panel with submission, admin decisions and history; Planning status dropdown no longer offers direct Active transition.
- Previous authorization UI commit `8932fa98321855045e4b24bf344e19544cca6f40` passed CI run 36239170527. Current CHANGE-056 CI must be checked separately.

LIMITATIONS / REQUIRED NEXT STEPS: Review panel is online-only by design. An offline-created project must sync before it can be submitted. Desktop project snapshot refresh after central approval must be exercised end-to-end; no live PostgreSQL migration or authorization integration test has been run in CI. Project planning checklist is guidance, not an enforced approval prerequisite. Reservation ledger, stock locks, schedule/priority conflict resolution, equipment calendar, and procurement linkage remain unimplemented. Existing active projects were not retroactively reviewed. Backend generic updates may change an active project to another status under existing editor permissions; review gates Planning-to-Active only. Avoid claiming reservations or allocation are implemented.


## CHANGE-057 — Central reservation ledger, manual admin conflict review (2026-09-26)

- Added tracked PostgreSQL migration `backend/src/migrations/20260926_project_reservations.sql`: project/item/requester, positive quantity, usage window, pending_review/confirmed/rejected/released states, admin reviewer, notes and indexes. Existing physical inventory is untouched.
- Project lead or admin may POST a reservation request for Planning/Active projects. Project GET lists reservations with item, priority and project start/due-date context. Admin-only decision endpoint confirms, rejects with a reason, or releases. Confirmation runs in a transaction, locks the inventory item row, sums overlapping confirmed reservations and rejects over-allocation with a 409 conflict. Open-ended requests overlap all later dates. Admin can compare project priority/deadline context manually; there is NO automated project priority ranking or preemption.
- Desktop project workspace exposes online reservation requests and admin decisions. The REST API is intentionally online-only: disconnected workstations cannot confirm allocations. No stock deduction is performed. First UI CI run 36239791860 failed TypeScript because `getItems` takes filter arguments; fixed with `queryFn:()=>getItems()` in commit d3a00ce0c9fef5b34888abe53e1ce861ee39c0fb. Latest CI needs checking.

RISKS / NEXT: No PostgreSQL-backed concurrency tests yet; migration must be run on deployment before using endpoints. Review role permissions, UI error handling, date validation and project membership in end-to-end tests. Quantity overlap checks assume items are reservable over a time window, including consumables; future consumable allocation must persist until consumed/released rather than automatically returning stock at needed_until. Confirmed reservations currently do not decrement current_quantity; actual checkout must coordinate with confirmed reservations to prevent stock adjustments/other checkout paths from bypassing availability. Project leads cannot yet queue reservation requests offline; only online requests are accepted. There is no shared Requirements/BOM demand deduplication, no automated approval, no priority arbitration, no reservation calendar, and no expiry/return workflow. Treat this as a reservation ledger foundation, not production-safe inventory enforcement.


## CHANGE-058 — Lab-wide reservation review and consumable allocation correction (2026-09-26)

- Previous CHANGE-056 review run 36239480588 passed all GitHub Actions jobs. CHANGE-057 documentation run 36239872581 was still in progress at the start of this change; do not infer its outcome.
- Fixed allocation semantics in `backend/src/routes/projects.js`: equipment/instruments/tools use overlapping time windows, whereas consumables and other non-returnable stock remain allocated across usage windows until explicitly released. This prevents consumable stock from being counted as newly available just because a request's needed_until passed.
- Added admin-only `GET /projects/reservations/review-queue`, returning up to 200 oldest pending requests with project priority/status/start/due dates, physical quantity, item type and existing overlapping confirmed quantity. Added typed desktop API and `ReservationReviewQueue` to the Projects register for admins, with confirm/reject actions and mandatory rejection reason. The existing transactionally locked confirmation endpoint remains the authority; UI availability figures are advisory snapshots.

VERIFICATION / LIMITATIONS: Latest GitHub Actions must be checked after commit. No live PostgreSQL concurrency test, migration execution, or desktop runtime verification performed. No offline reservation outbox or server-side auto-approval. Quantity-based consumable reservations are still not coordinated with other inventory adjustment/checkout routes; stock can change outside this ledger. Queue currently caps at 200 pending requests and does not yet support pagination or proactive notifications. There is no automatic priority arbitration, preemption or expiry. Review panel exposes priority and due-date context for human admins rather than claiming an automatic scheduling policy. Future changes must implement item-type policy (e.g., whether materials may be returned), inventory checkout coordination and integration tests before production use.


## CHANGE-059 — Reservation floor on central stock movements and offline sync (2026-09-26)

- Previous CHANGE-058 GitHub Actions run 36240128420 completed successfully (desktop, backend syntax and Rust).
- New shared `backend/src/reservation-stock.js` checks the sum of ALL confirmed reservations for an item, conservatively regardless of time window, while callers hold an item row lock. It rejects physical stock changes below that reserved floor with `RESERVED_STOCK_CONFLICT` (409) and rejects invalid numeric quantities.
- Online `POST /items/:id/movements` now checks the floor within its existing inventory row-lock transaction. Offline sync `item_movement` and direct `item` current_quantity updates also check the floor while holding the same lock. Existing reservation approval also locks the item row; thus these paths serialize with reservation confirmation.
- Added four Node regression tests for exact floor, underflow, allowed unreserved balance and NaN/negative quantities; CI backend job runs them after syntax check. These are mocked query tests, NOT a real PostgreSQL concurrency test.

IMPORTANT LIMITATIONS: This is a fail-closed stock floor, not a checkout-against-reservation implementation. No reserved stock can be consumed through ordinary movement paths until a dedicated transaction atomically fulfills/releases the matching reservation; that dedicated path is not yet implemented. Time-window equipment reservations are conservatively summed across all dates for physical stock floor; future checkout must account for active equipment periods. Other inventory update/delete routes and database-direct writes require separate audit; reservation quantity can be changed by other system operations unless all writers are brought under common enforcement. Offline local SQLite may temporarily show a stock change that central sync rejects; conflict resolution must preserve local evidence and clearly report rejection. No real DB tests or deployment migration execution performed. Do not represent this phase as fully production-safe checkout enforcement.
