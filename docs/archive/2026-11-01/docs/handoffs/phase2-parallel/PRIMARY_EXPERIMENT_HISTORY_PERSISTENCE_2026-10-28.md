# Experiment history merge and persistence — October 28

Identity: primary agent, A3/B3 follow-up. No helper completion attribution.

- MODULE: Native project pull / pending experiment merge.
- FILE: desktop/src-tauri/src/local_projects.rs.
- CURRENT WRITE PATH: Authorized server snapshot -> project pull merge -> existing save_checked transaction. Pending experiment rows previously replaced the whole incoming experiment, including refreshed history.
- WHY IT BYPASSES OFFLINE-FIRST: No HTTP/write bypass; pending authored fields prevented independent confirmed history from refreshing.
- RISK: Audit history remains stale while local experiment edits are pending.
- RECOMMENDED CHANGE: Preserve all pending authored fields and immutable outbox content, while accepting the incoming history array for the same experiment identity.
- ACTUAL CHANGE MADE: Added pending_experiment_with_history and used it for matching pending experiment rows in the existing pull merge. Only history is copied; title, observations, other local fields and outbox events are unchanged. Missing/malformed history or a different ID does not overwrite the last local history. An explicit empty server array replaces the old history. Pending whole-project snapshots retain the existing defer policy.
- VERIFICATION: Added same-ID/foreign-ID/malformed/empty/repeated-merge tests plus an isolated file-backed SQLite save/reopen test through production save/save_checked/load. Test asserts authored fields, history and the original pending outbox payload survive reopening without ACK or extra event. Initial test launch was blocked by the approval service usage limit and did not execute; retry is in progress.
- STATUS: Source implemented; native test run PASS: 14 local_projects tests, including file-backed save/reopen and unchanged pending-event checks. Full apply_server_project_pull command, native session switching, running desktop outage/reconnect and coordinated deployment are separate acceptance gates. Scoped diff whitespace check also passed.

The SQLite test exercises desktop persistence, not a substitute for the already-run actual PostgreSQL server query check. No installed V1, personal data, service state or deployed artifact is changed.

## Follow-up: exercise the production pull path

Extracted the existing command body into apply_project_pull, taking its already
opened connection. The Tauri command retains its existing name/arguments and
delegates directly; no transport/schema/protocol change. The disk test now calls
this production pull twice instead of only composing the merge helper and save.
It asserts one experiment after repeated snapshots, pending title/prose retained,
confirmed history refreshed, wrong-account pull rejected without cache change,
disk reopening and unchanged/unacknowledged original outbox payload. This is a
broader native persistence check, not an actual running desktop/reconnect test.
Follow-up result: all 14 native project tests passed, including the upgraded
production-pull disk test. Scoped diff whitespace check passed. Tauri UI/IPC,
running desktop API-outage/reconnect and coordinated build deployment remain open.
