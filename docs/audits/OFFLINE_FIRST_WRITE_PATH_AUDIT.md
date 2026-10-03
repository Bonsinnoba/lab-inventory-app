# LabOS desktop write-path audit

Status: in progress, 2026-10-03. This is a source-code audit, not a claim that
every desktop mutation has been made offline-first. The changes in this slice
are fail-closed guards for inventory and canvas, plus the preferences error
path. Browser-only server writes remain available. TypeScript checking,
the production Vite build, and source-path review verified the guard changes.
The actual PostgreSQL database was then seeded at the user's request, without
resetting it. End-to-end retry tests remain before this audit can be closed.

### Actual PostgreSQL test dataset — 2026-10-03

The add-only, repeatable seed at `backend/seeds/20261003_labos_demo.sql` ran
against the existing `labos-db-1` container, not a disposable database. It
added 48 items, 48 initial stock movements, 16 maintenance records, 6 projects,
30 tasks, 12 experiments, 18 resource requirements, 18 notes, 9 placeholder links, and 9 project
memberships. Every user-facing row carries `LABOS-SEED-20261003`, and generated
IDs are deterministic. Existing records were not modified or deleted. The
pre-seed counts were 2 items, 0 projects, 1 note, and 1 resource; afterward
they were 50, 6, 19, and 10. A second seed run inserted zero rows in every
table. The desktop's automatic sync loop runs every 15 seconds and invalidates
queries afterward. A read-only check of the running `balika` desktop SQLite
cache confirmed all 6 seeded projects and 18 requirements were pulled;
visual confirmation in the window is still needed. The placeholder URLs are intentionally not downloadable videos and
should not be used for the thumbnail regression test.

## Findings

### 1. Inventory CRUD, bulk actions, and movements

```text
MODULE: Inventory
FILE: desktop/src/api/items.ts; desktop/src/api/local-inventory.ts
CURRENT WRITE PATH: Tauri -> local snapshot + SQLite outbox; browser -> HTTP API.
WHY IT BYPASSES OFFLINE-FIRST: Previously, a missing/failed local snapshot returned null and the Tauri caller fell through to HTTP POST/PUT/DELETE. This could commit remotely without a durable local event.
RISK: Remote-only item, lost local edit, inconsistent retry or duplicate movement after refresh/sync.
RECOMMENDED CHANGE: Fail closed on Tauri when local storage is unavailable; retain HTTP only in browser. Then distinguish uninitialized versus failed snapshots so a new offline account can create its first item safely.
ACTUAL CHANGE MADE: Added a Tauri guard before HTTP writes for create, update, delete, bulk status, bulk delete, and movement creation. No data was migrated.
VERIFICATION: Desktop TypeScript check passed. Source review confirms the existing local item and movement paths generate UUIDs and queue changes; backend sync has bulk/delete/movement handlers and change-id idempotency. Runtime failure injection and real-PostgreSQL retry tests are pending.
STATUS: Guard implemented; end-to-end verification pending.
```

### 2. Canvas mutations

```text
MODULE: Project canvas
FILE: desktop/src/api/canvas.ts; desktop/src/components/ProjectCanvas.tsx
CURRENT WRITE PATH: Tauri -> local project commands/outbox; browser -> HTTP API.
WHY IT BYPASSES OFFLINE-FIRST: A delete without projectId skipped the local command; any local command returning null also fell through to HTTP. The current canvas UI supplies projectId, but the API did not enforce that boundary.
RISK: Server-only block/connector mutations and stale local canvas after retry or pull.
RECOMMENDED CHANGE: Require a successful local command on Tauri; reject missing project context instead of writing to the server.
ACTUAL CHANGE MADE: Added fail-closed Tauri guards to block/connector create, update, and delete. Browser HTTP behavior is unchanged.
VERIFICATION: Current ProjectCanvas deletion call sites pass projectId; desktop TypeScript check passed. Offline/restart/delete sync test is pending.
STATUS: Guard implemented; end-to-end verification pending.
```

### 3. Daily-use preferences

```text
MODULE: System preferences
FILE: desktop/src/api/system.ts; desktop/src-tauri/src/local_system.rs; backend/src/routes/system.js; backend/src/routes/sync.js
CURRENT WRITE PATH: Tauri -> account-scoped SQLite sync_state; browser -> server PATCH. The local preference write has no outbox event, and sync has no preference entity handler.
WHY IT BYPASSES OFFLINE-FIRST: Previously, a failed Tauri write fell back to a server PATCH. Even a successful Tauri write remains device-local and does not synchronize.
RISK: Different settings on different devices; a failed local write could previously create a server-only change. A local success should not be presented as a synchronized preference.
RECOMMENDED CHANGE: Decide whether these are device-local settings or shared per-account settings. If shared, transactionally enqueue a preferences change, add a server sync handler and pull projection, and define last-write/retry behavior. If device-local, remove/rename the central PATCH and document the distinction.
ACTUAL CHANGE MADE: Removed the Tauri error -> server-write fallback only. No outbox or cross-device sync was added.
VERIFICATION: Desktop TypeScript check passed; source review confirms local_system writes sync_state without outbox and sync.js has no daily-use-preferences handler. Real-PostgreSQL and multi-device tests pending.
STATUS: Partial safety guard; architecture decision and synchronization remain open.
```

### 4. Maintenance records

```text
MODULE: Inventory maintenance
FILE: desktop/src/api/items.ts; desktop/src/components/MaintenancePanel.tsx; backend/src/routes/items.js; backend/src/routes/maintenance.js; backend/src/index.js
CURRENT WRITE PATH: Direct HTTP create/update/delete from desktop, with no local mutation or outbox event. The referenced HTTP routes were missing entirely before this slice.
WHY IT BYPASSES OFFLINE-FIRST: No Tauri maintenance repository, outbox operation, or pull/reconciliation contract exists.
RISK: Offline failure; server success with stale local inventory/operations views; repeated POST after an uncertain response can duplicate records. The formerly missing routes made the panel fail even online.
RECOMMENDED CHANGE: Add account-scoped local maintenance state with atomic outbox writes, server change-id idempotency, pull/reconciliation, and delete handling. Add an updated_at/version contract before merging concurrent edits.
ACTUAL CHANGE MADE: Restored the missing authenticated maintenance GET/POST/PATCH/DELETE routes with validation, inventory permission enforcement, and audit entries; deployed only the API service. The panel now exposes load errors and labels edits as online-only. Desktop API errors retain backend messages.
VERIFICATION: Actual PostgreSQL-backed HTTP probe passed create, invalid input, update, read, permission denial, delete, and repeat-delete. The unique probe record was removed; 16 seeded maintenance rows remain. Existing 34 backend security tests passed. No offline or uncertain-response retry test has passed.
STATUS: Online baseline repaired; offline-first migration OPEN.
```

### 4b. Operations suppliers

```text
MODULE: Operations suppliers
FILE: desktop/src/api/operations.ts
CURRENT WRITE PATH: Direct HTTP create/update/delete from desktop, with no local mutation or outbox event.
WHY IT BYPASSES OFFLINE-FIRST: No Tauri repository branch exists.
RISK: Offline failure, stale local view, and duplicate create on uncertain retry.
RECOMMENDED CHANGE: Add account-scoped local supplier state, atomic outbox writes, server idempotency, pull/reconciliation, and deletion semantics.
ACTUAL CHANGE MADE: None.
VERIFICATION: Source-path audit only; actual-PostgreSQL create/retry/delete tests pending.
STATUS: Open.
```

### 5. Requirements without project context

```text
MODULE: Operations requirements
FILE: desktop/src/api/operations.ts; desktop/src/api/projects.ts
CURRENT WRITE PATH: Requirements with project_id use local project methods; browser-only calls without project_id use HTTP. Desktop calls without project_id now fail closed.
WHY IT BYPASSES OFFLINE-FIRST: Previously, the branch was based only on an optional property, not the desktop runtime. A missing ID silently changed storage architecture. A null local command result also fell through to HTTP.
RISK: Server-only requirement, ambiguous retry, local/server divergence.
RECOMMENDED CHANGE: Require project_id for desktop requirement mutations or introduce a separate explicit online-only workflow; never silently fall through.
ACTUAL CHANGE MADE: Desktop create/update/delete now require project context; the project requirement API also rejects a null local-write result instead of calling HTTP. Added 18 deterministic, labeled requirements to the live PostgreSQL seed for read/sync checks.
VERIFICATION: No direct call sites for the operations wrapper were found in desktop/src. The local project commands use the project_resource_requirement outbox type, and backend sync has its handler. Desktop TypeScript check and production build passed. Live PostgreSQL contains 18 requirements across 6 projects, with zero orphaned project/item references; rerunning the seed inserted zero rows. The balika desktop SQLite cache contains the same 6 projects and 18 requirements. Failure-injection and push/retry tests remain pending.
STATUS: Guard implemented; runtime verification pending.
```

### 6. Resource files, attachments, metadata, and grants

```text
MODULE: Resources
FILE: desktop/src/api/resources.ts
CURRENT WRITE PATH: Core local resource create/delete paths exist, but uploads, file replacement/editor copies, attachment moves, some metadata, visibility, and grant changes use direct HTTP writes.
WHY IT BYPASSES OFFLINE-FIRST: Binary content and server-authoritative access-control operations have no unified local transaction/outbox contract; some writes refresh local cache only after remote success.
RISK: Offline failure or server-only state; metadata/file split-brain after an uncertain response; retry may create another copy. Access grants must not be authorized by a stale client cache.
RECOMMENDED CHANGE: Classify binary editing versus authorization separately. Add durable local media staging and idempotent upload IDs for content; keep grant changes explicitly online/server-authoritative and refresh or invalidate the account cache after success.
ACTUAL CHANGE MADE: None in this slice.
VERIFICATION: Source-path audit only; thumbnail/download regression and real-PostgreSQL retry tests pending.
STATUS: Open; do not blanket-convert grants to offline writes.
```

### 7. Download manager

```text
MODULE: Media downloads
FILE: desktop/src/api/mediaDownloads.ts
CURRENT WRITE PATH: Immediate desktop queue has a local outbox path; scheduled jobs, job mutations, settings, and thumbnail writes call HTTP directly.
WHY IT BYPASSES OFFLINE-FIRST: Server job execution and local queue creation are mixed behind one module.
RISK: Uncertain retry can queue or start a duplicate job; local resource thumbnail/status can lag a completed server action.
RECOMMENDED CHANGE: Separate local scheduling intent from server execution. Give queue/start requests stable idempotency keys, and reconcile final job plus resource metadata into SQLite after completion/deletion.
ACTUAL CHANGE MADE: None.
VERIFICATION: Source-path audit only; real-PostgreSQL job/retry/delete tests pending.
STATUS: Open.
```

### 8. Collaboration, assistant, and automation

```text
MODULE: Collaboration; assistant; automation
FILE: desktop/src/api/collaboration.ts; desktop/src/components/AssistantChat.tsx; desktop/src/api/automation.ts
CURRENT WRITE PATH: Direct HTTP writes for notifications/comments, assistant preferences/conversations/chat, and automation runs.
WHY IT BYPASSES OFFLINE-FIRST: No local outbox for these mutations. Assistant generation and automation execution may intentionally require the server, while comments/notification state may not.
RISK: Offline failure, duplicate comments or runs after uncertain retries, and stale local notification/conversation state.
RECOMMENDED CHANGE: Split online-only actions from offline-capable records. Give effectful server actions idempotency keys; add local/outbox/pull for comments and read markers only after their conflict policy is defined.
ACTUAL CHANGE MADE: None.
VERIFICATION: Source-path audit only; actual-PostgreSQL retry/deletion tests pending.
STATUS: Open classification and implementation.
```

### 9. Administrative account/permission mutations

```text
MODULE: Users, authentication, and permissions
FILE: desktop/src/api/auth.ts; desktop/src/api/permissions.ts
CURRENT WRITE PATH: Server-authoritative HTTP account and permission changes; local permission snapshots are cached for desktop reads.
WHY IT BYPASSES OFFLINE-FIRST: These writes deliberately do not originate from the outbox because an offline client cannot safely grant privileges.
RISK: After a successful server change, another account's local permission cache may remain stale until refreshed; retry and revocation timing need explicit checks.
RECOMMENDED CHANGE: Keep writes online-only, label that state in UI, invalidate/refetch local permission snapshots on success, and test revocation across active sessions.
ACTUAL CHANGE MADE: None.
VERIFICATION: Source classification only; two-account actual-PostgreSQL revocation test pending.
STATUS: Intentional server authority; cache-coherence work open.
```

## Next verification sequence

1. Add failure-injection tests proving Tauri inventory/canvas local failures issue zero HTTP writes.
2. Against the existing PostgreSQL service, use namespaced temporary records to test stable UUID/change-id retry, duplicate rejection, delete tombstones, and local pull. Clean only test-owned records after validating exact IDs.
3. Decide the daily-preferences sync contract, then implement and test it as one coherent slice.
4. Continue the same per-mutation inventory across remaining desktop API modules and direct UI HTTP calls. This document is deliberately **not yet an exhaustive repository sign-off**.
