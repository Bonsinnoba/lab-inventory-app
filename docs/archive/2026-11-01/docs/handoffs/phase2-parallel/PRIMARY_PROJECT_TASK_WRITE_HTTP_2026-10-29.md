# Project task HTTP writes and receipts — primary agent

Scope: A5/B3; bounded server acceptance, not full desktop acceptance.

Extended `backend/src/project-pull-http-live-probe.mjs` with optional
`LABOS_DEV_PROJECT_WRITE_PROBE=rollback-only`. Production JWT middleware and
sync-push router run on the isolated loopback listener. SQL runs against actual
development PostgreSQL. Route BEGIN/COMMIT/ROLLBACK are mapped to savepoints
inside the outer rollback fixture transaction. This tests sequential route
atomicity, not independent committed transactions or concurrent connections.

## Results

- Existing nine authentication/project-pull HTTP cases PASS again.
- Task create, update and delete PASS; replay of each returns the original result.
- One task after create, correct updated title, no task after delete.
- Changed payload with reused event ID rejects with IDEMPOTENCY_PAYLOAD_MISMATCH.
- Different device with reused event ID rejects with IDEMPOTENCY_OWNERSHIP_MISMATCH.
- Exactly one task tombstone after delete/replay.
- Injected receipt INSERT failure rolls back the task and creates no receipt.
- Retrying that unchanged event after removing the injected failure succeeds.
- Four unique receipts for four successful distinct events, not extra replay receipts.
- Fixture users/projects/overrides/grants/tasks/receipts/tombstones confirmed absent after outer rollback.

Initial write attempt returned 401: changing the fixture role/active state advanced
its credential version. Corrected the test to sign a fresh token using the actual
database version; did not relax production authentication. Full rerun PASS.
The single-client Promise.all warning documented in the consolidated report
remains a harness limitation, not evidence of production concurrency verification.

## Environment and remaining gates

V1 API/database were running and left untouched. Only existing development DB was
temporarily started and returned to stopped. No desktop install/restart, migration,
deployed API update or persistent seed performed.

Use the consolidated HTTP command with both flags:
`LABOS_DEV_PROJECT_HTTP_PROBE=rollback-only` and
`LABOS_DEV_PROJECT_WRITE_PROBE=rollback-only`.

Remaining: other entity receipts, independent transaction/concurrent replay,
transport interruption after real commit, actual desktop IPC/offline restart/
reconnect and deployed configuration. No phase parent closed. Next desktop pass
requires identifying the V2 binary/profile and verifying it cannot open V1 data.
