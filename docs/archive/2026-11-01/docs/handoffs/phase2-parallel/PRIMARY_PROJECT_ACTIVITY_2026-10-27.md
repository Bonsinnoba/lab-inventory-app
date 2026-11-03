# Project activity local projection — primary agent — October 27

- MODULE: A3/B3/B4 project activity.
- FILE: desktop/src-tauri/src/local_activity.rs; desktop/src-tauri/src/local_projects.rs; desktop/src/pages/ProjectDetailPage.tsx.
- CURRENT WRITE PATH: Audit records originate on the server and are synchronized into the existing account-scoped activity snapshot. Desktop project workspace previously returned activity:[] unconditionally.
- WHY IT BYPASSES OFFLINE-FIRST: Missing read integration, not an outbox/write bypass. Cached audit records were ignored by the project view.
- RISK: Project history appeared absent and the UI incorrectly described missing/unreadable/restricted data as no recorded activity.
- RECOMMENDED CHANGE: Reuse the local snapshot, enforce project access and existing administrator/audit permission and lease restrictions, filter by explicit project provenance before limiting rows, and preserve availability/freshness states.
- ACTUAL CHANGE MADE: Workspace now includes up to 100 matching local audit records plus activity_state and activity_last_synced_at. Matches use project entity ID or metadata.project_id, never unrelated entity IDs. Missing cache, restricted access and unreadable snapshot are distinct UI states; snapshot failures do not erase unrelated workspace sections. Local pending writes are not synthesized as confirmed audit events. Browser behavior remains unchanged.
- VERIFICATION: Native test build passed; 3 activity tests passed, including new pure filter/limit/provenance regression and existing account/session/lease, snapshot atomicity/replay tests. Existing native cache tests use isolated in-memory SQLite; no actual user data was accessed and no server database behavior changed. Full desktop stopped-API/reconnect acceptance remains NOT RUN for this integration.
- STATUS: Implemented in source, awaiting integrated desktop acceptance; not deployed to V1. No migration, reset, API restart or outbox modification.

Phase3 decision also recorded in the controlling checklist: right-dock Tools & settings entry opens a main-workspace page with Media / Daily use / System tabs, retaining permission and offline boundaries.
