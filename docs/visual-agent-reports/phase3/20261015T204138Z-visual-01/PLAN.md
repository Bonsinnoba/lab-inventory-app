# LabOS Phase 3 Visual Plan: Run 20261015T204138Z-visual-01

Author: LABOS-VISUAL-AGENT
Run ID: 20261015T204138Z-visual-01
Date: 2026-10-15
Review status: AWAITING PRIMARY REVIEW

## 1. Agent Identity & Baseline Audit

- **Contributor Identity**: LABOS-VISUAL-AGENT (visual/presentation contributor working alongside the primary agent).
- **Repository Path**: `C:/Users/balik/Iven/lab-inventory-app`
- **Active Branch**: `main`
- **Base Commit**: `ca875a8` ("still on phase 2")
- **Frontend App / Build Inspected**: `desktop/` using Vite v7.3.6 and TypeScript 5.0.2 (`npm run build` verified: exit code 0, 2248 modules transformed, zero compile errors).
- **Coordination & Working Tree Audit**:
  The working tree contains extensive uncommitted Phase 2 functional implementation by the primary agent. Fresh `git status` check confirms:
  - Modified functional files: `backend/src/{download-job-control,download-queue-create,media-downloads,resource-attachment,resource-attachment.test,routes/media-downloads,routes/sync}.js`, `desktop/src-tauri/src/{local_db,local_downloads,local_resource_attachments,local_resource_authority,local_resource_edits,local_resource_replication,local_resource_uploads,local_resources,main,resource_dependencies}.rs`, `desktop/src/api/{downloads-local,mediaDownloads,resource-dependencies.test.mjs,resource-dependencies,resource-folder-api.test.mjs,resources,sync}.ts`, `desktop/src/components/VideoResourcePoster.tsx`, `desktop/src/pages/DownloadsPage.tsx`, and audit documentation `docs/audits/{OFFLINE_FIRST_WRITE_PATH_AUDIT,PHASE2_DELIVERY_CHECKLIST,PHASE2_EVIDENCE}.md`.
  - Untracked functional files: `backend/src/{download-queue-http*,download-worker-access*,download-worker-state*,media-process*,media-tool-status*,migrations/20261014_download_worker_attempt.sql,resource-confirmation*,resource-metadata*}`, `desktop/src/api/{download-device-state*,download-enqueue-retry*,media-download-tools*,resource-confirmation*}`, `desktop/src/components/{DownloadResourcePreview.tsx,download-resource-preview.test.mjs}`.
  - **Shared file collision rule**: ALL above dirty and untracked files are strictly excluded from our allowlist. We will NOT touch, reset, stash, revert, format or modify any of these files.
  - **Baseline resolution**: We remain on the working tree to preserve the functional foundations compiled in `desktop/`, but restrict our work strictly to clean, presentation-only files that have zero collisions with the ongoing Phase 2 work.

## 2. Proposed Exact File Allowlist

Only the following files are proposed for visual/presentation edits across all batches:

1. `desktop/src/components/AssistantChat.tsx`
2. `desktop/src/styles/ui2.css`
3. `desktop/src/pages/UsersPage.tsx`
4. `desktop/src/pages/ItemDetailPage.tsx`
5. `desktop/src/components/InventoryMovementPanel.tsx`
6. `desktop/src/components/AddItemModal.tsx`
7. `desktop/src/components/ProjectPlanningReview.tsx`
8. `desktop/src/components/ProjectReservations.tsx`
9. `desktop/src/components/ProjectBomPanel.tsx`
10. `desktop/src/pages/DashboardPage.tsx`
11. `desktop/src/pages/OperationsPage.tsx`
12. `desktop/src/pages/LabIntelligencePage.tsx`
13. `desktop/src/pages/ReportsPage.tsx`
14. `desktop/src/pages/CollaborationPage.tsx`
15. `desktop/src/components/ReadAvailabilityNotice.tsx`
16. `desktop/src/pages/ProjectDetailPage.tsx`
17. `desktop/src/pages/NotebookPage.tsx`

Any file outside this list is strictly forbidden.

## 3. Bounded Visual Batches & Scope Mapping

### Batch 1: Assistant Panel and Composer Polish
- **Phase 3 Scope Section**: Section 2 / Scope Supplement Section 3 ("Assistant as a permissioned planning partner — Phase 3: panel and composer")
- **Phase 2 Prerequisite IDs**:
  - `C1` (Validated, persisted editable assistant proposals — PLANNED)
  - `C2` (Human acceptance of proposal graphs — DEPENDENCY)
  - `C3` (Device audio-focus coordinator — PLANNED)
  - `C4` (Consented provider transcription and microphone lifecycle — DEPENDENCY)
- **Target Files**:
  - `desktop/src/components/AssistantChat.tsx`
  - `desktop/src/styles/ui2.css`
- **Planned Visual Changes**:
  1. Position existing context badge inside the composer input area at bottom-left; clicking it opens the existing context selector dialog; accurately displays current scope.
  2. Remove redundant "Read-only · scoped context" footer text while preserving truthful read-only mode and permission badge (`Read-only` with `ShieldCheck` icon). Context is not authority.
  3. Replace the left-edge jump markers (`assistant-response-nav`) with a compact internally scrollable response jump menu popover accessed via a dedicated navigation control, with click/focus, Escape dismissal, focus return, and smooth scrolling to the target prompt/response.
  4. Restrained CSS transitions, eliminate layout jumps with assistant sidebar open, and add `@media (prefers-reduced-motion: reduce)` support.
- **Logic Dependency / Boundary Notice**:
  - `AssistantChat.tsx` currently lacks backend handlers and state for message retry/regeneration, microphone recording/speech recognition, and proposal drafting/acceptance. As mandated in Section 5 of the handoff, we will NOT add inert fake production buttons for microphone or fake accept buttons for proposals. These logic dependencies will be formally recorded in `BLOCKERS.md`.

### Batch 2: Users and Permissions Redesign
- **Phase 3 Scope Section**: Section 2 / Three-Phase Plan Phase 3 ("Users/permissions redesign: compact directory with assistant sidebar open; centered, accessible add/edit/granular-permission modals")
- **Phase 2 Prerequisite IDs**:
  - `C6` (Authorized cached users/permission/settings views — PARTIAL)
  - `A1` (Native account/lease/project/record permission coverage — PARTIAL)
- **Target Files**:
  - `desktop/src/pages/UsersPage.tsx`
- **Planned Visual Changes**:
  1. Compact directory table layout that fits comfortably without clipped edges when the assistant right sidebar is open (e.g. 660px available width at 1280px screen resolution).
  2. Centered, bounded modal presentation for Add User (`max-w-md`) and Manage User / Permissions (`max-w-4xl`), max height 85vh, internal scrolling, accessible header/footer action areas.
  3. Restrained, clean 2-column grid for permission overrides with distinct inherited/grant/deny visual states; eliminate oversized controls and clipping.
  4. Preserve 100% of existing permission gates (`can('users.view')`, `can('users.create')`, `can('users.manage_permissions')`).

### Batch 3: Inventory, Projects, Custody and Valuation Distinction
- **Phase 3 Scope Section**: Section 2 / Scope Supplement Sections 1, 4, 5 ("Salvage workflow presentation", "Quantity-aware custody experience", "Integrated project experience")
- **Phase 2 Prerequisite IDs**:
  - `B1` (Quantity custody ledger — PLANNED)
  - `B2` (Quarantined salvage, inspection and reviewed recovery valuation — DEPENDENCY)
  - `B3` (Canonical links between projects, BOM, requirements, reservations, tasks, experiments, canvas — PARTIAL)
  - `B4` (Project cancellation/closure propagation — PARTIAL)
- **Target Files**:
  - `desktop/src/pages/ItemDetailPage.tsx`
  - `desktop/src/components/InventoryMovementPanel.tsx`
  - `desktop/src/components/AddItemModal.tsx`
  - `desktop/src/components/ProjectPlanningReview.tsx`
  - `desktop/src/components/ProjectReservations.tsx`
  - `desktop/src/components/ProjectBomPanel.tsx`
- **Planned Visual Changes**:
  1. In `ItemDetailPage.tsx` and `InventoryMovementPanel.tsx`, present the responsible person clearly as administrative responsibility, distinct from physical custody (which requires recorded physical movements).
  2. In `ItemDetailPage.tsx` and `AddItemModal.tsx`, clearly distinguish reviewed recovery/replacement value from purchase cash/expense.
  3. In `ProjectReservations.tsx`, `ProjectBomPanel.tsx`, and `ProjectPlanningReview.tsx`, clarify that reservations allocate provisional reservation status rather than deducting physical stock, and that BOM preferred/alternative lines are planning references. Ensure bounded heights and compact responsiveness with the assistant sidebar open.

### Batch 4: Dashboard, Operations, Lab Intelligence, Reports, Collaboration Polish
- **Phase 3 Scope Section**: Section 2 / Scope Supplement ("Show available authorized sections with last-sync time and stale/pending/incomplete status. Explain unavailable sections. Never substitute zero for unknown totals.")
- **Phase 2 Prerequisite IDs**:
  - `A3` (Durable initial-download completeness, last sync, pending status for Dashboard, Operations, Lab Intelligence, Reports, Collaboration — PARTIAL)
- **Target Files**:
  - `desktop/src/pages/DashboardPage.tsx`
  - `desktop/src/pages/OperationsPage.tsx`
  - `desktop/src/pages/LabIntelligencePage.tsx`
  - `desktop/src/pages/ReportsPage.tsx`
  - `desktop/src/pages/CollaborationPage.tsx`
  - `desktop/src/components/ReadAvailabilityNotice.tsx`
- **Planned Visual Changes**:
  1. Responsive grid adaptations across all overview pages so metric cards and sections reflow cleanly when the assistant sidebar is docked.
  2. Visual hierarchy improvements for `ReadAvailabilityNotice` and stale/partial state presentation (truthful "—" for missing values, clear status warning borders and typography).
  3. Consistent loading skeletons and empty states across all composite pages without altering any data fetching or query keys.

### Batch 5: Project Context Layout, BOM Inventory Match Ranking, and Notebook Selective Read Aloud
- **Phase 3 Scope Section**: Section 2 / Scope Supplement Section 5 ("Integrated project experience: overview/BOM/reservations/tasks/experiments") & Assistant/Media accessibility polish
- **Phase 2 Prerequisite IDs**:
  - `B3` (Canonical links between projects, BOM, requirements, reservations, tasks, experiments — PARTIAL)
  - `C3` (Device audio-focus coordinator — PLANNED)
- **Target Files**:
  - `desktop/src/pages/ProjectDetailPage.tsx`
  - `desktop/src/components/ProjectBomPanel.tsx`
  - `desktop/src/pages/NotebookPage.tsx`
- **Planned Visual Changes**:
  1. Relocate Project Context card on the Project Detail Overview tab to the bottom, directly after the Next Tasks and Experiments cards.
  2. In BOM component editor/creator, re-arrange inventory selection dropdown options so items matching the entered component name or part number/SKU are scored and sorted to the top of the list with distinct `★` and `(Matching)` tags.
  3. In Notebook, enhance Read Aloud with Play/Pause/Resume and dedicated Stop controls; add selective text reading where highlighting a portion of the note text reads only that selection, falling back to reading the entire note if nothing is highlighted.
- **Logic Dependency / Boundary Notice**:
  - Multi-item checkable resource reservation requested by user requires batch reservation API support on backend (`POST /api/projects/:id/reservations/batch`), atomicity, and offline write-path consensus. Isolated as `BLOCKER-05` in `BLOCKERS.md`.

## 4. Verification Strategy

- Run `npm run build` (`tsc && vite build`) after each batch to ensure zero TypeScript errors or bundle breakage.
- Test responsive viewports: 1280x720, 1440x900, 1920x1080 with assistant panel open (width 380px) and closed.
- Verify focus rings, keyboard navigation (Escape dialog/popover closing), reduced motion CSS, and no white screens or layout jumps.
- No database mutations, no Docker commands, no resetting of dirty tree files.
