# Primary project relationship guards — 2026-10-19

Identity: primary agent, not Helper 1, Helper 2 or the Phase 3 visual agent.
Scope: bounded B3/B4 project relationship and A1 authorization subchecks.
Status: implemented in source; focused verification passed; deployment and
integrated acceptance pending. No parent delivery item is closed.

## Findings and changes

### Canonical requirement references

- MODULE: project tasks, experiments and BOM.
- FILE: `desktop/src-tauri/src/local_projects.rs`; `backend/src/routes/sync.js`.
- CURRENT WRITE PATH: native nested create/update -> project snapshot + outbox ->
  sync push -> PostgreSQL. This path remains unchanged.
- WHY IT BYPASSES OFFLINE-FIRST: no new transport bypass; the defect was incomplete
  relationship validation within the existing local-first path.
- RISK: another project's requirement could be attached; invalid offline work
  could be saved and rejected only later. Repeated references must not create
  additional canonical demand records.
- RECOMMENDED CHANGE: validate same-project membership before local persistence
  and independently on the server; normalize references without mutating receipts.
- ACTUAL CHANGE MADE: native nested writers validate referenced requirements;
  server validates supplied requirement IDs against the owning project. A copy
  of the payload is normalized, leaving the immutable retry payload intact.
  Explicit null unlinks the requirement. Partial updates validate the merged
  stored record. Deletes do not require complete title/name/content fields.
- VERIFICATION: native reference checks; real PostgreSQL push-handler create,
  exact replay, cross-project rejection, unlink and delete for all three entities.
  One shared requirement remains one record. This is NOT verification of aggregate
  demand calculation, reservation fulfillment or stock settlement.
- STATUS: source implemented; deployed UI/offline persistence acceptance pending.

### Stored project ownership and link deletion

- MODULE: project synchronization/access control.
- FILE: `backend/src/routes/sync.js`.
- CURRENT WRITE PATH: outbox push -> project handler -> PostgreSQL.
- WHY IT BYPASSES OFFLINE-FIRST: authorization gap, not a transport bypass.
- RISK: edit/delete could authorize a supplied project rather than the existing
  record's project. A valid pair of local task/experiment endpoints could accompany
  a foreign link ID and delete that unrelated link.
- RECOMMENDED CHANGE: use stored ownership and bind deletions to all endpoints.
- ACTUAL CHANGE MADE: reject project reassignment; derive authorization from the
  existing row; link deletion checks link ID, project, task and experiment before
  writing a tombstone. Native task/experiment links require local same-project
  endpoints. Project/link references accept compact or dashed UUIDs consistently.
- VERIFICATION: real PostgreSQL rejected spoofed project edits/deletes; foreign
  link row remained and no tombstone was written. Native endpoint checks passed.
- STATUS: focused checks passed; full role matrix/HTTP auth/concurrency not tested.

### Canvas connector parity

- MODULE: project canvas.
- FILE: the same native and server project modules.
- CURRENT WRITE PATH: native project snapshot/outbox -> sync -> connector row.
- WHY IT BYPASSES OFFLINE-FIRST: existing update validation/schema mismatch.
- RISK: updates could reference foreign blocks; legitimate updates failed because
  the connector table has no `updated_at` column.
- RECOMMENDED CHANGE: validate both effective endpoints on create and update;
  align update SQL with the existing schema.
- ACTUAL CHANGE MADE: native and server same-project, distinct-endpoint checks;
  connector UPDATE no longer writes the nonexistent timestamp column.
- VERIFICATION: legitimate label update and rejected cross-project create/update
  against actual PostgreSQL, plus native endpoint tests.
- STATUS: focused checks passed; deployed canvas interaction pending.

## Verification record and limits

- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked --offline
  -j 1 local_projects -- --nocapture`: 4 PASS. LabOS API and database were stopped.
  These are pure reference/access tests, not a live desktop or SQLite persistence
  acceptance claim. Native test binary compiled successfully.
- Expanded `backend/src/custody-sync-live-probe.mjs`: final 8 PASS, 0 FAIL against
  existing PostgreSQL. Includes the five prior custody replay/rollback checks.
  Actual push handler and SQL; request/response adapter and nested transaction
  savepoints, not HTTP authentication middleware or parallel clients.
- A completed intermediate batch had 7 PASS / 1 FAIL: connector UPDATE referenced
  missing `updated_at`. Query repaired, then the complete eight-case batch rerun.
- Initial expanded probe also exposed a harness boundary: default audit writes
  used a separate pool and could not see uncommitted fixture users. The probe now
  loads the real audit implementation with its default connection redirected to
  the outer rollback transaction. Production post-commit audit atomicity is NOT
  certified; see remaining work below. No permanent fixture accounts were created.
- Migration DDL and fixtures were inside the rollback-only transaction; fixture
  users/item/receipts and custody-table presence were checked after rollback.
- No deployed source replacement, app restart, database reset, data deletion or
  queued-work retirement. Existing LabOS API/DB containers restored to stopped.
  Docker Desktop itself was started and left running; unrelated containers untouched.

## Explicitly remaining in the existing Phase 2 scope

1. B1/B3 reservation-backed physical issues: validate custody context, consume only
   the matching allocation, protect other reservations, and preserve provisional
   local reservation state through pulls and retries. Current checkout still
   protects the full reserved-stock floor, including its own reservation.
2. Reservation request/review/fulfillment paths are still direct online APIs;
   complete the agreed local intent/outbox architecture, not error-to-HTTP fallbacks.
3. B3/B4 canonical demand aggregation, lifecycle/cancellation release, explicit
   outstanding-custody settlement and project archival/closure integration.
4. Browser direct task/experiment/BOM APIs currently omit canonical requirement
   write fields; align them with the same guards. Browser task/experiment link
   insertion also needs review against the mandatory project_id migration.
5. Project sync audit currently occurs after commit using best-effort audit. Make
   its transaction/receipt/audit guarantees explicit in the existing audit work;
   this checkpoint does not silently claim custody-level atomicity for projects.
6. Native callers that clone/repeat work and alternate project mutation paths
   still require full relationship coverage review. No exhaustive repository audit
   or existing-data repair is claimed by these bounded guards.

Next implementation: reservation-backed custody issue and local allocation
projection, followed by grouped acceptance. B1, B3, B4 and A1 remain PARTIAL.
