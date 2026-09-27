# Codex review handoff — LabOS Context Foundation (2026-09-26)

## Mandate
Independently inspect the actual code on `main`, challenge assumptions, repair defects in small documented commits, and add automated and real-PostgreSQL tests. Do not claim success based only on TypeScript compilation or backend syntax. Preserve offline-first SQLite → outbox → authenticated Express → central PostgreSQL; never connect desktop directly to PostgreSQL or silently use REST when a local operation fails.

## Implemented first slice
- `backend/src/routes/context.js`: read-only `GET /api/context/projects/:id`, `assembleProjectContext`, access via `getProjectAccess`, bounded project/experiment/task/inventory/reservation/note/resource retrieval, timestamp and provenance.
- `backend/src/index.js`: authenticated context router registration.
- `desktop/src/api/context.ts`: typed central context API.
- `desktop/src/components/ProjectContextPanel.tsx`: live project context summary, linked evidence list and explicit offline/unavailable state.
- `desktop/src/pages/ProjectDetailPage.tsx`: project context panel.
- `backend/src/routes/assistant.js`: new read-only `get_project_context` tool uses the SAME assembler and permission checks; no new write tools.
- All work committed directly to `main`. Latest CI must be checked after documentation commit.

## Mandatory independent review
1. Confirm all SELECT columns and migration prerequisites against the REAL deployed PostgreSQL schema; `schema.sql` is not necessarily the current schema. Run migrations on an isolated test database. Confirm project `priority`, `description`, `updated_at`, experiment `updated_at`, and all reservation tables exist. Check schema drift.
2. Check route ordering and middleware: `/api/context` authentication, per-project permission enforcement, user account deactivation, tenant boundaries if any, and whether any project-linked note/resource has additional ACLs. Adversarially test observer, member, unrelated user, disabled account, and admin.
3. Verify backend `assembleProjectContext` is never exposed as a cross-project data bypass. Test direct API, assistant tool, and frontend; confirm tool availability is correctly filtered by `context` mode. Add tests for invalid UUID, unauthorized access, missing project, empty sections, partial DB failure, and bounded/truncated responses.
4. Verify `ProjectContextPanel` is rendered in the intended project workspace location, works on narrow screens, and does not trigger misleading offline behavior. Invalidate context query after project/inventory/reservation mutations or implement short polling/refetch-on-focus with clear staleness.
5. Check the data minimization policy: notes and resources only expose titles/metadata, no body or private attachment content. Assess whether showing all project-linked resource titles is appropriate for observers. No secrets in assistant tool results or logs.
6. The current `truncated` marker uses `rowCount===LIMIT`, so an exactly full set can be marked truncated. Prefer LIMIT+1 and slice. Context `generated_at` is assembly time, NOT a transactionally consistent snapshot; simultaneous updates across six queries may yield mixed versions. Consider a read-only REPEATABLE READ transaction if required.
7. Validate context payload budgets and source citations. Add stable entity refs, section freshness, per-record source identifiers and eventual semantic search. Do not misrepresent this first slice as a complete graph, semantic retrieval, long-term memory or autonomous agent.
8. Fix any discovered security, performance or correctness problems; document each decision, tests and remaining risk in `docs/REMEDIATION_EVIDENCE_LOG.md`. Include exact commits, workflow run IDs, migrations executed, and real DB test evidence.

## Next architecture milestones after verification
- Typed provenance/relationship registry in PostgreSQL with ACL-aware traversal and immutable source references.
- Hybrid PostgreSQL full-text + optional pgvector retrieval with per-source permissions, indexing worker, benchmark corpus and citation validation.
- Model-independent context orchestrator, task-scoped memory with review/expiry, source-grounded AI evaluation harness and human-approved actions through existing business APIs.
- Equipment checkout/return and PostgreSQL concurrency verification remain independent operational prerequisites.

**Permission:** Codex may directly implement fixes and tests on `main` in small, reviewable commits. Do not introduce a new branch unless the repository owner asks. Record every change, trade-off, test and unresolved issue. Never mark unrun tests as passed.


## Additional review: context relationship projection
Context v2 now derives typed edges from existing project foreign keys and reservation item links in `backend/src/context-relationships.js`. Review the edge vocabulary, source metadata, access inheritance and limit behavior. It is a bounded projection of the context response, NOT a comprehensive persisted knowledge graph; do not infer missing edges. Verify CI includes `src/context-relationships.test.js`. In particular, a relationship may reveal the existence of a project-linked record: confirm per-record ACLs before expanding this projection beyond the currently permission-checked project scope. Assess adding a canonical relation registry, pagination and versioned provenance, then implement real PostgreSQL integration tests. Document every fix and its evidence.


## Additional review: project-scoped lexical evidence retrieval (CHANGE-067)
- New `backend/src/context-evidence.js`: query normalization, bounded limits, source-linked evidence result shaping.
- `backend/src/routes/context.js`: `GET /api/context/projects/:id/evidence?q=...&limit=...` and shared `searchProjectEvidence` helper. Both notes and resources are filtered by exact `project_id` and project access; route requires `projects.view` AND `notes.view`. Read-only, no embedding store. Results include typed source IDs, update timestamps, short excerpts, lexical retrieval method and truncation flag.
- `backend/src/routes/assistant.js`: `search_project_evidence` read-only tool reuses the same helper and requires both permissions. Registered in workspace and lab-data tool groups.
- `backend/src/context-evidence.test.js` and backend CI cover query bounds, access rejection, SQL project scope, result bounds and provenance.

**Codex MUST independently review:** note/resource-specific ACLs beyond project visibility, excerpt disclosure and HTML/plaintext sanitization, whether `notes.view` is sufficient for resources, ILIKE wildcard escaping, matching/ranking quality, query-plan performance on large text, cancellation/timeouts, and multi-query consistency. Verify real PostgreSQL schema columns and migrations; run real DB integration tests with unrelated-project, disabled-user and observer fixtures. Do not claim semantic search or complete source citation coverage. Review retrieval cost, truncation correctness when both sections hit limits, and assistant context-mode tool exposure. Document all fixes and actual test evidence.


## Follow-up review: evidence relevance and literal matching (2026-09-27)
- Independently verify CHANGE-068 literal LIKE escaping, SQL ESCAPE syntax and substring snippets on real PostgreSQL, especially percent, underscore, backslash, Unicode and long whitespace. Check snippet offsets when normalization changes text length; if necessary compute excerpts in application code on bounded candidate rows, without logging full documents.
- Verify no unauthorized note/resource content can leak through assistant evidence tools, snippet fields, error responses or AI tool traces. Benchmark ILIKE query plans and consider full-text indexes; current search remains lexical and project-scoped, not semantic.
- Add database-backed integration tests, inspect migration ordering, and document every correction on main.

## 2026-09-27 follow-up: combined evidence permissions
The HTTP evidence route now additionally requires `resources.view` (commit e29f880) because its results include resource descriptions. IMPORTANT: the assistant tool's permission list and execution check still need the same requirement before this is considered closed. Add regression tests for a user with `notes.view` but denied `resources.view`, covering HTTP and AI tool entry points. Consider separating note and resource retrieval to avoid unnecessarily denying legitimate note-only searches. Validate source-level ACLs and real PostgreSQL SQL ESCAPE behavior. No database integration test or latest-head CI success has been established by this change.

## 2026-09-27 policy implementation: laboratory-wide ordinary reads
Owner decision: every authenticated active laboratory user may read ordinary projects and laboratory data, including nonmember projects; existing role/permission and project membership rules continue to govern edits, deletion, approvals and other writes. Financial records are EXCLUDED from universal visibility: preserve `finance.view`, `finance.view_sensitive` and granular financial write permissions. Never leak financial data through context, search, snippets, reports or assistant tools.

Initial commits: e8aab14 (shared project read resolver), d465d65 (ordinary read middleware allowlist), 6f2e3a1 (assistant parity and resource evidence check), 344badf (policy unit checks). Scope is an initial slice, not a complete cross-application security audit. Codex MUST review existing project listing, project workspace, global search and other routes for independent membership checks; inspect assistant `search_global` for financial leakage and ensure financial-derived project fields are gated. Check disabled accounts, overridden write permissions, nonmember edit denial, observer access, and no mutation from read-only tools. Verify CI and real PostgreSQL fixtures; tests were added but not run in this session. If general reads include independently confidential records, define explicit exceptions rather than silently exposing them. Check whether project read data contains embedded financial fields and redact/gate them. Add permission integration tests for HTTP and assistant entry points.

## Continued financial isolation and lab-wide listing review
Commits 9b6ba7a and eed5f47: remove budget/total_spent from ordinary assistant project search/list/detail; require audit.view for project workspace activity metadata; make project listing lab-wide and use a financial-permission-gated SQL projection; redact financial fields from individual project responses for non-finance viewers. Codex must verify project listing column names against actual migrations, confirm no frontend regression from changed response shapes, and inspect other routes and assistant search for indirect finance exposure. `finance.view_sensitive` remains a distinct policy category; audit whether existing financial routes properly separate sensitive fields rather than assuming finance.view authorizes everything. Real PostgreSQL integration tests and CI status have NOT been verified for these commits. Test disabled accounts, financial deny overrides, nonmember readers, member editors, and project financial summary routes. Inspect query plans and ensure project data contains no additional sensitive fields not included in current redaction.
