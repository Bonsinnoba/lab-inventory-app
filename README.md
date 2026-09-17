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

LabOS is in the **V1 completion and launch-preparation stage**.

The major application areas and core architecture are implemented. Current work is focused on final functional verification, reliability, UI/UX polish, production hardening, and a repeatable release mechanism.

**Current software baseline:** `2.2.1`

The version above identifies the current repository software baseline; it does not mean that V1 has already been publicly released.

## V1 Launch Plan

The remaining launch work is organized into five phases:

1. **V1 Completion** — close remaining functional gaps and verify existing features.
2. **V1 Polish & Hardening** — improve consistency, reliability, security, recovery, and production readiness.
3. **Release System** — establish repeatable versioning, builds, installers, artifacts, checksums, and GitHub releases.
4. **Launch & Real-World Validation** — perform fresh-machine installation and end-to-end testing, then use V1 in real laboratory workflows.
5. **V2 Planning** — use real V1 usage and feedback to define the next major release.

V2 development will be planned separately so it does not destabilize V1.

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
| `README.md` | Product overview and project information |
| `DEVELOPMENT.md` | Technical architecture, development, testing, security, operations, and release information |

For technical setup, development commands, database migrations, synchronization, testing, troubleshooting, and the release mechanism, see [`DEVELOPMENT.md`](DEVELOPMENT.md).

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
