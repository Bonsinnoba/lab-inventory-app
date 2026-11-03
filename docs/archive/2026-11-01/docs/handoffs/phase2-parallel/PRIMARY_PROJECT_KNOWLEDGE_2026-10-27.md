# Project Knowledge local integration — primary agent — October 27

- MODULE: B3/B4 project Knowledge / notebook integration.
- FILE: desktop/src-tauri/src/local_projects.rs; desktop/src/pages/NotebookPage.tsx.
- CURRENT WRITE PATH: Notes already save locally with outbox events. The desktop workspace returned notes:[] unconditionally, ignoring saved project_id associations.
- WHY IT BYPASSES OFFLINE-FIRST: Read-side integration defect, not a write fallback. The project Knowledge view could not display locally linked notes even online.
- RISK: Users perceive successful saves/associations as missing; local edits are invisible within the project workspace.
- RECOMMENDED CHANGE: Read the account-scoped notes cache using existing notes.view authorization and filter by current project_id. Invalidate project workspaces after notebook create/update/delete so moves refresh both source and destination.
- ACTUAL CHANGE MADE: Implemented that local projection and invalidation. Read errors propagate; missing notes.view permission yields no note rows. Project access and session checks remain. No HTTP fallback, synthetic notes, outbox rewrites or extra writes introduced.
- VERIFICATION: Added native projection regression for matching/unrelated/unattached notes, unchanged unsynced body/title/tags, project moves and empty/deleted results. Compile/test outcome recorded below after completion. This is not a live desktop/database round-trip test.
- STATUS: Source implementation; desktop acceptance pending. No V1 deployment or data access. Project activity placeholder remains a separate obligation.

Companion resource fixes: PRIMARY_RESOURCE_ATTACHMENT_DISPLAY_2026-10-27.md.

Verification outcome: native test build succeeded; both Knowledge projection tests
passed (2/2). Frontend TypeScript no-emit check passed. No PostgreSQL tests were
needed for this local projection change; real offline desktop/reconnect acceptance
has not been performed and remains open.
