# Offline experiment revision reads

Identity / role: LABOS-P2-PRIMARY. Primary implementation, not helper work.

MODULE: B3/B4 experiment revision history.

FILE: backend/src/project-experiment-revisions.js; backend/src/routes/sync.js;
desktop/src/api/projects.ts; associated revision/adapter tests.

CURRENT WRITE PATH: No new mutation. Authorized server revision rows join the
ordinary project pull and existing account-scoped SQLite project snapshot.
Desktop reads the native experiment snapshot; browser retains its HTTP endpoint.

WHY IT BYPASSES OFFLINE-FIRST: getExperimentRevisions previously always called
the server, so history was unavailable without a connection despite local data.

RISK: Incomplete offline project context and misleading absence of history.

RECOMMENDED CHANGE: Replicate authorized revision records, distinguish old
snapshots without history from confirmed empty arrays, reject late account data.

ACTUAL CHANGE MADE: Server revision query accepts only the project IDs already
selected by the authorized project pull. Preserves endpoint fields, actor names
and descending revision order. Each experiment receives a revisions array.
Desktop uses the shared session-checked native collection reader with no HTTP
fallback; missing/non-array fields reject. Query failures fail the pull instead
of persisting invented empty history. No migration or outbox rewrite.

VERIFICATION: Read-only actual PostgreSQL comparison across six projects and one
existing revision PASS; empty scope returns no records. With actual Docker API
confirmed stopped, 29 tests PASS (20 adapter, 4 rendered availability component,
3 observation helper, 2 revision helper). API restored and health reports API,
database and storage OK. TypeScript, server syntax and diff whitespace PASS.
Adapter tests mock IPC/HTTP; not integrated desktop acceptance. Vite production
build PASS (2,262 modules, 3m21s). Running desktop/API not upgraded by this batch.

STATUS: Source-only. Requires coordinated API/frontend deployment and integrated
sync, SQLite reopen and desktop acceptance. Existing pending-parent merge can
retain its older snapshot until pending work is resolved; no claim of immediate
history freshness. This is confirmed server revision history, not unsynchronized
local edit history. Project review writes/reads and separate audit-history paths
remain open. No databases, pending changes or storage deleted.
