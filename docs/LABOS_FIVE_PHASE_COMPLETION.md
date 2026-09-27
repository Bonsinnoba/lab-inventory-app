# LabOS — five-phase completion ledger

Status as of 2026-09-27. The calculator redesign is owned by the user's collaborator; do not replace it or implement a competing UI. When delivered, integrate the approved redesign into existing LabOS calculation, persistence, permission, and desktop workflows during Phase 4 (or earlier only if required by a dependency).

## Working rules
- Execute in phase order. A phase is complete only after implementation, automated tests, real-environment evidence where required, documented decisions, and independent Codex review.
- Commit on main as authorized; preserve desktop SQLite → authenticated sync/outbox → backend API → PostgreSQL. No desktop-to-PostgreSQL connection.
- Report exact CI run URLs, test commands and outcomes. Never treat an earlier green run as verification of later commits. Record unresolved failures, including the owner's report that most, not all, checks passed.
- Ordinary lab-wide read access applies to active members across projects; financial, audit, and administrative data remain separately gated. Project writes still require existing edit/membership checks.

## Phase 1 — Security, permissions, and financial integrity
Scope: enumerate every financial API, import/export, report, assistant tool, cost-bearing inventory projection, sync response, and mutation echo. Fix permission bypasses, inference through filters, unknown-column leaks, and project-write authorization. Test disabled users, lab-wide ordinary reads, and standard/sensitive finance combinations.
Acceptance: route-level and assistant regression tests for each exposed surface; no known financial leak; independent review. Status: IN PROGRESS. Existing projection and summary fixes landed, but remaining surfaces and current CI failures are unverified.

## Phase 2 — PostgreSQL integration and data integrity
Scope: clean migrations, seeded role matrix, real HTTP integration, transactional rollback, constraints, concurrency, and schema-to-query compatibility. Acceptance: repeatable passing real PostgreSQL test suite with recorded CI evidence. Status: NOT STARTED.

## Phase 3 — Offline-first desktop and synchronization
Scope: SQLite/outbox durability, duplicate replay, interruptions, offline restart, two-client conflicts, permission changes and reconciliation. Acceptance: repeatable multi-client offline-to-online test suite with no unauthorized sync or lost/duplicated writes. Status: FOUNDATION EXISTS; FULL VERIFICATION PENDING.

## Phase 4 — Context Intelligence and laboratory tools
Scope: evidence-linked retrieval, cross-project context, assistant permissions, provenance, context limits, injection defenses, and integration of the collaborator-approved calculator redesign. Do not redesign the calculator without the approved files and integration contract. Acceptance: end-to-end assistant and calculator workflow tests. Status: CONTEXT FOUNDATION EXISTS; CALCULATOR INTEGRATION AWAITS APPROVED REDESIGN.

## Phase 5 — UI/UX and release hardening
Scope: full UI audit, empty/loading/error states, offline indicators, finance field omission, desktop packaging, backup/restore, deployment, documentation and final Codex review. Acceptance: full CI and documented user acceptance on supported desktop environments. Status: NOT STARTED.

## Immediate Phase 1 verification queue
1. Retrieve the failing job logs from the owner's latest CI run and reproduce; avoid declaring all checks passed.
2. Verify actual PostgreSQL transactions schema against explicit standard SELECT fields, including updated_at.
3. Add HTTP role-matrix tests for transaction list/summary, budget-period filters, mutation echoes, assistant financial summary, reports overview and disabled accounts.
4. Audit remaining import/export endpoints and financial side channels; record every route examined and decisions made.
5. Ask Codex to independently reproduce tests and document all findings before closing Phase 1.
