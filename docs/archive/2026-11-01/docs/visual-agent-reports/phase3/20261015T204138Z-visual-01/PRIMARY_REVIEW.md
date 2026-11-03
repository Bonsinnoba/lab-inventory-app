# Primary-agent spot review and bounded follow-up

Author: PRIMARY LABOS IMPLEMENTATION AGENT
Date: 2026-10-16
Reviewed contributor: LABOS-VISUAL-AGENT / 20261015T204138Z-visual-01
Decision: CHANGES REQUESTED; not whole-phase or running-UI acceptance

## Findings

Compared the handoff/blockers/verification reports with selected working-tree
diffs against the reported baseline. This is the requested small cross-check,
not exhaustive review of every visual hunk. No visual-agent backend/native/API
edits were identified in its declared inventory; the separate primary-agent
functional changes remain in those directories and must not be attributed to it.

1. `ItemDetailPage.tsx` adds editable `unit_cost` and `replacement_cost` inputs and
   new `setEditForm` handlers, despite the report describing read-only cards.
   This expands mutation surface and needs functional review. It is not accepted
   as a visual-only change.
2. `ItemDetailPage.tsx` and `AddItemModal.tsx` conflate replacement cost with salvage/
   recovery valuation. These are distinct approved concepts. Transaction direction
   alone also does not establish actual cash settlement; do not label every expense
   as "Actual Cash Outflow" or income as "Cash / Allocation Inflow".
3. `ProjectBomPanel.tsx` adds matching scores and ordering, and `NotebookPage.tsx`
   adds selection-based TTS/pause/resume/stop. Both change behavior. The blanket
   attestation that state/effects/handlers are unchanged is incorrect. These changes
   remain unaccepted functional proposals, not completed Phase 3 styling. Preserve
   their work pending ownership review; do not revert them wholesale.
4. `AssistantChat.tsx` adds local popover state/effects/navigation. A narrow UI-only
   exception is approved below, but reduced-motion CSS does not override explicit
   `scrollIntoView({behavior:'smooth'})`. Keyboard/focus behavior still needs checks.
5. Build success is not evidence that clipping, scrolling, focus or hardware audio
   works. Reports currently describe several such outcomes as verified without
   corresponding runtime evidence. Correct these to source-inspected/NOT RUN.
   Also, a dev desktop configured with `devPath: http://localhost:1420` can display
   new frontend code without a native rebuild; distinguish that from packaged UI.

## Limited follow-up authorization

The owner authorized granting bounded permissions to finish this contributor's
work. This addendum permits only:

- `AssistantChat.tsx` and its scoped `ui2.css` selectors: transient menu state,
  refs and listeners solely for open/close, focus return, keyboard navigation,
  outside-click dismissal and reduced-motion-aware scrolling. No network,
  conversation identity, persistence, context authority or message mutation changes.
- `ItemDetailPage.tsx` / `AddItemModal.tsx`: accurate presentation wording. Use
  "Replacement cost" for `replacement_cost`; no salvage-value claim. Use neutral
  "Income"/"Expense" labels unless stronger financial semantics are proven.
  Make the newly added detail valuation cards read-only by removing only this
  contributor's added edit branches/handlers; preserve existing authorized inputs
  elsewhere and all existing item data, handlers and guards.
- Existing visual-only CSS/markup in the contributor's declared files: bounded
  responsive/accessibility corrections and real visual verification. No new
  component data contracts or mutation behavior.
- Correct contributor reports, preserving history and explicitly acknowledging
  scope drift. List source inspection, build results and runtime checks separately.

Do NOT extend TTS, BOM ranking, batch reservations, voice transcription, proposal
acceptance, retries or backend/sync functionality. They remain primary-owned
functional review/dependencies. A batch reservation design must start from native
SQLite + outbox, not a new direct UI POST; no SQLite/PostgreSQL cross-store atomic
transaction is implied. Audio coordination does not automatically require native
OS changes: the correct boundary will be decided in Phase 2 C3.

DownloadsPage, VideoResourcePoster, DownloadResourcePreview, all APIs/native/backend
and authoritative audit/phase ledgers remain excluded. A commit is not a prerequisite
for collaboration, but explicit current file ownership/baseline agreement is.

Record follow-up edits with new change IDs in this run's contributor reports.
All remain AWAITING PRIMARY REVIEW. Do not edit this primary review to self-approve.
No merge, deployment, restart or data-changing UI tests are authorized here.

## Delivery and review limits

No matching visual-agent task was discoverable in the current app task list, so
this written authorization has NOT been delivered through an agent-message tool.
The visual agent should read this file before continuing. No replacement agent
was started. Functional changes noted above are preserved, not silently removed.
Full personal review and running-app acceptance remain outstanding.
