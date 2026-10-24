# Project conflict action guidance

Identity / role: LABOS-P2-PRIMARY. Primary UI integration, not visual helper work.

MODULE: B4 project lifecycle/deletion conflict presentation; A2 recovery explanation.

FILE: desktop/src/api/project-conflict-guidance.ts and its test;
desktop/src/components/ProjectConflictActions.tsx; SyncStatus.tsx;
desktop/src/pages/SyncConflictsPage.tsx.

CURRENT WRITE PATH: Existing native resolve_sync_conflict command remains the
authority. Components only explain and select its existing resolutions.

WHY IT BYPASSES OFFLINE-FIRST: No bypass introduced. Previously both views offered
generic retry/accept actions even for permanently protected deletions or stale
lifecycle decisions; a compact Dismiss action could retire a deletion unclearly.

RISK: Repeated permanent rejection, confusing disappearance of conflicts/projects,
or mistaken belief that accepting a server version restores revoked access.

RECOMMENDED CHANGE: Shared project-specific guidance/actions matching native
guards, explicit confirmation, no automatic retry/rebase/permission restoration.

ACTUAL CHANGE MADE:
- Both views disable retries for protected-history deletions and lifecycle
  conflicts; transient history-busy deletions remain retryable.
- Labels distinguish Cancel deletion from Use server status. Confirmations state
  that original work remains retained and authorized sync is still required.
- Project guidance uses explicit actions instead of the compact silent Dismiss.
  Local retirement remains available offline; server refresh requires connection.
- Restricted payload inspection is hidden on the full conflicts page; native
  redaction/account filtering remain authoritative. No new recovery-data endpoint,
  broader read permission or export was introduced.

VERIFICATION: TypeScript PASS. Seven pure/render checks PASS with actual LabOS API
stopped, then restarted; health endpoint API/database/storage OK. Includes blocked
retry, transient retry, restricted wording, unrelated domain fallback, rendered
disabled controls and busy state. Diff whitespace check PASS. Render-to-string
tests are not browser/native visual or interaction acceptance.

STATUS: IMPLEMENTED — AWAITING DEPLOYMENT AND INTEGRATED VERIFICATION. No desktop
restart/API deployment in this batch. Native recovery listing/export, full
conflict-to-authorized-pull interaction and broader B4/A2 acceptance remain open.
