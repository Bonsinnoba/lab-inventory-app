# Phase 2 — salvage outbox audit atomicity

Identity: LABOS-P2-PRIMARY. Bounded implementation report; no helper work
attribution and no Phase 2 parent closure claimed.

MODULE: Salvage recovery synchronization (A1/A2/B2 audit and recovery boundary).

FILE: `backend/src/routes/sync.js`; existing audit writer
`backend/src/middleware/audit.js`; salvage mutation module
`backend/src/salvage-intents.js` (read-only for this change).

CURRENT WRITE PATH: The desktop queues salvage create, batch, inspection and
release intents through the native outbox. `/sync/push` starts a PostgreSQL
transaction, applies the salvage mutation, stores `sync_idempotency`, and commits.
The route previously wrote the generic audit row only after that commit.

WHY IT BYPASSES OFFLINE-FIRST: The mutation itself is offline-first, but audit
confirmation was detached from its authoritative server transaction. An audit
database error could leave an applied server mutation and success receipt even
though the required audit event was absent. A retry would then replay the receipt
and could not recreate that missing audit event.

RISK: Salvage provenance, review and stock-release history may be incomplete while
sync reports the change as successfully applied. This is especially serious for a
released recovery that creates/credits stock.

RECOMMENDED CHANGE: Write a required salvage audit row with the same PostgreSQL
client before inserting/committing the idempotency receipt. Let any audit failure
abort both the domain write and receipt. Keep idempotent replay from writing a
second event. Do not expand this bounded change to all generic sync writers.

ACTUAL CHANGE MADE: `/sync/push` now calls `writeAuditLog` with its transaction
client and `required: true` for `salvage_recovery`, before inserting the sync
receipt. The generic post-commit audit is skipped for that entity, so successful
first application produces one atomic audit event and matching replay produces
none. Other sync entity paths retain their current behavior. Legacy direct browser
salvage create/inspect/release routes still have separate audit/transaction gaps;
the current desktop salvage workflow does not use those routes, and they remain
explicitly open for a separate operation-level audit pass.

VERIFICATION: Code-path review only. No tests, API rebuild, migration, deployment,
database write, desktop restart or V1 change was performed in this batch. The
required end-of-phase database verification must inject an audit insert failure
and prove that the salvage mutation and idempotency receipt both roll back; also
verify normal create/inspect/release audit cardinality and replay behavior against
the real development PostgreSQL database.

STATUS: Implemented in source — awaiting grouped Phase 2 verification. B2 remains
PARTIAL; no closure count changed.
