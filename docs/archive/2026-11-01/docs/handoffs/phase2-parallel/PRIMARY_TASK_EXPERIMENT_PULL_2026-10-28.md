# Task–experiment link reconciliation

Identity: primary agent implementation report, not helper work.
Scope: Phase 2 B3 / A5.

- MODULE: Task–experiment relationships.
- FILE: `desktop/src-tauri/src/local_projects.rs`.
- CURRENT WRITE PATH: Local link/unlink operations persist project state and outbox events; project pull reconciles server snapshots.
- WHY IT BYPASSES OFFLINE-FIRST: No direct server-write bypass found in this batch. The defect was reconciliation: a server row with a pending local event was excluded, then its local counterpart was also excluded because its ID existed on the server.
- RISK: A newly linked experiment could disappear during pull-before-ack ordering, despite its pending event still existing. Repeated pulls could keep the local collection incorrect.
- RECOMMENDED CHANGE: Preserve the current local representation for pending identities; absence locally means a pending unlink. Use authoritative server rows only for nonpending identities, respecting tombstones and deduplicating by ID.
- ACTUAL CHANGE MADE: Extracted the attachment relation merger into a shared helper and reused it for task–experiment links. The previously ignored task–experiment tombstone argument is now supplied to this merge. Attachment behavior remains covered by its existing regression tests. No event rewriting, acknowledgment fabrication or HTTP fallback added.
- VERIFICATION: Extended the actual project-pull disk regression with pending link and unlink events. The server returns both before acknowledgment. Two pulls must preserve exactly the local pending link and suppress the removed link; close/reopen must retain that result and all five pending events. Final run result follows below.
- STATUS: Implemented and focused native verification passed: all 15 project tests pass with `cargo test local_projects:: --locked --offline -j 1`; scoped `git diff --check` passes. Desktop/API acceptance and deployment are not claimed.

No personal database, V1 install, storage, service state or API deployment changed.
Next integrated acceptance: link/unlink offline, restart, reconnect with pull-before-ack and replay, then confirm eventual local/server convergence without duplicate associations.
