# Project work attachment pull convergence — primary agent

Identity: primary implementation/review agent, not a helper report.
Scope: Phase 2 B3 project integration / A5 nested synchronization.

## Finding

- MODULE: Project task and experiment attachments.
- FILE: `desktop/src-tauri/src/local_projects.rs`.
- CURRENT WRITE PATH: Native attachment mutations save the canonical project-level `attachments` collection with an outbox event. Server project pulls supply attachments nested inside tasks and experiments.
- WHY IT BYPASSES OFFLINE-FIRST: This is a read/merge mismatch, not a newly discovered direct server write. The pull previously updated nested collections without rebuilding the canonical collection used by local attachment readers.
- RISK: Confirmed attachments can disappear from local views; stale nested copies can disagree with pending detachments; refresh/restart can expose inconsistent data.
- RECOMMENDED CHANGE: Normalize server and legacy nested shapes into one canonical collection, merge pending changes by attachment identity, and derive nested views from that collection.
- ACTUAL CHANGE MADE: Normalize on load and incoming pull. Preserve an existing canonical list, including explicit empty lists. Deduplicate incoming IDs. Pending attachment rows retain their local representation; pending removals remain absent even when the server still includes them. Nonpending server absence and tombstones remove confirmed rows. Rebuild nested task/experiment attachment arrays from the canonical list, replacing the separate nested attachment merge.

## Verification

Focused native tests cover nested normalization, explicit empty canonical lists, duplicate IDs, pending additions/removals, tombstones, authoritative absence and repeated merges. The on-disk SQLite regression exercises the actual production pull twice, preserves pending events/authored experiment fields, rejects a foreign account and closes/reopens the database to check persistence. Nested and canonical attachment views must agree.

Final focused run: `cargo test local_projects:: --locked --offline -j 1` passed all 15 native project tests, including the nested-view projection assertion. Scoped `git diff --check` passed.

This uses an isolated temporary desktop SQLite database, not the personal database. It does not claim real-server attachment push/pull or desktop UI acceptance. Prior PostgreSQL history evidence concerns history only, not attachment acceptance.

## Status and remaining acceptance

Source implementation and focused native verification complete. Coordinated V2 build and desktop UI acceptance remain open: attach/detach while offline, restart with API stopped, reconnect, confirm server and local associations agree without duplicates, and check account/permission transitions. No Phase 2 parent is closed by this batch.

No API deployment, app restart, V1 change, personal-data edit or outbox purge performed.
