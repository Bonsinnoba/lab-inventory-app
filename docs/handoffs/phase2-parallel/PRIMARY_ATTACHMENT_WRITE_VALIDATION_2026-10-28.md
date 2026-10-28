# Native project attachment validation — October 28

Identity / role: primary agent, A1/B3 connected-project write review.

- MODULE: Task/experiment resource attachments.
- FILE: desktop/src-tauri/src/local_projects.rs.
- CURRENT WRITE PATH: Native create -> nested_create -> save transaction/local state plus outbox. The shared reference validator did not cover attachments.
- WHY IT BYPASSES OFFLINE-FIRST: Not a transport bypass; invalid work/resource references could enter local state and wait for server rejection.
- RISK: Orphaned or cross-project work links, confusing local displays, avoidable rejected sync intentions.
- RECOMMENDED CHANGE: Validate exactly one target work item in the current authorized project, canonicalize UUIDs, and verify resource permission/current-account local presence before persistence.
- ACTUAL CHANGE MADE: Shared attachment reference validation requires exactly one task or experiment and checks its UUID/project membership. Shared nested create/update validates resources.view and the canonical resource UUID against account-scoped resource rows using the same connection as the local write path. Missing resources fail explicitly without HTTP fallback. Deletes do not require resource presence, so this does not prevent removal of an orphaned link. Existing persisted rows are not rewritten or deleted.
- VERIFICATION: Added native regression covering task/experiment membership, UUID normalization, missing/malformed/both targets and unavailable project targets. Full local_projects test result recorded below. This pure reference test does not certify the new resource-permission/presence gate under a live account or an account-switch race.
- STATUS: Source implemented; native-command account/permission and actual offline/reconnect acceptance pending. No parent closure.

## Inspection note: experiment history

getProjectExperimentHistory remains a server audit-log endpoint, distinct from getExperimentRevisions. There are no current desktop call sites for the former found in this inspection. Do not substitute revision records or the bounded project activity snapshot for complete experiment audit history. Offline history still requires an explicit authorized snapshot/completeness contract and remains open; no history implementation was claimed in this batch.

Final native local_projects regression run: 12 passed, 0 failed. Scoped diff whitespace check passed. These tests exercise reference/projection/access helpers, not full command persistence or live PostgreSQL.

No V1 deployment, restart, database mutation, service operation or pending-work deletion.
