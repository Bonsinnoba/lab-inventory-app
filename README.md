# LabOS 2.2.1

## Laboratory Research & Development Operating System

LabOS is a personal laboratory operating system designed to organize electronics research, engineering projects, experiments, laboratory inventory, technical knowledge, resources, financial information, and research history in one integrated application.

LabOS is intended to function as a long-term digital laboratory memory: projects, components, experiments, notes, files, calculations, tasks, decisions, and historical activity remain connected instead of being scattered across separate applications.

---

# 1. Project Vision

The goal of LabOS is to provide a unified environment for laboratory work.

Instead of maintaining separate systems for:

* projects
* inventory
* components
* experiments
* research notes
* documents
* calculations
* tasks
* financial information
* project history
* technical knowledge

LabOS connects these areas into one system.

The long-term objective is for LabOS to become a practical laboratory operating system capable of supporting the complete research and engineering lifecycle:

1. Capture an idea.
2. Create a project.
3. Plan the work.
4. Record experiments.
5. Attach resources and evidence.
6. Track components and equipment.
7. Perform engineering calculations.
8. Record results.
9. Maintain technical knowledge.
10. Track costs and resources.
11. Review project history.
12. Search across the laboratory's accumulated knowledge.
13. Assist the researcher with contextual AI tools.

---

# 2. Current Version

**Version:** 2.2.1

**Current development state:** Functional integrated laboratory platform with the major application modules implemented.

**Track B:** Complete.

Track B was deliberately limited to two development phases:

* B1 — Core UI/UX System
* B2 — Workspace, Canvas & Feature-Screen Polish

The current repository represents the post-Track-B baseline.

---

# 3. Core Architecture

LabOS is organized around a desktop client communicating with a backend API and relational database.

Conceptually:

```text
LabOS Desktop
     |
     | HTTP/API
     v
LabOS Backend
     |
     | SQL
     v
PostgreSQL Database
```

The application also manages laboratory resources/files and integrates those resources with projects, Canvas blocks, notes, experiments, and other entities.

---

# 4. Main Application Areas

## 4.1 Dashboard

The Dashboard provides an operational overview of the laboratory.

It is intended to surface:

* active projects
* important tasks
* inventory information
* activity
* financial information
* research status
* items requiring attention
* useful shortcuts

The Dashboard is the primary high-level operational view.

---

# 5. Projects & Workspace

Projects are the central organizational unit of LabOS.

A project can contain or reference:

* project information
* project status
* collaborators
* tasks
* experiments
* resources
* Canvas blocks
* connectors
* BOM information
* inventory relationships
* notes
* research information
* financial information
* history/audit information

Projects support lifecycle-oriented work rather than functioning only as simple records.

---

# 6. Project Collaboration

Projects support team/collaborator management.

The collaboration system provides:

* project membership
* role-based access
* project-level authorization
* collaboration management
* activity/history information

Authorization is enforced by the backend rather than relying only on frontend visibility.

---

# 7. Canvas / Visual Workspace

The Project Canvas provides a visual workspace for organizing project information.

Canvas functionality includes:

* free-form blocks
* block positioning
* block resizing
* block editing
* connectors
* resource/media references
* persistence
* CRUD operations
* project-scoped access control

Canvas blocks are designed to support visual organization of engineering and research information.

The Canvas architecture uses explicit positional properties rather than the legacy row/column layout model.

---

# 8. Resources & File Management

LabOS supports project and laboratory resources including:

* images
* video
* audio
* PDF documents
* text
* Markdown
* other supported files

Resources can be associated with projects and Canvas blocks.

The resource viewer supports appropriate previews for supported file types.

Resource access is controlled through the backend and resource context rather than exposing unrestricted filesystem access.

Runtime storage is intentionally excluded from source control.

---

# 9. Tasks

Tasks provide project and research work tracking.

Tasks can be associated with projects and used to track work that needs to be performed.

The long-term objective is to connect tasks more tightly with:

* experiments
* resources
* project milestones
* laboratory activity
* automation
* research history

---

# 10. Experiments

Experiments provide a structured place for laboratory research activities.

The intended experiment lifecycle is:

```text
Plan
  |
  v
Prepare
  |
  v
Execute
  |
  v
Record observations
  |
  v
Analyze
  |
  v
Record results
  |
  v
Conclude / iterate
```

Experiments can be connected with projects, resources, notes, tasks, and engineering information.

Future development will strengthen experiment templates and reproducibility.

---

# 11. Inventory

LabOS includes laboratory inventory management.

Inventory functionality includes:

* component/item catalog
* stock quantities
* stock movements
* inventory history
* low-stock awareness
* item information
* maintenance information
* calibration information
* assignment/history
* QR/barcode identification
* item details

The inventory system is intended to represent the physical resources available in the laboratory.

---

# 12. Engineering Tools

LabOS includes engineering calculators and utilities for electronics work.

Current tools include:

* Ohm's Law
* voltage divider
* resistor decoding
* reactance
* LED resistor calculation
* power calculation
* unit conversion

These tools are intended to reduce the need to leave the LabOS environment for common engineering calculations.

Future engineering tools may include:

* additional circuit calculations
* component selection assistance
* engineering reference tools
* instrument integration

---

# 13. Bill of Materials

Projects can maintain a Bill of Materials (BOM).

BOM functionality includes:

* project components
* quantities
* inventory relationships
* alternative components
* component availability

The long-term objective is to make the BOM intelligent enough to answer questions such as:

* Do I already have these components?
* How many are available?
* Which components are missing?
* What alternatives are available?
* What will the project cost?
* Which inventory items should be reserved?

---

# 14. Knowledge Base

LabOS contains a knowledge-management system intended to become the laboratory's accumulated technical memory.

Knowledge can cover:

* technical concepts
* procedures
* references
* component information
* project knowledge
* research notes
* engineering information

Future development will expand relationships between knowledge, projects, experiments, resources, and inventory.

---

# 15. Laboratory Notebook

The Notebook provides a research-oriented place to record observations and technical information.

Notebook functionality includes:

* notes
* note revisions
* revision history
* restoration of previous revisions
* project/context relationships

The long-term goal is to make the Notebook a reliable chronological research record.

---

# 16. Search & Discovery

LabOS includes global search across multiple areas of the application.

Search can cover information such as:

* projects
* inventory
* notes
* resources
* transactions
* users
* tasks
* experiments
* Canvas blocks

The application also includes a global command palette accessible through:

```text
Ctrl + K
```

or the equivalent Command-key shortcut on supported systems.

Future search improvements include:

* fuzzy search
* saved searches
* deeper semantic relationships
* knowledge graph navigation

---

# 17. Lab Assistant / AI

LabOS includes a laboratory assistant designed to provide contextual assistance using information available within the system.

The assistant is designed around:

* permission-aware access
* laboratory context
* project information
* inventory information
* knowledge
* research information
* telemetry/context where available

The assistant should not bypass application permissions.

Future development includes broader AI workflows and configurable external model providers.

---

# 18. Financials

LabOS includes financial management functionality for laboratory/project operations.

Financial features include:

* budgets
* funding sources
* project financial information
* financial tracking
* reporting

Future development can expand financial intelligence and project cost analysis.

---

# 19. Reports & Analytics

LabOS includes reporting and analytics capabilities.

Reports are intended to provide higher-level views of:

* project activity
* inventory
* financial information
* research activity
* operational trends
* laboratory history

The long-term objective is to make LabOS capable of producing useful research and operational summaries.

---

# 20. Automation

LabOS includes automation/reminder functionality.

Automation can be used for operational activities such as:

* reminders
* due items
* scheduled actions
* laboratory follow-up

Future development may expand automation into:

* scheduled research workflows
* maintenance reminders
* inventory alerts
* experiment reminders
* recurring reports
* integrations with external systems

---

# 21. Users, Authentication & Authorization

LabOS uses authenticated users and role-based authorization.

The system supports:

* login
* user profiles
* user management
* roles
* permission enforcement
* project-level access control
* protected backend routes

Security decisions must be enforced by the backend.

The frontend must never be treated as the final authorization boundary.

---

# 22. CRUD Design Principles

LabOS follows a full CRUD lifecycle:

```text
Create
  ↓
Read
  ↓
Update
  ↓
Delete
```

CRUD operations should maintain consistency across:

```text
Frontend
   ↓
API
   ↓
Authentication
   ↓
Authorization
   ↓
Route
   ↓
Database
   ↓
Response
   ↓
Frontend state
   ↓
Reload / persistence
```

A successful toast or HTTP response is not considered sufficient proof that an operation succeeded.

The actual persisted state must be correct.

---

# 23. Error Handling

User-facing errors should be readable and meaningful.

LabOS should never expose raw JavaScript object serialization such as:

```text
[object Object]
```

Errors should communicate:

* what failed
* why it failed when known
* what the user can do next

Frontend state should not display a false success when a backend operation fails.

---

# 24. Audit & History

Important mutations should be traceable.

Audit/history information is intended to support:

* accountability
* debugging
* research history
* project history
* operational review
* security investigation

The long-term objective is comprehensive historical visibility without overwhelming normal users.

---

# 25. Security Principles

LabOS follows these principles:

1. Backend authorization is authoritative.
2. Project-scoped information must respect project access.
3. Shared resources must remain available when appropriate.
4. Unattached resources must not be accidentally destroyed.
5. Referenced resources must be protected against unsafe deletion.
6. Secrets must never be committed to Git.
7. Runtime storage must not be committed to Git.
8. User input must be validated.
9. Database operations must use safe parameterization.
10. Errors should not expose unnecessary sensitive implementation details.

---

# 26. Frontend Design Direction

The LabOS interface follows an engineering-oriented workspace philosophy.

The UI should prioritize:

* clarity
* information density
* fast navigation
* predictable interactions
* readable hierarchy
* responsive layouts
* useful feedback
* minimal unnecessary decoration

The interface should feel like a serious engineering/research tool rather than a generic business dashboard.

Important UX principles include:

* consistent buttons
* consistent forms
* predictable dialogs
* clear destructive actions
* visible loading states
* useful empty states
* readable error states
* keyboard accessibility
* responsive behavior
* consistent spacing and typography

---

# 27. Mobile / Responsive Direction

LabOS is intended to be usable from both:

* laboratory computer
* personal mobile device

The interface therefore includes responsive/mobile navigation and layouts.

Future development will improve:

* touch interactions
* camera workflows
* quick capture
* mobile inventory lookup
* QR/barcode workflows
* compact research entry
* mobile Canvas usability

---

# 28. Data Philosophy

LabOS is intended to become a long-term laboratory memory.

Data should therefore be:

* structured
* relational
* traceable
* searchable
* reusable
* connected
* historically meaningful

Important entities should be related rather than duplicated.

For example:

```text
Project
 ├── Tasks
 ├── Experiments
 ├── Resources
 ├── Canvas
 ├── BOM
 ├── Inventory relationships
 ├── Notes
 ├── Knowledge
 └── Financial information
```

This relational structure is central to the LabOS concept.

---

# 29. Development Status

## Completed / functional

* Foundation and architecture
* Authentication
* Authorization
* Security foundation
* Projects
* Project workspace
* Project collaboration
* Canvas persistence
* Canvas CRUD
* Canvas connectors
* Resource management
* Resource viewer
* Tasks
* Experiments
* Inventory
* Inventory history
* Maintenance
* Calibration
* QR/barcode lookup
* BOM
* Component alternatives
* Engineering calculators
* Knowledge base
* Notebook
* Note revisions
* Global search
* Command palette
* Lab Assistant
* Financials
* Budgets
* Reports
* Analytics
* Automation
* Reminders
* Users
* Settings
* Profile management
* Responsive/mobile foundation
* Track B UI/UX work

---

# 30. Areas Still Requiring Development

The system is functional, but several areas require deeper development before LabOS should be considered mature.

## Projects / Workspace

Future improvements:

* richer research workflow
* stronger project navigation
* improved project lifecycle
* better project summaries
* deeper project relationships

## Canvas

Future improvements:

* advanced interaction
* improved connector workflows
* large-workspace usability
* keyboard shortcuts
* touch interaction
* richer block types
* stronger engineering visualization

## Resources

Future improvements:

* better metadata
* stronger organization
* richer filtering
* improved capture
* automatic document processing
* datasheet extraction

## Tasks & Experiments

Future improvements:

* experiment templates
* reproducibility workflows
* stronger experiment lifecycle
* experiment/task relationships
* structured results

## Inventory & BOM

Future improvements:

* BOM-to-stock intelligence
* automatic availability calculations
* intelligent alternatives
* reservations
* purchasing intelligence

## Knowledge

Future improvements:

* fuzzy search
* saved searches
* semantic relationships
* knowledge graph
* deeper project/experiment connections

## AI

Future improvements:

* external model provider configuration
* richer contextual reasoning
* research assistance
* document analysis
* engineering assistance
* workflow automation

---

# 31. Long-Term Roadmap

The broader LabOS roadmap includes:

1. Advanced project workspace
2. Advanced Canvas
3. Resource intelligence
4. Experiment templates
5. Reproducibility workflows
6. Intelligent BOM/inventory integration
7. Datasheet extraction
8. Knowledge graph
9. Advanced search
10. Project templates
11. Custom dashboards/widgets
12. Expanded AI assistant
13. Offline-first operation
14. Synchronization
15. Automated backup/restore
16. Hardware/instrument integration
17. External integrations
18. Advanced laboratory automation

These should be implemented incrementally based on actual laboratory usage.

---

# 32. Repository Structure

At a high level, the repository is organized around:

```text
lab-inventory-app/
│
├── backend/
│   ├── src/
│   ├── migrations/
│   ├── package.json
│   └── ...
│
├── desktop/
│   ├── src/
│   ├── public/
│   ├── package.json
│   └── ...
│
├── deploy/
│
├── scripts/
│
├── .gitignore
├── README.md
└── package/configuration files
```

Runtime data, dependencies, generated files, secrets, backups, and temporary artifacts should not be part of the source repository.

---

# 33. Development Environment

The primary development environment is Windows PowerShell.

The project location used during development is:

```text
C:\Users\balik\Iven\lab-inventory-app
```

Desktop build:

```powershell
cd desktop
npm run build
```

The desktop build performs TypeScript compilation followed by Vite production bundling.

Backend JavaScript syntax can be checked on Windows with:

```powershell
cd backend
Get-ChildItem .\src -Recurse -Filter *.js |
    ForEach-Object { node --check $_.FullName }
```

The project's Unix-oriented `find | xargs` checking command may not work directly in Windows PowerShell.

---

# 34. Installation Philosophy

Dependencies should be installed from package manifests rather than committed to Git.

For JavaScript dependencies:

```text
package.json
package-lock.json
```

are source-controlled.

The following are not source-controlled:

```text
node_modules/
```

This keeps the repository smaller and allows clean dependency installation on another development machine.

---

# 35. Git Repository Policy

LabOS uses Git as the authoritative source history.

The repository should contain:

* application source
* migrations
* configuration templates
* package manifests
* scripts
* current documentation

The repository should not contain:

* secrets
* `.env` files
* runtime storage
* uploaded files
* databases
* node_modules
* generated builds
* temporary files
* development backups
* installation ZIPs
* obsolete development artifacts

The first Git commit should represent the clean LabOS 2.2.1 baseline.

Recommended initial commit message:

```text
LabOS 2.2.1 - Initial Git Baseline
```

---

# 36. Backup Policy

Backups are important during development but should not be stored inside the Git source tree.

Development backups should be maintained outside the repository.

Git provides source-history protection, while application/database backup procedures should provide operational recovery.

These are separate concerns.

---

# 37. Definition of a Stable LabOS Change

A feature or fix should be considered complete only when:

1. The implementation exists.
2. The backend behavior is correct.
3. Authorization is correct.
4. Database persistence is correct.
5. The frontend reflects the new state.
6. Refreshing the application preserves the expected state.
7. Errors are handled correctly.
8. The application builds successfully.
9. The feature has been physically/manual tested where appropriate.

---

# 38. Current Development Philosophy

LabOS development follows:

```text
Build
  ↓
Test
  ↓
Use
  ↓
Observe
  ↓
Fix
  ↓
Polish
  ↓
Commit
  ↓
Extend
```

Tests support development but do not replace actual product behavior.

Human/manual testing remains important because LabOS is ultimately a physical laboratory tool used during real research and engineering work.

---

# 39. Project Direction

LabOS should continue moving toward a system where laboratory information is connected rather than isolated.

The ideal future workflow is:

```text
Idea
 ↓
Project
 ↓
Planning
 ↓
Tasks
 ↓
Experiments
 ↓
Resources
 ↓
Inventory / BOM
 ↓
Engineering calculations
 ↓
Results
 ↓
Knowledge
 ↓
History
 ↓
Search
 ↓
AI assistance
```

Each stage should reinforce the others.

The objective is not simply to build more screens.

The objective is to build a coherent digital laboratory environment.

---

# 40. Current Baseline

The current baseline is:

**LabOS 2.2.1**

with:

* core architecture implemented
* major laboratory modules implemented
* CRUD stabilization completed
* security/access improvements completed
* resource viewing stabilized
* Canvas persistence stabilized
* Track B frontend/UI/UX completed
* production desktop build passing

The next development work should build on this baseline rather than recreating completed phases.

---

# 41. Final Principle

LabOS is being developed as a long-term laboratory system.

Every new feature should therefore answer three questions:

1. **Does it help the researcher?**
2. **Does it connect correctly with existing laboratory data?**
3. **Will the information remain useful months or years later?**

If the answer is yes to all three, it belongs in LabOS.
#   l a b - i n v e n t o r y - a p p  
 