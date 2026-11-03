# Experiment collection read boundaries

Identity / role: LABOS-P2-PRIMARY. Primary implementation.

MODULE: B3/B4 project experiment local reads.

FILE: desktop/src/api/projects.ts; project-reservation-boundaries.test.mjs.

CURRENT WRITE PATH: No writes. Desktop reads native authorized experiment
projection; browser keeps existing measurements/observations endpoints.

WHY IT BYPASSES OFFLINE-FIRST: Both collection readers previously fell through to
HTTP when the requested experiment was absent from a successful local response.
Missing collection fields also became false empty arrays; a prose observations
field could be returned as though it were a collection.

RISK: Server dependency after local misses, inconsistent visibility and malformed
collection results. A missing snapshot is not proof that no records exist.

RECOMMENDED CHANGE: Explicit runtime branch, no desktop HTTP fallback, validate
experiment and collection shape, reject stale account responses.

ACTUAL CHANGE MADE: Shared local collection reader validates signed-in session,
native array, requested record and array-valued collection. Empty arrays remain
valid; unknown/missing data rejects. Late account-switch results are rejected.
Native errors propagate. Browser path unchanged. No new mutation or native command.

VERIFICATION: TypeScript and 15 project-boundary tests PASS with actual Docker
API confirmed stopped; API restored in finally and health OK. Includes 8 new
measurement/observation checks plus existing reservation/consumption regressions.
Tests mock IPC/HTTP; not integrated desktop acceptance. Diff whitespace PASS.

STATUS: Source-only. B3/B4 still open. Existing UI error/empty presentation needs
review alongside projection completeness, not certified fixed by this adapter.

## Concrete follow-up findings (not changed in this batch)

- getProjectReview/decideProjectReview and experiment history/revision readers
  remain server-backed. Need authorized durable projections and ordinary outbox
  intentions for project-plan review, not direct API writes from desktop.
- backend/src/routes/sync.js overwrites experiment observations prose with the
  structured observations array; native experiment creation also initializes
  observations as an array. ProjectExperiment/UI still model it as prose.
  Separate field names with compatibility handling must preserve existing cached
  values and immutable pending payloads; do not blindly rename/drop old data.
- Experiment UI currently can show empty sections or "No edits recorded yet" on
  read failures. Explicit availability/completeness/error presentation remains.
