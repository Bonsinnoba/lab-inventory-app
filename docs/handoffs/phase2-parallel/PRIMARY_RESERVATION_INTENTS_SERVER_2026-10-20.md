# Primary implementation — reservation intent server contract

Identity: primary agent, not a helper delivery. Date: October 20, 2026.
Phase 2 IDs: B3/B4, supporting B1. Source-only; not deployed.

- MODULE: project reservation requests and confirm/reject/release decisions.
- FILE: `backend/src/routes/sync.js`; regression harness
  `backend/src/custody-sync-live-probe.mjs`.
- CURRENT WRITE PATH: new `project_reservation` events, operations `request` and
  `decision`, through existing push broker, immutable receipt and transaction.
  Desktop request/decision controls still use their old HTTP paths; not converted.
- WHY IT BYPASSES OFFLINE-FIRST: these operations previously had no sync apply
  contract. HTTP request generated a server identity; HTTP decisions and audit
  were not covered by the new immutable outbox receipt transaction.
- RISK: duplicate requests after uncertain success, repeated approvals, partial
  audit/state success, permission changes between offline authoring and replay.
- RECOMMENDED CHANGE: explicit stable reservation/change IDs; current authority
  checks; item-first locking; reservation, audit and receipt in one transaction.
- ACTUAL CHANGE MADE: new sync handler normalizes copies of IDs without mutating
  receipt payloads, validates dates/positive thousandth quantities/notes, stamps
  requester/reviewer from the current actor, and checks active database role and
  project authority. Requests require a lead/owner/admin with edit authority;
  decisions require admin. Closed projects cannot receive new requests or
  confirmations. Confirmation checks physical stock and existing allocations,
  retaining existing equipment-period overlap versus consumable rules. Release
  changes allocation status only, never returns stock or settles custody. Existing
  same-identity requests with a new change ID fail rather than silently succeeding.
  Audit is mandatory and transactional; post-commit duplicate audit is skipped
  for this entity. Receipts remain minimal acknowledgements, not cached authority.
- VERIFICATION: final complete real existing PostgreSQL handler batch **20 PASS /
  0 FAIL**, including six new request/review cases. Tests cover exact replay,
  receipt-failure rollback, no physical stock movement, foreign project, inactive
  account, current non-admin role, closed project, invalid quantities/dates and
  competing sequential allocations. Test rows and schema changes rolled back;
  syntax and diff whitespace checks pass. The first run exposed missing request
  context in the audit call; fixed and reran the complete batch (19, then 20 cases).
- STATUS: server contract implemented and focused checks passed; native request/
  decision outbox persistence, projection, UI wiring and integrated acceptance
  remain CODE REMAINING. Neither B3 nor B4 is closed.

## Boundaries and next implementation

The harness loads current source into the running container without replacing
deployed files. It invokes real handlers against real PostgreSQL with nested
savepoints in one outer rollback transaction. This is not HTTP/auth-middleware
or simultaneous multi-connection testing. The pg concurrency deprecation warning
comes from project-pull Promise.all queries on the harness's shared connection;
no concurrent-client guarantee is inferred from this test.

No native/offline code changed in this batch, so no new stopped-API desktop test
is claimed. No restart, migration deployment, reset, reseed or user-data deletion.
Existing API/database remain running.

Next: save native request/review intentions atomically with their outbox events;
preserve them across refresh/restart/ACK and rejection. A queued confirmation must
remain an intention, never effective offline stock authority. Request IDs survive
retries; pending requests remain distinguishable from server-reviewed allocations.
Then wire existing controls to native commands and test with the API stopped,
followed by reconnect and actual competing-client verification. Existing direct
HTTP parity and consumption/lifecycle work remain open. No new owner decision.

Full implementation-ready and closed parent counts remain **0/18**; this records
a bounded implementation, not completion of the whole remaining Phase 2 plan.
