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

