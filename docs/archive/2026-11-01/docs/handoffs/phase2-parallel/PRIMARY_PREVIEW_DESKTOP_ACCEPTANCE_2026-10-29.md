# Primary — isolated V2 desktop acceptance

Owner: primary implementation/review agent. This is not a helper report.

## Isolation contract

- Preview identifier: `com.lab-inventory.app.preview`; title: `LabOS Preview`.
- Native SQLite and resource storage resolve from the configured app data directory.
- Both `VITE_API_BASE_URL` and `LABOS_NATIVE_API_BASE` must be explicitly
  `http://localhost:4000/api` when building this preview.
- V1 uses its separate identifier and port 4010. Do not replace its binary,
  close its window, change its containers, or copy its database into Preview.
- Development containers are `labos-db-1` and `labos-labos-api-1` only.

## Build started

From `desktop`, with Node and the Windows Rust toolchain on PATH:

```powershell
$env:VITE_API_BASE_URL = 'http://localhost:4000/api'
$env:LABOS_NATIVE_API_BASE = 'http://localhost:4000/api'
node node_modules/@tauri-apps/cli/tauri.js build --debug --bundles none --config src-tauri/tauri.preview.conf.json --ci -- --locked --offline -j 1
```

No installer or V1 deployment is involved. TypeScript and Vite completed
successfully (2,265 modules; Vite 1m 37s). Native compilation completed in
8m 11s with one unused-function warning for `resolve_conflict`.
`target/debug/LabOS Preview.exe` launched successfully and displayed the login
screen with an expired/unavailable local authorization notice. No blank screen
was observed. Offline workspace acceptance requires refreshing this login first.
On resuming, Docker's Linux engine was unavailable; development container start
failed before any container was started. Docker Desktop restart initiated.

## Acceptance batch — not yet passed

| Check | Required evidence | Status |
| --- | --- | --- |
| Native preview startup | New executable, correct title/profile, no blank screen | PASS to login screen; workspace pending |
| Offline cached reads | Development API stopped; project and nested records remain visible | PARTIAL: six-project register loads; nested details pending |
| Offline authored changes | Save disposable project/task edits without API | Pending |
| Offline restart | Same edits and pending operations survive restart | Pending |
| Reconnect | Development API health, accepted receipts, pending operations clear | Pending |
| Repeat refresh/retry | No duplicated records or reverted authored fields | Pending |
| Relationship views | Task/experiment/resource views match canonical project data | Pending |

If the isolated preview requires authentication, the user must sign in manually.
Do not manufacture a cached session or copy credentials/state from V1.

Existing backend HTTP/PostgreSQL and native disk tests are evidence for their
individual layers, not substitutes for this desktop acceptance. No parent
checklist item is closed by starting this build.

## Live continuation

Docker engine recovered after Desktop startup. Existing development DB/API
started; `/api/health` confirmed API, database and storage OK. Preview was reopened
and displayed its dashboard with a restored session without automated credential
entry. Only development API was then stopped using `docker stop labos-labos-api-1`.
Navigation from dashboard to Projects loaded six cached projects, including
statuses, due dates and remaining balances.

Batch findings to investigate after the remaining tests:

- Reservation review continues to display `Loading pending requests…` during
  this offline observation; eventual timeout/cache behavior remains to check.
- Assistant continues to display its prior `Connected` label during the offline
  observation; this label may represent saved provider configuration rather than
  current API reachability. Clarify through source inspection before changing it.
- Accessibility activation of the Sensor calibration row did not navigate;
  retry with a visible, freshly observed row before classifying it as a product bug.

Development API restart requested after this bounded offline check. No authored
edits, restart-persistence or mutation/reconnect PASS is claimed from these reads.

## Offline project detail and save check

With development API confirmed `exited`, the seeded Sensor calibration project
opened successfully. Its overview showed five tasks, two experiments, project
timeline/budget and cached context. Earlier row-navigation uncertainty was a
capture-before-render issue, not a confirmed navigation defect.

FAIL: editing the description and clicking the project header's `Save` closed
editing and restored the original text. Production source confirms this button
only toggled `editing`; only the bottom `Save changes` invoked the save handler.
No acceptance marker persisted, so restart/reconnect mutation checks cannot be
claimed. Existing dates remained intact after this non-save.

Repair made in `desktop/src/pages/ProjectDetailPage.tsx`: header Save now invokes
the same async save handler as the bottom button, shows Saving while pending,
and disables saving for a blank name. Edit still opens the form. This blocks the
intended header-save acceptance path, so repair precedes retesting that path.
Native preview has not yet been rebuilt with this frontend repair.
Development API restarted after the check. V1 was untouched.

TypeScript `tsc --noEmit` completed with exit 0 after the header Save repair;
`git diff --check` passed. Isolated Preview rebuild started for GUI retest.

Follow-up source inspection: `getReservationReviewQueue` in
`desktop/src/api/projects.ts` directly calls `/projects/reservations/review-queue`
without a native local read. This is a confirmed remaining offline read gap;
the loading duration alone was not established as an infinite spinner.
`AssistantChat.tsx` derives `Connected` solely from `capabilities.enabled`, so
that label does not establish present network reachability. These findings
remain in the acceptance batch; neither has been repaired by the Save change.
