# LabOS visibility-scope implementation plan

**Status:** the Notes, Resources, and Projects visibility slices and the
account-scoped desktop sync foundation are implemented in code. The backend
migration and a restricted-Note grant/revocation flow have now passed against
a disposable PostgreSQL database. The running desktop, other record domains,
and cross-surface leakage tests remain unverified.

> The base schema intentionally covers initial tables. `backend/src/run-migration.js`
> then applies the complete active history from `backend/src/migrations/`.
> The obsolete top-level `backend/migrations/` directory is not read by the
> runner and must not receive new migrations.

### Disposable PostgreSQL verification — 2026-10-03

- Used a separate `postgres:16-alpine` container without a persistent volume;
  the existing LabOS database was not changed.
- A fresh migration run initially stopped at
  `20260926_fulfillment_idempotency.sql`, which alphabetically preceded the
  migration creating `project_reservation_fulfillments`. The runner now orders
  those existing filenames by their dependencies without changing migration
  version names. A second database migrated from empty through
  `20261002_visibility_scope.sql` successfully.
- The PostgreSQL schema integration test and all 33 backend
  permission/visibility tests passed.
- An authenticated two-account HTTP check passed for a restricted Note:
  hidden from the other user's detail and list responses, readable after an
  administrator's view grant, and hidden again after revocation.
- This is backend verification only. It does **not** establish that the
  desktop cache, outbox, restart/offline behavior, Resources/Projects HTTP
  routes, exports, search, or assistant are end-to-end safe yet.

### Route-inspection findings resolved

| Surface | Current path | Risk | Recommended change | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| Project financial summary | `backend/src/routes/projects.js` `/financial-summary` previously checked project membership but not record visibility | A member with finance permission could receive a restricted project's financial summary after their record grant was removed | Filter projects through the shared visibility predicate in addition to financial permission | Actual PostgreSQL HTTP test: hidden, granted, revoked; backend regression test | Fixed |
| Resource metadata facets | `backend/src/routes/resources.js` `/meta/tags` and `/meta/categories` previously aggregated all Resources | Tags and categories could reveal restricted content or counts | Aggregate only resources readable by the requesting user, including ancestor and attached-Note rules | Actual PostgreSQL HTTP test: hidden, granted, revoked; backend regression test | Fixed; batch-query performance remains to improve |

### Existing LabOS PostgreSQL verification — 2026-10-03

- Created an ignored logical backup at
  `_backups/labos-pre-visibility-20261003.dump` before changing the running
  database. The existing database container and volume were not recreated.
- Rebuilt and restarted only the API service. Its startup migration applied
  the previously pending `20260924_inventory_acquisition.sql`, the six
  `20260926_*` reservation/project migrations, and
  `20261002_visibility_scope.sql` to the existing database. API health returned
  HTTP 200 afterward.
- With a namespaced temporary member and real database rows, authenticated
  HTTP checks confirmed restricted project financial summaries and Resource
  tags/category counts are hidden before a grant, visible after a view grant,
  and hidden again after revocation.
- The test Resource and Project were deleted by their API endpoints. The
  namespaced test member remains disabled for audit history; all pre-existing
  users, Notes, and Resources were left untouched. The post-test database has
  zero Projects, one Note, and one Resource, as before the test.
- All 34 backend permission/visibility tests pass. Desktop two-account cache,
  offline/restart sync, and other visibility surfaces still need runtime tests.

## Approved policy

LabOS uses three visibility levels for ordinary laboratory records:

| Level | Read access | Write access |
| --- | --- | --- |
| `lab` | Active users with the domain read permission | The relevant domain mutation permission; project-owned work also requires project edit access |
| `project` | Project members and administrators with the domain read permission | Project editors and administrators with the relevant mutation permission |
| `restricted` | Explicit record grants and administrators with the domain read permission | Explicit edit grants and administrators with the relevant mutation permission |

Sensitive finance, audit, user, and system data are not made visible by this
model. They continue to require their dedicated permissions.

### Restricted-record ownership decision

The approved grant-management model is **Option C**:

- a creator may create a restricted record and receives an automatic `edit`
  grant for that record;
- an administrator or the owning project's lead may add, change, or remove
  other users' grants;
- for an unattached restricted record, only an administrator may manage other
  users' grants;
- every visibility or grant change is audited.

## Current implementation evidence

### Already aligned in part

- `backend/src/middleware/project-access.js` grants active users `view` access
  to ordinary projects, while preserving membership/role checks for edits.
- `backend/src/middleware/resource-access.js` treats unattached and item-only
  resources as shared, and protects shared-resource mutation to the uploader
  or an administrator.
- `backend/src/routes/audit.js` uses `audit.view` rather than `reports.view`.
- Sensitive finance checks are already represented by `finance.view_sensitive`
  in finance routes, exports, assistant projections, and sync projections.

### Gaps found before implementation

| Surface | Evidence | Gap against approved policy |
| --- | --- | --- |
| Database schema | `backend/src/schema.sql` defines no `visibility` column or record-grant table | No durable `lab`/`project`/`restricted` data model exists. |
| Notes and resources | `notes` and `resources` contain project linkage but no visibility field | A record cannot be explicitly restricted or project-only independently of its parent relationship. |
| Knowledge routes | `backend/src/routes/knowledge.js` uses membership-only `projectVisibility` and `projectFilter` SQL | Lab-wide ordinary reads are inconsistent with project middleware. |
| Knowledge sync | `GET /knowledge/sync/pull` filters project-linked records by membership | Ordinary lab records can disappear from a workstation cache even though normal project read policy permits them. |
| Global search | `backend/src/routes/search.js` has no visibility predicate for notes, resources, tasks, experiments, or blocks | It cannot enforce future `project` or `restricted` records. |
| Assistant tools | `backend/src/routes/assistant.js` uses project-row filtering for notes/resources and direct queries for context | It needs the same centralized entity-read predicate as REST/search/sync. |
| Reports | `backend/src/routes/reports.js` intentionally treats ordinary reports as lab-wide | It must gain visibility predicates before restricted records are introduced. |
| Desktop cache | Local pull/merge commands currently receive no visibility metadata or grants | A restricted record could remain cached after access is revoked unless pull reconciliation includes access-removal tombstones. |

## Implementation sequence

### 1. Create the access-control data model — in progress

Add a new migration; do not edit previous migrations. The target model is:

```sql
CREATE TYPE record_visibility AS ENUM ('lab', 'project', 'restricted');

CREATE TABLE record_access_grants (
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL CHECK (access_level IN ('view', 'edit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (entity_type, entity_id, user_id)
);
```

Initial columns belong on records that can be independently confidential:

- `projects`
- `notes`
- `resources`
- `lab_findings`
- `lab_results`
- `engineering_calculations`
- `engineering_tests`

Project workspace children (tasks, experiments, measurements, observations,
BOM, blocks, connectors, attachments, requirements) inherit their project's
visibility unless a later product decision explicitly requires exceptions.

Existing records must migrate as `lab`. No historical record will be hidden by
the initial migration.

### 2. Centralize visibility decisions in backend middleware

Create a single policy helper that receives the entity context, domain
permission, request user, and requested operation. Routes must not invent
their own membership-only predicates.

```js
await requireEntityReadAccess({
  user: req.user,
  permissions: req.permissions,
  entityType: 'note',
  entity: note,
});
```

The helper must first require an active authenticated user and the appropriate
domain permission, then apply `lab`, `project`, or `restricted` access. A
mutation always adds the existing project-editor/domain-mutation requirements.

### 3. Convert data surfaces in risk order

1. Individual entity routes: projects, notes, resources, engineering,
   knowledge findings/results/relationships.
2. Search, resource download, thumbnails, resource editor, and canvas
   attachment routes.
3. Sync pull/push, tombstones, replay response projection, and desktop merges.
4. Assistant context/evidence/search tools and reports/exports.
5. Visibility/grant administration UI, audit logging, and desktop state.

### Notes vertical slice — implemented; runtime verification pending

`backend/src/routes/notes.js` now accepts and returns note visibility, applies
the shared read predicate to list/detail/tag routes, and protects restricted
note revisions and mutations with explicit edit grants. A restricted note
creation atomically creates the author’s edit grant. Server-only note grant
routes exist for the approved Option C managers; a UI is intentionally deferred
until sync, resource inheritance, and access-revocation behavior are covered.

The Note sync path now carries `visibility` in offline changes, validates it
locally and on the server, and applies the same backend predicate during pull.
`GET /sync/notes/pull` returns `visible_note_ids`, an authoritative list of
Notes available to the current user. The desktop reconciler removes any
non-pending cached Note absent from that list, so a completed authenticated
pull removes records after a grant is revoked without revealing hidden IDs.

Verification completed on 2026-10-02: backend syntax checks and 28 permission/
visibility regression tests passed; the desktop TypeScript typecheck and
`cargo check` passed. PostgreSQL migration and HTTP integration tests remain
pending against a disposable database because Docker was unavailable locally.

### Resources vertical slice — implemented; creation controls staged

Resource access now evaluates every resource ancestor and every attached Note.
That means a public-looking child, thumbnail, download, editor, or sync pull
cannot weaken a restricted parent folder or Note. Resources have dedicated
visibility and grant endpoints, following Option C: admins and project leads
manage other users’ grants. Resource sync now carries scope and returns an
authoritative `visible_resource_ids` set; the desktop removes non-pending,
no-longer-authorized cached Resources after a successful pull.

Existing upload, folder, and link creation continue to default to `lab` scope
for compatibility. The typed desktop API now exposes the scope/grant endpoints;
the resource creation UI must be updated in the next UI slice to choose a scope
before any new restricted-resource workflow is offered.

### Projects vertical slice — implemented; runtime verification pending

Projects are the root visibility boundary for much of LabOS. The shared project
access helper now evaluates project scope before granting ordinary membership
access, so descendant routes that already use it inherit the same boundary.
Project list and direct read routes use the shared predicate; restricted
projects have server-side scope and audited Option C grant endpoints for
admins and project leads.

Project sync now carries `visibility` and returns an authoritative
`visible_project_ids` snapshot. The desktop removes a cached project missing
from that snapshot unless it has pending project outbox work. This protects
access revocation without converting the cleanup into an outbound delete.
Project creation continues to default to `lab` through the existing UI; a
scope picker and grant-management UI remain a dedicated product/UI slice.

### Project effective-access cache — implemented; runtime verification pending

The project pull now sends the project team and the authenticated user's
effective `admin`/`edit`/`view` access, including restricted-record grant
level. The desktop workspace and canvas use that cached access. Local project
mutations require both the cached project editor decision and the existing
domain permission before writing an outbox event. Cached access is tied to
the central user ID; older cache entries default to read-only until refreshed.

Project workspace Notes and Resources are filtered by their own visibility
rules, resource-backed canvas blocks and attachments are filtered through
resource access, and audit activity is returned only to administrators.
Membership management now uses the same project editor decision as other
project mutations. The server remains authoritative on sync push, including
for edits queued before a grant is revoked.

Verification: backend permission/visibility tests, desktop TypeScript check,
and Rust `cargo check` pass. PostgreSQL migration and authenticated HTTP
integration still require a disposable database; Docker access was denied
by the local environment on 2026-10-02.

### Outbox account isolation — implemented; runtime verification pending

SQLite schema 003 adds `sync_outbox.account_id`. New rows are stamped with the
active, unexpired central account by database triggers, so every module's
existing outbox insertion path is covered. Queue reads, acknowledgements,
failure updates, and conflicts are account-bound. Pull reconciliation inspects
only the active account's pending rows. The desktop sync loop checks that the
user and token have not changed before push and before applying each pull.
Finance state updates and outbox insertion now share a SQLite transaction, so
an ownership-trigger failure rolls back both rather than leaving an unqueued
local finance edit.

Pre-migration rows have no provable owner. They remain in SQLite with a null
`account_id`, are excluded from upload and conflict controls, and pause sync
until they can be reviewed and attributed by an explicit recovery workflow.
The sync panel reports their count. Do not automatically assign them to the
currently signed-in user, delete them, or clear the warning. A recovery UI and
backup/export procedure need a separate design and user approval.

Verification: the account-switch/migration SQLite regression test, all Rust
unit tests, `cargo check`, and desktop TypeScript check pass. A running-app
two-account test remains to be done.

### Account-scoped local cache and pull apply — implemented; runtime verification pending

Schema 004 uses `account:<central-user-id>:<state-key>` for every `sync_state`
reader and writer, including inventory, project, note, resource, finance,
knowledge, engineering, location, search, preferences, and the inventory pull
cursor. The old unscoped rows remain untouched but are hidden; their nonempty
count appears in the sync panel. No account is inferred for them. An account's
server pull builds its own cache. The inventory movement cache similarly adds
`account_id`; old rows remain unattributed and new movement keys include the
account to avoid cross-account ID collisions.

Every main sync-pull apply command receives the initiating central account ID.
Its Rust commit path checks that ID against the active local session under an
immediate SQLite transaction, preventing a late response from being written
to another account's cache. Separate inventory, movement, and resource
server-cache writes now require the expected account too; their desktop callers
capture user and token before the request. Finance's three-cache pull is one
transaction. The account-switch state/cursor test, all Rust tests, and desktop
TypeScript check pass.

Remaining: a real two-account running-app exercise and recovery/export UI for
unattributed legacy cache and movement rows. Other local tables and media files
outside `sync_state` and the movement cache require a separate isolation audit.
Direct API write fallbacks still require the planned offline-first cleanup.
Knowledge, engineering, search, assistant, and report surfaces also still need
the same record visibility review.

### 4. Extend offline synchronization safely

Visibility must be in synchronized payloads. A pull response must also tell a
desktop to remove records it can no longer access; ordinary deletion tombstones
are not sufficient for that case.

For Notes, the authoritative `visible_note_ids` snapshot is the revocation
contract. Other domains may use either that pattern or a user-specific
revocation feed, provided neither leaks restricted record identifiers.

The desktop removes the record, dependent cache entries, and any local search
index projection in one SQLite transaction. It must not create an outbox
deletion for an access-revocation cleanup.

### 5. Verify via a route and sync matrix

For each domain, test lab/project/restricted records against viewer, ordinary
member, project editor, explicitly granted user, revoked user, and admin.
Cover REST, search, assistant, exports, sync pull, sync push, restart, and
local-cache revocation.

## Non-negotiable implementation rules

- No client-side visibility check is a security boundary.
- Do not make direct server fallbacks from failed local writes.
- Do not send a restricted record, its content, or a revealing tombstone to an
  unauthorized desktop.
- Do not change existing records from `lab` visibility without an explicit
  migration/administrator action.
- Every visibility or grant change must be audited.
- Every migration must be tested against a disposable PostgreSQL database and
  existing local desktop state.
