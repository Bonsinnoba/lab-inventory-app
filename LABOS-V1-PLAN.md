# LabOS V1 — Master Plan and Decisions

> Consolidated from the project discussion beginning with the clarification that LabOS needs a local backend + SQLite on every workstation and a separate central backend + PostgreSQL system.

## 1. Core architectural decision

LabOS has **two distinct runtime/backend layers**.

### Per-workstation local system

```
LabOS Desktop / Tauri
        ↓
Local LabOS Backend
        ↓
Local SQLite
```

Every LabOS desktop installation has its own local database and local backend/runtime.

The local backend is bound to that workstation/app installation and is responsible for local data access and local operations. The desktop application must not need the central PostgreSQL system for normal local work.

### Central LabOS system

```
Local backend(s)
       ↓
Central LabOS Backend
       ↓
PostgreSQL
       ↓
Central services
```

The central system is responsible for synchronization and services that inherently belong centrally, including server-side/shared state and media processing.

### Non-negotiable boundary

**Desktop must not connect directly to PostgreSQL.**

**PostgreSQL must not replace the local SQLite database.**

The intended production architecture is:

- Desktop/Tauri talks to the local LabOS backend.
- Local backend talks to local SQLite.
- Local backend synchronizes with the central LabOS backend when connectivity exists.
- Central backend talks to PostgreSQL.
- Central services handle centralized jobs such as media downloading/processing.

---

## 2. V1 product model

V1 is a **fresh installation**, not a continuation of the current development/test databases.

On first launch of a fresh V1 installation:

1. Create a new local SQLite database.
2. Initialize the local schema.
3. Create the workstation/device identity.
4. Create the local administrator identity.
5. Seed only required baseline/system data.
6. Start with no development/test inventory or other test records.
7. Allow the application to operate locally without the central server.

Existing development/test databases must be preserved as regression/test data until they have been identified and intentionally retired.

### Production vs Preview

Production and Preview must have separate application identities and separate local data directories/databases.

This prevents Preview from sharing or corrupting Production data.

---

## 3. Single-user V1 decision

The project is currently treated as a **single-user workstation application**.

The user explicitly decided that V1 does not need full multi-user/account-management functionality.

Therefore V1 needs:

- one local administrator identity;
- local login/session/authentication;
- offline login;
- ability for the local administrator to change their own password/profile where supported;
- local authorization based on the administrator identity.

V1 does **not** need:

- full local user provisioning;
- account/member administration;
- multi-user collaboration;
- central user management as a V1 dependency.

Central user/account management can remain future work.

The central system may support user provisioning in a later phase, but it must not be required to operate the single-user local application.

---

## 4. What must work offline/local-first

The guiding rule is:

> If an operation concerns the workstation's own data and does not inherently require coordination with other workstations, it should work through the local backend and SQLite.

### Inventory

Local/offline operations include:

- view inventory;
- search/filter inventory;
- add/register items;
- edit items;
- receive stock;
- checkout;
- return;
- consume;
- adjust stock;
- transfer;
- damage;
- loss;
- repair out;
- repair in;
- inventory history/movements;
- local validation;
- local mutation persistence;
- queueing changes for synchronization.

The inventory system already has substantial local SQLite and outbox foundations.

### Projects

Local/offline operations include:

- view projects;
- create projects;
- edit project metadata;
- delete projects;
- project workspace;
- tasks CRUD;
- experiments CRUD;
- project BOM;
- project-item links;
- locally available project information.

Central-only project functionality must not accidentally become a V1 dependency.

### Knowledge / Notes

Local/offline operations include:

- view notes;
- create notes;
- edit notes;
- delete notes;
- search locally available notes;
- tags;
- revisions;
- restore revisions;
- knowledge findings/results/relationships;
- local knowledge search;
- knowledge overview/counts based on local data.

### Resources

Resource metadata and local records should be available locally.

Local/offline resource operations include:

- list resources;
- view resource metadata;
- create local link resources;
- create folders;
- edit metadata;
- tags/categories;
- delete resources where permitted;
- browse locally available resources;
- view files already downloaded to the workstation.

However, **actual media acquisition/processing remains central**.

### Users / identity

Local:

- login;
- session;
- current local identity;
- password change;
- profile/preferences where applicable.

### Settings

Workstation/user settings that do not require central coordination should remain local.

### Sync

The local system must maintain:

- sync outbox;
- pending changes;
- retries;
- sync status;
- sync cursor/state;
- conflicts;
- conflict resolution;
- recovery after restart;
- offline accumulation of changes.

---

## 5. What belongs to the central system

The central backend/PostgreSQL system handles functionality that inherently requires centralized coordination.

### Synchronization

- receive local outbox changes;
- idempotency;
- server-side validation;
- stale-data/conflict detection;
- central reconciliation;
- distribute central changes back to workstations;
- tombstones/deletions;
- cross-device consistency.

### Central data

PostgreSQL is the central authoritative/shared datastore for synchronized/global information.

### Media

The central backend owns:

- media download jobs;
- yt-dlp;
- FFmpeg;
- centralized media processing;
- central media storage;
- download queue;
- media conversion/preparation;
- server-side media status.

Downloaded videos must not depend on their original external links for playback.

The desktop should use locally available downloaded media when media has been prepared and synchronized/available.

### Cross-workstation services

Central-only functionality includes:

- synchronization between multiple workstations;
- central aggregation;
- globally authoritative state;
- cross-workstation reporting;
- centralized automation;
- central jobs/services;
- future multi-user/account management.

---

## 6. Existing synchronization foundation

The project already contains an inventory sync/outbox foundation.

### Local side

The local SQLite layer contains:

- `local_schema_migrations`;
- `device_identity`;
- `sync_state`;
- `sync_outbox`;
- `sync_conflicts`;
- local inventory snapshot/state;
- inventory sync cursor.

Local changes are queued in the outbox.

### Central side

The central backend has:

- `/api/sync/push`;
- `/api/sync/pull`;
- idempotency handling;
- stale item conflict checks;
- conflict-resolution override;
- tombstone reconciliation.

The server pull cursor uses a composite event cursor based on:

- event time;
- event type;
- event ID.

Legacy timestamp cursors are accepted.

### Reliability

The desktop sync layer already has:

- automatic sync;
- reconnect recovery;
- retry/backoff;
- manual retry;
- persisted sync error state;
- sync status UI;
- pending-change counts;
- conflict counts;
- actionable conflict resolution.

The remaining architectural work is to make the **local backend** the normal execution boundary instead of having the desktop rely directly on the central API for local operations.

---

## 7. Local backend requirement

A major decision from the discussion is that the SQLite layer should not merely be treated as an internal desktop implementation detail.

The intended model is a real **Local LabOS Backend** bound to the installed application/workstation.

Its responsibilities should include:

- local API/runtime boundary;
- SQLite access;
- local authentication/session;
- local inventory;
- local projects;
- local notes/knowledge;
- local resources metadata;
- local settings;
- local validation;
- local outbox;
- local sync state;
- local conflict state;
- local-first reads/writes.

The Tauri application should communicate with this local runtime rather than directly reaching into PostgreSQL.

The existing Tauri Rust local runtime is an implementation foundation for this direction. The final V1 architecture should make the local-backend boundary explicit and maintainable.

---

## 8. Current local-first implementation progress

The following local-first runtime work has already been added on `main`.

### Inventory

Existing foundation:

- local inventory tables;
- local-first reads;
- local mutations;
- atomic movement updates;
- sync outbox;
- movement validation.

Supported movement types:

- receive;
- checkout;
- return;
- consume;
- adjust;
- transfer;
- damage;
- loss;
- repair_out;
- repair_in.

Adjustment requires a reason.

### Projects

Added local Projects runtime:

`desktop/src-tauri/src/local_projects.rs`

It currently covers:

- project list/get/create/update/delete;
- project workspace;
- task CRUD;
- experiment CRUD;
- BOM CRUD;
- project-item link/unlink;
- local sync-outbox queueing.

Project API calls were changed to prefer the local Tauri runtime.

Current implementation uses a JSON state blob in `sync_state` as a pragmatic first pass. This should be reviewed before final V1 if normalized local tables are preferable.

### Notes

Added:

`desktop/src-tauri/src/local_notes.rs`

It covers:

- list/search/filter;
- get/create/update/delete;
- revisions;
- restore revision;
- local outbox queueing.

Notes API calls now prefer the local runtime.

### Knowledge

Added:

`desktop/src-tauri/src/local_knowledge.rs`

It covers local:

- findings;
- knowledge results;
- relationships;
- search;
- overview counts;
- recent local notes/resources;
- tag aggregation;
- sync-outbox queueing.

Knowledge API calls now prefer the local runtime.

The Knowledge API file should receive a careful review/build verification because its local-first transformation was performed through automated edits.

### Locations

Added:

`desktop/src-tauri/src/local_locations.rs`

It covers:

- list/get/create/update/delete;
- parent IDs;
- local location state;
- sync-outbox queueing.

Locations API calls now prefer the local runtime.

A known follow-up issue remains: local `item_count` is initialized locally and may not yet accurately reflect local inventory assignments. This must be corrected before V1.

### Resources

A first local resource metadata/runtime pass has been added:

`desktop/src-tauri/src/local_resources.rs`

It covers local:

- resource listing;
- resource lookup;
- cached resource records;
- link resources;
- folders;
- metadata updates;
- deletion;
- tags;
- YouTube resource type/thumbnail metadata.

Resource API calls have been changed to prefer the local runtime for metadata/record operations.

The current design deliberately keeps actual media download/processing central.

### Media

The media download API remains central.

Current central media runtime uses:

- yt-dlp;
- FFmpeg;
- download queue;
- media jobs;
- thumbnail/media endpoints;
- central processing.

The rule remains:

> Media acquisition and processing are central services, not local SQLite responsibilities.

---

## 9. Resource/media distinction

This distinction is important.

### Resource record

A resource's local metadata can exist in SQLite:

- ID;
- name;
- kind;
- file type;
- URL;
- thumbnail metadata;
- category;
- description;
- tags;
- parent relationships;
- local associations.

### Media processing

The following remain central:

- downloading external video;
- yt-dlp;
- FFmpeg;
- media conversion;
- centralized storage;
- download queue/job execution.

The desktop must never require the original YouTube/Facebook/etc. URL to play a successfully downloaded local video.

For YouTube resources, the local resource metadata can retain a thumbnail URL, while downloaded thumbnail/media handling remains governed by the central media service where appropriate.

---

## 10. Current backend route inventory to classify

The central backend currently exposes/imports routes including:

- items;
- sync;
- transactions;
- projects;
- project workspace;
- resources;
- resource editor;
- media downloads;
- notes;
- search;
- auth;
- funding sources;
- budget periods;
- assistant;
- project blocks;
- project connectors;
- blocks;
- connectors;
- locations;
- audit;
- collaboration;
- knowledge;
- reports;
- automation;
- engineering;
- operations;
- system;
- experience;
- phase4;
- Excel;
- Excel purchases;
- Excel finance.

These routes must be explicitly classified into:

1. local-first/local backend;
2. central-only;
3. hybrid/sync-mediated.

No route should remain central merely because it historically existed in the central backend.

---

## 11. Important existing application decisions

### Sidebar/navigation

The intended navigation structure is:

- Knowledge — standalone;
- Resources — standalone;
- Inventory — standalone;
- Laboratory group containing:
  - Operations;
  - Intelligence.

Scan Item was removed from the sidebar and moved into the TopBar action area.

### Scan Item

Scan Item is a TopBar action rather than a permanent sidebar destination.

### Assistant

The assistant architecture already has context/tooling work.

Important decisions:

- the assistant can use a selected project/custom aspects;
- do not collapse the global assistant into merely the current route's project;
- preserve assistant tools/context across turns.

### UI

The site has already received multiple UI polish changes.

Current instruction is to avoid broad destructive layout changes.

In particular:

- do not move the right activity rail/sidebar to the left;
- preserve the existing layout unless a focused fix requires otherwise;
- fix concrete UX issues without rewriting unrelated areas.

---

## 12. Existing media/resource UI decisions

The Resources page has:

- resource viewer;
- local resource viewer wrapper;
- local media URL handling;
- thumbnail handling;
- downloaded-video playback behavior.

The user explicitly tested thumbnails and confirmed that failed image requests were an actual request/data problem, not simply hidden images.

A previous issue involved old YouTube resources lacking a local thumbnail endpoint/thumbnail data.

Current design should preserve resource thumbnails and distinguish:

- metadata thumbnail;
- locally downloaded media;
- central download processing;
- original external URL.

A random YouTube link used during testing must not be treated as a special production data case.

---

## 13. Release strategy

The earlier 2.2.1 build is treated as a **development/test build**, not the final V1 release.

Do not release/tag V1 until the local backend architecture is complete and verified.

### Fresh V1 installation

The final V1 installer must:

- install the desktop application;
- create fresh local SQLite data on first launch;
- seed baseline/system data;
- create the local administrator;
- not inherit development/test records;
- maintain Production/Preview data isolation.

### Existing installers

Previously built 2.2.1 Production and Preview installers are not the final release.

They should be removed/uninstalled during cleanup once the corresponding databases and regression data have been identified.

Do not blindly delete AppData/SQLite databases before identifying which databases are:

- Production;
- Preview;
- development/test;
- regression fixtures.

### Release metadata

The release process already uses versioning across:

- `desktop/package.json`;
- `backend/package.json`;
- `desktop/src-tauri/tauri.conf.json`;
- `desktop/src-tauri/Cargo.toml`.

Release tags follow:

`vMAJOR.MINOR.PATCH`

The existing release workflow builds Windows installers and produces SHA-256 checksums.

No final V1 release should be created until architecture/bootstrap verification is complete.

---

## 14. Verification requirements before V1

Every local-first area must be tested in the actual Tauri runtime.

### Local/offline tests

For each local-first feature:

1. Launch the desktop app.
2. Disconnect/disable central connectivity.
3. Confirm reads still work.
4. Create/update/delete locally as appropriate.
5. Confirm changes persist in local SQLite.
6. Confirm changes are queued in the sync outbox.
7. Restart the application.
8. Confirm local state remains.
9. Restore connectivity.
10. Confirm queued changes synchronize.
11. Confirm sync status and conflict handling work.

### Central-service tests

For central-only features:

- verify they fail clearly when the central service is unavailable;
- verify they do not silently corrupt local state;
- verify they become available when central connectivity returns.

### Sync tests

Verify:

- offline accumulation;
- retry/backoff;
- reconnect;
- idempotency;
- stale update conflict;
- conflict record creation;
- keep-local resolution;
- accept-server resolution;
- dismiss;
- tombstone handling;
- cursor progression;
- restart recovery.

### Build verification

Before V1:

- TypeScript compile;
- Vite production build;
- Rust/Tauri build;
- local backend/runtime checks;
- central backend syntax/startup checks;
- relevant automated/static tests;
- actual offline/online smoke tests.

No feature should be considered complete merely because its source files were written.

---

## 15. Recommended implementation order from here

### Phase A — Finish the local runtime boundary

Make the Local LabOS Backend explicit and ensure desktop local operations flow through it.

Priority:

1. local runtime/bootstrap;
2. local authentication;
3. local settings/session;
4. local API boundary;
5. local SQLite ownership.

### Phase B — Complete local-first core domains

Finish and verify:

1. Inventory;
2. Projects;
3. Notes;
4. Knowledge;
5. Locations;
6. Resources.

Resolve known gaps such as location/item counts.

### Phase C — Search

Move local search to the local backend/SQLite path for workstation-owned data.

Central search should remain available for central/global information where needed.

### Phase D — Auth/bootstrap

Implement the single-user local administrator model.

Fresh install must bootstrap cleanly without depending on PostgreSQL.

The exact initial-admin credential/first-run password scheme must be finalized as an implementation decision; do not use an insecure universal hard-coded production password.

### Phase E — Central boundary audit

Audit every central route and classify it:

- Local;
- Central;
- Hybrid.

Move or duplicate only the required logic so the local backend is self-contained.

### Phase F — Sync protocol completion

Ensure local changes map cleanly into the central sync protocol.

Projects, notes, knowledge, locations, resources and other local-first domains must have deliberate sync representations rather than accidental/unrecognized outbox entity types.

### Phase G — Media/central services

Keep:

- yt-dlp;
- FFmpeg;
- media downloads;
- processing;
- central storage

strictly central.

Verify that the desktop consumes prepared local media correctly.

### Phase H — Full offline/online verification

Test the complete application with the central service unavailable and then restored.

### Phase I — Fresh V1 bootstrap

Create and test a truly clean V1 database initialization path.

### Phase J — Release cleanup

Identify and preserve regression/test databases, uninstall old dev/test builds, clean old installers, and confirm Production/Preview isolation.

### Phase K — V1 build and release

Only after all previous phases pass:

- finalize version;
- build Production;
- build Preview;
- verify installers;
- generate checksums;
- tag V1;
- publish release.

---

## 16. Known caveats to resolve

The following items are known and should not be forgotten:

- Local backend boundary is still being formalized.
- Some local-first implementations currently use JSON blobs in `sync_state`; review before V1.
- Local project owner identity is not yet backed by a finalized local admin identity.
- Local project workspace currently returns simplified/empty data for some central-only fields.
- Project experiment task links and task/experiment resource attachments are now represented in local project state and the sync protocol; actual runtime/offline verification is still pending.
- Local resource upload/file storage is not yet equivalent to central resource storage; central file/media handling remains distinct.
- Resource sync mappings are now implemented for offline link/folder creation, metadata updates, deletion, server pull, tombstones, and pending-local protection; actual file upload/media acquisition remains central.
- Desktop global search now has a local-first path for inventory, projects, tasks, experiments, notes, and resources; central search remains the hybrid source for users and other explicitly central information.
- Local authentication/bootstrap is not yet complete.
- Location `item_count` needs reconciliation with local inventory.
- Some desktop APIs still call the central API directly and need classification/migration.
- The Knowledge API local-first transformation needs build/runtime verification.
- No final V1 tag/release should be assumed to exist.
- The earlier 2.2.1 installers are development/test artifacts, not the final V1.

---

## 17. Working rules for future implementation

1. Work directly on `main` when implementing requested changes.
2. Do not create a new branch unless explicitly requested.
3. Do not replace PostgreSQL with SQLite.
4. Do not connect the desktop directly to PostgreSQL.
5. Do not make the central API a hidden dependency for local/offline operations.
6. Keep central-only services central.
7. Preserve existing regression/test data until identified.
8. Treat V1 as a fresh install.
9. Maintain separate Production and Preview local data.
10. Verify actual Tauri/offline behavior, not only source-level intent.
11. Avoid unrelated UI/layout rewrites while doing architecture work.
12. Do not claim a phase is complete until it has been implemented **and verified**.
13. When a domain is local-first, its local reads/writes must not silently fall through to PostgreSQL merely because the desktop is online.
14. When a domain is central-only, provide a clear central-service dependency instead of pretending it is offline-capable.
15. Sync must be explicit and idempotent.

---

## 18. Current status snapshot

The project has already established substantial foundations for:

- local SQLite;
- inventory;
- outbox/sync;
- conflict handling;
- local projects;
- local notes;
- local knowledge;
- local locations;
- first-pass local resource metadata.

The next major work is **not a release tag**.

For execution, the detailed phases above are consolidated into five working phases:

1. **Local LabOS Runtime** — formalize Desktop → Local Backend → SQLite, including local bootstrap/auth/session/settings.
2. **Local-First Application** — complete and verify workstation-owned domains, local search, and classify remaining desktop APIs.
3. **Sync + Central Services** — complete sync mappings/conflicts/recovery and keep media acquisition/processing central.
4. **V1 Verification + Fresh Install** — full offline/online verification, build checks, fresh SQLite bootstrap, administrator creation, and Production/Preview isolation.
5. **V1 Re-Release** — final UI/UX polish, regression pass, production/preview builds, checksums, tag, and GitHub release.

The current implementation work is in **Phase 2 — Local-First Application**.

The next work is to finish the architectural boundary:

> **Desktop → Local LabOS Backend → SQLite**

and:

> **Local LabOS Backend → Central LabOS Backend → PostgreSQL**

with synchronization and centralized media services between/around those layers as appropriate.

Only after that boundary is complete, the remaining local-first domains and central-only services are classified, and the complete system is verified offline/online should the project proceed to the fresh V1 bootstrap and final release.


### Financials — implementation progress

Local-first finance runtime is now implemented on main for transactions, budget periods, and funding sources. Desktop finance CRUD prefers local SQLite-backed state and queues mutations to the sync outbox. Central synchronization now accepts and pulls these records, including tombstone propagation. Finance summaries and Excel operations remain central-derived services until their local equivalents are explicitly implemented and verified.


### Local Authentication / Bootstrap — implementation progress

The local Tauri runtime now owns the V1 workstation authentication boundary: first-run administrator bootstrap, local login/session, current-user lookup, logout, password change, and profile update. Passwords are stored using Argon2id-compatible password hashes rather than a hard-coded credential. The desktop authentication API prefers this local runtime under Tauri and falls back to the central API only for non-Tauri/browser contexts. Actual fresh-install/offline runtime verification is still required.

### Project Experiment Work — implementation progress

Project experiment measurements and observations are local-first and sync-aware. Task↔experiment links now have a stable server sync identity and local Tauri CRUD. Project task/experiment resource attachments are local-first for metadata/linking while the underlying resource/media boundary remains unchanged. Experiment revision history remains a server-derived history until a local revision model is explicitly implemented and verified.

### Project Canvas — implementation progress

Project canvas metadata is now local-first on main. Desktop canvas reads and block/connector mutations use the local SQLite project runtime when running under Tauri and queue explicit project_block/project_connector outbox changes. Central sync accepts these entities, enforces project edit access, pulls current canvas state with project workspace data, and propagates canvas tombstones back to workstations. Canvas media/file storage remains subject to the existing central resource/media boundary.
