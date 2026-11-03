# Connected project links and safe editing — October 27

Identity: primary agent. Scope: B3/B4 connected project read projections and editor feedback. This report is separate from helper-delivered work.

## Finding 1: unnamed task/experiment relationships

- MODULE: Project tasks / experiments.
- FILE: desktop/src-tauri/src/local_projects.rs.
- CURRENT WRITE PATH: Existing native local mutation and outbox unchanged; the task-experiment reader returned relationship records without current experiment labels.
- WHY IT BYPASSES OFFLINE-FIRST: No new write bypass; incomplete local read projection rendered blank labels.
- RISK: Users cannot reliably identify existing connections and may attempt redundant links.
- RECOMMENDED CHANGE: Join current project experiment labels without changing relationship identity.
- ACTUAL CHANGE MADE: Validate task membership in the project, filter relationships by task, join current title/status, and label missing targets as unavailable. Preserve source records and relationship IDs.
- VERIFICATION: Native resource_workspace_tests: 3 passed, including current-label join, unrelated-task exclusion, missing-target fallback, task validation and unchanged source JSON. These are isolated tests, not live PostgreSQL acceptance.
- STATUS: Implemented in source; desktop acceptance pending.

## Finding 2: narrow refresh after nested edits

- MODULE: Project tasks / experiments / context / review.
- FILE: desktop/src/api/project-plan-refresh.ts; desktop/src/api/project-plan-refresh.test.mjs; desktop/src/pages/ProjectDetailPage.tsx.
- CURRENT WRITE PATH: Existing mutation adapters remain; nested success callbacks refreshed only their immediate collection.
- WHY IT BYPASSES OFFLINE-FIRST: No mutation bypass introduced; dependent local projections could remain stale after a successful local save.
- RISK: Attachments, observations, measurements, revisions, review and context disagree until revisited.
- RECOMMENDED CHANGE: Invalidate connected project query families after confirmed mutations, retaining cached data while refreshing.
- ACTUAL CHANGE MADE: Shared refresh includes task links/attachments and experiment attachments/measurements/observations/revisions. Nested card callbacks use shared refresh instead of isolated refetches.
- VERIFICATION: Shared refresh regression tests passed; exact key family assertions, no cache removal.
- STATUS: Implemented in source; mounted UI and offline/reconnect acceptance pending.

## Finding 3: editor closes before save succeeds

- MODULE: Task and experiment editing.
- FILE: desktop/src/pages/ProjectDetailPage.tsx; desktop/src/pages/project-editor-save.test.mjs.
- CURRENT WRITE PATH: Existing update adapters through React Query; editors previously called non-awaitable mutate and closed immediately.
- WHY IT BYPASSES OFFLINE-FIRST: Not an outbox bypass; UI treated an attempted mutation as saved even when the local mutation failed.
- RISK: Draft disappears and user may mistake rejection for persistence.
- RECOMMENDED CHANGE: Await mutation success before closing, retain draft/error on rejection, block overlapping saves.
- ACTUAL CHANGE MADE: Separate promise-returning onSave callbacks use mutateAsync. Editors retain drafts and inline errors on rejection; lock save inputs while pending; experiment has Cancel and refreshes its form only outside editing. Quick status actions retain existing mutate/onError behavior. Experiment status is locked while editing/saving to avoid overlapping form/status changes.
- VERIFICATION: Five editor tests passed: execute actual extracted component save handlers against deferred/rejected persistence, verify retry and draft retention, and assert promise-returning callback wiring. Together with refresh tests, 8 frontend checks passed. These are handler/source regressions, not mounted React or real desktop acceptance.
- STATUS: Implemented in source; integrated UI acceptance pending.

TypeScript no-emit and scoped diff whitespace checks passed after the changes.

No V1 update/restart, service change, migration, personal database write, outbox modification or data deletion occurred. No A1–C6 parent is closed by this batch. Still inspect nested resource-label projections and deletion/unlink error feedback; do not imply those were fixed here.
