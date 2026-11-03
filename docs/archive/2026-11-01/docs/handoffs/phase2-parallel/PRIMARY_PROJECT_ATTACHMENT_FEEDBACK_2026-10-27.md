# Project attachment labels and mutation feedback — October 27

Identity / role: primary agent, B3/B4 follow-up. Not helper completion evidence.

## Attachment projection

- MODULE: Project task and experiment attachments.
- FILE: desktop/src-tauri/src/local_projects.rs.
- CURRENT WRITE PATH: Existing native attachment mutation/outbox remains unchanged. Read command previously returned bare relationship records.
- WHY IT BYPASSES OFFLINE-FIRST: No write bypass; incomplete local read projection caused missing attachment names.
- RISK: Unidentifiable attachments or obsolete labels, mistaken for unsuccessful linking.
- RECOMMENDED CHANGE: Join current account-scoped resource names while preserving attachment identity and respecting resource-view permission.
- ACTUAL CHANGE MADE: Reader requires resources.view, validates the requested task/experiment belongs to the loaded accessible project, and projects current resource name/original filename. Empty names use original filename. Missing resource rows clear stale filename/name and show Unavailable resource. No media paths are added, relationships are not rewritten, and missing resources are not fetched from the server.
- VERIFICATION: Added native projection regression for current labels, preserved IDs, task/experiment separation, missing targets, filename fallback, invalid work/type and unchanged source. Native execution result recorded below.
- STATUS: Source implemented; actual desktop/offline acceptance pending.

## Mutation feedback

- MODULE: Project task links and task/experiment attachments, measurements, observations.
- FILE: desktop/src/pages/ProjectDetailPage.tsx; desktop/src/pages/project-editor-save.test.mjs.
- CURRENT WRITE PATH: Existing mutation adapters; some failure callbacks were absent.
- WHY IT BYPASSES OFFLINE-FIRST: Not a persistence bypass; errors after attempted local writes were not explained to the user.
- RISK: Silent failures and repeated clicks while operations are pending.
- RECOMMENDED CHANGE: Explicit normalized error feedback and pending-action disabling without deleting cached rows on failure.
- ACTUAL CHANGE MADE: Added error callbacks to task unlink, both attachment detach handlers, measurement delete and observation delete. Their buttons disable while pending. Task attachment submit also disables while pending. Task link/attachment lists now use existing loading/error/empty status presentation and retry; existing background-refresh row retention behavior remains.
- VERIFICATION: 13 frontend regression checks passed, including execution of all five error callbacks with explicit and fallback messages. The first run exposed a missing transpiler option in the new test harness; corrected it and reran the full focused batch successfully. These are handler/source tests, not mounted UI acceptance.
- STATUS: Source implemented; integrated acceptance pending.

Final checks: all 4 native resource_workspace_tests passed; TypeScript no-emit and scoped diff whitespace checks passed. Native tests use isolated projections, not the live PostgreSQL database. Stopped-API desktop/reconnect acceptance was not run for this batch.

No installed V1 changes, service restart, deployment, database migration or personal data modification. Existing mutation authorization, outbox identities and server behavior are unchanged. This batch does not close an A1–C6 parent.
