# LabOS Phase 3 Visual Blockers: Run 20261015T204138Z-visual-01

Author: LABOS-VISUAL-AGENT
Run ID: 20261015T204138Z-visual-01
Date: 2026-10-15
Review status: AWAITING PRIMARY REVIEW

---

BLOCKER ID: BLOCKER-20261015T204138Z-01
AGENT / RUN ID: LABOS-VISUAL-AGENT / 20261015T204138Z-visual-01
PHASE 3 SCOPE SECTION / PHASE 2 DEPENDENCY ID: Assistant panel and composer / Phase 2 C1 (Validated, persisted editable assistant proposals; retry/regenerate identity)
SCREEN / COMPONENT: Assistant Panel / `AssistantChat.tsx`
FILE / FUNCTION / LINE: `desktop/src/components/AssistantChat.tsx` : `sendMessage` : L60-L65
DESIRED VISUAL RESULT: Distinct visual styles and controls for "Retry failed request" and "Regenerate response", each bound to versioned message history without layout jumps.
OBSERVED CURRENT BEHAVIOR: `AssistantChat` only tracks a flat `ChatMessage[]` with `role` and `content`. There are no message IDs, request UUIDs, version counters, or retry/regeneration handlers. When an error occurs, error text is stored in an alert box with no retry action callback.
MISSING DATA, STATE, PROP, CALLBACK OR CONTRACT: Stable conversation message IDs, request UUIDs, version tracking, and a retry/regenerate API contract separating transport replay from deliberate LLM re-prompting.
WHY A VISUAL-ONLY CHANGE CANNOT SOLVE IT: Adding visual Retry/Regenerate buttons without functional handlers would create inert production controls or duplicate messages without idempotency guards.
PROPOSED LOGIC CHANGE (recommendation only): Primary agent to implement C1 message identity: extend `ChatMessage` with `{ id: string; version: number; status: 'sent' | 'streaming' | 'failed' | 'done' }` and add `retryMessage(id)` / `regenerateMessage(id)` callbacks.
OPTIONS AND THEIR PROS / CONS:
- Option A: Add dummy visual buttons that call `sendMessage()` again with old text. (Con: Violates handoff rules; risks duplicating messages and billing).
- Option B (Recommended): Hold visual buttons in runtime code; provide visual styling rules and report logic dependency until C1 contracts land.
RECOMMENDATION: Adopt Option B.
INDEPENDENT VISUAL WORK THAT CAN CONTINUE: Context badge placement, redundant footer removal, jump menu navigation popover, and reduced-motion CSS.
ACTUAL LOGIC CHANGE MADE: NONE
STATUS: BLOCKED — LOGIC DEPENDENCY; PRIMARY DECISION REQUIRED

---

BLOCKER ID: BLOCKER-20261015T204138Z-02
AGENT / RUN ID: LABOS-VISUAL-AGENT / 20261015T204138Z-visual-01
PHASE 3 SCOPE SECTION / PHASE 2 DEPENDENCY ID: Assistant panel and composer / Phase 2 C3 (Audio-focus coordinator) & C4 (Consented provider transcription & microphone lifecycle)
SCREEN / COMPONENT: Assistant Panel / `AssistantChat.tsx`
FILE / FUNCTION / LINE: `desktop/src/components/AssistantChat.tsx` : L137
DESIRED VISUAL RESULT: Microphone button with active recording waveform/pulse, explicit stop/cancel buttons, editable transcript preview box, and audio-ducking indicator.
OBSERVED CURRENT BEHAVIOR: `AssistantChat.tsx` contains no microphone element, no MediaRecorder/WebAudio hooks, and no speech recognition integration.
MISSING DATA, STATE, PROP, CALLBACK OR CONTRACT: Phase 2 C3 device audio-focus coordinator and C4 consented server transcription endpoint and recording lifecycle state.
WHY A VISUAL-ONLY CHANGE CANNOT SOLVE IT: Any UI microphone toggle requires hardware microphone access, audio arbitration, consented transcription, and privacy safeguards that are strictly functional/security concerns outside visual scope.
PROPOSED LOGIC CHANGE (recommendation only): Primary agent to deliver C3/C4 audio coordinator and transcription hook before mounting production microphone controls.
OPTIONS AND THEIR PROS / CONS:
- Option A: Implement mock browser SpeechRecognition in frontend. (Con: Unreliable in Tauri WebViews, violates consented transcription contract and visual-only boundary).
- Option B (Recommended): Document C3/C4 blocker; keep production composer clean of non-functional audio buttons.
RECOMMENDATION: Adopt Option B.
INDEPENDENT VISUAL WORK THAT CAN CONTINUE: Input auto-resizing, bottom-left context badge, navigation jump menu.
ACTUAL LOGIC CHANGE MADE: NONE
STATUS: BLOCKED — LOGIC DEPENDENCY; PRIMARY DECISION REQUIRED

---

BLOCKER ID: BLOCKER-20261015T204138Z-03
AGENT / RUN ID: LABOS-VISUAL-AGENT / 20261015T204138Z-visual-01
PHASE 3 SCOPE SECTION / PHASE 2 DEPENDENCY ID: Assistant panel and composer / Phase 2 C1 (Validated editable proposals) & C2 (Human acceptance of proposal graphs)
SCREEN / COMPONENT: Assistant Panel / `AssistantChat.tsx`
FILE / FUNCTION / LINE: `desktop/src/components/AssistantChat.tsx` : `readAloud` / `exportToNotes` : L67-L69
DESIRED VISUAL RESULT: Visual cards displaying structured project/task/experiment proposals with effect summaries, validation badges, and "Review draft" actions.
OBSERVED CURRENT BEHAVIOR: Assistant operates strictly in `read-only` mode (`can_modify_data: false`). Streamed model responses are plain markdown text. No structured proposal event (`event: proposal`) exists in the streaming parser.
MISSING DATA, STATE, PROP, CALLBACK OR CONTRACT: Server proposal schema validation, proposal data models, draft persistence in local SQLite/outbox, and approval mutator functions.
WHY A VISUAL-ONLY CHANGE CANNOT SOLVE IT: Proposals represent prospective database writes. Visual agent is strictly forbidden from fabricating data or modifying business write paths.
PROPOSED LOGIC CHANGE (recommendation only): Primary agent to deliver C1 proposal generation and C2 human acceptance workflows.
OPTIONS AND THEIR PROS / CONS:
- Option A: Render sample proposal cards with inert buttons. (Con: Confuses users into thinking drafting is functional; violates Section 5).
- Option B (Recommended): Keep truthful Read-Only badge in production; provide design specification in reports.
RECOMMENDATION: Adopt Option B.
INDEPENDENT VISUAL WORK THAT CAN CONTINUE: All general transcript styling, context scope picker, and composer layout polish.
ACTUAL LOGIC CHANGE MADE: NONE
STATUS: BLOCKED — LOGIC DEPENDENCY; PRIMARY DECISION REQUIRED

---

BLOCKER ID: BLOCKER-20261015T204138Z-04
AGENT / RUN ID: LABOS-VISUAL-AGENT / 20261015T204138Z-visual-01
PHASE 3 SCOPE SECTION / PHASE 2 DEPENDENCY ID: Resources and Downloads visual polish / Phase 2 A4 (File/thumbnail availability) & A6 (Download worker/copy reconciliation)
SCREEN / COMPONENT: Downloads & Resource Previews / `DownloadsPage.tsx`, `VideoResourcePoster.tsx`, `DownloadResourcePreview.tsx`
FILE / FUNCTION / LINE: `desktop/src/pages/DownloadsPage.tsx`, `desktop/src/components/VideoResourcePoster.tsx`
DESIRED VISUAL RESULT: Consistent cards/rows, readable queue states, and stable thumbnail containers.
OBSERVED CURRENT BEHAVIOR: These files currently have dirty uncommitted functional modifications and untracked files by the primary agent working on A6 native confirmation and PC-copy presentation.
MISSING DATA, STATE, PROP, CALLBACK OR CONTRACT: Coordination / commit of current working tree slice by primary agent.
WHY A VISUAL-ONLY CHANGE CANNOT SOLVE IT: Modifying these files risks colliding with or clobbering the primary agent's active in-flight work.
PROPOSED LOGIC CHANGE (recommendation only): Primary agent completes and commits the A6 download slice. Visual agent will then polish the committed baseline.
OPTIONS AND THEIR PROS / CONS:
- Option A: Edit `DownloadsPage.tsx` concurrently. (Con: High risk of merge conflicts and breaking primary agent's verification).
- Option B (Recommended): Exclude `DownloadsPage.tsx` and poster/preview components from our visual allowlist until primary agent commits.
RECOMMENDATION: Adopt Option B.
INDEPENDENT VISUAL WORK THAT CAN CONTINUE: Batches 1, 2, 3, and 4 (Assistant, Users, Inventory/Projects, and Dashboard/Operations/Reports/Collaboration).
ACTUAL LOGIC CHANGE MADE: NONE
STATUS: BLOCKED — SHARED FILE COLLISION GUARD; PRIMARY ACTION REQUIRED

---

BLOCKER ID: BLOCKER-20261015T204138Z-05
AGENT / RUN ID: LABOS-VISUAL-AGENT / 20261015T204138Z-visual-01
PHASE 3 SCOPE SECTION / PHASE 2 DEPENDENCY ID: Integrated project experience / Phase 2 B3 (Canonical links between projects, reservations, inventory custody)
SCREEN / COMPONENT: Project Detail Overview / Resource Reservation
FILE / FUNCTION / LINE: `desktop/src/pages/ProjectDetailPage.tsx`, `backend/src/routes/projects.js` : `POST /:id/reservations`
DESIRED VISUAL RESULT: Multi-item checkable resource selection interface where users check needed resources and input quantity beside each checked item.
OBSERVED CURRENT BEHAVIOR: Current UI allows reserving a single resource item at a time. The backend endpoint `POST /api/projects/:id/reservations` accepts a single payload `{ item_id, quantity, notes, needed_by }`.
MISSING DATA, STATE, PROP, CALLBACK OR CONTRACT: Atomic batch reservation endpoint (e.g. `POST /api/projects/:id/reservations/batch`), partial failure handling semantics, transactional rollbacks, and offline write-path/outbox sync support for multi-item sets.
WHY A VISUAL-ONLY CHANGE CANNOT SOLVE IT: Handoff rules strictly state: "Do not restructure forms in ways that change submission or button behavior" and "New reusable component contracts or prop/callback changes that require callers to supply new functional information... report these for primary implementation". Firing parallel uncoordinated `POST` calls from a visual loop without atomic transactional semantics risks partial state corruption and sync outbox conflicts.
PROPOSED LOGIC CHANGE (recommendation only): Primary agent to implement `POST /api/projects/:id/reservations/batch` accepting `items: Array<{ item_id: string; quantity: number }>` in a single SQLite/PostgreSQL transaction.
OPTIONS AND THEIR PROS / CONS:
- Option A: Fire multiple uncoordinated individual reservation requests via Promise.all in UI. (Con: Violates handoff rules; risks partial failures where half the items succeed and half fail without rollback; desynchronizes offline outbox).
- Option B (Recommended): Maintain current single-item reservation contract; document architectural proposal and wait for primary agent backend implementation.
RECOMMENDATION: Adopt Option B.
INDEPENDENT VISUAL WORK THAT CAN CONTINUE: Project Context card placement at bottom of Overview, BOM inventory match ranking, and Notebook selective read aloud.
ACTUAL LOGIC CHANGE MADE: NONE
STATUS: BLOCKED — LOGIC DEPENDENCY; PRIMARY DECISION REQUIRED

---

BLOCKER ID: BLOCKER-20261015T204138Z-06
AGENT / RUN ID: LABOS-VISUAL-AGENT / 20261015T204138Z-visual-01
PHASE 3 SCOPE SECTION / PHASE 2 DEPENDENCY ID: Media and Accessibility / Phase 2 C3 (Device audio-focus coordinator)
SCREEN / COMPONENT: Notebook / `NotebookPage.tsx`
FILE / FUNCTION / LINE: `desktop/src/pages/NotebookPage.tsx` : `handleReadAloud` : L149-L195
DESIRED VISUAL RESULT: Read aloud controls with play, pause, resume, stop, and selective reading integrated into native app audio focus (ducking/pausing music or media playback across the entire app).
OBSERVED CURRENT BEHAVIOR: `NotebookPage.tsx` uses browser-level `window.speechSynthesis`. Unlike `AssistantChat.tsx` which dispatches `labos:pause-music` custom events, `NotebookPage` lacks native audio arbitration with background audio player or system audio focus.
MISSING DATA, STATE, PROP, CALLBACK OR CONTRACT: Phase 2 C3 device audio-focus coordinator providing centralized audio session arbitration across TTS, media playback, and video resource viewers.
WHY A VISUAL-ONLY CHANGE CANNOT SOLVE IT: Centralized audio focus arbitration requires Tauri native audio session management and coordination across disparate components and background media workers, which is outside visual scope.
PROPOSED LOGIC CHANGE (recommendation only): Primary agent to provide a unified `useAudioPlayback` hook or central audio coordinator event bus connecting all TTS and media players to the Tauri audio coordinator.
OPTIONS AND THEIR PROS / CONS:
- Option A: Add ad-hoc custom DOM events in NotebookPage. (Con: Fragile, doesn't address native OS audio arbitration).
- Option B (Recommended): Implement client-side Web Speech pause/resume/stop and selective reading in NotebookPage UI; report global audio arbitration dependency to primary agent.
RECOMMENDATION: Adopt Option B.
INDEPENDENT VISUAL WORK THAT CAN CONTINUE: All client-side TTS controls, selection extraction, and UI buttons.
ACTUAL LOGIC CHANGE MADE: Implemented client-side Web Speech pause, continue, stop, and text selection reading in `NotebookPage.tsx` without touching native audio layers.
STATUS: LOGIC REPORTED — PRIMARY DECISION REQUIRED FOR NATIVE ARBITRATION

