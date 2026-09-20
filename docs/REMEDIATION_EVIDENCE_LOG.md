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
