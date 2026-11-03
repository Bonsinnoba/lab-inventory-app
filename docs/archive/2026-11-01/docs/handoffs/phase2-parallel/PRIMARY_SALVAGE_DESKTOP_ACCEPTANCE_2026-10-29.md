# Primary — salvage desktop acceptance checkpoint

Owner: primary agent; actual separate V2 Preview, not V1. This is an acceptance
report, not additional implementation and not a helper completion claim.

## Setup and observed results

- Launched the built `desktop/src-tauri/target/debug/LabOS Preview.exe` with the
  separate `com.lab-inventory.app.preview` profile and development port4000 API.
  Installed V1 remained running and was neither closed nor updated.
- Existing Preview session restored as the cached admin; no automated credential
  entry or authentication change was performed.
- Read-only inspection of the actual Preview SQLite DB showed no pending outbox
  groups, an authorized downloaded salvage snapshot with zero recoveries, and no
  labelled acceptance intentions. Initial UI sync eventually reported synced.
- Created a consistent online SQLite backup with Node's SQLite backup API at
  `.tmp/preview-before-salvage-acceptance.sqlite`. Database inspection was read-only
  and did not print credentials, session secrets or unrestricted sync-state values.
- Actual Preview inventory page displayed inventory entries and the new
  Salvage & recovery / Review recoveries controls before the outage.
- Stopped only `labos-labos-api-1`; its state was confirmed `exited`. Existing
  development PostgreSQL stayed running and V1 was unchanged.
- Restarted only the Preview process launched for this read-only check. With the
  development API still stopped, a fresh Preview window's accessibility state
  displayed the cached dashboard: three active projects, eighteen overdue tasks,
  five low-stock entries, seeded project summaries and recent resources/notes.
  This verifies offline restored-session/cached-dashboard cold-start reads, not
  a newly authored mutation or a screenshot-based visual sign-off.

## Tooling failure / explicit unverified cases

The primary native helper initially timed out; bounded recovery recovered window
discovery. A later recovery-control click failed:

`point (6, -18) is outside window bounds { originX: 0, originY: 0, width: 12, height: 12 }`

Fresh selection and capture returned Preview accessibility text alongside a
screenshot of a different foreground application. The alternate native inspector
also returned a mismatched screenshot and rejected click geometry with:

`coordinate input geometry is unavailable`

No input was sent using the wrong screenshot. No terminal/UI injection, fake
window handle or authentication bypass was used. These are automation/tooling
failures; they do not establish that the recovery control itself is broken.

Remaining actual-desktop acceptance cases are NOT RUN:

1. Create a labelled two-output recovery offline through the form; confirm one
   outbox event and no stock effect, close the fully saved form and restart.
2. Reopen the recovery list offline; both quarantined outputs must remain visible.
3. Restore API; verify one server batch, two outputs and one receipt; repeat sync
   must not duplicate them. Verify acknowledged output projections reconcile.
4. Queue inspection offline, reconnect and pull; then queue release offline,
   reconnect and confirm the stock ledger's single shared source claim.
5. Select a real disposable custody issue, queue a partial return offline and
   restart; release only after confirmed inspection. Confirm one return movement,
   one holder settlement and one stock credit, then repeat reconnect.
6. Repeat with relevant authority/lease changes and preserve rejected work.

Existing SQLite, PostgreSQL HTTP, concurrency and adapter PASS evidence remains
valid at its stated layers. It does not substitute for these form/restart/sync
interactions. No authored acceptance records or stock mutations were created in
this checkpoint, so there is no acceptance data to purge.

Development API restored at the end of the outage check. Read-only SQLite counts
after restoration still showed no pending outbox groups or authored acceptance
intentions and the downloaded empty salvage snapshot remained intact. Final API
health returned HTTP200, API/database/storage OK at23:26:53 UTC. B1/B2 and Phase 2 remain PARTIAL; no parent
closure/count promotion.
