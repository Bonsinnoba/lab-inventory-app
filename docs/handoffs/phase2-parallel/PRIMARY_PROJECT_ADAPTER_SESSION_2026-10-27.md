# Shared project adapter session boundary — October 27

Identity / role: primary agent, A1/B3 follow-up. Not helper-delivered work.

- MODULE: Desktop project/workspace/task/experiment/BOM/attachment native adapters.
- FILE: desktop/src/api/projects.ts; desktop/src/api/project-reservation-boundaries.test.mjs.
- CURRENT WRITE PATH: UI -> shared localInvoke -> existing native command -> local transaction/outbox. Browser uses HTTP. Several specialized readers already had account-generation guards, but the shared adapter did not.
- WHY IT BYPASSES OFFLINE-FIRST: No newly discovered HTTP fallback after a rejected native write; the gap was session isolation of returned results. Undefined non-delete results were also accepted as successful responses.
- RISK: A native result arriving after sign-out/account change could be treated as a current-account read or successful save by the renderer. Missing native results could appear successful without a usable saved record.
- RECOMMENDED CHANGE: Require a captured session before desktop invocation; reject responses after session generation changes. Reject null/undefined results except void delete/unlink completion. Keep native authorization and persistence rules authoritative.
- ACTUAL CHANGE MADE: Shared localInvoke now performs those guards. Browser transport unchanged. No automatic replay, rollback, new UUID, HTTP retry or pending-event deletion is triggered by the guard. A mutation committed before an account switch stays persisted; the renderer rejects its late completion and asks for refresh.
- VERIFICATION: 44 focused adapter/editor/refresh checks passed. New checks cover eight representative operations with absent and changed sessions, nullish create/delete results, native failures without HTTP fallback and unchanged browser create transport. These are mocked-IPC adapter regressions, not live account-switch desktop acceptance.
- STATUS: Implemented in source; coordinated desktop acceptance pending. TypeScript result recorded below when available.

Boundary: this renderer check is not a replacement for native account binding and commit-time permission checks, nor proof of their complete coverage. No native/server mutation policy was changed. Remaining online-authoritative membership/access-grant operations were not converted into offline grants. Experiment-history HTTP reads and financial-summary unavailable-section handling still require separate review; do not claim those were resolved here.

TypeScript no-emit and scoped diff whitespace checks passed.

No V1 changes, deployment, database mutation, service restart or file/outbox deletion. No A1–C6 parent is closed.
