# Experiment child reconciliation — primary agent

Scope: Phase 2 A5/B3. Primary implementation report, not helper evidence.

- MODULE: Experiment measurements and observation records.
- FILE: `desktop/src-tauri/src/local_projects.rs`.
- CURRENT WRITE PATH: Native child creation/deletion saves local project state with an outbox event; project pull supplies nested collections.
- WHY IT BYPASSES OFFLINE-FIRST: No direct-write bypass identified here. The old merge could retain deleted server child rows and was subsequently overwritten by a pending experiment parent overlay.
- RISK: Pending removals reappear; pending parent edits freeze independent confirmed child records; local pending child values can lose precedence.
- RECOMMENDED CHANGE: Reconcile child collections independently after the parent-field overlay, using the original server snapshot and current local child state.
- ACTUAL CHANGE MADE: Measurements and observation records now use the shared identity/pending/tombstone merge after experiment fields are overlaid. Pending child additions retain local values, pending absence suppresses stale server rows, and confirmed independent rows refresh even when the parent has a pending edit. Local-only parents remain unchanged when no server parent exists. Outbox events are neither rewritten nor acknowledged by pull.
- VERIFICATION: Extended production pull/reopen regression with concurrent pending experiment prose, child additions and child deletions. Two pulls must preserve local child values, include independent confirmed rows, suppress removed children, preserve parent prose and retain all eleven pending events across disk reopen. Final focused test status follows.
- STATUS: Source implemented; all 15 native project tests pass on the full rerun (`cargo test local_projects:: --locked --offline -j 1`). Integrated desktop/outage/reconnect acceptance and deployment remain open.

Initial run: 14 passed, one fixture setup failed because new child-event payloads
omitted required project references. Corrected the fixture to include `project_id`;
production validation was not relaxed. Full focused rerun follows.

No personal database, V1 installation, API deployment or service-state change performed.
