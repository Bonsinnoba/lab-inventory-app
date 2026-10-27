# Native displayed review version and durable queue

Identity / role: LABOS-P2-PRIMARY. Primary implementation, not helper work.

MODULE: B3/B4 native project review and pending decision persistence.

FILE: desktop/src-tauri/src/local_project_review.rs; desktop/src/api/projects.ts;
desktop/src/api/project-reservation-boundaries.test.mjs;
desktop/src/components/ProjectPlanningReview.tsx.

CURRENT WRITE PATH: UI displayed token -> native account/authority/state/token
validation inside SQLite transaction -> immutable account-owned outbox intention.
The ordinary sync pipeline remains responsible for delivery and acknowledgement.

WHY IT BYPASSES OFFLINE-FIRST: No transport bypass. The native command previously
selected the latest cached token at save time instead of receiving the version
the user saw. A background refresh could silently replace the reviewed version.

RISK: Queueing approval for a plan the user had not reviewed; losing or duplicating
pending authored notes across restart or repeated acknowledgements.

RECOMMENDED CHANGE: Require the displayed token at the native boundary and verify
durability using a file-backed SQLite database, not only in-memory fixtures.

ACTUAL CHANGE MADE: Required expected_token on ReviewIntentInput. Native save
rejects absent/empty/mismatched versions before writing the outbox. Adapter sends
the displayed token unchanged for desktop and browser; no HTTP fallback. Added
Refresh review control so a user can reload the snapshot without clearing their
typed note. Existing outbox payloads are not rewritten or discarded.

VERIFICATION: Native test compilation PASS. With actual Docker API stopped:
26 adapter tests, 6 native review tests and 12 local-database tests PASS (44 total).
New stale-display case verifies no row is queued until the matching fresh token
is supplied. New unique file-backed SQLite fixture closes/reopens after queueing,
uses the production mark_changes_synced helper twice, closes/reopens again,
verifies awaiting_snapshot without local activation, supplies a newer snapshot,
then closes/reopens and verifies the pending indicator clears while the original
payload and single outbox row remain. The disposable fixture was removed after
success; the user's SQLite database was never modified by this test. API restored
healthy. TypeScript and diff whitespace checks PASS.

STATUS: Source only; no desktop rebuild/restart or API deployment performed.
This is durable local queue/ACK coverage, NOT full live transport reconnect or
UI acceptance. The new required native argument requires coordinated frontend
and native deployment. Existing saved decisions and all user data are preserved.

## Remaining gates

- Live native desktop -> PostgreSQL push -> ACK -> pull across process restart
  and connection loss, including rejection and account switching.
- Nested dirty-work cases: inspected current nested create/update/delete helpers
  and confirmed they include project_id; dedicated regression coverage remains.
- Concurrent child-plan editing/approval and full permission HTTP integration.
- Coordinated source deployment, then desktop acceptance. Phase 2 remains open.
