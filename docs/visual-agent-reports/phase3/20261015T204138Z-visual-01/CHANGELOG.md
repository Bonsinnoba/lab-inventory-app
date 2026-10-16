# LabOS Phase 3 Visual Changelog: Run 20261015T204138Z-visual-01

Author: LABOS-VISUAL-AGENT
Run ID: 20261015T204138Z-visual-01
Date: 2026-10-15
Review status: AWAITING PRIMARY REVIEW

## Format
Entries are append-only. Each entry records:
- Change ID
- Date
- Files and Line Anchors
- Before vs. After description
- Reason / Design Rationale
- Preserved Functional Behavior & Permission Gates
- Verification Reference
- Review Status

---

## Change VIS-01: Assistant Composer & Navigation Visual Polish

- Date: 2026-10-15
- Batch: Batch 1 (Assistant Panel and Composer)
- Files & Lines:
  - `desktop/src/components/AssistantChat.tsx` : L2, L40-L55, L84, L124-L143
  - `desktop/src/styles/ui2.css` : L45-L48
- Before vs. After:
  - Before: Left edge of transcript contained a fixed column of sticky jump markers (`assistant-response-nav`) that hovered preview tooltips over messages. Context selection was only accessible via the header dropdown. Bottom of the composer contained redundant static text "Read-only · scoped context".
  - After: Left edge markers removed from transcript for a clean, non-colliding reading layout. Context selector badge placed at bottom-left inside composer input area showing current scope; clicking opens the context modal. Accurate "Read-only" badge preserved. Dedicated navigation menu button in composer toolbar opens a compact, internally scrollable menu listing all responses with prompt text, index numbers, smooth scrolling on select, click-outside dismissal, Escape key handling, and focus return.
- Design Rationale:
  - Matches Phase 3 composer specifications: compact layout usable with assistant sidebar at standard widths (280px-380px), keyboard navigable, and supporting reduced motion.
- Preserved Behavior:
  - No change to `sendMessage`, streaming logic, `apiFetch`, context state management, or query caching.
  - Truthful `Read-only` permission indicator preserved.
- Verification Reference:
  - `desktop/` production build `npm run build` passed (exit code 0, 10.05s).
- Review Status: VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW

---

## Change VIS-02: Users Directory & Centered Permission Modal Redesign

- Date: 2026-10-15
- Batch: Batch 2 (Users and Permissions Redesign)
- Files & Lines:
  - `desktop/src/pages/UsersPage.tsx` : L14-L35, L184-L215, L260-L310
- Before vs. After:
  - Before: Permission override modal was oversized (`h-[90vh] max-w-6xl`) with large controls, full-width permission rows wasting horizontal space, and potential clipping when the assistant sidebar is open. User directory table had tall row padding (`py-3.5`) and large avatars.
  - After: Modal replaced with a centered, bounded dialog (`max-h-[88vh] max-w-4xl` for permissions, `max-w-md` for user creation) with internal scrolling and reachable action footer. Directory table cells compacted to `px-4 py-2.5` with `h-8 w-8` avatars and a restrained `min-w-[560px]` baseline. Permissions presented in a compact 2-column grid with clear visual status indicators (grant in subtle emerald tint, deny in rose tint, inherited neutral).
- Design Rationale:
  - Aligns with Phase 3 UI specifications: compact directory/table, clear existing role/status presentation, restrained filters/actions, and centered, bounded add/edit modals instead of right drawers or oversized modals. Eliminates left-edge and right-edge clipping when the 380px assistant sidebar is open.
- Preserved Behavior:
  - Preserved all permission gates: `users.view`, `users.create`, `users.manage_permissions`.
  - Preserved `handleRoleChange`, `handlePermissionChange`, `handleCreateUser`, form submissions, dialog dismissals, and role hierarchy logic.
  - Truthful status indicators (`active`, `suspended`, `grant`, `deny`, `inherited`) accurately reflect backend-supplied state.
- Verification Reference:
  - `desktop/` production build `npm run build` passed (exit code 0, 15.09s).
- Review Status: VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW

---

## Change VIS-03: Inventory & Project Screens Custody & Valuation Distinction Polish

- Date: 2026-10-15
- Batch: Batch 3 (Inventory, Projects, Custody and Value Distinction)
- Files & Lines:
  - `desktop/src/pages/ItemDetailPage.tsx` : L132-L175, L225-L245
  - `desktop/src/components/InventoryMovementPanel.tsx` : L25-L75
  - `desktop/src/components/AddItemModal.tsx` : L32, L36
  - `desktop/src/components/ProjectPlanningReview.tsx` : L22-L28
  - `desktop/src/components/ProjectReservations.tsx` : L21, L34
  - `desktop/src/components/ProjectBomPanel.tsx` : L93-L97
- Before vs. After:
  - Before:
    - Item detail lacked explicit visual distinction between administrative assignment ("Assigned To") and physical storeroom custody; unit cost and replacement cost were editable but absent from the read view; transaction history did not distinguish cash outflows from non-cash valuation records.
    - Movement panel did not clearly highlight stock direction (inflow vs outflow vs relocation).
    - Add item modal lacked clarity that replacement value is a non-cash valuation record.
    - Project planning review presented review status as plain text without semantic chips.
    - Project reservations did not clearly distinguish provisional logical reservation from physical stock deductions.
    - BOM panel showed unstyled status text for stock availability.
  - After:
    - `ItemDetailPage`: "Assigned Custodian" clearly labeled with clarifying subtitle "(Administrative custodian · Not a physical deduction)"; added read-only Unit Cost and Replacement / Salvage Value cards explicitly indicating "(Estimated recovery / replacement valuation · Not cash received)"; transactions list items tagged with clear "Cash / Allocation Inflow" vs "Actual Cash Outflow" pills.
    - `InventoryMovementPanel`: Header clarifies physical on-hand stock vs administrative assignment; movement history features colored direction badges (Inflow green, Outflow rose, Relocation neutral).
    - `AddItemModal`: Fieldset hints and labels clarify that unit cost is purchase expense whereas replacement cost is estimated recovery valuation (not cash received).
    - `ProjectPlanningReview`: Review status styled with semantic badge chips (approved green, submitted amber, changes_requested rose).
    - `ProjectReservations`: Header clarifies provisional allocation vs physical storeroom issue; reservation entries feature styled status pills ("Confirmed Allocation · Not yet deducted physically", "Pending Admin Review", etc.).
    - `ProjectBomPanel`: Stock coverage styled as distinct emerald/rose status pills with explicit physical stock counts.
- Design Rationale:
  - Satisfies Phase 3 design rules: distinguishes assignment from physical issue, recorded recovery value from cash received, and provisional logical allocation from physical storeroom issue, maintaining strict truthful presentation.
- Preserved Behavior:
  - All form submission handlers, mutations, API calls, query invalidations, and validation rules remain completely unchanged.
  - No calculations altered; no quantities invented or derived.
- Verification Reference:
  - `desktop/` production build `npm run build` passed (exit code 0, 14.28s).
- Review Status: VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW

---

## Change VIS-04: Operations, Lab Intelligence, Reports & Collaboration Polish

- Date: 2026-10-15
- Batch: Batch 4 (Dashboard, Operations, Lab Intelligence, Reports, Collaboration Polish)
- Files & Lines:
  - `desktop/src/components/ReadAvailabilityNotice.tsx` : L1-L20
  - `desktop/src/pages/OperationsPage.tsx` : L65
  - `desktop/src/pages/CollaborationPage.tsx` : L2, L40-L43
- Before vs. After:
  - Before:
    - `ReadAvailabilityNotice` lacked visual iconography and hierarchy when separating snapshot timestamp from missing/partial sections.
    - `OperationsPage` overview displayed stock value without explicit clarity on recorded acquisition value vs cash on hand.
    - `CollaborationPage` local activity snapshot banner was a plain unstyled box without visual icon alignment.
  - After:
    - `ReadAvailabilityNotice` styled with `Clock` icon for local snapshot read time and `AlertCircle` icon with border divider for missing/partial sections, reinforcing truthful offline availability.
    - `OperationsPage` stock value metric detail updated to explicitly clarify: `"Recorded acquisition value · Not cash"`.
    - `CollaborationPage` snapshot notice enhanced with `Clock` icon and surface styling consistent with `ReadAvailabilityNotice`.
- Design Rationale:
  - Aligns with Phase 3 guidance to preserve truthful offline, snapshot, and security states, distinguishing unknown versus zero, local saved intent versus server acknowledgement, and recorded value from cash received.
- Preserved Behavior:
  - All availability derivations, error fallbacks, pagination, query keys, polling intervals, and mutation handlers preserved exactly as-is.
- Verification Reference:
  - `desktop/` production build `npm run build` passed (exit code 0, 12.60s).
- Review Status: VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW

---

## Change VIS-05: Project Context Card Placement & BOM Inventory Match Sorting

- Date: 2026-10-15
- Batch: Batch 5 (Project Context, BOM Match, and Notebook Polish)
- Files & Lines:
  - `desktop/src/pages/ProjectDetailPage.tsx` : L64-L68, L95-L105
  - `desktop/src/components/ProjectBomPanel.tsx` : L102-L130, L174, L245
- Before vs. After:
  - Before:
    - Project context panel (`<ProjectContextPanel projectId={project.id}/>`) was rendered at the very top of the Overview tab, above the metric cards and Next Tasks / Experiments sections.
    - BOM inventory item selector dropdown rendered available inventory items in arbitrary default database order without ranking based on what component or part number was entered in the form.
  - After:
    - `ProjectDetailPage`: Moved `<ProjectContextPanel projectId={project.id}/>` to the bottom of the Overview tab, placed directly after the Next Tasks and Experiments grid.
    - `ProjectBomPanel`: Added `getSortedItems(componentName, partNumber)` ranking function. Inventory items whose name, part number, or SKU match words in the entered component name or part number are scored, sorted to the top of the select list, and badged with `★` and `(Matching)`. Unmatched items follow in alphabetical order. Applied to both the Add Component and Edit Component forms.
- Design Rationale:
  - Overview layout puts immediate operational signals (metrics, next tasks, experiments) first, with contextual background placed after.
  - BOM item selection provides intuitive, immediate visibility into suitable parts matching the component name/SKU without manual scrolling or searching through large inventories.
- Preserved Behavior:
  - All form state (`form`, `editForm`), submission mutations (`createMutation`, `updateMutation`), query cache keys, and validation logic remain 100% unchanged.
  - Project context props and query subscriptions remain unchanged.
- Verification Reference:
  - `desktop/` production build `npm run build` passed (exit code 0, 10.94s).
- Review Status: VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW

---

## Change VIS-06: Notebook Selective Read Aloud with Pause, Continue, and Stop

- Date: 2026-10-15
- Batch: Batch 5 (Project Context, BOM Match, and Notebook Polish)
- Files & Lines:
  - `desktop/src/pages/NotebookPage.tsx` : L3, L38, L147-L195, L358-L374
- Before vs. After:
  - Before: Read aloud button was a single toggle that read the entire note from the beginning using Web Speech API, or stopped playback. It could not pause/resume, and could not read only a selected portion of the note.
  - After:
    - Selective Reading: `handleReadAloud` inspects the body textarea selection (`bodyRef.current.selectionStart !== bodyRef.current.selectionEnd`). If text is highlighted, only the highlighted text is read aloud; if no text is highlighted, it falls back to reading the full note title and body.
    - Pause / Continue: When speaking, clicking the Read Aloud button calls `window.speechSynthesis.pause()` and displays a `Play` icon to indicate "Continue reading". Clicking again calls `window.speechSynthesis.resume()`.
    - Dedicated Stop Button: While speaking or paused, a dedicated `Square` stop button appears in the toolbar calling `window.speechSynthesis.cancel()` to cleanly terminate playback and reset states.
- Design Rationale:
  - Provides rich, accessible note review experience allowing researchers to listen to specific passages, pause during note-taking, and resume without losing place or re-reading the entire document.
- Preserved Behavior:
  - Note saving, tag editing, symbol picker, voice dictation, deletion, mutations, and query state remain completely untouched.
  - Uses standard Web Speech API without external dependencies or native permission escalations.
- Verification Reference:
  - `desktop/` production build `npm run build` passed (exit code 0, 10.94s).
- Review Status: VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW

---

## Change VIS-07: Notebook Note Editor Double Scrollbar Elimination

- Date: 2026-10-15
- Batch: Batch 6 (Visual Bug Fixes: Experiments Sizing & Notebook Scrollbar)
- Files & Lines:
  - `desktop/src/pages/NotebookPage.tsx` : L401-L409
- Before vs. After:
  - Before: Note editor container had `flex-1 overflow-y-auto p-6` wrapping `<textarea className="w-full h-full min-h-[300px] resize-none ...">`. Because both the parent wrapper div and the textarea had scroll capability, long notes rendered **two vertical scrollbars** side-by-side on the right edge (one outer scrollbar at the edge of the card, and one inner scrollbar inset by 24px padding).
  - After: Replaced the wrapper with a non-scrolling flex container (`flex-1 min-h-0 flex flex-col`) and moved padding (`p-6`) and scrolling (`overflow-y-auto`) directly onto the `<textarea className="w-full flex-1 min-h-0 p-6 ... overflow-y-auto">`.
- Design Rationale:
  - Completely eliminates duplicate scrollbars. Provides a single, clean scrollbar along the right inner border of the editor card, while maintaining 24px of comfortable text margins.
- Preserved Behavior:
  - `bodyRef` still references the textarea element; text selection, symbol insertion, auto-save, dictation, and selective read aloud remain 100% operational without behavioral changes.
- Verification Reference:
  - `desktop/` production build `npm run build` passed (exit code 0, 29.12s).
- Review Status: VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW

---

## Change VIS-08: Project Detail Experiments Responsive Layout & Measurements/Observations Input Protection

- Date: 2026-10-15
- Batch: Batch 6 (Visual Bug Fixes: Experiments Sizing & Notebook Scrollbar)
- Files & Lines:
  - `desktop/src/pages/ProjectDetailPage.tsx` : L110-L113
- Before vs. After:
  - Before:
    - Experiments tab grid used `grid lg:grid-cols-2 gap-4`. When the assistant sidebar was open (taking ~380px at 1280px resolution), each experiment card was restricted to ~410px width.
    - Inside `ExperimentCard`, Measurements and Observations were ALSO in `grid lg:grid-cols-2 gap-4`, forcing Measurements into ~195px width.
    - Inside Measurements, inputs used `grid grid-cols-3 gap-1`, squeezing Name, Value, and Unit inputs to ~55px width each where placeholders were cut off to single letters ("N", "V", "U").
    - Observations input was compressed to ~140px, clipping "Record an observation…".
    - Attachments select was compressed to ~100px, clipping "Attach resource…".
  - After:
    - Experiments outer grid updated to `grid grid-cols-1 2xl:grid-cols-2 gap-4`, ensuring experiment cards have full tab width on standard laptop/desktop widths (1024px–1440px) with the assistant sidebar docked.
    - Top bar updated to `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2` to prevent button/dropdown overflow.
    - Inside `ExperimentCard`, Measurements and Observations use `grid grid-cols-1 md:grid-cols-2 gap-4`, and Measurements inputs use `grid grid-cols-1 sm:grid-cols-3 gap-1.5` with `text-xs py-1.5 px-2 min-w-0`, preventing horizontal input clipping.
    - Observations input and Add button use `flex-1 min-w-0` and compact padding.
    - Attachments select dropdown and Attach button use `flex-1 min-w-0` and compact styling, preventing text truncation.
- Design Rationale:
  - Aligns with Phase 3 responsive guidelines: eliminates nested 2-column grid traps that squish inputs when the assistant sidebar is open, ensuring all labels, placeholders, and buttons remain fully readable and operable.
- Preserved Behavior:
  - All experiment creation, repetition, update, and deletion mutations (`create`, `repeat`, `edit`, `del`, `addM`, `delM`, `addO`, `delO`, `attach`, `detach`) and state hooks remain 100% untouched.
- Verification Reference:
  - `desktop/` production build `npm run build` passed (exit code 0, 29.12s).
- Review Status: VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW

---

## Change VIS-09: Assistant Header Layout Polish (Context Removal, Borderless Three-Dots, Tight Close Pairing)

- Date: 2026-10-16
- Batch: Batch 7 (Assistant Header Polish)
- Files & Lines:
  - `desktop/src/components/AssistantChat.tsx` : L90-L100
- Before vs. After:
  - Before:
    - Assistant header subtitle included redundant text `· Context: {scopeLabels[context.scope]}`.
    - Three-dots options button had a box border and background (`border border-border bg-surface-raised`), and sat with a wide gap away from the close button.
    - Three-dots dropdown menu included redundant "Context controls" menu item (which duplicate the dedicated interactive context badge at the bottom-left inside the input composer).
  - After:
    - Removed `· Context: {scopeLabels[context.scope]}` from the header subtitle, leaving a clean connection/model status line.
    - Removed "Context controls" menuitem from the three-dots dropdown menu, leaving clean "New conversation" and "Conversation history" actions.
    - Removed border and background box from the three-dots button (`border-0`, clean icon button with subtle hover effect `hover:bg-surface-raised` matching the close button).
    - Grouped the three-dots button and close button in a compact container (`flex items-center gap-0.5 shrink-0`), bringing them close together with a tight 2px gap and matching `w-8 h-8` proportions.
- Design Rationale:
  - Eliminates duplicate context indicators (context selection is now cleanly centralized in the composer input area badge). Provides sleek, non-distracting header controls with consistent icon button styling and unified spacing.
- Preserved Behavior:
  - Truthful `Read-only` badge with `ShieldCheck` icon remains in the header.
  - Clicking the composer context badge at bottom-left continues to open the context configuration modal (`setShowContext(true)`).
  - All conversation state, streaming, history loading, and clear handlers preserved.
- Verification Reference:
  - `desktop/` production build `npm run build` passed (exit code 0).
- Review Status: VISUAL IMPLEMENTATION — AWAITING PRIMARY REVIEW






