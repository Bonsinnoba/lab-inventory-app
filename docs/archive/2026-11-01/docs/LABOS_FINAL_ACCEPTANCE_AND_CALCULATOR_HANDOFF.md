# LabOS consolidated release and calculator handoff

This document separates implementation from verification. It does not certify a release.

## Final owner acceptance
1. Run both GitHub workflows on the final main commit: LabOS verification and security baseline. Record run URLs, commit SHA, and failed job logs.
2. Confirm PostgreSQL 16 clean migration, second idempotent migration run, schema compatibility, FK/CHECK constraints, rollback and concurrency integration job.
3. Verify active and disabled users, lab-wide ordinary reads, project write membership, standard financial summaries, and dual-grant sensitive finance across search, reports, assistant, exports and sync.
4. On two distinct desktop PCs, create offline changes to the same project and item, restart while offline, reconnect separately, replay identical outbox entries, and check conflict reporting and final central/local state.
5. Check offline indicator, pending sync count, retry behavior, navigation, narrow-screen layout, keyboard focus, empty/error/loading states and recovery after server downtime.
6. Back up both central PostgreSQL and each desktop SQLite database before upgrade. Verify restore to an isolated environment, including file/resource storage. Do not overwrite production with test fixtures.
7. Test desktop installer and upgrades on each supported OS, including preserved SQLite data, outbox and saved resource paths.
8. Confirm calculator integration with the collaborator-approved files before final release. Until then, keep existing calculator functional and do not claim redesigned calculator completion.

## Calculator integration contract
The collaborator's approved files are the design source of truth. Map their components and interactions to existing LabOS calculation APIs, project IDs, persistence, offline SQLite/outbox, permissions, validation and accessibility. Document any required backend/schema changes. Preserve their agreed visual design; do not create a competing redesign. Run existing BOM and Requirements tests plus new approved-calculator interaction and offline/online parity tests.

## Evidence required
Record the final main SHA, all workflow URLs, migration output, test database version, desktop build artifacts, manual test date/OS, unresolved defects, and independent Codex review in docs/LABOS_FIVE_PHASE_COMPLETION.md. Do not label an unexecuted test passed.
