# LabOS

## Laboratory Research & Development Operating System

LabOS is a desktop laboratory operating system for organizing research, engineering projects, experiments, inventory, technical knowledge, resources, finances, and laboratory history in one connected workspace.

**The idea:** keep the laboratory's work connected, searchable, and useful over time.

## What LabOS Provides

- **Projects & Workspace** — organize research and engineering work around projects.
- **Experiments** — record laboratory work, observations, analysis, and results.
- **Inventory** — manage components, equipment, quantities, movements, maintenance, calibration, identification, and history.
- **Resources** — keep images, video, audio, PDFs, text, Markdown, and other supported resources with the work they belong to.
- **Canvas** — visually arrange project information, resources, and engineering material using blocks and connectors.
- **Knowledge & Notebook** — build a long-term technical memory with notes, revisions, references, and research information.
- **Engineering Tools** — common electronics calculations and utilities.
- **Bill of Materials** — manage project component requirements and their relationship to inventory.
- **Financials & Reports** — track project/laboratory financial information, budgets, activity, and reporting.
- **Search & Navigation** — find information across the laboratory and use the command palette for fast navigation.
- **Lab Assistant** — permission-aware, project-aware AI assistance using available laboratory context.
- **Offline-first desktop workflow** — continue working locally when connectivity is unavailable and synchronize when it returns.

## How LabOS Fits Together

```text
                         LabOS
                           │
          ┌────────────────┼────────────────┐
          │                │                │
      Projects         Laboratory        Knowledge
          │             Operations           │
    ┌─────┼─────┐     ┌────┼─────┐      ┌───┴────┐
    │     │     │     │    │     │      │        │
 Tasks Experiments  Inventory Resources Notes References
    │     │     │     │    │     │
    └─────┴─────┴─────┴────┴─────┴──────────────┐
                                                 │
                                           Research history
```

The goal is more than storing records: LabOS preserves the relationships between the things that make up laboratory work.

## Current Status

V1 **2.2.4** is installed for the owner's personal laboratory. V2 development
continues against the approved three-phase plan; Phase 2 is still in progress.
The installed V1 version and the V2 repository development baseline are separate.

## V1 Launch Plan

The current scope, Phase 2 closure items, remaining boundaries and acceptance
rules live in [the central plan](docs/PLAN.md). Earlier five-phase release plans
are retained there as historical material. V1 updates use a coordinated,
data-preserving build and installation procedure.

## Product Direction

LabOS is intended to support the complete research and engineering lifecycle:

```text
Idea
  ↓
Project
  ↓
Plan
  ↓
Experiment / Build
  ↓
Record evidence
  ↓
Analyze
  ↓
Results
  ↓
Knowledge
  ↓
History
  ↓
Future work
```

Future versions may expand experiment reproducibility, intelligent inventory/BOM relationships, document intelligence, advanced search, knowledge relationships, richer AI workflows, hardware integration, automation, and external integrations.

These capabilities will be developed incrementally based on actual laboratory use.

## Desktop Application

LabOS is primarily delivered as a desktop application using Tauri and React. The desktop client supports local/offline work and synchronization with the central server.

At a high level:

```text
LabOS Desktop
      │
      │ API
      ▼
LabOS Backend
      │
      │ SQL
      ▼
PostgreSQL
```

The desktop application does **not** connect directly to PostgreSQL.

## Documentation

| Document | Purpose |
|---|---|
| [Plan and current status](docs/PLAN.md) | Controlling scope, checklist, blockers and next work |
| [Dated work log](docs/WORK_LOG.md) | Changes, primary/helper identities, reviews and verification evidence |
| [Architecture and operations](docs/REFERENCE.md) | Contracts, decisions, audits, development, backup and release guides |

Start with these three documents. Add future dated reports to the work log and
update the corresponding plan item; do not create another per-change Markdown
file. Original documents are preserved in `docs/archive/2026-11-01`, with a
SHA-256 manifest, for historical traceability.

## Project Philosophy

LabOS is built around a few principles:

- Keep laboratory information connected.
- Preserve useful history and context.
- Make important data searchable and reusable.
- Treat data integrity as more important than superficial UI success.
- Enforce authorization at the backend.
- Keep laboratory work usable through connectivity interruptions.
- Make the system useful for both daily operations and long-term research memory.
- Prefer practical workflows over unnecessary complexity.

## License

See the repository license and distribution terms for current licensing information.
