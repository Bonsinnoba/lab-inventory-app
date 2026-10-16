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
FILE: desktop/src/api/items.ts; desktop/src/api/inventory-http.ts; desktop/src-tauri/src/inventory_sync_state.rs; desktop/src-tauri/src/local_inventory.rs; backend/src/inventory-apply.js; backend/src/inventory-sync.js; backend/src/inventory-http.js; backend/src/routes/sync.js; backend/src/migrations/20261009_inventory_versions.sql
CURRENT WRITE PATH: New desktop item CRUD/bulk/movements atomically commit SQLite state plus versioned outbox events. Browser item/storage/movement routes share the versioned PostgreSQL apply transaction, required audit/history, receipt and tombstones. Browser retry identities persist per account in tab session storage; browser remains online-only.
WHY IT BYPASSES OFFLINE-FIRST: Local-write fallback and listed browser split paths are closed. Newly reviewed imports now also use protocol 2. Previously queued immutable events retain their original semantics; no automatic payload rewrite occurs.
RISK: Legacy-event recovery and broader relationship/cache edge cases remain. Browser retry persistence survives tab reload, not clearing/closing its session storage; it is not a durable offline queue. Offline history can be stale; a first installation still needs one successful inventory download.
RECOMMENDED CHANGE: Preserve the transactional/versioned reference; finish legacy recovery and remaining inventory relationships. Test every remaining mutation rather than infer domain-wide completion.
ACTUAL CHANGE MADE: Account/base snapshot guards, canonical IDs, pending intent preservation, repaired IPC and ACK cursor reset. Added server integer versions, same-author/device predecessor outcomes, ordered target locks, stale bulk/delete rollback, additive-delta handling, transactional audit/history/tombstones and microsecond cursors. Browser routes now require stable keys/IDs and displayed versions; storage uses the same path. Retry after refresh reuses the original persisted body/base even when the displayed version advanced. Versionless caches fail closed; versioned conflicts disallow automatic overwrite and discard only confirmed connected batches.
VERIFICATION: October 9 latest: 65 desktop API tests, TypeScript, 37 native tests (7 opt-in live tests skipped by default), explicit inventory suite 9/9 including two disk clients against PostgreSQL. Actual PostgreSQL import/browser/version probes pass rollback, replay, permissions, predecessor ownership and 600-row pagination. History cache/read permissions and explicit empty initialization have native/API tests. Backend 55/55 after DOCX option correction. Detailed scope and limitations are in PHASE2_EVIDENCE.md.
STATUS: New inventory imports, pending-safe history refresh and explicitly confirmed empty-server initialization now verified in addition to the earlier protocol-2 slice. Broader relationships and legacy recovery remain open. No inventory-wide or Phase 2 sign-off.
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
CURRENT WRITE PATH: Tauri notification edit -> atomic account-scoped SQLite state + outbox -> versioned PostgreSQL apply -> pending-aware pull. Music stays device/account-local. Browser notifications use versioned idempotent PATCH; music uses localStorage.
WHY IT BYPASSES OFFLINE-FIRST: Original fallback and missing outbox are removed. Device-only music intentionally has no outbox under the approved hybrid contract.
RISK: Historical risk was divergent notification state and server-only writes after local failure. Concurrent stale edits now surface conflicts; pending work is retained until resolved.
RECOMMENDED CHANGE: Use the owner-approved hybrid contract in docs/architecture/daily-use-preferences.md: notifications_enabled per-account with transactional outbox, versioned server apply and pull; auto_pause_music and music_volume account-scoped per-device without an outbox. Preserve legacy server values during migration.
ACTUAL CHANGE MADE: Hybrid local/server repositories, additive version migration, shared browser/sync apply with atomic required audit + idempotency, predecessor handling, pending-aware pull, conflict protections, actual notification-delivery gate, explicit legacy music import and immediate player preference updates. Fixed browser PATCH UUID/text SQL inference from actual PostgreSQL failure.
VERIFICATION: Actual PostgreSQL probe and two disk-backed SQLite clients pass restart/replay/chained edits/conflict/account isolation/browser HTTP/device media checks. Native preference atomicity tests, browser fail-closed/retry tests and TypeScript check pass. Current commands and limitations: PHASE2_EVIDENCE.md.
STATUS: Hybrid data path implemented and automated database/client verification passed; GUI interaction/visual acceptance remains Phase 3. Not whole-phase sign-off.
```

### 4. Maintenance records

```text
MODULE: Inventory maintenance
FILE: desktop/src/api/maintenance.ts; desktop/src/api/items.ts; desktop/src-tauri/src/local_maintenance.rs; desktop/src/components/MaintenancePanel.tsx; backend/src/maintenance-sync.js; backend/src/routes/maintenance.js; backend/src/routes/sync.js
CURRENT WRITE PATH: Desktop -> immediate SQLite mutation + immutable authored outbox -> shared versioned PostgreSQL apply -> complete pending-aware pull. Browser -> versioned/idempotent HTTP using the same apply function.
WHY IT BYPASSES OFFLINE-FIRST: Original direct desktop HTTP mutations are replaced. Missing local response/error fails closed, with no server fallback.
RISK: Original offline failure, duplicate uncertain retry and stale operations views are addressed. Conflicting concurrent edits require explicit recovery, not automatic overwrite.
RECOMMENDED CHANGE: Add account-scoped local maintenance state with atomic outbox writes, server change-id idempotency, pull/reconciliation, and delete handling. Add an updated_at/version contract before merging concurrent edits.
ACTUAL CHANGE MADE: Additive version/authorship/tombstone migration; local CRUD/outbox transaction; UUID normalization; dependency chain/version checks; authenticated author and required audit in the same server transaction as idempotency; complete pull with pending-delete preservation; operations overview integration; explicit conflict-chain discard; browser uncertain retry retains identity.
VERIFICATION: Actual PostgreSQL probe and two disk SQLite clients pass offline create/update, restart/replay, repeated pull, concurrent conflict, delete/replay, cascade tombstone and permission checks. Three native unit tests and three API fail-closed/retry tests pass. See PHASE2_EVIDENCE.md for scope and commands.
STATUS: Core offline-first vertical slice implemented and automated verification passed; full GUI/release acceptance remains Phase 3.
```

### 4b. Operations suppliers

```text
MODULE: Operations suppliers
FILE: desktop/src/api/catalog.ts; desktop/src-tauri/src/local_catalog.rs; backend/src/catalog-sync.js; backend/src/routes/operations.js
CURRENT WRITE PATH: Desktop supplier CRUD uses atomic SQLite state plus authored outbox; browser uses shared PostgreSQL apply with stable ID/key and expected version.
WHY IT BYPASSES OFFLINE-FIRST: The previous direct desktop HTTP writes had no local repository. That path is replaced; no HTTP fallback on null/rejected IPC.
RISK: Historical uncertain retries could duplicate suppliers; stale edits and linked-item cleanup require ordered reconciliation.
RECOMMENDED CHANGE: Preserve shared catalog apply, canonical UUIDs, version/dependency checks, full snapshots and deletion guards; finish broader inventory relationship reconciliation.
ACTUAL CHANGE MADE: Supplier local repository and sync pull/push; immutable predecessor chain; PostgreSQL version/tombstone migration; transactionally required audit/idempotency; admin-only delete and linked-item timestamp advancement; browser replay identity and UI captured versions.
VERIFICATION: Two native unit tests, four API boundary tests, actual PostgreSQL parallel/replay/conflict/permission/delete probe, and two disk-client restart/replay/conflict/delete test passed (October 8). No GUI acceptance claimed.
STATUS: Supplier CRUD slice verified; broader inventory relationship/cache behavior remains Phase 2 work.
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
FILE: desktop/src/api/comments.ts; desktop/src/api/notifications.ts; desktop/src-tauri/src/local_comments.rs; backend/src/comment-sync.js; desktop/src/components/AssistantChat.tsx; desktop/src/api/automation.ts
CURRENT WRITE PATH: Comments create/delete and notification reads now commit local state + immutable account outbox. Browser comments share idempotent server apply. Assistant/automation effects remain server-authoritative HTTP.
WHY IT BYPASSES OFFLINE-FIRST: Comment/read-marker direct writes are replaced. Assistant generation and automation execution deliberately need server authority but still lack a complete retry/cache contract.
RISK: Duplicate comments/notifications, unauthorized author deletion, revoked cached content and lost unsent work; remaining assistant/automation retries can repeat effects.
RECOMMENDED CHANGE: Keep immutable comments with authenticated authorship and author/admin deletion, current parent authorization, full scoped pull, pending-delete retention and tombstones. Separately harden online effects.
ACTUAL CHANGE MADE: Comment repository, atomic outbox, canonical UUIDs, dependent deletes, no deleted-ID resurrection, server audit/idempotency/notification transaction, reauthorization before replay, visibility snapshots and revoked-content eviction without deleting authored outbox intent. Full-chain discard confirmation matches recovery behavior.
VERIFICATION: Two native comment unit tests and three API boundary tests passed; actual PostgreSQL parallel replay/exactly-once notification/author/parent/revocation/delete probe passed; two disk SQLite clients exercised offline create, restart, lost ACK, repeated pull and cross-client deletion against PostgreSQL (October 8).
STATUS: Comment/read-marker slices verified automatically; assistant/automation online-effect hardening and broader recovery/UI acceptance remain open.
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
FILE: desktop/src/api/excel.ts; desktop/src/api/inventory-http.ts; desktop/src/api/inventory-pull.ts; desktop/src-tauri/src/local_excel.rs; desktop/src-tauri/src/inventory_sync_state.rs; backend/src/inventory-sync.js; backend/src/inventory-http.js; backend/src/routes/excel.js
CURRENT WRITE PATH: Workbook preview freezes explicit create/update rows, canonical UUIDs, captured versions and one batch ID. Desktop imports atomically persist the merged SQLite snapshot and one immutable item/import event. Browser submits the same versioned JSON plan to shared PostgreSQL apply with a persisted retry key.
WHY IT BYPASSES OFFLINE-FIRST: Earlier missing-cache/server fallback is removed. Native invocation/parse/permission failures propagate, not masquerade as cache misses. Cache/pull writes are derived state and intentionally do not produce business outbox events.
RISK: Legacy queued import payloads retain their old semantics. Browser retry recovery lasts only as long as tab session storage. Inventory import accepts at most 500 rows and 10 MiB workbooks; old multipart mutation callers must migrate to reviewed JSON plans. Finance/purchase import conversion remains separate.
RECOMMENDED CHANGE: Retain immutable batch/row IDs and per-row authorization, exact preview bases, atomic local/outbox and server transactions. Never initialize a missing cache as empty solely because a local read failed.
ACTUAL CHANGE MADE: Fixed generated-UUID creates being classified as updates; canonicalized duplicate checks; preserved non-workbook fields on updates. Added import/view/create/edit/stock permission checks, quantity validation, all-target ordered locks, atomic per-row audit and single receipt, predecessor support and pending-pull/discard integration. Native IPC retry returns the previous batch result without reapplying. Browser uncertain re-preview retains original IDs/body. Empty first pull initializes only with snapshot_complete=true; first-use offline without a server snapshot still fails closed.
VERIFICATION: Three native import tests, three workbook API tests, browser re-preview/retry test and four pull-page tests pass. Actual PostgreSQL probe verifies rollback after an earlier row created, permission-denied rollback, parallel replay, mismatched-key rejection, single sync receipt and dependent edits. Two disk-client restart/lost-ACK import test passes. Existing shared database was not cleared to simulate an empty installation; empty-response behavior was tested at the API/native boundary.
STATUS: New inventory import path implemented and verified October 9; legacy recovery, workbook parser hardening and GUI acceptance remain separate open work.
```

### 11. Storage containers and item storage

```text
MODULE: Storage containers and item storage
FILE: desktop/src/api/phase4.ts; desktop/src/api/catalog.ts; desktop/src/api/inventory-http.ts; desktop/src-tauri/src/local_catalog.rs; backend/src/catalog-sync.js; backend/src/inventory-http.js; backend/src/routes/phase4.js
CURRENT WRITE PATH: Desktop container/item-storage writes use atomic local/outbox paths. Browser containers use shared catalog apply; browser item-storage edits and the legacy storage URL now use shared versioned inventory apply with required audit/idempotency.
WHY IT BYPASSES OFFLINE-FIRST: Earlier container and storage bypasses are removed; desktop failures never select the browser route.
RISK: Broader relationship/cache reconciliation and legacy writers remain separate inventory work; UI acceptance remains pending.
RECOMMENDED CHANGE: Preserve catalog/item versions and relationship constraints; finish remaining import/relationship paths and visual acceptance.
ACTUAL CHANGE MADE: Container repository/version/tombstone/linked-item guard retained. Storage-label UI captures its displayed version and retains its selected container. Both item update and storage PATCH require expected versions and stable browser retry keys; desktop still uses its outbox.
VERIFICATION: Catalog PostgreSQL/two-disk-client evidence from October 8 retained. October 9 actual PostgreSQL browser probe passes storage CAS and replay; desktop fail-closed API tests and TypeScript pass. No GUI sign-off.
STATUS: Container CRUD and item-storage browser mutation slice verified; broader inventory relationship/cache work remains open.
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
CURRENT WRITE PATH: Inventory imports now use an immutable atomic protocol-2 batch locally and shared versioned apply in the browser (Finding 10). Finance and purchase imports still POST workbooks directly from the desktop. Preview POSTs parse only; exports and templates are reads.
WHY IT BYPASSES OFFLINE-FIRST: Finance/purchase imports can create multiple database records without a local batch/outbox representation or atomic desktop reconciliation. The upload response alone is not a durable local commit.
RISK: Partial or repeated imports after network uncertainty, duplicate purchases/transactions, and finance or inventory cache divergence. Export projections and audit logging require independent security review.
RECOMMENDED CHANGE: Give each import an immutable batch ID, row IDs, server idempotency and reconciliation or a fully local parsed/outbox path; classify previews separately from writes. Preserve import-specific permission gates.
ACTUAL CHANGE MADE: Inventory batch/outbox/HTTP replay conversion and actual PostgreSQL tests in Finding 10. No finance/purchase import conversion in this slice.
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
MODULE: Notification read state; assistant conversation/context
FILE: desktop/src/api/notifications.ts; desktop/src-tauri/src/local_notifications.rs; backend/src/notification-sync.js; desktop/src/api/experience.ts; desktop/src/api/collaboration.ts; desktop/src/components/AssistantChat.tsx
CURRENT WRITE PATH: Both notification API aliases delegate to the local-first repository on desktop; browser uses frozen IDs and stable idempotency keys. Assistant component writes remain direct HTTP.
WHY IT BYPASSES OFFLINE-FIRST: Notification bypass is removed. Assistant online-effect writes still need a domain API/retry/cache contract.
RISK: Read-all retry could acknowledge later arrivals, cross-account markers or hidden content; assistant optimistic context/history can diverge.
RECOMMENDED CHANGE: Monotonic read acknowledgements for an explicit frozen ID set, account ownership and current visibility filtering; separately centralize online assistant effects and error states.
ACTUAL CHANGE MADE: Atomic local read/outbox, pending-aware full pull, revoked notification-content eviction while retaining ID-only outbox intent; PostgreSQL monotonic timestamps and shared idempotent aliases; future arrivals excluded from retries.
VERIFICATION: Native atomicity/account/revocation unit and three API boundary tests passed. Actual PostgreSQL ownership/visibility/parallel retry/timestamp/deleted-record probe and two-disk-client offline/restart/concurrent-read/lost-ACK/later-arrival/browser-parity test passed (October 8).
STATUS: Notification read-state slice verified automatically; assistant changes remain open.
```

### 16. UUIDs and retry keys outside Notes/Resources

```text
MODULE: Cross-domain identity and replay
FILE: desktop/src/api/local-inventory.ts; desktop/src/api/excel.ts; desktop/src-tauri/src/local_knowledge.rs; desktop/src-tauri/src/local_engineering.rs; desktop/src-tauri/src/local_locations.rs; backend/src/routes/sync.js
CURRENT WRITE PATH: Inventory and Excel generate entity UUIDs in TypeScript; Rust knowledge/engineering/locations generate UUIDs for records and separate outbox change IDs. The server sync endpoint stores change_id with device, user, operation and payload ownership checks. Direct HTTP endpoints often rely on server-generated IDs and have no equivalent retry key.
WHY IT BYPASSES OFFLINE-FIRST: Identity creation is scattered by module; direct HTTP POST retries do not participate in sync_idempotency. A new client ID and change ID for the same logical user action can create a second row despite per-change idempotency.
RISK: Duplicates on uncertain response, cross-device identity drift, or non-replayable direct imports/actions.
RECOMMENDED CHANGE: Define one canonical UUID representation and persisted logical-operation ID; preserve it across retries and API modes. Explicitly test create, update, delete and replay for every entity family, including browser HTTP writes.
ACTUAL CHANGE MADE: Inventory/browser/import paths use canonical UUIDs, immutable retry payloads and stable batch keys. Import creates have explicit operation labels rather than treating every generated ID as an update. Browser lost-ACK re-preview reuses the original generated IDs and bases.
VERIFICATION: Native duplicate-normalization and retry tests, desktop browser-reload/re-preview tests, actual PostgreSQL import/browser/version probes and two-client restart tests pass for inventory. Full per-domain replay tests remain pending.
STATUS: Inventory identity/replay slice verified; no claim of repository-wide normalization.
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
FILE: desktop/src/api/items.ts; desktop/src/api/inventory-http.ts; backend/src/inventory-http.js; backend/src/inventory-sync.js; backend/src/inventory-apply.js; backend/src/routes/items.js; backend/src/index.js
CURRENT WRITE PATH: Tauri uses SQLite/outbox. Browser item create/update/delete, bulk status/delete, stock movements and storage writes use explicit HTTP routes backed by the shared inventory transaction handler.
WHY IT BYPASSES OFFLINE-FIRST: Missing routes and incorrect permission routing were repaired earlier. Separate unversioned SQL bodies are now replaced; these endpoints cannot be selected after a desktop local failure.
RISK: Previously duplicate uncertain retries, stale overwrites, partial bulk effects and missing audit/history. Old external callers now fail closed unless they send UUID keys/IDs and captured versions.
RECOMMENDED CHANGE: Keep required retry keys and versions; migrate remaining imports/legacy writers explicitly and retain real PostgreSQL regression probes.
ACTUAL CHANGE MADE: Shared apply/ordered locks/version checks and atomic required audit/history/receipt/tombstone. Permission checks also run on replay. Browser tab-persisted immutable intents survive transport/5xx/truncated responses and reload; refreshed versions do not turn unresolved stock intents into new operations. UI supplies captured edit versions; desktop guards remain.
VERIFICATION: Actual PostgreSQL probes pass parallel create, mismatched key rejection, revoked replay, edit/history uniqueness, stale atomic bulk/delete, movement replay, stale absolute adjustment, storage CAS, deletion replay and tombstones. Eight browser API tests plus existing fail-closed suite pass (54 total). Two disk clients against PostgreSQL passed after shared apply extraction.
STATUS: Listed browser mutation routes and desktop regression verified October 9; remaining import/legacy paths and GUI/release acceptance are not complete.
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
FILE: backend/package-lock.json; backend/src/routes/resource-editor.js; backend/src/docx-input.js; backend/src/docx-converter.js; backend/src/docx-worker.js
CURRENT WRITE PATH: Authenticated DOCX-copy HTML -> strict reconstructed allowlist -> bounded separate converter process using pinned @turbodocx/html-to-docx 1.23.1 -> existing copy persistence.
WHY IT BYPASSES OFFLINE-FIRST: Not an outbox problem; dependency execution is part of the server-effect security boundary.
RISK: Original bundled image-size denial-of-service dependency was removed, not overridden. Conversion remains untrusted-input processing; execution, input/output and concurrency limits remain necessary. Separate newly reported dependency advisories are tracked in PHASE2_EVIDENCE.md.
RECOMMENDED CHANGE: Replace or rebuild the document conversion dependency with a maintained compatible implementation; isolate conversion with timeout/memory limits and test image parsing, remote-resource policy, invalid documents, and DOCX output. Do not blindly force a major-version override.
ACTUAL CHANGE MADE: Replaced html-to-docx; removed image-size; added HTML/image allowlist, remote-resource rejection, bounded child worker (15 seconds, 128 MiB V8 heap, two active jobs), input/output limits and error handling. Compatible proxy-addr patch 2.0.8 also applied on 2026-10-08; no forced Mammoth downgrade. October 9 corrected preProcessing to preprocessing, as required by the installed converter runtime, so already-sanitized HTML actually skips minification. Timeout/memory limits were not increased.
VERIFICATION: Five conversion tests passed on Windows and Docker, including text/table/link/image fidelity, malformed inputs, no remote requests, stuck-worker termination and recovery. Current serial backend regression 55/55 passed. See PHASE2_EVIDENCE.md for new advisory triage and GUI limits.
STATUS: Original bundled-parser blocker addressed with automated boundary tests; not unconditional dependency/security or GUI sign-off.
```

### 34. Composite pages and resource/media reads lose offline availability

```text
MODULE: Operations, Lab Intelligence, Dashboard, Reports, Collaboration, Downloads, Resources
FILE: desktop/src/api/operations.ts; desktop/src/api/phase4.ts; desktop/src/api/experience.ts; desktop/src/api/reports.ts; desktop/src/api/collaboration.ts; desktop/src/api/mediaDownloads.ts; desktop/src/api/resources.ts; corresponding desktop/src/pages files
CURRENT WRITE PATH: Read-side companion finding, not a newly found mutation. Reports/activity/download-queue reads still use direct HTTP. Operations/intelligence/dashboard now independently settle local sources under the captured account. Desktop Resources reads native metadata without an HTTP fallback or awaited queue enrichment. Media helpers still return server URLs even when named local.
WHY IT BYPASSES OFFLINE-FIRST: Some durable authorized read projections are still absent. A server-held downloaded file is not a desktop copy. Aggregate dependency rejection and fabricated healthy workspace status are repaired, but durable per-domain cache completeness/freshness is not yet established.
RISK: Lost access to cached work, delayed loads during server pause, hidden native/permission errors, misleading zero/healthy totals and confusion between device-available versus server-only media. Exact installed-desktop failures may also involve cache/session/lease/runtime detection; not yet determined.
RECOMMENDED CHANGE: Complete the owner-approved available-section contract: durable initialization/completeness and real last-sync/pending metadata, remaining authorized local projections and explicit media location. Never invent zero or bypass permissions. Keep server execution/AI generation explicitly online-only.
ACTUAL CHANGE MADE: Shared account-guarded independent reads with five-second deadline; overview partial/unavailable states, nullable metrics and honest local-read notice; workspace failure is unknown, not healthy. Desktop Resources metadata no longer calls HTTP enrichment/fallback. Native Notes/Resources/Projects read entry points enforce domain view permission. No binary copying or new report/activity/job cache yet.
VERIFICATION: 86 combined API/static-render/mixed diagnostic tests passed; four characterization cases still assert known Reports/activity/download/media gaps. Native 37 passed, 7 ignored; explicit actual-PostgreSQL two-client comments probe passed; TypeScript and production build passed. Controlled stalled reads were tested, not real Docker stop/pause or physical GUI acceptance. See PHASE2_EVIDENCE.md.
STATUS: Partial implementation — first overview/resource read slice verified. Durable completeness/freshness, remaining remote readers and installed-desktop outage acceptance remain open. No Phase 2 sign-off.
```

### 35. Offline session identity blocked authorized local repositories

```text
MODULE: Authentication; Dashboard/Operations/Intelligence/Resources; shared local repository guards
FILE: desktop/src/App.tsx; desktop/src/api/auth.ts; desktop/src/api/http.ts; desktop/src-tauri/src/local_auth.rs
CURRENT WRITE PATH: Local login/session restore supplies a native local session; protected domain writes continue through their existing SQLite/outbox paths. Previously App removed local tokens, while captureAccountSession required a token and used a local credential-row ID instead of the central account identity.
WHY IT BYPASSES OFFLINE-FIRST: Valid offline sessions were rejected before local reads/writes. Sending a local token to a server-only feature could also receive 401 and erase frontend authorization. Late unauthorized responses could clear a newer account's session.
RISK: Cached data appears inaccessible/empty; local edits fail; wrong expected-account identity blocks native operations. This is separate from missing file replication and intentionally server-confirmed effects.
RECOMMENDED CHANGE: Normalize central identity, restore and retain a distinct local session, never transmit local credentials as server JWTs, protect asynchronous account transitions, retain native lease/permission enforcement and verify with real API downtime.
ACTUAL CHANGE MADE: Native auth responses expose central account ID; validated local auth status includes the existing local session token for restoration. Frontend normalizes older native user shapes, retains local session tokens before permission loads, uses session generations, bounds auth requests and rejects cross-account restoration. Shared HTTP rejects local tokens before transport; stale 401 cannot clear a different token. Startup restoration ignores responses after a session change.
VERIFICATION: Ten new real-adapter regression cases passed; combined frontend suite 96 passed (four known-gap characterization checks remain), native suite 38 passed / 7 opt-in tests ignored; build passed. Real API stopped: owner confirmed manual offline login; actual Tauri Resources retained 12 records after reload, Dashboard loaded counts, and native process cold restart restored Dashboard. API restored healthy. See PHASE2_EVIDENCE.md for reconnect outcome and boundaries.
STATUS: Implemented and stopped-server login/read/cold-restart slice verified. Signed/native-verified permission caching, encryption, credential revocation, throttling, clock hardening and complete account/revocation coverage remain open in the Phase 2 security addendum. No whole-phase or offline file/write-lifecycle sign-off.
```

### 36. Password reset/change did not revoke existing server credentials

```text
MODULE: Authentication/security; temporary resource-download authorization
FILE: backend/src/routes/auth.js; backend/src/middleware/auth.js; backend/src/routes/resources.js; backend/src/credential-version.js; backend/src/migrations/20261009_credential_versions.sql
CURRENT WRITE PATH: Server-only password change/reset and account status update commit in PostgreSQL with required audit. Previously JWTs carried only a user ID; middleware checked account activity/current role but not whether credentials had changed.
WHY IT BYPASSES OFFLINE-FIRST: These sensitive mutations correctly bypass the outbox by design (never queue passwords). The defect is missing server-session invalidation and the resulting inconsistency with the planned offline credential/security version. It is not a reason to turn password writes into local mutations.
RISK: Old server tokens and temporary file access URLs remain usable after password reset/change. Re-enabling a disabled account revives old tokens. Database outages were also misreported as invalid tokens, potentially clearing valid frontend sessions.
RECOMMENDED CHANGE: Add a monotonic database credential version; bind all session/download JWTs to the version authenticated with the password; check current version on every request. Increment transactionally on hash changes/disabling and preserve required audit rollback. Follow with native-verified cached authorization and observed-revocation handling.
ACTUAL CHANGE MADE: Additive version-zero migration and SQL trigger (password hash change or active-to-disabled transition); token claims and middleware comparison; version-bound resource URLs; self-password version recheck under row lock; explicit reauthentication-required responses; authentication DB failures return 503. Old signed tokens without a version match only version zero, never later versions. No local cache/lease mutation, token replacement, data reset or password queue was introduced.
VERIFICATION: 64 backend tests passed, including three new version/middleware tests; targeted security suite 46 passed (overlapping, not additive). Real existing PostgreSQL probe passed 33 assertions using exact disposable accounts/resources: reset/change, legacy/media token rejection, disable/re-enable, authorization denial, audit rows, transactional rollback, direct-SQL invalidation, migration repeatability and other-account isolation. See PHASE2_EVIDENCE.md for packaged image checks and service restoration.
STATUS: Server-side implementation verified. NOT end-to-end offline revocation or Phase 2 closure: cached-password replacement, observed revocation/native trust, immediate desktop reauthentication UX, offline leases/security and actual two-account desktop outage acceptance remain open.
```

### 37. Observed server revocation left native authorization usable

```text
MODULE: Desktop authentication; shared HTTP; permissions; native offline session
FILE: desktop/src/api/auth.ts; desktop/src/api/http.ts; desktop/src/api/permissions.ts; desktop/src/App.tsx; desktop/src-tauri/src/local_auth.rs; desktop/src-tauri/src/main.rs
CURRENT WRITE PATH: Explicit server credential revocation previously cleared frontend token/user storage only. SQLite local_users/local_session could still authorize a restored session or cached-password login. Permission refresh set is_active=1 without a captured native-session guard.
WHY IT BYPASSES OFFLINE-FIRST: Security decisions observed online were not reflected in the local authorization source of truth. This is derived authorization/device-session state, not an outbox business mutation; locking local access must never become a delete of authored data or a server delete request.
RISK: A known-revoked session could return through offline restoration. A late response or permission refresh could affect a different/newer login. Successful password change left the old local password cache usable. Auth-expired events had no App listener to leave the authenticated UI.
RECOMMENDED CHANGE: Compare-and-lock the captured account/native session after explicit revocation; clear effective local authority while preserving pending work. Separate ordinary JWT expiry and network failures. Guard permission refresh and asynchronous UI updates; commit online credential/session publication atomically. Verify restart/account races and real server outage/reconnect.
ACTUAL CHANGE MADE: Native guard capture and transactional authorization lock; locked account cannot offline-login or restore. Permission refresh requires the captured native session and cannot reactivate a locked cache. Shared HTTP/auth observe SESSION_REVOKED/ACCOUNT_DISABLED; successful password change also locks its old cache. App handles auth expiry and guards late permission results. Auth 5xx restoration retains valid native identity. Online login no longer publishes a token paired with the previous user; cached credentials/session commit together. No business/outbox/author rows deleted.
VERIFICATION: Frontend suite 104 passed (including four retained known-gap characterization tests); final native ordinary suite 41 passed / 8 ignored. All seven targeted auth tests passed with the actual PostgreSQL regression enabled after making cached-password verification/session creation atomic. TypeScript and frontend production build passed. Native disk-reopen, stale/same-account guards, second cached account and rollback verified. Actual stopped API plus owner offline login and populated desktop dashboard observed on an earlier binary. Final native runtime rebuild and complete interactive revocation acceptance remain pending. See PHASE2_EVIDENCE.md for exact scope and cleanup.
STATUS: Implemented; automated native/frontend checks passed. Interactive revocation -> stopped-server offline login denial/restart remains UNVERIFIED because the desktop was closed/minimized and computer-use input conflicted with owner activity. Native-verified positive permission caching, secure storage, throttling and clock hardening remain open. No Phase 2 closure.
```

### 38. Renderer-supplied offline authority and missing local login safeguards

```text
MODULE: Native authentication, desktop login/permission refresh
FILE: desktop/src-tauri/src/native_authorization.rs; desktop/src-tauri/src/local_auth.rs; desktop/src/api/auth.ts; desktop/src/api/permissions.ts; desktop/src-tauri/{Cargo.toml,build.rs}
CURRENT WRITE PATH: cache_server_user previously trusted renderer-supplied central identity, role and permissions and minted a fresh SQLite lease. cache_server_permissions accepted arbitrary positive claims. Cached-password attempts had no persistent backoff and backward system-clock movement could prolong access.
WHY IT BYPASSES OFFLINE-FIRST: Local authorization was not rooted in a trusted native server exchange. Authorization cache writes are not domain outbox events; native verification must precede publication, not queue credentials or accept caller assertions.
RISK: A compromised renderer could grant offline authority or renew a lease. Delayed login could restore a signed-out session. Unlimited offline guessing and clock rollback weakened cached access.
RECOMMENDED CHANGE: Native password exchange and independently verified permission refresh against a fixed trusted endpoint; transactional generation guards; persistent per-account backoff and conservative clock high-water handling. Separately address secure storage, recovery and legacy cache trust.
ACTUAL CHANGE MADE: Native commands no longer accept role/grant/identity claims for login. Native HTTP uses build-time HTTPS or loopback-only HTTP origin, five-second request deadlines, no redirects/proxies and bounded response parsing. Permission refresh verifies server account and captured native session, never renews a lease, and locks observed revocation. SQLite login generations reject delayed online/offline completion. Per-account guessing backoff persists across restart; backward clock jumps beyond five minutes null leases without deleting outbox/business rows. Server credentials still reside in renderer storage; no encryption migration was performed.
VERIFICATION: Final native ordinary tests 48 passed / 9 ignored; targeted auth tests 10 passed including the actual PostgreSQL exchange/revocation fixture; the separately enabled real stopped-API native fallback/restart/expired-lease regression passed. Final frontend 105 passed; TypeScript, frontend production and native debug builds passed. See latest PHASE2_EVIDENCE.md for executable hashes and runtime limitations. Four frontend known-gap tests still characterize incomplete unrelated offline pages.
STATUS: Implemented bounded security slice, not full security/Phase 2 closure. Interactive authentication acceptance remains unverified at the sign-in screen. Encryption/recovery choice, protected token storage, CSP/direct-transport coverage, legacy authority transition and complete native repository authorization audit remain open.
```

### 39. Reports server dependency and misleading incomplete totals

```text
MODULE: Reports overview and CSV export (read-only projection)
FILE: desktop/src/api/reports.ts; desktop/src/api/reports-export.ts; desktop/src/pages/ReportsPage.tsx
CURRENT WRITE PATH: No domain mutation. Previously getReportsOverview always requested /reports/overview, including desktop offline use. CSV was generated in the renderer from that response.
WHY IT BYPASSES OFFLINE-FIRST: The report required a server response despite authorized local records. Missing sources could not be distinguished from empty datasets. This is a read dependency, not an outbox bypass.
RISK: No reports during API outages; incomplete data mistaken for zero; mixed quantity units added together; misleading export completeness.
RECOMMENDED CHANGE: Generate desktop projections from authorized local repositories, guard native report access/account continuity, retain partial sections, distinguish missing totals, and export explicit source/availability information.
ACTUAL CHANGE MADE: Desktop reads local project workspaces, resource metadata and the native inventory snapshot directly, with no report HTTP fallback. Native report permission is checked before/after aggregation, and account changes discard results. Task/experiment workspace failures produce partial/unavailable states. Inventory groups include units; stable IDs are counted once. UI shows unknown totals as a dash and resource charts use kind correctly. CSV now includes inventory, units, availability, generation time and local provenance; formula-like strings are escaped. Unreplicated audit aggregates are explicitly unavailable, not fabricated from modification times. Browser keeps its existing server endpoint.
VERIFICATION: Two focused permission/account-continuity checks passed. TypeScript checked as recorded in PHASE2_EVIDENCE.md. New aggregate/export/render regressions are prepared for the phase-end sweep; actual desktop outage/restart/reconnect and actual PostgreSQL comparison have NOT been run for this batch.
STATUS: IMPLEMENTED / AWAITING VERIFICATION. Source snapshot completeness/last successful synchronization and the replicated audit ledger remain open. No database writes, reset, migrations or stock changes in this batch.
```

### 40. Collaboration activity has no persistent offline read model

```text
MODULE: Collaboration activity / synchronization
FILE: backend/src/routes/collaboration.js; desktop/src-tauri/src/local_activity.rs; desktop/src-tauri/src/main.rs; desktop/src/api/activity.ts; desktop/src/api/collaboration.ts; desktop/src/api/sync.ts; desktop/src/pages/CollaborationPage.tsx
CURRENT WRITE PATH: Previously desktop getActivity performed GET /collaboration/activity on every page read. New sync path downloads a complete authorized snapshot and transactionally replaces an account-scoped SQLite sync_state projection. Business/audit authoring is unchanged.
WHY IT BYPASSES OFFLINE-FIRST: No durable local activity feed; disconnected reads failed and the page displayed zero/empty labels for missing data. Projection cache writes are not authored domain mutations and deliberately create no outbox events.
RISK: Loss of offline visibility; false empty history; leakage if account/role/session boundaries or revoked cache cleanup are mishandled.
RECOMMENDED CHANGE: Separate local reads from synchronization; durable complete snapshots, native account/admin/audit/lease/session checks, atomic replacement, explicit availability and source timestamp, safe revocation eviction.
ACTUAL CHANGE MADE: Added admin/audit-protected full snapshot endpoint, native account-scoped snapshot commands, sync pull integration and local-only desktop feed reads. Full snapshot must validate before replacement; failed/incomplete/older pulls preserve previous data. Stable event UUIDs normalize; duplicates reject the snapshot rather than duplicate display rows. Confirmed permission denial clears only captured account/session projection, not authored records or server audit data. Native reads enforce admin role plus audit permission; late login/account responses are rejected. UI distinguishes restricted/not-downloaded/empty/error and displays the persisted snapshot timestamp. Notification failures no longer masquerade as zero unread.
VERIFICATION: Build/syntax and focused safety checks recorded in PHASE2_EVIDENCE.md. Full snapshot/replay/UI, actual PostgreSQL endpoint, native disk restart, API outage/reconnect and large-ledger checks are queued for the phase-end sweep, not claimed passed.
STATUS: IMPLEMENTED / AWAITING VERIFICATION. New commands/endpoint require the rebuilt desktop/API at deployment. Whole-history snapshot transfer is intentionally complete, not a truncated 100-event cache; high-volume transfer/memory performance still needs measured acceptance. Experience activity and Reports audit aggregation are not converted by this finding.
```

### 41. Downloads queue/settings server reads and scheduled-write bypass

```text
MODULE: Downloads queue/history, enqueue, shared download settings
FILE: desktop/src/api/mediaDownloads.ts; desktop/src/api/downloads-local.ts; desktop/src-tauri/src/local_downloads.rs; desktop/src-tauri/src/local_resources.rs; desktop/src-tauri/src/local_db.rs; desktop/src/api/sync.ts; desktop/src/pages/DownloadsPage.tsx; backend/src/download-settings-sync.js; backend/src/download-queue-create.js; backend/src/routes/media-downloads.js; backend/src/routes/sync.js; backend/src/migrations/20261010_download_settings_version.sql
CURRENT WRITE PATH: Previously immediate desktop enqueue appended an outbox event but had no durable visible job projection; scheduled enqueue and settings bypassed it via HTTP. Queue/settings reads always required server responses. This batch moves desktop enqueue and settings into native/account-scoped outbox transactions and local projections; browser settings use the same versioned apply function and stable HTTP retry keys.
WHY IT BYPASSES OFFLINE-FIRST: Desktop schedule/settings writes could not survive disconnection. Missing settings prevented the whole Downloads page from rendering. Server-accepted queue intents could disappear between acknowledgement and a failed refresh.
RISK: Lost offline preparation; duplicate jobs across HTTP/sync; silent shared-settings overwrites; false empty history and misleading completion/worker-control status.
RECOMMENDED CHANGE: Separate durable local intent, server acceptance, worker execution and PC file availability. Persist complete authorized queue/settings snapshots; version shared settings; make enqueue and receipts atomic with outbox state; later convert worker controls with race-safe semantics.
ACTUAL CHANGE MADE: Added complete authorized snapshot pull, native local queue/settings reads and account/session/permission guards. Pending job rows derive durably from immutable outbox intents. Both immediate and scheduled desktop enqueue use the native path; same-resource requests reuse visible active intent. HTTP and sync enqueue now share resource-row locking and active-job lookup. Shared settings gain a non-destructive version column/trigger, expected-version conflicts, same-user/device dependency receipts and HTTP idempotency. Native receipt publication and acknowledgement are atomic before ordinary sync ACK; a later failed refresh cannot erase accepted jobs/settings. Pending settings overlay server snapshots without changing them, and conflict discard restores the base projection while retaining outbox evidence. UI separates pending sync, last-known server state and server completion, keeps queue visible without settings and blocks controls on pending/conflicted job IDs. Restricted non-admin resource enqueue fails closed until native scoped edit authority is available.
VERIFICATION: TypeScript, native cargo check and backend syntax passed; two focused local-failure/no-server-fallback and account-boundary checks passed. Remaining unit/diagnostic/render suites and real PostgreSQL/outage acceptance deferred per batch policy. An opt-in actual PostgreSQL rollback probe was authored but NOT RUN. Migration NOT APPLIED; no database reset/reseed or running service deployment.
STATUS: IMPLEMENTED / AWAITING VERIFICATION for local reads, enqueue and versioned settings only. Pause/resume/start/cancel/remove, editing an existing job, tool-status caching, binary/thumbnails replication, browser enqueue receipt replay and worker completion races remain OPEN. Do not label Downloads or Phase 2 complete. Apply migration and rebuild API/desktop together before acceptance.
```

## 42. Existing download controls bypass the desktop outbox; worker races

```text
MODULE: Downloads / worker / synchronization
FILE: desktop/src/api/mediaDownloads.ts; desktop/src/api/downloads-local.ts; desktop/src-tauri/src/local_downloads.rs; desktop/src-tauri/src/local_db.rs; desktop/src/pages/DownloadsPage.tsx; backend/src/download-job-control.js; backend/src/routes/media-downloads.js; backend/src/routes/sync.js; backend/src/media-downloads.js; backend/src/migrations/20261010_download_job_control_version.sql
CURRENT WRITE PATH: Desktop existing-job edits/start/pause/cancel/remove previously called HTTP directly. They now use native account-scoped SQLite outbox intents; sync and browser controls share versioned server apply with transactional idempotency receipts.
WHY IT BYPASSES OFFLINE-FIRST: Direct writes failed offline and had no durable intention or local reconciliation. Worker claim could clear a concurrent pause; resource completion and job completion were separate writes.
RISK: Lost controls, stale overwrites, duplicate retries, resurrected history, cancellation deleting completed media or claiming a false server outcome.
RECOMMENDED CHANGE: Keep pending intent separate from confirmed worker status; version controls, atomically publish receipts, enforce authorization/replay ownership and coordinate worker transitions with row locks. Preserve authored work and resource files.
ACTUAL CHANGE MADE: Added native guarded control command and immutable outbox payload with expected revision and base job; no HTTP fallback. One pending intention per canonical job, explicit conflict review instead of automatic overwrite. Shared server control apply and keyed HTTP retries; sync replay rechecks resource edit authority. Conditional worker claims, stop observer, atomic resource/job completion, late-completion outcome, per-job filenames and no cleanup on uncertain completion commit. Local pending-removal overlay and confirmed-removal tombstones; receipt revision/timestamp guards. History removal never deletes resource media.
VERIFICATION: TypeScript/native compilation, backend syntax and two focused adapter safety tests passed. Actual PostgreSQL rollback probe extended but NOT RUN. Full native persistence/receipt, HTTP replay, worker-race, permissions and real desktop Docker-outage/reconnect matrix deferred to phase-end sweep. New migration NOT APPLIED; running API/desktop NOT REDEPLOYED; no reset/reseed.
STATUS: IMPLEMENTED / AWAITING VERIFICATION for existing-job controls, not full Downloads completion. Remaining: PC binary/thumbnail replication, tool-status cache, scoped native edit grants, browser enqueue replay, snapshot interleavings, worker crash/recovery and multi-process startup coverage. Current deployment assumes one worker process. Filesystem/DB atomicity remains a recovery boundary. See October 11 evidence checkpoint.
```

## 43. Uploaded-video poster generation and local preview availability

```text
MODULE: Resource media previews / project canvas / offline files
FILE: backend/src/resource-posters.js; backend/src/routes/resources.js; backend/src/storage.js; desktop/src-tauri/src/local_resource_posters.rs; desktop/src-tauri/src/local_resources.rs; desktop/src/api/resource-posters.ts; desktop/src/api/resources.ts; desktop/src/api/sync.ts; desktop/src/components/VideoResourcePoster.tsx; desktop/src/components/ResourcesPanel.tsx; desktop/src/components/ResourceViewerModal.tsx; desktop/src/components/ProjectCanvas.tsx; desktop/src/pages/ResourcesPage.tsx
CURRENT WRITE PATH: Uploaded video bytes went to server storage without thumbnail extraction. Cards relied on metadata-only video elements. Added derived server JPEG generation and account-scoped native JPEG cache populated after metadata sync or upload acknowledgement.
WHY IT BYPASSES OFFLINE-FIRST: A remote media URL and SQLite metadata do not supply playable bytes or a persisted preview. Metadata preload does not guarantee a decoded video frame.
RISK: Blank video cards, unavailable offline previews, stale replacement posters, cross-account or revoked preview disclosure, parser/process resource exhaustion.
RECOMMENDED CHANGE: Extract bounded previews independently of playback; replicate verified derived bytes with account/session/permission guards; render cached previews without network fallback. Treat original file replication as a separate durable transfer contract.
ACTUAL CHANGE MADE: Added protected FFmpeg poster endpoint/preparation with source fingerprint, timeout, concurrency cap, fixed local paths, protocol/container restriction and atomic JPEG publication. Added SQLite poster cache guarded by active lease/account/native session/resource revision, known visibility denial and deletion pruning. Shared preview component/hook used by Resources, panels, canvas and viewer. Missing previews remain explicit; upload success is unaffected by extraction failure. Derived cache writes intentionally have no domain outbox event.
VERIFICATION: TypeScript/native compilation and backend syntax passed; two focused adapter safety tests passed. FFmpeg fixture extraction, real upload/replacement, native restart, revocation and actual Docker-offline UI acceptance NOT RUN, deferred to the phase-end sweep. No database reset/reseed or running service deployment.
STATUS: IMPLEMENTED / AWAITING VERIFICATION for video posters only. Full original-file/media replication, remote link/image thumbnails, binary revisions, quotas/preview retention, recoverable cache encryption and editor copies remain OPEN. Metadata-only edits currently invalidate the conservative local preview revision. See October 11 evidence checkpoint.
```

## 44. Original resource binary replication — server transfer foundation

```text
MODULE: Resources / downloaded media / device file availability
FILE: backend/src/resource-binaries.js; backend/src/routes/resource-binaries.js; backend/src/routes/resources.js; backend/src/resource-binaries.test.js; docs/architecture/resource-binary-replication.md
CURRENT WRITE PATH: Desktop metadata sync and poster cache exist, but original resource viewing still uses server URLs. New read-only manifest/chunk endpoints provide content-versioned bytes for the forthcoming native replication writer.
WHY IT BYPASSES OFFLINE-FIRST: SQLite resource rows and remote URLs are not PC file copies; original media cannot be opened offline merely because a resource card is cached.
RISK: Unavailable offline files, mixed revisions during resumed transfers, false availability, unsafe paths, stale permissions and duplicate records if replication is confused with creation.
RECOMMENDED CHANGE: Mirror authorized binaries into guarded account-scoped native storage with verified resumable transfer, atomic publication, local playback, visibility eviction and preserved authored work. Use content revisions rather than metadata timestamps.
ACTUAL CHANGE MADE: Added authenticated manifest and strict conditional chunk endpoints for server-owned uploaded/downloaded files; stable SHA-256 revisions, bounded ranges/IO/cache, per-chunk digest, replacement/path containment checks and post-IO current-authority validation. No domain mutations or outbox changes. Native transfer writer and playback are not implemented by this finding.
VERIFICATION: Nine focused filesystem/handler tests passed; syntax and whitespace checks passed. No database test was run. Docker engine is unavailable, so new endpoints are not deployed and actual PostgreSQL/desktop offline acceptance is pending. Existing databases and user files preserved.
STATUS: SERVER FOUNDATION IMPLEMENTED / AWAITING VERIFICATION. Native copies/resume/publication, guarded local playback, uploads/editor staging, quotas/retention, recovery/protected storage and full offline/reconnect verification remain OPEN. See October 11 continuation checkpoint.
```

## 45. Desktop-authored files — native staging and outbox publication

```text
MODULE: Resources / desktop uploads / synchronization
FILE: desktop/src-tauri/src/local_resource_uploads.rs; desktop/src/api/resource-uploads.ts; desktop/src/api/resources.ts; desktop/src/api/sync.ts; backend/src/resource-upload-staging.js; backend/src/routes/resource-uploads.js; backend/src/routes/sync.js; backend/src/migrations/20261011_resource_upload_staging.sql
CURRENT WRITE PATH: Desktop single-file selection stages managed bytes, then atomically publishes SQLite metadata plus a create outbox event. Sync transfers chunks before normal server create/receipt. Browser uploads remain HTTP.
WHY IT BYPASSES OFFLINE-FIRST: Previously desktop file creation required a multipart server request and failed offline before durable local publication.
RISK: Lost authored work, duplicate retries, partial publication, account-crossing access, unsafe paths, premature acknowledgement and missing audit provenance.
RECOMMENDED CHANGE: Durable native staging, stable IDs, atomic metadata/outbox, verified resumable transfer, transactional receipts/audit and guarded local viewing. Preserve uncertain work; no HTTP fallback.
ACTUAL CHANGE MADE: Native per-chunk authority guards, fsync/SHA-256, atomic metadata/outbox, resumable server staging, verified publication, transactional file-create audit, receipt binding, session-bound local reader and pending-sync UI. Windows URL encoding accommodated. Existing data preserved.
VERIFICATION: Native build and TypeScript passed. Seven adapter, two staging-input and nine binary filesystem/handler tests passed. Updated desktop launched with approval and responsive process confirmed. No live PostgreSQL or WebView/offline acceptance run. Docker unavailable; new migration/API deployment pending.
STATUS: IMPLEMENTED / AWAITING VERIFICATION for single-file desktop staging. OPEN: folder/editor uploads, older server-file replication, offline poster extraction, native non-admin note/folder scoped grants, metadata-revision reconciliation, large/non-range and suffix-range viewing, recovery/quota/encryption and restart/retry/delete/two-account acceptance. Not Phase 2 completion.
```

## 46. Folder child uploads and folder manifests still required HTTP

```text
MODULE: Resources / project canvas folders / file staging
FILE: desktop/src/api/resources.ts; desktop/src/api/resource-uploads.ts; desktop/src-tauri/src/local_resource_uploads.rs; desktop/src-tauri/src/local_resources.rs; desktop/src-tauri/src/main.rs; backend/src/resource-upload-staging.js
CURRENT WRITE PATH: Desktop folder children now stage into managed files and publish metadata/outbox together in a native batch transaction. Each child syncs with a stable resource/change ID through the single-file server protocol. Browser multipart behavior is unchanged. Folder manifests now read local metadata on desktop.
WHY IT BYPASSES OFFLINE-FIRST: uploadFolderFiles and getResourceManifest previously used HTTP unconditionally. Folder creation also passed snake-case parent keys to camel-case native IPC, risking an unattached folder.
RISK: Failed offline folder imports, partial local publication, incorrect project association, duplicate logical paths and unsafe relative paths.
RECOMMENDED CHANGE: Reuse native staging, preserve nested relative paths, atomically publish the selection, validate all boundaries and read the local manifest. Keep authority checks and stable identities.
ACTUAL CHANGE MADE: Native batch finalization (maximum 200 children), per-file hash/size verification and transactional outbox/metadata; preflight/native/server relative-path checks; duplicate selection/local-path rejection and serialized server sync-path checks; local manifest reads; corrected IPC parent mapping and guarded folder context. Staged bytes remain preserved on failure.
VERIFICATION: TypeScript and native cargo check passed. Thirteen frontend adapter and three server validation checks passed. Actual PostgreSQL, native transaction fault injection, Docker-offline/reconnect, two-client and WebView acceptance deferred to phase-end sweep; no mocked database substituted.
STATUS: IMPLEMENTED / AWAITING VERIFICATION. Folder creation is separate and may leave an empty folder on failed staging. Server publication is per-file, not folder-atomic. Non-admin scoped folder grants, staging recovery, legacy browser overwrite/race behavior, editor copies and full binary replication remain OPEN.
```

## 47. Sync receipt contract and independent acknowledgement (2026-10-12)

```text
MODULE: Sync / uploads / download controls
FILE: backend/src/sync-receipts.js; backend/src/routes/sync.js; desktop/src/api/sync-receipts.ts; desktop/src/api/sync.ts
CURRENT WRITE PATH: Existing SQLite/outbox IDs are pushed or replayed; safe server receipts bind upload revisions or atomically merge download controls before the matching local ACK.
WHY IT BYPASSES OFFLINE-FIRST: No new bypass, but the generic redacted receipt omitted native-required fields. One receipt exception prevented the entire batch from being acknowledged and hid other errors.
RISK: Already-committed work remains pending indefinitely; misleading retry state; unsafe manual clearing or re-creation would risk loss/duplicates.
RECOMMENDED CHANGE: Allowlist only receipt fields needed by native consumers, retain current authorization and historical-record redaction, and isolate each submitted change's confirmation.
ACTUAL CHANGE MADE: Minimal file ID/revision receipts; download control/settings allowlists behind existing authorization; per-change ACK/failure/conflict processing; missing/duplicate replies remain pending; unknown replies ignored; session checks and finally cleanup retained. No queue reset or new change IDs.
VERIFICATION: Seven targeted receipt regressions, nineteen related adapter/visibility checks, TypeScript check passed. Real upload replay returned original ID/revision; SQLite independently showed that upload acknowledged at 2026-10-11 18:01:55. All eight remaining deletion intents accepted by actual PostgreSQL API after finding 48; eight desktop ACKs were still pending at last read-only inspection. Computer-use approval timed out; no desktop completion claim.
STATUS: IMPLEMENTED AND DEPLOYED. Subsequent 2026-10-12 03:03 startup/read-only SQLite check confirmed ZERO pending rows, closing queue-drain confirmation. Full outage/two-client phase acceptance remains separate.
```

## 48. Resource deletion blocked by a canvas content constraint (2026-10-12)

```text
MODULE: Resources / project canvas / deletion synchronization
FILE: backend/src/migrations/20261012_canvas_resource_removal.sql; backend/src/canvas-resource-removal-live-probe.mjs
CURRENT WRITE PATH: Authorized deletion through the normal sync route, PostgreSQL transaction, tombstone and stable idempotency receipt.
WHY IT BYPASSES OFFLINE-FIRST: Not a bypass. ON DELETE SET NULL on project_blocks.resource_id contradicted block_content_matches_type, causing a permanent 23514 retry for referenced resources.
RISK: One resource deletion never commits; dropping the canvas block to work around it would destroy authored layout and connectors.
RECOMMENDED CHANGE: Convert the detached canvas reference to a valid text placeholder while preserving its identity, layout, title, annotations and connectors.
ACTUAL CHANGE MADE: BEFORE UPDATE OF resource_id trigger handles FK nullification for direct or folder-cascade deletion. Existing annotation text is retained; otherwise text becomes Resource removed. No bulk data deletion or constraint relaxation.
VERIFICATION: Actual PostgreSQL rollback probe passed direct/folder-cascade deletion with preservation assertions. The originally blocked deletion succeeded and replayed successfully using its original change ID; one receipt exists. The original block remains with its ID, x/y and Resource removed text. Server healthy after migration deployment.
STATUS: IMPLEMENTED / SERVER VERIFIED. Subsequent 2026-10-12 03:03 read-only SQLite check confirmed ZERO pending rows. Offline canvas projection acceptance remains OPEN; no database reset performed.
```

## 49. Automatic native resource copies (2026-10-12)

```text
MODULE: Resources / offline file reads
FILE: desktop/src-tauri/src/local_resource_replication.rs; desktop/src-tauri/src/local_resource_uploads.rs; desktop/src-tauri/src/main.rs; desktop/src/api/resource-replication.ts; desktop/src/api/resources.ts; desktop/src/api/sync.ts; desktop/src/components/ResourceFileStatus.tsx; desktop/src/pages/ResourcesPage.tsx
CURRENT WRITE PATH: Authorized server read → native bounded verified chunk → managed PC staging + SQLite verified offset → whole-file checksum and atomic file publication → guarded local capability reader. No business/outbox/server mutation.
WHY IT BYPASSES OFFLINE-FIRST: Previously only authored files and posters had native storage; server-only original/media bytes remained unavailable offline despite local resource metadata.
RISK: False offline availability, partial/cross-revision files, account leakage, lost progress and copy work blocking ordinary synchronization.
RECOMMENDED CHANGE: Account/session-bound native replication, trusted-origin requests, checksum/offset persistence, crash recovery, guarded reads and explicit device-copy status.
ACTUAL CHANGE MADE: Separate background coordinator and native copy commands, one 4 MiB chunk per call; native server identity and local authority checks; no redirects; bounded responses; manifest/range/revision/chunk/full-file validation; fsync/offset commit; rename recovery; derived-copy reader integration; persistent errors and PC-availability/progress cards. Authored files/outbox untouched.
VERIFICATION: TypeScript check and initial cargo check passed. Eighteen frontend coordinator/upload/folder checks, nine server binary checks, five poster/receipt checks and one native manifest validation test passed. These are focused checks, NOT native restart/resume or actual PostgreSQL outage acceptance. See PHASE2_EVIDENCE.md for build/startup checkpoint.
STATUS: IMPLEMENTED / AWAITING LIVE ACCEPTANCE. Physical derived-file reclamation, retention/quota, encryption/recovery, editor copies and large-file playback remain OPEN. Known revocation/deletion denies logical access without generating outbound deletion or removing authored work.
```

## 50. Desktop resource attachment moves (2026-10-12)

```text
MODULE: Resources / Attach-Move / project relationships
FILE: desktop/src/api/resources.ts; desktop/src-tauri/src/local_resource_attachments.rs; desktop/src-tauri/src/local_resource_replication.rs; desktop/src-tauri/src/main.rs; backend/src/resource-attachment.js; backend/src/routes/sync.js; desktop/src/pages/ResourcesPage.tsx
CURRENT WRITE PATH: Desktop API → native account/session/lease/permission checks → one SQLite transaction for local attachment and resource/attach outbox intent → normal sync/idempotency route → locked PostgreSQL resource update → authorized pull.
WHY IT BYPASSES OFFLINE-FIRST: Previous desktop Attach/Move called PUT /resources/:id/attachment directly, using navigator.onLine as the only offline gate. A server outage blocked the local operation.
RISK: Missing offline writes, stale moves overwriting newer work, incorrect ownership/project references, false server success on an older deployment.
RECOMMENDED CHANGE: Typed attachment intent with confirmed resource revision, atomic local save/outbox, canonical UUIDs, stable change ID, source/destination authority and project-reference checks; no HTTP fallback or file copy/deletion.
ACTUAL CHANGE MADE: Distinct attach operation (older servers reject rather than silently ACK a metadata no-op), protocol-1 destination/revision payload, server revision conflict and parent/reference validation, native fail-closed scope checks, session-change guards, local-save UI wording. Existing verified derived bytes remain readable for the attachment-only pending intent; network copying is deferred. No authored file is removed or duplicated.
VERIFICATION: Three backend pure validation tests and six frontend folder/attachment boundary checks passed; native destination test, TypeScript check, cargo check and initial build passed. These are not database/integration acceptance. Docker API/PostgreSQL were already stopped; no outage test is claimed.
STATUS: IMPLEMENTED, LIVE ACCEPTANCE OPEN. Folder/nested moves, moving a resource with another pending change, non-admin shared/restricted/note edit-grant caching, and browser route parity remain open. Rejected/stale moves preserve the original pending intent for review; do not reset the queue or invent a new change ID to retry.
```

## 51. Native PDF editor copies and Markdown reads (2026-10-12)

```text
MODULE: Resources / document editor
FILE: desktop/src-tauri/src/local_resource_uploads.rs; desktop/src-tauri/src/local_resource_attachments.rs; desktop/src-tauri/src/main.rs; desktop/src/api/resources.ts; desktop/src/api/resource-uploads.ts; desktop/src/components/ResourceEditorModal.tsx; backend/src/resource-editor-copy.js; backend/src/routes/sync.js
CURRENT WRITE PATH: PDF copy: guarded native source read → new managed PC file + fsync/hash → one SQLite transaction publishing the copy, upload descriptor and resource/create_copy outbox event → existing resumable upload worker → current source authorization/revision/scope checks → PostgreSQL resource/receipt transaction. Markdown opening: bounded native verified-file read, no mutation.
WHY IT BYPASSES OFFLINE-FIRST: PDF Create Edit Copy previously called the server directly. Markdown opening also required a live server even when verified local bytes were present.
RISK: Offline failure, accidental visibility widening, lost provenance, copied bytes mistaken for a server-saved resource, stale/revoked source authorization, retries generating duplicate server resources.
RECOMMENDED CHANGE: Reuse managed upload storage and stable outbox/change identity; preserve source attachment/visibility/provenance; use a distinct guarded copy operation; keep originals immutable and unknown-authority actions fail-closed.
ACTUAL CHANGE MADE: Native PDF-copy command preserves source context/visibility, assigns a new canonical resource/change UUID, commits local publication/outbox atomically after copying, and queues resumable transfer. Server create_copy validates source revision/current edit authority and preserves derived_from_resource_id in pull. Pending copy reads check known source revocation. Markdown reads are native, UTF-8-only and capped at 4 MiB. No direct HTTP fallback. UI distinguishes queued copies from server saves.
VERIFICATION: Six backend pure validation checks, nineteen frontend boundary/upload checks, TypeScript and cargo check passed. No new database fixtures or database reset. Native PDF copy, native restart and actual PostgreSQL/offline replay acceptance remain separately tracked in PHASE2_EVIDENCE.md.
STATUS: IMPLEMENTED / LIVE ACCEPTANCE OPEN. Markdown save, DOCX rendering/conversion/save, PDF replacement, missing cached edit grants and orphan/derived-file reclamation remain OPEN. Source with pending changes must sync before derivation; a missing verified PC file does not fall back to server copying. Failed staging can leave recovery bytes, never erase authored originals.
```

## 52. Same-resource offline Markdown saves (2026-10-12)

```text
MODULE: Resources / Markdown editor / sync
FILE: desktop/src-tauri/src/local_resource_edits.rs; desktop/src-tauri/src/local_resource_uploads.rs; desktop/src-tauri/src/local_db.rs; desktop/src-tauri/src/main.rs; desktop/src/api/resources.ts; desktop/src/api/resource-uploads.ts; desktop/src/api/sync.ts; desktop/src/components/ResourceEditorModal.tsx; backend/src/resource-content-edit.js; backend/src/routes/resource-editor.js; backend/src/routes/sync.js; backend/src/sync-receipts.js
CURRENT WRITE PATH: Native account/session/editor guard → immutable PC version with fsync/SHA-256 → atomic SQLite resource projection + edit version + edit_content outbox → resumable bounded file transfer → current server authority/revision check → PostgreSQL file-pointer update, required audit and idempotency receipt in one transaction.
WHY IT BYPASSES OFFLINE-FIRST: Previous desktop Markdown save called PUT /resource-editor/:id/content directly; local bytes alone did not permit offline saving.
RISK: Lost disconnected edits, duplicate resources when retrying as new documents, stale editor/server overwrite, mixed-account writes, broken ordering of multiple offline saves.
RECOMMENDED CHANGE: Preserve resource UUID, assign one stable change UUID per saved version, keep immutable file bytes, chain pending saves through owned receipt revisions, and reject conflicts without deleting authored work.
ACTUAL CHANGE MADE: Dedicated native version repository and edit_content intent; no HTTP write fallback. UI captures the opened revision and preserves text on failed saves. Server locks current row, checks current edit authority, validates format/size/UTF-8, verifies predecessor user/device/resource/operation, publishes a new immutable file, then updates the existing row. Receipts expose only ID/revision. Discarding an edit conflict retires its pending edit chain but retains physical recovery files. Automatic conflict overwrite is blocked.
VERIFICATION: Rust cargo check and frontend TypeScript check passed. Backend pure validation/projection checks 12/12, frontend routing/transfer checks 22/22. These checks do not prove PostgreSQL mutation, native SQLite publication, actual offline playback/editing or two-device behavior; phase-end live matrix remains mandatory.
STATUS: IMPLEMENTED / LIVE ACCEPTANCE OPEN. UTF-8 Markdown only, max 4 MiB. Verified local source and conservative cached editor authority required. Other pending resource operations (including initial upload) must sync before content editing. Conflict version export/reapply UI, missing scoped grants, physical reclamation, DOCX conversion/save and PDF replacement remain OPEN. No database reset or authored-data deletion.
```

## 53. Offline PDF replacement and pending-create editor chains (2026-10-12)

```text
MODULE: Resources / PDF editor / sync dependencies
FILE: desktop/src-tauri/src/local_resource_edits.rs; desktop/src-tauri/src/local_db.rs; desktop/src-tauri/src/local_resource_uploads.rs; desktop/src-tauri/src/local_resource_posters.rs; desktop/src-tauri/src/main.rs; desktop/src/api/resource-uploads.ts; desktop/src/api/resources.ts; desktop/src/components/ResourceEditorModal.tsx; desktop/src/components/ResourceViewerModal.tsx; backend/src/resource-content-edit.js
CURRENT WRITE PATH: Captured native account/session/source revision → managed 1 MiB staging chunks → complete-size/PDF-header/SHA-256 checks → one SQLite transaction publishing version/resource/outbox → resumable edit-permission transfer → guarded PostgreSQL pointer/audit/receipt transaction.
WHY IT BYPASSES OFFLINE-FIRST: replaceResourceFile previously always constructed a multipart HTTP PUT. Newly created native files/copies also could not be edited until their initial creation synced.
RISK: Offline edit failure; overwrite/loss of original bytes; stale revision replacement; cross-account or wrong-document predecessor; repeated creation of resources; viewers showing old content despite a successful save.
RECOMMENDED CHANGE: Reuse stable same-resource content-edit versions and owned predecessor receipts. Keep staging private until finalization. Preserve existing bytes and immutable initial-create payloads. Refresh viewers by revision, not only ID.
ACTUAL CHANGE MADE: Native begin/write/finish replacement commands, 500 MiB maximum, current authority/session checks, exact chunk retries, PDF signature validation, same UUID/filename, format-specific server validation without buffering the entire PDF. UI exposes edited-file upload for derived PDF copies. Content edits may follow owned native create/create_copy or edit_content receipts; discarding a create/edit conflict retires dependent pending edit intents without deleting files. Other pending metadata/attachment mutations still block editing. Viewer reads and PDF document instances refresh on revision changes.
VERIFICATION: Backend pure validation/projection group 16/16; frontend routing/staging group 27/27; TypeScript and native compilation passed before final build. Not native-file/SQLite/PostgreSQL/outage acceptance. Full phase-end matrix must exercise create → repeated edits → replay and conflicts on actual services.
STATUS: IMPLEMENTED / LIVE ACCEPTANCE OPEN. Browser compatibility replacement still uses the legacy HTTP route and is not included in desktop offline completion. No full PDF structural validation, antivirus guarantee, large-file viewer acceptance, staged-file reclamation, or revoked-account recovery claim. Originals and partial staging remain preserved.
```

## 54. Markdown saved-version recovery and unsaved editor protection (2026-10-12)

```text
MODULE: Resources / Markdown recovery
FILE: desktop/src-tauri/src/local_resource_edits.rs; desktop/src-tauri/src/main.rs; desktop/src/api/resources.ts; desktop/src/components/MarkdownVersionHistory.tsx; desktop/src/components/ResourceEditorModal.tsx
CURRENT WRITE PATH: Version review/export is a guarded read of the active author's managed file. Explicit Use in editor loads a reviewed draft; Save uses the ordinary same-ID SQLite/outbox path with the opened revision. No direct server recovery write.
WHY IT BYPASSES OFFLINE-FIRST: Previously preserved editor files had no user-facing retrieval path; conflict discard could leave recoverable bytes inaccessible through the normal UI.
RISK: Authored work effectively stranded; recovery that bypasses revoked permissions; accidental overwrite of current unsaved text; stale preview exported under a different session.
RECOMMENDED CHANGE: Account/resource/version-bound native history reader, digest verification, explicit preview/export/reapply, and normal conflict/permission checks on the new save.
ACTUAL CHANGE MADE: Lists latest 100 local Markdown versions with pending/confirmed/discarded intent states; validates byte size and SHA-256 before strict UTF-8 decode; rechecks account, lease and cached editor authority. Export/use rereads and reauthorizes. Loading a version requires confirmation before replacing unsaved editor text. Closing a dirty editor asks for confirmation; closing during a save is disabled. Current resource access is still required.
VERIFICATION: Frontend boundary tests exercise native history routing, resource/change/session arguments, account-switch rejection and no HTTP fallback. TypeScript/native compile checks passed. Export download behavior, visual layout, real offline version history and revoked/deleted-resource recovery require separate live acceptance; not claimed passed.
STATUS: IMPLEMENTED / LIVE ACCEPTANCE OPEN. This covers local Markdown editor versions, not PDF version export, deleted/revoked-resource recovery, another device's history, incomplete staging, or encryption/key recovery. Those retained bytes are not erased.
```

## 55. Bounded native PDF viewing (2026-10-13)

```text
MODULE: Resources / offline PDF preview
FILE: desktop/src/api/local-pdf-range.ts; desktop/src/components/ResourcePdfPreview.tsx; desktop/src/components/ResourceViewerModal.tsx; desktop/src-tauri/src/local_resource_uploads.rs
CURRENT WRITE PATH: Read-only native managed-file ranges. No resource write, outbox event, server mutation or local/server write fallback.
WHY IT BYPASSES OFFLINE-FIRST: Viewer URL loading began with a whole GET that native storage rejects above 32 MiB. An existing PC copy could therefore fail to render offline; a missing local URL could also select the server URL.
RISK: False unavailability of locally stored PDFs, unbounded buffers, mixing file versions during replacement, stale-session bytes, silent server dependence.
RECOMMENDED CHANGE: Explicit local PDF range transport, bounded reads/queue, immutable-version pinning, native authorization per read, cancellation and honest missing-copy states.
ACTUAL CHANGE MADE: Desktop PDF preview uses native URLs only; 1 MiB chunks, serial processing, 16 MiB per assembled PDF.js request, 64 queued requests and 500 MiB file cap. Checks status/range/size/revision; native opaque revision query rejects changed versions. HEAD is body-free for large files. UI reports errors and does not fall back to a server read. No data removed or mutation architecture changed.
VERIFICATION: 9 new pure transport tests, combined desktop resource tests 36/36, TypeScript and cargo check passed. Not actual WebView/database/outage acceptance; queued for the phase-end real-desktop stopped-API sweep.
STATUS: IMPLEMENTED / LIVE ACCEPTANCE OPEN. Large-file generic export/download, media suffix ranges, PDF structural safety, renderer memory/load behavior and offline DOCX are not closed by this change.
```

## 56. Desktop session restoration after local lease expiry (2026-10-13)

```text
MODULE: Authentication / startup / all offline-first domain reads
FILE: desktop/src/api/auth.ts; desktop/src/App.tsx; desktop/src/pages/LoginPage.tsx; desktop/src/api/auth-offline.test.mjs
CURRENT WRITE PATH: Startup reads server identity and native local session. Fresh password login alone renews the native authorization lease; business SQLite/outbox data is unchanged.
WHY IT BYPASSES OFFLINE-FIRST: A healthy server JWT was treated as sufficient for workspace restoration even when the native lease had expired. Every local domain correctly rejected reads but the UI mislabeled them unavailable.
RISK: Global misleading failures, pressure to reset intact data, or insecure lease extension as a workaround.
RECOMMENDED CHANGE: Require valid same-account native access before restoring the desktop workspace, explain reauthentication, preserve pending/authored data and the agreed lease policy.
ACTUAL CHANGE MADE: Successful server restoration now checks local_current_user, validates central identity and guards late responses. Startup shows an explicit online-sign-in notice for expired/missing access. Valid native sessions survive transient permission-refresh outages. No automatic lease renewal, native logout, data deletion or server-write fallback.
VERIFICATION: Actual read-only SQLite session showed the administrator lease expired at 2026-10-13 07:15:39 UTC while API/database/storage health was ok. Frontend auth boundary tests 23/23 and TypeScript passed; live re-login and page-load confirmation remain open.
STATUS: STARTUP FIX IMPLEMENTED. Legitimate online password sign-in is required to regain access. Mid-session expiry/draft-preserving reauthentication and full offline/reconnect acceptance remain separate work; no whole-security sign-off.
```

## 57. DOCX conversion boundary and bundled-runtime groundwork (2026-10-13)

```text
MODULE: Resources / DOCX editor and preview
FILE: backend/src/docx-converter.js; backend/src/docx-worker.js; backend/src/docx-file.js; backend/src/routes/resource-editor.js; desktop/scripts/package-docx-runtime.mjs; desktop/scripts/verify-docx-runtime.mjs
CURRENT WRITE PATH: Desktop DOCX opening/saving is still direct API-backed. API preview now uses bounded disk reads and the same isolated converter service as DOCX generation. Development runtime bundle is generated separately; no native write path is claimed yet.
WHY IT BYPASSES OFFLINE-FIRST: Merely replicating original DOCX bytes does not supply a local conversion/editor pipeline; desktop getDocxHtml/saveDocxCopy still require the API.
RISK: Offline failure, parser CPU/memory failures in API, unsanitized converted markup, accidental external references, host Node dependency in a purported self-contained desktop package.
RECOMMENDED CHANGE: Owner-approved bundled isolated converter with native session/scope/revision guards, immutable managed output and atomic local copy/outbox publication. Preserve originals and stable retry identities; no server-write fallback.
ACTUAL CHANGE MADE: Isolated/sanitized bounded API preview, shared read/write worker limit, bounded file reader and environment filtering. Added development bundle generator and integrity/relocation verification. Documented native bridge/publication contract. No changes to existing desktop DOCX persistence or outbox semantics yet.
VERIFICATION: Windows converter tests 11/11. Generated bundle verified 4,082 files/110 package versions and round-tripped a formatted document outside the repo with empty PATH using its bundled Node. API rebuilt/deployed and healthy; no DB mutation tests or offline desktop acceptance claimed.
STATUS: FOUNDATION IMPLEMENTED; OFFLINE DOCX STILL OPEN. Native bridge, DOCX derived-copy sync, installer/runtime provenance/signing/notices and full actual desktop/API-stopped acceptance remain.
```

## 58. Native offline DOCX preview and copy publication (2026-10-13)

```text
MODULE: Resources / DOCX preview, editor and copy synchronization
FILE: desktop/src-tauri/src/local_docx.rs; desktop/src/api/resources.ts; desktop/src/components/ResourceEditorModal.tsx; backend/src/docx-native-worker.js; backend/src/docx-transform.js; backend/src/resource-editor-copy.js; backend/src/routes/sync.js
CURRENT WRITE PATH: Desktop HTML -> bundled child converter -> immutable managed DOCX -> SQLite resource/upload/request mapping plus outbox transaction -> existing resumable transfer and create_copy server receipt. Preview reads managed PC bytes. Browser compatibility retains HTTP routes.
WHY IT BYPASSES OFFLINE-FIRST: Previous desktop DOCX routes used the API even when original bytes existed on the PC. This batch removes those desktop read/write fallbacks.
RISK: Lost offline edits, duplicate copies after response loss, stale-session disclosure, changed-source copies, parser resource exhaustion or accidental host runtime dependencies.
RECOMMENDED CHANGE: Guarded pinned native worker, original-preserving copy, atomic publication, stable retry mapping, explicit server DOCX validation, no direct server fallback.
ACTUAL CHANGE MADE: Implemented native read/save commands, bounded framed protocol and Windows job/process limits, packaged runtime pin, before/after authorization and revision checks, immutable output and transactional request/copy/outbox identity. Added DOCX create_copy validation without weakening PDF validation. Replays check current file authorization and cannot resurrect a deleted copy.
VERIFICATION: 19 converter/protocol/copy-validator checks, 14 desktop adapter checks and one real native bundled-process test passed; TypeScript and debug native build passed. Initial relocated probes timed out; the final exact-entry probe passed after explicitly closing its test input handle to match Rust. Verified 4,084 files/110 package versions outside the repo with empty PATH. Updated desktop restarted with saved-edits approval; API/database/storage healthy. No database fixtures or live desktop outage acceptance implied.
STATUS: IMPLEMENTED / ACCEPTANCE OPEN. Pending-source dependency handling, broader cached record edit grants, crash recovery of unsaved drafts, installer provenance/signing/notices and real stopped-API/reconnect/replay tests remain. Phase 2 is not signed off.
```

## Finding 59 — editor-copy predecessor chains (October 13; A5)

```text
MODULE: Resources / editor copies / outbox dependency handling
FILE: desktop/src-tauri/src/{local_docx,local_resource_uploads,local_resource_edits,resource_dependencies,local_db}.rs; desktop/src/api/{resource-dependencies,sync}.ts; backend/src/{resource-editor-copy,routes/sync}.js
CURRENT WRITE PATH: Verified managed source bytes → immutable copy bytes + scoped SQLite projection + outbox, with copy.previous_change_id for a pending source create/copy/content-edit → staged binary transfer → server receipt-bound authorization and copy apply.
WHY IT BYPASSES OFFLINE-FIRST: Prior copy writers did not directly bypass the outbox, but prohibited copies until source synchronization completed. Same-entity-only upload withholding/conflict retirement could not support cross-resource copy dependencies.
RISK: Offline copy unavailable; missing predecessor retries indefinitely; dependent copy applied against the wrong revision; foreign-device/account receipt or revoked source used as authority; discarded work lost if bytes were deleted.
RECOMMENDED CHANGE: Explicit immutable predecessor IDs, owner/device/source receipt verification, current access/revision checks, account-scoped dependency closure for queue/discard, and preserved authored bytes.
ACTUAL CHANGE MADE: Native PDF/DOCX source predecessor selection, server receipt resolution, bounded unconfirmed-copy ancestry authorization, transitive upload withholding, native conflict-chain blocking and explicit non-destructive dependent-intent retirement. Metadata/attachment/folder chains remain blocked, not silently treated as supported.
VERIFICATION: 16 backend validator, 18 desktop adapter/dependency and two native pure dependency-graph checks passed (36 total); TypeScript and cargo check --offline passed. No mocked or fixture database result is presented as PostgreSQL/desktop acceptance.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. Not deployed or restarted this checkpoint. A5 remains PARTIAL; full outage/reconnect/replay, cached record grants and remaining dependency types remain in the fixed checklist.
```

## Finding 60 — native record edit-authority projection (October 14; A1)

```text
MODULE: Resources / native editor authorization / sync-derived cache
FILE: backend/src/{resource-authority,routes/sync}.js; desktop/src-tauri/src/{local_resource_authority,local_resource_attachments,local_resource_edits,native_authorization,local_auth,local_db,main}.rs; desktop/src/api/{resource-authority,sync}.ts
CURRENT WRITE PATH: Read-only server authority projection → native authenticated request to compiled origin → account/resource/scope/revision/exact-login-lease-bound SQLite cache. Domain edits still use immutable native files + SQLite/outbox → server reauthorization.
WHY IT BYPASSES OFFLINE-FIRST: No domain write bypass was added. Earlier native editors blocked legitimate shared/restricted access and inferred direct-project edit authority from a cached project row; they lacked a native-verified record-specific decision.
RISK: Forged renderer grants, cross-account or stale-session responses, stale positives overwriting denials, unbounded cached authority, inferred ancestor grants, or content-edit permission persisting across an unrelated scope/version change.
RECOMMENDED CHANGE: Native-only verified positive authority, bounded complete batches, session/origin/account/lease binding, explicit denial replacement, and proven content-only continuation with server-side revision/permission rechecks.
ACTUAL CHANGE MADE: Added bounded read-only authority endpoint, native fetching/validation/cache, serialized refresh, native-protocol adapter gating and direct-resource editor checks. Kept exact revision matching plus same-account/device native content-chain proof for the owner-delegated recommended lease policy. Note/folder inheritance remains denied until complete ancestor bindings exist; no new admin authority or permissions are granted offline.
VERIFICATION: 20 backend pure validator, six desktop adapter/dependency and four native pure authority/chain tests passed (30 total); TypeScript and native test-target compilation passed. No DB fixtures, Docker mutations, deployment, app restart or real offline acceptance was performed.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN; A1 remains PARTIAL. Inherited/destination authority, fresh local creation authority, wider writer audit, recovery and real PostgreSQL/offline/reconnect cases remain. Old authored bytes/outbox/version records are preserved; legacy versions without proof fail closed.
```

## Finding 61 — complete inherited resource edit bindings (October 14; A1)

```text
MODULE: Resources / inherited folder and note source-editor authority
FILE: backend/src/{resource-authority,middleware/resource-access,routes/sync}.js; desktop/src-tauri/src/{local_resource_authority,local_resource_attachments,local_notes}.rs
CURRENT WRITE PATH: Server-verified complete scope chain -> native trusted-origin protocol-2 fetch -> atomic account/lease/revision-bound derived SQLite authority cache. Existing native content writes still use immutable files + SQLite/outbox -> server reauthorization.
WHY IT BYPASSES OFFLINE-FIRST: No domain bypass is introduced. Previously legitimate inherited source edits were blocked because a direct-resource grant could not prove the note/folder authority context.
RISK: Inheriting access from a partial/cyclic chain, missing notes, changed ancestor visibility/project, cross-account snapshots or an unrelated older cached context. Source editing must not imply destination creation authority.
RECOMMENDED CHANGE: Complete bounded server authorization bindings, strict native validation and comparison against scoped local ancestry, existing content-revision/lease checks, separate destination contracts.
ACTUAL CHANGE MADE: Protocol-2 negotiation and four-resource batches; two server editor checks with stable binding projection; bounded cycle-safe context query; atomic grant/context cache including grant revision and lease; native complete-chain/missing/duplicate/scope checks replacing only the non-admin inherited-source blanket prohibition. Unsupported trees above 32 records deny without data deletion. Protocol-1 response shape remains compatible.
VERIFICATION: 24 backend, seven native and six desktop pure checks passed; native test compilation and TypeScript passed. No database fixtures or PostgreSQL query acceptance; actual stopped-API desktop/restart/reconnect acceptance remains open.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. A1 remains PARTIAL; API-first deployment required. Destination authority, metadata/attachment/folder dependencies, new local source grants and broader authorization coverage remain. All existing bytes, outbox events and databases preserved.
```

## Finding 62 — destination verification and edit-before-move dependency (October 14; A1/A5)

```text
MODULE: Resources / upload and copy destinations / direct attachment moves
FILE: backend/src/{resource-destination-authority,resource-attachment,routes/sync}.js; desktop/src-tauri/src/{local_resource_destinations,local_resource_authority,local_resource_uploads,local_resource_attachments,resource_dependencies,local_projects,main}.rs; desktop/src/api/{sync,resource-dependencies}.ts
CURRENT WRITE PATH: Native-verified destination cache -> guarded native file/attachment writer -> scoped SQLite plus immutable outbox -> receipt-ordered server apply with current source/destination permissions and revision checks.
WHY IT BYPASSES OFFLINE-FIRST: Previously project file destinations trusted renderer-fed project access, note/folder file destinations blanket-blocked non-admins, and any pending source change prevented a move even when a native file predecessor existed. No direct HTTP write fallback was added.
RISK: Source authority incorrectly granting destination access, stale/foreign positive cache, missing destination cache on first sync, moves racing unsynced content, cross-device predecessor reuse or an old server silently ignoring dependencies.
RECOMMENDED CHANGE: Separate native destination grants, same lease/account/scope constraints, refresh after scope-source pulls, explicit versioned move dependencies and server receipt reauthorization.
ACTUAL CHANGE MADE: Added bounded native destination projection/cache and folder self-grant checks, replaced non-admin renderer project trust for file destinations, retained global project checks, allowed verified project-note attachments, added native predecessor capture and protocol-2 receipt resolution for a direct move after supported file creation/copy/edit. Queue graph parsing includes attachment predecessors. Unsupported later metadata/move chains still block without deleting authored work.
VERIFICATION: 33 backend pure/receipt-double tests, 12 native pure tests and eight desktop adapter/dependency/source-order checks passed; native test compilation and TypeScript passed. No fixture database, API deployment, desktop restart or Docker mutation; actual PostgreSQL/offline acceptance remains pending.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. A1 and A5 remain PARTIAL. Metadata/repeated-move/tree dependencies, fresh local source/destination authority and broader security coverage remain. Existing data, files and outbox preserved; API-first deployment required.
```

## Finding 63 — native creation provenance before first sync (October 14; A1/A5)

```text
MODULE: Resources / native editor access to fresh authored files and copies
FILE: desktop/src-tauri/src/{local_resource_authority,resource_dependencies,local_resource_attachments}.rs
CURRENT WRITE PATH: Same-account/device native ready upload plus unsynced creation proof -> current lease/permissions/destination/source checks -> immutable native content version plus SQLite/outbox -> existing server receipt chain.
WHY IT BYPASSES OFFLINE-FIRST: No bypass introduced. Previously a non-admin's new native file needed a server edit grant before editing, even though no server resource existed yet.
RISK: Confusing renderer metadata with native authorship, extending rights to confirmed/downloaded files, hiding a copy's source, carrying rights across changed scope or using unsupported pending work as a content proof.
RECOMMENDED CHANGE: Narrow native creation provenance, current permission/lease and destination checks, preserved source ancestry, native-only content continuation; no synthetic server grant.
ACTUAL CHANGE MADE: Added ready-upload/outbox account/device/operation/ack checks, exact immutable creation record/payload validation, unchanged scope/type/source checks, conflict-aware predecessor validation and native content-chain continuation. Source moves share this guard. No file or event deletion.
VERIFICATION: All 15 targeted native tests and native test-target compilation passed, including three new pure creation-proof tests. The preceding 33 backend/eight desktop checks and TypeScript check passed (56 targeted checks total). PostgreSQL/stopped-API desktop acceptance not run.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. ACK-to-verified-server-authority interruption, unsynced destination authority, repeated metadata/move chains and full lifecycle acceptance remain. A1/A5 remain PARTIAL; not deployed.
```

## Finding 64 — file acknowledgement trust and atomic authority transition (October 14; A1/A5)

```text
MODULE: Resource file create/copy/content confirmation and native authority handoff
FILE: backend/src/{resource-confirmation,routes/sync}.js; desktop/src-tauri/src/{local_resource_authority,local_resource_uploads,local_resource_edits,local_db,main}.rs; desktop/src/api/{resource-confirmation,sync}.ts
CURRENT WRITE PATH: Server applies existing outbox intent -> native reads owned server receipt/current authority -> atomic scoped SQLite receipt/version/ACK/authority update. Domain payload and immutable file bytes remain unchanged.
WHY IT BYPASSES OFFLINE-FIRST: Prior renderer-provided receipt binding and generic ACK were separate operations, and edit binding rechecked mutable local edit scope. This could stall confirmation after an attachment change or strand fresh-file editing between ACK and authority refresh.
RISK: Unverified/foreign receipts retiring work, partial acknowledgement, changed-session replies, current access denial blocking historical confirmation, overwritten newer local edits or permission expansion through historical success.
RECOMMENDED CHANGE: Native trusted-origin receipt verification, exact owned native event matching, bounded batches, atomic ACK/current authority, explicit denial preservation and no renderer receipt fallback.
ACTUAL CHANGE MADE: Read-only confirmation endpoint; native same-resource pending selection and receipt validation; serialized account/session/lease/pending-work rechecks; atomic verified receipt/native version/ACK/authority storage; safe final revision projection and native creation-receipt bridge for pending content; disabled legacy renderer binders and gated generic file ACKs. Verified confirmations resolve old conflicts atomically, and delayed failure/conflict callbacks cannot reopen those confirmed file events. Confirmation never grants access based on historical success.
VERIFICATION: 37 backend, 19 native and 14 desktop targeted pure/adapter checks passed (70 total). TypeScript/native compilation passed separately. Actual PostgreSQL/offline/crash/reconnect acceptance, including late-response transaction races, is not represented by these checks.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. Not deployed; API-first coordinated build required. Remaining metadata/repeated-move/folder chains and post-move content handoff remain. Existing authored files, databases and immutable payloads preserved; no Phase 2 closure.
```

## Finding 65 — metadata revision safety and repeated native resource mutations (October 14; A1/A5)

```text
MODULE: Resources / metadata patches and direct attachment move chains
FILE: backend/src/{resource-metadata,resource-attachment,routes/sync}.js; desktop/src-tauri/src/{local_resource_attachments,local_resource_authority,local_resources,resource_dependencies,local_db}.rs; desktop/src/api/{resources,resource-dependencies}.ts
CURRENT WRITE PATH: Captured account/native session -> verified source and destination authority -> atomic local projection/native provenance/immutable outbox -> owned predecessor receipt/current server editor check/revision check -> transactional metadata/audit/idempotency apply.
WHY IT BYPASSES OFFLINE-FIRST: No new bypass. Previous metadata writes queued a broad resource update without a record-specific native permission/revision guard; omitted fields reset existing values. A first offline move changed local scope and prevented a second move from matching the original grant.
RISK: Stale metadata overwrites, altered attachment/visibility through broad payloads, foreign or fabricated predecessors, extending source permission into a destination, stale-account writes, stranded dependent intents and duplicate audit effects.
RECOMMENDED CHANGE: One native-proven move/metadata chain, strict field patches, exact predecessor ownership, source/destination reauthorization, atomic local/outbox writes and revision-checked server effects; preserve legacy payloads instead of rewriting them.
ACTUAL CHANGE MADE: Added native mutation provenance, guarded repeated direct moves and metadata patches, captured metadata session and native capability checks, protocol-3 attachment predecessor handling, explicit edit_metadata server apply with transactional audit and monotonic revision, metadata dependency parsing and descendant discard. Unspecified fields and all saved versions remain intact. No local failure invokes HTTP.
VERIFICATION: 24 backend pure/receipt-double, 28 native pure and 23 desktop adapter/dependency checks passed (75 total). TypeScript/native compilation and diff checks passed. No actual database or stopped-API desktop acceptance in this checkpoint.
STATUS: SOURCE IMPLEMENTED / ACCEPTANCE OPEN. A1/A5 remain PARTIAL. Partial ACKs, mixed content/create chains, post-move content, legacy intent recovery, unsynced destinations and nested-folder moves remain. API-first coordinated deployment required; no restart or data cleanup performed.
```

## Finding 66 — durable download diagnostics and browser enqueue retry identity (October 14; A6)

```text
MODULE: Downloads / server-tool observations and browser enqueue
FILE: backend/src/{media-tool-status,download-queue-http,routes/media-downloads,media-downloads}.js; desktop/src-tauri/src/local_downloads.rs; desktop/src/api/{downloads-local,mediaDownloads,download-enqueue-retry}.ts; desktop/src/pages/DownloadsPage.tsx
CURRENT WRITE PATH: Desktop queue/settings remain native SQLite + outbox. Server diagnostic observations enter the account-scoped SQLite snapshot through sync, not a domain outbox. Browser enqueue persists request identity before HTTP -> current server authorization -> transaction/advisory lock -> job/audit/owned receipt -> confirmed browser result.
WHY IT BYPASSES OFFLINE-FIRST: Previously tool inspection always contacted the server despite local queues/settings. Browser enqueue used a fresh server UUID on each attempt and deduplicated only currently active jobs, so a lost response followed by retry after completion could create another job. No desktop server-write fallback is added.
RISK: Offline diagnostic failure, unbounded diagnostic subprocesses, stale reports replacing newer observations, duplicate download jobs/audit effects, cross-account receipt replay and lost request identity after reload.
RECOMMENDED CHANGE: Optional validated timestamped native diagnostic cache with bounded probes; stable browser request UUID and transactionally stored owned receipt; current permissions on replay; keep native enqueue on the outbox.
ACTUAL CHANGE MADE: Bounded/coalesced diagnostic probes, optional snapshot projection with same-account newest-valid merge, native-only desktop tool reads and last-check labels. Browser identity persists across failures/reload and fails closed on storage errors; API now requires a key, normalizes payload, checks receipt binding and commits job/audit/receipt atomically. Existing active job reuse creates no additional creation audit. No authored data or old queued event is removed.
VERIFICATION: 24 Node pure/adapter and five native pure checks passed; native compilation passed. No actual database, browser runtime or stopped-API desktop acceptance yet. Coordinated API/browser/native deployment required.
STATUS: TWO BOUNDED SUBCHECKS IMPLEMENTED — AWAITING VERIFICATION. A6 remains PARTIAL for worker/queue/file-readiness reconciliation, completion/cancel races and tombstone/revocation cleanup. No deployment, reset or full phase sign-off.
```

## Finding 67 — worker attempt ownership and shared download removal identity (October 15; A6)

```text
MODULE: Downloads / server worker, publication and history reconciliation
FILE: backend/src/{media-downloads,media-process,download-worker-state,download-worker-access,download-job-control,download-queue-create,routes/media-downloads}.js; backend/src/migrations/20261014_download_worker_attempt.sql; desktop/src-tauri/src/local_downloads.rs
CURRENT WRITE PATH: Existing SQLite/outbox controls -> server authorization/receipt transaction -> leased attempt claim -> attempt-fenced progress and resource/job publication -> scoped snapshot back to SQLite. History removal -> transactional tombstone -> authorized snapshot -> monotonic native removal set.
WHY IT BYPASSES OFFLINE-FIRST: No new bypass. Startup reset every running job without ownership; old callbacks identified only a job, not an execution. History removal markers existed only on the deleting PC, so another PC could reintroduce deleted history from a late historical receipt. Worker permissions were not rechecked after enqueue.
RISK: Stolen attempts, stale progress/publication, wrong-process cancellation, overwritten or deleted attempt bytes after uncertain commit, execution under revoked access, misleading terminal-state ordering and resurrected removed history.
RECOMMENDED CHANGE: Dedicated per-job lease, immutable attempt identity, current authorization/source guards, monotonic state observations, preserved attempt files and shared permission-scoped removal markers. Never conflate deleting history with deleting a resource/file.
ACTUAL CHANGE MADE: Additive run-ID/tombstone schema; live-lease-aware recovery and serialized scheduler claims; run-ID progress/stop/publication fences; current requester checks; separate preserved attempt filenames; optional bounded thumbnails and bounded/coalesced process output; monotonic timestamps; transactional history markers/backfill from committed receipts; reject retired identities; native canonical removal union and receipt UUID normalization.
VERIFICATION: 19 Node pure/process-double and seven native pure checks passed, with native compilation/backend syntax/diff checks. Actual PostgreSQL SQL/locks, two workers, stopped-API desktop/reconnect, termination and receipt/revocation races remain NOT RUN. No migration, restart or data cleanup executed.
STATUS: TWO BOUNDED A6 SUBCHECKS IMPLEMENTED — AWAITING VERIFICATION. A6 remains PARTIAL for remaining PC-file readiness/legacy/revocation consumers. A2 owns retained-byte reclamation. Coordinated migration/API/native deployment required; stop old workers before enabling the new lease protocol.
```

## Finding 68 — download previews and PC readiness presentation (October 15; A6)

```text
MODULE: Downloads / current resource PC-copy presentation
FILE: desktop/src/api/download-device-state.ts; desktop/src/pages/DownloadsPage.tsx; desktop/src/components/{DownloadResourcePreview,VideoResourcePoster}.tsx; desktop/src-tauri/src/local_resource_replication.rs
CURRENT WRITE PATH: No new domain writes. Native authorized SQLite metadata/copy observations -> desktop status and cached native poster -> display, independently of server queue completion.
WHY IT BYPASSES OFFLINE-FIRST: Download thumbnails still used direct HTTP URLs in desktop. Server completion had no per-resource PC-readiness distinction; copying observations could describe a superseded revision or different server.
RISK: Broken offline previews, misleading local readiness/progress, and briefly displaying a previous account/resource poster during effect cleanup.
RECOMMENDED CHANGE: Native-only desktop previews and account-bound observations; explicit unknown/stale states; keep server completion distinct from current-resource PC readiness.
ACTUAL CHANGE MADE: Native metadata/copy reader with account-switch guards and independent status failure; local-only desktop preview component with placeholder; history readiness labels; origin/revision-aware copy states and stale progress suppression; identity-bound poster URLs. Existing browser route retained. No new file grants, downloads, deletions or outbox mutations.
VERIFICATION: 15 TypeScript adapter/presentation checks and two Rust pure checks passed; TypeScript/native compilation passed. No real database, mounted UI, cold-restart outage or file/revocation race tests executed in this slice.
STATUS: BOUNDED A6 SUBCHECK IMPLEMENTED — AWAITING VERIFICATION. A6 remains PARTIAL for remaining consumer/legacy/revocation reconciliation. Native/frontend build deployment and phase acceptance remain pending; authored data preserved.
```

## Finding 69 — native confirmation of resource mutations and partial acknowledged chains (October 15; A1/A5)

```text
MODULE: Resource attachment/metadata synchronization and offline continuation
FILE: backend/src/{resource-confirmation,routes/sync}.js; desktop/src-tauri/src/{local_resource_authority,local_resource_attachments,local_db,main}.rs; desktop/src/api/{resource-confirmation,sync}.ts
CURRENT WRITE PATH: Native SQLite record + immutable mutation provenance + outbox -> server apply/owned receipt -> native fetch of exact receipt/current authority -> atomic local receipt/authority/ACK -> validated pending-chain continuation.
WHY IT BYPASSES OFFLINE-FIRST: No new domain write bypass. Attach/metadata used generic renderer-triggered ACK while file writes already had native confirmation. Removing the first pending event broke local chain provenance, blocking later authoring after a partial sync.
RISK: Unverified ACK flags mistaken for authority, lost continuity after partial ACK, metadata overwritten by receipt reconciliation, or old scope permission carried across a move.
RECOMMENDED CHANGE: Native-fetched, account/device/origin/intent/result-bound receipts; keep historical success separate from current permission. Reconstruct acknowledged predecessors without modifying queued payloads and recheck current anchor/pending destinations.
ACTUAL CHANGE MADE: Compact canonical SHA-256 receipt bindings; native mutation confirmation and atomic ACK/authority store; generic ACK guard and renderer capability check; verified-prefix chain reconstruction and latest-confirmed authority anchor. Missing/foreign/altered/legacy proof fails closed. No files or saved intentions removed.
VERIFICATION: Server confirmation 8 checks, sync adapter 5 checks and native pure digest/receipt/chain suite 32 checks passed (45 total). Native test build, cargo check, TypeScript, backend syntax and diff checks passed after retrying Windows tool stalls. Real PostgreSQL and stopped-API acceptance NOT RUN.
STATUS: BOUNDED A1/A5 SUBCHECK IMPLEMENTED — AWAITING VERIFICATION. Mixed file-prefix chains, legacy acknowledgements without native receipts, content-after-move and nested moves remain code obligations. No deployment/restart/reset.
```

## Repository coverage register

### Finding 70 — Pending file receipts need exact intent binding

MODULE: Resources / native file synchronization confirmation (A1/A5).
FILE: `backend/src/resource-confirmation.js`, `backend/src/routes/sync.js`, `desktop/src-tauri/src/local_resource_authority.rs`.
CURRENT WRITE PATH: Immutable native upload/edit outbox -> server publication/idempotency receipt -> native confirmation -> atomic local ACK/projection/authority update.
WHY IT BYPASSES OFFLINE-FIRST: Not a new HTTP fallback; a receipt-integrity gap in the existing ACK path. Protocol 1 matched identity/operation/size but did not bind the complete historical upload intent to its saved local payload.
RISK: Same-sized mismatched content or changed predecessor intent could pass the narrower receipt check. A changed trusted origin during the request also needed a final commit check.
RECOMMENDED CHANGE: Negotiate digest-bound file confirmations, verify against the unchanged native payload, recheck origin/session/lease, and preserve original work when proof is absent. Do not infer legacy proof or rewrite pending events.
ACTUAL CHANGE MADE: Protocol 2 returns a bounded canonical payload digest for valid owned upload receipts; the native verifier checks exact payload/resource/hash/size, rejects downgrades, and rechecks origin before commit. Old clients retain protocol-1 response compatibility. No stored receipt-history migration or mixed-chain expansion in this slice.
VERIFICATION: 10 backend pure checks, 19 native authority pure checks and 5 frontend adapter checks passed; native test build, backend syntax and scoped whitespace checks passed. Actual PostgreSQL, cold restart/server-stop/reconnect and deployment NOT RUN.
STATUS: Narrow confirmation hardening IMPLEMENTED — AWAITING INTEGRATED VERIFICATION. Legacy ACK reconciliation, origin-bound historical file receipts and mixed file/mutation chains remain open; A1/A5 remain PARTIAL.

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
