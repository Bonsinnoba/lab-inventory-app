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

### Phase 1 execution record — 2026-09-27
- Inspected backend/src/schema.sql: base transactions table defines created_at but does not define updated_at. Removed the unverified t.updated_at reference from standard transaction SELECT in commit 011fc09. Full migration inventory still needs confirmation; the query now works without that optional column.
- Finance GET list and summary now reuse req.permissions from hasPermission middleware rather than performing an independent override read after the middleware active-account check (commit 50929f0). Both grants are still required for sensitive finance.
- Neither change is verified by fresh CI or real PostgreSQL integration at time of writing. Obtain actual failed-job logs and run security baseline, backend syntax check and PostgreSQL route tests. Do not close Phase 1 prematurely.

### Consolidated Phase 1 audit pass — 2026-09-27
Implemented on main:
- d31a202: global search removes project budget from ordinary search results, expands ordinary cross-project search, and limits standard financial search to expenses.
- 98ff54a: corrects contiguous SQL parameters for sensitive financial search.
- 0b60ea3: full transaction Excel export now requires both financial read grants.
- 3674a50: detailed bulk-purchase Excel export now requires both financial read grants.
- d624972 and e29019f: funding-source and budget-period GET routes now require both financial read grants.
- 3111086: finance sync pull applies transaction projection and suppresses sensitive deletion tombstones for standard viewers; project sync pull includes all ordinary projects and applies financial projection.
- 9b50a05: project sync budget mutations require finance.edit, unauthorized owner assignment is rejected, and income sync changes require both financial read grants.
- 6b929cb: sync mutation responses (including replayed idempotency responses) project finance-sensitive data by caller permissions.
- 36ec32e and 1cc9578: additional projection and source-invariant regression tests.

Evidence and remaining acceptance gaps:
- Source inspection confirmed authenticateToken checks current database is_active and role on every request; this is not a substitute for HTTP role-matrix tests.
- Source-level checks added, but no fresh GitHub Actions run results, local npm installation, or real PostgreSQL integration results were accessible from this session. CI status must remain UNVERIFIED. No independent Codex execution was available; Codex must review this commit set.
- Review all remaining inventory, operations, context, reports and engineering endpoints for financial side channels, and review offline sync desktop compatibility with newly projected fields. Verify legacy idempotency replay behavior and financial Excel import transactional audit logging.
- The full five-phase plan remains sequential. Phase 1 is NOT COMPLETE until the above acceptance gaps are closed with evidence.
