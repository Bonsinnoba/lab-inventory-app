# LabOS Local Backend Capability Matrix

This document is the contract for deciding what the workstation Local LabOS Backend owns.

## Topology

```
Desktop UI
   ↓
Local LabOS Backend
   ↓
SQLite

Local LabOS Backend
   ⇅
Sync Engine
   ⇅
Central LabOS Backend
   ↓
PostgreSQL
```

The desktop must not connect directly to PostgreSQL.

## Classification

### Local-first

These domains are expected to remain usable without the central server and persist workstation changes locally before synchronization:

- authentication/session/bootstrap;
- workstation preferences;
- inventory;
- projects and project workspace data;
- project tasks;
- project experiments, measurements and observations;
- project BOM data;
- project canvas blocks/connectors;
- project task↔experiment links;
- project work attachments metadata;
- notes and revisions;
- knowledge records/findings/results/relationships;
- locations;
- resource metadata, links, folders, tags and associations;
- finance transactions;
- budget periods;
- funding sources;
- engineering calculations and tests;
- local/global search over locally owned data.

A local-first operation must not silently fall through to PostgreSQL merely because connectivity exists.

### Central-only

These capabilities require central infrastructure and remain unavailable offline:

- media acquisition/downloads;
- yt-dlp;
- FFmpeg processing/conversion;
- central media/file storage;
- media download workers/jobs;
- cross-workstation aggregation;
- central reports/exports that require global data;
- automation/jobs;
- collaboration/notifications that depend on the central service;
- AI assistant execution;
- server administration/system health;
- central audit/operational administration;
- central user/permission administration;
- central Excel/report processing where the source data is not locally available.

When disconnected, the UI must report the central dependency clearly rather than pretending the operation succeeded.

### Hybrid / sync-mediated

These capabilities have local records or local projections but require the central server for some parts:

- resource/media workflows: metadata can be local; actual file/media acquisition and processing are central;
- synchronization: local outbox/pull state is local, while authoritative cross-workstation reconciliation is central;
- search: local search covers workstation-owned records; central search may provide explicitly central/global information;
- project/resource relationships whose metadata is local but whose underlying media/file is central;
- dashboards and operational views: local projections are used offline; central aggregation is used when global data is required;
- finance summaries/Excel outputs when they depend on central/global datasets.

## Route parity rule

For every workstation-owned central route, the Local LabOS Backend must expose an equivalent domain operation with:

1. matching request/response semantics where practical;
2. matching validation and business invariants;
3. SQLite persistence;
4. sync/outbox representation for mutations;
5. pull/merge/tombstone handling;
6. deterministic offline behavior.

The implementation may use Rust/Tauri IPC during the migration, but the desktop API must treat that IPC as the Local LabOS Backend boundary rather than as a collection of page-specific fallbacks.

## Current migration state

Existing `local_*.rs` modules are the first implementation of the Local LabOS Backend. They are not separate product domains.

Remaining central routes must be audited against this matrix before they are considered complete. Operations requirements currently require deliberate local persistence/sync work before they can be classified as fully local-first. Engineering calculations, tests, formula definitions and formula execution now have a local runtime; calculation/test records synchronize through the central backend.

## Non-negotiable boundary

```
Desktop ─X→ PostgreSQL
Desktop ─X→ central media services for local CRUD
Local Backend ─→ SQLite
Local Backend ⇄ Sync Engine ⇄ Central Backend
Central Backend ─→ PostgreSQL
Central Backend ─→ yt-dlp / FFmpeg / central storage
```
