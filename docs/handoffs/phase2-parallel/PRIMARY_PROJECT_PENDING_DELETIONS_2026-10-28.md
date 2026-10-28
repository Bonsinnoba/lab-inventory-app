# Pending project-child deletions — primary agent

Scope: Phase 2 A5/B3; primary implementation, not helper work.

- MODULE: Project child snapshot reconciliation.
- FILE: `desktop/src-tauri/src/local_projects.rs`.
- CURRENT WRITE PATH: Native child deletion removes the local row and records an outbox event. Project pull reconciles server child collections.
- WHY IT BYPASSES OFFLINE-FIRST: No direct-write bypass; the pull's pending-row retention rule could resurrect a stale server row when a local deletion awaited acknowledgment.
- RISK: Deleted tasks/experiments reappear during refresh before the server applies/acknowledges their deletion.
- RECOMMENDED CHANGE: For pending child identities, retain an incoming row only if its local counterpart still exists; subsequent overlay preserves that local row. Pending absence remains absence. Nonpending tombstone handling is unchanged.
- ACTUAL CHANGE MADE: Updated the shared child retention rule, including its existing composite item identity handling. No outbox deletion/rewrite, acknowledgment fabrication or server-write fallback.
- VERIFICATION: Added pending task and experiment deletions to the actual production pull regression. Two pulls include the stale server rows; both must remain absent locally, while existing pending edits, attachments and links survive. The fixture closes/reopens SQLite and preserves seven pending events. Final test result recorded below.
- STATUS: Source implemented; all 15 focused native project tests pass (`cargo test local_projects:: --locked --offline -j 1`), and scoped `git diff --check` passes. Other collections sharing the rule and full desktop/API convergence still require acceptance coverage.

Only temporary native test data is used. V1, personal databases, storage and services are unchanged. No phase parent closure or deployment claimed.
