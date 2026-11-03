# LabOS Offline-First Database Architecture

## Status

Architecture foundation and the first local inventory repository boundary are established on `main`.

The target architecture is:

```text
                 CENTRAL SERVER
        LabOS Backend + PostgreSQL
                       ▲
                       │ Sync/API
                       │
        ┌──────────────┼──────────────┐
        │              │              │
      PC A           PC B           PC C
     SQLite          SQLite         SQLite
      LabOS           LabOS          LabOS
```

Each desktop installation must remain usable without internet access. PostgreSQL is the shared central database; SQLite is the local working database for each desktop installation.

## Current state

The existing backend is PostgreSQL-specific. `backend/src/db.js` creates a `pg.Pool`, and the API routes query PostgreSQL directly. The existing migration history also contains PostgreSQL-specific features such as UUID generation, `TIMESTAMPTZ`, arrays, JSONB, GIN indexes, views, PL/pgSQL functions and triggers.

The desktop now has a local SQLite foundation and a first local inventory repository. Application-wide migration to SQLite is **not** complete yet.

## Local SQLite responsibilities

SQLite will become the desktop application's working store for data that the user needs while offline.

### Local-first data

- inventory items and inventory metadata
- inventory movements
- maintenance records
- purchases and purchase batches/lines
- project data
- project tasks and experiments
- project item allocations
- notes and note revisions
- resources and resource metadata
- resource versions/attachments metadata
- knowledge/discovery data
- local activity/history needed by the user
- locally generated reports and derived values

### Local sync infrastructure

Every desktop database contains:

- `device_identity` — stable identifier for the installation
- `sync_state` — synchronization cursors/state
- `sync_outbox` — durable local operations waiting to reach the server
- `local_schema_migrations` — SQLite-specific schema versioning

The outbox is deliberately introduced before full synchronization. Local writes will eventually commit the business change and its corresponding outbox record in the same SQLite transaction.

## PostgreSQL responsibilities

The central PostgreSQL database remains authoritative for shared/server state:

- users and authentication state
- roles and permission definitions
- server-side authorization policy
- centrally synchronized laboratory data
- cross-device history
- central audit trail
- global configuration
- server-side derived/reporting views where useful

User/permission state may be cached locally so the desktop can continue operating offline, but changes to authorization policy originate from the server and are synchronized to clients.

## Synchronization model

Do not synchronize mutable totals as the primary operation where possible.

For example, an inventory action should be represented as an operation such as:

```text
change_id
 device_id
 entity_type = inventory_movement
 entity_id
 operation = create
 payload = movement details
 created_at
```

The server can then apply the operation idempotently and derive/update the shared inventory state.

This is safer than sending:

```text
current_quantity = 117
```

because two offline devices can otherwise overwrite each other's work.

Every synchronization operation therefore needs a stable idempotency key (`change_id`). Retrying the same operation after a network failure must not duplicate the business action.

## Inventory local repository foundation

The desktop now has a SQLite-specific inventory module at `desktop/src-tauri/src/local_inventory.rs`.

It provides:

- a local inventory item table
- a local append-oriented movement table
- local inventory listing
- controlled item upsert for hydration/bootstrap
- atomic inventory quantity adjustment
- movement recording in the same transaction as the quantity update
- a durable `sync_outbox` record in that same transaction
- stable `change_id` and movement identifiers generated locally
- validation preventing zero adjustments and negative resulting quantities

The important transaction boundary is:

```text
SQLite transaction
  ├─ update local quantity
  ├─ append inventory movement
  └─ enqueue sync operation
       ↓
     COMMIT
```

If the transaction fails, none of those three effects should be committed.

`current_quantity` is retained as a local working value for fast reads, while movement operations are the synchronization facts. The future server sync layer should transmit the movement operation rather than treating a local quantity snapshot as the business operation.

## Excel workflows

Excel import/export remains a first-class feature.

Imports must be capable of completing offline:

```text
Excel file
   ↓
local parse + validation
   ↓
preview
   ↓
SQLite transaction
   ↓
business records + sync outbox
   ↓
server synchronization when online
```

A failed internet connection must not invalidate a successfully validated local import.

## Data categories

| Area | Local SQLite | Central PostgreSQL | Sync model |
|---|---|---|---|
| Inventory | Yes | Yes | Operations/events |
| Stock movements | Yes | Yes | Append-oriented operations |
| Purchases | Yes | Yes | Transaction/batch operations |
| Finance transactions | Yes | Yes | Ledger operations |
| Projects | Yes | Yes | Entity changes + membership |
| Tasks/experiments | Yes | Yes | Entity changes |
| Notes | Yes | Yes | Versioned/entity changes |
| Resources | Yes | Yes | Entity + metadata/version operations |
| Knowledge | Yes | Yes | Entity changes; local search index |
| Users | Cached | Authoritative | Server → client |
| Roles/permissions | Cached snapshot | Authoritative | Server → client |
| Audit trail | Local pending events | Authoritative central record | Append-only sync |
| Reports | Derived locally | Derived centrally where needed | Usually no direct sync |
| Search indexes | Local | Central | Rebuildable/derived |

## SQLite-specific design

The desktop SQLite database uses WAL mode for local concurrency and crash-safe transactional behavior. SQLite supports foreign keys and full-text search through FTS5, so the local implementation does not need to abandon relational integrity or search functionality.

The local schema should be designed independently from PostgreSQL-specific DDL. Do **not** attempt to execute the existing PostgreSQL migration files against SQLite.

Instead:

```text
PostgreSQL migrations          SQLite migrations
        │                              │
        ▼                              ▼
central schema                  local schema
        │                              │
        └──────── shared logical model ┘
```

The logical entities remain aligned, while engine-specific DDL is allowed to differ.

## PostgreSQL-specific features that require deliberate mapping

The current migration history includes features that cannot simply be copied into SQLite:

- `UUID` + `gen_random_uuid()`
- `TIMESTAMPTZ`
- PostgreSQL arrays such as `TEXT[]`
- `JSONB`
- GIN indexes
- `TSVECTOR` / `to_tsvector`
- PL/pgSQL functions
- PostgreSQL triggers
- PostgreSQL views and casts
- PostgreSQL-specific locking/query syntax

For SQLite, use portable logical representations where appropriate:

- UUIDs stored as canonical text values
- ISO-8601 timestamps stored as text
- JSON stored as JSON text
- tags stored as normalized child rows or JSON where justified
- FTS5 for local full-text search
- application-level timestamp/update handling where a trigger is unnecessary
- portable SQL for repository queries

## Repository/data-layer rule

The React UI must not know whether data comes from SQLite or PostgreSQL.

The intended boundary is:

```text
UI
 ↓
LabOS data/repository API
 ↓
local SQLite adapter
 ↓
sync engine
 ↓
LabOS backend API
 ↓
PostgreSQL adapter
```

The desktop should therefore stop growing direct assumptions about PostgreSQL response formats and SQL behavior.

## Implementation sequence

1. Keep the existing PostgreSQL backend working.
2. Introduce the local SQLite database foundation. **Done.**
3. Define the canonical logical entity/operation contracts. **Inventory operation boundary started.**
4. Build SQLite migrations for the local working schema. **Inventory local schema foundation started.**
5. Move inventory first because it is the clearest offline-first workload. **Repository foundation started; UI migration remains.**
6. Add purchases and Excel imports.
7. Add projects/notes/resources/knowledge.
8. Add the durable sync engine and server idempotency handling.
9. Add central-to-local synchronization for shared changes.
10. Remove unnecessary desktop dependence on the local HTTP PostgreSQL-backed API.
11. Keep PostgreSQL as the central shared database.

## Non-goals

This architecture change does **not** mean:

- replacing PostgreSQL with SQLite on the server
- running PostgreSQL on every user's PC
- copying the entire PostgreSQL database file to each PC
- making the desktop directly connect to PostgreSQL
- implementing conflict resolution before the operation model exists
- duplicating business logic into unrelated local and server implementations

The goal is one LabOS application with a local transactional working copy and a durable synchronization boundary.
