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
