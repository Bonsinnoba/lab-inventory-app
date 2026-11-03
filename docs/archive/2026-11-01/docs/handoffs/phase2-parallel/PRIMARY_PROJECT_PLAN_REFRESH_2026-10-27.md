# Connected project refresh — primary agent — October 27

- MODULE: B3/B4 BOM, tasks, experiments and canvas integration.
- FILE: desktop/src/api/project-plan-refresh.ts; desktop/src/components/ProjectBomPanel.tsx; desktop/src/components/ProjectCanvas.tsx; desktop/src/pages/ProjectDetailPage.tsx.
- CURRENT WRITE PATH: Existing native repositories/outbox save project children; UI callbacks refresh only the directly edited collection.
- WHY IT BYPASSES OFFLINE-FIRST: No write bypass; related cached project/review/context projections can remain stale until the general sync refresh.
- RISK: The displayed plan context/review state can lag a locally saved child edit. Existing native/server token and pending-child guards remain necessary and unchanged.
- RECOMMENDED CHANGE: Centralize refresh of related project query families after successful saves without clearing caches or manufacturing authority/tokens.
- ACTUAL CHANGE MADE: Shared refresh for BOM, workspace, review, context, project detail/list and dashboard. Applied to BOM create/update/delete, workspace mutation callbacks previously refreshing only the workspace, and canvas mutations alongside their canvas refresh. No new mutation transport or stock effect.
- VERIFICATION: Focused query-key test passes. Full interactive offline/reconnect acceptance remains pending.
- STATUS: Source implementation, not a V1 deployment or B3/B4 closure.

## BOM form correction
- MODULE: BOM planning.
- FILE: desktop/src/components/ProjectBomPanel.tsx; desktop/src/api/project-plan-refresh.ts.
- CURRENT WRITE PATH: Existing create/update handlers accept optional preferred and alternative inventory IDs, but renderer validation rejected both blank because empty strings compare equal.
- WHY IT BYPASSES OFFLINE-FIRST: Not a transport bypass; the UI prevented valid planning before selecting inventory.
- RISK: Cannot record unfulfilled/unmatched component demand.
- RECOMMENDED CHANGE: Reject duplicate selections only when both are populated. Keep positive finite quantity and nonblank name requirements.
- ACTUAL CHANGE MADE: Corrected the shared create/edit validation.
- VERIFICATION: Tests cover neither/one/both distinct inventory selections, duplicate selection rejection, blank name and invalid quantities. Three focused frontend tests pass in total. TypeScript result recorded after completion.
- STATUS: Source fixed; interactive acceptance pending. Backend/native quantity and permission rules unchanged; no DB writes/tests needed for this UI correction.

Final focused checks: all three tests PASS; TypeScript no-emit check PASS;
scoped diff whitespace check PASS. No deployment, restart or data modification.
