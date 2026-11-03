# Local project context and connected refresh — primary agent — October 27

- MODULE: A3/B3/B4 project context and reservation/review integration.
- FILE: desktop/src/api/context.ts; desktop/src/components/ProjectContextPanel.tsx; desktop/src/api/project-plan-refresh.ts; ProjectReservations.tsx, ProjectPlanningReview.tsx and ReservationCheckoutModal.tsx under desktop/src/components.
- CURRENT WRITE PATH: Existing native repositories/outbox remain unchanged. Project context was a direct HTTP read even on desktop; reservation and review mutation callbacks refreshed only selected consumers.
- WHY IT BYPASSES OFFLINE-FIRST: Read-side server dependency prevented context from working offline despite locally available source records. Narrow invalidation left related project views stale after local saves.
- RISK: Unavailable context while disconnected; related views lag saved intentions. A failed section could otherwise be interpreted as an empty collection or zero stock.
- RECOMMENDED CHANGE: Compose context from existing authorized native readers, require root project access, enforce account-generation checks, use bounded independent section reads, distinguish partial/unavailable sections and local-read time from last server sync. Refresh dependent project views after confirmed local mutations.
- ACTUAL CHANGE MADE: Desktop context uses local project/workspace/inventory/reservation/note/resource readers with no HTTP fallback. Inventory quantities come from inventory records, not project link rows. Unknown/malformed sections are flagged; absent linked inventory rows produce partial status. Browser HTTP path stays unchanged. UI displays local provenance, unknown counts and explicit partial states. Shared project refresh now covers reservation queries and is called by reservation/review/checkout success paths.
- VERIFICATION: 35 focused frontend tests passed, covering local context, root failure, account switching, unavailable/malformed sections, partial inventory, browser transport, plan refresh and existing reservation/review/experiment boundaries. Earlier 12-test attachment/context/refresh batch also passed. These are adapter/unit regressions, not real desktop outage or PostgreSQL acceptance. TypeScript result recorded below when available.
- STATUS: Implemented in source; integrated desktop outage/restart/reconnect acceptance still pending. No V1 deployment, restart, personal data access, migration, outbox rewrite or database mutation.

The local read timestamp is intentionally not a completeness certificate. Durable per-section initial-sync completeness remains part of A3. This bounded correction does not close A3/B3/B4 or the whole phase.

Follow-up safety: a top-level context query failure hides prior context because
it can represent revoked root project access. Partial section failures still
retain the other authorized sections inside a successful response. Background
refresh alone does not clear the view.

TypeScript no-emit check and scoped diff whitespace check passed for the batch.
