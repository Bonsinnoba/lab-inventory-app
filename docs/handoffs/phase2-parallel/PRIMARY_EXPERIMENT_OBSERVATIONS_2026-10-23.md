# Experiment observation separation

Identity / role: LABOS-P2-PRIMARY. Primary implementation, not helper work.

MODULE: B3/B4 experiment projections and local mutations.

FILE: backend/src/project-experiment-observations.js; backend/src/routes/sync.js;
desktop/src-tauri/src/local_projects.rs; desktop/src/api/projects.ts;
associated JavaScript and native tests.

CURRENT WRITE PATH: Native experiment changes remain SQLite/outbox intentions.
Structured observation mutations now use observation_records; prose retains
observations. Server pull supplies observations_text and observation_records,
retaining the legacy observations collection alias for older readers.

WHY IT BYPASSES OFFLINE-FIRST: This was a projection collision rather than a new
HTTP bypass. The pull replaced prose with child records, while native creation
also initialized the prose field as an array. Full-record writes could therefore
send structured data where prose belongs.

RISK: Lost prose, malformed rendering, and unsafe legacy full-record writes.

RECOMMENDED CHANGE: Separate prose and records, preserve compatibility and
immutable pending payloads, reject ambiguous updates rather than inventing text.

ACTUAL CHANGE MADE: Normalize cached projections in memory. Preserve legacy
arrays as records; mark unavailable prose and block full-record edits until it
is synchronized. New experiments initialize prose and records independently.
Server rejects ambiguous array/unavailable-prose intentions with an explicit
conflict. Pull pending-event lookup now includes measurement/observation events,
and child merge uses the canonical records field. No existing outbox rewritten.

VERIFICATION: TypeScript and native test compilation PASS. Actual Docker API
confirmed stopped: 19 JavaScript tests (3 server helper, 16 adapter) and 19 native
tests (7 project access/projection, 12 database regressions) PASS. API restarted
in finally; health reports API/database/storage OK. Read-only PostgreSQL check
covered 12 existing experiments and a SQL-generated nonempty fixture; PASS.
Initial probe invocation failed before querying because of a Node argument-index
error; corrected invocation passed. Server syntax and diff whitespace checks PASS.

STATUS: Source-only; requires coordinated API/desktop deployment and integrated
desktop acceptance. PostgreSQL check tested the new helper, not a deployed pull
route. Native new projection tests use in-memory values, not a complete persisted
merge/replay scenario. No database, storage or pending-work deletion performed.

## Still open

- Recovery/review workflow for legacy ambiguous pending experiment events.
- Integrated persistence, pending-child deletion and replay acceptance.
- Broader UI availability/completeness acceptance (focused presentation fixed below).
- Authorized offline project review, history and revision projections.
- B3/B4 parent checklist items remain open; this does not complete Phase 2.

## Follow-up: truthful experiment section availability

MODULE: Experiment measurements, observation records, attachments and revisions.
FILE: desktop/src/components/ExperimentCollectionStatus.tsx and its test;
desktop/src/pages/ProjectDetailPage.tsx.
CURRENT WRITE PATH: Unchanged. Presentation only; no new network or outbox path.
WHY IT BYPASSES OFFLINE-FIRST: Failed history reads previously appeared as
"No edits recorded yet"; other unavailable collections appeared blank.
RISK: Users mistake missing data for confirmed absence.
RECOMMENDED CHANGE: Distinguish unavailable, loading, confirmed empty and retained
data after a background refresh failure.
ACTUAL CHANGE MADE: Shared section status and retry affordance; retained rows
remain rendered. Silent successful refresh adds no loading notice. Missing legacy
prose is explicitly labeled and the full-record Edit control is disabled until
prose synchronization; native validation remains authoritative.
VERIFICATION: Four server-rendered component tests and 16 adapter tests PASS with
the actual Docker API stopped, then restored healthy. TypeScript PASS. These are
automated presentation/adapter checks, not interactive desktop acceptance.
STATUS: Source-only. Server-backed revision/history transport remains open;
truthful unavailable messaging does not make those records offline-capable.
