# V1 coordinated candidate — October 24, 2026

Identity: LABOS-P2-PRIMARY. This is primary build/recovery evidence, not helper
completion or release acceptance. Preserve all current databases and storage.

## Build identity

- Base Git HEAD: f6b101522aad88ee8e0baba56e88d453134b94c5, with uncommitted
  review-authority/version/persistence changes and pilot backup documentation.
  This is not a tagged/reproducible release from HEAD alone.
- Application version remains 2.2.1; V1 is the controlled pilot milestone.
- Frontend: `npm.cmd run build` PASS (TypeScript and Vite).
- API candidate: `labos-api:v1-candidate-20261024`, image
  `sha256:4344b1ee815bb92a380030ac85902e450643da6ddcab7c10d6de1d9a00153b38`.
- Prior API image retained:
  `sha256:7f06ea39b769e82e0f557d1b71ea378242f5bd5adf80cbc049e57b03905f65e9`.
- Native desktop build: PASS, locked/offline debug build; one unused
  `resolve_conflict` warning. Executable SHA256:
  `1298DBFFC819620D3157D4D0821A0B6D796FD0187E7DE67F1740AE1E16270A3F`.
- Frontend dist/index.html SHA256:
  `8081A746AEB17469560DC7022415605847002CBECF7AA22F316745F46765DDBB`.

## Migration rehearsal — PASS

Restarted only the existing isolated `labos-v1-restore-check-20261024`
PostgreSQL container (network none, no published ports/live volumes, temporary
data filesystem). Restored `/tmp/pilot.dump` again with pg_restore
`--exit-on-error --single-transaction --no-owner --no-acl` into `labos_restore`.

Ran the candidate image's actual `src/run-migration.js` using that container's
network namespace and localhost PostgreSQL. No production environment file or
application workers were used. All existing migrations skipped; only
`20261024_project_plan_revision.sql` applied. A second runner invocation skipped
all migrations and exited successfully.

Post-upgrade counts: 6 projects, 50 items, 6 resources, 84 rows in
`sync_idempotency`; all 6 existing projects initialized with plan_revision 1.
An initial read-only count query used the incorrect table name `sync_receipts`
and failed; corrected to the real `sync_idempotency` table. No data mutation
was performed by that failed check. Isolated restore container stopped afterward.

Live migration inventory independently confirms the same single pending
migration. Live API was not replaced during rehearsal. No desktop process was
running at the process checkpoint; none was closed.

## Outstanding acceptance

Candidate API deployed through Compose `up -d --no-deps --no-build labos-api`.
Previous image retained as `labos-api:pre-v1-20261024`. Existing storage mount
remains `labos_storage:/app/storage`; no reset/reseed or volume replacement.
Health endpoint reports API/database/storage OK; live migration tracking confirms
the new plan-revision migration applied. Matching desktop executable launched
without closing another process. This is a debug acceptance candidate, not an
installer/release artifact. No application login or visual UI pass is claimed.

Whole candidate offline/reconnect and resource replication checks remain
unverified at this checkpoint. Backup evidence is in
PRIMARY_V1_BACKUP_2026-10-24.md. Full application recovery, key portability and
an off-device backup remain open. Do not mark V1 ready on build results alone.
