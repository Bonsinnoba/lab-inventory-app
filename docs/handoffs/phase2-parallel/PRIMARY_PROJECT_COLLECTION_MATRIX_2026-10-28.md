# Project child collection matrix — primary agent

Scope: Phase 2 A5/B3. Primary verification work, not a helper report.

- MODULE: BOM, canvas blocks/connectors, resource requirements, project-item links.
- FILE: `desktop/src-tauri/src/local_projects.rs` (test module).
- CURRENT WRITE PATH: Native project state plus outbox, followed by shared project-pull reconciliation. Project items use composite project/item event identities.
- WHY IT BYPASSES OFFLINE-FIRST: No additional bypass identified in this batch. Previously repaired shared pending-deletion handling needed coverage beyond tasks/experiments.
- RISK: Inconsistent pending merge behavior across collections, especially composite project-item identities and transition after acknowledgment.
- RECOMMENDED CHANGE: Exercise all five collections through the production pull implementation, disk reopen and post-acknowledgment snapshots before further rewriting.
- ACTUAL CHANGE MADE: Expanded the isolated SQLite regression; no production business-logic change this batch. Each collection includes pending create/edit/delete, an obsolete nonpending local row and a confirmed server row. Repeated pulls must preserve pending values/absence, remove obsolete rows and include confirmed rows. Reopen preserves 26 pending events. Test-only acknowledgment of the 15 new fixture events then permits authoritative server values and absence, leaving the original 11 events pending.
- VERIFICATION: All 15 focused native project tests pass (`cargo test local_projects:: --locked --offline -j 1`); scoped `git diff --check` passes. ACKs are simulated inside the temporary fixture, not received from PostgreSQL; this does not certify server receipts, concurrency or integrated reconnect.
- STATUS: Focused native collection matrix verified. Full desktop/server acceptance remains open. No parent closure or deployment.

No V1, personal database, file storage or service-state changes. The test-only acknowledgment statements must not be used as operational repair commands.
