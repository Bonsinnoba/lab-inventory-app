# Resource attachment follow-up — primary agent — 2026-10-27

User reports V1 project attachments appear not to work during upload or later Attach / Move, without errors. Changes below are in V2 source only; no V1 update, restart or database modification.

## Finding 1
- MODULE: Resources attachment display and project workspace refresh.
- FILE: desktop/src/pages/ResourcesPage.tsx; desktop/src/api/resource-attachment-presentation.ts.
- CURRENT WRITE PATH: Native upload/move saves parent IDs locally with outbox work; local records need not contain joined parent names.
- WHY IT BYPASSES OFFLINE-FIRST: The write does not bypass it; display incorrectly depends on joined labels and only invalidates the global library query.
- RISK: Successfully linked resources appear Unattached; cached project workspace can remain stale.
- RECOMMENDED CHANGE: Resolve labels from authoritative parent IDs and available local destination data; invalidate resource and project-workspace query families.
- ACTUAL CHANGE MADE: Implemented these presentation/cache changes. Missing destination labels now say Linked project/item/note, not Unattached. No permission or sync changes.
- VERIFICATION: Focused label and invalidation unit tests pass. Installed V1 symptom not independently reproduced; no end-to-end desktop acceptance claimed.
- STATUS: Source corrected; awaiting desktop acceptance and a separately authorized future V1 update.

## Finding 2
- MODULE: Native resource link creation.
- FILE: desktop/src/api/resources.ts.
- CURRENT WRITE PATH: Renderer passed snake_case parent keys directly into Tauri command with default camelCase arguments.
- WHY IT BYPASSES OFFLINE-FIRST: No bypass, but optional parent arguments can be omitted at the native boundary.
- RISK: Newly created links lose their intended project/item/note association.
- RECOMMENDED CHANGE: Explicitly map parent IDs to camelCase command arguments.
- ACTUAL CHANGE MADE: itemId/projectId/noteId mapping with explicit null for absent parents.
- VERIFICATION: Source contract regression passes; native runtime end-to-end check remains pending.
- STATUS: Source corrected, awaiting acceptance.

Three focused regressions pass in resource-attachment-presentation.test.mjs. These findings explain plausible silent symptoms, but do not establish that every instance reported by the user has the same cause. Existing saved attachments were not rewritten and no pending events were discarded.

## Finding 3 — desktop project workspace placeholder
- MODULE: Project Knowledge/resources and task/experiment resource selectors.
- FILE: desktop/src-tauri/src/local_projects.rs; desktop/src/components/ResourcesPanel.tsx.
- CURRENT WRITE PATH: Upload/move persists project_id, but list_local_project_workspace returned resources:[] unconditionally.
- WHY IT BYPASSES OFFLINE-FIRST: Read-side integration gap: the project view ignored the account-scoped local resource store entirely.
- RISK: Saved project resources never appear in Knowledge or resource selectors that consume workspace.resources.
- RECOMMENDED CHANGE: Populate the workspace from the authorized local resource cache, filtering by the current project_id.
- ACTUAL CHANGE MADE: Added permission-checked local resource projection after project access checks. Users without resources.view receive no resource rows; authorized read failures propagate rather than silently appearing empty. Scoped ResourcesPanel upload/link/delete success also invalidates the library and project workspace families.
- VERIFICATION: Native targeted test passed (1/1): only matching project rows appear without joined names; moving to another project removes the original association and appears in the destination. This test verifies selection behavior, not a full desktop upload/outbox/sync round trip. Native test build succeeded. No PostgreSQL changes were needed or made.
- STATUS: Code complete for this read gap; desktop end-to-end acceptance still pending. No V1 deployment performed.

The adjacent notes/activity placeholder collections are separate remaining workspace integration work; this patch does not claim to resolve them.
