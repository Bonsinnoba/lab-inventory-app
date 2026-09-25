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
