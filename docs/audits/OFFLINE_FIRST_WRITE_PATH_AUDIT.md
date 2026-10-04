# LabOS desktop write-path audit

The remaining findings in this audit are scheduled in
`docs/audits/THREE_PHASE_REMAINING_WORK_PLAN.md`.

Status: Phase 1 implementation/verification checkpoint delivered, 2026-10-03.
The operation-level source index is in PHASE1_MUTATION_SOURCE_INDEX.md; fresh
verification and the remaining security blocker are in PHASE1_EVIDENCE.md.
This is not a claim that every desktop module is now offline-first or that
release security is signed off. Finding 33 remains open. The source index
includes read/helpers and mutation candidates; runtime evidence is separately
identified rather than inferred from the index.

### Actual PostgreSQL test dataset — 2026-10-03

The earlier add-only seed run was superseded by the owner's explicit request
to clear the databases and reseed. Only the LabOS PostgreSQL volume and LabOS
local SQLite/WebView state were reset. Other applications' databases and the
LabOS uploaded-media volume were preserved. The current actual PostgreSQL
service contains 2 accounts, 48 items, 6 projects, 18 notes and 9 resources
(verified after the final probes). The seed also supplies 48 initial movements,
16 maintenance records, 30 tasks, 12 experiments and 18 requirements.
The namespaced live probes remove their own rows/files. The disk-backed two-client
note test deletes its note through the API and intentionally leaves its audit,
idempotency and tombstone evidence. It does not reset the app's SQLite cache.
Seed placeholder links are not downloadable-video test fixtures.

## Findings

The inventory below distinguishes a deliberate browser HTTP path from a Tauri
fallback. A Tauri command that throws does **not** fall through in the common
`localInvoke` helpers; a command returning `null` can. A `void` Tauri command
normally returns `undefined`, which is treated as successful. The remaining
null-return and Rust transaction paths still require failure injection.

### 1. Inventory CRUD, bulk actions, and movements

```text
MODULE: Inventory
FILE: desktop/src/api/items.ts; desktop/src/api/local-inventory.ts; backend/src/routes/items.js; backend/src/index.js
CURRENT WRITE PATH: Tauri -> local snapshot + SQLite outbox; browser -> HTTP API.
WHY IT BYPASSES OFFLINE-FIRST: Previously, a missing/failed local snapshot returned null and the Tauri caller fell through to HTTP POST/PUT/DELETE. This could commit remotely without a durable local event.
RISK: Remote-only item, lost local edit, inconsistent retry or duplicate movement after refresh/sync.
RECOMMENDED CHANGE: Fail closed on Tauri when local storage is unavailable; retain HTTP only in browser. Then distinguish uninitialized versus failed snapshots so a new offline account can create its first item safely.
ACTUAL CHANGE MADE: Added a Tauri guard before HTTP writes for create, update, delete, bulk status, bulk delete, and movement creation. Restored the missing browser delete/bulk routes and operation-specific server permissions with atomic delete tombstones (finding 25). No data was migrated.
VERIFICATION: Desktop TypeScript check passed. Source review confirms the existing local item and movement paths generate UUIDs and queue changes; backend sync has bulk/delete/movement handlers and change-id idempotency. The scoped PostgreSQL inventory route probe passed. Runtime IPC failure injection and two-client retry tests are pending.
STATUS: Guard and browser route repair implemented; end-to-end desktop verification pending.
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
RECOMMENDED CHANGE: Use the owner-approved hybrid contract in docs/architecture/daily-use-preferences.md: notifications_enabled per-account with transactional outbox, versioned server apply and pull; auto_pause_music and music_volume account-scoped per-device without an outbox. Preserve legacy server values during migration.
ACTUAL CHANGE MADE: Removed the Tauri error -> server-write fallback. Documented the approved hybrid ownership and conflict contract; no preference data migration or new sync handler has been added yet.
VERIFICATION: Desktop TypeScript check passed; source review confirms local_system writes sync_state without outbox and sync.js has no daily-use-preferences handler. Real-PostgreSQL and multi-device tests pending.
STATUS: Ownership decision resolved; Phase 2 implementation and synchronization remain open.
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
FILE: desktop/src/api/auth.ts; desktop/src/api/users.ts; desktop/src/api/permissions.ts; desktop/src-tauri/src/local_auth.rs; backend/src/routes/auth.js
CURRENT WRITE PATH: Server-authoritative HTTP account, profile, password, role and permission changes; local credentials and permission snapshots are cached for desktop offline sign-in/reads.
WHY IT BYPASSES OFFLINE-FIRST: These writes deliberately do not originate from the outbox because an offline client cannot safely grant privileges.
RISK: After a successful server change, another account's local permission cache may remain stale until refreshed. A password change or administrator reset does not immediately replace a different installation's cached offline credential; offline sign-in currently permits that credential until its seven-day expiry. Retry and revocation timing need an explicit security policy.
RECOMMENDED CHANGE: Keep writes online-only, label that state in UI, invalidate/refetch local permission snapshots on success, and test revocation across active sessions. Decide whether the seven-day offline sign-in lease is acceptable or must be shortened/disabled for sensitive roles. On a user's own password change, refresh or invalidate this installation's local credential without leaving the previous hash active.
ACTUAL CHANGE MADE: None.
VERIFICATION: Source classification only; two-account actual-PostgreSQL revocation test pending.
STATUS: Intentional server authority; credential/cache-coherence and offline-revocation policy open.
```

### 10. Inventory Excel import on missing local snapshot

```text
MODULE: Inventory import
FILE: desktop/src/api/excel.ts; desktop/src/api/local-inventory.ts
CURRENT WRITE PATH: Tauri with a local snapshot parses and imports through SQLite/outbox; a null snapshot previously selected server POST /excel/inventory/import. Browser imports use that HTTP endpoint.
WHY IT BYPASSES OFFLINE-FIRST: getLocalInventorySnapshot returns null both for an uninitialized cache and for an invocation/parse failure. The importer treated either as permission to write remotely.
RISK: Server-only bulk create/update after a local failure; uncertain HTTP retries can repeat the import, and local inventory can remain stale.
RECOMMENDED CHANGE: Fail closed on Tauri when the local snapshot is unavailable. Later distinguish missing initialization from a broken cache and give a new account a safe empty snapshot.
ACTUAL CHANGE MADE: Tauri import now raises an explicit local-inventory error before the HTTP branch. Browser import is unchanged.
VERIFICATION: Desktop TypeScript check passed; source review confirms the guard precedes HTTP. Forced-null runtime and real-PostgreSQL retry tests remain pending.
STATUS: Fallback closed; end-to-end verification open.
```

### 11. Storage containers and item storage

```text
MODULE: Phase 4 storage
FILE: desktop/src/api/phase4.ts; backend/src/routes/phase4.js; backend/src/index.js
CURRENT WRITE PATH: Container create/update/delete and item-storage PATCH go directly to HTTP from Tauri and browser. API methods are permission-gated, but no desktop SQLite/outbox mutation or pull contract exists for containers.
WHY IT BYPASSES OFFLINE-FIRST: These are ordinary persistent inventory records, yet the desktop API has no local branch. An item-storage PATCH also changes a server item outside the inventory outbox.
RISK: Offline failure, server/local storage divergence, duplicate container creation on uncertain retry, and a removed container still shown locally. The current item update does not update the desktop inventory snapshot.
RECOMMENDED CHANGE: In Phase 2, add a container entity and item-storage operation to the atomic local/outbox contract; use stable UUIDs and change IDs, pull and tombstones, and reject deletes while items still reference a container.
ACTUAL CHANGE MADE: None; classified, not rewritten.
VERIFICATION: Source-path and route-permission review only. PostgreSQL retry/delete and desktop reconciliation tests pending.
STATUS: Open — offline-capable domain.
```

### 12. Project workflow actions outside the local project repository

```text
MODULE: Project review, reservations, members, grants, experiment repeat
FILE: desktop/src/api/projects.ts; backend/src/routes/projects.js; backend/src/routes/project-workspace.js
CURRENT WRITE PATH: Core project/task/experiment/BOM/link/measurement/observation/attachment mutations invoke local commands on Tauri. Review decisions, reservation request/decision/fulfillment, membership, visibility/grants and experiment repeat use direct HTTP. Reservation fulfillment sends a caller request_id; most other HTTP POSTs do not carry a stable retry key.
WHY IT BYPASSES OFFLINE-FIRST: The direct calls have no local intent/outbox operation. Membership, grants and review approval may be deliberately server-authoritative; reservation request and experiment repeat require separate classification. Local-command null returns can still reach the HTTP branch for several core mutations.
RISK: Offline failure, uncertain-response duplicate actions, stale project workspace after remote success, or an accidental server-only core mutation on a null local result.
RECOMMENDED CHANGE: Keep authorization changes server-authoritative with explicit online UI and cache invalidation. Decide workflow-action authority, add idempotency to effectful online actions, and fail closed on Tauri for every offline-capable local null result. Test every core project sub-record's Rust write/outbox transaction.
ACTUAL CHANGE MADE: Existing requirement guard is recorded in Finding 5; none for the remaining actions in this slice.
VERIFICATION: Desktop source-path review; no complete two-client/PostgreSQL retry matrix yet.
STATUS: Open — mixed offline-capable and server-authoritative actions.
```

### 13. Excel and purchase/finance imports

```text
MODULE: Import/export
FILE: desktop/src/api/excel.ts; desktop/src/api/excel-finance.ts; desktop/src/api/purchases.ts; backend/src/routes/excel.js; backend/src/routes/excel-finance.js; backend/src/routes/excel-purchases.js
CURRENT WRITE PATH: Inventory import uses local SQLite/outbox when a snapshot exists; browser import uses HTTP. Finance and purchase imports POST workbooks directly from the desktop. Preview POSTs parse only; exports and templates are reads.
WHY IT BYPASSES OFFLINE-FIRST: Finance/purchase imports can create multiple database records without a local batch/outbox representation or atomic desktop reconciliation. The upload response alone is not a durable local commit.
RISK: Partial or repeated imports after network uncertainty, duplicate purchases/transactions, and finance or inventory cache divergence. Export projections and audit logging require independent security review.
RECOMMENDED CHANGE: Give each import an immutable batch ID, row IDs, server idempotency and reconciliation or a fully local parsed/outbox path; classify previews separately from writes. Preserve import-specific permission gates.
ACTUAL CHANGE MADE: Only the inventory Tauri null-snapshot guard in Finding 10.
VERIFICATION: Source classification only for finance/purchases; PostgreSQL repeat-upload, rollback and cache checks pending.
STATUS: Open.
```

### 14. Knowledge record visibility and write paths

```text
MODULE: Findings, results, relationships, search and sync pull
FILE: desktop/src/api/knowledge.ts; desktop/src/api/sync.ts; desktop/src-tauri/src/local_knowledge.rs; backend/src/routes/knowledge.js
CURRENT WRITE PATH: Tauri finding/result/relationship writes use local commands whose save helper can enqueue an outbox event in the same SQLite transaction; browser writes use HTTP. Server list/search/sync-pull for findings/results/calculations previously filtered by project membership, not the record's lab/project/restricted visibility. Knowledge overview/tags also used only project membership. Relationships were listed without checking either endpoint.
WHY IT BYPASSES OFFLINE-FIRST: The Tauri write branch itself is local-first; the security defect was in remote read projections. The HTTP branch on an unexpected null local result remains a fallback risk. Relationships and knowledge aggregate reads still lack the full per-record/ancestor visibility contract.
RISK: Restricted findings/results/calculations could leak through list, search or sync pull. Overview counts/recents/tags and relationship endpoints could disclose restricted Notes/Resources. The desktop previously retained revoked cached findings/results and accidentally removed pending local knowledge edits during tombstone cleanup. An HTTP fallback could leave a local-only view stale.
RECOMMENDED CHANGE: Reuse the shared visibility predicate across record reads and Notes aggregates; use effective Resource access (including folder ancestors and attached Notes) for Resource aggregates. Fail closed on unexpected Tauri null writes. Filter relationships by both endpoints and test revocation cleanup.
ACTUAL CHANGE MADE: Findings/results/calculations list, search and sync-pull queries now use visibilityReadSql. Search SQL now supplies the aliases its predicate references. Overview/tags use Note visibility SQL and effective Resource access. Relationship lists/pull filter both endpoints, and direct create/delete require readable endpoints and project edit. Duplicate HTTP create no longer reassigns an existing relationship's project. Finding/result update/delete require restricted edit grants, and project-owned create/edit paths require actual project edit access. Linked finding titles are visibility-gated; experiment titles are temporarily omitted rather than risking an unauthorized join. Knowledge pull now returns visible-ID snapshots; Tauri requires them and removes unauthorized cached rows while preserving pending local edits. SQLite inspection errors fail the pull rather than silently dropping rows. Knowledge sync update/delete now authorize the existing server row's project and restricted visibility, rather than trusting the submitted project_id; a different change ID cannot silently reuse an existing entity ID. Sync create now persists the requested visibility and gives the creator an edit grant for restricted findings/results; visibility changes on update reject explicitly pending a grant-aware transition design. Non-admin Knowledge and Note pulls no longer receive tombstone IDs because authorized visible-ID snapshots already drive cache eviction. No local-write fallback rewrite yet.
VERIFICATION: Source regression tests, Node syntax check, desktop TypeScript check and Rust cargo check pass. On actual PostgreSQL, unique restricted finding/Note/Resource/relationship probes were hidden from member list/search/sync pull/overview/tags/relationships, shown after view grants, then hidden after revocation; pull visible IDs matched returned rows. A separate isolated researcher/project probe showed view-only grants cannot update a restricted finding, edit grants can, loss of project membership blocks edit even with a spoofed null project_id, and hidden relationship endpoints reject sync create/delete. All exact probe rows were removed. Desktop two-account cache eviction and offline retry still need runtime verification.
STATUS: Server visibility and sync mutation boundary repaired; linked-record projections, offline retry and two-client matrix remain open.
```

### 15. Notification and assistant UI writes

```text
MODULE: Notifications, assistant conversation/context
FILE: desktop/src/api/experience.ts; desktop/src/api/collaboration.ts; desktop/src/components/AssistantChat.tsx
CURRENT WRITE PATH: Notification read markers and project comments use HTTP directly. AssistantChat sends PATCH preferences, DELETE conversation and POST chat directly from the component rather than through an API repository. No local/outbox mutation exists for these paths.
WHY IT BYPASSES OFFLINE-FIRST: UI-level HTTP hides the mutation from the central sync inventory. Chat generation is an intentional online effect; context preference and conversation deletion have no local reconciliation contract.
RISK: Stale unread counts or assistant history; duplicate comments/chat submissions on uncertain retry; context UI may show an unsaved selection because it updates optimistically before PATCH succeeds.
RECOMMENDED CHANGE: Move writes behind explicit domain APIs. Classify chat generation as online-only with request IDs and honest pending/error state; decide whether notification read state and comments should be offline-capable; reconcile or invalidate local state after server success.
ACTUAL CHANGE MADE: None.
VERIFICATION: Direct UI/API source-path review only; retry and two-account PostgreSQL checks pending.
STATUS: Open — mixed deliberate online effects and offline-capable records.
```

### 16. UUIDs and retry keys outside Notes/Resources

```text
MODULE: Cross-domain identity and replay
FILE: desktop/src/api/local-inventory.ts; desktop/src/api/excel.ts; desktop/src-tauri/src/local_knowledge.rs; desktop/src-tauri/src/local_engineering.rs; desktop/src-tauri/src/local_locations.rs; backend/src/routes/sync.js
CURRENT WRITE PATH: Inventory and Excel generate entity UUIDs in TypeScript; Rust knowledge/engineering/locations generate UUIDs for records and separate outbox change IDs. The server sync endpoint stores change_id with device, user, operation and payload ownership checks. Direct HTTP endpoints often rely on server-generated IDs and have no equivalent retry key.
WHY IT BYPASSES OFFLINE-FIRST: Identity creation is scattered by module; direct HTTP POST retries do not participate in sync_idempotency. A new client ID and change ID for the same logical user action can create a second row despite per-change idempotency.
RISK: Duplicates on uncertain response, cross-device identity drift, or non-replayable direct imports/actions.
RECOMMENDED CHANGE: Define one canonical UUID representation and persisted logical-operation ID; preserve it across retries and API modes. Explicitly test create, update, delete and replay for every entity family, including browser HTTP writes.
ACTUAL CHANGE MADE: None in this slice.
VERIFICATION: Source review confirms UUID-generation sites and the sync_idempotency ownership/payload checks; full per-domain replay tests pending.
STATUS: Contract open; no claim of repository-wide normalization.
```

### 17. Engineering scope and record mutation authority

```text
MODULE: Engineering calculations and tests
FILE: desktop/src/api/engineering.ts; desktop/src/api/sync.ts; desktop/src-tauri/src/local_engineering.rs; backend/src/routes/engineering.js; backend/src/routes/sync.js
CURRENT WRITE PATH: Tauri create/delete calculation and create/update/delete test commands write SQLite plus outbox; browser writes use HTTP. Server lists and compare previously checked project access but ignored each record's visibility. Delete/update routes likewise checked project edit but not restricted-record edit grants.
WHY IT BYPASSES OFFLINE-FIRST: Core Tauri writes do not deliberately bypass the outbox, but the server read/mutation authority could diverge from a restricted local record. Browser direct POST retries do not use sync change IDs.
RISK: Restricted calculations/tests leak to ungranted project members; a project editor with domain permission can mutate a restricted engineering record without an edit grant. Browser retry may duplicate a calculation or test.
RECOMMENDED CHANGE: Apply both project and record visibility to every read, and require a restricted edit grant for mutation. Preserve domain permissions. Verify sync pull and offline replay separately; make browser POST idempotent if retained.
ACTUAL CHANGE MADE: Calculation/test lists and compare now apply canReadEntity after project access. Calculation delete and test update/delete require canEditRestrictedEntity for restricted records. Compare strips the visibility field it fetched only for authorization. Engineering sync pull now applies both record visibility and project access and returns visible-ID snapshots. Desktop pull requires the snapshot and evicts revoked cached rows without discarding pending local edits. Engineering sync update/delete now authorize the existing server row's project and restricted visibility, ignore client-supplied actor/project changes, and reject a new change ID colliding with an existing entity ID. Sync create persists requested visibility and grants the restricted creator edit access; visibility transitions on update reject pending a grant-aware design. Non-admin Engineering pulls no longer receive tombstone IDs; the snapshot still removes deleted/revoked cached rows.
VERIFICATION: 43 backend source/security tests, Node syntax, desktop TypeScript and Rust cargo checks pass. Against the existing PostgreSQL service, uniquely named calculation/test rows were hidden from a non-admin in list/compare/sync pull, visible after grants, and hidden after revocation. A restricted sync create was hidden from the member, gave its creator an edit grant, replayed with the same change ID, rejected a second change ID using the same entity ID, and replayed delete without restoring the row. The probe removed its exact rows, grants, tombstone and idempotency entries. Delegated-editor mutation denial and desktop two-client revocation/retry remain unverified.
STATUS: Server sync/read guards and local snapshot reconciliation implemented; complete role and desktop matrix open.
```

### 18. Sync push authority versus submitted payload

```text
MODULE: Cross-domain sync push authorization
FILE: backend/src/routes/sync.js; desktop/src/api/sync.ts
CURRENT WRITE PATH: Desktop outbox POSTs to /sync/push with entity ID, operation and a submitted record. Server validates the user's domain permission and a change-id replay key, then dispatches domain handlers. Knowledge and Engineering handlers previously used the submitted project_id for authorization before loading the existing row. A create with an already-used entity ID returned the existing row as if the new change succeeded.
WHY IT BYPASSES OFFLINE-FIRST: The outbox is present, but server replay could mutate a row outside the sender's actual scope or acknowledge a different logical create. The submitted record is not authoritative for ownership, and change-id idempotency does not cover a second change ID for the same entity ID.
RISK: Unauthorized update/delete of project-scoped or restricted records, false sync success, and local/server identity divergence. A later replay could echo stored response_json after record access was revoked. Relationship endpoint permissions are still not mirrored in the sync handler.
RECOMMENDED CHANGE: Authorize update/delete from the locked current server row, validate create against the target project and endpoint scope, reject ID collision unless the exact change ID already replayed, and keep immutable actor/project fields server-owned. Return a minimal acknowledgement on push/replay and pull authorized current rows separately. Add role-matrix tests for delegated editor, view-only grantee, revoked user and deleted project.
ACTUAL CHANGE MADE: Knowledge and Engineering update/delete now check the existing project's edit authority and restricted edit grant. New create IDs cannot silently alias an existing row; same change-id replay still succeeds through sync_idempotency. Engineering create actor is server-owned, and Engineering update cannot change project or actor. Finding/result sync create preserves validated visibility with a restricted creator grant; unsupported visibility transitions fail explicitly. All sync pushes/replays now return an acknowledgement without echoing current or stored entity snapshots; the desktop already ignores result data and pulls authorized state separately. A shared relationship-access helper now gates both direct HTTP and sync create/delete on readable endpoints and project scope.
VERIFICATION: Static handler tests pass. Actual PostgreSQL Engineering probe passed restricted create, same-change replay, different-change collision, delete replay and exact cleanup. The isolated researcher/project probe passed restricted view/edit, stored-project, relationship endpoint and disabled-account checks against actual PostgreSQL; it removed its temporary user, project, records, grants, idempotency and audit entries. A real revocation replay response and desktop two-client cache check remain open.
STATUS: Relationship and existing-row boundary repaired; full two-client matrix open.
```

### 19. Null local IPC results on core desktop mutations

```text
MODULE: Notes, Knowledge, Locations and Projects
FILE: desktop/src/api/notes.ts; desktop/src/api/knowledge.ts; desktop/src/api/locations.ts; desktop/src/api/projects.ts
CURRENT WRITE PATH: In Tauri, each module invokes a local Rust command and checks its result against null before the browser HTTP branch. A null result could enter that branch even after a local write; a Rust unit-returning delete may serialize as null.
WHY IT BYPASSES OFFLINE-FIRST: A null IPC result is ambiguous but was treated as permission to issue an independent server write. Browser HTTP is intentional; Tauri fallback is not.
RISK: Duplicate create, stale local state after a remote update, or a local delete followed by a second server delete and sync conflict. The bug covers core project subrecords as well as top-level records.
RECOMMENDED CHANGE: Treat Tauri IPC as authoritative: failures and missing value results stop with an explicit local error. Treat unit-returning delete/unlink commands as completed local operations regardless of whether IPC serializes void as null or undefined. Retain HTTP only when no Tauri runtime exists.
ACTUAL CHANGE MADE: The four local helpers now reject unexpected null value results on Tauri. Delete/unlink commands treat a null unit result as completed, so no remote fallback follows. Browser paths remain unchanged.
VERIFICATION: Desktop TypeScript check passed; source review confirms the helper is shared by each module's local-first mutations. Forced-null IPC and two-client PostgreSQL failure-injection tests remain pending.
STATUS: Fallback closed in source; runtime failure injection open.
```

### 20. Global desktop search reads raw local snapshots

```text
MODULE: Cross-domain search and cached permission projection
FILE: desktop/src-tauri/src/local_search.rs; desktop/src/api/search.ts
CURRENT WRITE PATH: Search itself is read-only, but it reads snapshots written by local mutations and server pull. Before this change it scanned raw projects_state and the wrong transactions_state key directly, without checking each domain's current offline permission or normal project visibility filter.
WHY IT BYPASSES OFFLINE-FIRST: Search is a second projection over local state. It must obey the same account, permission and financial-field contract as the repositories that own those snapshots; otherwise an outbox/pull-correct record can still leak through search.
RISK: Cached hidden projects, nested project records or financial fields could be matched and returned in full search result data. Transactions were incorrectly absent because the actual finance key is finance_transactions_state. Revoked access may remain visible until a successful pull or offline lease expiry.
RECOMMENDED CHANGE: Gate each local search domain on its current local permission; use the project repository's filtered list and finance repository's projected transaction list; search/return only ordinary project fields. In Phase 2, exercise revocation and account switch with two desktop clients, and decide the offline lease policy.
ACTUAL CHANGE MADE: Local search now checks inventory/projects/notes/resources/finance permissions, uses list_local_projects for project scope, uses get_local_transactions for ordinary/sensitive finance projection, and narrows project search input/result data to ordinary fields. Findings use projects.view. Search still reads the local snapshots of notes/resources/findings and relies on their pull reconciliation, so revocation timing remains governed by the pending offline-lease decision.
VERIFICATION: cargo check passed. A Rust unit test confirms project search cannot match or return budget, transactions or nested task data. Actual two-client revocation/search testing remains open.
STATUS: Immediate local search side-channel repaired; revocation timing and two-client proof open.
```

### 21. Sync conflict controls assume inventory permission

```text
MODULE: Cross-domain sync conflict listing and retry/delete resolution
FILE: desktop/src-tauri/src/local_db.rs; desktop/src/api/sync.ts
CURRENT WRITE PATH: A rejected outbox change creates an account-owned SQLite sync_conflicts row. The conflict list requires inventory.view before reading any entity type; resolve_sync_conflict also requires inventory.view, then adds finance.view_sensitive for finance entries. keep_local rewrites and retries the same outbox payload; accept_server/dismiss mark the change synced. accept_server resets only the inventory pull cursor.
WHY IT BYPASSES OFFLINE-FIRST: Outbox recovery is global, but its local authorization and refresh path are hard-coded to inventory. A user with valid notes/projects/finance permissions but no inventory.view cannot inspect or resolve their own domain's rejected change, so a legitimate offline mutation can remain stuck indefinitely.
RISK: Hidden pending changes and misleading sync status; improper exposure if the inventory permission is used as a proxy for another domain; accepting a non-inventory conflict without an explicit domain refresh may leave stale local state until a later full pull. Finance requires an unrelated inventory grant.
RECOMMENDED CHANGE: Derive the conflict's domain from its entity_type and operation; gate payload visibility by the domain's read permission and retry by its mutation permission. Always permit a safe account-owned discard path after an explicit confirmation, even when edit access was revoked. Trigger domain-specific pull after accept_server and preserve the original change_id for retries. Test each domain and finance-sensitive case against current permissions.
ACTUAL CHANGE MADE: Conflict listing now uses the outbox entity/domain and redacts unavailable payloads. Owner-only discard does not require an unrelated inventory grant. Retry requires the correct domain write authority. Inventory explicit overwrite creates a NEW change ID; ordinary retry retains the original payload and key.
VERIFICATION: Rust tests verify Notes recovery without inventory access, denied retries after permission loss, immutable retries, fresh UUID/account-stamped overwrite, and owner discard. Full per-domain recovery UX remains Phase 2.
STATUS: Implemented foundation; per-domain conflict/version UI and concurrency matrix remain Phase 2.
```

### 22. Project financial summary mixes local projections

```text
MODULE: Projects, inventory valuation and finance summary
FILE: desktop/src/api/projects.ts; desktop/src/api/transactions.ts; desktop/src-tauri/src/local_finance.rs; backend/src/routes/projects.js; backend/src/routes/items.js
CURRENT WRITE PATH: Tauri project, transaction and item mutations each use their local repositories/outbox, while browser mutations use server routes. The desktop project-financial-summary read recomputes from locally cached projects, projected transactions and item unit costs; the server summary is a separate PostgreSQL view. A user with finance.view but not finance.view_sensitive receives expense-only local transactions, so desktop project_income computes as zero even though the server ordinary-finance summary may include aggregate income. Inventory item endpoints currently expose unit_cost and replacement_cost under inventory.view.
WHY IT BYPASSES OFFLINE-FIRST: No business write bypass occurs here, but the derived local read is not governed by one shared finance projection/version contract. Direct server writes in finance imports, purchases and project workflow can change these aggregates before the local cache catches up.
RISK: Different budget/income totals between desktop and browser; stale totals after server-only imports; potential cost disclosure if inventory.view is not intended to include valuation fields. Treating cached line-item finance as a summary source may overstate what an ordinary finance viewer is allowed to inspect.
RECOMMENDED CHANGE: Define the finance field policy explicitly (including whether inventory unit costs require inventory.view or finance.view). Build the same aggregate from authorized server-pulled summary data or a tested local projection whose inputs include authorized aggregate income without exposing individual sensitive transactions. Version/invalidate it after imports and project/item writes, then test role combinations against PostgreSQL and two desktop clients.
ACTUAL CHANGE MADE: None; no valuation policy was inferred from the current implementation.
VERIFICATION: Source-path comparison of desktop summary, local finance projection, server project summary and item GET fields. Actual role/output matrix pending.
STATUS: Open — finance projection and cost-visibility policy required.
```

### 23. Direct server deletes omitted finance tombstones

```text
MODULE: Finance transactions, budget periods and funding sources
FILE: backend/src/routes/transactions.js; backend/src/routes/budget-periods.js; backend/src/routes/funding-sources.js; backend/src/routes/sync.js; desktop/src-tauri/src/local_finance.rs
CURRENT WRITE PATH: Desktop normal finance deletes use SQLite/outbox; browser and some online callers invoke direct HTTP DELETE. The sync handler wrote tombstones, but the three direct DELETE routes did not. The sensitive finance pull returns rows plus up to 1,000 latest finance tombstones, and local finance merge removes cached rows only when their IDs appear in that tombstone list.
WHY IT BYPASSES OFFLINE-FIRST: A server DELETE without its sync deletion event is invisible to an already-cached desktop client. It bypasses the cross-device delete contract even though the local outbox path is correct.
RISK: A deleted transaction, budget period or funding source can remain as a phantom local record indefinitely on another device. A later offline edit can conflict with the missing server row. The 1,000-tombstone pull cap remains a separate long-offline reconciliation risk.
RECOMMENDED CHANGE: Commit the DELETE and matching tombstone atomically for every direct finance route; verify API deletion and pull on actual PostgreSQL. In Phase 2, add authoritative visible-ID reconciliation or paginated tombstones so long-offline clients cannot miss older deletions.
ACTUAL CHANGE MADE: All three direct DELETE routes now use a PostgreSQL transaction that deletes the exact row and inserts/upserts its finance tombstone before commit. Existing permission and project-delete middleware remain in place. The probe creates and removes only three uniquely identified records.
VERIFICATION: The API-only container was rebuilt without recreating PostgreSQL. The opt-in direct-delete-live-probe passed direct DELETE, physical row absence, tombstone presence and finance-pull inclusion for all three entity types on the existing PostgreSQL service; it cleaned its exact rows, tombstones and audit entries. The >1,000-deletion and two-client cache matrix remain open.
STATUS: Direct delete gap fixed; long-offline tombstone coverage open.
```

### 24. Direct location delete omitted its sync tombstone

```text
MODULE: Inventory locations
FILE: backend/src/routes/locations.js; backend/src/routes/sync.js; desktop/src-tauri/src/local_locations.rs
CURRENT WRITE PATH: Desktop local delete queues a location outbox event and the sync handler writes a tombstone. Browser DELETE /locations/:id removed the server row but did not write a tombstone. Location pull returns current rows and up to 1,000 tombstones; the local merge removes only explicitly deleted IDs.
WHY IT BYPASSES OFFLINE-FIRST: A direct server delete did not emit the event required by the other clients' local reconciliation path.
RISK: Deleted locations remain in another desktop's SQLite cache and may appear in search or selectors; an offline edit then rejects against a missing server row. Old deletes can still be missed after the 1,000-tombstone limit.
RECOMMENDED CHANGE: Write the direct DELETE and tombstone in one PostgreSQL transaction, verify pull against the actual service, then replace the bounded tombstone-only reconciliation with an authoritative or paginated scheme in Phase 2.
ACTUAL CHANGE MADE: Direct location DELETE now commits the exact row removal and a location tombstone atomically, retaining inventory.delete permission and audit behavior.
VERIFICATION: API-only image rebuild and opt-in direct-delete-live-probe passed physical row absence, tombstone presence and location-pull inclusion on the existing PostgreSQL service; it cleaned its exact temporary record, tombstone and audit entry. Two-client cache and >1,000-delete matrix remain open.
STATUS: Direct delete gap fixed; long-offline reconciliation open.
```

### 25. Inventory browser write routes did not match the desktop API client

```text
MODULE: Inventory item deletion and bulk status/deletion
FILE: desktop/src/api/items.ts; backend/src/routes/items.js; backend/src/index.js; backend/src/routes/sync.js
CURRENT WRITE PATH: Tauri item mutations use SQLite/outbox and sync push; browser calls DELETE /items/:id, POST /items/bulk-status and POST /items/bulk-delete. Those three HTTP routes were absent, even though the sync handler supported corresponding mutations. The API's generic POST gate also required inventory.create for every item POST, including stock movements and the missing bulk endpoints.
WHY IT BYPASSES OFFLINE-FIRST: The browser's server-authoritative branch was incomplete and permission routing did not match the operation. A desktop fallback to those URLs would fail instead of reconciling; adding them without tombstones would have created another delete divergence.
RISK: Browser item deletion/bulk actions returned 404; a user with the correct inventory.edit, inventory.delete or inventory.adjust_stock grant could be blocked by an unrelated inventory.create requirement. Cross-device item caches would retain direct deletes without tombstones.
RECOMMENDED CHANGE: Define the exact three routes with operation-specific permissions and atomic tombstones for deletes; give stock movements their adjust_stock gate in the mount middleware. Keep the desktop Tauri fail-closed behavior so these browser routes never become local-write fallbacks. Test all routes on existing PostgreSQL with uniquely identified records.
ACTUAL CHANGE MADE: Added single DELETE, bulk-status and bulk-delete routes; direct deletes and tombstones commit together. The mount middleware now routes bulk-status to inventory.edit, bulk-delete/single delete to inventory.delete, and movements to inventory.adjust_stock before its generic create rule. Tauri item writes still require local state/outbox and cannot fall through to these routes.
VERIFICATION: API-only rebuild succeeded. The opt-in inventory-routes-live-probe passed bulk status, single and bulk delete, row absence and all item tombstones on existing PostgreSQL; it cleaned only its three items, tombstones and matching audit entries. A non-admin permission matrix and two-client desktop reconciliation remain open.
STATUS: Route mismatch fixed; role/two-client verification open.
```

### 26. Different change IDs could claim an existing create ID

```text
MODULE: Cross-domain UUID identity and sync replay
FILE: backend/src/routes/sync.js; desktop/src/api/sync.ts
CURRENT WRITE PATH: Outbox push first checks change_id idempotency, then dispatches the entity create. Item and recently repaired Knowledge/Engineering creates reject an already-used entity UUID. Resource and finance creates still returned the existing row for an ID collision; movement create returned an existing movement. Resource also intentionally coalesces a distinct new link ID by URL and attachment context, and active download jobs are coalesced by resource.
WHY IT BYPASSES OFFLINE-FIRST: A different change_id is a different logical mutation. Acknowledging an unrelated existing entity by UUID tells the client its new local row was accepted while the server kept someone else's row. This is distinct from safe replay of the same change_id and distinct from the URL-based resource deduplication policy.
RISK: Silent local/server identity divergence, a false successful create, and possibly a duplicate or missing row after pull. The same issue remains for movement-ID collisions and requires a separate decision for URL/job coalescing versus a stable returned canonical ID.
RECOMMENDED CHANGE: Preserve same-change_id replay at the idempotency layer; reject a new create using an existing UUID with a domain-specific 409. Define explicit canonical-ID reconciliation when deduplication by natural key is intentional. Test same-ID/different-change and same-change replay on actual PostgreSQL for each domain.
ACTUAL CHANGE MADE: Resource and finance create-ID collisions reject distinct intents; movement-ID collision rejects without a second stock effect. Same-change replay preserves the original result under current response projection.
VERIFICATION: Actual PostgreSQL direct-delete, inventory-routes and finance-role probes passed; income-only finance probe covers movement collision and identical replay. Cross-client natural-key link convergence remains a Phase 2 case.
STATUS: Stable-ID collision guards verified for Finance, Resources, movements and Engineering; remaining domain/natural-key matrices assigned Phase 2.
```

### 27. Income-only finance create permission is blocked before domain validation

```text
MODULE: Finance sync push and granular permissions
FILE: backend/src/routes/sync.js; desktop/src-tauri/src/local_finance.rs
CURRENT WRITE PATH: Local transaction create checks direction and accepts finance.create_income for income. The sync push envelope maps every transaction create to finance.create_expense before applying the finance handler. The handler later checks finance.create_income for income, but it cannot be reached by an account granted income-create without expense-create.
WHY IT BYPASSES OFFLINE-FIRST: The offline write can be accepted locally under the correct granular permission, then the server rejects its outbox replay under an unrelated permission. This is a cross-layer permission-contract mismatch, not a user conflict.
RISK: Permanent pending income transaction and misleading sync attention for a valid role. Granting expense-create merely to unblock sync would overgrant financial authority.
RECOMMENDED CHANGE: Derive envelope permission from the validated transaction direction and use the same helper for local/server permission tests. Preserve finance.view_sensitive and project-edit checks for income. Add an actual PostgreSQL income-only/expense-only role matrix and replay test.
ACTUAL CHANGE MADE: Sync envelope derives income-create versus expense-create from transaction direction. Server retains sensitive finance/project checks and sets logged_by to the authenticated account. Local sensitive mutations require both financial read capabilities.
VERIFICATION: finance-role-live-probe passed on actual PostgreSQL: income-only grant succeeds and replays; expense creation is denied; author attribution and movement collision assertions passed.
STATUS: Implemented and verified on the actual PostgreSQL database.
```

### 28. Read projections leaked restricted parent/child records

```text
MODULE: Search, reports, context/evidence, assistant, finance, operations, notifications and automation
FILE: backend/src/middleware/{visibility,read-visibility,notification-visibility}.js; backend/src/routes/{search,reports,context,assistant,transactions,sync,excel-finance,operations,experience,collaboration,automation,media-downloads}.js
CURRENT WRITE PATH: Secondary reads queried raw rows or aggregates; project membership sometimes bypassed a restricted grant. Finance export/pull and a lab-visible Note could disclose a restricted project.
WHY IT BYPASSES OFFLINE-FIRST: Authorization on the main CRUD page did not constrain alternate projections or the next synchronized snapshot.
RISK: Confidential rows, names, snippets, queue metadata and aggregate counts visible without record access.
RECOMMENDED CHANGE: Enforce stored parent-project scope in the shared visibility predicate and runtime helper; filter secondary projections before response/count/source creation; require audit authority for raw activity; recheck notification references and return read acknowledgements without body echoes.
ACTUAL CHANGE MADE: Implemented those gates. Fixed Operations middleware to resolve the stored requirement ID from its mounted path. Fixed assistant item/location SQL columns and list-locations tool signature found by the live probe.
VERIFICATION: Seven PostgreSQL probes passed on final image, including the expanded surface probe covering hidden/granted/revoked records, parent-restricted lab notes, notifications, queue, assistant, aggregate finance, disabled users and denied operations edits.
STATUS: Implemented; targeted actual PostgreSQL verification passed. High-cardinality filtered pagination/query batching is a Phase 2 performance/coverage item.
```

### 29. Privileged offline authorization was renewed by permission refresh

```text
MODULE: Desktop authentication and local repository entry points
FILE: desktop/src-tauri/src/local_auth.rs; desktop/src-tauri/src/local_db.rs
CURRENT WRITE PATH: Cached login and permission refresh could both extend offline expiry; existing admin caches could outlive the approved privileged lease.
WHY IT BYPASSES OFFLINE-FIRST: A refreshed token/permission response is not proof the cached password is still valid after a reset.
RISK: Disabled/reset credentials remain usable offline longer than the approved period.
RECOMMENDED CHANGE: Cap privileged leases at 24 hours from successful server password authentication. Never renew authentication provenance on permissions refresh; preserve pending authored work on expiry.
ACTUAL CHANGE MADE: Implemented role/capability-based lease selection and startup caps. Refresh only narrows expiry; missing/corrupt provenance fails closed. Ordinary seven-day leases remain.
VERIFICATION: Rust tests pass for expiry after 25 hours, delegated privileges, missing timestamp, repeated startup and downgrade without lease extension.
STATUS: Implemented; local SQLite tests passed. Actual disconnected credential-revocation UX remains in the Phase 3 GUI matrix.
```

### 30. Resource editor copies had malformed SQL and incomplete scope inheritance

```text
MODULE: Resource PDF and DOCX editor copies
FILE: backend/src/routes/resource-editor.js
CURRENT WRITE PATH: File-copy operations assembled mismatched INSERT columns/values and did not atomically establish restricted creator access.
WHY IT BYPASSES OFFLINE-FIRST: Server-side derived assets are online effects, but must still preserve entity identity, provenance and visibility.
RISK: Failed copy, orphaned files or an improperly visible derived record.
RECOMMENDED CHANGE: Use one transactional insertion helper, new entity UUID, inherited parent/context/visibility, derived-from ID and creator edit grant. Clean only the generated destination on failure.
ACTUAL CHANGE MADE: Replaced PDF and DOCX copy inserts with the shared helper; retained existing cleanup.
VERIFICATION: Actual PostgreSQL PDF-copy probe returned 201, correct source ID and restricted scope, with creator grant; generated test directories and rows removed. Full DOCX/image editing validation is not represented as passed.
STATUS: PDF path runtime-verified; DOCX dependency and binary staging work explicitly remain open in Phase 2.
```

### 31. Long-offline finance/location cache depended on bounded tombstones

```text
MODULE: Finance and Location synchronization
FILE: backend/src/routes/sync.js; desktop/src/api/sync.ts; desktop/src-tauri/src/{local_db,local_finance,local_locations}.rs
CURRENT WRITE PATH: Complete row pulls were merged using only the latest bounded tombstone batch, leaving older deleted or newly revoked rows cached.
WHY IT BYPASSES OFFLINE-FIRST: An authoritative full pull must evict missing synchronized IDs, not rely on a recent deletion tail.
RISK: Stale/deleted rows survive reconnect; revoked financial projects may remain in the synchronized cache.
RECOMMENDED CHANGE: Explicit complete-snapshot marker, validated before merge. Evict missing synchronized IDs while retaining pending authored intents. Never treat an unmarked/error response as an empty authoritative snapshot.
ACTUAL CHANGE MADE: Added snapshot_complete contract and generic retain_authorized_snapshot used by Finance and Locations. Local income/sensitive mutations now also require finance.view.
VERIFICATION: Rust regression covers 1,505 old rows, one retained server row and one pending local row. Actual PostgreSQL finance pull/project revocation and delete-tombstone probes passed.
STATUS: Implemented and verified at helper/server boundary. Recovery-only display of revoked pending work remains a cross-domain Phase 2 requirement.
```

### 32. JSON export silently omitted data and included credentials

```text
MODULE: Administrative JSON export
FILE: backend/src/routes/system.js
CURRENT WRITE PATH: Export read nonexistent experiments table, swallowed per-table errors as empty lists, and selected every users column including password_hash.
WHY IT BYPASSES OFFLINE-FIRST: A server-authoritative export must not conceal incomplete reads or broaden credentials exposure.
RISK: Misleading backup contents and unnecessary offline exposure of password hashes.
RECOMMENDED CHANGE: Correct project_experiments table; fail export on query errors; allowlist safe user columns. Treat this as a data export, not a demonstrated full backup/restore.
ACTUAL CHANGE MADE: Implemented table correction, explicit user projection and error propagation.
VERIFICATION: PostgreSQL surface probe verifies experiments array, no exported password_hash, and non-admin rejection.
STATUS: Implemented; full consistent snapshot and restore certification remain Phase 3.
```

### 33. Backend dependency warnings include a bundled document-parser risk

```text
MODULE: Backend dependency supply chain / DOCX conversion
FILE: backend/package-lock.json; backend/src/routes/resource-editor.js; html-to-docx dependency
CURRENT WRITE PATH: Authenticated DOCX-copy HTML is processed by html-to-docx 1.8.0, whose package depends on image-size 1.2.1 and whose distributed bundle also contains image parsing code.
WHY IT BYPASSES OFFLINE-FIRST: Not an outbox problem; dependency execution is part of the server-effect security boundary.
RISK: npm reports high-severity parser denial-of-service advisories GHSA-5p2g-fcmc-qvqq and GHSA-w3rx-r6r6-pgpr. A lockfile-only override cannot be assumed to repair bundled code.
RECOMMENDED CHANGE: Replace or rebuild the document conversion dependency with a maintained compatible implementation; isolate conversion with timeout/memory limits and test image parsing, remote-resource policy, invalid documents, and DOCX output. Do not blindly force a major-version override.
ACTUAL CHANGE MADE: Ran non-forced npm audit fix: Express 4.22.3, Multer 2.4.0 and qs 6.16.0 now locked. Audit reduced from five affected packages to one high-severity image-size finding. No unsupported assertion of exploitability prevention.
VERIFICATION: Final Docker image built with npm ci; seven PostgreSQL probes, backend tests, desktop tests and build passed. npm audit still exits nonzero for image-size.
STATUS: OPEN security/release blocker, explicitly assigned first in Phase 2; Phase 1 is not an unconditional security sign-off.
```

## Repository coverage register

This register prevents a single grep result from being mistaken for sign-off. It covers every TypeScript file under `desktop/src/api` and the Rust local repositories as of this review. A file may appear in more than one row when it mixes paths. The numbered findings above contain the requested nine-field assessment; the register identifies where each file is assessed. Dynamic `RequestInit` wrappers and the UI call sites were also inspected, not just literal `method:` text.

| Surface | Files | Classification / finding |
| --- | --- | --- |
| Core Tauri local-first with browser HTTP branch | `budget-periods.ts`, `canvas.ts`, `engineering.ts`, `funding-sources.ts`, `items.ts`, `knowledge.ts`, `locations.ts`, `notes.ts`, `projects.ts`, `resources.ts`, `transactions.ts`, `local-inventory.ts` | SQLite/outbox for main desktop records; null and missing-snapshot guards, direct subroutes and authority gaps in findings 1, 2, 4, 6, 12, 14, 16–19. |
| Direct HTTP or mixed online operations | `automation.ts`, `collaboration.ts`, `experience.ts`, `mediaDownloads.ts`, `operations.ts`, `phase4.ts`, `purchases.ts`, `excel-finance.ts`, `excel.ts`, `system.ts` | Server-only actions and/or missing local projections/outbox in findings 3–8, 10–13, 15. Preview/calculation POSTs that do not commit records remain distinct from imports and mutations. |
| Server-authoritative identity and grants | `auth.ts`, `users.ts`, `permissions.ts` | Credential, role and grant changes intentionally require server authority; local credential/permission caches need coherent revocation in finding 9. |
| Sync and search | `sync.ts`, `search.ts` | Outbox replay/pull, retries, identity, conflict recovery and cached search in findings 16, 18, 20, 21, 23. |
| Read-only/helper modules | `context.ts`, `http.ts`, `item-sku.ts`, `local-backend.ts`, `operations-calculations.ts`, `reports.ts` | No independent domain mutation found; `http.ts` carries requests from callers and `local-backend.ts` carries IPC. |
| Direct desktop UI HTTP writes | `components/AssistantChat.tsx` | Assistant preferences, conversation delete and chat POST: findings 8 and 15. Other `components`/`pages` fetch callsites inspected here delegate writes to API modules; `ResourceViewerModal.tsx` has a file read, not a domain write. |
| Atomic local domain writers | `local_db.rs`, `local_excel.rs`, `local_finance.rs`, `local_inventory.rs`, `local_engineering.rs`, `local_knowledge.rs`, `local_locations.rs`, `local_notes.rs`, `local_projects.rs`, `local_resources.rs` | Domain changes generally write scoped SQLite state and outbox in one transaction. `local_db.rs` also writes sync metadata/cursors; `local_resources.rs` queues a download-job event without a separate local job row. Findings 1, 2, 6, 7, 14, 16–18. |
| Local writes without domain outbox | `local_inventory_cache.rs`, `local_system.rs`, `local_auth.rs`, `local_db.rs` | Inventory cache/pull and auth/session/cursor state are derived or device-local; daily-use preferences currently contain an account preference mutation without an outbox event (finding 3). Conflict-resolution outbox rewrites are finding 21. |
| Local read/projection | `local_search.rs` | No domain write; had a permission/financial projection bypass, finding 20. |

This is a **source coverage register**, not a completed runtime certification. Two-client retry, revocation, UUID collision, delete/pull and forced IPC failure matrices remain open. Any new API or Rust local module must be added here and assessed with the nine-field finding format.

## Earlier verification queue (superseded by PHASE1_EVIDENCE.md and the three-phase plan)

1. Add failure-injection tests proving Tauri inventory/canvas local failures issue zero HTTP writes.
2. Against the existing PostgreSQL service, use namespaced temporary records to test stable UUID/change-id retry, duplicate rejection, delete tombstones, and local pull. Clean only test-owned records after validating exact IDs.
3. Implement and test the approved hybrid daily-preferences contract in Phase 2; ownership is recorded in docs/architecture/daily-use-preferences.md.
4. Continue the same per-mutation inventory across remaining desktop API modules and direct UI HTTP calls. This document is deliberately **not yet an exhaustive repository sign-off**.
