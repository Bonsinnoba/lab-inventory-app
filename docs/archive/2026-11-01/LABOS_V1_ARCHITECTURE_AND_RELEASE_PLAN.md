# LabOS — Architecture, V1 Release Plan, Decisions & Continuation Notes

## Purpose

This document captures the plan, requirements, architectural correction, decisions, implementation work, release decisions, and next steps agreed during the LabOS development conversation beginning with the clarification:

> “Since the app is not connected to our central whatever, shouldn't there be a backend where the SQLite lives which is bound to the app and the central system also exists with Postgres where syncing, downloads etc. happens when fully developed?”

It is intended to be the handoff document for continuing the work in a new chat.

---

# 1. Core Architecture Decision

The most important decision is that LabOS has **two distinct backend/runtime layers**.

## 1.1 Per-workstation local LabOS

Each LabOS desktop installation has its own local runtime:

```
LabOS Desktop / Tauri
        ↓
Local LabOS Backend
        ↓
Local SQLite
```

The local backend is bound to that workstation/app installation.

It is responsible for:

- local application operations
- local authentication/session state
- local inventory state
- local projects
- local notes
- local knowledge
- local resources metadata
- local locations
- local settings/preferences where applicable
- local-first reads and mutations
- local transaction/movement processing
- local sync outbox
- local sync/conflict state
- operating when the central server is unavailable

**Critical rule:** PostgreSQL must not be required for ordinary workstation-local operations.

## 1.2 Central LabOS system

The central system is separate:

```
Local backend(s)
       ↓
Central LabOS Backend
       ↓
PostgreSQL
       ↓
Central services
```

The central system is responsible for:

- synchronization between workstations
- PostgreSQL persistence
- cross-workstation/shared state
- server-side conflict handling
- central automation
- media downloads
- yt-dlp
- FFmpeg
- central media storage
- server-side processing
- aggregation/reporting across workstations
- future multi-user/account management
- other globally authoritative services

**Critical rule:** the central server is optional to the workstation's basic local operation.

---

# 2. Local-First Principle

The governing principle for V1 is:

> If an operation only concerns the workstation's own data, PostgreSQL should not be in its execution path.

The desktop should therefore use the local backend/SQLite first.

The central backend is used when:

- synchronizing local changes
- obtaining shared/central information
- performing central-only operations
- processing/download operations that intentionally belong to the central system

The desktop must not simply use PostgreSQL as its offline database.

---

# 3. V1 Installation Decision

V1 is a **fresh installation**.

It is not a continuation of the development/test database.

On first launch of a V1 installation:

1. Create a fresh local SQLite database.
2. Apply the local schema.
3. Seed baseline/system data.
4. Seed one local administrator identity.
5. Allow the application to operate locally without the central server.

The V1 database must **not** contain development/test:

- inventory
- projects
- notes
- resources
- conflicts
- outbox entries
- experimental data
- test users
- other development artifacts

Existing development/test databases must be preserved until they are explicitly identified and classified. They should not be blindly deleted during cleanup.

---

# 4. Single-User V1 Decision

The project is intentionally simplified for V1 because there is currently only one user.

V1 does **not** need full user/account management.

V1 needs:

- one local administrator identity
- local login
- local session/authentication
- offline login
- ability to change the local administrator's password
- local identity/session persistence

Full account provisioning and multi-user management can remain a future central/server responsibility.

This also means:

- collaboration/member management is not a V1 dependency
- local project permissions can behave as administrator permissions
- local workspaces do not need real multi-user membership
- future central user management can be added later

Do not invent a universal hard-coded production admin password. The initial admin credential/first-run setup should be implemented securely and explicitly.

---

# 5. What Must Work Offline / Locally

The following categories are intended to work through the local runtime without PostgreSQL.

## Inventory

Local:

- view inventory
- add/register item
- edit item
- receive
- checkout
- return
- consume
- adjust
- transfer
- damage
- loss
- repair out
- repair in
- movement history
- inventory-related local relationships
- local inventory reads
- local inventory mutations
- queueing changes for synchronization

## Projects

Local:

- view projects
- create projects
- edit projects
- project metadata
- project workspace
- tasks
- experiments
- BOM
- project-item relationships
- local project reads/mutations

Central-only/project-future items may include:

- multi-user membership
- centrally shared project state
- central collaboration
- central attachments/services where appropriate

## Notes

Local:

- view notes
- create notes
- edit notes
- delete notes
- search/filter
- tags
- revisions
- restore revisions
- local note relationships

## Knowledge

Local:

- findings
- knowledge results
- relationships
- knowledge search
- local note search integration
- tags
- overview/recent local knowledge information

## Resources

Local metadata:

- list resources
- view resource metadata
- create links
- create folders
- edit resource metadata
- delete resources
- categories
- descriptions
- tags
- local relationships to items/projects/notes
- locally cached resource metadata

Central-only resource/media processing:

- downloading external media
- yt-dlp
- FFmpeg
- central media processing
- central media storage
- other server-side media preparation

Important requirement:

> Downloaded videos must never be played from their original external links. Playback should use the downloaded/local/processed media.

## Locations

Local:

- list locations
- get location
- create location
- update location
- delete location
- parent location relationships

Before V1, local location/item relationships and item counts must be made accurate so deletion safety does not rely on an inaccurate offline `item_count`.

## Authentication / identity

Local:

- login
- current session
- current user
- password change
- profile/local identity where appropriate

The central server is not allowed to be a prerequisite for offline login.

## Settings

Local workstation/user preferences should remain local unless they explicitly require central coordination.

## Sync

Local:

- outbox
- retry state
- sync status
- conflict state
- conflict resolution state
- retrying after reconnect

Central:

- receive/persist sync changes
- idempotency
- server-side conflict detection
- server-side authoritative/shared state
- synchronization with other workstations

---

# 6. Central-Only Responsibilities

The following remain central:

### Synchronization

- push local outbox changes
- pull server changes
- central conflict handling
- tombstones
- cross-workstation reconciliation

### Database

- central PostgreSQL
- central migrations
- globally authoritative data

### Media

- yt-dlp
- FFmpeg
- media downloads
- media conversion/processing
- central media storage
- server-side media workers

### Shared/Global Services

- cross-workstation aggregation
- central reports
- central automation
- future multi-user account provisioning
- centrally coordinated services

---

# 7. Existing Sync Architecture

The local sync system already contains substantial groundwork.

Desktop sync:

- local pending changes are stored in SQLite
- changes have `change_id`, `device_id`, `entity_type`, `entity_id`, `operation`, payload and retry information
- automatic synchronization runs after authentication and periodically
- reconnect recovery exists
- retry backoff exists
- manual retry exists
- sync state survives restart
- conflicts can be stored locally

Central sync:

- `/api/sync/push`
- `/api/sync/pull`
- idempotency
- stale item conflict detection
- tombstone handling
- composite pull cursor
- conflict resolution retry/override support

The central pull cursor is based on:

```
{ at, type, id }
```

and is encoded as a base64url cursor.

---

# 8. Existing Local SQLite Foundation

The local database currently contains infrastructure for:

- `local_schema_migrations`
- `device_identity`
- `sync_state`
- `sync_outbox`
- `sync_conflicts`

Local inventory state is already present.

The database path is based on Tauri's application data directory.

Production and Preview use different application identifiers, which isolates their local databases/data directories.

Current database file name:

```
labos-local.db
```

The local schema version currently contains the earlier sync-conflict foundation and additional local runtime migrations.

---

# 9. Existing Local Runtime Implementations

The following local-first runtime work has already been implemented on `main`.

## Inventory

Already implemented earlier:

- local inventory schema
- local inventory reads
- local inventory mutations
- atomic movement updates
- movement validation
- sync outbox
- local conflict support

Movement types include:

- receive
- checkout
- return
- consume
- adjust
- transfer
- damage
- loss
- repair_out
- repair_in

Adjustments require a reason.

## Projects

Implemented:

- `desktop/src-tauri/src/local_projects.rs`
- local project list/get/create/update/delete
- workspace
- tasks CRUD
- experiments CRUD
- BOM CRUD
- project-item link/unlink
- local outbox queuing

Migration:

```
004_local_projects
```

API layer was changed so core project workflows prefer the local Tauri runtime.

Important caveats still to resolve:

- local project state currently uses a JSON blob in `sync_state`
- some project functions remain central
- local workspace currently returns empty members/notes/resources/activity in areas not implemented locally
- local project owner identity is not yet wired to a proper local single-user identity
- local IDs should be reviewed
- local project outbox mapping to central sync protocol still needs dedicated work

Relevant commits:

- `da722453416ef4e0609dbab345ae2033eca87adc`
- `de3c83628e8be5a21ee375cb7fa11759380ec60c`
- `a332424190e3798b86195cb7cdf738a7b3051908`
- `15bcd3fd222166bb4eb5eed24e3b11637d0f7682`
- `1d25e8a62ee0dd76886b8ad0987747a93637d825`
- `3e791cadd4bd89957d3abd1772ea9c70f7f98ba9`

## Notes

Implemented:

- `desktop/src-tauri/src/local_notes.rs`
- local note list/search/filter
- get/create/update/delete
- tags
- revisions
- restore
- sync outbox

Migration:

```
005_local_notes
```

Relevant commits:

- `c71f44d5`
- `c9b38515`
- `3cb6bb4d`

## Knowledge

Implemented:

- `desktop/src-tauri/src/local_knowledge.rs`
- findings CRUD
- knowledge results CRUD
- relationships CRUD
- search
- note-search integration
- overview
- tags
- sync outbox

Migration:

```
006_local_knowledge
```

Relevant commits:

- `21c9474851535fe9313c89c82beb7de5a1934b0a`
- `6f18cbebb522c6b291012d308e69b848380258c9`
- `e2727ab784217c9eb8d8c49189fb50417e207bef`

Important review item:

`desktop/src/api/knowledge.ts` was modified with automated replacements and should be inspected carefully before treating it as final.

## Locations

Implemented:

- `desktop/src-tauri/src/local_locations.rs`
- list/get/create/update/delete
- parent_id support
- local sync outbox

Migration:

```
007_local_locations
```

Relevant commits:

- `46168db7340462e28e97a2d8203b2f29445a7307`
- `df9aed58641a57884de4dffa737a94efcd68d8a3`
- `e9d7e8731b9d215a9deebdce6d1aee364fef6c4`

Important review item:

Local `item_count` is currently initialized to zero and is not obviously synchronized with actual local inventory location assignments. This must be corrected before V1.

## Resources

A first local resource metadata runtime has just been implemented.

Added:

```
desktop/src-tauri/src/local_resources.rs
```

It currently provides:

- local resource list
- get resource
- cache central resource metadata locally
- create link
- create folder
- update metadata
- delete
- tags
- local parent validation
- YouTube link recognition/thumbnail URL derivation

Migration:

```
008_local_resources
```

The desktop resource API was modified to prefer local runtime for metadata operations.

Recent commits:

- `90fcaaee11f6abaf0d9ea26b7cb2107826d46265`
- `85a1190ca757002e3e5bf4dc2f6353f673f255dc`
- `0139f8a1441ffe86058930e722e89cb38d205f92`
- `9f59db8bd65fd0182151dcaea1486d55e0457150`
- `a2d49ce44df401106a1fd78a619ac9d71d5f43b3`
- `429693bd623ab01d52a1895838ee00fe30134fce`
- `dcb518bb156bdaf51a276c32ff690afce83db9ba`

Resource/media boundary:

- resource metadata can be local
- actual media downloading remains central
- yt-dlp/FFmpeg remain central
- downloaded media must be used for playback rather than original URLs

Important review item:

The resource runtime is a pragmatic first pass using JSON state in `sync_state`. It needs build/testing and a proper sync mapping before V1.

---

# 10. Media Architecture Decision

Media processing remains central.

Existing central backend:

```
backend/src/media-downloads.js
```

It manages:

- yt-dlp
- FFmpeg
- download queue
- download worker
- media processing
- downloaded media
- thumbnails

Configured tools include:

- backend-relative yt-dlp
- backend FFmpeg
- environment overrides

The central media worker must remain a central-service responsibility.

The desktop should not duplicate yt-dlp/FFmpeg as part of the local SQLite runtime.

---

# 11. Browser vs Tauri

Important runtime distinction:

- Browser does not have the Tauri IPC bridge.
- Full local SQLite functionality therefore requires the Tauri desktop runtime.
- Browser/API fallback can remain for central/web functionality.

Local APIs use a runtime check before invoking Tauri commands.

---

# 12. Current Desktop API Direction

The intended pattern is:

```
Desktop API function
       ↓
Is Tauri/local runtime available?
       ↓
YES → local Tauri backend/runtime → SQLite
       ↓
central sync when online

NO → central HTTP API fallback
```

The central fallback is retained primarily for browser/development compatibility and central operations.

The goal is not to leave two competing implementations indefinitely. Before V1, local ownership should be explicit for every operation.

---

# 13. Authentication Still Needs Rework

Current desktop authentication historically uses the central API:

- login → `/auth/login`
- register → `/auth/register`
- me → `/auth/me`
- password → `/auth/me/password`
- profile → `/auth/me/profile`

Current App startup also historically validates the stored token against the central server.

This violates the new architecture.

Required V1 change:

- create local single-user authentication/bootstrap
- local login must work without central API
- local session must survive offline operation
- central authentication should no longer be a prerequisite for local app use
- central account management can remain future/non-V1

This is one of the next major implementation tracks.

---

# 14. Search Still Needs Local-First Work

Search is another major local-first category.

Required:

- local search over locally available inventory
- projects
- notes
- knowledge
- resources
- other locally available entities

Central search can remain available for:

- central/global data
- cross-workstation aggregation
- server-only services

Next implementation track after resource metadata should be local search.

---

# 15. Central Boundary Audit Still Required

The backend route inventory includes:

- items
- sync
- transactions
- projects
- project-workspace
- resources
- resource-editor
- media-downloads
- notes
- search
- auth
- funding sources
- budget periods
- assistant
- project blocks
- project connectors
- blocks
- connectors
- locations
- audit
- collaboration
- knowledge
- reports
- automation
- engineering
- operations
- system
- experience
- phase4
- excel
- excel-purchases
- excel-finance

These must be explicitly classified as:

1. local-first
2. central-only
3. hybrid/local cache + central sync
4. future/non-V1

Do not assume that every existing PostgreSQL route should become local.

The objective is to define ownership clearly.

---

# 16. Assistant Decision

The assistant architecture has already been improved.

Relevant commits:

- `d1a66b5248c39100a1df3d535059a2a8f4a8405f`
- `a081cc85e7713a80a934befc7d6a7a4535a10219`
- `cceed44ba62a269473b7b5334d9b92eb1c4d25ab`

The assistant has context/tool-calling support.

Important project decision:

The user explicitly chose a project and custom aspects previously. Do not assume the solution is simply to wire the currently selected project route into the assistant. The global assistant with selected project/custom context is intentional.

Assistant integration should be classified according to the local/central boundary rather than being casually moved to SQLite.

---

# 17. UI/UX Decisions

The project has had broad UI work, but the current priority is architecture/reliability rather than broad redesign.

Current intended navigation:

- Knowledge — standalone
- Resources — standalone
- Inventory — standalone
- Laboratory group:
  - Operations
  - Intelligence

Scan Item was removed from the sidebar and moved into the TopBar.

Relevant commits:

- `6f145b267127dafee0f1beef8e11529423f5ad6c`
- `e98d5ea481a8705749320fc8d6b29a78ed1557e2`
- `1bc19c91d143692400d0bf72dd0c15f9b478ab1`

The user does not want broad accidental layout changes.

A previous icon change broke the page because `TreasureChest` was not exported; it was corrected by using `Library`.

Do not move the right activity rail/sidebar to the left or otherwise restructure the main layout unless specifically requested.

Project descriptions were previously given truncation/ellipsis treatment.

---

# 18. Resource Viewer / Media UI Decisions

Resource viewer work exists in:

- `desktop/src/pages/ResourcesPage.tsx`
- `desktop/src/pages/ResourceViewerModal.tsx`
- `desktop/src/pages/ResourceViewerModalLocal.tsx`

The local viewer wrapper is intended to route downloaded video playback through local media endpoints rather than the original external URL.

A split-view resizer was previously fixed using pointer events.

Recent resizer commit:

```
2907adc47b61a0eb829311eb1067857ad5df820e
```

Do not claim this is fully verified until tested.

The user also previously wanted a small collapsed-style editing tool sidebar inside the editor; this remains a possible UI task, but is not a blocker for the current architecture work.

---

# 19. Release History / Current Release Status

The existing version:

```
2.2.1
```

was a development/test build and should **not** now be treated as the final V1 architecture.

Existing version locations:

- `desktop/package.json`
- `backend/package.json`
- `desktop/src-tauri/tauri.conf.json`
- `desktop/src-tauri/Cargo.toml`

Production and Preview identifiers are separated.

Production:

```
com.lab-inventory.app
```

Preview:

```
com.lab-inventory.app.preview
```

Preview product name:

```
LabOS Preview
```

Production product name remains the production LabOS application identity.

---

# 20. Existing Release Workflow

Release workflow:

```
.github/workflows/release.yml
```

Relevant commit:

```
2c05370
```

It is intended to:

- trigger on `v*.*.*` tags
- validate versions
- install desktop dependencies
- build Tauri
- collect MSI/EXE installers
- generate SHA-256 checksums
- create/update GitHub Release

No final V1 tag/release should be created yet.

---

# 21. Existing Installer State

Production and Preview 2.2.1 installers were previously built successfully.

Production:

```
Lab Inventory_2.2.1_x64_en-US.msi
Lab Inventory_2.2.1_x64-setup.exe
```

Preview:

```
LabOS Preview_2.2.1_x64_en-US.msi
LabOS Preview_2.2.1_x64-setup.exe
```

The user was previously given a PowerShell script to move the NSIS installers into Downloads.

The release cleanup plan was:

1. uninstall old Production/Preview installations
2. stop local backend processes
3. remove old installers from Downloads
4. do not immediately delete AppData/SQLite
5. identify which databases are:
   - real-use Production
   - Preview
   - old regression/test
6. preserve regression/test data
7. only then prepare the fresh V1 installer

This cleanup was not confirmed complete at the point of this handoff.

---

# 22. V1 Release Gate

Do not release V1 until all of these are true.

## Architecture

- local backend/runtime exists
- local SQLite is authoritative for local V1 operations
- central backend/PostgreSQL is separate
- central API is not required for ordinary offline operation
- central-only media processing remains central
- sync boundary is explicit

## Local Runtime

- inventory verified
- projects verified
- notes verified
- knowledge verified
- resources verified
- locations verified
- search verified
- local auth/bootstrap verified

## Sync

- local outbox verified
- push verified
- pull verified
- retries verified
- reconnect verified
- conflict storage verified
- conflict resolution verified
- idempotency verified
- tombstones verified

## Fresh Database

- first launch creates fresh DB
- migrations run correctly
- baseline/system seed works
- one admin is seeded securely
- no development/test data appears

## Production/Preview

- distinct application identities
- distinct local data directories
- Production cannot accidentally use Preview data
- Preview cannot accidentally use Production data

## Media

- central yt-dlp works
- central FFmpeg works
- downloads are stored/processed centrally
- downloaded video playback never falls back to the original external URL

## Build

At minimum:

- TypeScript build
- Vite build
- Rust/Tauri build
- backend syntax/runtime checks
- local runtime smoke tests
- sync smoke tests
- fresh database smoke test
- Production installer build
- Preview installer build

Only after this should a V1 release tag be created.

---

# 23. Known Technical Risks / Cleanup Items

Before V1, explicitly review:

1. Local project JSON state vs normalized SQLite tables.
2. Local project outbox payload compatibility with central sync.
3. Local project identity/owner ID.
4. Local knowledge API transformations.
5. Local location `item_count` accuracy.
6. Resource JSON state vs normalized tables.
7. Resource sync mapping.
8. Local resource file storage strategy.
9. Authentication/bootstrap.
10. Search local implementation.
11. Central/local classification of every backend route.
12. Excel import ownership.
13. Finance/funding ownership.
14. Reports ownership.
15. Automation ownership.
16. Engineering/operations/system route ownership.
17. Assistant data/tool ownership.
18. Collaboration being clearly non-V1.
19. Media/download ownership.
20. Local and central API failure behavior.
21. Offline session behavior.
22. Fresh database seed behavior.
23. Production/Preview data isolation.
24. Full build/test verification.

---

# 24. Previous Reliability Work

Important existing reliability commits include:

- `daeb15923a6d226219e3e13fb50677a1dc14fa7a` — local movement validation
- `7ef64c91b0167c1f53fbf1b782ee751ac82da378` — expose inventory adjustment
- `9edb5bb68dd2223982d01e8387eb1b07e3dd3` — server-side stale offline item updates
- `0705cdfb2d585f1b6b70382f953ddfef1763bc75` — server pull/tombstone reconciliation
- `a338b0a00cdfd60e8a2f36b7eb24cb2a50a92ccb` — conflict/reconciliation UX
- `ba068a35c54d221dc2e11e2d665b33229b3b9096` — explicit local conflict resolution retry
- `bceef46b0a31e1ca79f020caf64768945d13e7da` — local actionable conflict resolution
- `deb177194fc03f5460c9aaec337fa6d9a6a36ed0` — TopBar SyncStatus
- `bea005d1e65e2d8b919e40c16675ba34a6b743d7` — restore sync error state
- `76ddeca` — automatic sync retry backoff
- `d1ead5e` — manual retry override
- `6c64e2d` — reconnect recovery
- `95eeec56250043999ba77fbf00ffcc910605d1f4` — sync reliability checks
- `657ca50ceb74d97d9c7d3b92d2d044e3b1588a21` — static sync reliability coverage

Admin permission fix:

```
63360519a737e71984aa4c14de0dd98cb8cb5ec49
```

This ensures the admin role receives its complete baseline permissions and per-user deny overrides cannot strip the admin baseline.

---

# 25. Current Implementation Sequence

The recommended sequence from this point is:

## Phase A — Finish local core ownership

1. Review/fix Resources local implementation.
2. Fix local resource sync representation.
3. Decide normalized vs JSON local resource storage.
4. Fix Locations/item-count relationship.
5. Implement local Search.
6. Audit Projects/Notes/Knowledge API transformations.
7. Identify every remaining central-only function.

## Phase B — Local identity/bootstrap

8. Implement local single-user authentication.
9. Implement fresh DB bootstrap.
10. Seed baseline/system data.
11. Seed secure initial administrator.
12. Make startup/session validation local.
13. Ensure offline login.

## Phase C — Central boundary

14. Audit every backend route.
15. Mark local / central / hybrid / future.
16. Remove accidental PostgreSQL dependencies from local workflows.
17. Keep media/download processing central.
18. Keep cross-workstation/global functionality central.

## Phase D — Sync completion

19. Define sync entity types.
20. Map local project/note/knowledge/resource/location changes to the central sync protocol.
21. Verify outbox payload compatibility.
22. Verify server application.
23. Verify pull reconciliation.
24. Verify conflicts.
25. Verify tombstones.
26. Verify retries/idempotency.

## Phase E — Testing

27. Build Rust/Tauri.
28. Build TypeScript/Vite.
29. Check backend.
30. Test fresh local DB.
31. Test offline local workflows.
32. Test reconnect.
33. Test sync.
34. Test conflicts.
35. Test media boundary.
36. Test Production/Preview isolation.

## Phase F — Release

37. Clean up old installations.
38. Preserve regression DBs.
39. Update version.
40. Build Production.
41. Build Preview.
42. Run final smoke tests.
43. Tag V1.
44. Let release workflow publish installers/checksums.
45. Verify installation on a clean machine/profile.

---

# 26. What Not To Do

Do not:

- replace PostgreSQL with SQLite
- connect the desktop directly to PostgreSQL
- make PostgreSQL required for offline/local operations
- duplicate central media processing unnecessarily
- delete development/test databases blindly
- release 2.2.1 as if it were the final V1
- tag a final V1 before local backend/bootstrap verification
- assume all existing backend routes should become local
- perform broad UI rewrites while architecture work is underway
- move existing UI rails/sidebar positions accidentally
- claim builds/tests passed without actually running them

---

# 27. Working Rules For The Next Chat

The user has explicitly authorized GitHub work on:

```
Bonsinnoba/lab-inventory-app
```

Work directly on:

```
main
```

Do not create or switch to another branch unless the user explicitly asks.

The user generally prefers direct implementation and often uses:

> “go”

When they say “go”, proceed with the next agreed implementation step rather than returning a long plan.

For significant architectural changes:

- inspect the existing implementation first
- make focused changes
- commit to `main`
- report the commit
- test/build when appropriate
- never claim verification that was not performed

---

# 28. Immediate Next Step

The next recommended work after this handoff is:

**Finish and verify the local-first Resources implementation, then implement local Search, followed by local single-user authentication/bootstrap.**

Before continuing too far, build/test the current local runtime because several local modules have been added without a full Rust/TypeScript build verification.

The highest-priority architectural blocker for final V1 remains:

```
Desktop
   ↓
Local Backend
   ↓
SQLite
```

must be a real, verified runtime boundary rather than merely a collection of Tauri command wrappers.

The central system remains:

```
Local Backend
   ↓
Central Backend
   ↓
PostgreSQL
   ↓
Sync + media + global services
```

That separation is the foundation of the final LabOS V1 release.
